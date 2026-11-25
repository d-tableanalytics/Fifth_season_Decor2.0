/**
 * Client ↔ Transport priority helpers (used by Excel import, sheet sync and the client form).
 * A priority row: { client_id (uuid), type_of_order, priority, transporter_type, transport_code }
 */

const PRIORITY_ORDER = 'ABCDE';
const TYPE_ORDER = ['CUT', 'ROLL', 'STITCHING', 'FOLDER'];

const baseKey = (p) => [p.client_id, p.type_of_order, p.priority, p.transporter_type].join('|');
const fullKey = (p) => `${baseKey(p)}|${p.transport_code || ''}`;

/**
 * Remove exact duplicates, and drop rows without a transport when the same
 * client/type/priority/transporter-type already has a transport assigned.
 */
export function dedupePriorities(rows) {
  const withTransport = new Set(rows.filter((p) => p.transport_code).map(baseKey));
  const seen = new Set();
  const out = [];
  for (const p of rows) {
    if (!p.transport_code && withTransport.has(baseKey(p))) continue;
    if (!p.type_of_order && !p.priority && !p.transporter_type && !p.transport_code) continue; // empty row
    const k = fullKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

export const sortPriorities = (rows) =>
  [...rows].sort(
    (a, b) =>
      (TYPE_ORDER.indexOf(a.type_of_order) + 1 || 9) - (TYPE_ORDER.indexOf(b.type_of_order) + 1 || 9) ||
      (PRIORITY_ORDER.indexOf(a.priority) + 1 || 9) - (PRIORITY_ORDER.indexOf(b.priority) + 1 || 9)
  );

/**
 * Bulk insert priorities; transport_ref is resolved from transport_code in SQL.
 * Existing identical rows are left alone (ON CONFLICT DO NOTHING). Returns inserted count.
 */
export async function insertPriorities(db, rows, source) {
  if (!rows.length) return 0;
  const sorted = sortPriorities(rows);
  let inserted = 0;
  for (let i = 0; i < sorted.length; i += 2000) {
    const chunk = sorted.slice(i, i + 2000);
    const { rowCount } = await db.query(
      `INSERT INTO client_transport_priorities (client_id, type_of_order, priority, transporter_type, transport_code, transport_ref, source, sort_order)
       SELECT t.client_id, t.type_of_order, t.priority, t.transporter_type, t.transport_code, tr.id, $6, t.ord
         FROM unnest($1::uuid[], $2::text[], $3::text[], $4::text[], $5::text[]) WITH ORDINALITY
              AS t(client_id, type_of_order, priority, transporter_type, transport_code, ord)
         LEFT JOIN transports tr ON tr.transport_id = t.transport_code
       ON CONFLICT DO NOTHING`,
      [
        chunk.map((p) => p.client_id),
        chunk.map((p) => p.type_of_order),
        chunk.map((p) => p.priority),
        chunk.map((p) => p.transporter_type),
        chunk.map((p) => p.transport_code),
        source,
      ]
    );
    inserted += rowCount;
  }
  return inserted;
}

/** Link priorities whose TRN code now exists in Transport Master. */
export async function relinkPriorities(db) {
  const { rowCount } = await db.query(
    `UPDATE client_transport_priorities p SET transport_ref = t.id
       FROM transports t
      WHERE p.transport_ref IS NULL AND p.transport_code = t.transport_id`
  );
  return rowCount;
}
