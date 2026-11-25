import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../config/db.js';
import { ORDER_PERM } from '../config/o2d.js';
import { can } from '../services/access.js';
import { packingQueue, lookupCode, packingDetail, createParcel, completePacking, moveToPlanning, sendBackToDn } from '../services/packing.js';
import { forbidden } from '../utils/httpError.js';

/** O2D › <type> › Packing. Uses the order's own permissions (view / edit). */
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

router.get('/packing', view, async (req, res) => res.json(await packingQueue(req.orderType, listQuery.parse(req.query))));
router.get('/packing/lookup', view, async (req, res) => res.json({ data: await lookupCode(req.orderType, String(req.query.code || '').slice(0, 80)) }));
router.get('/packing/:id', view, async (req, res) => res.json({ data: await packingDetail(req.orderType, req.params.id) }));

const parcelBody = z.object({
  request_id: z.string().uuid().optional().nullable(),
  remarks: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
  items: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        qty: z.coerce.number({ message: 'Enter the qty' }).positive('Qty must be more than 0').max(1e7),
        pcs: z.coerce.number().int('Pcs must be a whole number').min(1, 'Pcs must be at least 1').max(100000).default(1),
      })
    )
    .min(1, 'Select at least one item for the parcel')
    .max(200),
});

router.post('/packing/:id/parcels', edit, async (req, res) => {
  const body = parcelBody.parse(req.body);
  const r = await withTransaction((db) => createParcel(db, req.orderType, req.params.id, body, req.user.id));
  res.status(r.duplicate ? 200 : 201).json({ data: { ...r, order: await packingDetail(req.orderType, req.params.id) }, message: `Parcel ${r.parcel_no} ${r.duplicate ? 'was already saved' : 'created'}` });
});

router.post('/packing/:id/complete', edit, async (req, res) => {
  await withTransaction((db) => completePacking(db, req.orderType, req.params.id, req.user.id));
  res.json({ data: await packingDetail(req.orderType, req.params.id), message: 'Packing complete' });
});

router.post('/packing/:id/move-to-planning', edit, async (req, res) => {
  await withTransaction((db) => moveToPlanning(db, req.orderType, req.params.id, req.user.id));
  res.json({ message: 'Order moved to Planning to Dispatch' });
});

router.post('/packing/:id/send-back', edit, async (req, res) => {
  const { reason } = z.object({ reason: z.string({ message: 'Reason is required' }).trim().min(1, 'Reason is required').max(1000) }).parse(req.body);
  await withTransaction((db) => sendBackToDn(db, req.orderType, req.params.id, reason, req.user.id));
  res.json({ message: 'Order sent back to Delivery Note' });
});

export default router;
