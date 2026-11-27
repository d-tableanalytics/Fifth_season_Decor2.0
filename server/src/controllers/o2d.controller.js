import { query, withTransaction } from '../config/db.js';
import { FIRST_STAGE, PICKING_OR_LATER, ORDER_PERM } from '../config/o2d.js';
import { orderSchema, orderListQuery, reasonSchema } from '../validators/o2d.js';
import { nextCode } from '../services/masterRepo.js';
import { can } from '../services/access.js';
import { HttpError, badRequest, forbidden, notFound } from '../utils/httpError.js';
import { signImageFields } from '../config/s3.js';
import { routeToCrm, notifySkipPaymentOrder } from '../services/crmPayment.js';

const TAB_STATUS = { active: 'ACTIVE', hold: 'ON_HOLD', cancelled: 'CANCELLED' };
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);

const logEvent = (db, orderId, userId, event, { from = null, to = null, reason = null } = {}) =>
  db.query('INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [
    orderId, event, from, to, reason, userId,
  ]);

async function findOrder(type, id, db = { query }) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await db.query('SELECT * FROM o2d_orders WHERE id = $1 AND order_type = $2', [id, type]);
  if (!rows[0]) throw notFound('Order not found');
  return rows[0];
}

async function orderDetail(type, id) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await query(
    `SELECT o.*, c.client_id, c.company_name, c.city AS client_city, c.state AS client_state, c.owner_contact_no AS client_contact,
            u.name AS doer_name
       FROM o2d_orders o JOIN clients c ON c.id = o.client_ref LEFT JOIN users u ON u.id = o.doer_id
      WHERE o.id = $1 AND o.order_type = $2`,
    [id, type]
  );
  if (!rows[0]) throw notFound('Order not found');
  const [{ rows: items }, { rows: events }] = await Promise.all([
    query(
      `SELECT i.id, i.sku_code, i.catalogue_name, i.qty::float AS qty, i.unit, i.remark,
              (SELECT s.image_url FROM inventory_stock s WHERE s.item_key = inv_norm(i.sku_code) AND s.image_url IS NOT NULL LIMIT 1) AS image_url
         FROM o2d_order_items i WHERE i.order_id = $1 ORDER BY i.sort_order`,
      [id]
    ),
    query(
      `SELECT e.event, e.from_stage, e.to_stage, e.reason, e.created_at, u.name AS by_name
         FROM o2d_order_events e LEFT JOIN users u ON u.id = e.created_by WHERE e.order_id = $1 ORDER BY e.id DESC LIMIT 20`,
      [id]
    ),
  ]);
  return { ...rows[0], items: await signImageFields(items, ['image_url']), events };
}

/* ---------------- Duplicate check ---------------- */

/**
 * Compare against OTHER orders of the same type and client (never cancelled ones):
 * EXACT     — same fabric + qty on every line, nothing extra on either side
 * POTENTIAL — at least one line with same fabric + qty, or the same client reference order (PO)
 */
async function findDuplicates(db, type, clientRef, items, poNumber) {
  const { rows } = await db.query(
    `SELECT o.id, o.enquiry_number, o.system_order_no, o.client_reference_order, o.workflow_status, o.created_at,
            json_agg(json_build_object('sku_code', i.sku_code, 'qty', i.qty::float, 'unit', i.unit) ORDER BY i.sort_order) AS items
       FROM o2d_orders o JOIN o2d_order_items i ON i.order_id = o.id
      WHERE o.order_type = $1 AND o.client_ref = $2 AND o.status <> 'CANCELLED'
      GROUP BY o.id`,
    [type, clientRef]
  );
  const key = (i) => `${norm(i.sku_code)}|${Number(i.qty).toFixed(2)}`;
  const mine = items.map(key).sort();
  const mineSet = new Set(mine);
  const po = norm(poNumber);
  const out = [];
  for (const o of rows) {
    const theirs = o.items.map(key).sort();
    const exact = theirs.length === mine.length && theirs.every((k, i) => k === mine[i]);
    const lineMatch = theirs.some((k) => mineSet.has(k));
    const poMatch = po && norm(o.client_reference_order) === po;
    if (exact || lineMatch || poMatch) {
      out.push({
        id: o.id,
        order_no: o.system_order_no || o.enquiry_number,
        client_reference_order: o.client_reference_order,
        workflow_status: o.workflow_status,
        created_at: o.created_at,
        items: o.items,
        match: exact ? 'EXACT' : 'POTENTIAL',
        reason: exact ? 'Same fabrics and quantities' : lineMatch ? 'Same fabric and quantity on at least one line' : 'Same client reference order (PO)',
      });
    }
  }
  return out.sort((a, b) => (a.match === b.match ? 0 : a.match === 'EXACT' ? -1 : 1));
}

/* ---------------- Write helpers ---------------- */

const ORDER_COLS = [
  'order_mode', 'doer_id', 'contact_person_phone', 'client_ref', 'client_reference_order', 'third_party_name', 'third_party_address',
  'priority', 'transport_source', 'transport_ref', 'transport_name', 'mode_of_dispatch', 'transport_contact', 'transport_address',
  'transport_city', 'team_remark', 'customer_remark',
];

async function saveItems(db, orderId, items) {
  await db.query('DELETE FROM o2d_order_items WHERE order_id = $1', [orderId]);
  for (const [i, it] of items.entries()) {
    await db.query(
      'INSERT INTO o2d_order_items (order_id, sku_code, catalogue_name, qty, unit, remark, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [orderId, it.sku_code, it.catalogue_name, it.qty, it.unit, it.remark, i]
    );
  }
}

async function assertRefs(db, body) {
  const { rowCount } = await db.query('SELECT 1 FROM clients WHERE id = $1', [body.client_ref]);
  if (!rowCount) throw badRequest('Selected client no longer exists');
  if (body.transport_ref) {
    const t = await db.query('SELECT 1 FROM transports WHERE id = $1', [body.transport_ref]);
    if (!t.rowCount) throw badRequest('Selected transport no longer exists');
  }
  if (body.doer_id) {
    const u = await db.query('SELECT 1 FROM users WHERE id = $1 AND is_active', [body.doer_id]);
    if (!u.rowCount) throw badRequest('Selected doer is not an active employee');
  }
}

/* ---------------- Handlers (req.orderType = 'CUT' | 'ROLL') ---------------- */

export const listOrders = async (req, res) => {
  const q = orderListQuery.parse(req.query);
  const params = [req.orderType, TAB_STATUS[q.tab]];
  let where = 'o.order_type = $1 AND o.status = $2';
  if (q.search) {
    params.push(`%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where += ` AND (o.enquiry_number ILIKE $3 OR o.system_order_no ILIKE $3 OR o.client_reference_order ILIKE $3
                    OR c.client_id ILIKE $3 OR c.company_name ILIKE $3)`;
  }
  params.push(q.limit, (q.page - 1) * q.limit);
  const [{ rows }, { rows: counts }] = await Promise.all([
    query(
      `SELECT o.id, o.created_at, o.held_at, o.enquiry_number, o.system_order_no, o.order_mode, o.transport_name,
              o.workflow_status, o.held_from, o.hold_reason, o.status, c.client_id, c.company_name,
              COUNT(*) OVER()::int AS total_count
         FROM o2d_orders o JOIN clients c ON c.id = o.client_ref
        WHERE ${where}
        ORDER BY ${q.tab === 'hold' ? 'o.held_at' : 'o.created_at'} DESC NULLS LAST, o.id
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    ),
    // Split-off orders are not counted as separate orders
    query('SELECT status, COUNT(*)::int AS n FROM o2d_orders WHERE order_type = $1 AND split_from IS NULL GROUP BY status', [req.orderType]),
  ]);
  res.json({
    data: rows.map(({ total_count, ...r }) => r),
    total: rows[0]?.total_count ?? 0,
    page: q.page,
    limit: q.limit,
    counts: Object.fromEntries(Object.entries(TAB_STATUS).map(([tab, s]) => [tab, counts.find((c) => c.status === s)?.n || 0])),
  });
};

export const getOrder = async (req, res) => res.json({ data: await orderDetail(req.orderType, req.params.id) });

export const createOrder = async (req, res) => {
  const body = orderSchema.parse(req.body);
  const perm = ORDER_PERM[req.orderType];
  if (body.override_reason && !can(req.user, perm, 'approve')) throw forbidden('Only users with Approve permission can continue past a duplicate warning');

  const { orderId: id, skipped } = await withTransaction(async (db) => {
    await assertRefs(db, body);
    // Serialise check + create per (order type, client) so two submits can't both pass the check
    await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`o2d:${req.orderType}:${body.client_ref}`]);
    const duplicates = await findDuplicates(db, req.orderType, body.client_ref, body.items, body.client_reference_order);
    if (duplicates.length && !body.override_reason) {
      const err = new HttpError(409, 'Possible duplicate order for this client');
      err.details = { code: 'DUPLICATE_ORDER', duplicates, canOverride: can(req.user, perm, 'approve') };
      throw err;
    }

    const enquiry = await nextCode(db, { table: 'o2d_orders', column: 'enquiry_number', prefix: 'Enq_', pad: 3, lockKey: 'seq:o2d_enquiry' });
    const cols = ['order_type', 'enquiry_number', 'workflow_status', ...ORDER_COLS, 'created_by', 'updated_by'];
    const vals = [req.orderType, enquiry, FIRST_STAGE, ...ORDER_COLS.map((k) => body[k] ?? null), req.user.id, req.user.id];
    const { rows } = await db.query(
      `INSERT INTO o2d_orders (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
      vals
    );
    const orderId = rows[0].id;
    await saveItems(db, orderId, body.items);
    await logEvent(db, orderId, req.user.id, 'CREATED', { to: FIRST_STAGE });
    if (duplicates.length) {
      await logEvent(db, orderId, req.user.id, 'DUPLICATE_OVERRIDE', {
        reason: `${body.override_reason} (matched: ${duplicates.map((d) => `${d.order_no} ${d.match}`).join(', ')})`,
      });
    }
    const { skipped } = await routeToCrm(db, orderId, body.client_ref, req.user.id);
    return { orderId, skipped };
  });
  if (skipped) notifySkipPaymentOrder(id, req.user.id);
  res.status(201).json({ data: await orderDetail(req.orderType, id) });
};

export const updateOrder = async (req, res) => {
  const order = await findOrder(req.orderType, req.params.id);
  if (order.status === 'CANCELLED') throw badRequest('Cancelled orders cannot be edited');
  // Items are physically picked from Picking on — editing them would orphan the picks
  if (PICKING_OR_LATER.has(order.workflow_status === 'ON_HOLD' ? order.held_from : order.workflow_status)) {
    throw badRequest('Orders at Picking or later cannot be edited — send it back to Stock Check first');
  }
  // Order mode is locked after creation
  const body = orderSchema.parse({ ...req.body, order_mode: order.order_mode });
  await withTransaction(async (db) => {
    await assertRefs(db, body);
    const sets = ORDER_COLS.map((k, i) => `${k} = $${i + 1}`).join(', ');
    await db.query(`UPDATE o2d_orders SET ${sets}, updated_by = $${ORDER_COLS.length + 1}, updated_at = NOW() WHERE id = $${ORDER_COLS.length + 2}`, [
      ...ORDER_COLS.map((k) => body[k] ?? null), req.user.id, order.id,
    ]);
    await saveItems(db, order.id, body.items);
    await logEvent(db, order.id, req.user.id, 'EDITED');
  });
  res.json({ data: await orderDetail(req.orderType, order.id) });
};

export const cancelOrder = async (req, res) => {
  const order = await findOrder(req.orderType, req.params.id);
  if (order.status === 'CANCELLED') throw badRequest('Order is already cancelled');
  await withTransaction(async (db) => {
    await db.query("UPDATE o2d_orders SET status = 'CANCELLED', cancelled_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2", [req.user.id, order.id]);
    await logEvent(db, order.id, req.user.id, 'CANCELLED', { from: order.workflow_status });
  });
  res.json({ data: await orderDetail(req.orderType, order.id) });
};

export const reactivateOrder = async (req, res) => {
  const order = await findOrder(req.orderType, req.params.id);
  if (order.status !== 'CANCELLED') throw badRequest('Only cancelled orders can be reactivated');
  const { rowCount: hasItems } = await query('SELECT 1 FROM o2d_order_items WHERE order_id = $1 LIMIT 1', [order.id]);
  if (!hasItems) throw badRequest('This order has no items (they were merged into another order) — it cannot be reactivated');
  const { skipped } = await withTransaction(async (db) => {
    await db.query(
      `UPDATE o2d_orders SET status = 'ACTIVE', workflow_status = $1, cancelled_at = NULL, held_from = NULL, held_at = NULL,
              hold_reason = NULL, updated_by = $2, updated_at = NOW() WHERE id = $3`,
      [FIRST_STAGE, req.user.id, order.id]
    );
    await logEvent(db, order.id, req.user.id, 'REACTIVATED', { from: order.workflow_status, to: FIRST_STAGE });
    return routeToCrm(db, order.id, order.client_ref, req.user.id);
  });
  if (skipped) notifySkipPaymentOrder(order.id, req.user.id);
  res.json({ data: await orderDetail(req.orderType, order.id) });
};

/** Put an order on hold from its current stage (used by every O2D stage). */
export const holdOrder = async (req, res) => {
  const { reason } = reasonSchema.parse(req.body);
  const order = await findOrder(req.orderType, req.params.id);
  if (order.status !== 'ACTIVE') throw badRequest('Only active orders can be put on hold');
  await withTransaction(async (db) => {
    await db.query(
      `UPDATE o2d_orders SET status = 'ON_HOLD', workflow_status = 'ON_HOLD', held_from = workflow_status, held_at = NOW(),
              hold_reason = $1, updated_by = $2, updated_at = NOW() WHERE id = $3`,
      [reason, req.user.id, order.id]
    );
    await logEvent(db, order.id, req.user.id, 'HOLD', { from: order.workflow_status, to: 'ON_HOLD', reason });
  });
  res.json({ data: await orderDetail(req.orderType, order.id) });
};

/** Back to the stage it was held from — taken from the last HOLD event, never from the caller. */
export const resumeOrder = async (req, res) => {
  const order = await findOrder(req.orderType, req.params.id);
  if (order.workflow_status !== 'ON_HOLD') throw badRequest('Order is not on hold');
  const { rows } = await query("SELECT from_stage FROM o2d_order_events WHERE order_id = $1 AND event = 'HOLD' ORDER BY id DESC LIMIT 1", [order.id]);
  const stage = rows[0]?.from_stage || FIRST_STAGE;
  await withTransaction(async (db) => {
    await db.query(
      `UPDATE o2d_orders SET status = 'ACTIVE', workflow_status = $1, held_from = NULL, held_at = NULL, hold_reason = NULL,
              updated_by = $2, updated_at = NOW() WHERE id = $3`,
      [stage, req.user.id, order.id]
    );
    await logEvent(db, order.id, req.user.id, 'RESUMED', { from: 'ON_HOLD', to: stage });
  });
  res.json({ data: await orderDetail(req.orderType, order.id) });
};

export const convertToRoll = async (req, res) => {
  if (!can(req.user, 'o2d_roll', 'create')) throw forbidden('Converting needs Create permission on Roll Orders');
  const order = await findOrder('CUT', req.params.id);
  if (order.status === 'CANCELLED') throw badRequest('Cancelled orders cannot be converted');
  const stage = order.workflow_status === 'ON_HOLD' ? order.held_from : order.workflow_status;
  if (PICKING_OR_LATER.has(stage)) throw badRequest('Orders that have reached Picking can no longer be converted');
  await withTransaction(async (db) => {
    await db.query("UPDATE o2d_orders SET order_type = 'ROLL', updated_by = $1, updated_at = NOW() WHERE id = $2", [req.user.id, order.id]);
    await logEvent(db, order.id, req.user.id, 'CONVERTED_TO_ROLL', { from: stage, to: stage });
  });
  res.json({ message: 'Converted to Roll order' });
};

export const deleteOrder = async (req, res) => {
  const order = await findOrder(req.orderType, req.params.id);
  await query('DELETE FROM o2d_orders WHERE id = $1', [order.id]);
  res.json({ message: 'Order deleted' });
};

/** Employees who can create or edit orders of this type (Doer dropdown). */
export const listDoers = async (req, res) => {
  const { rows } = await query(
    `SELECT u.id, u.name, u.employee_code FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.is_active AND (r.is_super OR EXISTS (
        SELECT 1 FROM role_permissions p WHERE p.role_id = r.id AND p.module_key = $1 AND (p.can_create OR p.can_edit)))
      ORDER BY u.name`,
    [ORDER_PERM[req.orderType]]
  );
  res.json({ data: rows });
};

/* ---------------- Lookups for the order form ---------------- */

const like = (s) => `%${String(s || '').trim().slice(0, 80).replace(/[%_\\]/g, (m) => `\\${m}`)}%`;

export const lookupClients = async (req, res) => {
  const search = String(req.query.search || '').trim();
  const { rows } = await query(
    `SELECT id, client_id, company_name, city, state, owner_contact_no FROM clients
      WHERE is_active AND ($1 = '' OR client_id ILIKE $2 OR company_name ILIKE $2)
      ORDER BY (upper(client_id) = upper($1)) DESC, company_name LIMIT 20`,
    [search, like(search)]
  );
  res.json({ data: rows });
};

/** This client's transporters for an order type, ranked by priority. */
export const lookupClientTransports = async (req, res) => {
  if (!isUuid(req.params.id)) throw notFound('Client not found');
  const type = ['CUT', 'ROLL', 'STITCHING', 'FOLDER'].includes(req.query.type) ? req.query.type : 'CUT';
  const { rows } = await query(
    `SELECT p.priority, p.transporter_type, t.id, t.transport_id, t.transport_name, t.transport_contact_number,
            t.transport_full_address, t.transport_address, t.transport_city
       FROM client_transport_priorities p JOIN transports t ON t.id = p.transport_ref
      WHERE p.client_id = $1 AND p.type_of_order = $2 AND t.is_active
      ORDER BY p.priority NULLS LAST, t.transport_name`,
    [req.params.id, type]
  );
  res.json({ data: rows });
};

export const lookupTransports = async (req, res) => {
  const { rows } = await query(
    `SELECT id, transport_id, transport_name, transport_type, transport_contact_number, transport_full_address, transport_address, transport_city
       FROM transports WHERE is_active AND (transport_name ILIKE $1 OR transport_id ILIKE $1)
      ORDER BY transport_name LIMIT 30`,
    [like(req.query.search)]
  );
  res.json({ data: rows });
};

/** SKU codes from inventory stock (one row per item name). Cut orders: Cut Dept items first, Roll items only when no Cut item matches. */
export const lookupSkus = async (req, res) => {
  const find = async (stockType) => {
    const { rows } = await query(
      `SELECT MIN(item_name) AS sku_code, MAX(catalogue_name) AS catalogue_name, MAX(unit) AS unit,
              SUM(quantity)::float AS stock_qty, (array_agg(image_url) FILTER (WHERE image_url IS NOT NULL))[1] AS image_url
         FROM inventory_stock WHERE item_name ILIKE $1 AND ($2::text IS NULL OR stock_type = $2)
        GROUP BY item_key ORDER BY MIN(item_name) LIMIT 25`,
      [like(req.query.search), stockType]
    );
    return rows;
  };
  let rows;
  if (req.query.type === 'CUT') {
    rows = await find('CUT');
    if (!rows.length) rows = await find('ROLL');
  } else rows = await find(null);
  res.json({ data: await signImageFields(rows, ['image_url']) });
};
