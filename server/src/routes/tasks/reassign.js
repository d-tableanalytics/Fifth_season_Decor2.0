// Reassignment (spec 10): leave preview + reassign delegations / checklists.
import { Router } from 'express';
import { query, withTransaction } from '../../config/db.js';
import { badRequest } from '../../utils/httpError.js';
import { todayIST, fmtDmy } from '../../utils/ist.js';
import { describeRepeat } from '../../services/tasks/recurrence.js';
import { notify } from '../../services/notifications.js';
import { canReassignAny, posInt, optText, delegationLink, checklistLink } from '../../services/tasks/common.js';

const router = Router();
const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
const IST_D = (col) => `(${col} AT TIME ZONE 'Asia/Kolkata')::date`;

router.get('/leave-preview', async (req, res) => {
  const doer = posInt(req.query.doer);
  if (!doer) throw badRequest('Choose the doer who is on leave');
  const from = isDate(req.query.from) ? req.query.from : todayIST();
  const to = isDate(req.query.to) ? req.query.to : from;
  const any = canReassignAny(req.user);
  const mine = any ? '' : 'AND assigner_id = $4';
  const params = [doer, from, to, ...(any ? [] : [req.user.id])];
  const [d, c] = await Promise.all([
    query(`SELECT id, title, priority, deadline FROM delegations
            WHERE assignee_id = $1 AND status = 'pending' AND ${IST_D('deadline')} BETWEEN $2::date AND $3::date ${mine} ORDER BY deadline`, params),
    query(`SELECT c.id, c.title, c.priority, c.frequency, c.due_time, c.config, COUNT(o.id)::int AS turns
             FROM checklists c JOIN checklist_occurrences o ON o.checklist_id = c.id AND o.status = 'pending' AND ${IST_D('o.due_at')} BETWEEN $2::date AND $3::date
            WHERE c.assignee_id = $1 AND c.active ${mine.replace('assigner_id', 'c.assigner_id')} GROUP BY c.id ORDER BY c.title`, params),
  ]);
  res.json({ delegations: d.rows, checklists: c.rows.map((r) => ({ ...r, repeat_text: describeRepeat(r) })) });
});

router.post('/reassign', async (req, res) => {
  const to = posInt(req.body.to);
  if (!to || !(await query('SELECT 1 FROM users WHERE id = $1 AND is_active', [to])).rowCount) throw badRequest('Choose who the tasks are given to');
  const items = (Array.isArray(req.body.items) ? req.body.items : [])
    .map((i) => ({ kind: i?.kind, id: posInt(i?.id) })).filter((i) => ['delegation', 'checklist'].includes(i.kind) && i.id).slice(0, 300);
  if (!items.length) throw badRequest('Select at least one task');
  const from_date = isDate(req.body.from_date) ? req.body.from_date : null;
  const to_date = isDate(req.body.to_date) ? req.body.to_date : null;
  if (from_date && to_date && to_date < from_date) throw badRequest('The “to” date cannot be before the “from” date');
  const reason = optText(req.body.reason, 300);
  const any = canReassignAny(req.user);
  const skipped = [];
  const moves = [];

  await withTransaction(async (db) => {
    for (const it of items) {
      const table = it.kind === 'delegation' ? 'delegations' : 'checklists';
      const t = (await db.query(`SELECT * FROM ${table} WHERE id = $1 FOR UPDATE`, [it.id])).rows[0];
      if (!t) { skipped.push('not found'); continue; }
      if (!any && t.assigner_id !== req.user.id) { skipped.push(`${t.title}: only its assigner can reassign it`); continue; }
      if (it.kind === 'delegation' && t.status !== 'pending') { skipped.push(`${t.title}: it is already completed or waiting for verification`); continue; }
      if (it.kind === 'checklist' && !t.active) { skipped.push(`${t.title}: the checklist is paused`); continue; }
      if (t.assignee_id === to) { skipped.push(`${t.title}: it is already with this person`); continue; }
      if (it.kind === 'delegation') {
        await db.query("UPDATE delegations SET assignee_id = $1, reminders_sent = '[]'::jsonb, updated_at = NOW() WHERE id = $2", [to, it.id]);
      } else if (to_date) {
        await db.query('UPDATE checklists SET assignee_id = $1, reassign_until = $2, original_assignee_id = COALESCE(original_assignee_id, $3), updated_at = NOW() WHERE id = $4',
          [to, to_date, t.assignee_id, it.id]);
      } else {
        await db.query('UPDATE checklists SET assignee_id = $1, reassign_until = NULL, original_assignee_id = NULL, updated_at = NOW() WHERE id = $2', [to, it.id]);
      }
      await db.query(
        `INSERT INTO task_reassignments (kind, task_id, title, from_user_id, to_user_id, by_user_id, period_from, period_to, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, [it.kind, it.id, t.title, t.assignee_id, to, req.user.id, from_date, to_date, reason]);
      moves.push({ kind: it.kind, id: it.id, title: t.title, from: t.assignee_id });
    }
  });

  for (const m of moves) {
    const link = m.kind === 'delegation' ? delegationLink(m.id) : checklistLink(m.id);
    const label = m.kind === 'delegation' ? 'Task' : 'Checklist';
    await notify(to, { kind: 'assigned', title: `${label} reassigned to you: ${m.title}`, body: `by ${req.user.name}${to_date ? ` · till ${fmtDmy(to_date)}` : ''}`, link, actor: req.user.name }, req.user.id);
    await notify(m.from, { kind: 'status', title: `Reassigned to someone else: ${m.title}`, body: `by ${req.user.name}`, link, actor: req.user.name }, req.user.id);
  }
  res.json({ moved: moves.length, skipped });
});

export default router;
