import { query } from '../config/db.js';
import { notFound } from '../utils/httpError.js';

/**
 * Order activity trail. Every action on an order is a row in o2d_order_events (who, when, what).
 * Stage moves set from/to stage; item-level actions (decision, cut qty, …) carry the item in details.item_id
 * so a credit note on one item can be traced back to who did what at each step.
 */
export const lineLetter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + (i % 26))}`);

/** Log an action that does not move the order between stages. */
export const logActivity = (db, orderId, userId, event, reason, details = null) =>
  db.query('INSERT INTO o2d_order_events (order_id, event, reason, details, created_by) VALUES ($1,$2,$3,$4,$5)', [
    orderId, event, reason, details && JSON.stringify(details), userId,
  ]);

const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);

/** Full trail of an order, oldest first: every event plus the remarks added on the way. */
export async function orderActivity(orderId) {
  if (!isUuid(orderId)) throw notFound('Order not found');
  const { rows: o } = await query('SELECT id FROM o2d_orders WHERE id = $1', [orderId]);
  if (!o[0]) throw notFound('Order not found');
  const [{ rows: events }, { rows: remarks }, { rows: items }] = await Promise.all([
    query(
      `SELECT e.id, e.event, e.from_stage, e.to_stage, e.reason, e.details, e.created_at AS at, u.name AS by, u.employee_code AS by_code
         FROM o2d_order_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.order_id = $1`,
      [orderId]
    ),
    query(
      `SELECT r.id, r.stage, r.remark, r.created_at AS at, u.name AS by, u.employee_code AS by_code
         FROM o2d_order_remarks r LEFT JOIN users u ON u.id = r.created_by WHERE r.order_id = $1`,
      [orderId]
    ),
    query('SELECT id, sku_code, sort_order FROM o2d_order_items WHERE order_id = $1 ORDER BY sort_order', [orderId]),
  ]);
  const rows = [
    ...events.map((e) => ({
      key: `e${e.id}`,
      event: e.event,
      from_stage: e.from_stage,
      to_stage: e.to_stage,
      text: e.reason,
      // one item (decision, pick, not found) or several (cut details)
      item_ids: e.details?.item_id ? [e.details.item_id] : (e.details?.items || []).map((i) => i.item_id).filter(Boolean),
      by: e.by,
      by_code: e.by_code,
      at: e.at,
      // customer actions from the public link have no user
      by_customer: !e.by && ['PAYMENT_PROMISE'].includes(e.event),
    })),
    ...remarks.map((r) => ({ key: `r${r.id}`, event: 'REMARK', from_stage: r.stage, to_stage: null, text: r.remark, item_ids: [], by: r.by, by_code: r.by_code, at: r.at })),
  ].sort((a, b) => new Date(a.at) - new Date(b.at) || a.key.localeCompare(b.key));
  return { items: items.map((i) => ({ id: i.id, line: lineLetter(i.sort_order), sku_code: i.sku_code })), rows };
}
