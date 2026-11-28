import { query } from '../config/db.js';
import { pendingBills } from './crmPayment.js';
import { notFound } from '../utils/httpError.js';

/**
 * Customer Profile: everything about one client in one place — orders (type / item wise), payment record,
 * a rating, credit and order frequency, and the remarks trail. Shown from Client Master, Payment Check and Stock Check.
 *
 * Paid bills come from Tally (Paid Bills sync, matched by party name = company name). Call transcripts (Runo)
 * are not connected yet: the profile says so (`sources`).
 */
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

export async function customerProfile(id) {
  if (!isUuid(id)) throw notFound('Client not found');
  const { rows: cl } = await query(
    `SELECT c.id, c.client_id, c.company_name, c.city, c.state, c.zone, c.owner_name, c.owner_contact_no, c.client_type, c.payment_mode,
            c.credit_limit::float AS credit_limit, c.credit_days, c.skip_payment_check, c.skip_payment_reason, c.sales_person_emp_id,
            c.created_at, u.name AS sales_person_name
       FROM clients c LEFT JOIN users u ON u.employee_code = c.sales_person_emp_id WHERE c.id = $1`,
    [id]
  );
  const client = cl[0];
  if (!client) throw notFound('Client not found');

  const [{ rows: orders }, { rows: items }, { rows: promises }, { rows: advances }, { rows: remarks }, bills, { rows: paid }] = await Promise.all([
    query(
      `SELECT o.id, o.order_type, o.enquiry_number, o.system_order_no, o.status, o.workflow_status, o.created_at,
              COUNT(i.id)::int AS item_count, COALESCE(SUM(i.qty), 0)::float AS total_qty, p.total::float AS value
         FROM o2d_orders o LEFT JOIN o2d_order_items i ON i.order_id = o.id LEFT JOIN o2d_proformas p ON p.order_id = o.id
        WHERE o.client_ref = $1 GROUP BY o.id, p.total ORDER BY o.created_at DESC`,
      [id]
    ),
    query(
      `SELECT inv_base(i.sku_code) AS item, o.order_type, COUNT(DISTINCT o.id)::int AS orders, SUM(i.qty)::float AS qty,
              MAX(i.unit) AS unit, MAX(o.created_at) AS last_at
         FROM o2d_order_items i JOIN o2d_orders o ON o.id = i.order_id
        WHERE o.client_ref = $1 AND o.status <> 'CANCELLED'
        GROUP BY 1, 2 ORDER BY qty DESC LIMIT 50`,
      [id]
    ),
    query(
      `SELECT r.id, COALESCE(o.system_order_no, o.enquiry_number) AS order_no, r.pending_amount::float AS pending_amount, r.pending_bills,
              r.promise_date, r.promise_amount::float AS promise_amount, r.customer_note, r.status, r.decision_remark, r.submitted_at,
              r.decided_at, u.name AS decided_by
         FROM payment_promise_requests r JOIN o2d_orders o ON o.id = r.order_id LEFT JOIN users u ON u.id = r.decided_by
        WHERE o.client_ref = $1 ORDER BY r.submitted_at DESC`,
      [id]
    ),
    query(
      `SELECT COALESCE(o.system_order_no, o.enquiry_number) AS order_no, a.amount::float AS amount, a.reference, a.remark, a.received_at,
              u.name AS received_by
         FROM o2d_advance_payments a JOIN o2d_orders o ON o.id = a.order_id LEFT JOIN users u ON u.id = a.received_by
        WHERE o.client_ref = $1 ORDER BY a.received_at DESC`,
      [id]
    ),
    query(
      `SELECT r.id, r.stage, r.remark, r.created_at AS at, u.name AS by, COALESCE(o.system_order_no, o.enquiry_number) AS order_no
         FROM o2d_order_remarks r JOIN o2d_orders o ON o.id = r.order_id LEFT JOIN users u ON u.id = r.created_by
        WHERE o.client_ref = $1 ORDER BY r.created_at DESC LIMIT 100`,
      [id]
    ),
    pendingBills({ query }, id),
    query(
      `SELECT b.receipt_date, b.bill_reference, b.bill_date, b.credit_days, b.due_date, b.days_late, b.receipt_total::float AS receipt_total
         FROM bills_paid b JOIN clients c ON lower(btrim(c.company_name)) = lower(btrim(b.party))
        WHERE c.id = $1 ORDER BY b.receipt_date DESC NULLS LAST, b.row_no`,
      [id]
    ),
  ]);

  /* ---- Orders: counts, frequency ---- */
  const live = orders.filter((o) => o.status !== 'CANCELLED');
  const dates = live.map((o) => new Date(o.created_at).getTime()).sort((a, b) => a - b);
  const gaps = dates.slice(1).map((t, i) => (t - dates[i]) / 86400000);
  const now = Date.now();
  const lastDays = dates.length ? Math.floor((now - dates[dates.length - 1]) / 86400000) : null;
  const in90 = dates.filter((t) => now - t <= 90 * 86400000).length;
  const stats = {
    total_orders: live.length,
    cancelled: orders.length - live.length,
    by_type: { CUT: live.filter((o) => o.order_type === 'CUT').length, ROLL: live.filter((o) => o.order_type === 'ROLL').length },
    first_order_at: dates.length ? new Date(dates[0]).toISOString() : null,
    last_order_at: dates.length ? new Date(dates[dates.length - 1]).toISOString() : null,
    days_since_last: lastDays,
    avg_gap_days: gaps.length ? Math.round(gaps.reduce((s, g) => s + g, 0) / gaps.length) : null,
    orders_last_90d: in90,
    total_qty: round2(live.reduce((s, o) => s + o.total_qty, 0)),
    total_value: round2(live.reduce((s, o) => s + (o.value || 0), 0)),
  };

  /* ---- Payments (today: open bills + promises + advances) ---- */
  const outstanding = round2(bills.reduce((s, b) => s + b.amount, 0));
  const overdue = bills.filter((b) => b.days_overdue > 0);
  const payment = {
    outstanding,
    overdue_amount: round2(overdue.reduce((s, b) => s + b.amount, 0)),
    overdue_bills: overdue.length,
    max_days_overdue: overdue.length ? Math.max(...overdue.map((b) => b.days_overdue)) : 0,
    credit_used_pct: client.credit_limit > 0 ? Math.round((outstanding / client.credit_limit) * 100) : null,
    promises_total: promises.length,
    promises_approved: promises.filter((p) => p.status === 'APPROVED').length,
    promises_rejected: promises.filter((p) => p.status === 'REJECTED').length,
    bills,
    promises,
    advances,
    paid: paidStats(paid),
    paid_bills: paid.slice(0, 300),
  };

  return {
    client,
    stats,
    rating: rate(client, stats, payment),
    payment,
    orders: orders.slice(0, 200),
    top_items: items,
    remarks,
    // Not connected yet — the UI shows a placeholder for each
    sources: { tally_payments: paid.length > 0, runo_calls: false },
  };
}

/** Paid-bill record from Tally: how often the client pays by the due date and how late otherwise. */
function paidStats(paid) {
  const withDays = paid.filter((b) => b.days_late != null);
  const late = withDays.filter((b) => b.days_late > 0);
  const recent = withDays.slice(0, 20); // newest first
  return {
    bills: paid.length,
    on_time: withDays.length - late.length,
    late: late.length,
    late_30: late.filter((b) => b.days_late > 30).length,
    on_time_pct: withDays.length ? Math.round(((withDays.length - late.length) / withDays.length) * 100) : null,
    avg_late_days: late.length ? Math.round(late.reduce((t, b) => t + b.days_late, 0) / late.length) : 0,
    max_late_days: late.length ? Math.max(...late.map((b) => b.days_late)) : 0,
    recent_on_time_pct: recent.length ? Math.round((recent.filter((b) => b.days_late <= 0).length / recent.length) * 100) : null,
    last_receipt: paid[0]?.receipt_date || null,
  };
}

/**
 * 1–5 rating from what the system has today. Each part is 0–100:
 *  - Payment (50%): paid-bill history from Tally (60%: on-time share, how late on average) + today's position
 *    (40%: overdue days against the credit days, overdue share of the outstanding, rejected promises).
 *    Without Tally history only today's position counts and the rating is marked provisional.
 *  - Credit use (20%): outstanding against the credit limit
 *  - Orders (30%): how often and how recently the client orders
 */
function rate(client, stats, p) {
  const creditDays = client.credit_days || 30;
  let pay = 100;
  if (p.overdue_bills) {
    pay -= clamp((p.max_days_overdue / creditDays) * 40, 10, 60);
    pay -= p.outstanding > 0 ? (p.overdue_amount / p.outstanding) * 25 : 0;
  }
  pay -= Math.min(15, p.promises_rejected * 5);
  pay = clamp(pay, 0, 100);
  const h = p.paid;
  if (h.bills && h.on_time_pct != null) {
    // on-time share, minus up to 30 for how late the late payments are (relative to the credit days)
    const history = clamp(h.on_time_pct - Math.min(30, (h.avg_late_days / creditDays) * 30), 0, 100);
    pay = history * 0.6 + pay * 0.4;
  }

  const credit = p.credit_used_pct == null ? 70 : clamp(100 - Math.max(0, p.credit_used_pct - 50) * 1.2, 0, 100);

  let orders = 0;
  if (stats.total_orders) {
    const recency = stats.days_since_last == null ? 0 : clamp(100 - stats.days_since_last, 0, 100);
    const frequency = clamp(stats.orders_last_90d * 20, 0, 100);
    orders = Math.round(recency * 0.5 + frequency * 0.5);
  }

  const score = Math.round(pay * 0.5 + credit * 0.2 + orders * 0.3);
  const stars = clamp(Math.round((score / 20) * 2) / 2, 0.5, 5);
  const label = score >= 80 ? 'Excellent' : score >= 65 ? 'Good' : score >= 45 ? 'Average' : score >= 30 ? 'Risky' : 'High risk';
  return { score, stars, label, parts: { payment: Math.round(pay), credit: Math.round(credit), orders }, provisional: !h.bills };
}
