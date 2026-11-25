import { query } from '../config/db.js';
import { badRequest, notFound } from '../utils/httpError.js';

/**
 * One remarks trail per order, shown on every stage's view: remarks typed in the Remarks section,
 * the Order Enquiry's customer / team remark, and the reasons typed for holds, send-backs, Not Found,
 * picking batches and manager decisions. Each entry carries the stage it was written at.
 */
const EVENT_REMARKS = {
  HOLD: 'Hold reason',
  SEND_BACK: 'Sent back',
  NOT_FOUND: 'Not found',
  PAYMENT_REJECTED: 'Payment rejected',
  PAYMENT_APPROVED: 'Payment approved',
};
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);

async function findOrder(id) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await query(
    `SELECT o.id, o.order_type, o.status, o.workflow_status, o.held_from, o.customer_remark, o.team_remark, o.created_at, u.name AS created_by
       FROM o2d_orders o LEFT JOIN users u ON u.id = o.created_by WHERE o.id = $1`,
    [id]
  );
  if (!rows[0]) throw notFound('Order not found');
  return rows[0];
}

export async function listRemarks(orderId) {
  const o = await findOrder(orderId);
  const [{ rows: added }, { rows: events }] = await Promise.all([
    query(
      `SELECT r.id, r.stage, r.remark, r.created_at, u.name AS by_name FROM o2d_order_remarks r LEFT JOIN users u ON u.id = r.created_by
        WHERE r.order_id = $1`,
      [o.id]
    ),
    query(
      `SELECT e.id, e.event, e.from_stage, e.to_stage, e.reason, e.details, e.created_at, u.name AS by_name
         FROM o2d_order_events e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.order_id = $1 AND (e.event = ANY($2::text[]) OR (e.event = 'PICKING_BATCH' AND e.details->>'remark' IS NOT NULL))`,
      [o.id, Object.keys(EVENT_REMARKS)]
    ),
  ]);
  const out = [];
  if (o.customer_remark) out.push({ key: 'customer', stage: 'SUBMITTED', kind: 'Customer remark', remark: o.customer_remark, by: o.created_by, at: o.created_at });
  if (o.team_remark) out.push({ key: 'team', stage: 'SUBMITTED', kind: 'Team remark', remark: o.team_remark, by: o.created_by, at: o.created_at });
  for (const r of added) out.push({ key: `r${r.id}`, stage: r.stage, kind: 'Remark', remark: r.remark, by: r.by_name, at: r.created_at });
  for (const e of events) {
    const remark = e.event === 'PICKING_BATCH' ? e.details?.remark : e.reason;
    if (!remark) continue;
    out.push({
      key: `e${e.id}`,
      stage: e.event === 'PAYMENT_APPROVED' || e.event === 'PAYMENT_REJECTED' ? 'PAYMENT_CHECK' : e.from_stage || e.to_stage,
      kind: e.event === 'PICKING_BATCH' ? `Picking batch ${e.details?.batch ?? ''}`.trim() : EVENT_REMARKS[e.event],
      remark,
      by: e.by_name,
      at: e.created_at,
    });
  }
  return out.sort((a, b) => new Date(b.at) - new Date(a.at));
}

/** A remark is tagged with the stage the order is at right now (the held-from stage while on hold). */
export async function addRemark(orderId, remark, userId) {
  const o = await findOrder(orderId);
  if (o.status === 'CANCELLED') throw badRequest('Cancelled orders cannot get new remarks');
  const stage = o.workflow_status === 'ON_HOLD' ? o.held_from || 'ON_HOLD' : o.workflow_status;
  await query('INSERT INTO o2d_order_remarks (order_id, stage, remark, created_by) VALUES ($1,$2,$3,$4)', [o.id, stage, remark, userId]);
  return o;
}

export const orderTypeOf = async (orderId) => (await findOrder(orderId)).order_type;
