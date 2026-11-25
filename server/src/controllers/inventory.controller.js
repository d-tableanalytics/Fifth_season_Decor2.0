import { query } from '../config/db.js';
import { GOOGLE_SHEET_ID, INVENTORY_TABS } from '../config/sheets.js';
import { inventoryItemSchema, inventoryListQuery, syncSchema } from '../validators/inventory.js';
import { syncInventory } from '../services/inventorySync.js';
import { can } from '../services/access.js';
import { forbidden, notFound } from '../utils/httpError.js';
import { withImageViewUrls, deleteRefQuietly, isS3Ref } from '../config/s3.js';

const COLUMNS = `id, stock_type, item_name, rack_no, quantity::float AS quantity, unit, catalogue_name, image_url,
  hsn_code, lot_no, price::float AS price, source, last_synced_at, created_at, updated_at`;

const findItem = async (id) => {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Item not found');
  const { rows } = await query(`SELECT ${COLUMNS} FROM inventory_stock WHERE id = $1`, [id]);
  if (!rows[0]) throw notFound('Item not found');
  return (await withImageViewUrls(rows))[0];
};

/** Remove the old uploaded S3 image if it is no longer used by any item. */
const cleanupImage = async (oldRef, newRef) => {
  if (!isS3Ref(oldRef) || oldRef === newRef) return;
  const { rowCount } = await query('SELECT 1 FROM inventory_stock WHERE image_url = $1 LIMIT 1', [oldRef]);
  if (!rowCount) await deleteRefQuietly(oldRef);
};

export const listInventory = async (req, res) => {
  const q = inventoryListQuery.parse(req.query);
  const where = [];
  const params = [];
  const add = (v) => {
    params.push(v);
    return `$${params.length}`;
  };

  if (q.stock_type) where.push(`stock_type = ${add(q.stock_type)}`);
  if (q.catalogue) where.push(q.catalogue === '__none__' ? 'catalogue_name IS NULL' : `catalogue_name = ${add(q.catalogue)}`);
  if (q.stock === 'in') where.push('quantity > 0');
  if (q.stock === 'zero') where.push('quantity = 0');
  if (q.stock === 'negative') where.push('quantity < 0');
  if (q.image === 'with') where.push('image_url IS NOT NULL');
  if (q.image === 'without') where.push('image_url IS NULL');
  // Every word must match item, catalogue, rack or lot
  for (const word of (q.search || '').split(/\s+/).filter(Boolean).slice(0, 6)) {
    const p = add(`%${word.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(item_name ILIKE ${p} OR catalogue_name ILIKE ${p} OR rack_no ILIKE ${p} OR lot_no ILIKE ${p})`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  // sort/order are whitelisted by the zod enum, so interpolation is safe
  const { rows } = await query(
    `SELECT ${COLUMNS}, COUNT(*) OVER()::int AS total_count
       FROM inventory_stock ${whereSql}
      ORDER BY ${q.sort} ${q.order} NULLS LAST, id
      LIMIT ${add(q.limit)} OFFSET ${add((q.page - 1) * q.limit)}`,
    params
  );

  res.json({
    data: await withImageViewUrls(rows.map(({ total_count, ...r }) => r)),
    total: rows[0]?.total_count ?? 0,
    page: q.page,
    limit: q.limit,
  });
};

export const inventorySummary = async (req, res) => {
  const [{ rows: types }, { rows: lastSync }] = await Promise.all([
    query(
      `SELECT stock_type,
              COUNT(*)::int AS items,
              COALESCE(SUM(quantity) FILTER (WHERE quantity > 0), 0)::float AS total_qty,
              COUNT(*) FILTER (WHERE quantity < 0)::int AS negative,
              COUNT(*) FILTER (WHERE quantity = 0)::int AS zero,
              COUNT(*) FILTER (WHERE image_url IS NOT NULL)::int AS with_image
         FROM inventory_stock GROUP BY stock_type`
    ),
    query(
      `SELECT l.id, l.mode, l.stock_types, l.status, l.finished_at, l.stats->'durationMs' AS duration_ms, u.name AS started_by
         FROM inventory_sync_logs l LEFT JOIN users u ON u.id = l.started_by
        WHERE l.status = 'SUCCESS' ORDER BY l.finished_at DESC LIMIT 1`
    ),
  ]);
  res.json({
    data: {
      byType: Object.fromEntries(Object.keys(INVENTORY_TABS).map((t) => [t, types.find((r) => r.stock_type === t) || { stock_type: t, items: 0, total_qty: 0, negative: 0, zero: 0, with_image: 0 }])),
      lastSync: lastSync[0] || null,
      sheet: { id: GOOGLE_SHEET_ID, url: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`, tabs: INVENTORY_TABS },
    },
  });
};

export const listCatalogues = async (req, res) => {
  const type = Object.keys(INVENTORY_TABS).includes(req.query.stock_type) ? req.query.stock_type : null;
  const { rows } = await query(
    `SELECT catalogue_name AS name, COUNT(*)::int AS items FROM inventory_stock
      WHERE catalogue_name IS NOT NULL ${type ? 'AND stock_type = $1' : ''}
      GROUP BY catalogue_name ORDER BY catalogue_name`,
    type ? [type] : []
  );
  res.json({ data: rows });
};

export const getItem = async (req, res) => res.json({ data: await findItem(req.params.id) });

export const createItem = async (req, res) => {
  const b = inventoryItemSchema.parse(req.body);
  const { rows } = await query(
    `INSERT INTO inventory_stock (stock_type, item_name, rack_no, quantity, unit, catalogue_name, image_url, hsn_code, lot_no, price, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
    [b.stock_type, b.item_name, b.rack_no, b.quantity, b.unit, b.catalogue_name, b.image_url, b.hsn_code, b.lot_no, b.price, req.user.id]
  );
  res.status(201).json({ data: await findItem(rows[0].id) });
};

export const updateItem = async (req, res) => {
  const item = await findItem(req.params.id);
  const b = inventoryItemSchema.parse(req.body);
  await query(
    `UPDATE inventory_stock SET stock_type=$1, item_name=$2, rack_no=$3, quantity=$4, unit=$5, catalogue_name=$6,
            image_url=$7, hsn_code=$8, lot_no=$9, price=$10, updated_by=$11, updated_at=NOW()
      WHERE id = $12`,
    [b.stock_type, b.item_name, b.rack_no, b.quantity, b.unit, b.catalogue_name, b.image_url, b.hsn_code, b.lot_no, b.price, req.user.id, item.id]
  );
  await cleanupImage(item.image_url, b.image_url);
  res.json({ data: await findItem(item.id) });
};

export const deleteItem = async (req, res) => {
  const item = await findItem(req.params.id);
  await query('DELETE FROM inventory_stock WHERE id = $1', [item.id]);
  await cleanupImage(item.image_url, null);
  res.json({ message: 'Item deleted' });
};

export const runSync = async (req, res) => {
  const { stock_types, mode } = syncSchema.parse(req.body);
  // Full sync creates and updates rows; price-only only updates
  if (mode === 'full' && !can(req.user, 'inventory', 'create')) throw forbidden('Full sync needs Create and Edit permission on Inventory');
  res.json({ data: await syncInventory({ stockTypes: stock_types, mode, userId: req.user.id }) });
};

export const syncLogs = async (req, res) => {
  const { rows } = await query(
    `SELECT l.id, l.mode, l.stock_types, l.status, l.stats, l.error, l.started_at, l.finished_at, u.name AS started_by
       FROM inventory_sync_logs l LEFT JOIN users u ON u.id = l.started_by
      ORDER BY l.started_at DESC LIMIT 15`
  );
  res.json({ data: rows });
};
