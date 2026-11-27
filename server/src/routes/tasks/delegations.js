import { Router } from 'express';
import { query, withTransaction } from '../../config/db.js';
import { notify } from '../../services/notifications.js';
import {
  PRIORITIES, posInt, cleanText, optText, visibleSql, isInvolved, isAssigner, isAssignee, isVerifier, verifierOf,
  cleanCommon, cleanCheckpoints, assertNotHoliday, attachFiles, withVoiceUrl, removeTaskFile, delegationLink,
  badRequest, forbidden, notFound,
} from '../../services/tasks/common.js';
import { conflict } from '../../utils/httpError.js';
import { fmtDateTime, parseDeadline, todayIST, istDate, diffDays } from '../../utils/ist.js';

const router = Router();

const SELECT = `
  SELECT d.*, a.name AS assigner_name, s.name AS assignee_name, v.name AS verifier_name, c.name AS category_name,
         (SELECT COUNT(*) FROM deadline_revisions r WHERE r.delegation_id = d.id AND r.status = 'approved')::int AS revisions,
         EXISTS (SELECT 1 FROM deadline_revisions r WHERE r.delegation_id = d.id AND r.status = 'pending') AS revision_pending
    FROM delegations d
    JOIN users a ON a.id = d.assigner_id
    JOIN users s ON s.id = d.assignee_id
    LEFT JOIN users v ON v.id = d.verifier_id
    LEFT JOIN task_categories c ON c.id = d.category_id`;

const shape = (r) => {
  const overdue = r.status === 'pending' && new Date(r.deadline) < new Date();
  r.is_overdue = overdue;
  r.overdue_days = overdue ? Math.max(0, diffDays(todayIST(), istDate(r.deadline))) : 0;
  r.verifier_effective_id = verifierOf(r);
  return r;
};

async function present(rows) {
  rows.forEach(shape);
  await attachFiles(rows, 'delegation');
  await withVoiceUrl(rows);
  return rows;
}

async function detail(id, user) {
  const { rows } = await query(`${SELECT} WHERE d.id = $1`, [id]);
  const row = rows[0];
  if (!row || !isInvolved(user, row)) throw notFound('Task not found');
  await present([row]);
  const [log, re] = await Promise.all([
    query(
      `SELECT r.*, rb.name AS requested_by_name, db.name AS decided_by_name FROM deadline_revisions r
         LEFT JOIN users rb ON rb.id = r.requested_by LEFT JOIN users db ON db.id = r.decided_by
        WHERE r.delegation_id = $1 ORDER BY r.id DESC`, [id]),
    query(
      `SELECT r.*, uf.name AS from_name, ut.name AS to_name, ub.name AS by_name FROM task_reassignments r
         LEFT JOIN users uf ON uf.id = r.from_user_id LEFT JOIN users ut ON ut.id = r.to_user_id LEFT JOIN users ub ON ub.id = r.by_user_id
        WHERE r.kind = 'delegation' AND r.task_id = $1 ORDER BY r.id`, [id]),
  ]);
  row.revision_log = log.rows;
  row.pending_revision = log.rows.find((x) => x.status === 'pending') || null;
  row.reassignments = re.rows;
  return row;
}
const respond = async (res, id, user, status = 200) => res.status(status).json(await detail(id, user));

/** Lock + load the raw row inside a transaction; 404 when the user may not open it. */
async function lockRow(db, id, user) {
  const row = (await db.query('SELECT * FROM delegations WHERE id = $1 FOR UPDATE', [id])).rows[0];
  if (!row || !isInvolved(user, row)) throw notFound('Task not found');
  return row;
}
const pid = (v) => posInt(v) ?? (() => { throw notFound('Task not found'); })();
const asBool = (v) => v === true || v === 'true' || v === 1 || v === '1';

async function checkNewDeadline(v, { label = 'deadline', required = null } = {}) {
  if (!v) { if (required) throw badRequest(required); return null; }
  const d = parseDeadline(v);
  if (!d) throw badRequest(required || 'Choose the deadline');
  if (d.getTime() < Date.now() - 60000) throw badRequest(label === 'deadline' ? 'The deadline cannot be in the past' : 'The new deadline cannot be in the past');
  await assertNotHoliday(d, label);
  return d;
}

// ---------------- list ----------------
router.get('/delegations', async (req, res) => {
  const q = req.query;
  const scope = ['mine', 'assigned', 'all'].includes(q.scope) ? q.scope : 'mine';
  const params = [];
  const where = [visibleSql(req.user, scope, 'd', params)];
  const status = q.status;
  const today = todayIST();
  if (status === 'overdue') where.push(`d.status = 'pending' AND d.deadline < NOW()`);
  else if (status === 'today') { params.push(today); where.push(`d.status = 'pending' AND (d.deadline AT TIME ZONE 'Asia/Kolkata')::date = $${params.length}::date`); }
  else if (['pending', 'submitted', 'completed'].includes(status)) { params.push(status); where.push(`d.status = $${params.length}`); }
  if (posInt(q.category)) { params.push(posInt(q.category)); where.push(`d.category_id = $${params.length}`); }
  if (PRIORITIES.includes(q.priority)) { params.push(q.priority); where.push(`d.priority = $${params.length}`); }
  if (posInt(q.assignee)) { params.push(posInt(q.assignee)); where.push(`d.assignee_id = $${params.length}`); }
  const search = cleanText(q.search, 100);
  if (search) {
    params.push(search.replace(/[\\%_]/g, (m) => `\\${m}`));
    where.push(`(d.title ILIKE '%' || $${params.length} || '%' OR d.description ILIKE '%' || $${params.length} || '%')`);
  }
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
  const page = Math.max(1, Number(q.page) || 1);
  const W = where.join(' AND ');
  const total = Number((await query(`SELECT COUNT(*) FROM delegations d WHERE ${W}`, params)).rows[0].count);
  const { rows } = await query(
    `${SELECT} WHERE ${W} ORDER BY (d.status = 'completed'), d.deadline, d.id LIMIT ${limit} OFFSET ${(page - 1) * limit}`, params);
  await present(rows);
  res.json({ data: rows, total, page, limit });
});

// ---------------- create ----------------
router.post('/delegations', async (req, res) => {
  const b = req.body || {};
  const id = await withTransaction(async (db) => {
    const c = await cleanCommon(b, db);
    const deadline = await checkNewDeadline(b.deadline, { required: 'Choose the deadline' });
    const checkpoints = cleanCheckpoints(b.checkpoints).map((text) => ({ text, done: false }));
    const { rows } = await db.query(
      `INSERT INTO delegations (title, description, assigner_id, assignee_id, verifier_id, category_id, priority, evidence_required,
         verification_required, deadline, checkpoints, reminders)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb) RETURNING id`,
      [c.title, c.description, req.user.id, c.assignee_id, c.verifier_id, c.category_id, c.priority, c.evidence_required,
        c.verification_required, deadline, JSON.stringify(checkpoints), JSON.stringify(c.reminders)]);
    await notify(c.assignee_id, {
      kind: 'assigned', title: `New task for you: ${c.title}`, body: `Deadline ${fmtDateTime(deadline)} · by ${req.user.name}`,
      link: delegationLink(rows[0].id), actor: req.user.name,
    }, req.user.id, db);
    return rows[0].id;
  });
  await respond(res, id, req.user, 201);
});

router.get('/delegations/:id', async (req, res) => res.json(await detail(pid(req.params.id), req.user)));

// ---------------- edit ----------------
router.put('/delegations/:id', async (req, res) => {
  const id = pid(req.params.id);
  const b = req.body || {};
  await withTransaction(async (db) => {
    const cur = await lockRow(db, id, req.user);
    if (!isAssigner(req.user, cur)) throw forbidden('Only the person who assigned the task can change it');
    if (cur.status === 'completed') throw conflict('A completed task cannot be changed');
    const c = await cleanCommon(b, db);
    let deadline = new Date(cur.deadline);
    const changed = b.deadline && parseDeadline(b.deadline)?.getTime() !== deadline.getTime();
    if (b.deadline && !parseDeadline(b.deadline)) throw badRequest('Choose the deadline');
    if (changed) {
      deadline = parseDeadline(b.deadline);
      await assertNotHoliday(deadline, 'deadline', db);
    }
    const oldTexts = cur.checkpoints || [];
    const checkpoints = cleanCheckpoints(b.checkpoints).map((text) => ({ text, done: oldTexts.some((o) => o.text === text && o.done) }));
    const remindersChanged = JSON.stringify(c.reminders) !== JSON.stringify(cur.reminders);
    await db.query(
      `UPDATE delegations SET title=$1, description=$2, assignee_id=$3, verifier_id=$4, category_id=$5, priority=$6, evidence_required=$7,
         verification_required=$8, deadline=$9, checkpoints=$10::jsonb, reminders=$11::jsonb,
         reminders_sent = CASE WHEN $12 OR $13 THEN '[]'::jsonb ELSE reminders_sent END, updated_at = NOW() WHERE id=$14`,
      [c.title, c.description, c.assignee_id, c.verifier_id, c.category_id, c.priority, c.evidence_required, c.verification_required,
        deadline, JSON.stringify(checkpoints), JSON.stringify(c.reminders), changed || c.assignee_id !== cur.assignee_id, remindersChanged, id]);
    if (c.priority !== cur.priority)
      await db.query('INSERT INTO task_priority_log (kind, task_id, old_priority, new_priority, by_user_id) VALUES ($1,$2,$3,$4,$5)',
        ['delegation', id, cur.priority, c.priority, req.user.id]);
    if (changed) {
      await db.query(
        `UPDATE deadline_revisions SET status='rejected', decided_by=$2, decided_at=NOW(), decision_remark='The deadline was changed by the assigner'
          WHERE delegation_id=$1 AND status='pending'`, [id, req.user.id]);
      await db.query(
        `INSERT INTO deadline_revisions (delegation_id, source, requested_by, old_deadline, new_deadline, reason, status, decided_by, decided_at)
         VALUES ($1,'assigner',$2,$3,$4,'Changed by the assigner','approved',$2,NOW())`, [id, req.user.id, cur.deadline, deadline]);
    }
    const link = delegationLink(id);
    if (c.assignee_id !== cur.assignee_id)
      await notify(c.assignee_id, { kind: 'assigned', title: `Task assigned to you: ${c.title}`, body: `by ${req.user.name}`, link, actor: req.user.name }, req.user.id, db);
    if (changed)
      await notify(c.assignee_id, { kind: 'status', title: `Deadline changed: ${c.title}`, body: `New deadline ${fmtDateTime(deadline)}`, link, actor: req.user.name }, req.user.id, db);
  });
  await respond(res, id, req.user);
});

// ---------------- delete ----------------
router.delete('/delegations/:id', async (req, res) => {
  const id = pid(req.params.id);
  const keys = await withTransaction(async (db) => {
    const cur = await lockRow(db, id, req.user);
    if (!isAssigner(req.user, cur)) throw forbidden('Only the person who assigned the task can delete it');
    const files = (await db.query("SELECT file_key FROM task_files WHERE kind = 'delegation' AND ref_id = $1", [id])).rows.map((f) => f.file_key);
    await db.query("DELETE FROM task_files WHERE kind = 'delegation' AND ref_id = $1", [id]);
    await db.query("DELETE FROM task_reassignments WHERE kind = 'delegation' AND task_id = $1", [id]);
    await db.query("DELETE FROM task_priority_log WHERE kind = 'delegation' AND task_id = $1", [id]);
    await db.query('DELETE FROM delegations WHERE id = $1', [id]);
    return [...files, cur.voice_key].filter(Boolean);
  });
  await Promise.all(keys.map(removeTaskFile));
  res.json({ message: 'Task deleted' });
});

// ---------------- checkpoints ----------------
router.put('/delegations/:id/checkpoints', async (req, res) => {
  const id = pid(req.params.id);
  await withTransaction(async (db) => {
    const cur = await lockRow(db, id, req.user);
    if (!isAssignee(req.user, cur)) throw forbidden('Only the person doing the task can tick its checkpoints');
    if (cur.status !== 'pending') throw conflict('This task is no longer open');
    const done = Array.isArray(req.body?.done) ? req.body.done : [];
    const cps = (cur.checkpoints || []).map((c, i) => ({ text: c.text, done: asBool(done[i]) }));
    await db.query('UPDATE delegations SET checkpoints = $1::jsonb, updated_at = NOW() WHERE id = $2', [JSON.stringify(cps), id]);
  });
  await respond(res, id, req.user);
});

// ---------------- complete ----------------
router.post('/delegations/:id/complete', async (req, res) => {
  const id = pid(req.params.id);
  await withTransaction(async (db) => {
    const cur = await lockRow(db, id, req.user);
    if (!isAssignee(req.user, cur)) throw forbidden('Only the person doing the task can complete it');
    if (cur.status !== 'pending') throw conflict('This task is already completed or waiting for verification');
    if ((cur.checkpoints || []).some((c) => !c.done)) throw badRequest('Tick every checkpoint first');
    if (cur.evidence_required) {
      const n = Number((await db.query("SELECT COUNT(*) FROM task_files WHERE kind='delegation' AND ref_id=$1 AND purpose='evidence'", [id])).rows[0].count);
      if (!n) throw badRequest('Upload the evidence first');
    }
    const note = optText(req.body?.note, 1000);
    const verify = cur.verification_required;
    await db.query(
      `UPDATE delegations SET status=$1, submitted_at=NOW(), completed_at=$2, completed_note=$3, verify_remark=NULL, updated_at=NOW() WHERE id=$4`,
      [verify ? 'submitted' : 'completed', verify ? null : new Date(), note, id]);
    if (verify)
      await notify(verifierOf(cur), { kind: 'status', title: `Verify the task: ${cur.title}`, body: `by ${req.user.name}`, link: delegationLink(id, true), actor: req.user.name }, req.user.id, db);
    else
      await notify(cur.assigner_id, { kind: 'status', title: `Task completed: ${cur.title}`, body: `by ${req.user.name}`, link: delegationLink(id, true), actor: req.user.name }, req.user.id, db);
  });
  await respond(res, id, req.user);
});

// ---------------- verify / send back ----------------
router.post('/delegations/:id/verify', async (req, res) => {
  const id = pid(req.params.id);
  const b = req.body || {};
  await withTransaction(async (db) => {
    const cur = await lockRow(db, id, req.user);
    if (!isVerifier(req.user, cur)) throw forbidden('Only the person who verifies this task can do that');
    if (cur.status !== 'submitted') throw conflict('This task is not waiting for verification');
    const approve = asBool(b.approve);
    const remark = optText(b.remark, 500);
    let extra = '';
    if (approve) {
      await db.query(
        `UPDATE delegations SET status='completed', completed_at=NOW(), verified_by=$1, verified_at=NOW(), verify_remark=$2, updated_at=NOW() WHERE id=$3`,
        [req.user.id, remark, id]);
    } else {
      if (!remark) throw badRequest('Write why the task is sent back');
      const nd = await checkNewDeadline(b.deadline, { label: 'new deadline' });
      const cps = (cur.checkpoints || []).map((c) => ({ text: c.text, done: false }));
      await db.query(
        `UPDATE delegations SET status='pending', submitted_at=NULL, completed_at=NULL, checkpoints=$1::jsonb, reject_count=reject_count+1,
           verified_by=$2, verified_at=NOW(), verify_remark=$3, deadline=COALESCE($4, deadline),
           reminders_sent = CASE WHEN $4::timestamptz IS NULL THEN reminders_sent ELSE '[]'::jsonb END, updated_at=NOW() WHERE id=$5`,
        [JSON.stringify(cps), req.user.id, remark, nd, id]);
      if (nd) {
        await db.query(
          `INSERT INTO deadline_revisions (delegation_id, source, requested_by, old_deadline, new_deadline, reason, status, decided_by, decided_at)
           VALUES ($1,'send_back',$2,$3,$4,$5,'approved',$2,NOW())`, [id, req.user.id, cur.deadline, nd, remark]);
        extra = ` New deadline: ${fmtDateTime(nd)}`;
      }
    }
    await notify(cur.assignee_id, {
      kind: 'status', title: `${approve ? 'Task verified' : 'Task sent back'}: ${cur.title}`,
      body: `${remark || `by ${req.user.name}`}${extra}`, link: delegationLink(id), actor: req.user.name,
    }, req.user.id, db);
  });
  await respond(res, id, req.user);
});

// ---------------- deadline revisions ----------------
router.post('/delegations/:id/revisions', async (req, res) => {
  const id = pid(req.params.id);
  const b = req.body || {};
  await withTransaction(async (db) => {
    const cur = await lockRow(db, id, req.user);
    if (!isAssignee(req.user, cur)) throw forbidden('Only the person doing the task can ask for a new deadline');
    if (cur.status !== 'pending') throw conflict('The deadline can be revised only while the task is open');
    const nd = parseDeadline(b.new_deadline);
    if (!nd) throw badRequest('Choose the new deadline');
    if (nd.getTime() <= Date.now()) throw badRequest('The new deadline must be in the future');
    if (nd.getTime() === new Date(cur.deadline).getTime()) throw badRequest('That is the current deadline');
    await assertNotHoliday(nd, 'new deadline', db);
    const reason = cleanText(b.reason, 500);
    if (!reason) throw badRequest('Write why the deadline has to be revised');
    if ((await db.query("SELECT 1 FROM deadline_revisions WHERE delegation_id=$1 AND status='pending'", [id])).rowCount)
      throw conflict('A request is already waiting for the assigner');
    await db.query(
      `INSERT INTO deadline_revisions (delegation_id, source, requested_by, old_deadline, new_deadline, reason) VALUES ($1,'request',$2,$3,$4,$5)`,
      [id, req.user.id, cur.deadline, nd, reason]);
    await notify(cur.assigner_id, {
      kind: 'status', title: `Deadline revision requested: ${cur.title}`,
      body: `${req.user.name} asks for ${fmtDateTime(nd)} (now ${fmtDateTime(cur.deadline)}). ${reason}`,
      link: delegationLink(id, true), actor: req.user.name,
    }, req.user.id, db);
  });
  await respond(res, id, req.user, 201);
});

router.post('/delegations/:id/revisions/:rid/decide', async (req, res) => {
  const id = pid(req.params.id);
  const rid = posInt(req.params.rid);
  const b = req.body || {};
  await withTransaction(async (db) => {
    const cur = await lockRow(db, id, req.user);
    if (!isAssigner(req.user, cur)) throw forbidden('Only the person who assigned the task can decide');
    const rev = rid && (await db.query("SELECT * FROM deadline_revisions WHERE id=$1 AND delegation_id=$2 AND status='pending' FOR UPDATE", [rid, id])).rows[0];
    if (!rev) throw conflict('There is no waiting request');
    const remark = optText(b.remark, 500);
    const approve = asBool(b.approve);
    let title;
    let body;
    if (approve) {
      if (cur.status !== 'pending') throw conflict('The deadline can be revised only while the task is open');
      let nd = new Date(rev.new_deadline);
      if (b.new_deadline) {
        nd = parseDeadline(b.new_deadline);
        if (!nd) throw badRequest('Choose the new deadline');
        if (nd.getTime() <= Date.now()) throw badRequest('The new deadline must be in the future');
        await assertNotHoliday(nd, 'new deadline', db);
      }
      await db.query(
        `UPDATE deadline_revisions SET status='approved', new_deadline=$1, decided_by=$2, decided_at=NOW(), decision_remark=$3 WHERE id=$4`,
        [nd, req.user.id, remark, rid]);
      await db.query("UPDATE delegations SET deadline=$1, reminders_sent='[]'::jsonb, updated_at=NOW() WHERE id=$2", [nd, id]);
      title = `New deadline approved: ${cur.title}`;
      body = `Deadline is now ${fmtDateTime(nd)}.${remark ? ` ${remark}` : ''}`;
    } else {
      if (!remark) throw badRequest('Write why the request is rejected');
      await db.query(
        `UPDATE deadline_revisions SET status='rejected', decided_by=$1, decided_at=NOW(), decision_remark=$2 WHERE id=$3`, [req.user.id, remark, rid]);
      title = `Deadline revision rejected: ${cur.title}`;
      body = remark;
    }
    await notify(cur.assignee_id, { kind: 'status', title, body, link: delegationLink(id), actor: req.user.name }, req.user.id, db);
  });
  await respond(res, id, req.user);
});

// ---------------- delayed: everything open past its time, oldest first ----------------
router.get('/delayed', async (req, res) => {
  const scope = ['mine', 'assigned', 'all'].includes(req.query.scope) ? req.query.scope : 'mine';
  const p1 = [];
  const w1 = visibleSql(req.user, scope, 'd', p1);
  const dels = await query(
    `SELECT d.id, d.title, d.deadline AS due_at, d.priority, a.name AS assigner_name, s.name AS assignee_name
       FROM delegations d JOIN users a ON a.id = d.assigner_id JOIN users s ON s.id = d.assignee_id
      WHERE d.status = 'pending' AND d.deadline < NOW() AND ${w1} ORDER BY d.deadline LIMIT 500`, p1);
  const p2 = [];
  const w2 = visibleSql(req.user, scope, 'c', p2);
  const occ = await query(
    `SELECT o.id AS occurrence_id, c.id, c.title, o.due_at, c.priority, a.name AS assigner_name, s.name AS assignee_name
       FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id
       JOIN users a ON a.id = c.assigner_id JOIN users s ON s.id = c.assignee_id
      WHERE c.active AND o.status = 'pending' AND o.due_at < NOW() AND ${w2} ORDER BY o.due_at LIMIT 500`, p2);
  const today = todayIST();
  const data = [
    ...dels.rows.map((r) => ({ kind: 'delegation', ...r, overdue_days: Math.max(0, diffDays(today, istDate(r.due_at))), link: delegationLink(r.id) })),
    ...occ.rows.map((r) => ({ kind: 'checklist', ...r, overdue_days: Math.max(0, diffDays(today, istDate(r.due_at))), link: `/tasks?tab=checklists&open=c${r.id}` })),
  ].sort((x, y) => new Date(x.due_at) - new Date(y.due_at));
  res.json({ data });
});

export default router;
