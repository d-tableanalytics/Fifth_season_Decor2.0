// Background job (spec 11): one timer, first run 20 s after start, then every 60 s.
import { pool, query } from '../config/db.js';
import { notify } from '../services/notifications.js';
import { todayIST, fmtDateTime } from '../utils/ist.js';
import { generateTurns, delegationLink, checklistLink } from '../services/tasks/common.js';

const LOCK_ID = 727001; // pg advisory lock: only one server instance runs a tick
let running = false;
let lastGenerated = null;

const relText = (ms) => {
  const m = Math.round(ms / 60000);
  if (m < 60) return `${Math.max(m, 1)} minute${m === 1 ? '' : 's'}`;
  if (m < 1440) return `${Math.round(m / 60)} hour${Math.round(m / 60) === 1 ? '' : 's'}`;
  return `${Math.round(m / 1440)} day${Math.round(m / 1440) === 1 ? '' : 's'}`;
};

async function returnReassignments(today) {
  const { rows } = await query(
    `SELECT id, title, assignee_id, original_assignee_id, assigner_id FROM checklists
      WHERE reassign_until IS NOT NULL AND reassign_until < $1::date AND original_assignee_id IS NOT NULL`, [today]);
  for (const c of rows) {
    const upd = await query(
      `UPDATE checklists SET assignee_id = original_assignee_id, original_assignee_id = NULL, reassign_until = NULL, updated_at = NOW()
        WHERE id = $1 AND original_assignee_id IS NOT NULL`, [c.id]);
    if (!upd.rowCount) continue;
    await query(
      `INSERT INTO task_reassignments (kind, task_id, title, from_user_id, to_user_id, by_user_id, reason, is_return)
       VALUES ('checklist', $1, $2, $3, $4, NULL, 'The period of the reassignment is over', TRUE)`,
      [c.id, c.title, c.assignee_id, c.original_assignee_id]);
    await notify(c.original_assignee_id, { kind: 'status', title: `Checklist back with you: ${c.title}`, body: 'The reassignment period is over.', link: checklistLink(c.id), actor: 'System' });
  }
}

async function closeMissed(today) {
  const { rows } = await query(
    `UPDATE checklist_occurrences o SET status = 'not_done', not_done_at = NOW()
       FROM checklists c
      WHERE c.id = o.checklist_id AND c.active AND c.delay_rule = 'close' AND o.status = 'pending'
        AND (o.due_at AT TIME ZONE 'Asia/Kolkata')::date < $1::date
      RETURNING o.id, o.due_at, c.id AS checklist_id, c.title, c.assignee_id, c.assigner_id`, [today]);
  for (const r of rows)
    await notify([r.assignee_id, r.assigner_id], {
      kind: 'status', title: `Work Not Done: ${r.title}`, body: `The turn due ${fmtDateTime(r.due_at)} was not done and was closed.`,
      link: checklistLink(r.checklist_id), actor: 'System' });
}

/** Reminder M fires once when due − M ≤ now and due > now − 1 h; passed ones are all recorded as sent. */
function dueReminders(reminders, sent, dueAt, now) {
  const due = new Date(dueAt).getTime();
  const passed = (reminders || []).filter((m) => due - m * 60000 <= now);
  const fresh = passed.filter((m) => !(sent || []).includes(m));
  if (!fresh.length) return null;
  return { all: [...new Set([...(sent || []), ...passed])], fire: due > now - 3600000 };
}

async function processReminders() {
  const now = Date.now();
  const text = (due) => (new Date(due).getTime() > now ? `Due ${fmtDateTime(due)} (in about ${relText(new Date(due).getTime() - now)})` : `Was due ${fmtDateTime(due)}`);

  const d = await query(
    "SELECT id, title, assignee_id, deadline, reminders, reminders_sent FROM delegations WHERE status = 'pending' AND jsonb_array_length(reminders) > 0 AND deadline > NOW() - INTERVAL '1 day'");
  for (const r of d.rows) {
    const x = dueReminders(r.reminders, r.reminders_sent, r.deadline, now);
    if (!x) continue;
    await query('UPDATE delegations SET reminders_sent = $1::jsonb WHERE id = $2', [JSON.stringify(x.all), r.id]);
    if (x.fire) await notify(r.assignee_id, { kind: 'status', title: `Reminder: ${r.title}`, body: text(r.deadline), link: delegationLink(r.id), actor: 'Reminder' });
  }

  const o = await query(
    `SELECT o.id, o.due_at, o.reminders_sent, c.id AS cid, c.title, c.assignee_id, c.reminders
       FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id
      WHERE c.active AND o.status = 'pending' AND jsonb_array_length(c.reminders) > 0
        AND o.due_at BETWEEN NOW() - INTERVAL '1 day' AND NOW() + INTERVAL '91 days'`);
  for (const r of o.rows) {
    const x = dueReminders(r.reminders, r.reminders_sent, r.due_at, now);
    if (!x) continue;
    await query('UPDATE checklist_occurrences SET reminders_sent = $1::jsonb WHERE id = $2', [JSON.stringify(x.all), r.id]);
    if (x.fire) await notify(r.assignee_id, { kind: 'status', title: `Reminder: ${r.title}`, body: text(r.due_at), link: checklistLink(r.cid), actor: 'Reminder' });
  }
}

/** Verification day: one notification per checklist for submitted turns whose day has come. */
async function verificationDay(today) {
  const { rows } = await query(
    `SELECT c.id, c.title, COALESCE(c.verifier_id, c.assigner_id) AS verifier, ARRAY_AGG(o.id) AS ids
       FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id
      WHERE c.active AND o.status = 'submitted' AND o.verify_on <= $1::date AND NOT o.verify_notified
      GROUP BY c.id`, [today]);
  for (const r of rows) {
    await query('UPDATE checklist_occurrences SET verify_notified = TRUE WHERE id = ANY($1::int[])', [r.ids]);
    await notify(r.verifier, { kind: 'status', title: `${r.ids.length} turn(s) to verify: ${r.title}`, body: 'Today is the verification day', link: checklistLink(r.id), actor: 'System' });
  }
}

export async function tick() {
  if (running) return;
  running = true;
  let client;
  try {
    client = await pool.connect();
    const { rows } = await client.query('SELECT pg_try_advisory_lock($1) AS ok', [LOCK_ID]);
    if (!rows[0].ok) return;
    try {
      const today = todayIST();
      if (lastGenerated !== today) {
        await generateTurns({ query });
        lastGenerated = today;
      }
      await returnReassignments(today);
      await closeMissed(today);
      await processReminders();
      await verificationDay(today);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]);
    }
  } catch (err) {
    console.error('Task job failed:', err.message);
  } finally {
    client?.release();
    running = false;
  }
}

let started = false;
export function startTaskJob() {
  if (started) return;
  started = true;
  setTimeout(() => {
    tick();
    setInterval(tick, 60000).unref();
  }, 20000).unref();
}
