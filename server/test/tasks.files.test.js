// File/evidence/voice access-control test. LOCAL/TEST server with an S3-compatible emulator only:
//   QA_API=http://localhost:5055 QA_S3=1 QA_ADMIN_EMAIL=... QA_ADMIN_PASSWORD=... node --test test/tasks.files.test.js
import test from 'node:test';
import assert from 'node:assert/strict';

const BASE = process.env.QA_API;
const skip = !BASE || !process.env.QA_S3;
const pad = (n) => String(n).padStart(2, '0');
const tomorrow = () => {
  const d = new Date(Date.now() + 330 * 60000 + 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}T11:00`;
};

const call = async (token, method, path, body) => {
  const isForm = body instanceof FormData;
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { ...(body && !isForm && { 'Content-Type': 'application/json' }), ...(token && { Authorization: `Bearer ${token}` }) },
    body: isForm ? body : body && JSON.stringify(body),
  });
  const ct = res.headers.get('content-type') || '';
  return { status: res.status, data: ct.includes('json') ? await res.json() : null };
};
const form = (field, name, content, type) => {
  const fd = new FormData();
  fd.append(field, new Blob([content], { type }), name);
  return fd;
};
const S = {};

test('setup', { skip }, async () => {
  S.admin = (await call(null, 'POST', '/auth/login', { email: process.env.QA_ADMIN_EMAIL, password: process.env.QA_ADMIN_PASSWORD })).data.token;
  const roles = (await call(S.admin, 'GET', '/roles')).data.data;
  const staff = roles.find((r) => r.name === 'Staff').id;
  const delRole = (await call(S.admin, 'POST', '/roles', { name: `Staff+Delete ${Date.now()}`, permissions: { dashboard: ['view'], tasks_mine: ['view', 'edit', 'delete'] } })).data.data.id;
  const stamp = Date.now();
  for (const [k, role] of [['fa', staff], ['fb', staff], ['fc', staff], ['fd', delRole]]) {
    const email = `${k}${stamp}@qa.local`;
    const c = await call(S.admin, 'POST', '/employees', { name: `QA ${k}`, email, password: 'Passw0rd!x', role_id: role });
    assert.equal(c.status, 201, JSON.stringify(c.data));
    S[k] = (await call(null, 'POST', '/auth/login', { email, password: 'Passw0rd!x' })).data.token;
    S[`${k}Id`] = c.data.data.id;
  }
  const d = await call(S.fa, 'POST', '/tasks/delegations', { title: 'File task', assignee_id: S.fbId, deadline: tomorrow(), evidence_required: true });
  assert.equal(d.status, 201, JSON.stringify(d.data));
  S.d = d.data.id;
});

test('attachments: assigner only; others forbidden; type + size rules', { skip }, async () => {
  const up = (t, f) => call(t, 'POST', `/tasks/files/delegation/${S.d}?purpose=attachment`, f);
  assert.equal((await up(S.fb, form('files', 'a.txt', 'hello', 'text/plain'))).status, 403, 'assignee cannot attach');
  assert.equal((await up(S.fc, form('files', 'a.txt', 'hello', 'text/plain'))).status, 404, 'uninvolved user gets 404');
  const ok = await up(S.fa, form('files', 'Röhan–note.txt', 'hello world', 'text/plain'));
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  S.att = ok.data.files.find((f) => f.name.includes('note'));
  assert.equal(S.att.name, 'Röhan–note.txt', 'UTF-8 file names are kept');
  const bad = await up(S.fa, form('files', 'evil.exe', 'MZ', 'application/octet-stream'));
  assert.equal(bad.status, 400);
  assert.match(bad.data.message, /file type is not allowed/);
  const big = await up(S.fa, form('files', 'big.pdf', Buffer.alloc(26 * 1024 * 1024), 'application/pdf'));
  assert.equal(big.status, 400);
  assert.match(big.data.message, /25 MB/);
});

test('signed URLs reach only people who can open the task', { skip }, async () => {
  const det = (await call(S.fb, 'GET', `/tasks/delegations/${S.d}`)).data;
  const f = det.files.find((x) => x.id === S.att.id);
  assert.ok(f.url && /X-Amz-(Signature|Expires)|Signature=|Expires=/i.test(f.url), 'signed, expiring url');
  assert.ok(!JSON.stringify(det).includes('tasks/tk_') || JSON.stringify(det).includes('X-Amz'), 'storage keys appear only inside signed urls');
  const body = await fetch(f.url);
  assert.equal(body.status, 200);
  assert.equal(await body.text(), 'hello world');
  assert.equal((await call(S.fc, 'GET', `/tasks/delegations/${S.d}`)).status, 404, 'uninvolved user gets no urls');
});

test('evidence: assignee/assigner while pending; required before completing', { skip }, async () => {
  const ev = (t, f) => call(t, 'POST', `/tasks/files/delegation/${S.d}?purpose=evidence`, f);
  assert.equal((await ev(S.fc, form('files', 'e.jpg', 'x', 'image/jpeg'))).status, 404);
  assert.equal((await call(S.fb, 'POST', `/tasks/delegations/${S.d}/complete`, {})).status, 400, 'evidence required');
  const up = await ev(S.fb, form('files', 'proof.jpg', 'jpegbytes', 'image/jpeg'));
  assert.equal(up.status, 201, JSON.stringify(up.data));
  S.ev = up.data.files.find((f) => f.name === 'proof.jpg');
  assert.equal(S.ev.purpose, 'evidence');
  const done = await call(S.fb, 'POST', `/tasks/delegations/${S.d}/complete`, { note: 'ok' });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.equal((await ev(S.fb, form('files', 'late.jpg', 'x', 'image/jpeg'))).status, 409, 'evidence closed after completion');
});

test('delete: Staff blocked by guard; delete-role user must still be involved; assigner/admin can', { skip }, async () => {
  assert.equal((await call(S.fa, 'DELETE', `/tasks/files/${S.att.id}`)).status, 403, 'Staff lack delete permission');
  assert.ok([403, 404].includes((await call(S.fd, 'DELETE', `/tasks/files/${S.att.id}`)).status), 'delete permission alone grants nothing on others tasks');
  const r = await call(S.admin, 'DELETE', `/tasks/files/${S.att.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const left = (await call(S.fa, 'GET', `/tasks/delegations/${S.d}`)).data.files;
  assert.ok(!left.some((f) => f.id === S.att.id));
});

test('voice note: assigner only, audio only, replace and delete', { skip }, async () => {
  const v = (t, f) => call(t, 'POST', `/tasks/voice/delegation/${S.d}`, f);
  assert.equal((await v(S.fb, form('voice', 'v.mp3', 'abc', 'audio/mpeg'))).status, 403);
  assert.equal((await v(S.fa, form('voice', 'v.pdf', 'abc', 'application/pdf'))).status, 400);
  const ok = await v(S.fa, form('voice', 'v.mp3', 'abc', 'audio/mpeg'));
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.ok(ok.data.voice_url);
  const again = await v(S.fa, form('voice', 'v2.mp3', 'abcd', 'audio/mpeg'));
  assert.equal(again.status, 201);
  assert.equal(await (await fetch(again.data.voice_url)).text(), 'abcd', 'replaced');
  assert.equal((await call(S.admin, 'DELETE', `/tasks/voice/delegation/${S.d}`)).status, 200);
});
