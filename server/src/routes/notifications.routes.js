import { Router } from 'express';
import { query } from '../config/db.js';
import { requireAuth } from '../middleware/auth.js';
import { badRequest } from '../utils/httpError.js';

// Own rows only: every statement is scoped by user_id = req.user.id.
const router = Router();
router.use(requireAuth);

const pid = (v) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1) throw badRequest('Invalid notification');
  return n;
};
const unreadCount = async (uid) =>
  Number((await query('SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND read_at IS NULL', [uid])).rows[0].count);

router.get('/', async (req, res) => {
  const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 30));
  const before = Number(req.query.before) || null;
  const params = [req.user.id, limit + 1];
  let where = 'user_id = $1';
  if (req.query.unread === '1') where += ' AND read_at IS NULL';
  if (before) { params.push(before); where += ` AND id < $${params.length}`; }
  const { rows } = await query(`SELECT * FROM notifications WHERE ${where} ORDER BY id DESC LIMIT $2`, params);
  res.json({ items: rows.slice(0, limit), more: rows.length > limit, unread: await unreadCount(req.user.id) });
});

router.get('/count', async (req, res) => res.json({ unread: await unreadCount(req.user.id) }));

router.post('/read-all', async (req, res) => {
  await query('UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL', [req.user.id]);
  res.json({ unread: 0 });
});

router.post('/:id/read', async (req, res) => {
  await query('UPDATE notifications SET read_at = COALESCE(read_at, NOW()) WHERE id = $1 AND user_id = $2', [pid(req.params.id), req.user.id]);
  res.json({ unread: await unreadCount(req.user.id) });
});
router.post('/:id/unread', async (req, res) => {
  await query('UPDATE notifications SET read_at = NULL WHERE id = $1 AND user_id = $2', [pid(req.params.id), req.user.id]);
  res.json({ unread: await unreadCount(req.user.id) });
});

// DELETE / removes read ones; ?all=1 removes everything
router.delete('/', async (req, res) => {
  await query(`DELETE FROM notifications WHERE user_id = $1 ${req.query.all === '1' ? '' : 'AND read_at IS NOT NULL'}`, [req.user.id]);
  res.json({ unread: await unreadCount(req.user.id) });
});
router.delete('/:id', async (req, res) => {
  await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [pid(req.params.id), req.user.id]);
  res.json({ unread: await unreadCount(req.user.id) });
});

export default router;
