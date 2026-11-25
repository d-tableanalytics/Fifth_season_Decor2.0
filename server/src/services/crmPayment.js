import crypto from 'node:crypto';
import { query } from '../config/db.js';
import { resolveRecipients, sendAndLog } from './whatsapp.js';

export const LINK_TTL_DAYS = 7;
export const LEDGER_RECIPIENTS = ['CLIENT_OWNER', 'CLIENT_ACCOUNTANT', 'CLIENT_SALES_PERSON', 'CLIENT_GROUP'];

export const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const inr = (v) => `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');

/**
 * The client's pending bills from the Bills Receivable snapshot.
 * Bills are matched by party name = client company name (the sheet has no client ID).
 * Negative amount = receivable; returned as a positive amount.
 */
export async function pendingBills(db, clientId) {
  const { rows } = await db.query(
    `SELECT b.bill_reference, b.bill_date, b.due_date, (-b.amount)::float AS amount, b.days_overdue
       FROM bills_receivable b JOIN clients c ON lower(btrim(c.company_name)) = lower(btrim(b.party))
      WHERE c.id = $1 AND b.amount < 0
      ORDER BY b.bill_date NULLS LAST, b.row_no`,
    [clientId]
  );
  return rows;
}

/** Payment Check holds an order only when at least one bill is past its due date. */
export const hasOverdue = (bills) => bills.some((b) => b.days_overdue > 0);

const total = (bills) => Math.round(bills.reduce((s, b) => s + b.amount, 0) * 100) / 100;

const logEvent = (db, orderId, userId, event, from, to, reason) =>
  db.query('INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [
    orderId, event, from, to, reason, userId,
  ]);

/**
 * Move an order out of Order Enquiry into CRM (call inside the create/reactivate transaction):
 * Skip Payment customer -> Stock Check; any overdue bill -> Payment Check; otherwise -> Stock Check.
 * Returns { stage, skipped }.
 */
export async function routeToCrm(db, orderId, clientId, userId) {
  const { rows } = await db.query('SELECT skip_payment_check FROM clients WHERE id = $1', [clientId]);
  const from = 'SUBMITTED';
  let stage = 'STOCK_CHECK';
  let reason;
  let skipped = false;

  if (rows[0]?.skip_payment_check) {
    skipped = true;
    reason = 'Skip Payment customer — payment check skipped';
  } else {
    const bills = await pendingBills(db, clientId);
    if (hasOverdue(bills)) {
      stage = 'PAYMENT_CHECK';
      reason = `${bills.filter((b) => b.days_overdue > 0).length} overdue of ${bills.length} pending bill(s) · ${inr(total(bills))}`;
      await db.query(
        `INSERT INTO o2d_payment_checks (order_id, status, pending_amount, pending_bills) VALUES ($1, 'AWAITING_CUSTOMER', $2, $3)
         ON CONFLICT (order_id) DO UPDATE SET status = 'AWAITING_CUSTOMER', pending_amount = EXCLUDED.pending_amount,
           pending_bills = EXCLUDED.pending_bills, link_token_hash = NULL, link_expires_at = NULL, link_sent_at = NULL,
           link_sent_by = NULL, promise_date = NULL, promise_amount = NULL, customer_note = NULL, submitted_at = NULL, updated_at = NOW()`,
        [orderId, total(bills), bills.length]
      );
    } else {
      reason = bills.length ? 'No overdue bills' : 'No pending bills';
    }
  }
  await db.query('UPDATE o2d_orders SET workflow_status = $1, updated_at = NOW() WHERE id = $2', [stage, orderId]);
  await logEvent(db, orderId, userId, stage === 'PAYMENT_CHECK' ? 'TO_PAYMENT_CHECK' : 'TO_STOCK_CHECK', from, stage, reason);
  return { stage, skipped };
}

/** WhatsApp the Fifth Season manager + the client's sales person about a Skip Payment customer's order. Never throws. */
export async function notifySkipPaymentOrder(orderId, userId) {
  try {
    const { rows } = await query(
      `SELECT o.enquiry_number, o.order_type, o.client_ref, c.client_id, c.company_name,
              (SELECT COUNT(*)::int FROM o2d_order_items i WHERE i.order_id = o.id) AS lines
         FROM o2d_orders o JOIN clients c ON c.id = o.client_ref WHERE o.id = $1`,
      [orderId]
    );
    const o = rows[0];
    if (!o) return;
    const message = [
      '*New order — Skip Payment customer*',
      `Enquiry: ${o.enquiry_number} (${o.order_type === 'CUT' ? 'Cut' : 'Roll'})`,
      `Client: ${o.client_id} — ${o.company_name}`,
      `Items: ${o.lines} line(s)`,
      'Payment check skipped — order moved to Stock Check.',
    ].join('\n');
    for (const r of await resolveRecipients(['FSD_MANAGER', 'FSD_SALES_PERSON'], o.client_ref)) {
      if (r.to) await sendAndLog({ triggerKey: 'SKIP_PAYMENT_ORDER', recipient: r, clientId: o.client_ref, message, userId });
    }
  } catch (err) {
    console.error('Skip-payment WhatsApp failed:', err.message);
  }
}

/** New one-time customer link (replaces any earlier one). Returns the raw token. */
export async function issueLink(db, orderId, userId, { sent = false } = {}) {
  const token = crypto.randomBytes(24).toString('base64url');
  await db.query(
    `UPDATE o2d_payment_checks SET link_token_hash = $1, link_expires_at = NOW() + make_interval(days => $2::int),
            link_sent_at = CASE WHEN $3::boolean THEN NOW() ELSE link_sent_at END, link_sent_by = CASE WHEN $3::boolean THEN $4::int ELSE link_sent_by END,
            updated_at = NOW()
      WHERE order_id = $5`,
    [hashToken(token), LINK_TTL_DAYS, sent, userId, orderId]
  );
  return token;
}

const MAX_LEDGER_LINES = 40;

export function ledgerMessage({ companyName, enquiryNumber, bills, link }) {
  const lines = bills.slice(0, MAX_LEDGER_LINES).map(
    (b, i) => `${i + 1}. ${b.bill_reference || '—'} · ${day(b.bill_date)} · ${inr(b.amount)}${b.days_overdue > 0 ? ` (${b.days_overdue} days overdue)` : ''}`
  );
  if (bills.length > MAX_LEDGER_LINES) lines.push(`…and ${bills.length - MAX_LEDGER_LINES} more`);
  return [
    '*Fifth Seasons Decor — Payment Reminder*',
    `Dear ${companyName},`,
    `Your order ${enquiryNumber} is waiting for payment clearance. Pending invoices:`,
    '',
    ...lines,
    '',
    `*Total pending: ${inr(total(bills))}*`,
    '',
    'Please tell us when you will make the payment:',
    link,
    `(Link valid for ${LINK_TTL_DAYS} days)`,
  ].join('\n');
}

export { total as billsTotal };
