import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../config/db.js';
import { ORDER_PERM } from '../config/o2d.js';
import { requirePermission } from '../middleware/auth.js';
import { can } from '../services/access.js';
import {
  PICK_TABS, pickingQueue, pickingDetail, linePieces, savePicks, markNotFound, saveProgress, sendToCutting, tryAutoAdvance,
  sendBack, splitOrder, mergeIntoSibling, printData,
} from '../services/picking.js';
import { forbidden } from '../utils/httpError.js';

/** O2D › <type> › Picking. Mounted under /o2d/cut with req.orderType set. */
const router = Router();
const view = requirePermission('picking', 'view');
const edit = requirePermission('picking', 'edit');
/** Moving the order on (Send to Cutting, Split, Merge) needs Picking edit AND the order module's edit. */
const move = (req, res, next) => {
  if (!can(req.user, 'picking', 'edit') || !can(req.user, ORDER_PERM[req.orderType], 'edit')) {
    throw forbidden('Needs Picking edit and Cut Orders edit permission');
  }
  next();
};
const orderEdit = (req, res, next) => {
  if (!can(req.user, ORDER_PERM[req.orderType], 'edit')) throw forbidden();
  next();
};

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

router.get('/picking', view, async (req, res) => res.json(await pickingQueue(req.orderType, listQuery.parse(req.query))));

router.get('/picking/print', view, async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  res.json({ data: await printData(req.orderType, ids) });
});

router.get('/picking/:id', view, async (req, res) => res.json({ data: await pickingDetail(req.orderType, req.params.id) }));

router.get('/picking/:id/lines/:itemId/pieces', view, async (req, res) =>
  res.json({ data: await linePieces(req.orderType, req.params.id, req.params.itemId, String(req.query.tab || 'CUT')) })
);

/** After every save: try the automatic move, then return the fresh order (or where it went). */
async function afterSave(req, res, message) {
  const auto = await tryAutoAdvance(req.orderType, req.params.id, req.user);
  if (auto.moved) return res.json({ data: { moved: true }, message: 'All items picked — order moved to Cutting' });
  res.json({ data: { ...(await pickingDetail(req.orderType, req.params.id)), auto }, message });
}

const picksBody = z.object({
  tab: z.enum(PICK_TABS, { message: 'Source must be CUT, ROLL, SMALL or IN_CHECKING' }),
  stockIds: z.array(z.string()).max(200),
  iocMarked: z.boolean({ message: 'Mark for IOC must be true or false' }).optional().nullable(),
});

router.put('/picking/:id/lines/:itemId/picks', edit, async (req, res) => {
  const body = picksBody.parse(req.body);
  await withTransaction((db) => savePicks(db, req.orderType, req.params.id, req.params.itemId, body, req.user.id));
  await afterSave(req, res, 'Picks saved');
});

router.post('/picking/:id/lines/:itemId/not-found', edit, async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().max(500).optional().nullable().transform((v) => v || null) }).parse(req.body);
  await withTransaction((db) => markNotFound(db, req.orderType, req.params.id, req.params.itemId, reason, req.user.id));
  await afterSave(req, res, 'Marked Not Found');
});

router.post('/picking/:id/batches', edit, async (req, res) => {
  const { remark } = z.object({ remark: z.string().trim().max(500).optional().nullable().transform((v) => v || null) }).parse(req.body);
  const batch = await withTransaction((db) => saveProgress(db, req.orderType, req.params.id, remark, req.user.id));
  await afterSave(req, res, `Picking progress saved as batch ${batch}`);
});

router.post('/picking/:id/auto-advance', edit, async (req, res) => {
  const auto = await tryAutoAdvance(req.orderType, req.params.id, req.user);
  if (auto.moved) return res.json({ data: { moved: true }, message: 'Order moved to Cutting' });
  res.json({ data: { ...(await pickingDetail(req.orderType, req.params.id)), auto }, message: auto.error || auto.reason || 'Not ready to move yet' });
});

router.post('/picking/:id/send-to-cutting', move, async (req, res) => {
  const { allowShortPick } = z.object({ allowShortPick: z.boolean().optional() }).parse(req.body);
  await withTransaction((db) => sendToCutting(db, req.orderType, req.params.id, !!allowShortPick, req.user.id));
  res.json({ message: 'Order sent to Cutting' });
});

router.post('/picking/:id/send-back', orderEdit, async (req, res) => {
  const { reason } = z.object({ reason: z.string({ message: 'Reason is required' }).trim().min(1, 'Reason is required').max(1000) }).parse(req.body);
  await withTransaction((db) => sendBack(db, req.orderType, req.params.id, reason, req.user.id));
  res.json({ message: 'Order sent back to Stock Check' });
});

router.post('/picking/:id/split', move, async (req, res) => {
  const orderNo = await withTransaction((db) => splitOrder(db, req.orderType, req.params.id, req.user.id));
  res.json({ data: { order_no: orderNo, ...(await pickingDetail(req.orderType, req.params.id)) }, message: `Ready items sent to Cutting as ${orderNo}` });
});

router.post('/picking/:id/merge', move, async (req, res) => {
  const { into } = z.object({ into: z.string().uuid() }).parse(req.body);
  const orderNo = await withTransaction((db) => mergeIntoSibling(db, req.orderType, req.params.id, into, req.user.id));
  res.json({ message: `Merged into ${orderNo}` });
});

export default router;
