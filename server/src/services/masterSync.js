import { query, withTransaction } from '../config/db.js';
import { GOOGLE_SHEET_ID, MASTER_TABS } from '../config/sheets.js';
import { CLIENT_FIELDS, TRANSPORT_FIELDS, OPTIONS, mapColumns, rowToRecord, coerce, normHeader } from '../config/masterFields.js';
import { fetchSheetTab } from './googleSheet.js';
import { insertRecord, updateRecord, nextTransportId, nextVisitNo } from './masterRepo.js';
import { dedupePriorities, insertPriorities, relinkPriorities } from './clientPriorities.js';
import { HttpError, conflict } from '../utils/httpError.js';
import { applyClientZoneRule } from '../config/zones.js';

const running = new Set(); // module names currently syncing (single-instance guard)
const norm = (s) => String(s ?? '').replace(/\s+/g, ' ').trim().toUpperCase();
const hasRows = (tab) => tab.rows.filter((r) => r.some((v) => String(v).trim()));

export async function runLogged(module, tabs, userId, fn) {
  if (running.has(module)) throw conflict('A sync for this module is already running. Please wait for it to finish.');
  running.add(module);
  const startedAt = new Date();
  try {
    const results = await fn();
    const durationMs = Date.now() - startedAt.getTime();
    await writeLog({ module, tabs, userId, startedAt, status: 'SUCCESS', stats: { results, durationMs } });
    return { durationMs, results };
  } catch (err) {
    await writeLog({ module, tabs, userId, startedAt, status: 'FAILED', error: err.message }).catch(() => {});
    throw err;
  } finally {
    running.delete(module);
  }
}

const writeLog = ({ module, tabs, userId, startedAt, status, stats = null, error = null }) =>
  query(
    `INSERT INTO sheet_sync_logs (module, tabs, status, stats, error, started_by, started_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
    [module, tabs, status, stats, error, userId, startedAt]
  );

export const syncLogs = async (module) => {
  const { rows } = await query(
    `SELECT l.id, l.tabs, l.status, l.stats, l.error, l.started_at, l.finished_at, u.name AS started_by
       FROM sheet_sync_logs l LEFT JOIN users u ON u.id = l.started_by
      WHERE l.module = $1 ORDER BY l.started_at DESC LIMIT 10`,
    [module]
  );
  return rows;
};

/* =====================================================================
   Clients — additive: new Client IDs are created; existing IDs are skipped (never overwritten)
   ===================================================================== */
async function mergeClients(db, tab, userId) {
  const cols = mapColumns(tab.headers, CLIENT_FIELDS);
  if (cols.client_id === undefined || cols.company_name === undefined) {
    throw new HttpError(422, `The "${MASTER_TABS.clients}" tab needs "clientId" and "companyName" columns.`);
  }
  const { rows: existing } = await db.query('SELECT client_id, credit_limit IS NULL AS no_limit, credit_days IS NULL AS no_days FROM clients');
  const known = new Map(existing.map((r) => [r.client_id, r]));
  const seen = new Set();
  const s = { sheetRows: 0, created: 0, skippedExisting: 0, creditFilled: 0, skippedBlank: 0, duplicates: 0, invalidValues: 0, createdIds: [] };
  const creditFill = []; // existing clients: blank credit limit / days are filled from the sheet (never overwritten)

  for (const row of hasRows(tab)) {
    s.sheetRows++;
    const { rec, invalid } = rowToRecord(row, cols, CLIENT_FIELDS);
    if (!rec.client_id || !rec.company_name) {
      s.skippedBlank++;
      continue;
    }
    if (seen.has(rec.client_id)) {
      s.duplicates++;
      continue;
    }
    seen.add(rec.client_id);
    if (known.has(rec.client_id)) {
      s.skippedExisting++;
      const k = known.get(rec.client_id);
      const limit = k.no_limit && rec.credit_limit != null ? rec.credit_limit : null;
      const days = k.no_days && rec.credit_days != null ? rec.credit_days : null;
      if (limit != null || days != null) creditFill.push({ id: rec.client_id, limit, days });
      continue;
    }
    s.invalidValues += invalid;
    rec.visit_no = rec.visit_no || (await nextVisitNo(db));
    if (rec.country == null) rec.country = 'India';
    applyClientZoneRule(rec);
    if (!rec.full_address) rec.full_address = [rec.plot_no_building_name, rec.landmark1, rec.landmark2, rec.street_road_name, rec.city, rec.state, rec.pin].filter(Boolean).join(', ') || null;
    await insertRecord(db, 'clients', CLIENT_FIELDS, rec, { source: 'SHEET', created_by: userId, updated_by: userId });
    s.created++;
    if (s.createdIds.length < 50) s.createdIds.push(rec.client_id);
  }
  if (creditFill.length) {
    const { rowCount } = await db.query(
      `UPDATE clients c SET credit_limit = COALESCE(c.credit_limit, x.climit), credit_days = COALESCE(c.credit_days, x.cdays),
              updated_by = $4, updated_at = NOW()
         FROM unnest($1::text[], $2::numeric[], $3::int[]) AS x(cid, climit, cdays)
        WHERE c.client_id = x.cid AND ((c.credit_limit IS NULL AND x.climit IS NOT NULL) OR (c.credit_days IS NULL AND x.cdays IS NOT NULL))`,
      [creditFill.map((c) => c.id), creditFill.map((c) => c.limit), creditFill.map((c) => c.days), userId]
    );
    s.creditFilled = rowCount;
  }
  return { tab: MASTER_TABS.clients, ...s };
}

/* =====================================================================
   Transport Priority — additive: new client/type/priority/transport combinations are added
   ===================================================================== */
async function mergePriorities(db, tab) {
  const H = (name) => tab.headers.findIndex((h) => normHeader(h) === normHeader(name));
  const idx = { client: H('clientId'), type: H('typeOfOrder'), prio: H('priority'), ttype: H('transporterType'), trn: H('transportId') };
  if (idx.client < 0) throw new HttpError(422, `The "${MASTER_TABS.priorities}" tab needs a "clientId" column.`);
  const field = (k) => ({ type: 'enum', options: OPTIONS[k] });

  const rows = hasRows(tab);
  const { rows: clients } = await db.query('SELECT id, client_id FROM clients');
  const ids = new Map(clients.map((c) => [c.client_id, c.id]));

  const raw = rows.map((r) => ({
    code: norm(r[idx.client]),
    type_of_order: coerce(field('type_of_order'), r[idx.type]).value,
    priority: coerce(field('priority'), r[idx.prio]).value,
    transporter_type: coerce(field('transporter_type'), r[idx.ttype]).value,
    transport_code: idx.trn >= 0 ? norm(r[idx.trn]) || null : null,
  }));
  const resolved = raw.filter((p) => ids.has(p.code)).map((p) => ({ ...p, client_id: ids.get(p.code) }));
  let unique = dedupePriorities(resolved);

  // Don't add a "no transport" row where the DB already has a transport for that slot
  const { rows: assigned } = await db.query(
    'SELECT client_id, type_of_order, priority, transporter_type FROM client_transport_priorities WHERE transport_code IS NOT NULL'
  );
  const slot = (p) => [p.client_id, p.type_of_order, p.priority, p.transporter_type].join('|');
  const taken = new Set(assigned.map(slot));
  unique = unique.filter((p) => p.transport_code || !taken.has(slot(p)));

  const added = await insertPriorities(db, unique, 'SHEET');
  const { rows: trn } = await db.query('SELECT transport_id FROM transports');
  const knownTrn = new Set(trn.map((t) => t.transport_id));
  return {
    tab: MASTER_TABS.priorities,
    sheetRows: rows.length,
    unknownClient: raw.filter((p) => p.code && !ids.has(p.code)).length,
    duplicates: resolved.length - unique.length,
    added,
    alreadyPresent: unique.length - added,
    unlinkedTransport: unique.filter((p) => p.transport_code && !knownTrn.has(p.transport_code)).length,
  };
}

export const syncClients = ({ tabs, userId }) =>
  runLogged('clients', tabs, userId, async () => {
    const data = {};
    for (const t of tabs) data[t] = await fetchSheetTab(GOOGLE_SHEET_ID, MASTER_TABS[t]);
    return withTransaction(async (db) => {
      const out = [];
      if (data.clients) out.push({ key: 'clients', ...(await mergeClients(db, data.clients, userId)) });
      if (data.priorities) out.push({ key: 'priorities', ...(await mergePriorities(db, data.priorities)) });
      return out;
    });
  });

/* =====================================================================
   Transport Master — the sheet has one row per transport + destination.
   Rows are grouped by transport name: new names are created (next TRN id);
   existing transports get blank fields filled and new destinations appended.
   ===================================================================== */
const DEST_COLS = {
  contact_person: ['destinationcontactperson', 'tocontactperson'],
  contact_number: ['destinationcontactno', 'destinationcontactnumber', 'totransportcontactnumber'],
  gst: ['destinationtrasnportgst', 'destinationtransportgst', 'totransportgst'],
  full_address: ['destinationaddress', 'totransportfulladdress'],
  city: ['destinationcity', 'totransportcity'],
  state: ['destinationstate', 'totransportstate'],
  country: ['desctinationcountry', 'destinationcountry', 'totransportcountry'],
  pin: ['destinationpin', 'totransportpin'],
};
const destKey = (d) => [norm(d.city), norm(d.state), norm(d.contact_number)].join('|');

export const syncTransports = ({ userId }) =>
  runLogged('transports', ['transports'], userId, async () => {
    const tab = await fetchSheetTab(GOOGLE_SHEET_ID, MASTER_TABS.transports);
    // Sheet "to*" columns describe destinations, so only map the transporter's own fields
    const ownFields = TRANSPORT_FIELDS.filter((fd) => !fd.key.startsWith('to_') && fd.key !== 'transport_id');
    const cols = mapColumns(tab.headers, ownFields);
    if (cols.transport_name === undefined) throw new HttpError(422, `The "${MASTER_TABS.transports}" tab needs a "transportName" column.`);
    const hNorm = tab.headers.map(normHeader);
    const destIdx = Object.fromEntries(Object.entries(DEST_COLS).map(([k, names]) => [k, hNorm.findIndex((h) => names.includes(h))]));

    // Group sheet rows by transport name
    const groups = new Map();
    let invalidValues = 0;
    for (const row of hasRows(tab)) {
      const { rec, invalid } = rowToRecord(row, cols, ownFields);
      invalidValues += invalid;
      if (!rec.transport_name) continue;
      const dest = {};
      for (const [k, i] of Object.entries(destIdx)) {
        const v = i >= 0 ? String(row[i] ?? '').replace(/\s+/g, ' ').trim() : '';
        if (v && v !== '–' && v !== '-') dest[k] = k === 'country' && /^india$/i.test(v) ? 'India' : v;
      }
      const key = norm(rec.transport_name);
      if (!groups.has(key)) groups.set(key, { rec, dests: [] });
      const g = groups.get(key);
      for (const [k, v] of Object.entries(rec)) if (g.rec[k] == null && v != null) g.rec[k] = v; // first non-blank wins
      if (dest.city || dest.contact_number || dest.full_address) g.dests.push(dest);
    }

    return withTransaction(async (db) => {
      const { rows: existing } = await db.query(
        `SELECT id, transport_id, inv_norm(transport_name) AS k, to_destinations, ${ownFields.map((f) => f.key).join(', ')}
           FROM transports ORDER BY transport_id`
      );
      const byName = new Map();
      const ambiguous = new Set();
      for (const t of existing) {
        if (byName.has(t.k)) ambiguous.add(t.k);
        else byName.set(t.k, t);
      }

      const s = { tab: MASTER_TABS.transports, sheetRows: hasRows(tab).length, transportsInSheet: groups.size, created: 0, updated: 0, unchanged: 0, destinationsAdded: 0, ambiguousNames: 0, invalidValues, createdIds: [] };
      for (const [key, g] of groups) {
        const uniqDests = [...new Map(g.dests.map((d) => [destKey(d), d])).values()];
        const current = byName.get(key);
        if (!current) {
          const transport_id = await nextTransportId(db);
          await insertRecord(db, 'transports', TRANSPORT_FIELDS, { ...g.rec, transport_id, to_destinations: uniqDests }, { source: 'SHEET', created_by: userId, updated_by: userId });
          s.created++;
          s.destinationsAdded += uniqDests.length;
          if (s.createdIds.length < 50) s.createdIds.push(transport_id);
          continue;
        }
        if (ambiguous.has(key)) s.ambiguousNames++;
        // Fill only blank fields; never overwrite what is already in the ERP
        const patch = {};
        for (const fd of ownFields) if (current[fd.key] == null && g.rec[fd.key] != null) patch[fd.key] = g.rec[fd.key];
        const have = new Set((current.to_destinations || []).map(destKey));
        const newDests = uniqDests.filter((d) => !have.has(destKey(d)));
        if (newDests.length) patch.to_destinations = [...(current.to_destinations || []), ...newDests];
        if (Object.keys(patch).length) {
          await updateRecord(db, 'transports', TRANSPORT_FIELDS, current.id, patch, { updated_by: userId });
          s.updated++;
          s.destinationsAdded += newDests.length;
        } else s.unchanged++;
      }
      s.priorityLinksFixed = await relinkPriorities(db);
      return [{ key: 'transports', ...s }];
    });
  });

