import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { hashToken, pendingBills, billsTotal } from '../services/crmPayment.js';
import { badRequest, notFound } from '../utils/httpError.js';

/** No-login endpoints opened from links sent to customers. Access = knowing the one-time token. */
const router = Router();
router.use(rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, message: { message: 'Too many requests. Try again in 15 minutes.' } }));

const tokenHash = (t) => {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) throw notFound('This link is not valid');
  return hashToken(t);
};

async function findByToken(db, token, lock = false) {
  const { rows } = await db.query(
    `SELECT pc.order_id, pc.status, pc.link_expires_at, pc.link_expires_at < NOW() AS expired, pc.promise_date,
            pc.promise_amount::float AS promise_amount, pc.submitted_at, o.enquiry_number, o.client_ref, o.status AS order_status,
            o.workflow_status, c.company_name
       FROM o2d_payment_checks pc JOIN o2d_orders o ON o.id = pc.order_id JOIN clients c ON c.id = o.client_ref
      WHERE pc.link_token_hash = $1${lock ? ' FOR UPDATE OF pc' : ''}`,
    [tokenHash(token)]
  );
  if (!rows[0]) throw notFound('This link is not valid or has been replaced by a newer one');
  return rows[0];
}

const isOpen = (r) => r.status === 'AWAITING_CUSTOMER' && !r.expired && r.order_status === 'ACTIVE' && r.workflow_status === 'PAYMENT_CHECK';

router.get('/payment-promise/:token', async (req, res) => {
  const r = await findByToken({ query }, req.params.token);
  const bills = isOpen(r) ? await pendingBills({ query }, r.client_ref) : [];
  res.json({
    data: {
      company_name: r.company_name,
      enquiry_number: r.enquiry_number,
      state: isOpen(r) ? 'OPEN' : r.status !== 'AWAITING_CUSTOMER' ? 'SUBMITTED' : r.expired ? 'EXPIRED' : 'CLOSED',
      expires_at: r.link_expires_at,
      bills: bills.map(({ bill_reference, bill_date, due_date, amount, days_overdue }) => ({ bill_reference, bill_date, due_date, amount, days_overdue })),
      total: billsTotal(bills),
      promise_date: r.promise_date,
      promise_amount: r.promise_amount,
      submitted_at: r.submitted_at,
    },
  });
});

const promiseSchema = z.object({
  promise_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Choose a valid date'),
  promise_amount: z.coerce.number().positive('Amount must be more than 0').max(1e11, 'Amount is too large'),
  note: z.string().trim().max(500).optional().nullable(),
});

/** Customer's promise -> request for manager approval (order stays at Payment Check until approved). */
router.post('/payment-promise/:token', async (req, res) => {
  const body = promiseSchema.parse(req.body);
  await withTransaction(async (db) => {
    const r = await findByToken(db, req.params.token, true);
    if (!isOpen(r)) throw badRequest(r.status !== 'AWAITING_CUSTOMER' ? 'A payment promise was already submitted' : 'This link has expired. Please contact Fifth Seasons Decor.');
    const { rows } = await db.query(
      "SELECT $1::date >= CURRENT_DATE AS ok_from, $1::date <= CURRENT_DATE + 180 AS ok_to",
      [body.promise_date]
    );
    if (!rows[0].ok_from) throw badRequest('Promise date cannot be in the past');
    if (!rows[0].ok_to) throw badRequest('Promise date must be within the next 6 months');
    await db.query(
      `UPDATE o2d_payment_checks SET status = 'PENDING_APPROVAL', promise_date = $1, promise_amount = $2, customer_note = $3,
              submitted_at = NOW(), updated_at = NOW() WHERE order_id = $4`,
      [body.promise_date, body.promise_amount, body.note || null, r.order_id]
    );
    await db.query(
      `INSERT INTO payment_promise_requests (order_id, pending_amount, pending_bills, promise_date, promise_amount, customer_note)
       SELECT order_id, pending_amount, pending_bills, promise_date, promise_amount, customer_note FROM o2d_payment_checks WHERE order_id = $1`,
      [r.order_id]
    );
    await db.query(
      `INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason)
       VALUES ($1, 'PAYMENT_PROMISE', 'PAYMENT_CHECK', 'PAYMENT_CHECK', $2)`,
      [r.order_id, `Customer promised ₹${body.promise_amount.toLocaleString('en-IN')} by ${body.promise_date} — awaiting manager approval`]
    );
  });
  res.json({ message: 'Thank you. Your payment promise has been sent for approval.' });
});

const publicToken = (t) => {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(t)) throw notFound('This link is not valid');
  return t;
};

/** Proforma Invoice (read-only, printable). */
router.get('/proforma/:token', async (req, res) => {
  const { rows } = await query(
    `SELECT p.proforma_no, p.lines, p.total::float AS total, p.generated_at, o.enquiry_number, o.system_order_no, o.order_type,
            c.client_id, c.company_name, c.full_address, c.city, c.state, c.pin, c.gstin
       FROM o2d_proformas p JOIN o2d_orders o ON o.id = p.order_id JOIN clients c ON c.id = o.client_ref
      WHERE p.share_token = $1`,
    [publicToken(req.params.token)]
  );
  if (!rows[0]) throw notFound('This Proforma Invoice link is not valid');
  res.json({ data: rows[0] });
});

/** Customer-facing milestones; each covers one or more internal stages. */
const MILESTONES = [
  { label: 'Order received', stages: ['DRAFT', 'SUBMITTED'] },
  { label: 'Payment check', stages: ['PAYMENT_CHECK'] },
  { label: 'Stock check', stages: ['STOCK_CHECK'] },
  { label: 'Picking', stages: ['PICKING', 'ROLL_DEPT_REQUIRED', 'IOC_PENDING', 'MATERIAL_RELEASED'] },
  { label: 'Cutting', stages: ['CUTTING', 'CUTTING_COMPLETED'] },
  { label: 'Packing', stages: ['DELIVERY_NOTE', 'PACKING', 'PACKING_COMPLETED'] },
  { label: 'Ready for dispatch', stages: ['PLANNING_TO_DISPATCH', 'DELIVERY_NOTE_GENERATED'] },
  { label: 'Dispatched', stages: ['DISPATCHED'] },
];

/** Order tracking (read-only): milestones with dates, and the items going ahead. */
router.get('/track/:token', async (req, res) => {
  const { rows } = await query(
    `SELECT o.id, o.enquiry_number, o.system_order_no, o.order_type, o.status, o.workflow_status, o.held_from, o.created_at,
            o.transport_name, c.company_name
       FROM o2d_orders o JOIN clients c ON c.id = o.client_ref WHERE o.tracking_token = $1`,
    [publicToken(req.params.token)]
  );
  const o = rows[0];
  if (!o) throw notFound('This tracking link is not valid');
  const [{ rows: events }, { rows: items }] = await Promise.all([
    query('SELECT to_stage, created_at FROM o2d_order_events WHERE order_id = $1 AND to_stage IS NOT NULL ORDER BY id', [o.id]),
    query(
      `SELECT COALESCE(s.alt_item, i.sku_code) AS item, COALESCE(s.final_qty, i.qty)::float AS qty, i.unit
         FROM o2d_order_items i LEFT JOIN o2d_item_stock_checks s ON s.item_id = i.id
        WHERE i.order_id = $1 AND COALESCE(s.final_qty, i.qty) > 0 ORDER BY i.sort_order`,
      [o.id]
    ),
  ]);
  const stage = o.workflow_status === 'ON_HOLD' ? o.held_from : o.workflow_status;
  const current = Math.max(0, MILESTONES.findIndex((m) => m.stages.includes(stage)));
  const milestones = MILESTONES.map((m, i) => {
    const reached = events.find((e) => m.stages.includes(e.to_stage));
    return {
      label: m.label,
      state: i < current ? (reached ? 'DONE' : 'SKIPPED') : i === current ? 'CURRENT' : 'UPCOMING',
      at: i === 0 ? o.created_at : reached?.created_at || null,
    };
  });
  res.json({
    data: {
      order_no: o.system_order_no || o.enquiry_number,
      enquiry_number: o.enquiry_number,
      company_name: o.company_name,
      order_type: o.order_type,
      status: o.status,
      transport_name: o.transport_name,
      milestones,
      items,
    },
  });
});

export default router;
