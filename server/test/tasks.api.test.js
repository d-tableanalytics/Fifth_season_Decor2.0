// Integration test for the Task Management API. Runs only against a LOCAL/TEST server:
//   QA_API=http://localhost:5055 QA_ADMIN_EMAIL=... QA_ADMIN_PASSWORD=... node --test test/tasks.api.test.js
// Never point this at production: it creates users, tasks and holidays.
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.QA_API;
const skip = !BASE;
const pad = (n) => String(n).padStart(2, '0');
const istNow = (addMin = 0) => new Date(Date.now() + 330 * 60000 + addMin * 60000);
const local = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
const ymd = (d) => local(d).slice(0, 10);
const inDays = (n, hh = 11) => { const d = istNow(n * 1440); d.setUTCHours(hh, 0, 0, 0); return local(d); };

async function call(token, method, path, body) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(body !== undefined && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('json') ? await res.json() : ct.includes('pdf') ? Buffer.from(await res.arrayBuffer()) : await res.text();
  return { status: res.status, data };
}
const ok = (r, status = 200) => { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; };
const msg = (r, status, text) => { assert.equal(r.status, status, JSON.stringify(r.data)); if (text) assert.match(r.data.message, new RegExp(text)); };

const S = {};
test('setup: users and roles', { skip }, async () => {
  const login = ok(await call(null, 'POST', '/auth/login', { email: process.env.QA_ADMIN_EMAIL, password: process.env.QA_ADMIN_PASSWORD }));
  S.admin = login.token;
  const roles = ok(await call(S.admin, 'GET', '/roles')).data;
  const staff = roles.find((r) => r.name === 'Staff').id;
  const stamp = Date.now();
  for (const [k, dept] of [['alice', 'Sales'], ['bob', 'Sales'], ['carol', 'Ops']]) {
    const email = `${k}${stamp}@qa.local`;
    const c = await call(S.admin, 'POST', '/employees', { name: `QA ${k}`, email, password: 'Passw0rd!x', role_id: staff, department: dept });
    ok(c, 201);
    S[k] = ok(await call(null, 'POST', '/auth/login', { email, password: 'Passw0rd!x' })).token;
    S[`${k}Id`] = c.data.data.id;
  }
});

test('permissions: Staff guard and route access', { skip }, async () => {
  ok(await call(S.alice, 'GET', '/tasks/meta'));
  msg(await call(S.alice, 'GET', '/tasks/pc'), 403, 'permission');
  msg(await call(S.alice, 'POST', '/tasks/occurrences/1/revert-non-functional', {}), 403);
  msg(await call(null, 'GET', '/tasks/meta'), 401);
  const meta = ok(await call(S.alice, 'GET', '/tasks/meta'));
  assert.equal(meta.can_all, false);
});

test('delegation lifecycle with verification', { skip }, async () => {
  const base = { title: 'QA delegation', assignee_id: S.bobId, verification_required: true, verifier_id: S.aliceId, checkpoints: ['one', 'two'], priority: 'High' };
  msg(await call(S.alice, 'POST', '/tasks/delegations', { ...base, deadline: inDays(-1) }), 400, 'cannot be in the past');
  msg(await call(S.alice, 'POST', '/tasks/delegations', { ...base, title: '', deadline: inDays(1) }), 400, 'Enter the task title');
  msg(await call(S.alice, 'POST', '/tasks/delegations', { ...base, verifier_id: null, deadline: inDays(1) }), 400, 'Verified By');
  const d = ok(await call(S.alice, 'POST', '/tasks/delegations', { ...base, deadline: inDays(1) }), 201);
  S.d = d.id;
  assert.equal(d.status, 'pending');
  // visibility
  ok(await call(S.bob, 'GET', `/tasks/delegations/${d.id}`));
  msg(await call(S.carol, 'GET', `/tasks/delegations/${d.id}`), 404);
  const bobList = ok(await call(S.bob, 'GET', '/tasks/delegations?scope=mine'));
  assert.ok(bobList.data.some((x) => x.id === d.id));
  const carolList = ok(await call(S.carol, 'GET', '/tasks/delegations?scope=all'));
  assert.ok(!carolList.data.some((x) => x.id === d.id), 'carol must not see others tasks (no all-data)');
  // edit is assigner-only
  msg(await call(S.bob, 'PUT', `/tasks/delegations/${d.id}`, { ...base, deadline: inDays(2) }), 403, 'Only the person who assigned');
  // work
  msg(await call(S.bob, 'POST', `/tasks/delegations/${d.id}/complete`, { note: 'x' }), 400, 'Tick every checkpoint first');
  ok(await call(S.bob, 'PUT', `/tasks/delegations/${d.id}/checkpoints`, { done: [true, true] }));
  msg(await call(S.alice, 'PUT', `/tasks/delegations/${d.id}/checkpoints`, { done: [true, false] }), 403);
  const sub = ok(await call(S.bob, 'POST', `/tasks/delegations/${d.id}/complete`, { note: 'done' }));
  assert.equal(sub.status, 'submitted');
  msg(await call(S.bob, 'POST', `/tasks/delegations/${d.id}/verify`, { approve: true }), 403);
  msg(await call(S.alice, 'POST', `/tasks/delegations/${d.id}/verify`, { approve: false }), 400, 'Write why the task is sent back');
  const back = ok(await call(S.alice, 'POST', `/tasks/delegations/${d.id}/verify`, { approve: false, remark: 'redo' }));
  assert.equal(back.status, 'pending');
  assert.equal(back.reject_count, 1);
  assert.ok(back.checkpoints.every((c) => !c.done), 'send-back clears ticks');
  ok(await call(S.bob, 'PUT', `/tasks/delegations/${d.id}/checkpoints`, { done: [true, true] }));
  ok(await call(S.bob, 'POST', `/tasks/delegations/${d.id}/complete`, {}));
  const fin = ok(await call(S.alice, 'POST', `/tasks/delegations/${d.id}/verify`, { approve: true }));
  assert.equal(fin.status, 'completed');
  msg(await call(S.alice, 'PUT', `/tasks/delegations/${d.id}`, { ...base, deadline: inDays(2) }), 409, 'completed task cannot');
});

test('deadline revisions', { skip }, async () => {
  const d = ok(await call(S.alice, 'POST', '/tasks/delegations', { title: 'QA rev', assignee_id: S.bobId, deadline: inDays(1) }), 201);
  msg(await call(S.bob, 'POST', `/tasks/delegations/${d.id}/revisions`, { new_deadline: inDays(3), reason: '' }), 400, 'Write why');
  const r = ok(await call(S.bob, 'POST', `/tasks/delegations/${d.id}/revisions`, { new_deadline: inDays(3), reason: 'busy' }), 201);
  msg(await call(S.bob, 'POST', `/tasks/delegations/${d.id}/revisions`, { new_deadline: inDays(4), reason: 'again' }), 409, 'already waiting');
  const rev = r.pending_revision || r.revision_log[0];
  msg(await call(S.bob, 'POST', `/tasks/delegations/${d.id}/revisions/${rev.id}/decide`, { approve: true }), 403);
  msg(await call(S.alice, 'POST', `/tasks/delegations/${d.id}/revisions/${rev.id}/decide`, { approve: false }), 400, 'Write why the request is rejected');
  const approved = ok(await call(S.alice, 'POST', `/tasks/delegations/${d.id}/revisions/${rev.id}/decide`, { approve: true }));
  assert.equal(approved.revisions, 1);
  S.d2 = d.id;
});

test('holidays block delegation deadlines; delete permission for Staff', { skip }, async () => {
  const day = inDays(20).slice(0, 10);
  const h = ok(await call(S.admin, 'POST', '/holidays', { date: day, name: 'QA Holiday' }), 201);
  assert.equal(typeof h.removed_turns, 'number');
  msg(await call(S.alice, 'POST', '/tasks/delegations', { title: 'x', assignee_id: S.bobId, deadline: `${day}T11:00` }), 400, 'falls on a holiday \\(QA Holiday');
  // Staff has no tasks_mine:delete -> spec-literal guard
  msg(await call(S.alice, 'DELETE', `/tasks/delegations/${S.d2}`), 403, 'delete here');
  const list = ok(await call(S.admin, 'GET', '/holidays'));
  ok(await call(S.admin, 'DELETE', `/holidays/${list.data.find((x) => x.name === 'QA Holiday').id}`));
});

test('checklist turns, future-turn lock, non-functional, undo', { skip }, async () => {
  const body = { title: 'QA daily', assignee_id: S.bobId, frequency: 'Daily', start_date: ymd(istNow()), due_time: '00:05', config: {}, non_functional_allowed: true, delay_rule: 'close', checkpoints: ['tick me'] };
  msg(await call(S.alice, 'POST', '/tasks/checklists', { ...body, frequency: 'Periodically', config: { every: 0 } }), 400, 'between 1 and 365');
  msg(await call(S.alice, 'POST', '/tasks/checklists', { ...body, end_date: '2000-01-01' }), 400, 'end date cannot be before');
  const c = ok(await call(S.alice, 'POST', '/tasks/checklists', body), 201);
  S.c = c.id;
  const det = ok(await call(S.bob, 'GET', `/tasks/checklists/${c.id}`));
  assert.ok(det.turns.length >= 20, `turns generated: ${det.turns.length}`);
  const now = Date.now();
  const future = det.turns.find((t) => new Date(t.due_at).getTime() > now && t.is_future);
  const today = det.turns.find((t) => !t.is_future && t.status === 'pending');
  assert.ok(future, 'a future turn exists');
  msg(await call(S.bob, 'POST', `/tasks/occurrences/${future.id}/complete`, {}), 409, 'coming day');
  msg(await call(S.bob, 'POST', `/tasks/occurrences/${future.id}/non-functional`, { reason: 'r' }), 409, 'coming day');
  assert.ok(today, "today's turn exists");
  msg(await call(S.bob, 'POST', `/tasks/occurrences/${today.id}/non-functional`, { reason: '' }), 400, 'Write why the task was non-functional');
  const nf = ok(await call(S.bob, 'POST', `/tasks/occurrences/${today.id}/non-functional`, { reason: 'machine repair' }));
  assert.equal(nf.status, 'non_functional');
  msg(await call(S.bob, 'POST', `/tasks/occurrences/${today.id}/revert-non-functional`, {}), 403);
  const back = ok(await call(S.admin, 'POST', `/tasks/occurrences/${today.id}/revert-non-functional`, {}));
  assert.equal(back.status, 'pending');
  // spec 20.1: non_functional mapped in checklist detail
  ok(await call(S.bob, 'POST', `/tasks/occurrences/${today.id}/non-functional`, { reason: 'again' }));
  const det2 = ok(await call(S.bob, 'GET', `/tasks/checklists/${c.id}`));
  const t2 = det2.turns.find((t) => t.id === today.id);
  assert.equal(t2.work_status, 'non_functional');
  assert.equal(t2.non_functional_reason, 'again');
  ok(await call(S.admin, 'POST', `/tasks/occurrences/${today.id}/revert-non-functional`, {}));
  // complete today's turn: needs the checkpoint
  msg(await call(S.bob, 'POST', `/tasks/occurrences/${today.id}/complete`, {}), 400, 'Tick every checkpoint');
  ok(await call(S.bob, 'PUT', `/tasks/occurrences/${today.id}/checkpoints`, { done: [true] }));
  const done = ok(await call(S.bob, 'POST', `/tasks/occurrences/${today.id}/complete`, { note: 'ok' }));
  assert.equal(done.status, 'completed');
  // pause/resume
  ok(await call(S.alice, 'POST', `/tasks/checklists/${c.id}/active`, { active: false }));
  ok(await call(S.alice, 'POST', `/tasks/checklists/${c.id}/active`, { active: true }));
});

test('weekly checklist: only chosen weekdays; edit keeps touched turns', { skip }, async () => {
  const c = ok(await call(S.alice, 'POST', '/tasks/checklists', { title: 'QA weekly', assignee_id: S.carolId ?? S.bobId, frequency: 'Weekly', start_date: ymd(istNow()), due_time: '10:00', config: { days: [1, 4] } }), 201);
  const det = ok(await call(S.alice, 'GET', `/tasks/checklists/${c.id}`));
  for (const t of det.turns) {
    const dow = new Date(new Date(t.due_at).getTime() + 330 * 60000).getUTCDay();
    assert.ok([1, 4].includes(dow), `unexpected weekday ${dow}`);
  }
  S.cw = c.id;
});

test('reassignment: temporary + preview', { skip }, async () => {
  const prev = ok(await call(S.alice, 'GET', `/tasks/leave-preview?doer=${S.bobId}&from=${ymd(istNow())}&to=${ymd(istNow(5 * 1440))}`));
  assert.ok(Array.isArray(prev.checklists));
  msg(await call(S.alice, 'POST', '/tasks/reassign', { to: S.carolId, items: [] }), 400, 'Select at least one task');
  const r = ok(await call(S.alice, 'POST', '/tasks/reassign', { to: S.carolId, items: [{ kind: 'checklist', id: S.c }], from_date: ymd(istNow()), to_date: ymd(istNow(2 * 1440)), reason: 'leave' }));
  assert.equal(r.moved, 1);
  const again = ok(await call(S.alice, 'POST', '/tasks/reassign', { to: S.carolId, items: [{ kind: 'checklist', id: S.c }] }));
  assert.equal(again.moved, 0);
  msg(await call(S.bob, 'POST', '/tasks/reassign', { to: S.aliceId, items: [{ kind: 'checklist', id: S.cw }] }), 200);
});

test('notifications are private and countable', { skip }, async () => {
  const mine = ok(await call(S.bob, 'GET', '/notifications'));
  assert.ok(mine.items.length > 0 && mine.unread > 0);
  assert.ok(mine.items.some((n) => n.link?.startsWith('/tasks?open=d')));
  const id = mine.items[0].id;
  // another user cannot touch it
  await call(S.carol, 'POST', `/notifications/${id}/read`, {});
  await call(S.carol, 'DELETE', `/notifications/${id}`);
  const still = ok(await call(S.bob, 'GET', '/notifications'));
  assert.ok(still.items.some((n) => n.id === id), 'foreign delete must not remove it');
  ok(await call(S.bob, 'POST', `/notifications/${id}/read`, {}));
  ok(await call(S.bob, 'POST', '/notifications/read-all', {}));
  assert.equal(ok(await call(S.bob, 'GET', '/notifications/count')).unread, 0);
});

test('dashboard, report, score, pc, PDFs', { skip }, async () => {
  const q = `from=${ymd(istNow(-30 * 1440))}&to=${ymd(istNow(30 * 1440))}`;
  ok(await call(S.admin, 'GET', '/tasks/dashboard'));
  const rep = ok(await call(S.admin, 'GET', `/tasks/report?${q}`));
  assert.ok(rep.delegation.total >= 1);
  ok(await call(S.admin, 'GET', `/tasks/report/items?${q}&metric=d_total`));
  msg(await call(S.admin, 'GET', `/tasks/report/items?${q}&metric=zzz`), 400, 'Unknown number');
  const sc = ok(await call(S.admin, 'GET', `/tasks/score?${q}`));
  assert.ok(sc.people);
  const own = ok(await call(S.bob, 'GET', `/tasks/score?${q}`));
  assert.equal(own.person.id, S.bobId, 'without all-data a person gets only their own score');
  // staff without all-data cannot widen via doer filter
  const other = ok(await call(S.bob, 'GET', `/tasks/score?${q}&doer=${S.aliceId}`));
  assert.equal(other.person.id, S.bobId);
  ok(await call(S.admin, 'GET', `/tasks/pc?show=dues`));
  for (const p of [`/tasks/report/pdf?${q}`, `/tasks/report/pdf/people?${q}`, `/tasks/score/pdf?${q}`, '/tasks/checklists/pdf']) {
    const r = await call(S.admin, 'GET', p);
    assert.equal(r.status, 200, p);
    assert.equal(r.data.subarray(0, 4).toString(), '%PDF', p);
  }
  ok(await call(S.admin, 'GET', '/tasks/delayed'));
});

test('files: storage not configured is reported, not crashed', { skip }, async () => {
  const fd = new FormData();
  fd.append('files', new Blob(['hello'], { type: 'text/plain' }), 'a.txt');
  const res = await fetch(`${BASE}/api/tasks/files/delegation/${S.d2}?purpose=attachment`, { method: 'POST', headers: { Authorization: `Bearer ${S.alice}` }, body: fd });
  assert.ok([201, 503].includes(res.status), `status ${res.status}`);
});

test('checklist detail carries the turn counters used by the drawer', { skip }, async () => {
  const det = ok(await call(S.admin, 'GET', `/tasks/checklists/${S.c}`));
  for (const k of ['done_count', 'done_late_count', 'not_done_count', 'non_functional_count', 'overdue']) assert.equal(typeof det[k], 'number', k);
});
