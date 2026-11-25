import { Router } from 'express';
import { z } from 'zod';
import { withTransaction } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { ZONES } from '../config/zones.js';
import { planningList, challanDraft, generateChallan, dispatchOrder, challanPrint } from '../services/dispatchPlanning.js';

/** Planning to Dispatch (Cut + Roll). view = list, challan; edit = Generate Challan, Dispatch — enforced here too. */
const router = Router();
router.use(requireAuth);
const view = requirePermission('planning_dispatch', 'view');
const edit = requirePermission('planning_dispatch', 'edit');

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  zone: z.enum(ZONES).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

router.get('/', view, async (req, res) => res.json(await planningList(listQuery.parse(req.query))));
router.get('/:id', view, async (req, res) => res.json({ data: await challanDraft(req.params.id) }));
router.get('/:id/challan', view, async (req, res) => res.json({ data: await challanPrint(req.params.id) }));

const optText = (max) => z.string().trim().max(max).optional().nullable().transform((v) => v || null);
const challanBody = z.object({
  packed_by: optText(120),
  salesman: optText(120),
  tot_parcels: z.coerce.number().int('Tot Parcels must be a whole number').min(1, 'Tot Parcels must be at least 1').max(10000).default(1),
  items: z
    .array(
      z.object({
        item_id: z.string().uuid(),
        hsn_code: optText(20),
        rate: z.coerce.number({ message: 'Rate is required' }).min(0, 'Rate cannot be negative').max(1e8),
        discount_pct: z.coerce.number().min(0, 'Discount must be 0–100').max(100, 'Discount must be 0–100').default(0),
        box_count: z.coerce.number().int('Box count must be a whole number').min(1, 'Box count must be at least 1').max(100000).default(1),
      })
    )
    .max(500),
});

router.post('/:id/challan', edit, async (req, res) => {
  const body = challanBody.parse(req.body);
  const challan = await withTransaction((db) => generateChallan(db, req.params.id, body, req.user.id));
  res.status(201).json({ data: challan, message: `Challan ${challan.challan_no} generated` });
});

router.post('/:id/dispatch', edit, async (req, res) => {
  const { tally_challan_no } = z.object({ tally_challan_no: optText(60) }).parse(req.body);
  await withTransaction((db) => dispatchOrder(db, req.params.id, tally_challan_no, req.user.id));
  res.json({ message: 'Order dispatched' });
});

export default router;
