import { query, withTransaction } from '../config/db.js';
import { GOOGLE_SHEET_ID, INVENTORY_TABS } from '../config/sheets.js';
import { fetchSheetTab } from './googleSheet.js';
import { HttpError, conflict } from '../utils/httpError.js';

const CHUNK = 1000;
const LOCK_KEY = 74_210_001; // pg advisory lock id for inventory sync
let running = false; // fast in-process guard; the advisory lock covers multiple instances

/* ---------------- Row parsing ---------------- */

// Sheet header -> field. First matching header wins.
const HEADER_MATCHERS = [
  ['item_name', (h) => h.includes('sku') || h.includes('itemname')],
  ['catalogue_name', (h) => h.startsWith('catalog')],
  ['rack_no', (h) => h.includes('rack')],
  ['quantity', (h) => h === 'qty' || h.includes('quantity')],
  ['unit', (h) => h === 'unit' || h === 'uom'],
  ['image_url', (h) => h.includes('image')],
  ['lot_no', (h) => h.includes('lot')],
  ['price', (h) => h.includes('price') || h === 'rate'],
  ['hsn_code', (h) => h.includes('hsn')],
];

const MAX = { item_name: 160, rack_no: 80, unit: 20, catalogue_name: 160, image_url: 255, lot_no: 60, hsn_code: 20 };

const mapHeaders = (headers) => {
  const norm = headers.map((h) => h.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const map = {};
  for (const [field, test] of HEADER_MATCHERS) {
    const idx = norm.findIndex((h, i) => h && test(h) && !Object.values(map).includes(i));
    if (idx >= 0) map[field] = idx;
  }
  return map;
};

const clean = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim();
  return s ? s.slice(0, max) : null;
};

/** '1,234.50' -> 1234.5 ; '' -> null ; garbage / out of range -> undefined (invalid) */
const toNumber = (v) => {
  const s = String(v ?? '').replace(/[,₹\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) < 1e10 ? Math.round(n * 100) / 100 : undefined;
};

export function parseInventoryRows(stockType, { headers, rows }) {
  const col = mapHeaders(headers);
  if (col.item_name === undefined) {
    throw new HttpError(422, `The "${INVENTORY_TABS[stockType]}" tab has no "SKU(ItemName)" column. Found: ${headers.filter(Boolean).join(', ')}`);
  }

  const items = [];
  const seen = new Set();
  const stats = { sheetRows: rows.length, valid: 0, skippedBlank: 0, invalidNumbers: 0, duplicates: 0 };

  for (const r of rows) {
    const get = (f) => (col[f] === undefined ? '' : r[col[f]]);
    const item_name = clean(get('item_name'), MAX.item_name);
    if (!item_name) {
      stats.skippedBlank++;
      continue;
    }
    const rack_no = clean(get('rack_no'), MAX.rack_no) || '';
    let quantity = toNumber(get('quantity'));
    let price = toNumber(get('price'));
    if (quantity === undefined || price === undefined) stats.invalidNumbers++;
    if (quantity === undefined || quantity === null) quantity = 0;
    if (price === undefined) price = null;

    const key = `${item_name.toUpperCase()}|${rack_no.toUpperCase()}`;
    if (seen.has(key)) stats.duplicates++;
    seen.add(key);

    items.push({
      stock_type: stockType,
      item_name,
      rack_no,
      quantity,
      unit: clean(get('unit'), MAX.unit) || 'Mtr',
      catalogue_name: clean(get('catalogue_name'), MAX.catalogue_name),
      image_url: clean(get('image_url'), MAX.image_url),
      lot_no: clean(get('lot_no'), MAX.lot_no),
      price,
    });
  }
  stats.valid = items.length;
  return { items, stats, columns: Object.keys(col) };
}

/* ---------------- Database merge ---------------- */

const pluck = (items, f) => items.map((i) => i[f]);

/** Diff-based create + update. Unchanged rows are not written. A blank sheet price/image keeps the existing one. */
async function upsertChunk(client, items, userId) {
  const { rows } = await client.query(
    `INSERT INTO inventory_stock
       (stock_type, item_name, rack_no, quantity, unit, catalogue_name, image_url, lot_no, price,
        source, last_synced_at, created_by, updated_by)
     SELECT DISTINCT ON (t.stock_type, inv_norm(t.item_name), inv_norm(t.rack_no))
            t.stock_type, t.item_name, t.rack_no, t.quantity, t.unit, t.catalogue_name, t.image_url, t.lot_no, t.price,
            'SHEET', NOW(), $10, $10
       FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[], $5::text[], $6::text[], $7::text[], $8::text[], $9::numeric[])
            WITH ORDINALITY AS t(stock_type, item_name, rack_no, quantity, unit, catalogue_name, image_url, lot_no, price, ord)
      ORDER BY t.stock_type, inv_norm(t.item_name), inv_norm(t.rack_no), t.ord DESC
     ON CONFLICT (stock_type, item_key, rack_key) DO UPDATE SET
       item_name = EXCLUDED.item_name,
       rack_no = EXCLUDED.rack_no,
       quantity = EXCLUDED.quantity,
       unit = EXCLUDED.unit,
       catalogue_name = EXCLUDED.catalogue_name,
       image_url = COALESCE(EXCLUDED.image_url, inventory_stock.image_url), -- blank sheet image keeps an uploaded one
       lot_no = EXCLUDED.lot_no,
       price = COALESCE(EXCLUDED.price, inventory_stock.price),
       source = 'SHEET',
       last_synced_at = NOW(),
       updated_at = NOW(),
       updated_by = EXCLUDED.updated_by
     WHERE (inventory_stock.item_name, inventory_stock.rack_no, inventory_stock.quantity, inventory_stock.unit,
            inventory_stock.catalogue_name, inventory_stock.image_url, inventory_stock.lot_no, inventory_stock.price)
       IS DISTINCT FROM
           (EXCLUDED.item_name, EXCLUDED.rack_no, EXCLUDED.quantity, EXCLUDED.unit,
            EXCLUDED.catalogue_name, COALESCE(EXCLUDED.image_url, inventory_stock.image_url), EXCLUDED.lot_no,
            COALESCE(EXCLUDED.price, inventory_stock.price))
     RETURNING (xmax = 0) AS inserted`,
    [
      pluck(items, 'stock_type'), pluck(items, 'item_name'), pluck(items, 'rack_no'), pluck(items, 'quantity'),
      pluck(items, 'unit'), pluck(items, 'catalogue_name'), pluck(items, 'image_url'), pluck(items, 'lot_no'),
      pluck(items, 'price'), userId,
    ]
  );
  const created = rows.filter((r) => r.inserted).length;
  return { created, updated: rows.length - created };
}

/** Price-only: fill blank prices; never overwrite an existing different price. */
async function fillPricesChunk(client, items, userId) {
  const { rows } = await client.query(
    `WITH v AS (
       SELECT DISTINCT ON (t.stock_type, inv_norm(t.item_name), inv_norm(t.rack_no))
              t.stock_type, inv_norm(t.item_name) AS ik, inv_norm(t.rack_no) AS rk, t.price
         FROM unnest($1::text[], $2::text[], $3::text[], $4::numeric[]) WITH ORDINALITY AS t(stock_type, item_name, rack_no, price, ord)
        WHERE t.price IS NOT NULL
        ORDER BY t.stock_type, inv_norm(t.item_name), inv_norm(t.rack_no), t.ord DESC
     ),
     m AS (
       SELECT s.id, s.item_name, s.rack_no, s.stock_type, s.price AS old_price, v.price AS new_price
         FROM inventory_stock s JOIN v ON s.stock_type = v.stock_type AND s.item_key = v.ik AND s.rack_key = v.rk
     ),
     upd AS (
       UPDATE inventory_stock s SET price = m.new_price, updated_at = NOW(), updated_by = $5, last_synced_at = NOW()
         FROM m WHERE s.id = m.id AND m.old_price IS NULL
       RETURNING 1
     )
     SELECT (SELECT COUNT(*) FROM v)::int AS with_price,
            (SELECT COUNT(*) FROM m)::int AS matched,
            (SELECT COUNT(*) FROM upd)::int AS filled,
            (SELECT COUNT(*) FROM m WHERE old_price IS NOT NULL AND old_price <> new_price)::int AS conflicts,
            (SELECT COALESCE(json_agg(c), '[]') FROM (
               SELECT item_name, rack_no, old_price, new_price FROM m
                WHERE old_price IS NOT NULL AND old_price <> new_price LIMIT 25) c) AS conflict_samples`,
    [pluck(items, 'stock_type'), pluck(items, 'item_name'), pluck(items, 'rack_no'), pluck(items, 'price'), userId]
  );
  return rows[0];
}

/* ---------------- Orchestration ---------------- */

/**
 * Sync the given stock types from Google Sheets.
 * mode 'full'  -> create new rows + update changed rows (matched by stock type + item name + rack no)
 * mode 'price' -> only fill blank prices on existing rows
 */
export async function syncInventory({ stockTypes, mode, userId }) {
  if (running) throw conflict('A Google Sheet sync is already running. Please wait for it to finish.');
  running = true;
  const startedAt = new Date();
  try {
    // 1. Download + parse every tab first, so a bad tab fails before any DB change
    const parsed = await Promise.all(
      stockTypes.map(async (type) => ({ type, tab: INVENTORY_TABS[type], ...parseInventoryRows(type, await fetchSheetTab(GOOGLE_SHEET_ID, INVENTORY_TABS[type])) }))
    );

    // 2. Merge everything in one transaction (all-or-nothing)
    const results = await withTransaction(async (client) => {
      const { rows } = await client.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [LOCK_KEY]);
      if (!rows[0].ok) throw conflict('A Google Sheet sync is already running. Please wait for it to finish.');

      const out = [];
      for (const p of parsed) {
        const r = { stockType: p.type, tab: p.tab, columns: p.columns, ...p.stats };
        if (mode === 'price') {
          Object.assign(r, { withPrice: 0, matched: 0, filled: 0, conflicts: 0, conflictSamples: [] });
          for (let i = 0; i < p.items.length; i += CHUNK) {
            const c = await fillPricesChunk(client, p.items.slice(i, i + CHUNK), userId);
            r.withPrice += c.with_price;
            r.matched += c.matched;
            r.filled += c.filled;
            r.conflicts += c.conflicts;
            if (r.conflictSamples.length < 25) r.conflictSamples.push(...c.conflict_samples.slice(0, 25 - r.conflictSamples.length));
          }
          r.notFound = r.withPrice - r.matched;
        } else {
          Object.assign(r, { created: 0, updated: 0 });
          for (let i = 0; i < p.items.length; i += CHUNK) {
            const c = await upsertChunk(client, p.items.slice(i, i + CHUNK), userId);
            r.created += c.created;
            r.updated += c.updated;
          }
          r.unchanged = Math.max(0, r.valid - r.duplicates - r.created - r.updated);
        }
        out.push(r);
      }
      return out;
    });

    const durationMs = Date.now() - startedAt.getTime();
    const log = await writeLog({ mode, stockTypes, userId, startedAt, status: 'SUCCESS', stats: { results, durationMs } });
    return { logId: log.id, mode, durationMs, results };
  } catch (err) {
    await writeLog({ mode, stockTypes, userId, startedAt, status: 'FAILED', error: err.message }).catch(() => {});
    throw err;
  } finally {
    running = false;
  }
}

const writeLog = async ({ mode, stockTypes, userId, startedAt, status, stats = null, error = null }) => {
  const { rows } = await query(
    `INSERT INTO inventory_sync_logs (mode, stock_types, status, stats, error, started_by, started_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW()) RETURNING id`,
    [mode, stockTypes, status, stats, error, userId, startedAt]
  );
  return rows[0];
};
