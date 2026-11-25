import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { ZONES } from '../config/zones.js';
import { deliveryList, findByBill, getEntry, entryItems, geocodeMissing, deliverCustomer, deliverCourier } from '../services/deliveryPlanning.js';
import { handoverMeta, saveLists, searchTransporters, linkableOrders, pendingOrders, saveBatch, listEntries, updateEntry } from '../services/dispatchHandover.js';

/** Dispatch Handover (log). view = lists, pending, entries; edit = save handovers, edit entries, manage lists. */
const router = Router();
router.use(requireAuth);
const view = requirePermission('dispatch_pending', 'view');
const edit = requirePermission('dispatch_pending', 'edit');

const text = (max) => z.string().trim().max(max);
const yes = (v) => v === true || v === 'true' || v === '1';

router.get('/meta', view, async (req, res) => res.json({ data: await handoverMeta() }));
router.put('/meta', edit, async (req, res) => {
  const body = z
    .object({
      handover_by: z.array(text(120).min(1)).max(20),
      drivers: z.array(z.object({ name: text(120).min(1, 'Driver name is required'), phone: z.string().trim().regex(/^\d{10}$/, 'Driver phone must be 10 digits').optional().nullable().or(z.literal('').transform(() => null)) })).max(50),
    })
    .parse(req.body);
  res.json({ data: await saveLists(body, req.user.id), message: 'Lists saved' });
});
router.get('/transporters', view, async (req, res) => res.json({ data: await searchTransporters(req.query.search) }));
router.get('/linkable-orders', view, async (req, res) => {
  const zone = ZONES.includes(req.query.zone) ? req.query.zone : undefined;
  res.json({ data: await linkableOrders({ warehousePickup: yes(req.query.warehousePickup), zone }) });
});
router.get('/pending', view, async (req, res) => res.json({ data: await pendingOrders() }));

const listQuery = z.object({
  search: text(100).optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
router.get('/entries', view, async (req, res) => res.json(await listEntries(listQuery.parse(req.query))));

// Rows are validated one by one in the service so a bad row doesn't block the rest
const row = z.object({
  entry_date: z.string().optional().nullable(),
  handover_by: text(120).optional().nullable(),
  warehouse_pickup: z.boolean().optional(),
  zone: z.enum(ZONES).optional().nullable(),
  pickup_party_type: z.string().optional().nullable(),
  pickup_party_name: text(160).optional().nullable(),
  pickup_party_ref_id: text(60).optional().nullable(),
  person_taking: text(120).optional().nullable(),
  phone: text(20).optional().nullable(),
  bill_no: text(100).optional().nullable(),
  parcel_count: z.coerce.number().optional(),
  source: z.enum(['SCANNED', 'MANUAL']).optional(),
  linked_order_id: z.string().optional().nullable(),
});
router.post('/entries/batch', edit, async (req, res) => {
  const { rows } = z.object({ rows: z.array(row).min(1, 'Nothing to save').max(200) }).parse(req.body);
  const results = await saveBatch(rows, req.user.id);
  const ok = results.filter((r) => r.status === 'CREATED' || r.status === 'UPDATED').length;
  res.json({ data: results, message: `${ok} of ${results.length} saved to the dispatch log` });
});
router.put('/entries/:id', edit, async (req, res) => {
  const b = row.parse(req.body);
  await updateEntry(req.params.id, { ...b, parcel_count: Number(b.parcel_count) }, req.user.id);
  res.json({ message: 'Entry updated' });
});

/* ---------------- Delivery Planning & Entry (warehouse-pickup entries) ---------------- */

const deliveryQuery = z.object({
  zone: z.enum(ZONES).optional(),
  status: z.enum(['pending', 'delivered', 'all']).default('pending'),
});
router.get('/delivery', view, async (req, res) => res.json({ data: await deliveryList(deliveryQuery.parse(req.query)) }));
router.get('/delivery/by-bill', view, async (req, res) => res.json({ data: await findByBill(String(req.query.bill_no || '').slice(0, 100)) }));
router.post('/delivery/geocode', edit, async (req, res) => {
  const r = await geocodeMissing();
  res.json({ data: r, message: `Located ${r.found} of ${r.tried}${r.remaining ? ` · ${r.remaining} still missing` : ''}` });
});
router.get('/delivery/:id', view, async (req, res) => res.json({ data: await getEntry(req.params.id) }));
router.get('/delivery/:id/items', view, async (req, res) => res.json({ data: await entryItems(req.params.id) }));

const money = z.coerce.number().min(0, 'Amount cannot be negative').max(1e9).optional().nullable();
const proof = z.string().trim().max(400).optional().nullable().transform((v) => v || null);
router.post('/delivery/:id/deliver-customer', edit, async (req, res) => {
  const b = z
    .object({
      customer_name: z.string({ message: 'Customer name is required' }).trim().min(1, 'Customer name is required').max(160),
      customer_phone: z.string({ message: 'Customer number is required' }).trim().regex(/^\d{10}$/, 'Customer number must be exactly 10 digits'),
      cash_received: money,
      proof_url: proof,
    })
    .parse(req.body);
  res.json({ data: await deliverCustomer(req.params.id, b, req.user.id), message: 'Delivered to customer' });
});
router.post('/delivery/:id/deliver-courier', edit, async (req, res) => {
  const b = z
    .object({
      transport: z.string({ message: 'Courier / transporter name is required' }).trim().min(1, 'Courier / transporter name is required').max(160),
      lr_number: z.string().trim().max(60).optional().nullable().transform((v) => v || null),
      cash_paid: money,
      proof_url: proof,
    })
    .parse(req.body);
  res.json({ data: await deliverCourier(req.params.id, b, req.user.id), message: 'Handed to courier — delivered' });
});

export default router;
