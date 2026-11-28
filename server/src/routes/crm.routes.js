import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { pendingBills, hasOverdue, billsTotal, issueLink, ledgerMessage, LEDGER_RECIPIENTS } from '../services/crmPayment.js';
import { resolveRecipients, sendAndLog, eventMessage } from '../services/whatsapp.js';
import {
  DECISIONS, DEPTS, stockDetail, itemAvailability, saveItemDecision, holdFromStockCheck, completeStockCheck, generateProforma, recordAdvance,
} from '../services/stockCheck.js';
import { syncAlternatives, ALT_LOG_MODULE } from '../services/alternatives.js';
import { syncLogs } from '../services/masterSync.js';
import { badRequest, notFound } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);
const payView = requirePermission('crm_payment_check', 'view');
const payEdit = requirePermission('crm_payment_check', 'edit');
const stockView = requirePermission('crm_stock_check', 'view');
const stockEdit = requirePermission('crm_stock_check', 'edit');

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);
const like = (s) => `%${s.replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
/** Public base URL for customer links — set APP_PUBLIC_URL to the live domain. */
const appLink = (path) => `${(process.env.APP_PUBLIC_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '')}${path}`;
const publicLink = (token) => appLink(`/payment-promise/${token}`);

const listQuery = z.object({
  tab: z.enum(['awaiting', 'pending_approval']).default('awaiting'),
  type: z.enum(['CUT', 'ROLL']).default('CUT'),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});
const TAB_STATUS = { awaiting: 'AWAITING_CUSTOMER', pending_approval: 'PENDING_APPROVAL' };
/** How many payment promises (requests) the client has sent across all its orders, and how they were decided. */
const PROMISE_HISTORY_SQL = `(SELECT json_build_object('total', COUNT(*), 'approved', COUNT(*) FILTER (WHERE ph.status = 'APPROVED'),
    'rejected', COUNT(*) FILTER (WHERE ph.status = 'REJECTED'), 'pending', COUNT(*) FILTER (WHERE ph.status = 'PENDING'))
   FROM payment_promise_requests ph JOIN o2d_orders po ON po.id = ph.order_id WHERE po.client_ref = c.id) AS promise_history`;
const SEARCH_SQL = (n) => `(o.enquiry_number ILIKE $${n} OR c.client_id ILIKE $${n} OR c.company_name ILIKE $${n})`;

/** Active order at Payment Check (row-locked when db is a transaction). */
async function paymentOrder(db, id, lock = false) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await db.query(
    `SELECT o.id, o.enquiry_number, o.client_ref, c.company_name, pc.status AS payment_status
       FROM o2d_orders o JOIN clients c ON c.id = o.client_ref JOIN o2d_payment_checks pc ON pc.order_id = o.id
      WHERE o.id = $1 AND o.status = 'ACTIVE' AND o.workflow_status = 'PAYMENT_CHECK'${lock ? ' FOR UPDATE OF o, pc' : ''}`,
    [id]
  );
  if (!rows[0]) throw notFound('Order is not at Payment Check');
  return rows[0];
}

/* ---------------- Payment Check ---------------- */

router.get('/payment-check', payView, async (req, res) => {
  const q = listQuery.parse(req.query);
  const params = [TAB_STATUS[q.tab], q.type];
  let search = '';
  if (q.search) {
    params.push(like(q.search));
    search = ` AND ${SEARCH_SQL(3)}`;
  }
  const base = `FROM o2d_orders o JOIN o2d_payment_checks pc ON pc.order_id = o.id JOIN clients c ON c.id = o.client_ref
                WHERE o.status = 'ACTIVE' AND o.workflow_status = 'PAYMENT_CHECK' AND o.order_type = $1`;
  const [{ rows }, { rows: counts }] = await Promise.all([
    query(
      `SELECT o.id, o.order_type, o.enquiry_number, o.client_ref, c.client_id, c.company_name, c.city, ${PROMISE_HISTORY_SQL},
              pc.pending_amount::float AS pending_amount, pc.pending_bills, pc.link_sent_at, pc.link_expires_at,
              pc.promise_date, pc.promise_amount::float AS promise_amount, pc.submitted_at, pc.created_at AS checked_at,
              COUNT(*) OVER()::int AS total_count
         ${base.replace('$1', '$2')} AND pc.status = $1${search}
        ORDER BY ${q.tab === 'pending_approval' ? 'pc.submitted_at' : 'pc.created_at'} DESC, o.id
        LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
      params
    ),
    query(`SELECT pc.status, COUNT(*)::int AS n ${base} GROUP BY pc.status`, [q.type]),
  ]);
  res.json({
    data: rows.map(({ total_count, ...r }) => r),
    total: rows[0]?.total_count ?? 0,
    counts: Object.fromEntries(Object.entries(TAB_STATUS).map(([tab, s]) => [tab, counts.find((c) => c.status === s)?.n || 0])),
  });
});

router.get('/payment-check/:id', payView, async (req, res) => {
  const o = await paymentOrder({ query }, req.params.id);
  const [{ rows }, { rows: items }, bills] = await Promise.all([
    query(
      `SELECT o.id, o.order_type, o.enquiry_number, o.created_at, o.customer_remark,
              c.id AS client_ref, c.client_id, c.company_name, c.city, c.state, c.owner_name, c.owner_contact_no, c.owner_whatsapp_no,
              c.accounts_person_name, c.accounts_person_whatsapp_no, c.customer_sales_person_name, c.customer_sales_person_whatsapp_no,
              c.customer_sales_person_contact, c.whatsapp_group_id, c.whatsapp_group_name, c.sales_person_emp_id, ${PROMISE_HISTORY_SQL},
              pc.status AS payment_status, pc.pending_amount::float AS pending_amount, pc.pending_bills, pc.link_sent_at,
              pc.link_expires_at, pc.promise_date, pc.promise_amount::float AS promise_amount, pc.customer_note, pc.submitted_at,
              u.name AS link_sent_by
         FROM o2d_orders o JOIN clients c ON c.id = o.client_ref JOIN o2d_payment_checks pc ON pc.order_id = o.id
         LEFT JOIN users u ON u.id = pc.link_sent_by WHERE o.id = $1`,
      [o.id]
    ),
    query('SELECT sku_code, qty::float AS qty, unit FROM o2d_order_items WHERE order_id = $1 ORDER BY sort_order', [o.id]),
    pendingBills({ query }, o.client_ref),
  ]);
  res.json({ data: { ...rows[0], items, bills, bills_total: billsTotal(bills) } });
});

/** New customer link without sending it (CRM shares it while on the call). Replaces any earlier link. */
router.post('/payment-check/:id/link', payEdit, async (req, res) => {
  const token = await withTransaction(async (db) => {
    const o = await paymentOrder(db, req.params.id, true);
    if (o.payment_status !== 'AWAITING_CUSTOMER') throw badRequest('The customer has already submitted a payment promise');
    return issueLink(db, o.id, req.user.id);
  });
  res.json({ data: { link: publicLink(token) } });
});

/** WhatsApp the ledger (pending invoices + total) with a fresh customer link to the chosen client contacts. */
router.post('/payment-check/:id/send-ledger', payEdit, async (req, res) => {
  const { recipients } = z
    .object({ recipients: z.array(z.enum(LEDGER_RECIPIENTS)).min(1, 'Select at least one recipient').max(LEDGER_RECIPIENTS.length) })
    .parse(req.body);
  const { o, bills, token } = await withTransaction(async (db) => {
    const o = await paymentOrder(db, req.params.id, true);
    if (o.payment_status !== 'AWAITING_CUSTOMER') throw badRequest('The customer has already submitted a payment promise');
    const bills = await pendingBills(db, o.client_ref);
    if (!hasOverdue(bills)) throw badRequest('This client has no overdue bills now — use Re-check bills to move the order to Stock Check');
    await db.query('UPDATE o2d_payment_checks SET pending_amount = $1, pending_bills = $2 WHERE order_id = $3', [billsTotal(bills), bills.length, o.id]);
    return { o, bills, token: await issueLink(db, o.id, req.user.id, { sent: true }) };
  });
  const link = publicLink(token);
  const message = await ledgerMessage({ companyName: o.company_name, enquiryNumber: o.enquiry_number, bills, link });
  const results = [];
  for (const r of await resolveRecipients(recipients, o.client_ref)) {
    if (!r.to) {
      results.push({ ...r, status: 'SKIPPED' });
      continue;
    }
    const log = await sendAndLog({ triggerKey: 'PAYMENT_LEDGER', recipient: r, clientId: o.client_ref, message, userId: req.user.id });
    results.push({ ...r, status: log.status, error: log.error });
  }
  res.json({ data: { link, results } });
});

/** Re-read the Bills Receivable snapshot: no overdue bills any more -> Stock Check. */
router.post('/payment-check/:id/recheck', payEdit, async (req, res) => {
  const moved = await withTransaction(async (db) => {
    const o = await paymentOrder(db, req.params.id, true);
    const bills = await pendingBills(db, o.client_ref);
    if (hasOverdue(bills)) {
      await db.query('UPDATE o2d_payment_checks SET pending_amount = $1, pending_bills = $2, updated_at = NOW() WHERE order_id = $3', [
        billsTotal(bills), bills.length, o.id,
      ]);
      return false;
    }
    await db.query("UPDATE o2d_orders SET workflow_status = 'STOCK_CHECK', updated_by = $1, updated_at = NOW() WHERE id = $2", [req.user.id, o.id]);
    await db.query(
      `INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason, created_by)
       VALUES ($1, 'TO_STOCK_CHECK', 'PAYMENT_CHECK', 'STOCK_CHECK', 'Re-check: no overdue bills', $2)`,
      [o.id, req.user.id]
    );
    return true;
  });
  res.json({ data: { moved }, message: moved ? 'No overdue bills — moved to Stock Check' : 'Overdue bills still pending' });
});

/* ---------------- Manager Approval (payment promises) ---------------- */

const approvalView = requirePermission('crm_manager_approval', 'view');
const approvalDecide = requirePermission('crm_manager_approval', 'approve');
const APPROVAL_TABS = { pending: 'PENDING', approved: 'APPROVED', rejected: 'REJECTED' };
const approvalQuery = listQuery.omit({ tab: true, type: true }).extend({
  tab: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  type: z.enum(['CUT', 'ROLL']).optional(),
});

router.get('/manager-approval', approvalView, async (req, res) => {
  const q = approvalQuery.parse(req.query);
  const params = [APPROVAL_TABS[q.tab]];
  let where = 'r.status = $1';
  if (q.type) {
    params.push(q.type);
    where += ` AND o.order_type = $${params.length}`;
  }
  if (q.search) {
    params.push(like(q.search));
    where += ` AND ${SEARCH_SQL(params.length)}`;
  }
  const [{ rows }, { rows: counts }] = await Promise.all([
    query(
      `SELECT r.id, r.status, r.promise_date, r.promise_amount::float AS promise_amount, r.customer_note,
              r.pending_amount::float AS pending_amount, r.pending_bills, r.submitted_at, r.decided_at, r.decision_remark,
              u.name AS decided_by, o.id AS order_id, o.order_type, o.enquiry_number, o.status AS order_status, o.workflow_status,
              c.client_id, c.company_name, ${PROMISE_HISTORY_SQL}, COUNT(*) OVER()::int AS total_count
         FROM payment_promise_requests r JOIN o2d_orders o ON o.id = r.order_id JOIN clients c ON c.id = o.client_ref
         LEFT JOIN users u ON u.id = r.decided_by
        WHERE ${where}
        ORDER BY ${q.tab === 'pending' ? 'r.submitted_at' : 'r.decided_at'} DESC, r.id DESC
        LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
      params
    ),
    query('SELECT status, COUNT(*)::int AS n FROM payment_promise_requests GROUP BY status'),
  ]);
  res.json({
    data: rows.map(({ total_count, ...r }) => r),
    total: rows[0]?.total_count ?? 0,
    counts: Object.fromEntries(Object.entries(APPROVAL_TABS).map(([tab, s]) => [tab, counts.find((c) => c.status === s)?.n || 0])),
  });
});

const decisionSchema = (required) =>
  z.object({
    remark: required
      ? z.string({ message: 'Reason is required' }).trim().min(1, 'Reason is required').max(1000)
      : z.string().trim().max(1000).optional().nullable().transform((v) => v || null),
  });

/** Approve -> order moves to Stock Check. Reject -> order stays at Payment Check as pending (CRM follows up again). */
const decide = (approve) => async (req, res) => {
  const { remark } = decisionSchema(!approve).parse(req.body);
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) throw notFound('Request not found');
  await withTransaction(async (db) => {
    const { rows } = await db.query(
      `SELECT r.id, r.status, r.order_id, r.promise_date, r.promise_amount::float AS promise_amount, o.status AS order_status, o.workflow_status
         FROM payment_promise_requests r JOIN o2d_orders o ON o.id = r.order_id WHERE r.id = $1 FOR UPDATE OF r, o`,
      [id]
    );
    const r = rows[0];
    if (!r) throw notFound('Request not found');
    if (r.status !== 'PENDING') throw badRequest('This request has already been decided');
    if (r.order_status !== 'ACTIVE' || r.workflow_status !== 'PAYMENT_CHECK') {
      throw badRequest(r.order_status === 'ON_HOLD' ? 'The order is on hold — resume it first' : 'The order is no longer at Payment Check');
    }
    await db.query('UPDATE payment_promise_requests SET status = $1, decided_by = $2, decided_at = NOW(), decision_remark = $3 WHERE id = $4', [
      approve ? 'APPROVED' : 'REJECTED', req.user.id, remark, r.id,
    ]);
    const promise = `₹${r.promise_amount.toLocaleString('en-IN')} by ${r.promise_date}`;
    if (approve) {
      await db.query("UPDATE o2d_payment_checks SET status = 'APPROVED', updated_at = NOW() WHERE order_id = $1", [r.order_id]);
      await db.query("UPDATE o2d_orders SET workflow_status = 'STOCK_CHECK', updated_by = $1, updated_at = NOW() WHERE id = $2", [req.user.id, r.order_id]);
    } else {
      await db.query(
        `UPDATE o2d_payment_checks SET status = 'AWAITING_CUSTOMER', link_token_hash = NULL, link_expires_at = NULL, promise_date = NULL,
                promise_amount = NULL, customer_note = NULL, submitted_at = NULL, updated_at = NOW() WHERE order_id = $1`,
        [r.order_id]
      );
    }
    await db.query(
      `INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason, created_by) VALUES ($1, $2, 'PAYMENT_CHECK', $3, $4, $5)`,
      [
        r.order_id,
        approve ? 'PAYMENT_APPROVED' : 'PAYMENT_REJECTED',
        approve ? 'STOCK_CHECK' : 'PAYMENT_CHECK',
        `Manager ${approve ? 'approved' : 'rejected'} payment promise ${promise}${remark ? ` — ${remark}` : ''}`,
        req.user.id,
      ]
    );
  });
  res.json({ message: approve ? 'Approved — order moved to Stock Check' : 'Rejected — order stays at Payment Check' });
};

router.post('/manager-approval/:id/approve', approvalDecide, decide(true));
router.post('/manager-approval/:id/reject', approvalDecide, decide(false));

/* ---------------- Stock Check ---------------- */

router.get('/stock-check', stockView, async (req, res) => {
  const q = listQuery.omit({ tab: true }).parse(req.query);
  const params = [q.type];
  let search = '';
  if (q.search) {
    params.push(like(q.search));
    search = ` AND ${SEARCH_SQL(2)}`;
  }
  const { rows } = await query(
    `SELECT o.id, o.order_type, o.enquiry_number, o.order_mode, o.transport_name, o.client_ref, c.client_id, c.company_name, c.skip_payment_check,
            e.reason AS arrived_reason, e.created_at AS arrived_at,
            (SELECT COUNT(*)::int FROM o2d_order_items i WHERE i.order_id = o.id) AS lines,
            (SELECT COUNT(*)::int FROM o2d_item_stock_checks s WHERE s.order_id = o.id) AS checked,
            COUNT(*) OVER()::int AS total_count
       FROM o2d_orders o JOIN clients c ON c.id = o.client_ref
       LEFT JOIN LATERAL (SELECT reason, created_at FROM o2d_order_events WHERE order_id = o.id AND to_stage = 'STOCK_CHECK' ORDER BY id DESC LIMIT 1) e ON TRUE
      WHERE o.status = 'ACTIVE' AND o.workflow_status = 'STOCK_CHECK' AND o.order_type = $1${search}
      ORDER BY e.created_at DESC NULLS LAST, o.id
      LIMIT ${q.limit} OFFSET ${(q.page - 1) * q.limit}`,
    params
  );
  res.json({ data: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0 });
});

/** Stock detail for the screen: the proforma's public token is returned only as a link. */
const stockScreen = async (id) => {
  const d = await stockDetail({ query }, id);
  if (d.proforma) {
    const { share_token, ...p } = d.proforma;
    d.proforma = { ...p, link: appLink(`/proforma/${share_token}`) };
  }
  return d;
};

router.get('/stock-check/:id', stockView, async (req, res) => res.json({ data: await stockScreen(req.params.id) }));

router.get('/stock-check/:id/items/:itemId/availability', stockView, async (req, res) =>
  res.json({ data: await itemAvailability({ query }, req.params.id, req.params.itemId) })
);

const decisionBody = z.object({
  decision: z.enum(DECISIONS, { message: 'Choose what to do with this item' }),
  source_type: z.enum(DEPTS).optional().nullable(),
  panels: z.coerce.number().int('No. of Panels must be a whole number').min(1).max(100000).optional().nullable(),
  panel_length: z.coerce.number().positive('Length must be more than 0').max(100000).optional().nullable(),
  partial_qty: z.coerce.number().positive('Qty must be more than 0').max(1000000).optional().nullable(),
  note: z.string().trim().max(1000).optional().nullable().transform((v) => v || null),
  alt_item: z.string().trim().max(200).optional().nullable().transform((v) => v || null),
});

router.put('/stock-check/:id/items/:itemId', stockEdit, async (req, res) => {
  const body = decisionBody.parse(req.body);
  await withTransaction((db) => saveItemDecision(db, req.params.id, req.params.itemId, body, req.user.id));
  res.json({ data: await stockScreen(req.params.id) });
});

router.post('/stock-check/:id/hold', stockEdit, async (req, res) => {
  const { reason } = z.object({ reason: z.string({ message: 'Reason is required' }).trim().min(1, 'Reason is required').max(1000) }).parse(req.body);
  await withTransaction((db) => holdFromStockCheck(db, req.params.id, reason, req.user.id));
  res.json({ message: 'Order put on hold' });
});

router.post('/stock-check/:id/proforma', stockEdit, async (req, res) => {
  await withTransaction((db) => generateProforma(db, req.params.id, req.user.id));
  res.json({ data: await stockScreen(req.params.id), message: 'Proforma Invoice ready' });
});

/** Proforma is made for every order but shared only with cash customers. */
router.post('/stock-check/:id/proforma/share', stockEdit, async (req, res) => {
  const { recipients } = z
    .object({ recipients: z.array(z.enum(LEDGER_RECIPIENTS)).min(1, 'Select at least one recipient').max(LEDGER_RECIPIENTS.length) })
    .parse(req.body);
  const d = await stockDetail({ query }, req.params.id);
  if (!d.proforma) throw badRequest('Generate the Proforma Invoice first');
  if (d.proforma.stale) throw badRequest('Items changed after the Proforma Invoice was made — regenerate it first');
  if (!d.cash.is_cash) throw badRequest('Proforma Invoice is shared only with cash customers');
  const link = appLink(`/proforma/${d.proforma.share_token}`);
  const fallback = [
    '*Fifth Seasons Decor — Proforma Invoice*',
    `Dear ${d.client.company_name},`,
    `Proforma Invoice ${d.proforma.proforma_no} for your order ${d.enquiry_number}: *₹${d.proforma.total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}*`,
    'Please make the advance payment so we can start processing your order.',
    link,
  ].join('\n');
  const message = await eventMessage(
    'PROFORMA_SHARE',
    {
      company_name: d.client.company_name,
      proforma_no: d.proforma.proforma_no,
      enquiry_number: d.enquiry_number,
      amount: `₹${d.proforma.total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`,
      link,
    },
    fallback
  );
  const results = [];
  for (const r of await resolveRecipients(recipients, d.client.id)) {
    if (!r.to) {
      results.push({ ...r, status: 'SKIPPED' });
      continue;
    }
    const log = await sendAndLog({ triggerKey: 'PROFORMA_SHARE', recipient: r, clientId: d.client.id, message, userId: req.user.id });
    results.push({ ...r, status: log.status, error: log.error });
  }
  if (results.some((r) => r.status === 'SENT')) await query('UPDATE o2d_proformas SET shared_at = NOW() WHERE order_id = $1', [d.id]);
  res.json({ data: { link, results } });
});

router.post('/stock-check/:id/advance', stockEdit, async (req, res) => {
  const body = z
    .object({
      amount: z.coerce.number({ message: 'Enter the amount' }).positive('Amount must be more than 0').max(1e11),
      reference: z.string({ message: 'Reference is required' }).trim().min(1, 'Reference (UTR / cheque no.) is required').max(100),
      remark: z.string().trim().max(500).optional().nullable().transform((v) => v || null),
    })
    .parse(req.body);
  await withTransaction((db) => recordAdvance(db, req.params.id, body, req.user.id));
  res.json({ data: await stockScreen(req.params.id), message: 'Advance recorded' });
});

/** Customer tracking link goes to the client's WhatsApp group (or the owner when no group is linked). Never fails the request. */
async function sendTrackingLink({ orderNo, trackingToken, clientRef, companyName }, userId) {
  const link = appLink(`/track/${trackingToken}`);
  try {
    const [group, owner] = await resolveRecipients(['CLIENT_GROUP', 'CLIENT_OWNER'], clientRef);
    const r = group.to ? group : owner;
    if (!r.to) return { link, sent: false, reason: 'No WhatsApp group or owner number on the client' };
    const fallback = [
      '*Fifth Seasons Decor — Order Confirmed*',
      `Dear ${companyName},`,
      `Your order *${orderNo}* is confirmed and moved to picking.`,
      'Track your order here:',
      link,
    ].join('\n');
    const message = await eventMessage('ORDER_TRACKING', { company_name: companyName, order_no: orderNo, link }, fallback);
    const log = await sendAndLog({ triggerKey: 'ORDER_TRACKING', recipient: r, clientId: clientRef, message, userId });
    return { link, sent: log.status === 'SENT', to: r.label, reason: log.error };
  } catch (err) {
    return { link, sent: false, reason: err.message };
  }
}

router.post('/stock-check/:id/complete', stockEdit, async (req, res) => {
  const done = await withTransaction((db) => completeStockCheck(db, req.params.id, req.user.id));
  // The tracking link goes out once — not again when an order comes back from Picking
  const tracking = done.newTracking
    ? await sendTrackingLink(done, req.user.id)
    : { link: appLink(`/track/${done.trackingToken}`), sent: false, reason: 'Already sent earlier' };
  res.json({ data: { system_order_no: done.orderNo, tracking }, message: `Stock check complete — order ${done.orderNo} moved to Picking` });
});

/* Alternative items (Google Sheet) */
router.get('/alternatives/sync/logs', stockView, async (req, res) => res.json({ data: await syncLogs(ALT_LOG_MODULE) }));
router.post('/alternatives/sync', stockEdit, async (req, res) => res.json({ data: await syncAlternatives(req.user.id) }));

export default router;
