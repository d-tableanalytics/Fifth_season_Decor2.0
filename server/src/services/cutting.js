import { query } from '../config/db.js';
import { STAGES } from '../config/o2d.js';
import { orderLines } from './picking.js';
import { HttpError, badRequest, conflict, notFound } from '../utils/httpError.js';

/**
 * O2D Cutting. Each picked piece (lot) gets its Cut Qty, Wastage and Lot No; Roll lots marked for IOC need an IOC Meter.
 * When every item is fully cut the order moves CUTTING -> CUTTING_COMPLETED -> DELIVERY_NOTE in the same save
 * (no manual step), and gets its permanent Delivery Note number on the first entry.
 */
const round2 = (n) => Math.round(n * 100) / 100;
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);
const AFTER_CUTTING = new Set(STAGES.slice(STAGES.indexOf('CUTTING') + 1));

const logEvent = (db, orderId, userId, event, { from = null, to = null, reason = null, details = null } = {}) =>
  db.query('INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason, details, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    orderId, event, from, to, reason, details && JSON.stringify(details), userId,
  ]);

async function cuttingOrder(db, type, id, lock = false) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await db.query(`SELECT * FROM o2d_orders WHERE id = $1 AND order_type = $2${lock ? ' FOR UPDATE' : ''}`, [id, type]);
  const o = rows[0];
  if (!o) throw notFound('Order not found');
  if (o.status !== 'ACTIVE' || o.workflow_status !== 'CUTTING') throw conflict('Order is not at Cutting');
  return o;
}

/** A lot = one picked piece. Picked qty shown/used at Cutting is the corrected (measured) one when set. */
const toLot = (p, iocAllowed) => {
  const picked = p.measured_qty ?? p.qty;
  return {
    id: p.id,
    source: p.source,
    item_name: p.item_name,
    rack_no: p.rack_no,
    lot_no: p.cut_lot_no ?? p.lot_no ?? '',
    original_picked: p.qty,
    picked,
    cut_qty: p.cut_qty ?? 0,
    wastage_qty: p.wastage_qty ?? 0,
    remaining: round2(picked - (p.cut_qty ?? 0) - (p.wastage_qty ?? 0)),
    ioc_required: iocAllowed && p.source === 'ROLL' && p.ioc_marked !== false, // no IOC on Roll orders
    ioc_meter: p.ioc_meter,
    ioc_batch_no: p.ioc_batch_no,
  };
};

/** Lines with their lots and cut progress. Target = qty to cut (from Stock Check; no Direct Packing yet). */
export async function cutLines(db, orderIds) {
  const [lines, { rows: types }] = await Promise.all([
    orderLines(db, orderIds),
    db.query('SELECT id, order_type FROM o2d_orders WHERE id = ANY($1::uuid[])', [orderIds]),
  ]);
  const isCut = new Map(types.map((t) => [t.id, t.order_type === 'CUT']));
  const out = new Map();
  for (const [id, ls] of lines) {
    out.set(
      id,
      ls.map((l) => {
        const lots = l.picks.map((p) => toLot(p, isCut.get(id)));
        const cut = lots.length ? round2(lots.reduce((s, x) => s + x.cut_qty, 0)) : l.cut_qty ?? 0;
        const wastage = lots.length ? round2(lots.reduce((s, x) => s + x.wastage_qty, 0)) : l.wastage_qty ?? 0;
        return {
          id: l.id,
          line: l.line,
          item_name: l.item_name,
          sku_code: l.sku_code,
          unit: l.unit,
          target: l.required,
          ordered: l.ordered_qty,
          lots,
          cut_qty: cut,
          wastage_qty: wastage,
          lot_no: lots.length ? [...new Set(lots.map((x) => x.lot_no).filter(Boolean))].join(', ') : l.cut_lot_no || '',
          remaining: round2(Math.max(0, l.required - cut)),
        };
      })
    );
  }
  return out;
}

/* ---------------- Queue ---------------- */

export async function cuttingQueue(type, { search, page, limit }) {
  const params = [type];
  let where = "o.order_type = $1 AND o.status = 'ACTIVE' AND o.workflow_status IN ('CUTTING', 'CUTTING_COMPLETED')";
  if (search) {
    params.push(`%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where += ` AND (o.enquiry_number ILIKE $2 OR o.system_order_no ILIKE $2 OR c.client_id ILIKE $2 OR c.company_name ILIKE $2)`;
  }
  const { rows } = await query(
    `SELECT o.id, o.enquiry_number, o.system_order_no, o.workflow_status, o.team_remark, o.customer_remark, c.client_id, c.company_name,
            e.created_at AS entered_at, e.from_stage AS entered_from, COUNT(*) OVER()::int AS total_count
       FROM o2d_orders o JOIN clients c ON c.id = o.client_ref
       LEFT JOIN LATERAL (SELECT created_at, from_stage FROM o2d_order_events WHERE order_id = o.id AND to_stage = 'CUTTING' ORDER BY id DESC LIMIT 1) e ON TRUE
      WHERE ${where}
      ORDER BY e.created_at NULLS LAST, o.id
      LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
    params
  );
  const lines = rows.length ? await cutLines({ query }, rows.map((r) => r.id)) : new Map();
  return {
    data: rows.map(({ total_count, team_remark, customer_remark, ...r }) => {
      const ls = lines.get(r.id) || [];
      return {
        ...r,
        sent_back: AFTER_CUTTING.has(r.entered_from),
        has_remarks: !!(team_remark || customer_remark),
        items: ls.length,
        total_qty: round2(ls.reduce((s, l) => s + l.target, 0)),
        cut_qty: round2(ls.reduce((s, l) => s + Math.min(l.cut_qty, l.target), 0)),
        lot_nos: [...new Set(ls.flatMap((l) => l.lot_no.split(', ')).filter(Boolean))].join(', '),
      };
    }),
    total: rows[0]?.total_count ?? 0,
  };
}

/* ---------------- Detail ---------------- */

export async function cuttingDetail(type, id) {
  const o = await cuttingOrder({ query }, type, id);
  const [{ rows: info }, lines, { rows: fabric }] = await Promise.all([
    query('SELECT client_id, company_name, city FROM clients WHERE id = $1', [o.client_ref]),
    cutLines({ query }, [o.id]),
    // Order-independent godown snapshot, for the cutter's sanity check
    query('SELECT stock_type, COALESCE(SUM(quantity), 0)::float AS qty FROM inventory_stock GROUP BY stock_type'),
  ]);
  return {
    id: o.id,
    enquiry_number: o.enquiry_number,
    system_order_no: o.system_order_no,
    transport_name: o.transport_name,
    team_remark: o.team_remark,
    customer_remark: o.customer_remark,
    ioc_number: o.ioc_number || '',
    ...info[0],
    lines: lines.get(o.id),
    available_fabric: Object.fromEntries(fabric.map((f) => [f.stock_type, round2(f.qty)])),
  };
}

/* ---------------- Save Cut Details ---------------- */

/** Today's (IST) shared IOC batch, created on first use: numbered 1001, 1002 … */
async function todaysIocBatch(db) {
  await db.query("SELECT pg_advisory_xact_lock(hashtext('seq:ioc_batch'))");
  const { rows } = await db.query("SELECT id, batch_no FROM ioc_batches WHERE batch_date = (NOW() AT TIME ZONE 'Asia/Kolkata')::date");
  if (rows[0]) return rows[0];
  const { rows: made } = await db.query(
    `INSERT INTO ioc_batches (batch_no, batch_date)
     VALUES ((SELECT GREATEST(COALESCE(MAX(batch_no), 1000), 1000) + 1 FROM ioc_batches), (NOW() AT TIME ZONE 'Asia/Kolkata')::date)
     RETURNING id, batch_no`
  );
  return made[0];
}

/** FSD/<n>/<FY> — FY April–March in IST; one series shared by Cut and Roll orders. */
async function nextDeliveryNoteNo(db) {
  const { rows } = await db.query("SELECT (NOW() AT TIME ZONE 'Asia/Kolkata')::date AS d");
  const d = new Date(rows[0].d);
  const y = d.getMonth() >= 3 ? d.getFullYear() : d.getFullYear() - 1;
  const fy = `${y}-${String((y + 1) % 100).padStart(2, '0')}`;
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`seq:delivery_note:${fy}`]);
  const { rows: n } = await db.query(
    `SELECT COALESCE(MAX(split_part(delivery_note_no, '/', 2)::int), 0) AS n FROM o2d_orders
      WHERE delivery_note_no LIKE 'FSD/%/' || $1 AND split_part(delivery_note_no, '/', 2) ~ '^[0-9]+$'`,
    [fy]
  );
  return `FSD/${Number(n[0].n) + 1}/${fy}`;
}

/**
 * body: { ioc_number, items: [{ item_id, cut_qty, wastage_qty, lot_no, lots: [{ pick_id, picked_qty, cut_qty, wastage_qty, lot_no, ioc_meter }] }] }
 * Items with picks are saved lot-wise; items without picks use the item-level fields.
 */
export async function saveCutDetails(db, type, orderId, body, userId) {
  const o = await cuttingOrder(db, type, orderId, true);
  const lines = (await cutLines(db, [o.id])).get(o.id);
  const byItem = new Map(lines.map((l) => [l.id, l]));
  const corrections = [];
  const errors = [];

  // Apply the payload onto the current state, validating as we go
  for (const it of body.items) {
    const line = byItem.get(it.item_id);
    if (!line) throw badRequest('An item does not belong to this order');
    if (line.lots.length) {
      for (const lp of it.lots || []) {
        const lot = line.lots.find((x) => x.id === lp.pick_id);
        if (!lot) throw badRequest(`A lot does not belong to line ${line.line}`);
        const where = `Line ${line.line} · ${lot.rack_no || 'lot'}`;
        if (!(lp.picked_qty > 0)) errors.push(`${where}: Picked Qty must be more than 0`);
        if (round2(lp.cut_qty + lp.wastage_qty) > round2(lp.picked_qty)) errors.push(`${where}: Cut + Wastage (${round2(lp.cut_qty + lp.wastage_qty)}) is more than Picked Qty (${lp.picked_qty})`);
        if (round2(lp.picked_qty) !== round2(lot.picked)) corrections.push({ line: line.line, rack_no: lot.rack_no, lot_no: lot.lot_no, from: lot.picked, to: round2(lp.picked_qty) });
        Object.assign(lot, { picked: round2(lp.picked_qty), cut_qty: round2(lp.cut_qty), wastage_qty: round2(lp.wastage_qty), lot_no: lp.lot_no ?? lot.lot_no, ioc_meter: o.order_type === 'CUT' ? lp.ioc_meter ?? null : null, touched: true });
      }
      line.cut_qty = round2(line.lots.reduce((s, x) => s + x.cut_qty, 0));
      line.wastage_qty = round2(line.lots.reduce((s, x) => s + x.wastage_qty, 0));
    } else {
      Object.assign(line, { cut_qty: round2(it.cut_qty ?? 0), wastage_qty: round2(it.wastage_qty ?? 0), lot_no: it.lot_no ?? line.lot_no, touched: true });
    }
    if (line.cut_qty > line.target) errors.push(`Line ${line.line}: Cut Qty ${line.cut_qty} is more than the ${line.target} to cut`);
  }
  // Final sweep over the whole order: every IOC-required Roll lot needs an IOC Meter
  const noMeter = lines.flatMap((l) => l.lots.filter((x) => x.ioc_required && !(x.ioc_meter > 0)).map((x) => `${l.line} · ${x.rack_no || x.lot_no || 'Roll lot'}`));
  if (noMeter.length) errors.push(`IOC Meter is required for Roll lot(s): ${noMeter.join(', ')}`);
  if (errors.length) {
    const err = new HttpError(400, errors[0]);
    err.details = { errors };
    throw err;
  }

  let batch = null;
  for (const l of lines) {
    for (const lot of l.lots.filter((x) => x.touched)) {
      const { rows } = await db.query('SELECT ioc_batch_id FROM o2d_picks WHERE id = $1', [lot.id]);
      let batchId = rows[0].ioc_batch_id;
      if (lot.ioc_meter > 0 && !batchId) batchId = (batch ||= await todaysIocBatch(db)).id; // stamped once, never re-stamped
      await db.query(
        `UPDATE o2d_picks SET measured_qty = $1, cut_qty = $2, wastage_qty = $3, cut_lot_no = $4, ioc_meter = $5, ioc_batch_id = $6 WHERE id = $7`,
        [lot.picked, lot.cut_qty, lot.wastage_qty, lot.lot_no || null, lot.ioc_meter > 0 ? lot.ioc_meter : null, batchId, lot.id]
      );
    }
    if (l.touched) {
      const lotNo = l.lots.length ? [...new Set(l.lots.map((x) => x.lot_no).filter(Boolean))].join(', ') : l.lot_no;
      await db.query('UPDATE o2d_order_items SET cut_qty = $1, wastage_qty = $2, cut_lot_no = $3 WHERE id = $4', [l.cut_qty, l.wastage_qty, lotNo || null, l.id]);
    }
  }
  await db.query('UPDATE o2d_orders SET ioc_number = $1, updated_by = $2, updated_at = NOW() WHERE id = $3', [o.order_type === 'CUT' ? body.ioc_number || null : null, userId, o.id]);
  if (corrections.length) {
    await logEvent(db, o.id, userId, 'PICKED_QTY_CORRECTED', {
      reason: corrections.map((c) => `${c.line} ${c.rack_no || ''}: ${c.from} → ${c.to}`).join('; '),
      details: { corrections },
    });
  }
  const remaining = lines.filter((l) => round2(l.target - l.cut_qty) > 0);
  const touched = lines.filter((l) => l.touched);
  await logEvent(db, o.id, userId, 'CUT_SAVED', {
    reason: `${touched.map((l) => `${l.line} ${l.item_name}: cut ${l.cut_qty}, wastage ${l.wastage_qty}`).join('; ') || 'No changes'} — ${remaining.length ? `${remaining.length} item(s) still to cut` : 'all items cut'}`,
    details: { items: touched.map((l) => ({ item_id: l.id, line: l.line, cut_qty: l.cut_qty, wastage_qty: l.wastage_qty })) },
  });

  if (remaining.length) return { completed: false };
  // Fully cut: CUTTING -> CUTTING_COMPLETED -> DELIVERY_NOTE (system passthrough, same transaction)
  await logEvent(db, o.id, userId, 'CUTTING_COMPLETED', { from: 'CUTTING', to: 'CUTTING_COMPLETED', reason: 'Every item cut' });
  const dn = o.delivery_note_no || (await nextDeliveryNoteNo(db));
  await db.query("UPDATE o2d_orders SET workflow_status = 'DELIVERY_NOTE', delivery_note_no = $1, updated_by = $2, updated_at = NOW() WHERE id = $3", [dn, userId, o.id]);
  await logEvent(db, o.id, userId, 'TO_DELIVERY_NOTE', { from: 'CUTTING_COMPLETED', to: 'DELIVERY_NOTE', reason: `Automatic · ${dn}` });
  return { completed: true, delivery_note_no: dn };
}

export async function sendBackToPicking(db, type, orderId, reason, userId) {
  const o = await cuttingOrder(db, type, orderId, true);
  await db.query("UPDATE o2d_orders SET workflow_status = 'PICKING', updated_by = $1, updated_at = NOW() WHERE id = $2", [userId, o.id]);
  await logEvent(db, o.id, userId, 'SEND_BACK', { from: 'CUTTING', to: 'PICKING', reason });
}

/* ---------------- IOC batches (global: Cut and Roll orders) ---------------- */

export async function iocBatches() {
  const { rows } = await query(
    `SELECT b.batch_no, b.batch_date, COUNT(DISTINCT p.order_id)::int AS orders, COALESCE(SUM(p.ioc_meter), 0)::float AS total_meter, COUNT(p.id)::int AS lots
       FROM ioc_batches b LEFT JOIN o2d_picks p ON p.ioc_batch_id = b.id
      GROUP BY b.id ORDER BY b.batch_date DESC LIMIT 120`
  );
  return rows;
}

export async function iocBatchDetail(batchNo) {
  const n = Number(batchNo);
  if (!Number.isInteger(n)) throw notFound('IOC batch not found');
  const { rows: b } = await query('SELECT id, batch_no, batch_date FROM ioc_batches WHERE batch_no = $1', [n]);
  if (!b[0]) throw notFound('IOC batch not found');
  const { rows } = await query(
    `SELECT COALESCE(o.system_order_no, o.enquiry_number) AS order_no, o.order_type, c.client_id, c.company_name,
            p.item_name, p.rack_no, COALESCE(p.cut_lot_no, p.lot_no) AS lot_no, COALESCE(p.measured_qty, p.picked_qty)::float AS picked,
            p.ioc_meter::float AS ioc_meter, p.cut_qty::float AS cut_qty
       FROM o2d_picks p JOIN o2d_orders o ON o.id = p.order_id JOIN clients c ON c.id = o.client_ref
      WHERE p.ioc_batch_id = $1 ORDER BY order_no, p.id`,
    [b[0].id]
  );
  return { ...b[0], rows };
}
