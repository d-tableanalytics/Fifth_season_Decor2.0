/**
 * One-time (re-runnable) import of the previous system's export:
 *   npm run import:master -- ../Master_Data_Export.xlsx
 * Sheets: "Client Master", "Transport Master", "Transport Priority".
 * Upserts clients by clientId and transports by transportId (keeping the original UUIDs),
 * then rebuilds imported transport priorities (de-duplicated) linked by TRN id.
 */
import path from 'node:path';
import ExcelJS from 'exceljs';
import { pool, withTransaction } from '../config/db.js';
import { CLIENT_FIELDS, TRANSPORT_FIELDS, OPTIONS, mapColumns, rowToRecord, coerce } from '../config/masterFields.js';
import { insertRecord, updateRecord } from '../services/masterRepo.js';
import { applyClientZoneRule } from '../config/zones.js';
import { dedupePriorities, insertPriorities } from '../services/clientPriorities.js';

const file = path.resolve(process.argv[2] || '../Master_Data_Export.xlsx');

const cellValue = (v) => {
  if (v == null) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return v.text ?? v.result ?? (v.richText ? v.richText.map((r) => r.text).join('') : '');
  return v;
};

function readSheet(wb, name) {
  const ws = wb.getWorksheet(name);
  if (!ws) throw new Error(`Sheet "${name}" not found in ${file}`);
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => rows.push(r.values.slice(1).map(cellValue)));
  const [headers = [], ...data] = rows;
  return { headers: headers.map((h) => String(h).trim()), rows: data };
}

const isUuid = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const ts = (v) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v).toISOString() : null);

async function upsertMaster(client, { table, fields, keyField, sheet }) {
  const cols = mapColumns(sheet.headers, fields);
  const H = (name) => sheet.headers.indexOf(name);
  const stats = { rows: sheet.rows.length, created: 0, updated: 0, skipped: 0, invalidValues: 0 };
  const idMap = new Map(); // code -> uuid

  for (const row of sheet.rows) {
    const { rec, invalid } = rowToRecord(row, cols, fields);
    if (table === 'clients') applyClientZoneRule(rec);
    stats.invalidValues += invalid;
    const code = rec[keyField];
    const nameField = fields.find((x) => x.required)?.key;
    if (!code || !rec[nameField]) {
      stats.skipped++;
      continue;
    }
    const { rows: found } = await client.query(`SELECT id FROM ${table} WHERE ${keyField} = $1`, [code]);
    if (found[0]) {
      await updateRecord(client, table, fields, found[0].id, rec, { source: 'IMPORT' });
      idMap.set(code, found[0].id);
      stats.updated++;
    } else {
      const exportId = String(row[H('id')] ?? '');
      const extra = { source: 'IMPORT' };
      if (isUuid(exportId)) extra.id = exportId;
      if (ts(row[H('createdAt')])) extra.created_at = ts(row[H('createdAt')]);
      if (ts(row[H('updatedAt')])) extra.updated_at = ts(row[H('updatedAt')]);
      idMap.set(code, await insertRecord(client, table, fields, rec, extra));
      stats.created++;
    }
  }
  return { stats, idMap };
}

const run = async () => {
  console.log(`Reading ${file} …`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const transportsSheet = readSheet(wb, 'Transport Master');
  const clientsSheet = readSheet(wb, 'Client Master');
  const prioSheet = readSheet(wb, 'Transport Priority');

  const report = await withTransaction(async (client) => {
    const t = await upsertMaster(client, { table: 'transports', fields: TRANSPORT_FIELDS, keyField: 'transport_id', sheet: transportsSheet });
    const c = await upsertMaster(client, { table: 'clients', fields: CLIENT_FIELDS, keyField: 'client_id', sheet: clientsSheet });

    // Priorities: resolve codes, de-duplicate, then rebuild the imported set
    const H = (name) => prioSheet.headers.indexOf(name);
    const field = (k) => ({ type: 'enum', options: OPTIONS[k] });
    const raw = prioSheet.rows.map((r) => ({
      clientCode: String(r[H('clientId')] ?? '').trim().toUpperCase(),
      type_of_order: coerce(field('type_of_order'), r[H('typeOfOrder')]).value,
      priority: coerce(field('priority'), r[H('priority')]).value,
      transporter_type: coerce(field('transporter_type'), r[H('transporterType')]).value,
      transport_code: String(r[H('transportId')] ?? '').trim().toUpperCase() || null,
    }));
    const { rows: allClients } = await client.query('SELECT id, client_id FROM clients');
    const clientIds = new Map(allClients.map((x) => [x.client_id, x.id]));
    const resolved = raw.filter((p) => clientIds.has(p.clientCode)).map((p) => ({ ...p, client_id: clientIds.get(p.clientCode) }));
    const unique = dedupePriorities(resolved);

    const touched = [...new Set(unique.map((p) => p.client_id))];
    await client.query("DELETE FROM client_transport_priorities WHERE source = 'IMPORT' AND client_id = ANY($1::uuid[])", [touched]);
    const inserted = await insertPriorities(client, unique, 'IMPORT');
    const { rows: unlinked } = await client.query(
      "SELECT COUNT(*)::int AS n FROM client_transport_priorities WHERE source = 'IMPORT' AND transport_code IS NOT NULL AND transport_ref IS NULL"
    );

    return {
      transports: t.stats,
      clients: c.stats,
      priorities: {
        rows: raw.length,
        unknownClient: raw.length - resolved.length,
        duplicatesRemoved: resolved.length - unique.length,
        inserted,
        unlinkedTransport: unlinked[0].n,
      },
    };
  });
  console.log(JSON.stringify(report, null, 2));
  console.log('✔ Import finished');
};

run()
  .catch((err) => {
    console.error('✖ Import failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
