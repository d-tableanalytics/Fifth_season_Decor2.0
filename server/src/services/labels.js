import { query } from '../config/db.js';
import { STAGES } from '../config/o2d.js';
import { orderLines } from './picking.js';
import { badRequest } from '../utils/httpError.js';

/**
 * Label print stages. Each stage lists the ERP fields a label can bind to ({{key}}) and loads them
 * from that stage's records — nothing on a label is hardcoded.
 * Records: CUT_ITEM / LEFTOVER = one picked order line; PACKING = one order. Orders from Picking onwards.
 */
const COMMON = [
  { key: 'company_name', label: 'Company name' },
  { key: 'print_date', label: 'Print date' },
  { key: 'print_time', label: 'Print time' },
  { key: 'printed_by', label: 'Printed by' },
];
const ORDER = [
  { key: 'order_no', label: 'Order no.' },
  { key: 'enquiry_no', label: 'Enquiry no.' },
  { key: 'order_type', label: 'Order type' },
  { key: 'order_date', label: 'Order date' },
  { key: 'client_id', label: 'Client ID' },
  { key: 'client_name', label: 'Client name' },
  { key: 'client_city', label: 'Client city' },
  { key: 'transport_name', label: 'Transport' },
  { key: 'customer_remark', label: 'Customer remark' },
];
const SHIP_TO = [
  { key: 'client_address', label: 'Client address' },
  { key: 'client_state', label: 'Client state' },
  { key: 'client_pin', label: 'Client PIN' },
  { key: 'client_phone', label: 'Client phone' },
  { key: 'client_gstin', label: 'Client GSTIN' },
  { key: 'transport_city', label: 'Transport city' },
  { key: 'transport_contact', label: 'Transport contact' },
  { key: 'transport_address', label: 'Transport address' },
  { key: 'mode_of_dispatch', label: 'Mode of dispatch' },
];
const LINE = [
  { key: 'line', label: 'Line (A, B…)' },
  { key: 'item_name', label: 'Item name' },
  { key: 'ordered_item', label: 'Ordered item (before alternative)' },
  { key: 'catalogue', label: 'Catalogue' },
  { key: 'unit', label: 'Unit' },
  { key: 'racks', label: 'Picked rack(s)' },
  { key: 'lots', label: 'Picked lot(s)' },
  { key: 'sources', label: 'Picked from (Cut / Roll / Small / In Checking)' },
];

export const LABEL_STAGES = [
  {
    key: 'CUT_ITEM',
    label: 'Cut Item',
    description: 'One label per cut order item',
    fields: [...ORDER, ...LINE, { key: 'cut_qty', label: 'Cut qty' }, { key: 'picked_qty', label: 'Picked qty' }, { key: 'wastage_qty', label: 'Wastage qty' }, { key: 'ioc_number', label: 'IOC number' }, ...COMMON],
  },
  {
    key: 'LEFTOVER',
    label: 'Leftover Fabric',
    description: 'One label per item where more was picked than cut',
    fields: [...ORDER, ...LINE, { key: 'leftover_qty', label: 'Leftover qty (picked − cut − wastage)' }, { key: 'cut_qty', label: 'Cut qty' }, { key: 'picked_qty', label: 'Picked qty' }, { key: 'wastage_qty', label: 'Wastage qty' }, ...COMMON],
  },
  {
    key: 'PACKING',
    label: 'Packing',
    description: 'One label per order (parcel)',
    fields: [
      ...ORDER,
      ...SHIP_TO,
      { key: 'items_count', label: 'No. of items' },
      { key: 'total_qty', label: 'Total qty' },
      { key: 'items_list', label: 'Items list' },
      ...COMMON,
    ],
  },
  {
    key: 'PARCEL',
    label: 'Parcel (Packet Label)',
    description: 'One sticker per packed parcel',
    fields: [
      ...ORDER,
      ...SHIP_TO,
      { key: 'delivery_note_no', label: 'Delivery Note no.' },
      { key: 'parcel_no', label: 'Parcel no.' },
      { key: 'parcel_of', label: 'Parcel x of y' },
      { key: 'parcel_ref', label: 'Parcel QR ref (PKT-…)' },
      { key: 'parcel_items', label: 'Items in parcel' },
      { key: 'parcel_qty', label: 'Parcel total qty' },
      { key: 'parcel_pcs', label: 'Parcel pcs' },
      { key: 'parcel_remarks', label: 'Parcel remarks' },
      { key: 'challan_no', label: 'Dispatch challan no.' },
      { key: 'tot_parcels', label: 'Total parcels (challan)' },
      { key: 'packed_by', label: 'Packed by' },
      { key: 'packed_at', label: 'Packed on' },
      ...COMMON,
    ],
  },
];
export const STAGE_KEYS = LABEL_STAGES.map((s) => s.key);

const FROM_PICKING = STAGES.slice(STAGES.indexOf('PICKING'));
const ORDER_WHERE = `o.status <> 'CANCELLED' AND (o.workflow_status = ANY($1::text[]) OR (o.workflow_status = 'ON_HOLD' AND o.held_from = ANY($1::text[])))`;
const fmtQty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '');
const uniq = (a) => [...new Set(a.filter(Boolean))].join(', ');

const orderFields = (o) => ({
  order_no: o.system_order_no || o.enquiry_number,
  enquiry_no: o.enquiry_number,
  order_type: o.order_type === 'CUT' ? 'Cut' : 'Roll',
  order_date: day(o.created_at),
  client_id: o.client_id,
  client_name: o.company_name,
  client_city: o.city || '',
  transport_name: o.transport_name || '',
  customer_remark: o.customer_remark || '',
});

const shipTo = (o) => ({
  client_address: o.full_address || '',
  client_state: o.state || '',
  client_pin: o.pin || '',
  client_phone: o.owner_contact_no || '',
  client_gstin: o.gstin || '',
  transport_city: o.transport_city || '',
  transport_contact: o.transport_contact || '',
  transport_address: o.transport_address || '',
  mode_of_dispatch: o.mode_of_dispatch || '',
});

const ORDER_SQL = `SELECT o.id, o.order_type, o.ioc_number, o.delivery_note_no, o.enquiry_number, o.system_order_no, o.created_at, o.transport_name, o.transport_city,
       o.transport_contact, o.transport_address, o.mode_of_dispatch, o.customer_remark,
       c.client_id, c.company_name, c.city, c.state, c.pin, c.full_address, c.owner_contact_no, c.gstin
  FROM o2d_orders o JOIN clients c ON c.id = o.client_ref`;

/** Records a label can be printed for (search for preview / printing). */
export async function stageRecords(stage, search = '') {
  if (!STAGE_KEYS.includes(stage)) throw badRequest('Unknown label stage');
  const like = `%${String(search).trim().slice(0, 80).replace(/[%_\\]/g, (m) => `\\${m}`)}%`;
  const s = `(o.enquiry_number ILIKE $2 OR o.system_order_no ILIKE $2 OR c.client_id ILIKE $2 OR c.company_name ILIKE $2)`;
  if (stage === 'PARCEL') {
    const { rows } = await query(
      `SELECT p.id, p.qr_ref, p.parcel_no, c.client_id, c.company_name FROM o2d_parcels p JOIN o2d_orders o ON o.id = p.order_id JOIN clients c ON c.id = o.client_ref
        WHERE ${ORDER_WHERE} AND (${s} OR p.qr_ref ILIKE $2) ORDER BY p.packed_at DESC LIMIT 40`,
      [FROM_PICKING, like]
    );
    return rows.map((p) => ({ id: p.id, title: p.qr_ref, subtitle: `${p.client_id} · ${p.company_name}` }));
  }
  if (stage === 'PACKING') {
    const { rows } = await query(`${ORDER_SQL} WHERE ${ORDER_WHERE} AND ${s} ORDER BY o.updated_at DESC LIMIT 40`, [FROM_PICKING, like]);
    return rows.map((o) => ({ id: o.id, title: o.system_order_no || o.enquiry_number, subtitle: `${o.client_id} · ${o.company_name}` }));
  }
  const { rows } = await query(
    `SELECT o.id FROM o2d_orders o JOIN clients c ON c.id = o.client_ref
      WHERE ${ORDER_WHERE} AND EXISTS (SELECT 1 FROM o2d_picks p WHERE p.order_id = o.id)
        AND (${s} OR EXISTS (SELECT 1 FROM o2d_order_items i WHERE i.order_id = o.id AND i.sku_code ILIKE $2))
      ORDER BY o.updated_at DESC LIMIT 20`,
    [FROM_PICKING, like]
  );
  const data = await lineRecords(rows.map((r) => r.id));
  return data
    .filter((r) => (stage === 'LEFTOVER' ? r.leftover > 0 : r.picked > 0))
    .map((r) => ({ id: r.id, title: `${r.fields.order_no} · ${r.fields.line} · ${r.fields.item_name}`, subtitle: `${r.fields.client_name} · ${stage === 'LEFTOVER' ? `leftover ${r.fields.leftover_qty}` : `cut ${r.fields.cut_qty}`} ${r.fields.unit}` }));
}

/** Order lines (with picks) of the given orders, flattened to label fields. */
async function lineRecords(orderIds, itemIds = null) {
  if (!orderIds.length) return [];
  const [{ rows: orders }, lines] = await Promise.all([query(`${ORDER_SQL} WHERE o.id = ANY($1::uuid[])`, [orderIds]), orderLines({ query }, orderIds)]);
  const out = [];
  for (const o of orders) {
    for (const l of lines.get(o.id) || []) {
      if (itemIds && !itemIds.includes(l.id)) continue;
      // Cut results once Cutting has saved them; before that, the planned qty
      const cutDone = l.picks.some((p) => p.cut_qty != null) || l.cut_qty != null;
      const picked = l.picks.reduce((s, p) => s + (p.measured_qty ?? p.qty), 0);
      const cut = cutDone ? (l.picks.length ? l.picks.reduce((s, p) => s + (p.cut_qty ?? 0), 0) : l.cut_qty ?? 0) : l.required;
      const wastage = l.picks.length ? l.picks.reduce((s, p) => s + (p.wastage_qty ?? 0), 0) : l.wastage_qty ?? 0;
      const leftover = Math.max(0, Math.round((picked - cut - wastage) * 100) / 100);
      out.push({
        id: l.id,
        picked: l.picked,
        leftover,
        fields: {
          ...orderFields(o),
          line: l.line,
          item_name: l.item_name,
          ordered_item: l.sku_code,
          catalogue: l.catalogue_name || '',
          unit: l.unit,
          racks: uniq(l.picks.map((p) => p.rack_no)),
          lots: uniq(l.picks.map((p) => p.cut_lot_no ?? p.lot_no)),
          sources: uniq(l.picks.map((p) => p.source)),
          cut_qty: fmtQty(cut),
          picked_qty: fmtQty(picked),
          wastage_qty: fmtQty(wastage),
          leftover_qty: fmtQty(leftover),
          ioc_number: o.ioc_number || '',
        },
      });
    }
  }
  return out;
}

/** Field values for the given records of a stage, in the order asked. */
export async function stageData(stage, ids, user) {
  if (!STAGE_KEYS.includes(stage)) throw badRequest('Unknown label stage');
  const valid = ids.filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 500);
  if (!valid.length) throw badRequest('Select at least one record');
  const now = new Date();
  const common = {
    company_name: 'Fifth Seasons Decor',
    print_date: now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }),
    print_time: now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
    printed_by: user.name || '',
  };
  let records;
  if (stage === 'PARCEL') {
    const { rows } = await query(
      `SELECT p.id, p.order_id, p.parcel_no, p.qr_ref, p.remarks, p.packed_at, u.name AS packed_by,
              (SELECT COUNT(*)::int FROM o2d_parcels x WHERE x.order_id = p.order_id) AS parcel_count,
              (SELECT challan_no FROM dispatch_challans dc WHERE dc.order_id = p.order_id) AS challan_no,
              (SELECT tot_parcels FROM dispatch_challans dc WHERE dc.order_id = p.order_id) AS tot_parcels,
              json_agg(json_build_object('item_id', pi.item_id, 'qty', pi.qty::float, 'pcs', pi.pcs) ORDER BY pi.id) AS items
         FROM o2d_parcels p LEFT JOIN users u ON u.id = p.packed_by JOIN o2d_parcel_items pi ON pi.parcel_id = p.id
        WHERE p.id = ANY($1::uuid[]) GROUP BY p.id, u.name`,
      [valid]
    );
    const orderIds = [...new Set(rows.map((p) => p.order_id))];
    const [{ rows: orders }, lines] = await Promise.all([query(`${ORDER_SQL} WHERE o.id = ANY($1::uuid[])`, [orderIds]), orderLines({ query }, orderIds)]);
    records = rows.map((p) => {
      const o = orders.find((x) => x.id === p.order_id);
      const ls = lines.get(p.order_id) || [];
      const items = p.items.map((it) => ({ ...it, line: ls.find((l) => l.id === it.item_id) }));
      return {
        id: p.id,
        fields: {
          ...orderFields(o),
          ...shipTo(o),
          delivery_note_no: o.delivery_note_no || '',
          parcel_no: String(p.parcel_no),
          parcel_of: `${p.parcel_no}/${p.parcel_count}`,
          parcel_ref: p.qr_ref,
          parcel_items: items.map((it) => `${it.line?.item_name || ''} — ${fmtQty(it.qty)} ${it.line?.unit || ''} (${it.pcs} pcs)`).join('\n'),
          parcel_qty: fmtQty(items.reduce((sum, it) => sum + it.qty, 0)),
          parcel_pcs: String(items.reduce((sum, it) => sum + it.pcs, 0)),
          parcel_remarks: p.remarks || '',
          challan_no: p.challan_no || '',
          tot_parcels: p.tot_parcels ? String(p.tot_parcels) : String(p.parcel_count),
          packed_by: p.packed_by || '',
          packed_at: day(p.packed_at),
        },
      };
    });
  } else if (stage === 'PACKING') {
    const { rows } = await query(`${ORDER_SQL} WHERE o.id = ANY($1::uuid[])`, [valid]);
    const lines = await orderLines({ query }, rows.map((o) => o.id));
    records = rows.map((o) => {
      const ls = (lines.get(o.id) || []).filter((l) => l.required > 0);
      return {
        id: o.id,
        fields: {
          ...orderFields(o),
          ...shipTo(o),
          items_count: String(ls.length),
          total_qty: fmtQty(ls.reduce((s, l) => s + l.required, 0)),
          items_list: ls.map((l) => `${l.item_name} — ${fmtQty(l.required)} ${l.unit}`).join('\n'),
        },
      };
    });
  } else {
    const { rows } = await query('SELECT DISTINCT order_id FROM o2d_order_items WHERE id = ANY($1::uuid[])', [valid]);
    records = await lineRecords(rows.map((r) => r.order_id), valid);
  }
  const byId = new Map(records.map((r) => [r.id, r]));
  return valid.filter((id) => byId.has(id)).map((id) => ({ id, fields: { ...byId.get(id).fields, ...common } }));
}
