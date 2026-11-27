// PC Dashboard (spec 17) and the personal dashboard counters (spec 13 GET /dashboard).
import { query } from '../../config/db.js';
import { posInt } from './common.js';
import { todayIST, istDate, diffDays, mondayOf, addDays } from '../../utils/ist.js';

const NO_DEPT = 'No department';
const PRIO_RANK = { Urgent: 0, High: 1, Medium: 2, Low: 3 };

/** Pure: build the PC response from pending rows (one per delegation / per pending turn). */
export function buildPc(rows, f, now = new Date()) {
  const today = istDate(now);
  const prepared = rows.map((r) => ({ ...r, dueDay: istDate(r.due_at), delayed: new Date(r.due_at) < now }))
    .filter((r) => r.dueDay <= today)
    .filter((r) => (f.show === 'delayed' ? r.delayed : f.show === 'today' ? r.dueDay === today : true));

  // one row per delegation; one row per checklist grouping its pending turns
  const groups = new Map();
  for (const r of prepared) {
    const k = `${r.kind}${r.task_id}`;
    let g = groups.get(k);
    if (!g) {
      g = { kind: r.kind, id: r.task_id, open: k, title: r.title, category: r.category || null, priority: r.priority, frequency: r.frequency || null,
        assignee_id: r.assignee_id, doer: r.assignee_name, department: r.department, assigner: r.assigner_name, due_at: r.due_at, turns: 0, delayed_turns: 0, today_turns: 0, oldest_delayed_day: null };
      groups.set(k, g);
    }
    g.turns += 1;
    if (new Date(r.due_at) < new Date(g.due_at)) g.due_at = r.due_at;
    if (r.delayed) { g.delayed_turns += 1; if (!g.oldest_delayed_day || r.dueDay < g.oldest_delayed_day) g.oldest_delayed_day = r.dueDay; }
    if (r.dueDay === today) g.today_turns += 1;
  }
  const all = [...groups.values()].map(({ oldest_delayed_day: od, ...g }) => ({ ...g, delayed: g.delayed_turns > 0, late_days: od ? Math.max(0, diffDays(today, od)) : 0 }));

  // doers ignore the doer filter
  const dm = new Map();
  for (const g of all) {
    const d = dm.get(g.assignee_id) || dm.set(g.assignee_id, { id: g.assignee_id, name: g.doer, department: g.department, tasks: 0, delayed: 0, delayed_delegations: 0, today: 0, oldest_days: 0 }).get(g.assignee_id);
    d.tasks += 1;
    if (g.delayed) { d.delayed += 1; if (g.kind === 'd') d.delayed_delegations += 1; }
    if (g.today_turns) d.today += 1;
    d.oldest_days = Math.max(d.oldest_days, g.late_days);
  }
  const doers = [...dm.values()].sort((a, b) => b.oldest_days - a.oldest_days || b.delayed - a.delayed || a.name.localeCompare(b.name));

  const tasks = all.filter((g) => !f.doer || g.assignee_id === f.doer)
    .sort((a, b) => b.late_days - a.late_days || (PRIO_RANK[a.priority] ?? 9) - (PRIO_RANK[b.priority] ?? 9) || new Date(a.due_at) - new Date(b.due_at))
    .slice(0, 1000);

  const summary = {
    tasks: all.length, delayed_tasks: all.filter((g) => g.delayed).length, doers: doers.length, doers_delayed: doers.filter((d) => d.delayed > 0).length,
    oldest_days: all.reduce((m, g) => Math.max(m, g.late_days), 0), today: all.reduce((a, g) => a + g.today_turns, 0),
  };
  return { summary, doers, tasks };
}

export async function getPc(q) {
  const f = {
    show: ['dues', 'delayed', 'today'].includes(q.show) ? q.show : 'dues', doer: posInt(q.doer), category: posInt(q.category),
    department: String(q.department || '').trim() || null, kind: q.kind === 'delegation' || q.kind === 'checklist' ? q.kind : null,
    priority: ['Low', 'Medium', 'High', 'Urgent'].includes(q.priority) ? q.priority : null, search: String(q.search || '').trim().slice(0, 100) || null,
  };
  const params = [];
  const p = (v) => (params.push(v), `$${params.length}`);
  const w = [];
  if (f.category) w.push(`t.category_id = ${p(f.category)}`);
  if (f.kind) w.push(`t.kind = ${p(f.kind === 'delegation' ? 'd' : 'c')}`);
  if (f.priority) w.push(`t.priority = ${p(f.priority)}`);
  if (f.department) w.push(f.department === NO_DEPT ? `COALESCE(NULLIF(BTRIM(u.department), ''), '') = ''` : `BTRIM(u.department) = ${p(f.department)}`);
  if (f.search) w.push(`t.title ILIKE ${p(`%${f.search.replace(/[%_\\]/g, '\\$&')}%`)}`);
  w.push(`(t.due_at AT TIME ZONE 'Asia/Kolkata')::date <= ${p(todayIST())}::date`);
  const { rows } = await query(
    `WITH t AS (
       SELECT 'd'::text AS kind, d.id AS task_id, d.title, d.category_id, d.priority, d.assignee_id, d.assigner_id, d.deadline AS due_at, NULL::text AS frequency
         FROM delegations d WHERE d.status = 'pending'
       UNION ALL
       SELECT 'c', c.id, c.title, c.category_id, c.priority, c.assignee_id, c.assigner_id, o.due_at, c.frequency
         FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id WHERE c.active AND o.status = 'pending'
     )
     SELECT t.*, u.name AS assignee_name, COALESCE(NULLIF(BTRIM(u.department), ''), '${NO_DEPT}') AS department, ua.name AS assigner_name, tc.name AS category
       FROM t JOIN users u ON u.id = t.assignee_id LEFT JOIN users ua ON ua.id = t.assigner_id LEFT JOIN task_categories tc ON tc.id = t.category_id
      WHERE ${w.join(' AND ')}`,
    params
  );
  const out = buildPc(rows, f);
  const { rows: deps } = await query(
    `SELECT DISTINCT COALESCE(NULLIF(BTRIM(department), ''), '${NO_DEPT}') AS d FROM users WHERE is_active ORDER BY 1`);
  return { show: f.show, ...out, departments: deps.map((r) => r.d) };
}

// ---------------- personal dashboard ----------------
export async function myDashboard(user) {
  const me = user.id;
  const today = todayIST();
  const weekFrom = mondayOf(today);
  const weekTo = addDays(weekFrom, 6);
  const IST = (col) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;
  const one = async (sql, params) => (await query(sql, params)).rows[0];

  const dg = await one(
    `SELECT
       COUNT(*) FILTER (WHERE assignee_id = $1 AND status = 'pending') AS open,
       COUNT(*) FILTER (WHERE assignee_id = $1 AND status = 'pending' AND deadline < NOW()) AS overdue,
       COUNT(*) FILTER (WHERE assignee_id = $1 AND status = 'pending' AND ${IST('deadline')} = $2::date) AS due_today,
       COUNT(*) FILTER (WHERE assignee_id = $1 AND status = 'completed' AND COALESCE(completed_at, submitted_at) >= NOW() - INTERVAL '7 days') AS done_7d,
       COUNT(*) FILTER (WHERE assigner_id = $1 AND status = 'pending') AS given_open,
       COUNT(*) FILTER (WHERE assigner_id = $1 AND status = 'pending' AND deadline < NOW()) AS given_overdue,
       COUNT(*) FILTER (WHERE status = 'submitted' AND COALESCE(verifier_id, assigner_id) = $1) AS to_verify
     FROM delegations`, [me, today]);
  const cl = await one(
    `SELECT
       COUNT(*) FILTER (WHERE c.assignee_id = $1 AND ${IST('o.due_at')} = $2::date AND o.status <> 'non_functional') AS today_total,
       COUNT(*) FILTER (WHERE c.assignee_id = $1 AND ${IST('o.due_at')} = $2::date AND o.status IN ('completed','submitted')) AS today_done,
       COUNT(*) FILTER (WHERE c.assignee_id = $1 AND o.status = 'pending' AND o.due_at < NOW()) AS overdue,
       COUNT(*) FILTER (WHERE o.status = 'submitted' AND COALESCE(c.verifier_id, c.assigner_id) = $1 AND (o.verify_on IS NULL OR o.verify_on <= $2::date)) AS to_verify,
       COUNT(*) FILTER (WHERE c.assignee_id = $1 AND o.status IN ('completed','submitted') AND ${IST('o.due_at')} BETWEEN $3::date AND $4::date) AS done_week,
       COUNT(*) FILTER (WHERE c.assignee_id = $1 AND o.status = 'not_done' AND ${IST('o.due_at')} BETWEEN $3::date AND $4::date) AS not_done_week
     FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id WHERE c.active`, [me, today, weekFrom, weekTo]);
  const num = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Number(v)]));

  const [upcoming, toVerifyD, toVerifyC, turns, cats] = await Promise.all([
    query(`SELECT id, title, priority, deadline FROM delegations WHERE assignee_id = $1 AND status = 'pending' ORDER BY deadline LIMIT 8`, [me]),
    query(`SELECT id, title, deadline AS due_at FROM delegations WHERE status = 'submitted' AND COALESCE(verifier_id, assigner_id) = $1 ORDER BY submitted_at LIMIT 8`, [me]),
    query(`SELECT c.id, c.title, COUNT(*)::int AS turns FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id
            WHERE c.active AND o.status = 'submitted' AND COALESCE(c.verifier_id, c.assigner_id) = $1 AND (o.verify_on IS NULL OR o.verify_on <= $2::date)
            GROUP BY c.id, c.title ORDER BY c.title LIMIT 8`, [me, today]),
    query(`SELECT o.id, c.id AS checklist_id, c.title, c.priority, o.due_at, o.status FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id
            WHERE c.active AND c.assignee_id = $1 AND ${IST('o.due_at')} = $2::date AND o.status <> 'non_functional' ORDER BY o.due_at, c.title LIMIT 12`, [me, today]),
    query(`SELECT COALESCE(tc.name, 'No category') AS category, COUNT(*)::int AS count FROM delegations d LEFT JOIN task_categories tc ON tc.id = d.category_id
            WHERE d.assignee_id = $1 AND d.status = 'pending' GROUP BY 1 ORDER BY count DESC, 1 LIMIT 6`, [me]),
  ]);
  return {
    delegation: num(dg), checklist: num(cl), upcoming: upcoming.rows,
    to_verify: [...toVerifyD.rows.map((r) => ({ kind: 'd', open: `d${r.id}`, id: r.id, title: r.title, due_at: r.due_at })), ...toVerifyC.rows.map((r) => ({ kind: 'c', open: `c${r.id}`, id: r.id, title: r.title, turns: r.turns }))].slice(0, 8),
    todays_turns: turns.rows.map((r) => ({ ...r, open: `c${r.checklist_id}` })), open_by_category: cats.rows,
  };
}
