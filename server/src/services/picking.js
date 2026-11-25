import { query, withTransaction } from '../config/db.js';
import { STAGES, ORDER_PERM } from '../config/o2d.js';
import { can } from './access.js';
import { nextCode } from './masterRepo.js';
import { nextOrderNo } from './stockCheck.js';
import { HttpError, badRequest, conflict, notFound } from '../utils/httpError.js';

/**
 * O2D Picking. Unit of work = one physical stock piece: the picker ticks pieces until they cover the line.
 * Picking a piece takes the whole piece (overshoot = cutting leftover) and sets its inventory qty to 0;
 * the next inventory sheet sync sets the qty again, but a piece picked for an active order stays locked.
 */
export const PICK_TABS = ['CUT', 'ROLL', 'SMALL', 'IN_CHECKING'];
export const SMALL_QTY_MAX = 5;
const TAB_STOCK_TYPE = { CUT: 'CUT', SMALL: 'CUT', ROLL: 'ROLL', IN_CHECKING: 'IN_CHECKING' };
const AFTER_CUTTING = new Set(STAGES.slice(STAGES.indexOf('CUTTING') + 1));
const NO_MERGE_STAGES = new Set(['DELIVERY_NOTE_GENERATED', 'DISPATCHED']); // Delivery Note exists -> cannot merge

const round2 = (n) => Math.round(n * 100) / 100;
const isUuid = (v) => /^[0-9a-f-]{36}$/i.test(v);
const letter = (i) => (i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + (i % 26))}`);
const orderNoOf = (o) => o.system_order_no || o.enquiry_number;

const logEvent = (db, orderId, userId, event, { from = null, to = null, reason = null, details = null } = {}) =>
  db.query('INSERT INTO o2d_order_events (order_id, event, from_stage, to_stage, reason, details, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [
    orderId, event, from, to, reason, details && JSON.stringify(details), userId,
  ]);

/** Active order of this type at Picking (row-locked inside a transaction when lock = true). */
async function pickingOrder(db, type, id, lock = false) {
  if (!isUuid(id)) throw notFound('Order not found');
  const { rows } = await db.query(
    `SELECT * FROM o2d_orders WHERE id = $1 AND order_type = $2 AND status = 'ACTIVE' AND workflow_status = 'PICKING'${lock ? ' FOR UPDATE' : ''}`,
    [id, type]
  );
  if (!rows[0]) throw notFound('Order is not at Picking');
  return rows[0];
}

/**
 * Lines to pick (dropped items excluded). Item / qty come from Stock Check:
 * the alternative item if one was chosen, and the partial qty when only part is going ahead.
 */
export async function orderLines(db, orderIds) {
  const [{ rows: items }, { rows: picks }, { rows: nf }] = await Promise.all([
    db.query(
      `SELECT i.id, i.order_id, i.sort_order, i.sku_code, i.catalogue_name, i.unit,
              i.cut_qty::float AS cut_qty, i.wastage_qty::float AS wastage_qty, i.cut_lot_no, i.qty::float AS ordered_qty, s.decision, s.source_type,
              COALESCE(s.alt_item, i.sku_code) AS item_name, inv_base(COALESCE(s.alt_item, i.sku_code)) AS base,
              COALESCE(s.final_qty, i.qty)::float AS required
         FROM o2d_order_items i LEFT JOIN o2d_item_stock_checks s ON s.item_id = i.id
        WHERE i.order_id = ANY($1::uuid[]) AND COALESCE(s.decision, '') <> 'DROP'
        ORDER BY i.order_id, i.sort_order`,
      [orderIds]
    ),
    db.query(
      `SELECT p.id, p.order_id, p.item_id, p.stock_id, p.pick_group, p.source, p.item_name, p.rack_no, p.lot_no, p.picked_qty::float AS qty,
              p.unit, p.ioc_marked, p.batch_no, p.picked_at, u.name AS picked_by,
              p.measured_qty::float AS measured_qty, p.cut_qty::float AS cut_qty, p.wastage_qty::float AS wastage_qty, p.cut_lot_no,
              p.ioc_meter::float AS ioc_meter, p.ioc_batch_id,
              (SELECT batch_no FROM ioc_batches WHERE id = p.ioc_batch_id) AS ioc_batch_no
         FROM o2d_picks p LEFT JOIN users u ON u.id = p.picked_by WHERE p.order_id = ANY($1::uuid[]) ORDER BY p.id`,
      [orderIds]
    ),
    db.query(
      `SELECT n.item_id, n.reason, n.batch_no, n.marked_at, u.name AS marked_by
         FROM o2d_pick_not_found n LEFT JOIN users u ON u.id = n.marked_by WHERE n.order_id = ANY($1::uuid[])`,
      [orderIds]
    ),
  ]);
  const byOrder = new Map(orderIds.map((id) => [id, []]));
  for (const it of items) {
    const list = byOrder.get(it.order_id);
    const p = picks.filter((x) => x.item_id === it.id);
    const picked = round2(p.reduce((s, x) => s + x.qty, 0));
    const nfRow = nf.find((x) => x.item_id === it.id) || null;
    const state = nfRow ? 'NOT_FOUND' : picked >= it.required ? 'PICKED' : picked > 0 ? 'PARTIAL' : 'PENDING';
    list.push({ ...it, line: letter(it.sort_order), picks: p, picked, short: round2(Math.max(0, it.required - picked)), state, not_found: nfRow });
  }
  return byOrder;
}

/** Split child (sent ahead) of this order that the remaining items could still be merged into. */
async function mergeSibling(db, orderId) {
  const { rows } = await db.query(
    `SELECT id, system_order_no, enquiry_number, workflow_status FROM o2d_orders
      WHERE split_from = $1 AND status <> 'CANCELLED' ORDER BY created_at DESC LIMIT 1`,
    [orderId]
  );
  const s = rows[0];
  if (!s || NO_MERGE_STAGES.has(s.workflow_status)) return null;
  return { id: s.id, order_no: orderNoOf(s), workflow_status: s.workflow_status };
}

/* ---------------- Queue ---------------- */

export async function pickingQueue(type, { search, page, limit }) {
  const params = [type];
  let where = "o.order_type = $1 AND o.status = 'ACTIVE' AND o.workflow_status = 'PICKING'";
  if (search) {
    params.push(`%${search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where += ` AND (o.enquiry_number ILIKE $2 OR o.system_order_no ILIKE $2 OR c.client_id ILIKE $2 OR c.company_name ILIKE $2)`;
  }
  const [{ rows }, { rows: counts }] = await Promise.all([
    query(
      `SELECT o.id, o.enquiry_number, o.system_order_no, o.transport_name, o.split_from, c.client_id, c.company_name, e.created_at AS entered_at,
              (SELECT COALESCE(ch.system_order_no, ch.enquiry_number) FROM o2d_orders ch WHERE ch.split_from = o.id ORDER BY ch.created_at DESC LIMIT 1) AS split_child,
              (SELECT COALESCE(pa.system_order_no, pa.enquiry_number) FROM o2d_orders pa WHERE pa.id = o.split_from) AS continues,
              COUNT(*) OVER()::int AS total_count
         FROM o2d_orders o JOIN clients c ON c.id = o.client_ref
         LEFT JOIN LATERAL (SELECT created_at FROM o2d_order_events WHERE order_id = o.id AND to_stage = 'PICKING' ORDER BY id DESC LIMIT 1) e ON TRUE
        WHERE ${where}
        ORDER BY e.created_at NULLS LAST, o.id
        LIMIT ${limit} OFFSET ${(page - 1) * limit}`,
      params
    ),
    query(
      `SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE' AND workflow_status = 'PICKING')::int AS in_queue,
              COUNT(*) FILTER (WHERE status = 'ON_HOLD' AND held_from = 'PICKING')::int AS on_hold
         FROM o2d_orders WHERE order_type = $1`,
      [type]
    ),
  ]);
  const lines = rows.length ? await orderLines({ query }, rows.map((r) => r.id)) : new Map();
  const data = rows.map(({ total_count, ...r }) => {
    const ls = lines.get(r.id) || [];
    return {
      ...r,
      items: ls.length,
      required_qty: round2(ls.reduce((s, l) => s + l.required, 0)),
      picked_qty: round2(ls.reduce((s, l) => s + l.picked, 0)),
      lines_picked: ls.filter((l) => l.state === 'PICKED').length,
      not_found: ls.filter((l) => l.state === 'NOT_FOUND').length,
      unsaved: ls.some((l) => l.picks.some((p) => p.batch_no == null)),
    };
  });
  return { data, total: rows[0]?.total_count ?? 0, counts: counts[0] };
}

/* ---------------- Order detail ---------------- */

export async function pickingDetail(type, id) {
  const o = await pickingOrder({ query }, type, id);
  const [{ rows: info }, lines, { rows: batches }, sibling, { rows: entry }, { rows: children }] = await Promise.all([
    query(
      `SELECT c.client_id, c.company_name, c.city, u.name AS doer_name,
              (SELECT COALESCE(pa.system_order_no, pa.enquiry_number) FROM o2d_orders pa WHERE pa.id = $2::uuid) AS continues
         FROM clients c LEFT JOIN users u ON u.id = $3::int WHERE c.id = $1`,
      [o.client_ref, o.split_from, o.doer_id]
    ),
    orderLines({ query }, [o.id]),
    query(
      `SELECT e.details, e.created_at, u.name AS saved_by FROM o2d_order_events e LEFT JOIN users u ON u.id = e.created_by
        WHERE e.order_id = $1 AND e.event = 'PICKING_BATCH' ORDER BY e.id`,
      [o.id]
    ),
    mergeSibling({ query }, o.id),
    query("SELECT event, from_stage FROM o2d_order_events WHERE order_id = $1 AND to_stage = 'PICKING' ORDER BY id DESC LIMIT 1", [o.id]),
    query(`SELECT COALESCE(system_order_no, enquiry_number) AS order_no, workflow_status FROM o2d_orders WHERE split_from = $1 ORDER BY created_at`, [o.id]),
  ]);
  const ls = lines.get(o.id);
  const allPicked = ls.length > 0 && ls.every((l) => l.state === 'PICKED');
  const lastFailed = await query(
    "SELECT reason, created_at FROM o2d_order_events WHERE order_id = $1 AND event IN ('PICKING_AUTO_ADVANCE_FAILED', 'STOCK_PICKED', 'PICKING_BATCH') ORDER BY id DESC LIMIT 1",
    [o.id]
  );
  return {
    id: o.id,
    order_type: o.order_type,
    enquiry_number: o.enquiry_number,
    system_order_no: o.system_order_no,
    order_mode: o.order_mode,
    transport_name: o.transport_name,
    team_remark: o.team_remark,
    customer_remark: o.customer_remark,
    ...info[0],
    lines: ls,
    batches: batches.map((b) => ({ ...b.details, saved_by: b.saved_by, saved_at: b.created_at })),
    split_children: children,
    merge_option: allPicked ? sibling : null,
    sent_back: entry[0]?.from_stage === 'CUTTING',
    auto_advance_failed: lastFailed.rows[0]?.reason && lastFailed.rows[0].reason.startsWith('Automatic move failed') ? lastFailed.rows[0].reason : null,
    can_split: ls.some((l) => l.state === 'PICKED') && ls.some((l) => l.state !== 'PICKED'),
  };
}

/* ---------------- Pieces of one line ---------------- */

async function findLine(db, orderId, itemId) {
  if (!isUuid(itemId)) throw notFound('Item not found');
  const lines = (await orderLines(db, [orderId])).get(orderId);
  const line = lines.find((l) => l.id === itemId);
  if (!line) throw notFound('Item not found on this order (or it was dropped at Stock Check)');
  return line;
}

export async function linePieces(type, orderId, itemId, tab) {
  if (!PICK_TABS.includes(tab)) throw badRequest('Unknown source tab');
  const o = await pickingOrder({ query }, type, orderId);
  const line = await findLine({ query }, o.id, itemId);
  const small = tab === 'SMALL' ? `AND ((s.quantity > 0 AND s.quantity <= ${SMALL_QTY_MAX}) OR mine.pick_group = 'SMALL')` : '';
  const [{ rows }, { rows: inChk }] = await Promise.all([
    query(
      `SELECT s.id, s.stock_type, s.item_name, s.rack_no, s.lot_no, s.quantity::float AS qty, s.unit,
              lk.order_no AS locked_by, mine.id AS pick_id, mine.pick_group, mine.batch_no, mine.picked_qty::float AS picked_qty, mine.ioc_marked
         FROM inventory_stock s
         LEFT JOIN LATERAL (
           SELECT COALESCE(o.system_order_no, o.enquiry_number) AS order_no FROM o2d_picks p JOIN o2d_orders o ON o.id = p.order_id
            WHERE p.stock_id = s.id AND p.item_id <> $3 AND o.status <> 'CANCELLED' LIMIT 1) lk ON TRUE
         LEFT JOIN LATERAL (SELECT p.id, p.pick_group, p.batch_no, p.picked_qty, p.ioc_marked FROM o2d_picks p WHERE p.stock_id = s.id AND p.item_id = $3 LIMIT 1) mine ON TRUE
        WHERE inv_base(s.item_name) = $1 AND s.stock_type = $2 AND (s.quantity > 0 OR mine.id IS NOT NULL) ${small}
        ORDER BY (mine.id IS NULL), s.quantity DESC, s.rack_no`,
      [line.base, TAB_STOCK_TYPE[tab], line.id]
    ),
    query("SELECT COALESCE(SUM(quantity), 0)::float AS qty FROM inventory_stock WHERE inv_base(item_name) = $1 AND stock_type = 'IN_CHECKING'", [line.base]),
  ]);
  return {
    line,
    tab,
    in_checking_qty: inChk[0].qty,
    pieces: rows.map((r) => ({ ...r, picked_here: r.pick_group === tab, picked_other_tab: !!r.pick_id && r.pick_group !== tab })),
  };
}

/* ---------------- Save picks (one tab of one line) ---------------- */

/** Replace this tab's UNSAVED picks with the given pieces. Pieces in a saved batch are never replaced. */
export async function savePicks(db, type, orderId, itemId, { tab, stockIds, iocMarked }, userId) {
  if (!PICK_TABS.includes(tab)) throw badRequest('Source must be CUT, ROLL, SMALL or IN_CHECKING');
  if (iocMarked != null && tab !== 'ROLL') throw badRequest('Mark for IOC applies only to ROLL picks');
  // IOC exists only for Cut orders; Roll orders' roll pieces are stored as explicitly not marked
  const ioc = tab === 'ROLL' ? type === 'CUT' && !!iocMarked : null;
  const o = await pickingOrder(db, type, orderId, true);
  const line = await findLine(db, o.id, itemId);
  const wanted = [...new Set(stockIds)];
  if (wanted.some((x) => !isUuid(x))) throw badRequest('Invalid stock piece');

  const group = line.picks.filter((p) => p.pick_group === tab);
  const inGroup = new Set(group.map((p) => p.stock_id));
  const removed = group.filter((p) => p.batch_no == null && !wanted.includes(p.stock_id));
  const newIds = wanted.filter((x) => !inGroup.has(x));

  // Give back the inventory of unsaved picks that were unticked
  for (const p of removed) {
    if (p.stock_id) await db.query('UPDATE inventory_stock SET quantity = quantity + $1, updated_at = NOW() WHERE id = $2', [p.qty, p.stock_id]);
    await db.query('DELETE FROM o2d_picks WHERE id = $1', [p.id]);
  }

  let added = [];
  if (newIds.length) {
    const already = round2(line.picked - removed.reduce((s, p) => s + p.qty, 0));
    if (already >= line.required) throw badRequest(`Line ${line.line} is already covered (${already} of ${line.required}) — no more pieces needed`);
    const { rows: stock } = await db.query(
      `SELECT id, stock_type, item_name, rack_no, lot_no, quantity::float AS qty, unit, inv_base(item_name) AS base
         FROM inventory_stock WHERE id = ANY($1::uuid[]) FOR UPDATE`,
      [newIds]
    );
    if (stock.length !== newIds.length) throw conflict('Some pieces no longer exist in inventory — refresh and pick again');
    for (const s of stock) {
      if (s.base !== line.base) throw badRequest(`${s.item_name} is not the item of line ${line.line}`);
      if (s.stock_type !== TAB_STOCK_TYPE[tab]) throw badRequest(`${s.item_name} (${s.rack_no || 'no rack'}) is ${s.stock_type} stock — it cannot be picked under the ${tab} tab`);
      if (s.qty <= 0) throw conflict(`${s.item_name} (${s.rack_no || 'no rack'}) has no stock left`);
      if (tab === 'SMALL' && s.qty > SMALL_QTY_MAX) throw badRequest(`Small pieces are ${SMALL_QTY_MAX} or less — ${s.rack_no || 'this piece'} has ${s.qty}`);
      if (line.picks.some((p) => p.stock_id === s.id && p.pick_group !== tab)) {
        throw conflict(`${s.rack_no || s.item_name} is already picked for this item from another source`);
      }
    }
    const { rows: locked } = await db.query(
      `SELECT COALESCE(o.system_order_no, o.enquiry_number) AS order_no, p.rack_no FROM o2d_picks p JOIN o2d_orders o ON o.id = p.order_id
        WHERE p.stock_id = ANY($1::uuid[]) AND p.item_id <> $2 AND o.status <> 'CANCELLED' LIMIT 1`,
      [newIds, line.id]
    );
    if (locked[0]) throw conflict(`Piece ${locked[0].rack_no || ''} is already picked for order ${locked[0].order_no}`);

    const sum = stock.reduce((s, x) => s + x.qty, 0);
    const smallest = Math.min(...stock.map((x) => x.qty));
    if (stock.length > 1 && round2(already + sum - smallest) >= line.required) {
      throw badRequest('Too many pieces — the required qty is covered without the smallest new piece. Untick a piece.');
    }

    // More than one piece for a line = an offcut combination -> SMALL (ROLL / IN_CHECKING stay as they are)
    const pieces = group.length - removed.length + stock.length;
    const source = pieces > 1 && (tab === 'CUT' || tab === 'SMALL') ? 'SMALL' : tab;
    for (const s of stock) {
      await db.query(
        `INSERT INTO o2d_picks (order_id, item_id, stock_id, pick_group, source, item_name, rack_no, lot_no, picked_qty, unit, ioc_marked, picked_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [o.id, line.id, s.id, tab, source, s.item_name, s.rack_no || null, s.lot_no || null, s.qty, s.unit, ioc, userId]
      );
      await db.query('UPDATE inventory_stock SET quantity = 0, updated_at = NOW() WHERE id = $1', [s.id]);
    }
    if (source === 'SMALL') await db.query("UPDATE o2d_picks SET source = 'SMALL' WHERE item_id = $1 AND pick_group = $2 AND batch_no IS NULL", [line.id, tab]);
    added = stock.map((s) => ({ rack_no: s.rack_no, lot_no: s.lot_no, qty: s.qty }));
    await db.query('DELETE FROM o2d_pick_not_found WHERE item_id = $1', [line.id]); // picking anything clears Not Found
  }
  if (tab === 'ROLL') await db.query('UPDATE o2d_picks SET ioc_marked = $1 WHERE item_id = $2 AND pick_group = $3 AND batch_no IS NULL', [ioc, line.id, tab]);

  if (added.length || removed.length) {
    await logEvent(db, o.id, userId, 'STOCK_PICKED', {
      reason: `Line ${line.line} ${line.item_name}: ${added.length} piece(s) picked${removed.length ? `, ${removed.length} unticked` : ''} (${tab})`,
      details: { line: line.line, item: line.item_name, tab, added, removed: removed.map((p) => ({ rack_no: p.rack_no, lot_no: p.lot_no, qty: p.qty })) },
    });
  }
}

/* ---------------- Not Found ---------------- */

export async function markNotFound(db, type, orderId, itemId, reason, userId) {
  const o = await pickingOrder(db, type, orderId, true);
  const line = await findLine(db, o.id, itemId);
  if (line.state === 'PICKED') throw badRequest(`Line ${line.line} is already fully picked`);
  await db.query(
    `INSERT INTO o2d_pick_not_found (item_id, order_id, reason, marked_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (item_id) DO UPDATE SET reason = EXCLUDED.reason, batch_no = NULL, marked_by = EXCLUDED.marked_by, marked_at = NOW()`,
    [line.id, o.id, reason, userId]
  );
  await logEvent(db, o.id, userId, 'NOT_FOUND', { reason: `Line ${line.line} ${line.item_name} not found${reason ? ` — ${reason}` : ''}` });
}

/* ---------------- Batches ---------------- */

/** Snapshot every unsaved pick + new Not Found as the next numbered batch. Returns the batch no. or null when nothing is new. */
async function saveBatch(db, o, userId, remark = null) {
  const ls = (await orderLines(db, [o.id])).get(o.id);
  const picks = ls.flatMap((l) => l.picks.filter((p) => p.batch_no == null).map((p) => ({ ...p, line: l.line })));
  const nf = ls.filter((l) => l.not_found && l.not_found.batch_no == null);
  if (!picks.length && !nf.length) return null;
  const { rows } = await db.query(
    `SELECT GREATEST((SELECT COALESCE(MAX(batch_no), 0) FROM o2d_picks WHERE order_id = $1),
                     (SELECT COALESCE(MAX(batch_no), 0) FROM o2d_pick_not_found WHERE order_id = $1)) + 1 AS n`,
    [o.id]
  );
  const batch = rows[0].n;
  await db.query('UPDATE o2d_picks SET batch_no = $1 WHERE order_id = $2 AND batch_no IS NULL', [batch, o.id]);
  await db.query('UPDATE o2d_pick_not_found SET batch_no = $1 WHERE order_id = $2 AND batch_no IS NULL', [batch, o.id]);
  const total = round2(picks.reduce((s, p) => s + p.qty, 0));
  await logEvent(db, o.id, userId, 'PICKING_BATCH', {
    reason: `Picking batch ${batch}: ${picks.length} piece(s), ${total} picked${nf.length ? `, ${nf.length} not found` : ''}`,
    details: {
      batch,
      remark,
      total,
      picks: picks.map((p) => ({ line: p.line, item: p.item_name, source: p.source, rack_no: p.rack_no, lot_no: p.lot_no, qty: p.qty, ioc: p.ioc_marked })),
      not_found: nf.map((l) => ({ line: l.line, item: l.item_name, reason: l.not_found.reason })),
    },
  });
  return batch;
}

export async function saveProgress(db, type, orderId, remark, userId) {
  const o = await pickingOrder(db, type, orderId, true);
  const batch = await saveBatch(db, o, userId, remark);
  if (!batch) throw badRequest('Nothing new to save — pick a piece or mark an item Not Found first');
  return batch;
}

/* ---------------- Move to Cutting ---------------- */

async function toCutting(db, o, userId, reason) {
  await saveBatch(db, o, userId, null);
  await db.query("UPDATE o2d_orders SET workflow_status = 'CUTTING', updated_by = $1, updated_at = NOW() WHERE id = $2", [userId, o.id]);
  await logEvent(db, o.id, userId, 'TO_CUTTING', { from: 'PICKING', to: 'CUTTING', reason });
}

export async function sendToCutting(db, type, orderId, allowShortPick, userId) {
  const o = await pickingOrder(db, type, orderId, true);
  const ls = (await orderLines(db, [o.id])).get(o.id);
  if (!ls.some((l) => l.picked > 0)) throw badRequest('Nothing has been picked yet');
  const nf = ls.filter((l) => l.state === 'NOT_FOUND');
  if (nf.length) throw badRequest(`Line ${nf.map((l) => l.line).join(', ')} is marked Not Found — pick it or split the order first`);
  const short = ls.filter((l) => l.state !== 'PICKED').map((l) => ({ line: l.line, item: l.item_name, required: l.required, picked: l.picked, short: l.short, unit: l.unit }));
  if (short.length && !allowShortPick) {
    const err = new HttpError(409, 'Some items are short');
    err.details = { code: 'SHORT_PICK', short };
    throw err;
  }
  await toCutting(db, o, userId, short.length ? `Sent with short items: ${short.map((s) => `${s.line} short ${s.short}`).join(', ')}` : 'All items picked');
}

/**
 * Automatic Picking -> Cutting after a save. Only for users who could also do it by hand, only when every line is
 * fully picked, nothing is Not Found, the order didn't come back via Send Back, and no merge choice is waiting.
 * A failure never loses the save: it is logged and the user gets "Retry automatic move".
 */
export async function tryAutoAdvance(type, orderId, user) {
  if (!can(user, 'picking', 'edit') || !can(user, ORDER_PERM[type], 'edit')) return { moved: false };
  try {
    return await withTransaction(async (db) => {
      const { rows } = await db.query('SELECT * FROM o2d_orders WHERE id = $1 AND order_type = $2 FOR UPDATE', [orderId, type]);
      const o = rows[0];
      if (!o || o.status !== 'ACTIVE' || o.workflow_status !== 'PICKING') return { moved: false };
      const ls = (await orderLines(db, [o.id])).get(o.id);
      if (!ls.length || !ls.every((l) => l.state === 'PICKED')) return { moved: false };
      const { rows: entry } = await db.query("SELECT from_stage FROM o2d_order_events WHERE order_id = $1 AND to_stage = 'PICKING' ORDER BY id DESC LIMIT 1", [o.id]);
      if (entry[0]?.from_stage === 'CUTTING') return { moved: false, reason: 'Sent back from Cutting — send it on by hand' };
      if (await mergeSibling(db, o.id)) return { moved: false, reason: 'Choose: send as its own order or merge' };
      await toCutting(db, o, user.id, 'All items picked — moved automatically');
      return { moved: true };
    });
  } catch (err) {
    await logEvent({ query }, orderId, user.id, 'PICKING_AUTO_ADVANCE_FAILED', { reason: `Automatic move failed: ${err.message}` }).catch(() => {});
    return { moved: false, failed: true, error: err.message };
  }
}

/* ---------------- Send Back ---------------- */

export async function sendBack(db, type, orderId, reason, userId) {
  const o = await pickingOrder(db, type, orderId, true);
  await saveBatch(db, o, userId, null);
  await db.query("UPDATE o2d_orders SET workflow_status = 'STOCK_CHECK', updated_by = $1, updated_at = NOW() WHERE id = $2", [userId, o.id]);
  await logEvent(db, o.id, userId, 'SEND_BACK', { from: 'PICKING', to: 'STOCK_CHECK', reason });
}

/* ---------------- Split / Merge ---------------- */

const COPY_COLS = [
  'order_type', 'order_mode', 'doer_id', 'contact_person_phone', 'client_ref', 'client_reference_order', 'third_party_name', 'third_party_address',
  'priority', 'transport_source', 'transport_ref', 'transport_name', 'mode_of_dispatch', 'transport_contact', 'transport_address', 'transport_city',
  'team_remark', 'customer_remark',
];

async function moveItems(db, itemIds, toOrderId) {
  await db.query('UPDATE o2d_order_items SET order_id = $1 WHERE id = ANY($2::uuid[])', [toOrderId, itemIds]);
  await db.query('UPDATE o2d_picks SET order_id = $1 WHERE item_id = ANY($2::uuid[])', [toOrderId, itemIds]);
  await db.query('UPDATE o2d_item_stock_checks SET order_id = $1 WHERE item_id = ANY($2::uuid[])', [toOrderId, itemIds]);
  await db.query('UPDATE o2d_pick_not_found SET order_id = $1 WHERE item_id = ANY($2::uuid[])', [toOrderId, itemIds]);
}

/**
 * "Send Ready Items, Hold the Rest": fully picked lines go to a NEW order (own order no.) straight into Cutting;
 * the original keeps the short lines at Picking. Payment / Stock gates are not re-run (they already passed).
 */
export async function splitOrder(db, type, orderId, userId) {
  const o = await pickingOrder(db, type, orderId, true);
  const ls = (await orderLines(db, [o.id])).get(o.id);
  const ready = ls.filter((l) => l.state === 'PICKED');
  if (!ready.length || ready.length === ls.length) throw badRequest('Split needs at least one fully picked item and at least one short item');
  await saveBatch(db, o, userId, null);

  const enquiry = await nextCode(db, { table: 'o2d_orders', column: 'enquiry_number', prefix: 'Enq_', pad: 3, lockKey: 'seq:o2d_enquiry' });
  const orderNo = await nextOrderNo(db, o.order_mode);
  const cols = [...COPY_COLS, 'enquiry_number', 'system_order_no', 'workflow_status', 'split_from', 'created_by', 'updated_by'];
  const vals = [...COPY_COLS.map((k) => o[k]), enquiry, orderNo, 'CUTTING', o.id, userId, userId];
  const { rows } = await db.query(
    `INSERT INTO o2d_orders (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
    vals
  );
  const childId = rows[0].id;
  await moveItems(db, ready.map((l) => l.id), childId);
  const lines = ready.map((l) => l.line).join(', ');
  await logEvent(db, childId, userId, 'SPLIT_FROM_ORDER', { to: 'CUTTING', reason: `Ready items (${lines}) split from ${orderNoOf(o)}` });
  await logEvent(db, o.id, userId, 'SPLIT', { reason: `Ready items (${lines}) sent ahead as ${orderNo}; the rest stays at Picking` });
  return orderNo;
}

/** Remaining items (now fully picked) move onto the split sibling; the sibling is reopened to Cutting if it moved past it. */
export async function mergeIntoSibling(db, type, orderId, siblingId, userId) {
  const o = await pickingOrder(db, type, orderId, true);
  const ls = (await orderLines(db, [o.id])).get(o.id);
  if (!ls.length || !ls.every((l) => l.state === 'PICKED')) throw badRequest('Every remaining item must be fully picked before merging');
  const { rows } = await db.query(
    "SELECT * FROM o2d_orders WHERE id = $1 AND split_from = $2 AND status <> 'CANCELLED' FOR UPDATE",
    [siblingId, o.id]
  );
  const s = rows[0];
  if (!s) throw notFound('Split order not found');
  // Checked again under the lock: a Delivery Note may have been made meanwhile
  if (NO_MERGE_STAGES.has(s.workflow_status)) throw conflict(`${orderNoOf(s)} already has a Delivery Note — send this as its own order`);
  await saveBatch(db, o, userId, null);
  const { rows: maxSort } = await db.query('SELECT COALESCE(MAX(sort_order), -1) AS n FROM o2d_order_items WHERE order_id = $1', [s.id]);
  await db.query(
    'UPDATE o2d_order_items SET sort_order = sort_order + $1 WHERE id = ANY($2::uuid[])',
    [Number(maxSort[0].n) + 1, ls.map((l) => l.id)]
  );
  await moveItems(db, ls.map((l) => l.id), s.id);
  if (AFTER_CUTTING.has(s.workflow_status === 'ON_HOLD' ? s.held_from : s.workflow_status)) {
    await db.query("UPDATE o2d_orders SET workflow_status = 'CUTTING', updated_by = $1, updated_at = NOW() WHERE id = $2 AND status = 'ACTIVE'", [userId, s.id]);
    await logEvent(db, s.id, userId, 'MERGE_REOPENED', { from: s.workflow_status, to: 'CUTTING', reason: `Items from ${orderNoOf(o)} merged in — reopened to Cutting` });
  }
  await logEvent(db, s.id, userId, 'MERGED_IN', { reason: `${ls.length} item(s) merged in from ${orderNoOf(o)}` });
  await db.query(
    "UPDATE o2d_orders SET status = 'CANCELLED', cancelled_at = NOW(), updated_by = $1, updated_at = NOW() WHERE id = $2",
    [userId, o.id]
  );
  await logEvent(db, o.id, userId, 'MERGED_INTO', { from: 'PICKING', reason: `All items merged into ${orderNoOf(s)}` });
  return orderNoOf(s);
}

/* ---------------- Print (Picking Order Details / Bulk Summary) ---------------- */

export async function printData(type, ids) {
  const valid = ids.filter(isUuid).slice(0, 100);
  if (!valid.length) throw badRequest('Select at least one order');
  const { rows: orders } = await query(
    `SELECT o.id, o.enquiry_number, o.system_order_no, o.transport_name, o.team_remark, o.customer_remark, c.client_id, c.company_name, c.city
       FROM o2d_orders o JOIN clients c ON c.id = o.client_ref
      WHERE o.id = ANY($1::uuid[]) AND o.order_type = $2 AND o.status = 'ACTIVE' AND o.workflow_status = 'PICKING'
      ORDER BY array_position($1::uuid[], o.id)`,
    [valid, type]
  );
  if (!orders.length) throw notFound('None of the selected orders are at Picking');
  const lines = await orderLines({ query }, orders.map((o) => o.id));
  const bases = [...new Set([...lines.values()].flat().map((l) => l.base))];
  const { rows: stock } = await query(
    `SELECT inv_base(s.item_name) AS base, s.stock_type, s.rack_no, s.lot_no, s.quantity::float AS qty
       FROM inventory_stock s
      WHERE inv_base(s.item_name) = ANY($1::text[]) AND s.quantity > 0
        AND NOT EXISTS (SELECT 1 FROM o2d_picks p JOIN o2d_orders o ON o.id = p.order_id WHERE p.stock_id = s.id AND o.status <> 'CANCELLED')
      ORDER BY s.stock_type, s.quantity DESC`,
    [bases]
  );
  return orders.map((o) => ({
    ...o,
    lines: lines.get(o.id).map((l) => ({
      ...l,
      locations: stock.filter((s) => s.base === l.base).slice(0, 12).map(({ base, ...s }) => s),
    })),
  }));
}
