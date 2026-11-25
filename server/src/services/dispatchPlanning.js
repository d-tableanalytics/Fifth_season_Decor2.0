import { query } from '../config/db.js';
import { ZONES } from '../config/zones.js';
import { packItems } from './packing.js';
import { HttpError, badRequest, conflict, notFound } from '../utils/httpError.js';

/**
 * Planning to Dispatch: Cut + Roll orders at PLANNING_TO_DISPATCH or DELIVERY_NOTE_GENERATED.
 * "Generate Challan" makes the commercial dispatch challan and moves the order to DELIVERY_NOTE_GENERATED
 * in the same step; "Dispatch" (with the Tally delivery challan no.) moves it to DISPATCHED.
 */
export const CHALLAN_PREFIX = process.env.CHALLAN_PREFIX || 'DC';
const STAGES = ['PLANNING_TO_DISPATCH', 'DELIVERY_NOTE_GENERATED'];
const round2 = (n) => Math.round(n * 100) / 100;
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);

const logEvent = (db, orderId, userId, event, { from = null, to = null, reason = null } = {}) =>
  db.query('INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [
    orderId, event, from, to, reason, userId,
  ]);

/** Zone / address: the client's own when the client is in Surat, else the assigned transport's. */
export const ZONE_SQL = `CASE WHEN lower(btrim(c.city)) = 'surat' THEN c.zone ELSE t.zone END`;
const ADDRESS_SQL = `CASE WHEN lower(btrim(c.city)) = 'surat' THEN c.full_address
  ELSE 'Via transporter — ' || COALESCE(NULLIF(t.transport_full_address, ''), NULLIF(o.transport_address, ''), NULLIF(o.transport_name, '')) END`; // NULL (shown as —) when there is no transport
export const BASE_FROM = `FROM o2d_orders o JOIN clients c ON c.id = o.client_ref LEFT JOIN transports t ON t.id = o.transport_ref`;

export async function planningList({ search, zone, page, limit }) {
  const params = [STAGES];
  let where = "o.status = 'ACTIVE' AND o.order_type IN ('CUT', 'ROLL') AND o.workflow_status = ANY($1::text[])";
  if (search) {
    params.push(`%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where += ` AND (o.system_order_no ILIKE $${params.length} OR o.enquiry_number ILIKE $${params.length} OR c.company_name ILIKE $${params.length} OR c.client_id ILIKE $${params.length})`;
  }
  if (zone) {
    params.push(zone);
    where += ` AND ${ZONE_SQL} = $${params.length}`;
  }
  const { rows } = await query(
    `SELECT o.id, o.order_type, o.enquiry_number, o.system_order_no, o.workflow_status, o.delivery_note_no, c.client_id, c.company_name,
            ${ZONE_SQL} AS zone, ${ADDRESS_SQL} AS address, e.created_at AS entered_at,
            dc.challan_no, (SELECT COUNT(*)::int FROM o2d_parcels p WHERE p.order_id = o.id) AS parcels,
            COUNT(*) OVER()::int AS total_count
       ${BASE_FROM}
       LEFT JOIN dispatch_challans dc ON dc.order_id = o.id
       LEFT JOIN LATERAL (SELECT created_at FROM o2d_order_events WHERE order_id = o.id AND to_stage = o.workflow_status ORDER BY id DESC LIMIT 1) e ON TRUE
      WHERE ${where}
      ORDER BY e.created_at NULLS LAST, o.id
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params
  );
  return { data: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0, zones: ZONES };
}

async function planningOrder(db, id, stages = STAGES, lock = false) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await db.query(`SELECT * FROM o2d_orders WHERE id = $1 AND order_type IN ('CUT', 'ROLL')${lock ? ' FOR UPDATE' : ''}`, [id]);
  const o = rows[0];
  if (!o) throw notFound('Order not found');
  if (o.status !== 'ACTIVE' || !stages.includes(o.workflow_status)) throw conflict(`Order is not at ${stages.map((s) => s.replace(/_/g, ' ').toLowerCase()).join(' / ')}`);
  return o;
}

/** Items to put on the challan: packed qty (cut qty when nothing was packed), with the Stock Check rate as a suggestion. */
async function challanItems(db, orderId) {
  const [items, { rows: rates }] = await Promise.all([
    packItems(db, [orderId]),
    db.query('SELECT item_id, rate::float AS rate FROM o2d_item_stock_checks WHERE order_id = $1', [orderId]),
  ]);
  const rate = new Map(rates.map((r) => [r.item_id, r.rate]));
  return items.get(orderId).map((i) => ({
    item_id: i.id,
    line: i.line,
    item_name: i.item_name,
    unit: i.unit,
    qty: i.packed > 0 ? i.packed : i.eligible,
    suggested_rate: rate.get(i.id) ?? null,
  }));
}

export async function challanDraft(id) {
  const o = await planningOrder({ query }, id);
  const [{ rows: info }, items, challan, { rows: parcels }] = await Promise.all([
    query(`SELECT c.client_id, c.company_name, ${ZONE_SQL} AS zone, ${ADDRESS_SQL} AS address ${BASE_FROM} WHERE o.id = $1`, [o.id]),
    challanItems({ query }, o.id),
    challanFor({ query }, o.id),
    query('SELECT id FROM o2d_parcels WHERE order_id = $1 ORDER BY parcel_no', [o.id]),
  ]);
  return {
    id: o.id,
    order_type: o.order_type,
    order_no: o.system_order_no || o.enquiry_number,
    workflow_status: o.workflow_status,
    delivery_note_no: o.delivery_note_no,
    ...info[0],
    items,
    parcels: parcels.length,
    parcel_ids: parcels.map((p) => p.id),
    challan,
  };
}

async function challanFor(db, orderId) {
  const { rows } = await db.query('SELECT * FROM dispatch_challans WHERE order_id = $1', [orderId]);
  if (!rows[0]) return null;
  const { rows: items } = await db.query(
    `SELECT item_id, item_name, unit, hsn_code, qty::float AS qty, rate::float AS rate, discount_pct::float AS discount_pct, box_count, amount::float AS amount
       FROM dispatch_challan_items WHERE challan_id = $1 ORDER BY sort_order`,
    [rows[0].id]
  );
  const c = rows[0];
  return {
    challan_no: c.challan_no,
    packed_by: c.packed_by,
    salesman: c.salesman,
    tot_parcels: c.tot_parcels,
    total_qty: Number(c.total_qty),
    total_gross_amount: Number(c.total_gross_amount),
    total_discount: Number(c.total_discount),
    net_total_amount: Number(c.net_total_amount),
    created_at: c.created_at,
    items,
  };
}

/** Indian financial year (April–March) in IST, short form: "26-27". */
async function financialYear(db) {
  const { rows } = await db.query("SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS d");
  const d = new Date(rows[0].d);
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  return `${String(y % 100).padStart(2, '0')}-${String((y + 1) % 100).padStart(2, '0')}`;
}

/**
 * body: { packed_by, salesman, tot_parcels, items: [{ item_id, hsn_code, rate, discount_pct, box_count }] }
 * Every order item must appear exactly once. An existing challan is reused as-is (no new number).
 */
export async function generateChallan(db, id, body, userId) {
  const o = await planningOrder(db, id, ['PLANNING_TO_DISPATCH'], true);
  let challan = await challanFor(db, o.id);
  if (!challan) {
    const items = await challanItems(db, o.id);
    const given = new Map();
    for (const it of body.items) {
      if (given.has(it.item_id)) throw badRequest('An item appears twice in the challan');
      given.set(it.item_id, it);
    }
    const unknown = body.items.filter((it) => !items.some((x) => x.item_id === it.item_id));
    if (unknown.length) throw badRequest('An item does not belong to this order');
    const missing = items.filter((x) => !given.has(x.item_id));
    if (missing.length) {
      const err = new HttpError(400, `Missing challan detail for: ${missing.map((x) => x.item_name).join(', ')}`);
      err.details = { missing: missing.map((x) => x.item_id) };
      throw err;
    }
    const lines = items.map((x, i) => {
      const g = given.get(x.item_id);
      const gross = round2(x.qty * g.rate);
      return { ...x, hsn_code: g.hsn_code || null, rate: g.rate, discount_pct: g.discount_pct ?? 0, box_count: g.box_count ?? 1, gross, amount: round2(x.qty * g.rate * (1 - (g.discount_pct ?? 0) / 100)), sort: i };
    });
    const totalQty = round2(lines.reduce((s, l) => s + l.qty, 0));
    const gross = round2(lines.reduce((s, l) => s + l.gross, 0));
    const net = round2(lines.reduce((s, l) => s + l.amount, 0));

    const fy = await financialYear(db);
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`seq:dispatch_challan:${fy}`]);
    const { rows: seq } = await db.query('SELECT COALESCE(MAX(sequence_no), 0) + 1 AS n FROM dispatch_challans WHERE financial_year = $1', [fy]);
    const n = seq[0].n;
    const { rows } = await db.query(
      `INSERT INTO dispatch_challans (order_id, challan_no, financial_year, sequence_no, packed_by, salesman, tot_parcels, total_qty,
              total_gross_amount, total_discount, net_total_amount, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
      [o.id, `${CHALLAN_PREFIX}/${n}/${fy}`, fy, n, body.packed_by || null, body.salesman || null, body.tot_parcels || 1, totalQty, gross, round2(gross - net), net, userId]
    );
    for (const l of lines) {
      await db.query(
        `INSERT INTO dispatch_challan_items (challan_id, item_id, item_name, unit, hsn_code, qty, rate, discount_pct, box_count, amount, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [rows[0].id, l.item_id, l.item_name, l.unit, l.hsn_code, l.qty, l.rate, l.discount_pct, l.box_count, l.amount, l.sort]
      );
    }
    challan = await challanFor(db, o.id);
  }
  await db.query("UPDATE o2d_orders SET workflow_status = 'DELIVERY_NOTE_GENERATED', updated_by = $1, updated_at = NOW() WHERE id = $2", [userId, o.id]);
  await logEvent(db, o.id, userId, 'CHALLAN_GENERATED', { from: 'PLANNING_TO_DISPATCH', to: 'DELIVERY_NOTE_GENERATED', reason: `Challan ${challan.challan_no}` });
  return challan;
}

export async function dispatchOrder(db, id, tallyNo, userId) {
  const o = await planningOrder(db, id, ['DELIVERY_NOTE_GENERATED'], true);
  await db.query("UPDATE o2d_orders SET workflow_status = 'DISPATCHED', updated_by = $1, updated_at = NOW() WHERE id = $2", [userId, o.id]);
  await logEvent(db, o.id, userId, 'DISPATCHED', {
    from: 'DELIVERY_NOTE_GENERATED',
    to: 'DISPATCHED',
    reason: tallyNo ? `Tally Delivery Challan No: ${tallyNo}` : 'Dispatched',
  });
}

/** Challan PDF data (any time after it was generated). */
export async function challanPrint(id) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await query(
    `SELECT o.id, o.order_type, o.enquiry_number, o.system_order_no, o.delivery_note_no, o.lr_number, o.transport_name, o.transport_city,
            o.mode_of_dispatch, c.client_id, c.company_name, c.full_address, c.city, c.state, c.pin, c.gstin, c.owner_contact_no
       FROM o2d_orders o JOIN clients c ON c.id = o.client_ref WHERE o.id = $1`,
    [id]
  );
  if (!rows[0]) throw notFound('Order not found');
  const challan = await challanFor({ query }, id);
  if (!challan) throw notFound('No challan has been generated for this order yet');
  return { ...rows[0], order_no: rows[0].system_order_no || rows[0].enquiry_number, challan };
}
