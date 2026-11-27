// Task Dashboard analysis (spec 15): one classification shared by report, drill-down items and PDFs.
import { query } from '../../config/db.js';
import { visibleSql, posInt } from './common.js';
import { istDate, todayIST, diffDays, addDays, fmtDmy } from '../../utils/ist.js';
import { reportPdf } from '../pdfReport.js';

export const CLASSES = ['on_time', 'late', 'not_done', 'overdue', 'verify', 'open', 'non_functional'];
export const CLASS_LABELS = {
  on_time: 'Work Done', late: 'Work Done But Not On Time', not_done: 'Work Not Done', overdue: 'Overdue',
  verify: 'Pending verification', open: 'Not due yet', non_functional: 'Non functional',
};
export const AGE_BUCKETS = [
  { key: 'age_1', label: '1 day or less', min: 0, max: 1 },
  { key: 'age_2_3', label: '2–3 days', min: 2, max: 3 },
  { key: 'age_4_7', label: '4–7 days', min: 4, max: 7 },
  { key: 'age_8', label: 'More than 7 days', min: 8, max: Infinity },
];
const round1 = (n) => Math.round(n * 10) / 10;
const NO_DEPT = 'No department';

// ---------------- pure classification ----------------
export const doneAt = (r) => r.submitted_at || r.completed_at;

/** on_time | late | not_done | verify | overdue | open | non_functional */
export function classify(r, now = new Date()) {
  if (r.status === 'non_functional') return 'non_functional';
  if (r.status === 'not_done') return 'not_done';
  if (r.status === 'submitted') return 'verify';
  if (r.status === 'completed') return new Date(doneAt(r) || r.due_at) <= new Date(r.due_at) ? 'on_time' : 'late';
  return new Date(r.due_at) < now ? 'overdue' : 'open';
}

/** Delay in IST days: late = done day − due day; overdue = today − due day; else 0. */
export function delayDays(r, cls, now = new Date()) {
  if (cls === 'late') return Math.max(0, diffDays(istDate(doneAt(r) || r.due_at), istDate(r.due_at)));
  if (cls === 'overdue') return Math.max(0, diffDays(istDate(now), istDate(r.due_at)));
  return 0;
}

export const prepare = (rows, now = new Date()) =>
  rows.map((r) => {
    const cls = classify(r, now);
    return { ...r, cls, delay: delayDays(r, cls, now), open_id: `${r.kind}${r.task_id}` };
  });

const emptyCounts = () => ({ on_time: 0, late: 0, not_done: 0, overdue: 0, verify: 0, open: 0, non_functional: 0 });

/** Numbers for one kind (or any set) of prepared rows. non_functional is excluded from total/percentages. */
export function summarize(rows) {
  const c = emptyCounts();
  let delaySum = 0;
  let delayN = 0;
  for (const r of rows) {
    c[r.cls] += 1;
    if (r.cls === 'late' || r.cls === 'overdue') { delaySum += r.delay; delayN += 1; }
  }
  const total = CLASSES.reduce((a, k) => a + (k === 'non_functional' ? 0 : c[k]), 0);
  const due = total - c.open;
  const pc = (n) => (due > 0 ? round1((n / due) * 100) : 0);
  const done = c.on_time + c.late + c.verify;
  return {
    total, ...c, due, avg_delay: delayN ? round1(delaySum / delayN) : 0,
    pct: {
      on_time: pc(c.on_time), late: pc(c.late), not_done: pc(c.not_done), overdue: pc(c.overdue),
      done: pc(done), negative: pc(c.late + c.not_done + c.overdue),
    },
    compliance: pc(done),
  };
}

const group = (rows, keyFn) => {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    (m.get(k) || m.set(k, []).get(k)).push(r);
  }
  return m;
};

export const itemOf = (r) => ({
  kind: r.kind, task_id: r.task_id, occ_id: r.occ_id, open: r.open_id, title: r.title, category: r.category || null,
  assignee_id: r.assignee_id, doer: r.assignee_name, due_at: r.due_at, cls: r.cls, label: CLASS_LABELS[r.cls], days: r.delay,
});

const rating = (s) => (s.due < 3 ? 'few' : s.pct.on_time >= 80 ? 'good' : s.pct.on_time >= 60 ? 'average' : 'attention');

/**
 * Full dashboard analysis. rows = prepared rows in the period, ageRows = prepared currently-overdue rows (period ignored).
 */
export function analyze(rows, ageRows) {
  const d = rows.filter((r) => r.kind === 'd');
  const c = rows.filter((r) => r.kind === 'c');

  // trend: per IST due day, per kind, per class (last 62 days of the period)
  const days = [...new Set(rows.map((r) => istDate(r.due_at)))].sort();
  const trend = days.slice(-62).map((date) => ({ date, d: emptyCounts(), c: emptyCounts() }));
  const tIdx = new Map(trend.map((t) => [t.date, t]));
  for (const r of rows) {
    const t = tIdx.get(istDate(r.due_at));
    if (t) t[r.kind][r.cls] += 1;
  }

  const ageing = AGE_BUCKETS.map((b) => {
    const inB = ageRows.filter((r) => r.delay >= b.min && r.delay <= b.max);
    return { key: b.key, label: b.label, delegations: inB.filter((r) => r.kind === 'd').length, checklists: inB.filter((r) => r.kind === 'c').length };
  });
  const most_delayed = [...ageRows].sort((a, b) => b.delay - a.delay || new Date(a.due_at) - new Date(b.due_at)).slice(0, 5).map(itemOf);

  const missed = rows.filter((r) => r.cls === 'not_done' || r.cls === 'overdue');
  const top_missed = [...group(missed, (r) => r.open_id)].map(([k, rs]) => ({
    open: k, kind: rs[0].kind, task_id: rs[0].task_id, title: rs[0].title, doer: rs[0].assignee_name, count: rs.length,
  })).sort((a, b) => b.count - a.count).slice(0, 5);

  // per doer (open turns excluded)
  const people = [...group(rows.filter((r) => r.cls !== 'open' && r.cls !== 'non_functional'), (r) => r.assignee_id)].map(([id, rs]) => {
    const s = summarize(rs);
    return { id, name: rs[0].assignee_name, department: rs[0].department, tasks: s.total, on_time: s.on_time, misses: s.not_done + s.overdue, on_time_pct: s.pct.on_time };
  });
  const max_misses = people.filter((p) => p.misses > 0).sort((a, b) => b.misses - a.misses).slice(0, 5);
  const eligible = people.filter((p) => p.tasks >= 3);
  const top_performers = [...eligible].sort((a, b) => b.on_time_pct - a.on_time_pct || b.tasks - a.tasks).slice(0, 3);
  const needs_attention = eligible.filter((p) => p.on_time_pct < 100).sort((a, b) => a.on_time_pct - b.on_time_pct || b.tasks - a.tasks).slice(0, 3);

  // departments
  const departments = [...group(rows, (r) => r.department)].map(([name, rs]) => {
    const s = summarize(rs);
    const delay_days = rs.reduce((a, r) => a + r.delay, 0);
    const missedBy = [...group(rs.filter((r) => r.cls === 'not_done' || r.cls === 'overdue'), (r) => r.open_id)]
      .map(([, x]) => ({ title: x[0].title, count: x.length })).filter((x) => x.count >= 2).sort((a, b) => b.count - a.count);
    return {
      department: name, total: s.total, on_time: s.on_time, late: s.late, not_done: s.not_done, overdue: s.overdue, verify: s.verify, open: s.open,
      due: s.due, on_time_pct: s.pct.on_time, delay_days, avg_delay: s.avg_delay, rejects: rs.reduce((a, r) => a + (r.reject_count || 0), 0),
      compliance: summarize(rs.filter((r) => r.kind === 'c')).compliance, repeated_misses: missedBy.length, top_repeated: missedBy[0] || null,
      rating: rating(s),
    };
  }).sort((a, b) => (a.rating === 'few') - (b.rating === 'few') || b.on_time_pct - a.on_time_pct || (a.not_done + a.overdue) - (b.not_done + b.overdue));
  const rated = departments.filter((x) => x.rating !== 'few');

  return {
    delegation: summarize(d), checklist: summarize(c), trend, ageing, most_delayed, top_missed, max_misses, top_performers, needs_attention,
    departments, best_department: rated[0] || null, weakest_department: rated.length > 1 ? rated[rated.length - 1] : null,
  };
}

// ---------------- loading ----------------
const BASE = `
WITH t AS (
  SELECT 'd'::text AS kind, d.id AS task_id, d.id AS occ_id, d.title, d.category_id, d.priority, d.assignee_id, d.assigner_id, d.verifier_id,
         d.deadline AS due_at, d.status, d.submitted_at, d.completed_at, NULL::timestamptz AS not_done_at, d.verification_required,
         d.reject_count, d.created_at, d.verified_at, NULL::text AS nf_reason
    FROM delegations d
  UNION ALL
  SELECT 'c', c.id, o.id, c.title, c.category_id, c.priority, c.assignee_id, c.assigner_id, c.verifier_id,
         o.due_at, o.status, o.submitted_at, o.completed_at, o.not_done_at, c.verification_required,
         o.reject_count, c.created_at, o.verified_at, o.non_functional_reason
    FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id WHERE c.active
)
SELECT t.*, u.name AS assignee_name, COALESCE(NULLIF(BTRIM(u.department), ''), '${NO_DEPT}') AS department, tc.name AS category
  FROM t JOIN users u ON u.id = t.assignee_id LEFT JOIN task_categories tc ON tc.id = t.category_id`;

const isYmd = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

/** Parse query filters. Dates are IST calendar days; default period = today. */
export function parseFilters(q = {}) {
  const today = todayIST();
  let from = isYmd(q.from) ? q.from : today;
  let to = isYmd(q.to) ? q.to : isYmd(q.from) ? q.from : today;
  if (to < from) [from, to] = [to, from];
  return {
    from, to, doer: posInt(q.doer), category: posInt(q.category), department: String(q.department || '').trim() || null,
    kind: q.kind === 'delegation' || q.kind === 'checklist' ? q.kind : null, search: String(q.search || '').trim().slice(0, 100) || null,
  };
}

/** opts: period (default true), overdueOnly (open past due, for ageing), forceAssignee (restrict to this user id) */
export async function loadRows(user, f, { period = true, overdueOnly = false, forceAssignee = null } = {}) {
  const params = [];
  const p = (v) => (params.push(v), `$${params.length}`);
  const w = [visibleSql(user, 'all', 't', params)];
  if (period) w.push(`(t.due_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${p(f.from)}::date AND ${p(f.to)}::date`);
  if (overdueOnly) w.push(`t.status = 'pending' AND t.due_at < NOW()`);
  if (forceAssignee) w.push(`t.assignee_id = ${p(forceAssignee)}`);
  else if (f.doer) w.push(`t.assignee_id = ${p(f.doer)}`);
  if (f.category) w.push(`t.category_id = ${p(f.category)}`);
  if (f.kind) w.push(`t.kind = ${p(f.kind === 'delegation' ? 'd' : 'c')}`);
  if (f.department) w.push(f.department === NO_DEPT ? `COALESCE(NULLIF(BTRIM(u.department), ''), '') = ''` : `BTRIM(u.department) = ${p(f.department)}`);
  if (f.search) w.push(`t.title ILIKE ${p(`%${f.search.replace(/[%_\\]/g, '\\$&')}%`)}`);
  const { rows } = await query(`${BASE} WHERE ${w.join(' AND ')} ORDER BY t.due_at DESC`, params);
  return prepare(rows);
}

export async function buildReport(user, q) {
  const f = parseFilters(q);
  const [rows, age] = await Promise.all([loadRows(user, f), loadRows(user, f, { period: false, overdueOnly: true })]);
  return { filters: f, period: { from: f.from, to: f.to }, rows, age, ...analyze(rows, age) };
}

// ---------------- drill-down ----------------
const METRIC_TITLES = {
  total: 'All tasks', on_time: CLASS_LABELS.on_time, late: CLASS_LABELS.late, not_done: CLASS_LABELS.not_done, overdue: 'Currently overdue / Delayed',
  verify: CLASS_LABELS.verify, non_functional: 'Non functional (not counted)',
};
export function itemsFor(metric, rows, age) {
  const m = /^(d|c)_(total|on_time|late|not_done|overdue|verify|non_functional)$/.exec(metric || '');
  let list;
  let title;
  if (m) {
    const kindName = m[1] === 'd' ? 'Delegations' : 'Checklists';
    list = rows.filter((r) => r.kind === m[1] && (m[2] === 'total' ? r.cls !== 'non_functional' : r.cls === m[2]));
    title = `${kindName} · ${METRIC_TITLES[m[2]]}`;
  } else {
    const b = AGE_BUCKETS.find((x) => x.key === metric);
    if (!b) return null;
    list = age.filter((r) => r.delay >= b.min && r.delay <= b.max);
    title = `Overdue ageing · ${b.label}`;
  }
  list = [...list].sort((a, b) => new Date(b.due_at) - new Date(a.due_at)).slice(0, 200);
  return { metric, title, data: list.map(itemOf) };
}

// ---------------- PDFs ----------------
const pct = (n) => `${n}%`;
function analysisTable(title, s) {
  return {
    title,
    columns: ['Measure', 'Value'],
    rows: [
      ['Total', s.total], ['Done on time', `${s.on_time} (${pct(s.pct.on_time)})`], ['Done late', `${s.late} (${pct(s.pct.late)})`],
      ['Work not done', `${s.not_done} (${pct(s.pct.not_done)})`], ['Overdue / Delayed', `${s.overdue} (${pct(s.pct.overdue)})`],
      ['Pending verification', s.verify], ['Not due yet', s.open], ['Average delay', `${s.avg_delay} day(s)`], ['Compliance', pct(s.compliance)],
    ],
  };
}
const periodText = (f) => (f.from === f.to ? fmtDmy(f.from) : `${fmtDmy(f.from)} to ${fmtDmy(f.to)}`);
const fileSuffix = (f) => (f.from === f.to ? `-from-${f.from}` : `-from-${f.from}-to-${f.to}`);

export async function filterText(f) {
  const bits = [periodText(f)];
  if (f.doer) bits.push(`Doer: ${(await query('SELECT name FROM users WHERE id = $1', [f.doer])).rows[0]?.name || f.doer}`);
  if (f.department) bits.push(`Department: ${f.department}`);
  if (f.category) bits.push(`Category: ${(await query('SELECT name FROM task_categories WHERE id = $1', [f.category])).rows[0]?.name || f.category}`);
  if (f.kind) bits.push(f.kind === 'delegation' ? 'Delegations' : 'Checklists');
  if (f.search) bits.push(`Search: ${f.search}`);
  return bits.join(' · ');
}

const sectionBlocks = (a, { heading, pageBreak } = {}) => [
  { ...(heading ? { heading, pageBreak } : {}), ...analysisTable('Delegation Analysis', a.delegation) },
  analysisTable('Checklist Analysis', a.checklist),
  { title: 'Overdue Ageing', columns: ['Age', 'Delegations', 'Checklists'], rows: a.ageing.map((x) => [x.label, x.delegations, x.checklists]) },
  {
    title: 'Top Missed Tasks (Work Not Done + Overdue)', columns: ['Task', 'Type', 'Doer', 'Times missed'],
    rows: a.top_missed.map((x) => [x.title, x.kind === 'd' ? 'Delegation' : 'Checklist', x.doer, x.count]),
  },
  {
    title: 'Most Delayed Tasks', columns: ['Task', 'Doer', 'Due', 'Days overdue'],
    rows: a.most_delayed.map((x) => [x.title, x.doer, fmtDmy(x.due_at), x.days]),
  },
];

export async function dashboardPdf(user, q) {
  const r = await buildReport(user, q);
  const blocks = sectionBlocks(r);
  blocks.splice(2, 0, {
    title: 'Department-wise', columns: ['Department', 'Tasks', 'On time %', 'Late', 'Not done', 'Overdue days', 'Repeated misses', 'Rejected', 'Compliance', 'Rating'],
    rows: r.departments.map((x) => [x.department, x.total, pct(x.on_time_pct), x.late, x.not_done, x.delay_days, x.repeated_misses, x.rejects, pct(x.compliance), x.rating === 'few' ? 'Not rated' : x.rating]),
  });
  const peopleRows = (list) => list.map((x) => [x.name, x.department, x.tasks, x.misses, pct(x.on_time_pct)]);
  const cols = ['Person', 'Department', 'Tasks due', 'Misses', 'On time %'];
  blocks.push(
    { title: 'Employees with Maximum Misses', columns: cols, rows: peopleRows(r.max_misses) },
    { title: 'Top Performers', columns: cols, rows: peopleRows(r.top_performers) },
    { title: 'Needs Attention', columns: cols, rows: peopleRows(r.needs_attention) },
  );
  const buf = await reportPdf({ title: 'Task Dashboard', subtitle: await filterText(r.filters), blocks });
  return { buf, filename: `task-dashboard${fileSuffix(r.filters)}.pdf` };
}

export async function peoplePdf(user, q) {
  const r = await buildReport(user, q);
  const byPerson = group(r.rows, (x) => x.assignee_id);
  const ageBy = group(r.age, (x) => x.assignee_id);
  const people = [...byPerson].map(([id, rs]) => ({ id, name: rs[0].assignee_name, department: rs[0].department, s: summarize(rs), rs }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const blocks = [{
    title: 'All people', columns: ['Person', 'Department', 'Tasks', 'On time', 'Late', 'Not done', 'Overdue', 'Pending verif.', 'On time %'],
    rows: people.map((p) => [p.name, p.department, p.s.total, p.s.on_time, p.s.late, p.s.not_done, p.s.overdue, p.s.verify, pct(p.s.pct.on_time)]),
  }];
  for (const p of people) {
    if (!p.s.total) continue;
    const a = analyze(p.rs, ageBy.get(p.id) || []);
    const mine = sectionBlocks(a, { heading: p.name, pageBreak: true });
    mine[0].note = `${p.department} · ${p.s.total} tasks`;
    blocks.push(...mine);
  }
  const buf = await reportPdf({ title: 'Task Dashboard · Person-wise Reports', subtitle: await filterText(r.filters), blocks });
  return { buf, filename: `task-reports-all-people${fileSuffix(r.filters)}.pdf` };
}
