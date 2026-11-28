import { query } from '../config/db.js';
import { signImageFields } from '../config/s3.js';
import { packItems } from './packing.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';
import { logActivity } from './activity.js';

/**
 * Delivery Planning & Entry: warehouse-pickup handover entries on a map, closed out as delivered either to the
 * customer or to a courier / transporter. Entries are only created at Handover; this screen reads and closes them.
 */
const SURAT = `lower(btrim(c.city)) = 'surat' AND COALESCE(c.full_address, '') <> ''`;
const SELECT = `SELECT e.*, c.client_id, c.company_name,
    (${SURAT}) AS from_client,
    CASE WHEN ${SURAT} THEN c.full_address ELSE COALESCE(NULLIF(t.transport_full_address, ''), NULLIF(o.transport_address, '')) END AS address,
    COALESCE(e.lat, CASE WHEN ${SURAT} THEN c.latitude ELSE t.transport_latitude END)::float AS map_lat,
    COALESCE(e.lng, CASE WHEN ${SURAT} THEN c.longitude ELSE t.transport_longitude END)::float AS map_lng
  FROM dispatch_entries e
  LEFT JOIN o2d_orders o ON o.id = e.linked_order_id
  LEFT JOIN clients c ON c.id = o.client_ref
  LEFT JOIN transports t ON t.id = o.transport_ref`;

/** Badge: LOCAL when the address is the client's own, else the zone code, else TRANSPORT. */
const shape = (r) => ({ ...r, badge: r.from_client ? 'LOCAL' : r.zone || 'TRANSPORT' });

export async function deliveryList({ zone, status }) {
  const params = [];
  const where = ['e.warehouse_pickup'];
  if (zone) {
    params.push(zone);
    where.push(`e.zone = $${params.length}`);
  }
  if (status === 'pending') where.push("e.status = 'Dispatched'");
  if (status === 'delivered') where.push("e.status = 'Delivered'");
  const { rows } = await query(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY e.entry_date DESC, e.id DESC LIMIT 500`, params);
  return signImageFields(rows.map(shape), ['proof_url']);
}

/** "Scan Bill No": searches every entry, ignoring the screen's filters. */
export async function findByBill(billNo) {
  const b = String(billNo || '').trim();
  if (!b) throw badRequest('Scan or type a bill no.');
  const { rows } = await query(`${SELECT} WHERE upper(e.bill_no) = upper($1)`, [b]);
  if (!rows[0]) throw notFound(`No handover entry for bill "${b}"`);
  return (await signImageFields([shape(rows[0])], ['proof_url']))[0];
}

async function entryById(id) {
  const n = Number(id);
  if (!Number.isInteger(n)) throw notFound('Entry not found');
  const { rows } = await query(`${SELECT} WHERE e.id = $1`, [n]);
  if (!rows[0]) throw notFound('Entry not found');
  return rows[0];
}

export async function getEntry(id) {
  return (await signImageFields([shape(await entryById(id))], ['proof_url']))[0];
}

/** Items of the linked order: the challan lines when there is a challan, else the packed items. */
export async function entryItems(id) {
  const e = await entryById(id);
  if (!e.linked_order_id) return [];
  const { rows } = await query(
    `SELECT ci.item_name, ci.unit, ci.qty::float AS qty, ci.box_count FROM dispatch_challan_items ci
      JOIN dispatch_challans dc ON dc.id = ci.challan_id WHERE dc.order_id = $1 ORDER BY ci.sort_order`,
    [e.linked_order_id]
  );
  if (rows.length) return rows;
  const items = (await packItems({ query }, [e.linked_order_id])).get(e.linked_order_id) || [];
  return items.map((i) => ({ item_name: i.item_name, unit: i.unit, qty: i.packed || i.eligible, box_count: null }));
}

/* ---------------- Geocoding (OpenStreetMap Nominatim, ~1 request / second) ---------------- */

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const GEOCODE_BATCH = 20;

async function geocode(address) {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=in&q=${encodeURIComponent(address)}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'FifthSeasonsDecor-ERP/1.0', Accept: 'application/json' }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`Geocoding service answered ${res.status}`);
  const [hit] = await res.json();
  return hit ? { lat: Number(hit.lat), lng: Number(hit.lon) } : null;
}

/** Geocode up to GEOCODE_BATCH warehouse-pickup entries that have an address but no coordinates. */
export async function geocodeMissing() {
  const { rows } = await query(`${SELECT} WHERE e.warehouse_pickup ORDER BY e.id DESC LIMIT 500`);
  const todo = rows.filter((r) => r.map_lat == null && r.address).slice(0, GEOCODE_BATCH);
  let found = 0;
  const failed = [];
  for (const [i, r] of todo.entries()) {
    if (i) await wait(1100);
    try {
      const hit = await geocode(r.address);
      if (!hit) {
        failed.push(r.bill_no);
        continue;
      }
      await query('UPDATE dispatch_entries SET lat = $1, lng = $2 WHERE id = $3', [hit.lat, hit.lng, r.id]);
      found++;
    } catch {
      failed.push(r.bill_no);
    }
  }
  const remaining = rows.filter((r) => r.map_lat == null && r.address).length - found;
  return { tried: todo.length, found, failed, remaining: Math.max(0, remaining) };
}

/* ---------------- Delivery ---------------- */

async function openEntry(id) {
  const e = await entryById(id);
  if (e.status === 'Delivered') throw conflict(`Bill ${e.bill_no} is already delivered`);
  return e;
}

export async function deliverCustomer(id, b, userId) {
  const e = await openEntry(id);
  if (!b.customer_name) throw badRequest('Customer name is required');
  if (!/^\d{10}$/.test(b.customer_phone || '')) throw badRequest('Customer number must be exactly 10 digits');
  await query(
    `UPDATE dispatch_entries SET delivery_method = 'CUSTOMER', status = 'Delivered', delivered_at = NOW(), customer_name = $1, customer_phone = $2,
            cash_received_from_customer = $3, proof_url = $4, updated_by = $5, updated_at = NOW() WHERE id = $6 AND status = 'Dispatched'`,
    [b.customer_name, b.customer_phone, b.cash_received ?? null, b.proof_url || null, userId, e.id]
  );
  if (e.linked_order_id) {
    await logActivity({ query }, e.linked_order_id, userId, 'DELIVERED',
      `Bill ${e.bill_no} delivered to customer ${b.customer_name} (${b.customer_phone})${b.cash_received ? ` · cash ₹${b.cash_received}` : ''}`);
  }
  return getEntry(e.id);
}

export async function deliverCourier(id, b, userId) {
  const e = await openEntry(id);
  if (!b.transport) throw badRequest('Courier / transporter name is required');
  await query(
    `UPDATE dispatch_entries SET delivery_method = 'COURIER', status = 'Delivered', delivered_at = NOW(), transport = $1, lr_number = $2,
            cash_paid_to_transporter = $3, proof_url = $4, updated_by = $5, updated_at = NOW() WHERE id = $6 AND status = 'Dispatched'`,
    [b.transport, b.lr_number || null, b.cash_paid ?? null, b.proof_url || null, userId, e.id]
  );
  if (e.linked_order_id) {
    await logActivity({ query }, e.linked_order_id, userId, 'DELIVERED', `Bill ${e.bill_no} handed to courier ${b.transport}${b.lr_number ? ` · LR ${b.lr_number}` : ''}`);
  }
  return getEntry(e.id);
}
