// Performance scoring (spec 16). One calculation shared by GET /score and /score/pdf.
import { query } from '../../config/db.js';
import { perms } from './common.js';
import { loadRows, parseFilters, doneAt, filterText } from './report.js';
import { fmtDmy, fmtDateTime } from '../../utils/ist.js';
import { reportPdf } from '../pdfReport.js';

const neg = (n) => (n ? `-${n}` : '0');
export const PENALTY = { Low: 1, Medium: 1, High: 2, Urgent: 3 };
export const PRIORITY_ORDER = ['Urgent', 'High', 'Medium', 'Low'];
export const FORMULA = 'Final score = marks earned (+1 for every task done, on time or late) + negative marks (Low −1, Medium −1, High −2, Urgent −3 for every task done late or not done). Percentages are based on the tasks already due; non-functional and not-due-yet tasks are not scored.';
const round1 = (n) => Math.round(n * 10) / 10;
const penaltyOf = (p) => PENALTY[p] ?? 1;

/** on_time | late | not_done | open | non_functional (completed/submitted count as done). */
export function scoreStatus(r, now = new Date()) {
  if (r.status === 'non_functional') return 'non_functional';
  if (r.status === 'not_done') return 'not_done';
  if (r.status === 'completed' || r.status === 'submitted') return new Date(doneAt(r) || r.due_at) <= new Date(r.due_at) ? 'on_time' : 'late';
  return new Date(r.due_at) < now ? 'not_done' : 'open';
}

export const STATUS_LABELS = { on_time: 'Work Done', late: 'Work Done But Not On Time', not_done: 'Work Not Done', open: 'Not due yet', non_functional: 'Non functional' };
const marks = (n) => `${n} mark${n === 1 ? '' : 's'}`;

export function verificationText(r) {
  let t;
  if (!r.verification_required) t = 'Not required';
  else if (r.status === 'submitted') t = 'Pending verification';
  else if (r.status === 'completed') t = r.verified_at ? 'Verified' : 'Completed';
  else t = 'Waiting for the work';
  return r.reject_count ? `${t} · rejected ${r.reject_count} time${r.reject_count === 1 ? '' : 's'}` : t;
}

/** Score one task row. `priority` = the FIRST priority (before any change). */
export function scoreTask(r, priority, now = new Date()) {
  const status = scoreStatus(r, now);
  const pen = penaltyOf(priority);
  const base = status === 'on_time' || status === 'late' ? 1 : 0;
  const deduction = status === 'late' || status === 'not_done' ? -pen : 0;
  let reason;
  if (status === 'on_time') reason = 'Done on time: no deduction';
  else if (status === 'late') reason = `Done after the deadline (${priority} priority): -${marks(pen)}`;
  else if (status === 'not_done') {
    reason = `${r.status === 'not_done' ? 'Not done (the turn was closed as missed)' : 'Not done (still pending after the deadline)'} (${priority} priority): -${marks(pen)}`;
  } else if (status === 'open') reason = 'Not due yet: not scored';
  else reason = `Marked non-functional: ${r.nf_reason || '—'}: not scored, kept as a separate record`;
  return { status, priority, base, deduction, score: base + deduction, reason };
}

/** Totals for a list of scored tasks ({status, priority, base, deduction}). Percentages are negative (0 when nothing is due). */
export function summarizeScore(tasks) {
  const s = { assigned: 0, due: 0, on_time: 0, late: 0, not_done: 0, open: 0, non_functional: 0, earned: 0, negative: 0, max_marks: 0, late_deducted: 0, not_done_deducted: 0 };
  const by = Object.fromEntries(PRIORITY_ORDER.map((p) => [p, { priority: p, penalty: PENALTY[p], assigned: 0, max: 0, deducted: 0, not_done: 0, late: 0 }]));
  for (const t of tasks) {
    s[t.status] += 1;
    if (t.status === 'non_functional') continue;
    s.assigned += 1;
    const b = by[t.priority] || by.Medium;
    b.assigned += 1;
    if (t.status === 'open') continue;
    s.due += 1;
    s.earned += t.base;
    s.negative += t.deduction;
    const pen = penaltyOf(t.priority);
    s.max_marks += pen;
    b.max += pen;
    if (t.status === 'late') { b.late += 1; b.deducted += pen; s.late_deducted += pen; }
    if (t.status === 'not_done') { b.not_done += 1; b.deducted += pen; s.not_done_deducted += pen; }
  }
  s.done = s.on_time + s.late;
  s.final = s.earned + s.negative;
  s.percent = s.due ? round1((s.final / s.due) * 100) : 0;
  s.late_pct = s.max_marks ? round1(-(s.late_deducted / s.max_marks) * 100) : 0;
  s.not_done_pct = s.max_marks ? round1(-(s.not_done_deducted / s.max_marks) * 100) : 0;
  s.negative_pct = round1(s.late_pct + s.not_done_pct);
  s.by_priority = PRIORITY_ORDER.map((p) => by[p]);
  s.total_deducted = s.late_deducted + s.not_done_deducted;
  return s;
}

/** Score summaries for delegation / checklist / combined from scored tasks (each has .kind 'd'|'c'). */
export const summaries = (tasks) => ({
  delegation: summarizeScore(tasks.filter((t) => t.kind === 'd')),
  checklist: summarizeScore(tasks.filter((t) => t.kind === 'c')),
  combined: summarizeScore(tasks),
});

// ---------------- loading ----------------
const normKind = (k) => (k === 'checklist' || k === 'c' ? 'c' : 'd');

async function firstPriorities(rows) {
  const ids = [...new Set(rows.map((r) => r.task_id))];
  if (!ids.length) return new Map();
  const { rows: logs } = await query(
    `SELECT DISTINCT ON (kind, task_id) kind, task_id, old_priority FROM task_priority_log WHERE task_id = ANY($1::int[]) ORDER BY kind, task_id, id`, [ids]);
  return new Map(logs.map((l) => [`${normKind(l.kind)}${l.task_id}`, l.old_priority]));
}

async function auditRows(tasks) {
  const ids = [...new Set(tasks.map((t) => t.task_id))];
  if (!ids.length) return [];
  const titles = new Map(tasks.map((t) => [`${t.kind}${t.task_id}`, t.title]));
  const [pl, dr] = await Promise.all([
    query(`SELECT l.kind, l.task_id, l.old_priority, l.new_priority, l.at, u.name AS by_name FROM task_priority_log l LEFT JOIN users u ON u.id = l.by_user_id WHERE l.task_id = ANY($1::int[])`, [ids]),
    query(`SELECT r.delegation_id AS task_id, r.source, r.old_deadline, r.new_deadline, r.reason, r.decided_at, r.created_at,
                  COALESCE(CASE WHEN r.source = 'request' THEN ud.name END, ur.name) AS by_name
             FROM deadline_revisions r LEFT JOIN users ur ON ur.id = r.requested_by LEFT JOIN users ud ON ud.id = r.decided_by
            WHERE r.status = 'approved' AND r.delegation_id = ANY($1::int[])`, [ids]),
  ]);
  const out = [];
  for (const l of pl.rows) {
    const key = `${normKind(l.kind)}${l.task_id}`;
    if (titles.has(key)) out.push({ at: l.at, task: titles.get(key), module: normKind(l.kind) === 'd' ? 'Delegation' : 'Checklist', change: 'Priority', from: l.old_priority, to: l.new_priority, by: l.by_name || '—', note: 'Marks use the first priority' });
  }
  for (const r of dr.rows) {
    const key = `d${r.task_id}`;
    if (titles.has(key)) out.push({ at: r.decided_at || r.created_at, task: titles.get(key), module: 'Delegation', change: 'Deadline', from: fmtDateTime(r.old_deadline, true), to: fmtDateTime(r.new_deadline, true), by: r.by_name || '—', note: r.reason || r.source });
  }
  return out.sort((a, b) => new Date(a.at) - new Date(b.at));
}

/** Scored task rows — the single calculation behind the screen and the PDF. */
async function scoredTasks(user, q) {
  const f = { ...parseFilters(q), kind: null };
  const allData = perms(user).allView;
  const doer = allData ? f.doer : user.id;
  const rows = await loadRows(user, { ...f, doer }, { forceAssignee: allData ? null : user.id });
  const first = await firstPriorities(rows);
  const now = new Date();
  const tasks = rows.map((r) => {
    const priority = first.get(r.open_id) || r.priority;
    const sc = scoreTask(r, priority, now);
    return {
      kind: r.kind, task_id: r.task_id, occ_id: r.occ_id, open: r.open_id, assignee_id: r.assignee_id, doer: r.assignee_name, department: r.department,
      title: r.title, module: r.kind === 'd' ? 'Delegation' : 'Checklist', assigned_at: r.created_at, due_at: r.due_at,
      completed_at: sc.status === 'on_time' || sc.status === 'late' ? doneAt(r) : null, priority, current_priority: r.priority,
      status: sc.status, status_label: STATUS_LABELS[sc.status], verification: verificationText(r),
      base: sc.base, deduction: sc.deduction, score: sc.score, reason: sc.reason,
    };
  }).sort((a, b) => new Date(a.due_at) - new Date(b.due_at));
  return { f, doer, tasks };
}

/**
 * Build the score. Without all-data (tasks_all view) a person only gets their own score.
 * The kind filter is ignored: delegations and checklists are always both included.
 * withTasks: also return tasks/audit in 'all' mode (used by the PDF).
 */
export async function buildScore(user, q, { withTasks = false } = {}) {
  const { f, doer, tasks } = await scoredTasks(user, q);
  const base = { period: { from: f.from, to: f.to }, formula: FORMULA, filters: f };
  if (doer) {
    const person = { id: doer, name: tasks[0]?.doer || (await query('SELECT name FROM users WHERE id = $1', [doer])).rows[0]?.name || '' };
    return { ...base, mode: 'person', person, ...summaries(tasks), tasks, audit: await auditRows(tasks) };
  }
  const byPerson = new Map();
  for (const t of tasks) (byPerson.get(t.assignee_id) || byPerson.set(t.assignee_id, []).get(t.assignee_id)).push(t);
  const people = [...byPerson].map(([id, ts]) => {
    const s = summaries(ts);
    return { id, name: ts[0].doer, department: ts[0].department, ...s, earned: s.combined.earned, negative: s.combined.negative, final: s.combined.final, negative_pct: s.combined.negative_pct, due: s.combined.due };
  }).sort((a, b) => b.final - a.final || a.name.localeCompare(b.name));
  return { ...base, mode: 'all', totals: summaries(tasks), people, ...(withTasks ? { tasks, audit: await auditRows(tasks) } : {}) };
}

// ---------------- PDF ----------------
const slug = (s) => String(s || '').trim().replace(/[^\w]+/g, '-').replace(/^-|-$/g, '');

function personBlocks(name, tasks, audit, sums, { first }) {
  const { delegation: d, checklist: c, combined: t } = sums;
  const row = (label, fn) => [label, fn(d), fn(c), fn(t)];
  const n = (k) => (s) => s[k];
  const blocks = [
    {
      heading: name, pageBreak: !first, note: `${t.assigned} tasks`, title: 'Performance Summary', columns: ['Measure', 'Delegation', 'Checklist', 'Combined'],
      rows: [
        row('Tasks assigned', n('assigned')), row('Work done (on time)', n('on_time')), row('Work done but not on time', n('late')), row('Work not done', n('not_done')),
        row('Non functional (not scored)', n('non_functional')), row('Not due yet', n('open')), row('Marks earned', n('earned')), row('Negative marks', n('negative')),
        row('Maximum marks', n('max_marks')), row('Late negative %', (s) => `${s.late_pct}%`), row('Not-done negative %', (s) => `${s.not_done_pct}%`),
        row('TOTAL NEGATIVE PERFORMANCE %', (s) => `${s.negative_pct}%`), row('FINAL PERFORMANCE SCORE', (s) => `${s.final} (${s.percent}%)`),
      ],
    },
    {
      title: 'Priority-wise Marks Deducted', columns: ['Priority', 'Per miss', 'Max marks', 'Work not done', 'Done but not on time', 'Total deducted'],
      rows: [...t.by_priority.map((p) => [p.priority, `-${p.penalty}`, p.max, p.not_done, p.late, neg(p.deducted)]), ['TOTAL', '', t.max_marks, t.not_done, t.late, neg(t.total_deducted)]],
    },
    {
      title: 'Task-wise Scoring Details', columns: ['Task', 'Module', 'Due', 'Completed', 'Priority', 'Status', 'Verification', 'Base', 'Deduction', 'Score', 'Reason'],
      rows: [
        ...tasks.map((x) => [x.title, x.module, fmtDateTime(x.due_at, true), x.completed_at ? fmtDateTime(x.completed_at, true) : '', x.priority, x.status_label, x.verification, x.base, x.deduction, x.score, x.reason]),
        ['TOTAL', '', '', '', '', '', '', t.earned, t.negative, t.final, ''],
      ],
    },
  ];
  if (audit.length) {
    blocks.push({ title: 'Audit · changes that can affect marks', columns: ['When', 'Task', 'Change', 'From', 'To', 'By', 'Note'], rows: audit.map((a) => [fmtDateTime(a.at, true), a.task, a.change, a.from, a.to, a.by, a.note]) });
  }
  return blocks;
}

export async function scorePdf(user, q) {
  const r = await buildScore(user, q, { withTasks: true });
  const sub = await filterText({ ...r.filters, kind: null });
  const blocks = [];
  let nameForFile = '';
  if (r.mode === 'person') {
    nameForFile = r.person.name;
    blocks.push(...personBlocks(r.person.name, r.tasks, r.audit, r, { first: true }));
  } else {
    r.people.forEach((p, i) => {
      const ts = r.tasks.filter((t) => t.assignee_id === p.id);
      const titles = new Set(ts.map((t) => t.title));
      blocks.push(...personBlocks(p.name, ts, r.audit.filter((a) => titles.has(a.task)), p, { first: i === 0 }));
    });
  }
  const buf = await reportPdf({ title: 'Employee Performance Scoring Report', subtitle: sub, blocks });
  const f = r.filters;
  const range = f.from === f.to ? `-from-${f.from}` : `-from-${f.from}-to-${f.to}`;
  return { buf, filename: `performance-scoring${nameForFile ? `-${slug(nameForFile)}` : ''}${range}.pdf` };
}

export { fmtDmy };
