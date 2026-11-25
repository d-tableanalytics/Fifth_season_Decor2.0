import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../config/db.js';
import { ORDER_PERM } from '../config/o2d.js';
import { can } from '../services/access.js';
import { dnQueue, dnDetail, editDnNumber, saveLr, sendLr, moveToPacking, sendBackToCutting, dnPrint } from '../services/deliveryNote.js';
import { forbidden } from '../utils/httpError.js';

/** O2D › <type> › Delivery Note. Uses the order's own permissions (view / edit). */
const router = Router();
const allow = (action) => (req, res, next) => {
  if (!can(req.user, ORDER_PERM[req.orderType], action)) throw forbidden();
  next();
};
const view = allow('view');
const edit = allow('edit');

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const ids = (v) => String(v || '').split(',').map((x) => x.trim()).filter(Boolean).slice(0, 500);

router.get('/delivery-note', view, async (req, res) => res.json(await dnQueue(req.orderType, listQuery.parse(req.query))));

router.get('/delivery-note/print', view, async (req, res) =>
  res.json({ data: await dnPrint(req.orderType, { orderIds: ids(req.query.orders), itemIds: ids(req.query.items) }) })
);

router.get('/delivery-note/:id', view, async (req, res) => res.json({ data: await dnDetail(req.orderType, req.params.id) }));

router.put('/delivery-note/:id/number', edit, async (req, res) => {
  const { delivery_note_no } = z
    .object({ delivery_note_no: z.string({ message: 'Enter the Delivery Note number' }).trim().min(1, 'Enter the Delivery Note number').max(30, 'At most 30 characters') })
    .parse(req.body);
  await withTransaction((db) => editDnNumber(db, req.orderType, req.params.id, delivery_note_no, req.user.id));
  res.json({ data: await dnDetail(req.orderType, req.params.id), message: 'Delivery Note number changed — it is now locked' });
});

router.put('/delivery-note/:id/lr', edit, async (req, res) => {
  const { lr_number } = z.object({ lr_number: z.string().trim().max(60, 'At most 60 characters').nullable().transform((v) => v || null) }).parse(req.body);
  await withTransaction((db) => saveLr(db, req.orderType, req.params.id, lr_number, req.user.id));
  res.json({ data: await dnDetail(req.orderType, req.params.id), message: 'LR number saved' });
});

router.post('/delivery-note/:id/lr/send', edit, async (req, res) => {
  const to = await sendLr(req.orderType, req.params.id, req.user.id);
  res.json({ data: await dnDetail(req.orderType, req.params.id), message: `LR sent on WhatsApp to ${to}` });
});

router.post('/delivery-note/:id/move-to-packing', edit, async (req, res) => {
  await withTransaction((db) => moveToPacking(db, req.orderType, req.params.id, req.user.id));
  res.json({ message: 'Order moved to Packing' });
});

router.post('/delivery-note/:id/send-back', edit, async (req, res) => {
  const { reason } = z.object({ reason: z.string({ message: 'Reason is required' }).trim().min(1, 'Reason is required').max(1000) }).parse(req.body);
  await withTransaction((db) => sendBackToCutting(db, req.orderType, req.params.id, reason, req.user.id));
  res.json({ message: 'Order sent back to Cutting' });
});

export default router;
