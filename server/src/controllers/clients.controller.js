import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { CLIENT_FIELDS, IMAGE_FIELDS } from '../config/masterFields.js';
import { GOOGLE_SHEET_ID, MASTER_TABS } from '../config/sheets.js';
import { clientSchema, listQuery } from '../validators/masters.js';
import { selectList, insertRecord, updateRecord, nextClientId, nextVisitNo } from '../services/masterRepo.js';
import { syncClients, syncLogs } from '../services/masterSync.js';
import { signImageFields, deleteRefQuietly, isS3Ref } from '../config/s3.js';
import { can } from '../services/access.js';
import { applyClientZoneRule } from '../config/zones.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';

const SORTS = {
  company_name: 'c.company_name', client_id: 'c.client_id', city: 'c.city', state: 'c.state',
  credit_limit: 'c.credit_limit', updated_at: 'c.updated_at', created_at: 'c.created_at',
};

const clientListQuery = listQuery.extend({
  state: z.string().trim().max(80).optional(),
  zone: z.string().trim().max(30).optional(),
  registration_type: z.string().trim().max(30).optional(),
  client_confirmation: z.string().trim().max(30).optional(),
  status: z.enum(['active', 'inactive']).optional(),
  transport: z.enum(['with', 'without', 'unlinked']).optional(),
  skip_payment: z.enum(['yes', 'no']).optional(),
  sort: z.enum(Object.keys(SORTS)).default('company_name'),
});

const LIST_COLS = `c.id, c.client_id, c.visit_no, c.company_name, c.city, c.state, c.zone, c.gstin, c.owner_name,
  c.owner_contact_no, c.registration_type, c.client_confirmation, c.client_type, c.payment_mode,
  c.credit_limit::float AS credit_limit, c.credit_days, c.is_active, c.skip_payment_check, c.source, c.updated_at`;

export const listClients = async (req, res) => {
  const q = clientListQuery.parse(req.query);
  const where = [];
  const params = [];
  const add = (v) => (params.push(v), `$${params.length}`);
  const none = (col, v) => (v === '__none__' ? `${col} IS NULL` : `${col} = ${add(v)}`);

  if (q.state) where.push(q.state === '__none__' ? 'c.state IS NULL' : `c.state ILIKE ${add(q.state)}`);
  if (q.zone) where.push(none('c.zone', q.zone));
  if (q.registration_type) where.push(none('c.registration_type', q.registration_type));
  if (q.client_confirmation) where.push(`c.client_confirmation = ${add(q.client_confirmation)}`);
  if (q.status) where.push(q.status === 'active' ? 'c.is_active' : 'NOT c.is_active');
  if (q.skip_payment) where.push(q.skip_payment === 'yes' ? 'c.skip_payment_check' : 'NOT c.skip_payment_check');
  if (q.transport === 'with') where.push('EXISTS (SELECT 1 FROM client_transport_priorities p WHERE p.client_id = c.id)');
  if (q.transport === 'without') where.push('NOT EXISTS (SELECT 1 FROM client_transport_priorities p WHERE p.client_id = c.id)');
  if (q.transport === 'unlinked') where.push('EXISTS (SELECT 1 FROM client_transport_priorities p WHERE p.client_id = c.id AND p.transport_code IS NOT NULL AND p.transport_ref IS NULL)');
  for (const w of (q.search || '').split(/\s+/).filter(Boolean).slice(0, 6)) {
    const p = add(`%${w.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(c.client_id ILIKE ${p} OR c.company_name ILIKE ${p} OR c.city ILIKE ${p} OR c.state ILIKE ${p}
      OR c.gstin ILIKE ${p} OR c.owner_name ILIKE ${p} OR c.owner_contact_no ILIKE ${p} OR c.whatsapp_group_name ILIKE ${p})`);
  }

  const { rows } = await query(
    `SELECT ${LIST_COLS}, tp.transports, COALESCE(tp.n, 0)::int AS priority_count, COUNT(*) OVER()::int AS total_count
       FROM clients c
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS n,
                (SELECT json_agg(x) FROM (
                   SELECT DISTINCT ON (t.id) t.id, t.transport_id, t.transport_name
                     FROM client_transport_priorities p2 JOIN transports t ON t.id = p2.transport_ref
                    WHERE p2.client_id = c.id ORDER BY t.id, p2.priority NULLS LAST LIMIT 3) x) AS transports
           FROM client_transport_priorities p WHERE p.client_id = c.id
       ) tp ON TRUE
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${SORTS[q.sort]} ${q.order} NULLS LAST, c.id
      LIMIT ${add(q.limit)} OFFSET ${add((q.page - 1) * q.limit)}`,
    params
  );
  res.json({ data: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0, page: q.page, limit: q.limit });
};

export const clientSummary = async (req, res) => {
  const [{ rows: [s] }, { rows: last }] = await Promise.all([
    query(`SELECT COUNT(*)::int AS total,
                  COUNT(*) FILTER (WHERE is_active)::int AS active,
                  COUNT(*) FILTER (WHERE client_confirmation = 'APPROVED')::int AS approved,
                  COUNT(*) FILTER (WHERE client_confirmation IN ('SUBMITTED', 'PENDING_APPROVAL'))::int AS pending,
                  COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM client_transport_priorities p WHERE p.client_id = c.id))::int AS with_transport
             FROM clients c`),
    query(`SELECT l.finished_at, u.name AS started_by FROM sheet_sync_logs l LEFT JOIN users u ON u.id = l.started_by
            WHERE l.module = 'clients' AND l.status = 'SUCCESS' ORDER BY l.finished_at DESC LIMIT 1`),
  ]);
  res.json({
    data: {
      ...s,
      lastSync: last[0] || null,
      sheet: { url: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`, tabs: { clients: MASTER_TABS.clients, priorities: MASTER_TABS.priorities } },
    },
  });
};

export const clientFilters = async (req, res) => {
  const [{ rows: states }, { rows: zones }] = await Promise.all([
    query(`SELECT initcap(lower(state)) AS name, COUNT(*)::int AS n FROM clients WHERE state IS NOT NULL GROUP BY 1 ORDER BY 1`),
    query(`SELECT zone AS name, COUNT(*)::int AS n FROM clients WHERE zone IS NOT NULL GROUP BY 1 ORDER BY 1`),
  ]);
  res.json({ data: { states, zones } });
};

/** Suggest a zone from what existing clients with a similar PIN / same state use. */
export const zoneSuggest = async (req, res) => {
  const pin = String(req.query.pin || '').replace(/\D/g, '').slice(0, 6);
  const state = String(req.query.state || '').trim();
  const pick = async (sql, p) => (await query(sql, p)).rows[0]?.zone || null;
  let zone = null;
  let basis = null;
  if (pin.length >= 3) {
    zone = await pick(`SELECT zone FROM clients WHERE zone IS NOT NULL AND pin LIKE $1 GROUP BY zone ORDER BY COUNT(*) DESC LIMIT 1`, [`${pin.slice(0, 3)}%`]);
    if (zone) basis = `clients with PIN ${pin.slice(0, 3)}xxx`;
  }
  if (!zone && state) {
    zone = await pick(`SELECT zone FROM clients WHERE zone IS NOT NULL AND state ILIKE $1 GROUP BY zone ORDER BY COUNT(*) DESC LIMIT 1`, [state]);
    if (zone) basis = `clients in ${state}`;
  }
  res.json({ data: { zone, basis } });
};

async function loadClient(id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Client not found');
  const { rows } = await query(`SELECT ${selectList(CLIENT_FIELDS)} FROM clients WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Client not found');
  const [{ rows: priorities }, { rows: referrals }, { rows: products }] = await Promise.all([
    query(
      `SELECT p.id, p.type_of_order, p.priority, p.transporter_type, p.transport_code, p.transport_ref, p.source,
              t.transport_id, t.transport_name, t.transport_city, t.transport_type, t.is_active AS transport_active
         FROM client_transport_priorities p LEFT JOIN transports t ON t.id = p.transport_ref
        WHERE p.client_id = $1 ORDER BY p.sort_order, p.priority NULLS LAST`,
      [id]
    ),
    query('SELECT id, name, phone_number, city, comment, photo_reference FROM client_referrals WHERE client_id = $1 ORDER BY sort_order', [id]),
    query(
      `SELECT id, product_ref_id, product_name, volume_of_purchase::float AS volume_of_purchase, price_per_unit::float AS price_per_unit, photo_reference
         FROM client_top_selling_products WHERE client_id = $1 ORDER BY sort_order`,
      [id]
    ),
  ]);
  const [client] = await signImageFields(rows, IMAGE_FIELDS.clients);
  return {
    ...client,
    transport_priorities: priorities,
    referrals: await signImageFields(referrals, ['photo_reference']),
    top_selling_products: await signImageFields(products, ['photo_reference']),
  };
}

export const getClient = async (req, res) => res.json({ data: await loadClient(req.params.id) });

/** Replace a client's child rows (inside a transaction). */
async function saveChildren(db, clientId, body) {
  await db.query('DELETE FROM client_referrals WHERE client_id = $1', [clientId]);
  for (const [i, r] of body.referrals.entries()) {
    if (!r.name && !r.phone_number) continue;
    await db.query(
      'INSERT INTO client_referrals (client_id, name, phone_number, city, comment, photo_reference, sort_order) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [clientId, r.name, r.phone_number, r.city, r.comment, r.photo_reference, i]
    );
  }
  await db.query('DELETE FROM client_top_selling_products WHERE client_id = $1', [clientId]);
  for (const [i, p] of body.top_selling_products.entries()) {
    if (!p.product_name && !p.product_ref_id) continue;
    await db.query(
      `INSERT INTO client_top_selling_products (client_id, product_ref_id, product_name, volume_of_purchase, price_per_unit, photo_reference, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [clientId, p.product_ref_id, p.product_name, p.volume_of_purchase, p.price_per_unit, p.photo_reference, i]
    );
  }
  // Transport priorities: keep each row's transport link; code comes from the transport itself
  const seen = new Set();
  const rows = body.transport_priorities.filter((p) => {
    if (!p.type_of_order && !p.priority && !p.transporter_type && !p.transport_ref) return false;
    const k = [p.type_of_order, p.priority, p.transporter_type, p.transport_ref].join('|');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  const refs = rows.map((p) => p.transport_ref).filter(Boolean);
  if (refs.length) {
    const { rows: found } = await db.query('SELECT id FROM transports WHERE id = ANY($1::uuid[])', [refs]);
    if (found.length < new Set(refs).size) throw badRequest('One of the selected transports no longer exists');
  }
  await db.query('DELETE FROM client_transport_priorities WHERE client_id = $1', [clientId]);
  for (const [i, p] of rows.entries()) {
    await db.query(
      `INSERT INTO client_transport_priorities (client_id, type_of_order, priority, transporter_type, transport_ref, transport_code, source, sort_order)
       VALUES ($1, $2, $3, $4, $5, (SELECT transport_id FROM transports WHERE id = $5), 'MANUAL', $6)`,
      [clientId, p.type_of_order, p.priority, p.transporter_type, p.transport_ref, i]
    );
  }
}

/** All s3:// refs held by a client (fields + child photos). */
const s3Refs = (c) =>
  [...IMAGE_FIELDS.clients.map((k) => c[k]), ...(c.referrals || []).map((r) => r.photo_reference), ...(c.top_selling_products || []).map((p) => p.photo_reference)].filter(isS3Ref);

export const createClient = async (req, res) => {
  const body = clientSchema.parse(req.body);
  const id = await withTransaction(async (db) => {
    const rec = { ...body };
    applyClientZoneRule(rec);
    rec.client_id = body.client_id || (await nextClientId(db));
    rec.visit_no = body.visit_no || (await nextVisitNo(db));
    const newId = await insertRecord(db, 'clients', CLIENT_FIELDS, rec, { created_by: req.user.id, updated_by: req.user.id });
    await saveChildren(db, newId, body);
    return newId;
  });
  res.status(201).json({ data: await loadClient(id) });
};

export const updateClient = async (req, res) => {
  const before = await loadClient(req.params.id);
  const body = clientSchema.parse(req.body);
  const rec = { ...body };
  delete rec.client_id; // Client ID is the sheet/sync key — not editable after creation
  applyClientZoneRule(rec);
  await withTransaction(async (db) => {
    await updateRecord(db, 'clients', CLIENT_FIELDS, before.id, rec, { updated_by: req.user.id });
    await saveChildren(db, before.id, body);
  });
  const keep = new Set(s3Refs(body));
  for (const ref of s3Refs(before)) if (!keep.has(ref)) await deleteRefQuietly(ref);
  res.json({ data: await loadClient(before.id) });
};

export const deleteClient = async (req, res) => {
  const c = await loadClient(req.params.id);
  await query('DELETE FROM clients WHERE id = $1', [c.id]);
  for (const ref of s3Refs(c)) await deleteRefQuietly(ref);
  res.json({ message: 'Client deleted' });
};

const syncSchema = z.object({
  tabs: z.array(z.enum(['clients', 'priorities'])).min(1, 'Select at least one tab').transform((a) => [...new Set(a)]),
});

export const runClientSync = async (req, res) => {
  const { tabs } = syncSchema.parse(req.body);
  if (!can(req.user, 'client_master', 'create')) throw forbidden('Sync needs Create + Edit permission on Client Master');
  res.json({ data: await syncClients({ tabs, userId: req.user.id }) });
};

export const clientSyncLogs = async (req, res) => res.json({ data: await syncLogs('clients') });
