import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../config/db.js';
import { ORDER_PERM } from '../config/o2d.js';
import { can } from '../services/access.js';
import { cuttingQueue, cuttingDetail, saveCutDetails, sendBackToPicking, iocBatches, iocBatchDetail } from '../services/cutting.js';
import { forbidden } from '../utils/httpError.js';

/** O2D › <type> › Cutting. Part of the order's own permissions (view / edit), no separate module. */
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

router.get('/cutting', view, async (req, res) => res.json(await cuttingQueue(req.orderType, listQuery.parse(req.query))));

router.get('/cutting/ioc-batches', view, async (req, res) => res.json({ data: await iocBatches() }));
router.get('/cutting/ioc-batches/:batchNo', view, async (req, res) => res.json({ data: await iocBatchDetail(req.params.batchNo) }));

router.get('/cutting/:id', view, async (req, res) => res.json({ data: await cuttingDetail(req.orderType, req.params.id) }));

const qty = z.coerce.number({ message: 'Enter a number' }).min(0, 'Quantities cannot be negative').max(1e7);
const cutBody = z.object({
  ioc_number: z.string().trim().max(60, 'IOC Number can be at most 60 characters').optional().nullable(),
  items: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        cut_qty: qty.optional(),
        wastage_qty: qty.optional(),
        lot_no: z.string().trim().max(400).optional().nullable(),
        lots: z
          .array(
            z.object({
              pick_id: z.coerce.number().int(),
              picked_qty: qty,
              cut_qty: qty,
              wastage_qty: qty,
              lot_no: z.string().trim().max(60).optional().nullable(),
              ioc_meter: qty.optional().nullable(),
            })
          )
          .max(200)
          .optional(),
      })
    )
    .max(200),
});

router.put('/cutting/:id', edit, async (req, res) => {
  const body = cutBody.parse(req.body);
  const r = await withTransaction((db) => saveCutDetails(db, req.orderType, req.params.id, body, req.user.id));
  if (r.completed) return res.json({ data: r, message: `All items cut — order moved to Delivery Note (${r.delivery_note_no})` });
  res.json({ data: { ...r, order: await cuttingDetail(req.orderType, req.params.id) }, message: 'Cut details saved' });
});

router.post('/cutting/:id/send-back', edit, async (req, res) => {
  const { reason } = z.object({ reason: z.string({ message: 'Reason is required' }).trim().min(1, 'Reason is required').max(1000) }).parse(req.body);
  await withTransaction((db) => sendBackToPicking(db, req.orderType, req.params.id, reason, req.user.id));
  res.json({ message: 'Order sent back to Picking' });
});

export default router;
