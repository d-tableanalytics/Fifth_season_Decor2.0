/** Generic SQL helpers driven by the field lists in config/masterFields.js */

const isJson = (fd) => fd.type === 'multi' || fd.type === 'json';
const param = (fd, v) => (isJson(fd) ? JSON.stringify(v ?? []) : v ?? null);
const cast = (fd, i) => (isJson(fd) ? `$${i}::jsonb` : `$${i}`);

/** SELECT list: numeric columns as float so the API returns numbers, not strings. */
export const selectList = (fields, alias = '') =>
  [
    `${alias}id`,
    ...fields.map((fd) => (fd.type === 'num' ? `${alias}${fd.key}::float AS ${fd.key}` : `${alias}${fd.key}`)),
    `${alias}source`,
    `${alias}created_at`,
    `${alias}updated_at`,
  ].join(', ');

/** INSERT for the given record (only keys present in rec). Returns id. */
export async function insertRecord(db, table, fields, rec, extra = {}) {
  const used = fields.filter((fd) => rec[fd.key] !== undefined);
  const cols = [...used.map((fd) => fd.key), ...Object.keys(extra)];
  const vals = [...used.map((fd) => param(fd, rec[fd.key])), ...Object.values(extra)];
  const ph = [...used.map((fd, i) => cast(fd, i + 1)), ...Object.keys(extra).map((_, i) => `$${used.length + i + 1}`)];
  const { rows } = await db.query(`INSERT INTO ${table} (${cols.join(', ')}) VALUES (${ph.join(', ')}) RETURNING id`, vals);
  return rows[0].id;
}

/** UPDATE the given record by id (only keys present in rec). */
export async function updateRecord(db, table, fields, id, rec, extra = {}) {
  const used = fields.filter((fd) => rec[fd.key] !== undefined);
  const sets = [...used.map((fd, i) => `${fd.key} = ${cast(fd, i + 1)}`), ...Object.keys(extra).map((k, i) => `${k} = $${used.length + i + 1}`)];
  const vals = [...used.map((fd) => param(fd, rec[fd.key])), ...Object.values(extra)];
  if (!sets.length) return;
  vals.push(id);
  await db.query(`UPDATE ${table} SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${vals.length}`, vals);
}

/**
 * Next code like TRN-0219 / CL3790 / V_2696 — call inside a transaction.
 * An advisory lock per sequence keeps concurrent creates from colliding.
 */
export async function nextCode(db, { table, column, prefix, pad = 4, lockKey }) {
  await db.query('SELECT pg_advisory_xact_lock(hashtext($1))', [lockKey]);
  const { rows } = await db.query(
    `SELECT COALESCE(MAX(NULLIF(regexp_replace(${column}, '\\D', '', 'g'), '')::bigint), 0) AS n FROM ${table}`
  );
  return `${prefix}${String(Number(rows[0].n) + 1).padStart(pad, '0')}`;
}

export const nextTransportId = (db) => nextCode(db, { table: 'transports', column: 'transport_id', prefix: 'TRN-', lockKey: 'seq:transport_id' });
export const nextClientId = (db) => nextCode(db, { table: 'clients', column: 'client_id', prefix: 'CL', pad: 1, lockKey: 'seq:client_id' });
export const nextVisitNo = (db) => nextCode(db, { table: 'clients', column: 'visit_no', prefix: 'V_', lockKey: 'seq:visit_no' });
