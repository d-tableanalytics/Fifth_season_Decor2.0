import { query, withTransaction } from '../config/db.js';
import { ZONES } from '../config/zones.js';
import { ZONE_SQL, BASE_FROM } from './dispatchPlanning.js';
import { badRequest, notFound } from '../utils/httpError.js';

/**
 * Dispatch Handover: a paperwork log of bills physically handed over. Saving never changes an order's status.
 * bill_no is the natural key (a re-saved bill updates its row). Linked order details are snapshots.
 */
const HANDOVER_BY_KEY = 'dispatch.handover_by';
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);

/* ---------------- Lists (Handover By names, drivers) ---------------- */

export async function handoverMeta() {
  const [{ rows: s }, { rows: drivers }] = await Promise.all([
    query('SELECT value FROM app_settings WHERE key = $1', [HANDOVER_BY_KEY]),
    query('SELECT id, name, phone FROM dispatch_drivers ORDER BY sort_order, id'),
  ]);
  return { handover_by: Array.isArray(s[0]?.value) ? s[0].value : [], drivers, zones: ZONES };
}

export async function saveLists({ handover_by, drivers }, userId) {
  await withTransaction(async (db) => {
    await db.query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [HANDOVER_BY_KEY, JSON.stringify(handover_by), userId]
    );
    // Entries keep the driver's name as text (no FK), so the list can be replaced freely
    await db.query('DELETE FROM dispatch_drivers');
    for (const [i, d] of drivers.entries()) {
      await db.query('INSERT INTO dispatch_drivers (name, phone, sort_order) VALUES ($1,$2,$3)', [d.name, d.phone || null, i]);
    }
  });
  return handoverMeta();
}

export async function searchTransporters(search) {
  const like = `%${String(search || '').trim().slice(0, 80).replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const { rows } = await query(
    `SELECT id, transport_id, transport_name, transport_contact_person, transport_contact_number, zone FROM transports
      WHERE is_active AND (transport_name ILIKE $1 OR transport_id ILIKE $1) ORDER BY transport_name LIMIT 30`,
    [like]
  );
  return rows;
}

/* ---------------- Orders ---------------- */

const ORDER_COLS = `o.id, o.order_type, COALESCE(o.system_order_no, o.enquiry_number) AS order_no, o.transport_name,
  c.client_id, c.company_name, ${ZONE_SQL} AS zone, dc.challan_no,
  (SELECT created_at FROM o2d_order_events e WHERE e.order_id = o.id AND e.to_stage = 'DISPATCHED' ORDER BY e.id DESC LIMIT 1) AS dispatched_at`;
const UNLINKED = `o.status = 'ACTIVE' AND o.workflow_status = 'DISPATCHED' AND o.order_type IN ('CUT', 'ROLL')
  AND NOT EXISTS (SELECT 1 FROM dispatch_entries de WHERE de.linked_order_id = o.id)`;

/** Dispatched orders not yet linked to a bill. Warehouse pickup = only that zone's orders; otherwise every zone. */
export async function linkableOrders({ warehousePickup, zone }) {
  const z = warehousePickup ? zone || undefined : undefined;
  if (warehousePickup && !z) return [];
  const params = [];
  let where = UNLINKED;
  if (z) {
    params.push(z);
    where += ` AND ${ZONE_SQL} = $1`;
  }
  const { rows } = await query(
    `SELECT ${ORDER_COLS} ${BASE_FROM} LEFT JOIN dispatch_challans dc ON dc.order_id = o.id WHERE ${where} ORDER BY order_no LIMIT 300`,
    params
  );
  return rows;
}

/** Pending tab: every dispatched order that has no handover entry yet. */
export async function pendingOrders() {
  const { rows } = await query(
    `SELECT ${ORDER_COLS} ${BASE_FROM} LEFT JOIN dispatch_challans dc ON dc.order_id = o.id WHERE ${UNLINKED} ORDER BY dispatched_at NULLS LAST`
  );
  return rows;
}

/* ---------------- Save batch ---------------- */

function validateRow(r) {
  const errs = [];
  if (!r.entry_date || !/^\d{4}-\d{2}-\d{2}$/.test(r.entry_date)) errs.push('Date is required');
  if (!r.handover_by) errs.push('Handover By is required');
  if (!['DRIVER', 'TRANSPORTER'].includes(r.pickup_party_type)) errs.push('Choose a driver or a transporter');
  if (!r.pickup_party_name) errs.push('Driver / transporter name is required');
  if (!r.person_taking) errs.push('Person Taking is required');
  if (!/^\d{10}$/.test(r.phone || '')) errs.push('Phone must be exactly 10 digits');
  if (!r.bill_no) errs.push('Bill No is required');
  if (!Number.isFinite(r.parcel_count) || r.parcel_count < 1) errs.push('Parcels must be at least 1');
  if (r.linked_order_id && !isUuid(r.linked_order_id)) errs.push('Invalid linked order');
  return errs;
}

/**
 * Save a queue of handover rows. Each row is saved on its own (one failing row doesn't stop the others).
 * Repeated bill no. in the same batch: the first one wins. A bill no. saved earlier is updated in place.
 */
export async function saveBatch(rows, userId) {
  const seen = new Set();
  const results = [];
  for (const raw of rows) {
    const r = { ...raw, bill_no: String(raw.bill_no || '').trim() };
    const key = r.bill_no.toUpperCase();
    if (r.bill_no && seen.has(key)) {
      results.push({ bill_no: r.bill_no, status: 'SKIPPED', error: 'Repeated in this batch — the first row was kept' });
      continue;
    }
    seen.add(key);
    const errs = validateRow(r);
    if (errs.length) {
      results.push({ bill_no: r.bill_no, status: 'FAILED', error: errs.join('; ') });
      continue;
    }
    try {
      const status = await withTransaction(async (db) => {
        let snap = { zone: null, linked_order_type: null, linked_order_no: null, linked_challan_no: null, linked_transport_name: null };
        if (r.linked_order_id) {
          const { rows: o } = await db.query(
            `SELECT o.id, o.order_type, o.workflow_status, o.status, COALESCE(o.system_order_no, o.enquiry_number) AS order_no, o.transport_name,
                    ${ZONE_SQL} AS zone, dc.challan_no
               ${BASE_FROM} LEFT JOIN dispatch_challans dc ON dc.order_id = o.id WHERE o.id = $1 FOR UPDATE OF o`,
            [r.linked_order_id]
          );
          if (!o[0]) throw badRequest('Linked order not found');
          if (!['CUT', 'ROLL'].includes(o[0].order_type)) throw badRequest('Only Cut or Roll orders can be linked');
          const { rows: claimed } = await db.query('SELECT bill_no FROM dispatch_entries WHERE linked_order_id = $1 AND upper(bill_no) <> upper($2)', [o[0].id, r.bill_no]);
          if (claimed[0]) throw badRequest(`Order ${o[0].order_no} is already linked to bill ${claimed[0].bill_no}`);
          snap = { zone: o[0].zone, linked_order_type: o[0].order_type, linked_order_no: o[0].order_no, linked_challan_no: o[0].challan_no, linked_transport_name: o[0].transport_name };
        }
        const vals = [
          r.entry_date, r.handover_by, !!r.warehouse_pickup, r.pickup_party_type, r.pickup_party_name, r.pickup_party_ref_id || null,
          r.person_taking, r.phone, r.parcel_count, r.source === 'SCANNED' ? 'SCANNED' : 'MANUAL',
          // the linked order's zone; else (or when the order has none) the zone picked for a warehouse pickup
          snap.zone || (r.warehouse_pickup ? r.zone || null : null),
          snap.linked_order_type, r.linked_order_id || null, snap.linked_order_no, snap.linked_challan_no, snap.linked_transport_name, userId,
        ];
        const { rows: existing } = await db.query('SELECT id FROM dispatch_entries WHERE upper(bill_no) = upper($1) FOR UPDATE', [r.bill_no]);
        if (existing[0]) {
          await db.query(
            `UPDATE dispatch_entries SET entry_date = $1, handover_by = $2, warehouse_pickup = $3, pickup_party_type = $4, pickup_party_name = $5,
                    pickup_party_ref_id = $6, person_taking = $7, phone = $8, parcel_count = $9, source = $10, zone = $11, linked_order_type = $12,
                    linked_order_id = $13, linked_order_no = $14, linked_challan_no = $15, linked_transport_name = $16, updated_by = $17, updated_at = NOW()
              WHERE id = $18`,
            [...vals, existing[0].id]
          );
          return 'UPDATED';
        }
        await db.query(
          `INSERT INTO dispatch_entries (entry_date, handover_by, warehouse_pickup, pickup_party_type, pickup_party_name, pickup_party_ref_id,
                  person_taking, phone, parcel_count, source, zone, linked_order_type, linked_order_id, linked_order_no, linked_challan_no,
                  linked_transport_name, created_by, updated_by, bill_no)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$17,$18)`,
          [...vals, r.bill_no]
        );
        return 'CREATED';
      });
      results.push({ bill_no: r.bill_no, status });
    } catch (err) {
      results.push({ bill_no: r.bill_no, status: 'FAILED', error: err.code === '23505' ? 'That order or bill is already in the log' : err.message });
    }
  }
  return results;
}

/* ---------------- Log ---------------- */

export async function listEntries({ search, from, to, page, limit }) {
  const params = [];
  const where = [];
  if (search) {
    params.push(`%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(e.bill_no ILIKE $${params.length} OR e.linked_order_no ILIKE $${params.length} OR e.pickup_party_name ILIKE $${params.length} OR e.person_taking ILIKE $${params.length})`);
  }
  if (from) {
    params.push(from);
    where.push(`e.entry_date >= $${params.length}`);
  }
  if (to) {
    params.push(to);
    where.push(`e.entry_date <= $${params.length}`);
  }
  const { rows } = await query(
    `SELECT e.*, u.name AS created_by_name, COUNT(*) OVER()::int AS total_count
       FROM dispatch_entries e LEFT JOIN users u ON u.id = e.created_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY e.entry_date DESC, e.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params
  );
  return { data: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0 };
}

/** Edit an entry's handover details. Order-linking fields are deliberately not editable here. */
export async function updateEntry(id, b, userId) {
  const n = Number(id);
  if (!Number.isInteger(n)) throw notFound('Entry not found');
  const errs = validateRow({ ...b, bill_no: 'x', linked_order_id: null });
  if (errs.length) throw badRequest(errs.join('; '));
  const { rowCount } = await query(
    `UPDATE dispatch_entries SET entry_date = $1, handover_by = $2, pickup_party_type = $3, pickup_party_name = $4, person_taking = $5,
            phone = $6, parcel_count = $7, updated_by = $8, updated_at = NOW() WHERE id = $9`,
    [b.entry_date, b.handover_by, b.pickup_party_type, b.pickup_party_name, b.person_taking, b.phone, b.parcel_count, userId, n]
  );
  if (!rowCount) throw notFound('Entry not found');
}
