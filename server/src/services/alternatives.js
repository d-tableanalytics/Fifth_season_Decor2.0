import { withTransaction } from '../config/db.js';
import { GOOGLE_SHEET_ID, MASTER_TABS } from '../config/sheets.js';
import { fetchSheetTab } from './googleSheet.js';
import { runLogged } from './masterSync.js';

/** Alternative-item tabs. Column A = order item, column B = its alternative (one pair per row). */
export const ALT_SOURCES = { COLOR: { key: 'alt_color', label: 'Alternative color', tab: MASTER_TABS.altColor } };
export const ALT_LOG_MODULE = 'alternatives';

const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);

/** Full replace of every alternative type from its sheet tab; if anything fails the old list stays. */
export const syncAlternatives = (userId) =>
  runLogged(ALT_LOG_MODULE, Object.values(ALT_SOURCES).map((s) => s.key), userId, async () => {
    const results = [];
    for (const [type, src] of Object.entries(ALT_SOURCES)) {
      const { rows } = await fetchSheetTab(GOOGLE_SHEET_ID, src.tab);
      const pairs = [];
      let incomplete = 0;
      rows.forEach((r, i) => {
        const item = clean(r[0]);
        const alt = clean(r[1]);
        if (!item && !alt) return;
        if (!item || !alt) return void incomplete++;
        pairs.push({ item, alt, row: i + 2 });
      });

      results.push(
        await withTransaction(async (db) => {
          const { rows: before } = await db.query('SELECT COUNT(*)::int AS n FROM item_alternatives WHERE alt_type = $1', [type]);
          await db.query('DELETE FROM item_alternatives WHERE alt_type = $1', [type]);
          // Same item on both sides and repeated pairs are skipped
          const { rowCount } = await db.query(
            `INSERT INTO item_alternatives (alt_type, item_name, alt_name, row_no)
             SELECT $1, x.item, x.alt, x.row FROM unnest($2::text[], $3::text[], $4::int[]) AS x(item, alt, row)
              WHERE inv_base(x.item) <> inv_base(x.alt)
             ON CONFLICT (alt_type, item_base, alt_base) DO NOTHING`,
            [type, pairs.map((p) => p.item), pairs.map((p) => p.alt), pairs.map((p) => p.row)]
          );
          const { rows: missing } = await db.query(
            `SELECT COUNT(DISTINCT a.alt_base)::int AS n FROM item_alternatives a
              WHERE a.alt_type = $1 AND NOT EXISTS (SELECT 1 FROM inventory_stock s WHERE inv_base(s.item_name) = a.alt_base)`,
            [type]
          );
          return {
            key: src.key,
            tab: src.tab,
            sheetRows: pairs.length + incomplete,
            replaced: before[0].n,
            imported: rowCount,
            incomplete,
            skipped: pairs.length - rowCount,
            notInInventory: missing[0].n,
          };
        })
      );
    }
    return results;
  });
