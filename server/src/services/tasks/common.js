// Shared helpers for the Task Management API (access rules, validation, calendar, turn generation, file storage).
import { randomUUID } from 'node:crypto';
import { query } from '../../config/db.js';
import { can } from '../access.js';
import { s3Enabled, putObject, getViewUrl, deleteObject } from '../../config/s3.js';
import { HttpError, badRequest, forbidden, notFound } from '../../utils/httpError.js';
import { addDays, todayIST, istDate, istToDate, weekday, fmtDmy } from '../../utils/ist.js';
import { dueDates } from './recurrence.js';

export const PRIORITIES = ['Low', 'Medium', 'High', 'Urgent'];
export const HORIZON_DAYS = 62;

// ---------------- text / id validation ----------------
export const posInt = (v) => {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
export const cleanText = (v, max) => String(v ?? '').trim().slice(0, max);
export const optText = (v, max) => cleanText(v, max) || null;
export const needId = (v, msg = 'Not found') => posInt(v) ?? (() => { throw notFound(msg); })();

// ---------------- permissions (host module keys, see config/modules.js) ----------------
/** Spec permission set mapped onto the host's module/action permissions. */
export const perms = (u) => ({
  dashboardView: can(u, 'task_dashboard', 'view'),
  tasksView: can(u, 'tasks_mine', 'view'),
  tasksEdit: can(u, 'tasks_mine', 'edit'),
  tasksDelete: can(u, 'tasks_mine', 'delete'),
  allView: can(u, 'tasks_all', 'view'), // "All data"
  allEdit: can(u, 'tasks_all', 'edit'), // edit other people's tasks
  revert: can(u, 'tasks_revert', 'edit'),
  pcView: can(u, 'pc_main', 'view'),
  pcEdit: can(u, 'pc_main', 'edit'),
});
export const isIn = (v, list) => list.includes(v);

/**
 * Row-level "visible in lists" predicate for a table alias holding assigner_id / assignee_id / verifier_id.
 * scope: 'mine' | 'assigned' | 'all'. Returns { sql, params } (params appended after `params`, $n numbering continued).
 */
export function visibleSql(user, scope, alias, params) {
  const p = perms(user);
  if (p.allView && scope === 'all') return '(TRUE)';
  const me = (params.push(user.id), `$${params.length}`);
  let sql = `(${alias}.assignee_id = ${me} OR ${alias}.assigner_id = ${me} OR ${alias}.verifier_id = ${me})`;
  if (scope === 'mine') sql += ` AND ${alias}.assignee_id = ${me}`;
  else if (scope === 'assigned') sql += ` AND ${alias}.assigner_id = ${me}`;
  return `(${sql})`;
}

/** Can the user open this task (assigner, assignee, verifier, all-data, or PC dashboard)? */
export const isInvolved = (user, t) => {
  const p = perms(user);
  return [t.assigner_id, t.assignee_id, t.verifier_id].includes(user.id) || p.allView || p.pcView;
};
export const isAssigner = (user, t) => t.assigner_id === user.id || perms(user).allEdit;
export const isAssignee = (user, t) => t.assignee_id === user.id || perms(user).allEdit;
export const verifierOf = (t) => t.verifier_id || t.assigner_id;
export const isVerifier = (user, t) => verifierOf(t) === user.id || perms(user).allEdit;
export const canReassignAny = (user) => perms(user).allEdit || perms(user).pcEdit;

// ---------------- notifications text ----------------
export { fmtDateTime } from '../../utils/ist.js';
export const delegationLink = (id, assigned = false) => `/tasks?open=d${id}${assigned ? '&scope=assigned' : ''}`;
export const checklistLink = (id) => `/tasks?tab=checklists&open=c${id}`;

// ---------------- calendar (holidays / weekly off) ----------------
export async function loadCalendar(db = { query }, fromDate = null) {
  const [h, w] = await Promise.all([
    db.query('SELECT holiday_date, name FROM holidays WHERE holiday_date >= COALESCE($1::date, DATE \'1900-01-01\')', [fromDate]),
    db.query('SELECT weekly_off FROM work_settings WHERE id = 1'),
  ]);
  const names = new Map(h.rows.map((r) => [r.holiday_date, r.name]));
  return { holidays: new Set(names.keys()), names, weeklyOff: (w.rows[0]?.weekly_off || [0]).map(Number) };
}

/** Throws when `date` (a Date) falls on a holiday. label = 'deadline' | 'new deadline' */
export async function assertNotHoliday(date, label = 'deadline', db = { query }) {
  const d = istDate(date);
  const { rows } = await db.query('SELECT name FROM holidays WHERE holiday_date = $1', [d]);
  if (rows[0]) throw badRequest(`The ${label} falls on a holiday (${rows[0].name}, ${fmtDmy(d)}). Choose a working day.`);
}

// ---------------- common form validation (8.1) ----------------
export async function cleanCommon(body, db = { query }) {
  const title = cleanText(body.title, 200);
  if (!title) throw badRequest('Enter the task title');
  const assignee_id = posInt(body.assignee_id);
  if (!assignee_id || !(await db.query('SELECT 1 FROM users WHERE id = $1 AND is_active', [assignee_id])).rowCount)
    throw badRequest('Choose who the task is assigned to');
  const priority = PRIORITIES.includes(body.priority) ? body.priority : 'Medium';
  let category_id = posInt(body.category_id);
  if (category_id && !(await db.query('SELECT 1 FROM task_categories WHERE id = $1', [category_id])).rowCount)
    throw badRequest('The category is not valid');
  category_id = category_id || null;
  const verification_required = !!body.verification_required;
  let verifier_id = posInt(body.verifier_id) || null;
  if (verification_required) {
    if (!verifier_id || !(await db.query('SELECT 1 FROM users WHERE id = $1 AND is_active', [verifier_id])).rowCount)
      throw badRequest('Choose who verifies the task (Verified By)');
  } else verifier_id = null;
  const reminders = [...new Set((Array.isArray(body.reminders) ? body.reminders : []).map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 129600))]
    .sort((a, b) => b - a).slice(0, 10);
  return {
    title, assignee_id, priority, category_id, verification_required, verifier_id, reminders,
    description: optText(body.description, 4000),
    evidence_required: !!body.evidence_required,
  };
}
/** Checkpoint texts (strings ≤200, blanks dropped, max 30). Accepts strings or {text}. */
export const cleanCheckpoints = (v) =>
  (Array.isArray(v) ? v : []).map((c) => cleanText(typeof c === 'object' && c ? c.text : c, 200)).filter(Boolean).slice(0, 30);

// ---------------- checklist turn generation ----------------
/** SQL predicate (alias o) for an "untouched" turn (spec 7). */
export const untouchedSql = (o = 'o') => `(
  ${o}.status IN ('pending','not_done','non_functional') AND ${o}.note IS NULL AND ${o}.submitted_at IS NULL
  AND ${o}.completed_at IS NULL AND ${o}.verified_at IS NULL AND ${o}.verified_by IS NULL AND ${o}.reject_count = 0
  AND NOT (${o}.checkpoints_done @> 'true'::jsonb)
  AND NOT EXISTS (SELECT 1 FROM task_files f WHERE f.kind = 'occurrence' AND f.ref_id = ${o}.id))`;

/** Make missing turns for today … today+62 (never past days), skipping holidays/weekly off. Returns rows inserted. */
export async function generateTurns(db = { query }, checklistId = null) {
  const today = todayIST();
  const to = addDays(today, HORIZON_DAYS);
  const cal = await loadCalendar(db, today);
  const { rows } = await db.query(
    `SELECT id, frequency, start_date, end_date, due_time, config FROM checklists WHERE active ${checklistId ? 'AND id = $1' : ''}`,
    checklistId ? [checklistId] : []
  );
  let n = 0;
  for (const cl of rows) {
    const dates = dueDates(cl, today, to, cal.holidays, cal.weeklyOff);
    if (!dates.length) continue;
    const r = await db.query(
      `INSERT INTO checklist_occurrences (checklist_id, due_at) SELECT $1, d FROM unnest($2::timestamptz[]) AS d ON CONFLICT DO NOTHING`,
      [cl.id, dates.map((d) => istToDate(d, cl.due_time).toISOString())]
    );
    n += r.rowCount;
  }
  return n;
}

/**
 * After a schedule edit: delete untouched pending/not_done turns the schedule no longer has (past ones too),
 * then generate the missing turns. verifyDates: caller recomputes verify_on separately.
 */
export async function syncChecklistTurns(db, cl) {
  const cal = await loadCalendar(db);
  const horizon = addDays(todayIST(), HORIZON_DAYS);
  const expected = new Set(
    dueDates(cl, cl.start_date, horizon, cal.holidays, cal.weeklyOff).map((d) => istToDate(d, cl.due_time).getTime())
  );
  const { rows } = await db.query(
    `SELECT o.id, o.due_at FROM checklist_occurrences o WHERE o.checklist_id = $1 AND o.status IN ('pending','not_done') AND ${untouchedSql('o')}`,
    [cl.id]
  );
  const del = rows.filter((r) => !expected.has(new Date(r.due_at).getTime())).map((r) => r.id);
  if (del.length) await db.query('DELETE FROM checklist_occurrences WHERE id = ANY($1::int[])', [del]);
  await generateTurns(db, cl.id);
}

// ---------------- files (S3, same storage as the rest of the app) ----------------
export const requireStorage = () => {
  if (!s3Enabled()) throw new HttpError(503, 'File storage is not configured. Add AWS S3 settings to the server .env.');
};
const EXT = (name) => (String(name).match(/\.([A-Za-z0-9]{1,8})$/)?.[1] || 'bin').toLowerCase();
/** Store a multer memory file; returns the S3 key `tasks/tk_<32hex>.<ext>`. */
export async function saveTaskFile(file) {
  requireStorage();
  const key = `tasks/tk_${randomUUID().replace(/-/g, '')}.${EXT(file.originalname)}`;
  try {
    await putObject(key, file.buffer, file.mimetype || 'application/octet-stream');
  } catch (e) {
    console.error('S3 upload failed:', e.name, e.message);
    throw new HttpError(502, 'Could not upload to S3. Check the AWS credentials, region and bucket name.');
  }
  return key;
}
export const removeTaskFile = async (key) => {
  if (!key || !s3Enabled()) return;
  try { await deleteObject(key); } catch (e) { console.warn(`S3 cleanup failed for ${key}: ${e.message}`); }
};
/** Short-lived signed URL (access is only given to people who may open the task). */
export const taskFileUrl = async (key) => (key && s3Enabled() ? getViewUrl(key).catch(() => null) : null);

/** Attach `files: [{id,name,mime,size,purpose,url,created_at,uploaded_by}]` to rows (kind = 'delegation'|'checklist'|'occurrence'). */
export async function attachFiles(rows, kind) {
  if (!rows.length) return rows;
  const { rows: fs } = await query(
    `SELECT id, ref_id, purpose, file_key, name, mime, size, uploaded_by, created_at FROM task_files WHERE kind = $1 AND ref_id = ANY($2::int[]) ORDER BY id`,
    [kind, rows.map((r) => r.id)]
  );
  const urls = await Promise.all(fs.map((f) => taskFileUrl(f.file_key)));
  const by = new Map();
  fs.forEach((f, i) => {
    const { file_key, ref_id, ...rest } = f;
    (by.get(ref_id) || by.set(ref_id, []).get(ref_id)).push({ ...rest, url: urls[i] });
  });
  for (const r of rows) r.files = by.get(r.id) || [];
  return rows;
}
export const withVoiceUrl = async (rows) => {
  await Promise.all(rows.map(async (r) => { r.voice_url = await taskFileUrl(r.voice_key); delete r.voice_key; }));
  return rows;
};

export { forbidden, badRequest, notFound, weekday };
