// Checklists (recurring tasks), their turns (occurrences), verification, non-functional marks. Spec 7, 8.1, 8.4–8.7, 13.
import { Router } from 'express';
import { query, withTransaction } from '../../config/db.js';
import { badRequest, conflict, forbidden, notFound } from '../../utils/httpError.js';
import { istDate, todayIST, parseDeadline, fmtDateTime, mondayOf, addDays } from '../../utils/ist.js';
import { cleanConfig, cleanVerifyConfig, nextVerifyDate, describeVerify, describeRepeat } from '../../services/tasks/recurrence.js';
import { reportPdf, sendPdf } from '../../services/pdfReport.js';
import { notify } from '../../services/notifications.js';
import {
  perms, visibleSql, isInvolved, isAssigner, isAssignee, isVerifier, verifierOf, posInt, cleanText, optText, needId,
  cleanCommon, cleanCheckpoints, generateTurns, syncChecklistTurns, attachFiles, withVoiceUrl, checklistLink,
  assertNotHoliday, removeTaskFile, PRIORITIES,
} from '../../services/tasks/common.js';

const router = Router();
const IST = "'Asia/Kolkata'";
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
const FUTURE_MSG = 'This turn is for a coming day. It opens on its own day';
const nextVerifyFor = (cl, dueAt, doneAt) => {
  const dd = istDate(dueAt);
  const td = istDate(doneAt);
  return nextVerifyDate(cl.verify_config, dd > td ? dd : td);
};

// ---------------------------------------------------------------- validation
async function cleanChecklist(body, db = { query }) {
  const c = await cleanCommon(body, db);
  const start_date = isDate(body.start_date) ? body.start_date : '';
  const config = cleanConfig(body.frequency, body.config, start_date);
  let end_date = null;
  if (body.end_date) {
    if (!isDate(body.end_date)) throw badRequest('The end date is not valid');
    if (body.end_date < start_date) throw badRequest('The end date cannot be before the start date');
    end_date = body.end_date;
  }
  const due_time = body.due_time ? String(body.due_time).trim() : '10:00';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(due_time)) throw badRequest('The due time is not valid');
  return {
    ...c, frequency: body.frequency, start_date, end_date, due_time, config,
    checkpoints: cleanCheckpoints(body.checkpoints),
    delay_rule: body.delay_rule === 'close' ? 'close' : 'carry_forward',
    non_functional_allowed: !!body.non_functional_allowed,
    verify_config: c.verification_required ? cleanVerifyConfig(body.verify_config, start_date) : { freq: 'daily' },
  };
}

// ---------------------------------------------------------------- shared SELECTs
const BASE_FROM = `FROM checklists c
  JOIN users a ON a.id = c.assignee_id JOIN users s ON s.id = c.assigner_id
  LEFT JOIN users v ON v.id = c.verifier_id LEFT JOIN task_categories k ON k.id = c.category_id`;
const NAMES = `a.name AS assignee_name, a.department AS assignee_department, s.name AS assigner_name,
  v.name AS verifier_name, k.name AS category_name`;
const STATS = (t) => `LEFT JOIN LATERAL (SELECT
    MIN(o.due_at) FILTER (WHERE o.status = 'pending' AND o.due_at >= NOW()) AS next_due,
    COUNT(*) FILTER (WHERE o.status = 'pending' AND o.due_at < NOW())::int AS overdue,
    COALESCE(MAX(${t}::date - (o.due_at AT TIME ZONE ${IST})::date) FILTER (WHERE o.status = 'pending' AND o.due_at < NOW()), 0)::int AS max_overdue_days,
    COUNT(*) FILTER (WHERE o.status = 'completed')::int AS done_count,
    COUNT(*) FILTER (WHERE o.status = 'completed' AND COALESCE(o.submitted_at, o.completed_at) > o.due_at)::int AS done_late_count,
    COUNT(*) FILTER (WHERE o.status = 'not_done')::int AS not_done_count,
    COUNT(*) FILTER (WHERE o.status = 'non_functional')::int AS non_functional_count,
    MIN(o.due_at) FILTER (WHERE (o.due_at AT TIME ZONE ${IST})::date = ${t}::date) AS today_due
  FROM checklist_occurrences o WHERE o.checklist_id = c.id) st ON TRUE`;

/** Filtered list query shared by GET /checklists and the PDF. */
async function listChecklists(user, q, { limit, offset }) {
  const scope = ['mine', 'assigned', 'all'].includes(q.scope) ? q.scope : 'mine';
  const params = [todayIST()];
  const where = [visibleSql(user, scope, 'c', params)];
  const add = (sql, v) => { params.push(v); where.push(sql.replace('?', `$${params.length}`)); };
  if (posInt(q.category)) add('c.category_id = ?', posInt(q.category));
  if (PRIORITIES.includes(q.priority)) add('c.priority = ?', q.priority);
  if (posInt(q.assignee)) add('c.assignee_id = ?', posInt(q.assignee));
  if (['Daily', 'Weekly', 'Monthly', 'Yearly', 'Periodically', 'Custom'].includes(q.frequency)) add('c.frequency = ?', q.frequency);
  if (q.search) {
    params.push(`%${cleanText(q.search, 100)}%`);
    where.push(`(c.title ILIKE $${params.length} OR a.name ILIKE $${params.length})`);
  }
  if (q.status === 'today') where.push('c.active AND st.today_due IS NOT NULL');
  else if (q.status === 'active') where.push('c.active');
  else if (q.status === 'paused') where.push('NOT c.active');
  else if (q.status === 'delayed') where.push('c.active AND st.overdue > 0');
  const order = q.status === 'today'
    ? 'st.today_due, c.title'
    : q.pdf ? 'a.name, c.due_time, c.title' : 'c.active DESC, st.next_due NULLS LAST, c.title';
  params.push(limit, offset);
  const { rows } = await query(
    `SELECT c.*, ${NAMES}, st.next_due, st.overdue, st.max_overdue_days, st.done_count, st.done_late_count,
            st.not_done_count, st.non_functional_count, COUNT(*) OVER()::int AS total_rows
       ${BASE_FROM} ${STATS('$1')}
      WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  return rows;
}
const decorateRow = (r) => {
  r.repeat_text = describeRepeat(r);
  r.verify_text = r.verification_required ? describeVerify(r.verify_config) : null;
  r.has_voice = !!r.voice_key;
  delete r.voice_key;
  delete r.total_rows;
  return r;
};

router.get('/checklists', async (req, res) => {
  const page = Math.max(1, Number(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 20));
  const rows = await listChecklists(req.user, req.query, { limit, offset: (page - 1) * limit });
  const total = rows[0]?.total_rows ?? 0;
  res.json({ data: rows.map(decorateRow), total, page, limit });
});

// Checklist PDF (spec 14): one table per doer
router.get('/checklists/pdf', async (req, res) => {
  const rows = await listChecklists(req.user, { ...req.query, pdf: '1' }, { limit: 5000, offset: 0 });
  const by = new Map();
  rows.forEach((r) => (by.get(r.assignee_name) || by.set(r.assignee_name, []).get(r.assignee_name)).push(r));
  const blocks = [...by.entries()].map(([name, list]) => ({
    heading: name, note: `${list.length} checklist tasks`,
    columns: ['Time', 'Task', 'Priority', 'Category', 'Repeats', 'Assigned by', 'Verifier', 'Evidence'],
    rows: list.map((r) => [r.due_time, r.title, r.priority, r.category_name, describeRepeat(r), r.assigner_name,
      r.verification_required ? r.verifier_name || 'No' : 'No', r.evidence_required ? 'Required' : 'No']),
  }));
  const filters = ['status', 'frequency', 'priority', 'search'].filter((k) => req.query[k]).map((k) => `${k}: ${req.query[k]}`);
  const buf = await reportPdf({
    title: 'Checklist Tasks',
    subtitle: [`${rows.length} tasks`, ...filters].join(' · '),
    blocks: blocks.length ? blocks : [{ columns: ['Time'], rows: [] }],
  });
  const doer = posInt(req.query.assignee) && rows[0] ? `-${rows[0].assignee_name}` : '';
  sendPdf(res, buf, `checklist-tasks${doer}.pdf`);
});

// ---------------------------------------------------------------- detail
const workStatus = (o, now) => {
  if (o.status === 'not_done' || o.status === 'non_functional') return o.status;
  if (o.status === 'submitted') return 'verify';
  if (o.status === 'pending') return new Date(o.due_at) < now ? 'delayed' : 'open';
  return new Date(o.submitted_at || o.completed_at || o.due_at) <= new Date(o.due_at) ? 'done' : 'done_late';
};
const decorateTurn = (o, today, now) => {
  o.work_status = workStatus(o, now);
  const doneAt = o.submitted_at || o.completed_at;
  o.on_time = ['submitted', 'completed'].includes(o.status) && !!doneAt && new Date(doneAt) <= new Date(o.due_at);
  o.overdue_days = o.status === 'pending' && new Date(o.due_at) < now
    ? Math.max(0, Math.round((Date.parse(today) - Date.parse(istDate(o.due_at))) / 86400000)) : 0;
  o.is_future = istDate(o.due_at) > today;
  return o;
};
const TURN_SELECT = `SELECT o.*, vb.name AS verified_by_name, nb.name AS non_functional_by_name
  FROM checklist_occurrences o LEFT JOIN users vb ON vb.id = o.verified_by LEFT JOIN users nb ON nb.id = o.non_functional_by`;

async function loadChecklistFor(user, id) {
  const { rows } = await query(`SELECT c.*, ${NAMES} ${BASE_FROM} WHERE c.id = $1`, [id]);
  if (!rows[0] || !isInvolved(user, rows[0])) throw notFound('Checklist not found');
  return rows[0];
}
/** Can this person see every submitted turn at once (not held back until its verification day)? */
const seesAllSubmitted = (user, cl) => cl.assigner_id === user.id || cl.assignee_id === user.id || perms(user).allEdit || perms(user).allView;

async function checklistDetail(user, id) {
  const cl = await loadChecklistFor(user, id);
  const today = todayIST();
  const now = new Date();
  const { rows: turns } = await query(
    `${TURN_SELECT} WHERE o.checklist_id = $1 AND o.due_at BETWEEN NOW() - INTERVAL '60 days' AND NOW() + INTERVAL '30 days'
     ORDER BY o.due_at DESC`, [id]);
  const visible = seesAllSubmitted(user, cl) ? turns : turns.filter((o) => !(o.status === 'submitted' && o.verify_on && o.verify_on > today));
  visible.forEach((o) => decorateTurn(o, today, now));
  await attachFiles(visible, 'occurrence');
  const { rows: re } = await query(
    `SELECT r.*, f.name AS from_name, t.name AS to_name, b.name AS by_name FROM task_reassignments r
       LEFT JOIN users f ON f.id = r.from_user_id LEFT JOIN users t ON t.id = r.to_user_id LEFT JOIN users b ON b.id = r.by_user_id
      WHERE r.kind = 'checklist' AND r.task_id = $1 ORDER BY r.id`, [id]);
  const { rows: nx } = await query(
    `SELECT MIN(due_at) FILTER (WHERE status = 'pending') AS next_due,
            COUNT(*) FILTER (WHERE status = 'pending' AND due_at < NOW())::int AS overdue,
            COUNT(*) FILTER (WHERE status = 'completed')::int AS done_count,
            COUNT(*) FILTER (WHERE status = 'completed' AND COALESCE(submitted_at, completed_at) > due_at)::int AS done_late_count,
            COUNT(*) FILTER (WHERE status = 'not_done')::int AS not_done_count,
            COUNT(*) FILTER (WHERE status = 'non_functional')::int AS non_functional_count
       FROM checklist_occurrences WHERE checklist_id = $1`, [id]);
  const out = { ...cl, ...nx[0] };
  await attachFiles([out], 'checklist');
  await withVoiceUrl([out]);
  decorateRow(out);
  out.turns = visible;
  out.reassignments = re;
  out.can_edit = isAssigner(user, cl);
  out.can_verify = !!cl.verification_required && isVerifier(user, cl);
  return out;
}

router.get('/checklists/:id', async (req, res) => res.json(await checklistDetail(req.user, needId(req.params.id, 'Checklist not found'))));

// ---------------------------------------------------------------- create / edit / delete / pause
const COLS = ['title', 'description', 'assignee_id', 'verifier_id', 'category_id', 'priority', 'evidence_required', 'verification_required',
  'frequency', 'start_date', 'end_date', 'due_time', 'config', 'checkpoints', 'reminders', 'delay_rule', 'non_functional_allowed', 'verify_config'];
const JSONCOLS = new Set(['config', 'checkpoints', 'reminders', 'verify_config']);
const val = (c, v) => (JSONCOLS.has(c) ? JSON.stringify(v[c]) : v[c]);

router.post('/checklists', async (req, res) => {
  const v = await cleanChecklist(req.body);
  const id = await withTransaction(async (db) => {
    const cols = ['assigner_id', ...COLS];
    const vals = [req.user.id, ...COLS.map((c) => val(c, v))];
    const { rows } = await db.query(
      `INSERT INTO checklists (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}${JSONCOLS.has(cols[i]) ? '::jsonb' : ''}`).join(',')}) RETURNING id`, vals);
    await generateTurns(db, rows[0].id);
    return rows[0].id;
  });
  await notify(v.assignee_id, { kind: 'assigned', title: `New checklist for you: ${v.title}`, body: `${v.frequency} · by ${req.user.name}`, link: checklistLink(id), actor: req.user.name }, req.user.id);
  res.status(201).json(await checklistDetail(req.user, id));
});

router.put('/checklists/:id', async (req, res) => {
  const id = needId(req.params.id, 'Checklist not found');
  const old = await loadChecklistFor(req.user, id);
  if (!isAssigner(req.user, old)) throw forbidden('Only the person who assigned the checklist can change it');
  const merged = { ...Object.fromEntries(COLS.map((c) => [c, old[c]])), ...req.body };
  const v = await cleanChecklist(merged);
  await withTransaction(async (db) => {
    const sets = COLS.map((c, i) => `${c} = $${i + 1}${JSONCOLS.has(c) ? '::jsonb' : ''}`);
    const vals = COLS.map((c) => val(c, v));
    const extra = v.assignee_id !== old.assignee_id ? ', original_assignee_id = NULL, reassign_until = NULL' : '';
    await db.query(`UPDATE checklists SET ${sets.join(', ')}${extra}, updated_at = NOW() WHERE id = $${COLS.length + 1}`, [...vals, id]);
    if (v.priority !== old.priority)
      await db.query("INSERT INTO task_priority_log (kind, task_id, old_priority, new_priority, by_user_id) VALUES ('checklist', $1, $2, $3, $4)", [id, old.priority, v.priority, req.user.id]);
    const cl = (await db.query('SELECT * FROM checklists WHERE id = $1', [id])).rows[0];
    await syncChecklistTurns(db, cl);
    const { rows: sub } = await db.query("SELECT id, due_at, submitted_at FROM checklist_occurrences WHERE checklist_id = $1 AND status = 'submitted'", [id]);
    for (const o of sub)
      await db.query('UPDATE checklist_occurrences SET verify_on = $1 WHERE id = $2', [nextVerifyFor(cl, o.due_at, o.submitted_at || new Date()), o.id]);
  });
  if (v.assignee_id !== old.assignee_id)
    await notify(v.assignee_id, { kind: 'assigned', title: `Checklist assigned to you: ${v.title}`, body: `${v.frequency} · by ${req.user.name}`, link: checklistLink(id), actor: req.user.name }, req.user.id);
  res.json(await checklistDetail(req.user, id));
});

router.post('/checklists/:id/active', async (req, res) => {
  const id = needId(req.params.id, 'Checklist not found');
  const cl = await loadChecklistFor(req.user, id);
  if (!isAssigner(req.user, cl)) throw forbidden('Only the person who assigned the checklist can change it');
  const active = !!req.body.active;
  await withTransaction(async (db) => {
    await db.query('UPDATE checklists SET active = $1, updated_at = NOW() WHERE id = $2', [active, id]);
    if (active) await generateTurns(db, id);
  });
  res.json(await checklistDetail(req.user, id));
});

router.delete('/checklists/:id', async (req, res) => {
  const id = needId(req.params.id, 'Checklist not found');
  const cl = await loadChecklistFor(req.user, id);
  if (!isAssigner(req.user, cl)) throw forbidden('Only the person who assigned the checklist can delete it');
  const keys = await withTransaction(async (db) => {
    const { rows: files } = await db.query(
      `DELETE FROM task_files WHERE (kind = 'checklist' AND ref_id = $1)
          OR (kind = 'occurrence' AND ref_id IN (SELECT id FROM checklist_occurrences WHERE checklist_id = $1)) RETURNING file_key`, [id]);
    await db.query('DELETE FROM checklists WHERE id = $1', [id]);
    return [...files.map((f) => f.file_key), cl.voice_key].filter(Boolean);
  });
  await Promise.all(keys.map(removeTaskFile));
  res.json({ message: 'Checklist deleted' });
});

// ---------------------------------------------------------------- verification overview
router.get('/checklists/:id/verification', async (req, res) => {
  const id = needId(req.params.id, 'Checklist not found');
  const cl = await loadChecklistFor(req.user, id);
  const today = todayIST();
  const { rows } = await query(
    `${TURN_SELECT} WHERE o.checklist_id = $1 AND (o.status = 'submitted' OR o.verified_at IS NOT NULL)
     ORDER BY o.due_at DESC LIMIT 120`, [id]);
  const submitted = rows.filter((o) => o.status === 'submitted');
  const due = submitted.filter((o) => !o.verify_on || o.verify_on <= today);
  const waiting = submitted.filter((o) => o.verify_on && o.verify_on > today);
  const verified = rows.filter((o) => o.status !== 'submitted' && o.verified_at).slice(0, 30);
  const out = {
    schedule: describeVerify(cl.verify_config), config: cl.verify_config,
    can_verify: !!cl.verification_required && isVerifier(req.user, cl),
    next_on: waiting.map((o) => o.verify_on).sort()[0] || null,
    to_verify: due, waiting, verified,
  };
  await attachFiles([...due, ...waiting, ...verified], 'occurrence');
  res.json(out);
});

// ---------------------------------------------------------------- occurrences
router.get('/occurrences', async (req, res) => {
  const scope = ['mine', 'assigned', 'all'].includes(req.query.scope) ? req.query.scope : 'mine';
  const params = [];
  const where = ['c.active', visibleSql(req.user, scope, 'c', params)];
  const today = todayIST();
  params.push(today);
  const T = `$${params.length}::date`;
  const D = `(o.due_at AT TIME ZONE ${IST})::date`;
  if (req.query.range === 'today') where.push(`${D} = ${T}`);
  else if (req.query.range === 'overdue') where.push("o.status = 'pending' AND o.due_at < NOW()");
  else if (req.query.range === 'week') { params.push(mondayOf(today), addDays(mondayOf(today), 6)); where.push(`${D} BETWEEN $${params.length - 1}::date AND $${params.length}::date`); }
  if (['pending', 'submitted', 'completed', 'not_done', 'non_functional'].includes(req.query.status)) { params.push(req.query.status); where.push(`o.status = $${params.length}`); }
  const { rows } = await query(
    `SELECT o.*, c.title, c.priority, c.frequency, c.due_time, c.checkpoints, c.assignee_id, c.assigner_id, c.verifier_id,
            c.evidence_required, c.verification_required, c.non_functional_allowed, ${NAMES}
       ${BASE_FROM.replace('FROM checklists c', 'FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id')}
      WHERE ${where.join(' AND ')} ORDER BY o.due_at LIMIT 200`, params);
  const now = new Date();
  const seen = rows.filter((o) => seesAllSubmitted(req.user, o) || !(o.status === 'submitted' && o.verify_on && o.verify_on > today));
  seen.forEach((o) => decorateTurn(o, today, now));
  await attachFiles(seen, 'occurrence');
  res.json({ data: seen });
});

async function loadOcc(db, id, lock = false) {
  const { rows } = await db.query(
    `SELECT o.*, c.title, c.assigner_id, c.assignee_id, c.verifier_id, c.checkpoints, c.evidence_required, c.verification_required,
            c.non_functional_allowed, c.verify_config
       FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id WHERE o.id = $1 ${lock ? 'FOR UPDATE OF o' : ''}`, [id]);
  return rows[0] || null;
}
async function occFor(db, user, id, lock = false) {
  const o = await loadOcc(db, id, lock);
  if (!o || !isInvolved(user, o)) throw notFound('Turn not found');
  return o;
}
async function turnResponse(id) {
  const { rows } = await query(`${TURN_SELECT} WHERE o.id = $1`, [id]);
  const o = decorateTurn(rows[0], todayIST(), new Date());
  await attachFiles([o], 'occurrence');
  return o;
}
const notFuture = (o) => { if (istDate(o.due_at) > todayIST()) throw conflict(FUTURE_MSG); };
const cpCount = (o) => (o.checkpoints || []).length;

router.post('/occurrences/verify-batch', async (req, res) => {
  const clId = needId(req.body.checklist_id, 'Checklist not found');
  const cl = await loadChecklistFor(req.user, clId);
  if (!cl.verification_required || !isVerifier(req.user, cl)) throw forbidden('Only the verifier can verify this checklist');
  const approve = !!req.body.approve;
  const remark = optText(req.body.remark, 500);
  if (!approve && !remark) throw badRequest('Write why they are sent back');
  const ids = Array.isArray(req.body.ids) ? req.body.ids.map(Number).filter(Number.isInteger) : null;
  const n = await withTransaction(async (db) => {
    const params = [clId, todayIST()];
    let extra = '';
    if (ids) { params.push(ids); extra = ' AND id = ANY($3::int[])'; }
    const { rows } = await db.query(
      `SELECT id FROM checklist_occurrences WHERE checklist_id = $1 AND status = 'submitted' AND (verify_on IS NULL OR verify_on <= $2::date)${extra} FOR UPDATE`, params);
    if (!rows.length) return 0;
    const list = rows.map((r) => r.id);
    if (approve)
      await db.query(`UPDATE checklist_occurrences SET status = 'completed', completed_at = NOW(), verified_by = $2, verified_at = NOW(), verify_remark = $3 WHERE id = ANY($1::int[])`, [list, req.user.id, remark]);
    else
      await db.query(
        `UPDATE checklist_occurrences SET status = 'pending', checkpoints_done = '[]'::jsonb, submitted_at = NULL, completed_at = NULL, verify_on = NULL,
                verify_notified = FALSE, reject_count = reject_count + 1, verified_by = $2, verified_at = NOW(), verify_remark = $3 WHERE id = ANY($1::int[])`, [list, req.user.id, remark]);
    return list.length;
  });
  if (n) await notify(cl.assignee_id, {
    kind: 'status', title: `${n} turn(s) ${approve ? 'verified' : 'sent back'}: ${cl.title}`,
    body: remark || `by ${req.user.name}`, link: checklistLink(clId), actor: req.user.name }, req.user.id);
  res.json({ verified: n, approve });
});

router.put('/occurrences/:id/checkpoints', async (req, res) => {
  const id = needId(req.params.id, 'Turn not found');
  await withTransaction(async (db) => {
    const o = await occFor(db, req.user, id, true);
    if (!isAssignee(req.user, o)) throw forbidden('Only the person doing the task can tick its checkpoints');
    if (o.status !== 'pending') throw conflict('This turn is no longer open');
    notFuture(o);
    const done = Array.isArray(req.body.done) ? req.body.done : [];
    await db.query('UPDATE checklist_occurrences SET checkpoints_done = $1::jsonb WHERE id = $2',
      [JSON.stringify(Array.from({ length: cpCount(o) }, (_, i) => done[i] === true)), id]);
  });
  res.json(await turnResponse(id));
});

router.post('/occurrences/:id/complete', async (req, res) => {
  const id = needId(req.params.id, 'Turn not found');
  const note = optText(req.body.note, 1000);
  let toNotify = null;
  const cl = await withTransaction(async (db) => {
    const o = await occFor(db, req.user, id, true);
    if (!isAssignee(req.user, o)) throw forbidden('Only the person doing the task can complete it');
    if (o.status !== 'pending') throw conflict('This turn is already completed or waiting for verification');
    notFuture(o);
    const done = o.checkpoints_done || [];
    if (!(o.checkpoints || []).every((_, i) => done[i] === true)) throw badRequest('Tick every checkpoint first');
    if (o.evidence_required) {
      const n = Number((await db.query("SELECT COUNT(*) FROM task_files WHERE kind = 'occurrence' AND ref_id = $1 AND purpose = 'evidence'", [id])).rows[0].count);
      if (!n) throw badRequest('Upload the evidence first');
    }
    if (!o.verification_required) {
      await db.query("UPDATE checklist_occurrences SET status = 'completed', submitted_at = NOW(), completed_at = NOW(), note = $2, verify_remark = NULL WHERE id = $1", [id, note]);
    } else {
      const verifyOn = nextVerifyFor(o, o.due_at, new Date());
      const now = verifyOn <= todayIST();
      await db.query(
        "UPDATE checklist_occurrences SET status = 'submitted', submitted_at = NOW(), completed_at = NULL, note = $2, verify_remark = NULL, verify_on = $3, verify_notified = $4 WHERE id = $1",
        [id, note, verifyOn, now]);
      if (now) toNotify = verifierOf(o);
    }
    return o;
  });
  if (toNotify) await notify(toNotify, { kind: 'status', title: `Verify the checklist: ${cl.title}`, body: `by ${req.user.name}`, link: checklistLink(cl.checklist_id), actor: req.user.name }, req.user.id);
  res.json(await turnResponse(id));
});

router.post('/occurrences/:id/verify', async (req, res) => {
  const id = needId(req.params.id, 'Turn not found');
  const approve = !!req.body.approve;
  const remark = optText(req.body.remark, 500);
  let newDue = null;
  if (!approve) {
    if (!remark) throw badRequest('Write why it is sent back');
    if (req.body.new_due) {
      newDue = parseDeadline(req.body.new_due);
      if (!newDue) throw badRequest('The new deadline is not valid');
      if (newDue.getTime() < Date.now() - 60000) throw badRequest('The new deadline cannot be in the past');
      await assertNotHoliday(newDue, 'new deadline');
    }
  }
  const o = await withTransaction(async (db) => {
    const t = await occFor(db, req.user, id, true);
    if (!t.verification_required || !isVerifier(req.user, t)) throw forbidden('Only the verifier can verify this turn');
    if (t.status !== 'submitted') throw conflict('This turn is not waiting for verification');
    try {
      if (approve)
        await db.query("UPDATE checklist_occurrences SET status = 'completed', completed_at = NOW(), verified_by = $2, verified_at = NOW(), verify_remark = $3 WHERE id = $1", [id, req.user.id, remark]);
      else
        await db.query(
          `UPDATE checklist_occurrences SET status = 'pending', checkpoints_done = '[]'::jsonb, submitted_at = NULL, completed_at = NULL, verify_on = NULL,
                  verify_notified = FALSE, reject_count = reject_count + 1, verified_by = $2, verified_at = NOW(), verify_remark = $3,
                  due_at = COALESCE($4::timestamptz, due_at), reminders_sent = CASE WHEN $4::timestamptz IS NULL THEN reminders_sent ELSE '[]'::jsonb END
            WHERE id = $1`, [id, req.user.id, remark, newDue]);
    } catch (e) {
      if (e.code === '23505') throw conflict('This checklist already has a turn at that time. Choose another time.');
      throw e;
    }
    return t;
  });
  await notify(o.assignee_id, {
    kind: 'status', title: `Checklist ${approve ? 'verified' : 'sent back'}: ${o.title}`,
    body: `${remark || `by ${req.user.name}`}${newDue ? ` New deadline: ${fmtDateTime(newDue)}` : ''}`,
    link: checklistLink(o.checklist_id), actor: req.user.name }, req.user.id);
  res.json(await turnResponse(id));
});

router.post('/occurrences/:id/non-functional', async (req, res) => {
  const id = needId(req.params.id, 'Turn not found');
  const reason = cleanText(req.body.reason, 500);
  const o = await withTransaction(async (db) => {
    const t = await occFor(db, req.user, id, true);
    if (!t.non_functional_allowed) throw conflict('This checklist does not allow a turn to be marked non-functional');
    if (!isAssignee(req.user, t)) throw forbidden('Only the person doing the task can mark it non-functional');
    if (t.status !== 'pending') throw conflict('This turn is already completed or waiting for verification');
    notFuture(t);
    if (!reason) throw badRequest('Write why the task was non-functional');
    await db.query("UPDATE checklist_occurrences SET status = 'non_functional', non_functional_at = NOW(), non_functional_reason = $2, non_functional_by = $3 WHERE id = $1", [id, reason, req.user.id]);
    return t;
  });
  await notify([o.assigner_id, o.verification_required ? verifierOf(o) : null], {
    kind: 'status', title: `Marked non-functional: ${o.title}`, body: `${req.user.name}: ${reason}`, link: checklistLink(o.checklist_id), actor: req.user.name }, req.user.id);
  res.json(await turnResponse(id));
});

// Needs tasks.revert.edit (checked by the router guard); works on any turn
router.post('/occurrences/:id/revert-non-functional', async (req, res) => {
  const id = needId(req.params.id, 'Turn not found');
  const o = await withTransaction(async (db) => {
    const t = await loadOcc(db, id, true);
    if (!t) throw notFound('Turn not found');
    if (t.status !== 'non_functional') throw conflict('This turn is not marked non-functional');
    await db.query("UPDATE checklist_occurrences SET status = 'pending', non_functional_at = NULL, non_functional_reason = NULL, non_functional_by = NULL WHERE id = $1", [id]);
    return t;
  });
  await notify([o.assignee_id, o.verification_required ? verifierOf(o) : null, o.assigner_id], {
    kind: 'status', title: `Non-functional mark removed: ${o.title}`,
    body: `${req.user.name} put the turn back as pending (it was marked: ${o.non_functional_reason})`,
    link: checklistLink(o.checklist_id), actor: req.user.name }, req.user.id);
  res.json(await turnResponse(id));
});

export default router;
