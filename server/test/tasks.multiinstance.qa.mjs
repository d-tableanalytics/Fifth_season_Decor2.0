// Seeds job work, to be processed by TWO real server processes started afterwards (LOCAL/TEST DB only).
//   node test/tasks.multiinstance.qa.mjs seed     -> inserts rows
//   (start two servers, wait > 25 s)
//   node test/tasks.multiinstance.qa.mjs check    -> asserts nothing was duplicated
import assert from 'node:assert/strict';
import { query, pool } from '../src/config/db.js';

const mode = process.argv[2];
const count = async (sql, p = []) => Number((await query(sql, p)).rows[0].count);
const { rows } = await query("SELECT id FROM users WHERE email LIKE '%@qa.local' AND email NOT LIKE 'admin%' ORDER BY id DESC LIMIT 3");
const [a, b, c] = rows.map((r) => r.id);

if (mode === 'seed') {
  const mk = async (title, delay, extra = '') => (await query(
    `INSERT INTO checklists (title, assigner_id, assignee_id, frequency, start_date, due_time, config, delay_rule${extra ? `, ${extra.cols}` : ''})
     VALUES ($1,$2,$3,'Daily', CURRENT_DATE - 5, '10:00', '{}', $4${extra ? `, ${extra.vals}` : ''}) RETURNING id`, [title, a, b, delay])).rows[0].id;
  const close = await mk('MI close', 'close');
  for (const d of [2, 3]) await query(`INSERT INTO checklist_occurrences (checklist_id, due_at) VALUES ($1, NOW() - INTERVAL '${d} days')`, [close]);
  await query(`INSERT INTO delegations (title, assigner_id, assignee_id, deadline, reminders) VALUES ('MI reminder',$1,$2,NOW() + INTERVAL '30 minutes','[60,15]')`, [a, b]);
  const ver = await mk('MI verify', 'carry_forward', { cols: 'verification_required, verifier_id', vals: `TRUE, ${c}` });
  await query(`INSERT INTO checklist_occurrences (checklist_id, due_at, status, submitted_at, verify_on) VALUES ($1, NOW() - INTERVAL '1 day', 'submitted', NOW(), CURRENT_DATE)`, [ver]);
  await mk('MI return', 'carry_forward', { cols: 'original_assignee_id, reassign_until', vals: `${c}, CURRENT_DATE - 1` });
  await mk('MI generate', 'carry_forward'); // no turns yet: both instances will try to generate
  console.log('seeded');
} else {
  const gen = (await query("SELECT id FROM checklists WHERE title = 'MI generate'")).rows[0].id;
  const checks = {
    closedTurns: [await count("SELECT COUNT(*) FROM checklist_occurrences o JOIN checklists c ON c.id=o.checklist_id WHERE c.title='MI close' AND o.status='not_done'"), 2],
    workNotDoneNotices: [await count("SELECT COUNT(*) FROM notifications WHERE title = 'Work Not Done: MI close'"), 4], // 2 turns x (assignee + assigner)
    reminderNotices: [await count("SELECT COUNT(*) FROM notifications WHERE title = 'Reminder: MI reminder'"), 1],
    verifyNotices: [await count("SELECT COUNT(*) FROM notifications WHERE title LIKE '%to verify: MI verify'"), 1],
    returnHistory: [await count("SELECT COUNT(*) FROM task_reassignments r JOIN checklists c ON c.id=r.task_id WHERE r.kind='checklist' AND r.is_return AND c.title='MI return'"), 1],
    returnNotices: [await count("SELECT COUNT(*) FROM notifications WHERE title = 'Checklist back with you: MI return'"), 1],
    duplicateTurns: [await count('SELECT COUNT(*) - COUNT(DISTINCT due_at) AS count FROM checklist_occurrences WHERE checklist_id = $1', [gen]), 0],
  };
  const turns = await count('SELECT COUNT(*) FROM checklist_occurrences WHERE checklist_id = $1', [gen]);
  console.table(Object.fromEntries(Object.entries(checks).map(([k, [got, want]]) => [k, { got, want }])));
  console.log('turns generated for MI generate:', turns);
  for (const [k, [got, want]] of Object.entries(checks)) assert.equal(got, want, k);
  assert.ok(turns >= 50 && turns <= 63, `turns ${turns}`);
  console.log('multi-instance check passed');
}
await pool.end();
