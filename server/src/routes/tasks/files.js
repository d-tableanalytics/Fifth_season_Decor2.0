import { Router } from 'express';
import multer from 'multer';
import { query } from '../../config/db.js';
import {
  posInt, isInvolved, isAssigner, isAssignee, attachFiles, saveTaskFile, removeTaskFile, taskFileUrl, requireStorage,
  badRequest, forbidden, notFound,
} from '../../services/tasks/common.js';
import { conflict } from '../../utils/httpError.js';

const router = Router();

const MB = 1024 * 1024;
const FILE_EXT = new Set(['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'jpg', 'jpeg', 'png', 'webp', 'mp3', 'm4a', 'wav', 'ogg', 'webm', 'aac', 'mp4', 'mov']);
const VOICE_EXT = new Set(['mp3', 'm4a', 'wav', 'ogg', 'aac']);
const extOf = (n) => (String(n).match(/\.([A-Za-z0-9]{1,8})$/)?.[1] || '').toLowerCase();
// multer hands over latin1; file names are UTF-8
const fixName = (n) => Buffer.from(n, 'latin1').toString('utf8');

const filesUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * MB, files: 5 },
  fileFilter: (req, file, cb) => {
    file.originalname = fixName(file.originalname);
    if (!FILE_EXT.has(extOf(file.originalname))) return cb(badRequest(`${file.originalname}: this file type is not allowed`));
    cb(null, true);
  },
}).array('files', 5);

const voiceUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * MB, files: 1 },
  fileFilter: (req, file, cb) => {
    file.originalname = fixName(file.originalname);
    const ok = String(file.mimetype).startsWith('audio/') || VOICE_EXT.has(extOf(file.originalname));
    if (!ok) return cb(badRequest(`${file.originalname}: this file type is not allowed`));
    cb(null, true);
  },
}).single('voice');

const runUpload = (mw, req, res, sizeMsg) =>
  new Promise((resolve, reject) => {
    mw(req, res, (err) => {
      if (!err) return resolve();
      if (err.code === 'LIMIT_FILE_SIZE') return reject(badRequest(sizeMsg));
      if (err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE') return reject(badRequest('You can upload at most 5 files at a time'));
      reject(err.status ? err : badRequest(err.message));
    });
  });

/**
 * Resolve what a file belongs to. Returns { t: {assigner_id, assignee_id, verifier_id}, status } or null.
 * occurrence -> the people come from its checklist, status from the turn.
 */
async function loadTarget(kind, id) {
  if (kind === 'delegation') {
    return (await query('SELECT assigner_id, assignee_id, verifier_id, status FROM delegations WHERE id = $1', [id])).rows[0] || null;
  }
  if (kind === 'checklist') {
    return (await query('SELECT assigner_id, assignee_id, verifier_id, active, \'pending\' AS status FROM checklists WHERE id = $1', [id])).rows[0] || null;
  }
  if (kind === 'occurrence') {
    return (await query(
      `SELECT c.assigner_id, c.assignee_id, c.verifier_id, o.status FROM checklist_occurrences o JOIN checklists c ON c.id = o.checklist_id WHERE o.id = $1`,
      [id])).rows[0] || null;
  }
  return null;
}
const open = (user, t) => {
  if (!t || !isInvolved(user, t)) throw notFound('Task not found');
  return t;
};

// POST /files/:kind/:id?purpose=attachment|evidence   (multipart field "files")
router.post('/files/:kind/:id', async (req, res) => {
  const { kind } = req.params;
  const id = posInt(req.params.id);
  const purpose = req.query.purpose === 'evidence' ? 'evidence' : req.query.purpose === 'attachment' ? 'attachment' : null;
  if (!['delegation', 'checklist', 'occurrence'].includes(kind) || !id) throw notFound('Task not found');
  if (!purpose) throw badRequest('Choose whether these are attachments or evidence');
  const t = open(req.user, await loadTarget(kind, id));

  if (purpose === 'attachment') {
    if (kind === 'occurrence') throw badRequest('Attachments belong to the task, not to a single turn');
    if (!isAssigner(req.user, t)) throw forbidden('Only the person who assigned the task can attach files');
  } else {
    if (kind === 'checklist') throw badRequest('Evidence is uploaded against a turn of the checklist');
    if (!(isAssignee(req.user, t) || isAssigner(req.user, t))) throw forbidden('Only the doer or the assigner can add evidence');
    if (t.status !== 'pending') throw conflict('The evidence can be added only while the task is open');
  }
  requireStorage();
  await runUpload(filesUpload, req, res, 'A file is larger than 25 MB');
  if (!req.files?.length) throw badRequest('Choose a file to upload');

  const saved = [];
  try {
    for (const f of req.files) {
      const key = await saveTaskFile(f);
      saved.push(key);
      await query(
        `INSERT INTO task_files (kind, ref_id, purpose, file_key, name, mime, size, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [kind, id, purpose, key, f.originalname.slice(0, 255), f.mimetype || null, f.size, req.user.id]);
    }
  } catch (e) {
    await Promise.all(saved.map(removeTaskFile));
    await query('DELETE FROM task_files WHERE file_key = ANY($1::text[])', [saved]);
    throw e;
  }
  const [row] = await attachFiles([{ id }], kind);
  res.status(201).json({ files: row.files });
});

// DELETE /files/:fileId
router.delete('/files/:fileId', async (req, res) => {
  const fid = posInt(req.params.fileId);
  const f = fid && (await query('SELECT * FROM task_files WHERE id = $1', [fid])).rows[0];
  if (!f) throw notFound('File not found');
  const t = open(req.user, await loadTarget(f.kind, f.ref_id));
  if (f.purpose === 'attachment') {
    if (!isAssigner(req.user, t)) throw forbidden('Only the person who assigned the task can remove attachments');
  } else {
    if (!(isAssignee(req.user, t) || isAssigner(req.user, t))) throw forbidden('Only the doer or the assigner can change the evidence');
    if (t.status !== 'pending') throw conflict('The evidence cannot be changed now');
  }
  await query('DELETE FROM task_files WHERE id = $1', [fid]);
  await removeTaskFile(f.file_key);
  const [row] = await attachFiles([{ id: f.ref_id }], f.kind);
  res.json({ files: row.files });
});

// ---------------- voice note (assigner only; delegation / checklist) ----------------
const VOICE_TABLE = { delegation: 'delegations', checklist: 'checklists' };
async function voiceTarget(req) {
  const table = VOICE_TABLE[req.params.kind];
  const id = posInt(req.params.id);
  if (!table || !id) throw notFound('Task not found');
  const row = (await query(`SELECT assigner_id, assignee_id, verifier_id, voice_key FROM ${table} WHERE id = $1`, [id])).rows[0];
  open(req.user, row);
  if (!isAssigner(req.user, row)) throw forbidden('Only the person who assigned the task can add a voice note');
  return { table, id, row };
}

router.post('/voice/:kind/:id', async (req, res) => {
  const { table, id, row } = await voiceTarget(req);
  requireStorage();
  await runUpload(voiceUpload, req, res, 'The voice note is larger than 10 MB');
  if (!req.file) throw badRequest('Record or choose a voice note');
  const key = await saveTaskFile(req.file);
  try {
    await query(`UPDATE ${table} SET voice_key = $1 WHERE id = $2`, [key, id]);
  } catch (e) {
    await removeTaskFile(key);
    throw e;
  }
  await removeTaskFile(row.voice_key); // replace deletes the old one
  res.status(201).json({ voice_url: await taskFileUrl(key) });
});

router.delete('/voice/:kind/:id', async (req, res) => {
  const { table, id, row } = await voiceTarget(req);
  await query(`UPDATE ${table} SET voice_key = NULL WHERE id = $1`, [id]);
  await removeTaskFile(row.voice_key);
  res.json({ voice_url: null });
});

export default router;
