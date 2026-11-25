import { query } from '../config/db.js';
import { STAGES } from '../config/o2d.js';
import { cutLines } from './cutting.js';
import { resolveRecipients, sendAndLog, eventMessage } from './whatsapp.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';

/**
 * O2D Delivery Note: read-only on cutting results. The only live data is the Delivery Note number
 * (editable once by hand) and the LR number (+ send to the customer). Leaving is manual: Move to Packing.
 */
const round2 = (n) => Math.round(n * 100) / 100;
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);
const AFTER_DN = new Set(STAGES.slice(STAGES.indexOf('DELIVERY_NOTE') + 1));
const appLink = (path) => `${(process.env.APP_PUBLIC_URL || process.env.CLIENT_ORIGIN || 'http://localhost:5173').replace(/\/+$/, '')}${path}`;

const logEvent = (db, orderId, userId, event, { from = null, to = null, reason = null, details = null } = {}) =>
  db.query('INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason, details, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    orderId, event, from, to, reason, details && JSON.stringify(details), userId,
  ]);

async function dnOrder(db, type, id, lock = false) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await db.query(`SELECT * FROM o2d_orders WHERE id = $1 AND order_type = $2${lock ? ' FOR UPDATE' : ''}`, [id, type]);
  const o = rows[0];
  if (!o) throw notFound('Order not found');
  if (o.status !== 'ACTIVE' || o.workflow_status !== 'DELIVERY_NOTE') throw conflict('Order is not at Delivery Note');
  return o;
}

/** Item rows of orders at Delivery Note. */
const ORDER_COLS = `o.id, o.enquiry_number, o.system_order_no, o.delivery_note_no, o.lr_number, o.lr_sent_at, o.ioc_number, o.transport_name,
  o.team_remark, o.customer_remark, o.created_at, c.client_id, c.company_name, c.city`;

async function itemRows(orders) {
  const lines = orders.length ? await cutLines({ query }, orders.map((o) => o.id)) : new Map();
  return orders.flatMap((o) =>
    (lines.get(o.id) || []).map((l) => ({
      order_id: o.id,
      item_id: l.id,
      line: l.line,
      item_name: l.item_name,
      unit: l.unit,
      lot_no: l.lot_no || '',
      original: l.target,
      ordered: l.ordered,
      cut_qty: l.cut_qty,
      wastage_qty: l.wastage_qty,
      balance: round2(l.target - l.cut_qty),
    }))
  );
}

export async function dnQueue(type, { search, page, limit }) {
  const params = [type];
  let where = "o.order_type = $1 AND o.status = 'ACTIVE' AND o.workflow_status = 'DELIVERY_NOTE'";
  if (search) {
    params.push(`%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where += ` AND (o.enquiry_number ILIKE $2 OR o.system_order_no ILIKE $2 OR o.delivery_note_no ILIKE $2 OR c.client_id ILIKE $2 OR c.company_name ILIKE $2)`;
  }
  const { rows } = await query(
    `SELECT ${ORDER_COLS}, e.created_at AS entered_at, e.from_stage AS entered_from,
            EXISTS (SELECT 1 FROM o2d_order_events x WHERE x.order_id = o.id AND x.event = 'DN_NUMBER_EDITED') AS dn_locked,
            COUNT(*) OVER()::int AS total_count
       FROM o2d_orders o JOIN clients c ON c.id = o.client_ref
       LEFT JOIN LATERAL (SELECT created_at, from_stage FROM o2d_order_events WHERE order_id = o.id AND to_stage = 'DELIVERY_NOTE' ORDER BY id DESC LIMIT 1) e ON TRUE
      WHERE ${where}
      ORDER BY e.created_at NULLS LAST, o.id
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params
  );
  const items = await itemRows(rows);
  // One row per order, with its items rolled up
  return {
    data: rows.map((o) => {
      const its = items.filter((it) => it.order_id === o.id);
      return {
        order_id: o.id,
        items: its.length,
        lot_no: [...new Set(its.flatMap((it) => it.lot_no.split(', ')).filter(Boolean))].join(', '),
        original: round2(its.reduce((sum, it) => sum + it.original, 0)),
        cut_qty: round2(its.reduce((sum, it) => sum + it.cut_qty, 0)),
        balance: round2(its.reduce((sum, it) => sum + Math.max(0, it.balance), 0)),
        order_no: o.system_order_no || o.enquiry_number,
        client_id: o.client_id,
        company_name: o.company_name,
        transport_name: o.transport_name,
        delivery_note_no: o.delivery_note_no,
        dn_locked: o.dn_locked,
        entered_at: o.entered_at,
        sent_back: AFTER_DN.has(o.entered_from),
        has_remarks: !!(o.team_remark || o.customer_remark),
      };
    }),
    orders: rows[0]?.total_count ?? 0,
  };
}

/** Order view: items, DN number (+ edit history), LR, IOC numbers. */
export async function dnDetail(type, id) {
  const o = await dnOrder({ query }, type, id);
  const [{ rows: info }, items, { rows: edits }] = await Promise.all([
    query(`SELECT ${ORDER_COLS} FROM o2d_orders o JOIN clients c ON c.id = o.client_ref WHERE o.id = $1`, [o.id]),
    itemRows([o]),
    query(
      `SELECT e.details, e.created_at, u.name AS by_name FROM o2d_order_events e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.order_id = $1 AND e.event = 'DN_NUMBER_EDITED' ORDER BY e.id`,
      [o.id]
    ),
  ]);
  const lines = (await cutLines({ query }, [o.id])).get(o.id);
  const batches = [...new Set(lines.flatMap((l) => l.lots.map((x) => x.ioc_batch_no)).filter(Boolean))].sort();
  return {
    ...info[0],
    items,
    ioc_numbers: [o.ioc_number, ...batches.map(String)].filter(Boolean).join(', '),
    dn_edit: edits[0] ? { from: edits[0].details?.from, to: edits[0].details?.to, by: edits[0].by_name, at: edits[0].created_at } : null,
  };
}

/** The Delivery Note number may be changed by hand exactly once; that logged change is the lock. */
export async function editDnNumber(db, type, id, value, userId) {
  const o = await dnOrder(db, type, id, true);
  const { rowCount } = await db.query("SELECT 1 FROM o2d_order_events WHERE order_id = $1 AND event = 'DN_NUMBER_EDITED'", [o.id]);
  if (rowCount) throw conflict('The Delivery Note number was already changed once — it cannot be edited again');
  if (value === o.delivery_note_no) throw badRequest('That is already the Delivery Note number');
  const { rows: used } = await db.query('SELECT COALESCE(system_order_no, enquiry_number) AS order_no FROM o2d_orders WHERE delivery_note_no = $1', [value]);
  if (used[0]) throw conflict(`${value} is already used by order ${used[0].order_no}`);
  await db.query('UPDATE o2d_orders SET delivery_note_no = $1, updated_by = $2, updated_at = NOW() WHERE id = $3', [value, userId, o.id]);
  await logEvent(db, o.id, userId, 'DN_NUMBER_EDITED', { reason: `${o.delivery_note_no || '—'} → ${value}`, details: { from: o.delivery_note_no, to: value } });
}

export async function saveLr(db, type, id, lr, userId) {
  const o = await dnOrder(db, type, id, true);
  if ((o.lr_number || null) === lr) return;
  await db.query('UPDATE o2d_orders SET lr_number = $1, updated_by = $2, updated_at = NOW() WHERE id = $3', [lr, userId, o.id]);
  await logEvent(db, o.id, userId, 'LR_CAPTURED', { reason: lr ? `LR ${lr}` : 'LR cleared' });
}

/** SEND_LR: transport confirmation to the client's WhatsApp group (or owner when no group). */
export async function sendLr(type, id, userId) {
  const o = await dnOrder({ query }, type, id);
  if (!o.lr_number) throw badRequest('Capture the LR number first');
  const { rows } = await query('SELECT company_name FROM clients WHERE id = $1', [o.client_ref]);
  const [group, owner] = await resolveRecipients(['CLIENT_GROUP', 'CLIENT_OWNER'], o.client_ref);
  const r = group.to ? group : owner;
  if (!r.to) throw badRequest('The client has no WhatsApp group or owner number');
  const trackingLink = o.tracking_token ? appLink(`/track/${o.tracking_token}`) : '';
  const fallback = [
    '*Fifth Seasons Decor — Dispatch Update*',
    `Dear ${rows[0].company_name},`,
    `Your order *${o.system_order_no || o.enquiry_number}* is with ${o.transport_name || 'the transport'}.`,
    `LR No: *${o.lr_number}*`,
    ...(o.tracking_token ? ['Track your order:', trackingLink] : []),
  ].join('\n');
  const message = await eventMessage(
    'SEND_LR',
    { company_name: rows[0].company_name, order_no: o.system_order_no || o.enquiry_number, transport_name: o.transport_name || 'the transport', lr_number: o.lr_number, tracking_link: trackingLink },
    fallback
  );
  const log = await sendAndLog({ triggerKey: 'SEND_LR', recipient: r, clientId: o.client_ref, message, userId });
  if (log.status !== 'SENT') throw badRequest(`WhatsApp not sent: ${log.error || 'unknown error'}`);
  await query('UPDATE o2d_orders SET lr_sent_at = NOW() WHERE id = $1', [o.id]);
  await logEvent({ query }, o.id, userId, 'LR_SENT', { reason: `LR ${o.lr_number} sent to ${r.label}` });
  return r.label;
}

export async function moveToPacking(db, type, id, userId) {
  const o = await dnOrder(db, type, id, true);
  await db.query("UPDATE o2d_orders SET workflow_status = 'PACKING', updated_by = $1, updated_at = NOW() WHERE id = $2", [userId, o.id]);
  await logEvent(db, o.id, userId, 'OKAY_TO_PROCEED', { from: 'DELIVERY_NOTE', to: 'PACKING', reason: 'Moved to Packing' });
}

export async function sendBackToCutting(db, type, id, reason, userId) {
  const o = await dnOrder(db, type, id, true);
  await db.query("UPDATE o2d_orders SET workflow_status = 'CUTTING', updated_by = $1, updated_at = NOW() WHERE id = $2", [userId, o.id]);
  await logEvent(db, o.id, userId, 'SEND_BACK', { from: 'DELIVERY_NOTE', to: 'CUTTING', reason });
}

/** Delivery Note PDF data: whole orders, or just the ticked items (items may span several orders). */
export async function dnPrint(type, { orderIds = [], itemIds = [] }) {
  const ids = [...new Set(orderIds.filter(isUuid))];
  const items = itemIds.filter(isUuid);
  if (items.length) {
    const { rows } = await query('SELECT DISTINCT order_id FROM o2d_order_items WHERE id = ANY($1::uuid[])', [items]);
    ids.push(...rows.map((r) => r.order_id).filter((x) => !ids.includes(x)));
  }
  if (!ids.length) throw badRequest('Select at least one item or order');
  const { rows } = await query(
    `SELECT ${ORDER_COLS}, o.transport_city, o.transport_contact, o.mode_of_dispatch FROM o2d_orders o JOIN clients c ON c.id = o.client_ref
      WHERE o.id = ANY($1::uuid[]) AND o.order_type = $2 AND o.status = 'ACTIVE' AND o.workflow_status = 'DELIVERY_NOTE'
      ORDER BY o.delivery_note_no`,
    [ids.slice(0, 200), type]
  );
  if (!rows.length) throw notFound('None of the selected orders are at Delivery Note');
  const lines = await cutLines({ query }, rows.map((o) => o.id));
  const all = await itemRows(rows);
  return rows.map((o) => {
    const batches = [...new Set((lines.get(o.id) || []).flatMap((l) => l.lots.map((x) => x.ioc_batch_no)).filter(Boolean))].sort();
    return {
      ...o,
      order_no: o.system_order_no || o.enquiry_number,
      ioc_numbers: [o.ioc_number, ...batches.map(String)].filter(Boolean).join(', '),
      items: all.filter((it) => it.order_id === o.id && (!items.length || items.includes(it.item_id) || orderIds.includes(o.id))),
    };
  });
}
