import { query, withTransaction } from '../config/db.js';
import { TRANSPORT_FIELDS, IMAGE_FIELDS } from '../config/masterFields.js';
import { GOOGLE_SHEET_ID, MASTER_TABS } from '../config/sheets.js';
import { transportSchema, listQuery } from '../validators/masters.js';
import { selectList, insertRecord, updateRecord, nextTransportId } from '../services/masterRepo.js';
import { syncTransports, syncLogs } from '../services/masterSync.js';
import { signImageFields, deleteRefQuietly, isS3Ref } from '../config/s3.js';
import { can } from '../services/access.js';
import { conflict, forbidden, notFound } from '../utils/httpError.js';
import { z } from 'zod';

const COLS = selectList(TRANSPORT_FIELDS, 't.');
const SORTS = { transport_id: 't.transport_id', transport_name: 't.transport_name', transport_city: 't.transport_city', clients: 'client_count', updated_at: 't.updated_at' };

const transportListQuery = listQuery.extend({
  transport_type: z.string().trim().max(30).optional(),
  state: z.string().trim().max(80).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  sort: z.enum(Object.keys(SORTS)).default('transport_id'),
});

const findTransport = async (id) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Transport not found');
  const { rows } = await query(
    `SELECT ${COLS}, (SELECT COUNT(DISTINCT p.client_id)::int FROM client_transport_priorities p WHERE p.transport_ref = t.id) AS client_count
       FROM transports t WHERE t.id = $1`,
    [id]
  );
  if (!rows[0]) throw notFound('Transport not found');
  return (await signImageFields(rows, IMAGE_FIELDS.transports))[0];
};

export const listTransports = async (req, res) => {
  const q = transportListQuery.parse(req.query);
  const where = [];
  const params = [];
  const add = (v) => (params.push(v), `$${params.length}`);
  if (q.transport_type) where.push(q.transport_type === '__none__' ? 't.transport_type IS NULL' : `t.transport_type = ${add(q.transport_type)}`);
  if (q.state) where.push(`t.transport_state ILIKE ${add(q.state)}`);
  if (q.status) where.push(q.status === 'active' ? 't.is_active' : 'NOT t.is_active');
  for (const w of (q.search || '').split(/\s+/).filter(Boolean).slice(0, 6)) {
    const p = add(`%${w.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(t.transport_id ILIKE ${p} OR t.transport_name ILIKE ${p} OR t.transport_contact_person ILIKE ${p}
      OR t.transport_contact_number ILIKE ${p} OR t.transport_city ILIKE ${p} OR t.gstin ILIKE ${p}
      OR t.to_destinations::text ILIKE ${p})`);
  }
  const { rows } = await query(
    `SELECT ${COLS}, jsonb_array_length(t.to_destinations)::int AS destination_count,
            COALESCE(u.n, 0)::int AS client_count, COUNT(*) OVER()::int AS total_count
       FROM transports t
       LEFT JOIN (SELECT transport_ref, COUNT(DISTINCT client_id) AS n FROM client_transport_priorities GROUP BY transport_ref) u
              ON u.transport_ref = t.id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${SORTS[q.sort]} ${q.order} NULLS LAST, t.id
      LIMIT ${add(q.limit)} OFFSET ${add((q.page - 1) * q.limit)}`,
    params
  );
  res.json({
    data: await signImageFields(rows.map(({ total_count, ...r }) => r), IMAGE_FIELDS.transports),
    total: rows[0]?.total_count ?? 0,
    page: q.page,
    limit: q.limit,
  });
};

export const transportSummary = async (req, res) => {
  const [{ rows: [s] }, { rows: types }, { rows: last }] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE is_active)::int AS active,
                  COALESCE(SUM(jsonb_array_length(to_destinations)), 0)::int AS destinations,
                  (SELECT COUNT(DISTINCT transport_ref)::int FROM client_transport_priorities) AS in_use
             FROM transports`),
    query(`SELECT transport_type AS type, COUNT(*)::int AS n FROM transports GROUP BY transport_type ORDER BY n DESC`),
    query(`SELECT l.finished_at, u.name AS started_by FROM sheet_sync_logs l LEFT JOIN users u ON u.id = l.started_by
            WHERE l.module = 'transports' AND l.status = 'SUCCESS' ORDER BY l.finished_at DESC LIMIT 1`),
  ]);
  res.json({ data: { ...s, types, lastSync: last[0] || null, sheet: { url: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`, tab: MASTER_TABS.transports } } });
};

/** Lightweight list for pickers (client transport priority). */
export const transportOptions = async (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 80);
  const { rows } = await query(
    `SELECT id, transport_id, transport_name, transport_city, transport_type, is_active FROM transports
      WHERE ($1 = '' OR transport_name ILIKE '%' || $1 || '%' OR transport_id ILIKE '%' || $1 || '%')
      ORDER BY is_active DESC, transport_name LIMIT 30`,
    [search]
  );
  res.json({ data: rows });
};

async function transportDetail(id) {
  const t = await findTransport(id);
  const { rows: clients } = await query(
    `SELECT c.id, c.client_id, c.company_name, c.city, array_agg(DISTINCT p.type_of_order) FILTER (WHERE p.type_of_order IS NOT NULL) AS order_types
       FROM client_transport_priorities p JOIN clients c ON c.id = p.client_id
      WHERE p.transport_ref = $1 GROUP BY c.id ORDER BY c.company_name LIMIT 200`,
    [t.id]
  );
  return { ...t, clients };
}

export const getTransport = async (req, res) => res.json({ data: await transportDetail(req.params.id) });

export const createTransport = async (req, res) => {
  const rec = transportSchema.parse(req.body);
  const id = await withTransaction(async (db) => {
    rec.transport_id = await nextTransportId(db);
    return insertRecord(db, 'transports', TRANSPORT_FIELDS, rec, { created_by: req.user.id, updated_by: req.user.id });
  });
  res.status(201).json({ data: await transportDetail(id) });
};

export const updateTransport = async (req, res) => {
  const current = await findTransport(req.params.id);
  const rec = transportSchema.parse(req.body);
  await updateRecord({ query }, 'transports', TRANSPORT_FIELDS, current.id, rec, { updated_by: req.user.id });
  if (isS3Ref(current.transport_vcard_photo) && current.transport_vcard_photo !== rec.transport_vcard_photo) {
    await deleteRefQuietly(current.transport_vcard_photo);
  }
  res.json({ data: await transportDetail(current.id) });
};

export const deleteTransport = async (req, res) => {
  const t = await findTransport(req.params.id);
  if (t.client_count > 0) {
    throw conflict(`${t.client_count} client(s) use this transport in their transport priority. Remove it there or mark the transport inactive instead.`);
  }
  await query('DELETE FROM transports WHERE id = $1', [t.id]);
  await deleteRefQuietly(t.transport_vcard_photo);
  res.json({ message: 'Transport deleted' });
};

export const runTransportSync = async (req, res) => {
  if (!can(req.user, 'transport_master', 'create')) throw forbidden('Sync needs Create + Edit permission on Transport Master');
  res.json({ data: await syncTransports({ userId: req.user.id }) });
};

export const transportSyncLogs = async (req, res) => res.json({ data: await syncLogs('transports') });
