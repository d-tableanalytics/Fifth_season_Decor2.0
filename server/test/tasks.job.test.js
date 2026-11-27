// Background-job test. Needs a LOCAL/TEST database that already ran migrate + tasks.api.test.js (for QA users):
//   QA_DB=1 DATABASE_URL=postgresql://...local... node --test test/tasks.job.test.js
// Seeds its own rows; never point at production.
import test from 'node:test';
import assert from 'node:assert/strict';

const skip = !process.env.QA_DB;
let q; let tick; let pool; let U = {};
const count = async (sql, p = []) => Number((await q(sql, p)).rows[0].count);

test('job setup', { skip }, async () => {
  ({ query: q, pool } = await import('../src/config/db.js'));
  ({ tick } = await import('../src/jobs/taskJob.js'));
  const { rows } = await q("SELECT id, email FROM users WHERE email LIKE '%@qa.local' AND email NOT LIKE 'admin%' ORDER BY id DESC LIMIT 3");
  assert.ok(rows.length >= 3, 'run tasks.api.test.js first to create QA users');
  U = { a: rows[0].id, b: rows[1].id, c: rows[2].id };
});

const mkChecklist = async (title, delay, extra = '') => (await q(
  `INSERT INTO checklists (title, assigner_id, assignee_id, frequency, start_date, due_time, config, delay_rule ${extra ? ',' + extra.cols : ''})
   VALUES ($1,$2,$3,'Daily', CURRENT_DATE - 5, '10:00', '{}', $4 ${extra ? ',' + extra.vals : ''}) RETURNING id`, [title, U.a, U.b, delay])).rows[0].id;
const occ = async (cid, dueSql, cols = '', vals = '') => (await q(
  `INSERT INTO checklist_occurrences (checklist_id, due_at ${cols ? ',' + cols : ''}) VALUES ($1, ${dueSql} ${vals ? ',' + vals : ''}) RETURNING id`, [cid])).rows[0].id;

test('close rule closes + notifies both; carry_forward stays pending', { skip }, async () => {
  const close = await mkChecklist('JOB close', 'close');
  const carry = await mkChecklist('JOB carry', 'carry_forward');
  const o1 = await occ(close, "NOW() - INTERVAL '2 days'");
  const o2 = await occ(carry, "NOW() - INTERVAL '2 days'");
  await tick();
  assert.equal((await q('SELECT status FROM checklist_occurrences WHERE id=$1', [o1])).rows[0].status, 'not_done');
  assert.equal((await q('SELECT status FROM checklist_occurrences WHERE id=$1', [o2])).rows[0].status, 'pending');
  const n = await count("SELECT COUNT(*) FROM notifications WHERE title = 'Work Not Done: JOB close'");
  assert.equal(n, 2, 'assignee and assigner notified once each');
  await tick();
  assert.equal(await count("SELECT COUNT(*) FROM notifications WHERE title = 'Work Not Done: JOB close'"), 2, 'no duplicates on next tick');
});

test('reminders fire once; stale ones are marked sent silently', { skip }, async () => {
  const mk = async (title, deadlineSql) => (await q(
    `INSERT INTO delegations (title, assigner_id, assignee_id, deadline, reminders) VALUES ($1,$2,$3,${deadlineSql},'[60]') RETURNING id`, [title, U.a, U.b])).rows[0].id;
  const soon = await mk('JOB soon', "NOW() + INTERVAL '30 minutes'");
  const stale = await mk('JOB stale', "NOW() - INTERVAL '3 hours'");
  await tick();
  assert.equal(await count("SELECT COUNT(*) FROM notifications WHERE title = 'Reminder: JOB soon'"), 1);
  assert.equal(await count("SELECT COUNT(*) FROM notifications WHERE title = 'Reminder: JOB stale'"), 0);
  assert.deepEqual((await q('SELECT reminders_sent FROM delegations WHERE id=$1', [stale])).rows[0].reminders_sent, [60]);
  await tick();
  assert.equal(await count("SELECT COUNT(*) FROM notifications WHERE title = 'Reminder: JOB soon'"), 1, 'fires once');
  assert.ok(soon);
});

test('verification day: one notice per checklist', { skip }, async () => {
  const cid = await mkChecklist('JOB verify', 'carry_forward', { cols: 'verification_required, verifier_id', vals: `TRUE, ${U.c}` });
  await occ(cid, "NOW() - INTERVAL '1 day'", "status, submitted_at, verify_on", "'submitted', NOW(), CURRENT_DATE");
  await occ(cid, "NOW() - INTERVAL '2 days'", "status, submitted_at, verify_on", "'submitted', NOW(), CURRENT_DATE");
  await tick();
  const r = await q("SELECT user_id, title FROM notifications WHERE title LIKE '%turn(s) to verify: JOB verify'");
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0].user_id, U.c);
  assert.match(r.rows[0].title, /^2 turn/);
  await tick();
  assert.equal(await count("SELECT COUNT(*) FROM notifications WHERE title LIKE '%to verify: JOB verify'"), 1);
});

test('temporary reassignment returns to the original doer', { skip }, async () => {
  const cid = await mkChecklist('JOB return', 'carry_forward', { cols: 'original_assignee_id, reassign_until', vals: `${U.c}, CURRENT_DATE - 1` });
  await tick();
  const c = (await q('SELECT assignee_id, original_assignee_id, reassign_until FROM checklists WHERE id=$1', [cid])).rows[0];
  assert.equal(c.assignee_id, U.c);
  assert.equal(c.original_assignee_id, null);
  assert.equal(c.reassign_until, null);
  assert.equal(await count("SELECT COUNT(*) FROM task_reassignments WHERE kind='checklist' AND task_id=$1 AND is_return", [cid]), 1);
});

test('advisory lock: a tick does nothing while another instance holds the lock', { skip }, async () => {
  const close = await mkChecklist('JOB lock', 'close');
  const o = await occ(close, "NOW() - INTERVAL '2 days'");
  const holder = await pool.connect();
  try {
    await holder.query('SELECT pg_advisory_lock(727001)');
    await tick();
    assert.equal((await q('SELECT status FROM checklist_occurrences WHERE id=$1', [o])).rows[0].status, 'pending', 'locked out');
  } finally {
    await holder.query('SELECT pg_advisory_unlock(727001)');
    holder.release();
  }
  await tick();
  assert.equal((await q('SELECT status FROM checklist_occurrences WHERE id=$1', [o])).rows[0].status, 'not_done');
});

test('job teardown', { skip }, async () => { await pool?.end(); });
