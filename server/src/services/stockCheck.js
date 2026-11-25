import crypto from 'node:crypto';
import { ORDER_NO_PREFIX } from '../config/o2d.js';
import { nextCode } from './masterRepo.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { pendingBills, billsTotal } from './crmPayment.js';

export const DEPTS = ['CUT', 'ROLL', 'IN_CHECKING'];
export const DECISIONS = ['AVAILABLE', 'PARTIAL', 'ALT_COLOR', 'ALT_FABRIC', 'ALT_WIDTH', 'DROP'];
export const ALT_DECISIONS = new Set(['ALT_COLOR', 'ALT_FABRIC', 'ALT_WIDTH']);

const round2 = (n) => Math.round(n * 100) / 100;
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);

/** Department an order line was picked from, by its name ("CUT …" / "… IN CHECKING" / plain = Roll). */
export const skuDept = (sku) => (/^\s*CUT\s/i.test(sku) ? 'CUT' : /\sIN\s+CHECKING\s*$/i.test(sku) ? 'IN_CHECKING' : 'ROLL');

/** Rate of a department: Cut items use the Cut rate, Roll / In Checking use the Roll rate (In Checking has none). */
export const rateFor = (rates, dept) => (dept === 'CUT' ? rates.CUT ?? rates.ROLL : rates.ROLL ?? rates.CUT) ?? null;

/** { base: { CUT: {qty, rate}, ROLL: …, IN_CHECKING: … } } for many fabric base names at once. */
async function stockByBase(db, bases) {
  const { rows } = await db.query(
    `SELECT inv_base(item_name) AS base, stock_type, SUM(quantity)::float AS qty, MAX(price)::float AS rate
       FROM inventory_stock WHERE inv_base(item_name) = ANY($1::text[]) GROUP BY 1, 2`,
    [bases]
  );
  const out = {};
  for (const r of rows) (out[r.base] ||= {})[r.stock_type] = { qty: round2(r.qty), rate: r.rate };
  return out;
}
const ratesOf = (stock = {}) => Object.fromEntries(DEPTS.map((d) => [d, stock[d]?.rate ?? null]));

/** Active order at Stock Check (row-locked inside a transaction when lock = true). */
export async function stockOrder(db, id, lock = false) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await db.query(
    `SELECT * FROM o2d_orders WHERE id = $1 AND status = 'ACTIVE' AND workflow_status = 'STOCK_CHECK'${lock ? ' FOR UPDATE' : ''}`,
    [id]
  );
  if (!rows[0]) throw notFound('Order is not at Stock Check');
  return rows[0];
}

/** Everything the Stock Check screen shows: client credit, items with rate / qty / amount, grand total. */
export async function stockDetail(db, id) {
  const o = await stockOrder(db, id);
  const [{ rows: clients }, { rows: items }, bills] = await Promise.all([
    db.query(
      `SELECT id, client_id, company_name, city, state, credit_limit::float AS credit_limit, credit_days, payment_mode,
              skip_payment_check, owner_name, owner_contact_no
         FROM clients WHERE id = $1`,
      [o.client_ref]
    ),
    db.query(
      `SELECT i.id, i.sku_code, i.catalogue_name, i.qty::float AS qty, i.unit, i.remark, inv_base(i.sku_code) AS base,
              s.decision, s.source_type, s.available_qty::float AS available_qty, s.rate::float AS checked_rate, s.panels,
              s.panel_length::float AS panel_length, s.final_qty::float AS final_qty, s.note, s.alt_item, s.checked_at, u.name AS checked_by
         FROM o2d_order_items i LEFT JOIN o2d_item_stock_checks s ON s.item_id = i.id LEFT JOIN users u ON u.id = s.checked_by
        WHERE i.order_id = $1 ORDER BY i.sort_order`,
      [o.id]
    ),
    pendingBills(db, o.client_ref),
  ]);
  const stock = await stockByBase(db, [...new Set(items.map((i) => i.base))]);
  let grand = 0;
  let unpriced = 0;
  const lines = items.map(({ base, checked_rate, ...i }) => {
    const s = stock[base] || {};
    const rate = i.decision ? checked_rate : rateFor(ratesOf(s), skuDept(i.sku_code));
    const qtyOut = i.decision ? i.final_qty : i.qty;
    const amount = rate == null ? null : round2(rate * qtyOut);
    if (amount == null) unpriced += qtyOut > 0 ? 1 : 0;
    else grand += amount;
    return { ...i, dept: skuDept(i.sku_code), stock: Object.fromEntries(DEPTS.map((d) => [d, s[d]?.qty ?? 0])), rate, qty_out: qtyOut, amount };
  });
  const outstanding = billsTotal(bills);
  const grandTotal = round2(grand);
  const creditLimit = clients[0].credit_limit;
  const [{ rows: pf }, { rows: adv }] = await Promise.all([
    db.query(
      `SELECT p.proforma_no, p.share_token, p.total::float AS total, p.is_cash, p.generated_at, p.shared_at, u.name AS generated_by
         FROM o2d_proformas p LEFT JOIN users u ON u.id = p.generated_by WHERE p.order_id = $1`,
      [o.id]
    ),
    db.query(
      `SELECT a.amount::float AS amount, a.reference, a.remark, a.received_at, u.name AS received_by
         FROM o2d_advance_payments a LEFT JOIN users u ON u.id = a.received_by WHERE a.order_id = $1`,
      [o.id]
    ),
  ]);
  const lastChecked = lines.reduce((m, l) => (l.checked_at && (!m || l.checked_at > m) ? l.checked_at : m), null);
  const proforma = pf[0] ? { ...pf[0], stale: !!lastChecked && lastChecked > pf[0].generated_at } : null;
  return {
    id: o.id,
    order_type: o.order_type,
    enquiry_number: o.enquiry_number,
    order_mode: o.order_mode,
    created_at: o.created_at,
    transport_name: o.transport_name,
    team_remark: o.team_remark,
    customer_remark: o.customer_remark,
    client: { ...clients[0], outstanding, overdue_bills: bills.filter((b) => b.days_overdue > 0).length },
    items: lines,
    grand_total: grandTotal,
    unpriced_lines: unpriced,
    checked: lines.filter((l) => l.decision).length,
    cash: { is_cash: isCashOrder(creditLimit, grandTotal), threshold: creditLimit == null ? null : round2(creditLimit * (1 + CASH_MARGIN)) },
    proforma,
    advance: adv[0] || null,
  };
}

/** Cash customer = this order's total is above credit limit + 10% (no credit limit set = not decided -> not cash). */
export const CASH_MARGIN = 0.1;
export const isCashOrder = (creditLimit, total) => creditLimit != null && total > round2(creditLimit * (1 + CASH_MARGIN));

/** Create / refresh the order's Proforma Invoice from the stock-check result (number and link stay the same). */
export async function generateProforma(db, orderId, userId) {
  await stockOrder(db, orderId, true);
  const d = await stockDetail(db, orderId);
  const pending = d.items.length - d.checked;
  if (pending) throw badRequest(`${pending} item(s) are not stock-checked yet — check every item before the Proforma Invoice`);
  const lines = d.items
    .filter((i) => i.qty_out > 0)
    .map((i) => ({ item: i.alt_item || i.sku_code, catalogue: i.catalogue_name, qty: i.qty_out, unit: i.unit, rate: i.rate, amount: i.amount }));
  if (!lines.length) throw badRequest('Every item is dropped — nothing to invoice');
  const { rows } = await db.query('SELECT proforma_no FROM o2d_proformas WHERE order_id = $1', [orderId]);
  if (rows[0]) {
    await db.query(
      `UPDATE o2d_proformas SET lines = $1, total = $2, credit_limit = $3, is_cash = $4, generated_by = $5, generated_at = NOW() WHERE order_id = $6`,
      [JSON.stringify(lines), d.grand_total, d.client.credit_limit, d.cash.is_cash, userId, orderId]
    );
  } else {
    const no = await nextCode(db, { table: 'o2d_proformas', column: 'proforma_no', prefix: 'PI_', lockKey: 'seq:o2d_proforma' });
    await db.query(
      `INSERT INTO o2d_proformas (order_id, proforma_no, share_token, lines, total, credit_limit, is_cash, generated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [orderId, no, crypto.randomBytes(24).toString('base64url'), JSON.stringify(lines), d.grand_total, d.client.credit_limit, d.cash.is_cash, userId]
    );
  }
}

/** Cash customer: CRM records the advance before the order can go to Picking. */
export async function recordAdvance(db, orderId, body, userId) {
  await stockOrder(db, orderId, true);
  const d = await stockDetail(db, orderId);
  if (!d.cash.is_cash) throw badRequest('Advance is needed only for cash customers (order total above credit limit + 10%)');
  await db.query(
    `INSERT INTO o2d_advance_payments (order_id, amount, reference, remark, received_by) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (order_id) DO UPDATE SET amount = EXCLUDED.amount, reference = EXCLUDED.reference, remark = EXCLUDED.remark,
       received_by = EXCLUDED.received_by, received_at = NOW()`,
    [orderId, body.amount, body.reference, body.remark, userId]
  );
  await logEvent(db, orderId, userId, 'ADVANCE_RECEIVED', 'STOCK_CHECK', 'STOCK_CHECK', `Advance ₹${body.amount.toLocaleString('en-IN')} · ${body.reference}`);
}

/** Rack / lot-wise stock of one order line in every department. */
export async function itemAvailability(db, orderId, itemId) {
  await stockOrder(db, orderId);
  if (!isUuid(itemId)) throw notFound('Item not found');
  const { rows: items } = await db.query('SELECT sku_code, qty::float AS qty, unit FROM o2d_order_items WHERE id = $1 AND order_id = $2', [itemId, orderId]);
  if (!items[0]) throw notFound('Item not found');
  const { rows } = await db.query(
    `SELECT stock_type, item_name, rack_no, lot_no, quantity::float AS qty, unit, price::float AS rate
       FROM inventory_stock WHERE inv_base(item_name) = inv_base($1) AND quantity > 0
      ORDER BY stock_type, quantity DESC, rack_no`,
    [items[0].sku_code]
  );
  const depts = Object.fromEntries(DEPTS.map((d) => [d, { qty: 0, rate: null, rows: [] }]));
  for (const r of rows) {
    const d = depts[r.stock_type];
    d.qty = round2(d.qty + r.qty);
    d.rate = d.rate ?? r.rate;
    d.rows.push({ item_name: r.item_name, rack_no: r.rack_no || null, lot_no: r.lot_no || null, qty: r.qty, unit: r.unit });
  }
  const rates = Object.fromEntries(DEPTS.map((d) => [d, depts[d].rate]));
  for (const d of DEPTS) depts[d].rate = rateFor(rates, d);
  return { item: items[0], dept: skuDept(items[0].sku_code), depts, alternatives: await alternativesFor(db, items[0].sku_code) };
}

/** Alternatives from the sheet for an order line, each with its stock and rate per department. */
async function alternativesFor(db, sku) {
  const { rows } = await db.query(
    'SELECT alt_type, alt_name, alt_base FROM item_alternatives WHERE item_base = inv_base($1) ORDER BY alt_type, row_no',
    [sku]
  );
  const stock = rows.length ? await stockByBase(db, [...new Set(rows.map((r) => r.alt_base))]) : {};
  const out = {};
  for (const r of rows) {
    const st = stock[r.alt_base] || {};
    const rates = ratesOf(st);
    (out[r.alt_type] ||= []).push({
      alt_name: r.alt_name,
      depts: Object.fromEntries(DEPTS.map((d) => [d, { qty: st[d]?.qty ?? 0, rate: rateFor(rates, d) }])),
    });
  }
  return out;
}

/** Save CRM's decision for one line. Validates against live stock of the chosen department. */
export async function saveItemDecision(db, orderId, itemId, body, userId) {
  await stockOrder(db, orderId, true);
  if (!isUuid(itemId)) throw notFound('Item not found');
  const { rows: items } = await db.query(
    'SELECT id, sku_code, qty::float AS qty, inv_base(sku_code) AS base FROM o2d_order_items WHERE id = $1 AND order_id = $2',
    [itemId, orderId]
  );
  const item = items[0];
  if (!item) throw notFound('Item not found');
  const { decision } = body;
  // An alternative from the sheet replaces the item for stock and rate
  let altItem = null;
  let base = item.base;
  if (ALT_DECISIONS.has(decision) && body.alt_item) {
    const { rows: alts } = await db.query(
      'SELECT alt_name, alt_base FROM item_alternatives WHERE alt_type = $1 AND item_base = $2 AND alt_base = inv_base($3)',
      [decision.slice(4), item.base, body.alt_item]
    );
    if (!alts[0]) throw badRequest('This alternative is not in the alternatives list for the item — sync the sheet or write it in the note');
    altItem = alts[0].alt_name;
    base = alts[0].alt_base;
  }
  const stock = (await stockByBase(db, [base]))[base] || {};
  const rates = ratesOf(stock);
  const source = decision === 'DROP' ? null : body.source_type || null;
  const available = source ? stock[source]?.qty ?? 0 : null;
  const deptLabel = { CUT: 'Cut dept', ROLL: 'Roll dept', IN_CHECKING: 'In Checking' }[source];
  let finalQty = item.qty;
  let panels = null;
  let panelLength = null;

  if (decision === 'AVAILABLE' || decision === 'PARTIAL') {
    if (!source) throw badRequest('Choose the department the stock comes from');
  }
  if (decision === 'AVAILABLE' && available < item.qty) {
    throw badRequest(`Only ${available} available in ${deptLabel} — required ${item.qty}. Choose Partially or an alternative.`);
  }
  if (decision === 'PARTIAL') {
    if (!body.panels || !body.panel_length) throw badRequest('Enter No. of Panels and Length');
    panels = body.panels;
    panelLength = body.panel_length;
    finalQty = round2(panels * panelLength);
    if (finalQty > available) throw badRequest(`${panels} × ${panelLength} = ${finalQty} is more than the ${available} available in ${deptLabel}`);
    if (finalQty >= item.qty) throw badRequest(`${finalQty} covers the full requirement (${item.qty}) — choose Available instead`);
  }
  if (ALT_DECISIONS.has(decision) && !altItem && !body.note) throw badRequest('Choose an alternative item or write it in the note');
  if (decision === 'DROP') finalQty = 0;

  const rate = decision === 'DROP' ? null : rateFor(rates, source || skuDept(item.sku_code));
  await db.query(
    `INSERT INTO o2d_item_stock_checks (item_id, order_id, decision, source_type, available_qty, rate, panels, panel_length, final_qty, note, checked_by, alt_item, checked_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
     ON CONFLICT (item_id) DO UPDATE SET decision = EXCLUDED.decision, source_type = EXCLUDED.source_type, available_qty = EXCLUDED.available_qty,
       rate = EXCLUDED.rate, panels = EXCLUDED.panels, panel_length = EXCLUDED.panel_length, final_qty = EXCLUDED.final_qty,
       note = EXCLUDED.note, checked_by = EXCLUDED.checked_by, alt_item = EXCLUDED.alt_item, checked_at = NOW()`,
    [item.id, orderId, decision, source, available, rate, panels, panelLength, finalQty, body.note || null, userId, altItem]
  );
}

const logEvent = (db, orderId, userId, event, from, to, reason) =>
  db.query('INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6)', [
    orderId, event, from, to, reason, userId,
  ]);

/** Hold the entire order from Stock Check (Resume brings it back here). */
export async function holdFromStockCheck(db, orderId, reason, userId) {
  const o = await stockOrder(db, orderId, true);
  await db.query(
    `UPDATE o2d_orders SET status = 'ON_HOLD', workflow_status = 'ON_HOLD', held_from = 'STOCK_CHECK', held_at = NOW(),
            hold_reason = $1, updated_by = $2, updated_at = NOW() WHERE id = $3`,
    [reason, userId, o.id]
  );
  await logEvent(db, o.id, userId, 'HOLD', 'STOCK_CHECK', 'ON_HOLD', reason);
}

/** Next real order number for an order mode: B_0001 / OC-A-0001 / TP-B-0001 (own series per prefix). */
export async function nextOrderNo(db, mode) {
  const prefix = ORDER_NO_PREFIX[mode];
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`seq:o2d_order_no:${prefix}`]);
  const { rows: n } = await db.query(
    `SELECT COALESCE(MAX(substring(system_order_no FROM $2::int)::bigint), 0) AS n FROM o2d_orders WHERE starts_with(system_order_no, $1::text)
        AND substring(system_order_no FROM $2::int) ~ '^[0-9]+$'`,
    [prefix, prefix.length + 1]
  );
  return `${prefix}${String(Number(n[0].n) + 1).padStart(4, '0')}`;
}

const DECISION_LABEL = { AVAILABLE: 'available', PARTIAL: 'partial', ALT_COLOR: 'alt. color', ALT_FABRIC: 'alt. fabric', ALT_WIDTH: 'alt. width', DROP: 'dropped' };

/** All lines decided -> Picking; the real order no. is assigned the first time an order reaches Picking. */
export async function completeStockCheck(db, orderId, userId) {
  const o = await stockOrder(db, orderId, true);
  const { rows } = await db.query(
    `SELECT s.decision FROM o2d_order_items i LEFT JOIN o2d_item_stock_checks s ON s.item_id = i.id WHERE i.order_id = $1`,
    [o.id]
  );
  const pending = rows.filter((r) => !r.decision).length;
  if (pending) throw badRequest(`${pending} item(s) are not stock-checked yet`);
  if (rows.every((r) => r.decision === 'DROP')) throw badRequest('Every item is dropped — hold or cancel the order instead');
  const d = await stockDetail(db, o.id);
  if (!d.proforma) throw badRequest('Generate the Proforma Invoice first');
  if (d.proforma.stale) throw badRequest('Items changed after the Proforma Invoice was made — regenerate it first');
  if (d.cash.is_cash && !d.advance) throw badRequest('Cash customer — record the advance payment before Picking');

  const orderNo = o.system_order_no || (await nextOrderNo(db, o.order_mode));
  const counts = {};
  for (const r of rows) counts[r.decision] = (counts[r.decision] || 0) + 1;
  const summary = Object.entries(counts).map(([d, n]) => `${n} ${DECISION_LABEL[d]}`).join(', ');
  const trackingToken = o.tracking_token || crypto.randomBytes(24).toString('base64url');
  await db.query(
    `UPDATE o2d_orders SET workflow_status = 'PICKING', system_order_no = $1, tracking_token = $2, updated_by = $3, updated_at = NOW()
      WHERE id = $4`,
    [orderNo, trackingToken, userId, o.id]
  );
  await logEvent(db, o.id, userId, 'TO_PICKING', 'STOCK_CHECK', 'PICKING', `Stock check done: ${summary}${d.cash.is_cash ? ' · cash customer, advance received' : ''}`);
  return { orderNo, trackingToken, newTracking: !o.tracking_token, clientRef: o.client_ref, companyName: d.client.company_name };
}
