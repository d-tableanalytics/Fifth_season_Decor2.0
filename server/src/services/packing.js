import { query } from '../config/db.js';
import { STAGES } from '../config/o2d.js';
import { cutLines } from './cutting.js';
import { HttpError, badRequest, conflict, notFound } from '../utils/httpError.js';

/**
 * O2D Packing: parcels are built one at a time. Eligible qty of an item = its cut qty
 * (the required qty when nothing was cut). Packing Complete is refused until every item is fully packed.
 */
const round2 = (n) => Math.round(n * 100) / 100;
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);
const AFTER_PACKING = new Set(STAGES.slice(STAGES.indexOf('PACKING_COMPLETED') + 1));
const PACKING_STAGES = ['PACKING', 'PACKING_COMPLETED'];

const logEvent = (db, orderId, userId, event, { from = null, to = null, reason = null, details = null } = {}) =>
  db.query('INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason, details, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    orderId, event, from, to, reason, details && JSON.stringify(details), userId,
  ]);

async function packOrder(db, type, id, stages = PACKING_STAGES, lock = false) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await db.query(`SELECT * FROM o2d_orders WHERE id = $1 AND order_type = $2${lock ? ' FOR UPDATE' : ''}`, [id, type]);
  const o = rows[0];
  if (!o) throw notFound('Order not found');
  if (o.status !== 'ACTIVE' || !stages.includes(o.workflow_status)) {
    throw conflict(stages.length === 1 ? `Order is not at ${stages[0] === 'PACKING' ? 'Packing' : 'Packing Completed'}` : 'Order is not at Packing');
  }
  return o;
}

/** Items with ordered / picked / packed / remaining, all computed from saved rows. */
export async function packItems(db, orderIds) {
  const [lines, { rows: packed }] = await Promise.all([
    cutLines(db, orderIds),
    db.query(
      `SELECT pi.item_id, SUM(pi.qty)::float AS qty FROM o2d_parcel_items pi JOIN o2d_parcels p ON p.id = pi.parcel_id
        WHERE p.order_id = ANY($1::uuid[]) GROUP BY pi.item_id`,
      [orderIds]
    ),
  ]);
  const packedBy = new Map(packed.map((r) => [r.item_id, r.qty]));
  const out = new Map();
  for (const [id, ls] of lines) {
    out.set(
      id,
      ls.map((l) => {
        const cutDone = l.lots.some((x) => x.cut_qty > 0) || l.cut_qty > 0;
        const eligible = cutDone ? l.cut_qty : l.target;
        const pk = round2(packedBy.get(l.id) || 0);
        const picked = round2(l.lots.reduce((s, x) => s + x.picked, 0));
        const remaining = round2(Math.max(0, eligible - pk));
        return {
          id: l.id,
          line: l.line,
          item_name: l.item_name,
          unit: l.unit,
          lot_no: l.lot_no,
          ordered: l.ordered,
          picked,
          eligible: round2(eligible),
          packed: pk,
          remaining,
          status: pk >= eligible && eligible > 0 ? 'FULLY_PACKED' : pk > 0 ? 'PARTIALLY_PACKED' : picked > 0 ? 'PICKED' : 'NOT_PICKED',
        };
      })
    );
  }
  return out;
}

const packingStatus = (items) =>
  items.length && items.every((i) => i.status === 'FULLY_PACKED') ? 'FULLY_PACKED' : items.some((i) => i.packed > 0) ? 'PARTIALLY_PACKED' : 'NOT_STARTED';

/* ---------------- Queue ---------------- */

export async function packingQueue(type, { search, page, limit }) {
  const params = [type];
  let where = "o.order_type = $1 AND o.status = 'ACTIVE' AND o.workflow_status IN ('PACKING', 'PACKING_COMPLETED')";
  if (search) {
    params.push(`%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where += ` AND (o.enquiry_number ILIKE $2 OR o.system_order_no ILIKE $2 OR c.client_id ILIKE $2 OR c.company_name ILIKE $2)`;
  }
  const { rows } = await query(
    `SELECT o.id, o.enquiry_number, o.system_order_no, o.workflow_status, o.team_remark, o.customer_remark, c.client_id, c.company_name,
            e.created_at AS entered_at, e.from_stage AS entered_from,
            (SELECT COUNT(*)::int FROM o2d_parcels p WHERE p.order_id = o.id) AS parcels,
            lp.packed_at AS last_packed_at, lp.packed_by AS last_packed_by,
            COUNT(*) OVER()::int AS total_count
       FROM o2d_orders o JOIN clients c ON c.id = o.client_ref
       LEFT JOIN LATERAL (SELECT created_at, from_stage FROM o2d_order_events WHERE order_id = o.id AND to_stage = 'PACKING' ORDER BY id DESC LIMIT 1) e ON TRUE
       LEFT JOIN LATERAL (SELECT p.packed_at, u.name AS packed_by FROM o2d_parcels p LEFT JOIN users u ON u.id = p.packed_by
                           WHERE p.order_id = o.id ORDER BY p.packed_at DESC LIMIT 1) lp ON TRUE
      WHERE ${where}
      ORDER BY e.created_at NULLS LAST, o.id
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params
  );
  const items = rows.length ? await packItems({ query }, rows.map((r) => r.id)) : new Map();
  return {
    data: rows.map(({ total_count, team_remark, customer_remark, ...r }) => {
      const its = items.get(r.id) || [];
      return {
        ...r,
        sent_back: AFTER_PACKING.has(r.entered_from),
        has_remarks: !!(team_remark || customer_remark),
        items: its.length,
        total_qty: round2(its.reduce((s, i) => s + i.eligible, 0)),
        picked: round2(its.reduce((s, i) => s + i.picked, 0)),
        packed: round2(its.reduce((s, i) => s + i.packed, 0)),
        pending: round2(its.reduce((s, i) => s + i.remaining, 0)),
        packing_status: packingStatus(its),
        lot_nos: [...new Set(its.flatMap((i) => (i.lot_no || '').split(', ')).filter(Boolean))].join(', '),
      };
    }),
    total: rows[0]?.total_count ?? 0,
  };
}

/** Scan / typed lookup: an order no. (or enquiry no.) or a parcel sticker "PKT-…". Never packs anything. */
export async function lookupCode(type, code) {
  const c = String(code || '').trim();
  if (!c) throw badRequest('Enter or scan an order number');
  const { rows: parcel } = await query(
    `SELECT p.id AS parcel_id, o.id AS order_id, o.status, o.workflow_status FROM o2d_parcels p JOIN o2d_orders o ON o.id = p.order_id
      WHERE upper(p.qr_ref) = upper($1) AND o.order_type = $2`,
    [c, type]
  );
  const hit = parcel[0] || (await query(
    `SELECT NULL::uuid AS parcel_id, id AS order_id, status, workflow_status FROM o2d_orders
      WHERE order_type = $2 AND (upper(system_order_no) = upper($1) OR upper(enquiry_number) = upper($1)) LIMIT 1`,
    [c, type]
  )).rows[0];
  if (!hit) throw notFound(`No order or parcel found for "${c}"`);
  if (hit.status !== 'ACTIVE' || !PACKING_STAGES.includes(hit.workflow_status)) throw conflict(`"${c}" is not at Packing (it is at ${hit.workflow_status.replace(/_/g, ' ').toLowerCase()})`);
  return { order_id: hit.order_id, parcel_id: hit.parcel_id };
}

/* ---------------- Detail ---------------- */

export async function packingDetail(type, id) {
  const o = await packOrder({ query }, type, id);
  const [{ rows: info }, items, { rows: parcels }] = await Promise.all([
    query('SELECT client_id, company_name, city FROM clients WHERE id = $1', [o.client_ref]),
    packItems({ query }, [o.id]),
    query(
      `SELECT p.id, p.parcel_no, p.qr_ref, p.remarks, p.packed_at, u.name AS packed_by,
              json_agg(json_build_object('item_id', pi.item_id, 'qty', pi.qty::float, 'pcs', pi.pcs) ORDER BY pi.id) AS items
         FROM o2d_parcels p LEFT JOIN users u ON u.id = p.packed_by JOIN o2d_parcel_items pi ON pi.parcel_id = p.id
        WHERE p.order_id = $1 GROUP BY p.id, u.name ORDER BY p.parcel_no`,
      [o.id]
    ),
  ]);
  const its = items.get(o.id);
  const byId = new Map(its.map((i) => [i.id, i]));
  return {
    id: o.id,
    enquiry_number: o.enquiry_number,
    system_order_no: o.system_order_no,
    delivery_note_no: o.delivery_note_no,
    workflow_status: o.workflow_status,
    transport_name: o.transport_name,
    team_remark: o.team_remark,
    customer_remark: o.customer_remark,
    ...info[0],
    items: its,
    packing_status: packingStatus(its),
    parcels: parcels.map((p) => ({
      ...p,
      items: p.items.map((x) => ({ ...x, line: byId.get(x.item_id)?.line, item_name: byId.get(x.item_id)?.item_name, unit: byId.get(x.item_id)?.unit })),
      total_qty: round2(p.items.reduce((s, x) => s + x.qty, 0)),
      total_pcs: p.items.reduce((s, x) => s + x.pcs, 0),
    })),
  };
}

/* ---------------- Create parcel ---------------- */

/** body: { request_id, remarks, items: [{ item_id, qty, pcs }] } */
export async function createParcel(db, type, orderId, body, userId) {
  if (body.request_id) {
    const { rows } = await db.query('SELECT id, order_id, parcel_no FROM o2d_parcels WHERE request_id = $1', [body.request_id]);
    if (rows[0]) {
      if (rows[0].order_id !== orderId) throw conflict('Duplicate request id');
      return { parcel_id: rows[0].id, parcel_no: rows[0].parcel_no, duplicate: true };
    }
  }
  const o = await packOrder(db, type, orderId, ['PACKING'], true); // order row lock serialises concurrent packers
  if (!body.items.length) throw badRequest('Select at least one item for the parcel');
  const ids = body.items.map((i) => i.item_id);
  if (new Set(ids).size !== ids.length) throw badRequest('An item is repeated in the same parcel');
  const items = (await packItems(db, [o.id])).get(o.id);
  const errors = [];
  for (const it of body.items) {
    const line = items.find((x) => x.id === it.item_id);
    if (!line) throw badRequest('An item does not belong to this order');
    if (!(it.qty > 0)) errors.push(`Line ${line.line}: qty must be more than 0`);
    else if (round2(it.qty) > line.remaining) errors.push(`Line ${line.line}: ${it.qty} is more than the ${line.remaining} ${line.unit} still to pack`);
  }
  if (errors.length) {
    const err = new HttpError(400, errors[0]);
    err.details = { errors };
    throw err;
  }
  const { rows: n } = await db.query('SELECT COALESCE(MAX(parcel_no), 0) + 1 AS n FROM o2d_parcels WHERE order_id = $1', [o.id]);
  const parcelNo = n[0].n;
  const ref = `PKT-${o.system_order_no || o.enquiry_number}-${parcelNo}`;
  const { rows } = await db.query(
    'INSERT INTO o2d_parcels (order_id, parcel_no, qr_ref, remarks, request_id, packed_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [o.id, parcelNo, ref, body.remarks || null, body.request_id || null, userId]
  );
  for (const it of body.items) {
    await db.query('INSERT INTO o2d_parcel_items (parcel_id, item_id, qty, pcs) VALUES ($1,$2,$3,$4)', [rows[0].id, it.item_id, round2(it.qty), it.pcs || 1]);
  }
  await logEvent(db, o.id, userId, 'PARCEL_PACKED', {
    reason: `Parcel ${parcelNo} (${ref}): ${body.items.map((it) => `${items.find((x) => x.id === it.item_id).line} ${it.qty}`).join(', ')}`,
  });
  return { parcel_id: rows[0].id, parcel_no: parcelNo };
}

/* ---------------- Moves ---------------- */

export async function completePacking(db, type, orderId, userId) {
  const o = await packOrder(db, type, orderId, ['PACKING'], true);
  const items = (await packItems(db, [o.id])).get(o.id);
  const short = items.filter((i) => i.remaining > 0);
  if (short.length) {
    const err = new HttpError(409, `Not fully packed: ${short.map((i) => `${i.line} ${i.item_name} (${i.remaining} ${i.unit} left)`).join('; ')}`);
    err.details = { short: short.map((i) => ({ line: i.line, item: i.item_name, remaining: i.remaining, unit: i.unit })) };
    throw err;
  }
  await db.query("UPDATE o2d_orders SET workflow_status = 'PACKING_COMPLETED', updated_by = $1, updated_at = NOW() WHERE id = $2", [userId, o.id]);
  await logEvent(db, o.id, userId, 'PACKING_DONE', { from: 'PACKING', to: 'PACKING_COMPLETED', reason: 'Packing complete' });
}

export async function moveToPlanning(db, type, orderId, userId) {
  const o = await packOrder(db, type, orderId, ['PACKING_COMPLETED'], true);
  await db.query("UPDATE o2d_orders SET workflow_status = 'PLANNING_TO_DISPATCH', updated_by = $1, updated_at = NOW() WHERE id = $2", [userId, o.id]);
  await logEvent(db, o.id, userId, 'OKAY_TO_PROCEED', { from: 'PACKING_COMPLETED', to: 'PLANNING_TO_DISPATCH', reason: 'Moved to Planning to Dispatch' });
}

export async function sendBackToDn(db, type, orderId, reason, userId) {
  const o = await packOrder(db, type, orderId, ['PACKING'], true);
  await db.query("UPDATE o2d_orders SET workflow_status = 'DELIVERY_NOTE', updated_by = $1, updated_at = NOW() WHERE id = $2", [userId, o.id]);
  await logEvent(db, o.id, userId, 'SEND_BACK', { from: 'PACKING', to: 'DELIVERY_NOTE', reason });
}
