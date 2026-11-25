import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus, Search, RefreshCw, RotateCcw, Pencil, Trash2, Boxes, Scissors, Cylinder, ScanSearch,
  LayoutList, LayoutGrid, ArrowUp, ArrowDown, ArrowUpDown, ExternalLink,
} from 'lucide-react';
import { inventoryApi, STOCK_LABEL } from '../../api/inventory';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/FormControls';
import { ImageThumb } from '../../components/ui/ImageThumb';
import { Lightbox } from '../../components/ui/Lightbox';
import { InventoryFormModal } from './InventoryFormModal';
import { SyncModal } from './SyncModal';

const VIEW_KEY = 'fsd_inventory_view';
const TYPE_TABS = [
  { key: '', label: 'All Stock', icon: Boxes },
  { key: 'CUT', label: 'Cut Stock', icon: Scissors },
  { key: 'ROLL', label: 'Roll Stock', icon: Cylinder },
  { key: 'IN_CHECKING', label: 'In Checking', icon: ScanSearch },
];
const TYPE_BADGE = { CUT: 'brand', ROLL: 'info', IN_CHECKING: 'warning' };
const EMPTY_FILTERS = { search: '', catalogue: '', stock: '', image: '' };

const qtyFmt = (v) => Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const priceFmt = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const compact = (v) => (v >= 1e5 ? `${(v / 1e5).toFixed(1)}L` : v >= 1e3 ? `${(v / 1e3).toFixed(1)}K` : qtyFmt(v));
const dateFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

const readView = () => {
  try {
    return localStorage.getItem(VIEW_KEY) === 'grid' ? 'grid' : 'table';
  } catch {
    return 'table';
  }
};

export default function Inventory() {
  const { can } = useAuth();
  const toast = useToast();
  const perms = { create: can('inventory', 'create'), edit: can('inventory', 'edit'), delete: can('inventory', 'delete') };

  const [summary, setSummary] = useState(null);
  const [catalogues, setCatalogues] = useState([]);
  const [type, setType] = useState('');
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ by: 'item_name', order: 'asc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [view, setView] = useState(readView);
  const search = useDebounce(filters.search);

  const [result, setResult] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ open: false, item: null });
  const [syncOpen, setSyncOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null); // index into imageItems

  const loadSummary = useCallback(() => inventoryApi.summary().then(setSummary).catch(() => {}), []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(
        await inventoryApi.list({
          page,
          limit,
          stock_type: type || undefined,
          search: search || undefined,
          catalogue: filters.catalogue || undefined,
          stock: filters.stock || undefined,
          image: filters.image || undefined,
          sort: sort.by,
          order: sort.order,
        })
      );
    } catch (err) {
      toast.error('Could not load inventory', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, limit, type, search, filters.catalogue, filters.stock, filters.image, sort, toast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);
  useEffect(() => {
    inventoryApi.catalogues(type || undefined).then(setCatalogues).catch(() => setCatalogues([]));
  }, [type, summary?.lastSync?.id]);

  const resetPage = () => setPage(1);
  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    resetPage();
  };
  const hasFilters = Object.values(filters).some(Boolean);
  const changeType = (key) => {
    setType(key);
    setFilters((f) => ({ ...f, catalogue: '' }));
    resetPage();
  };
  const changeView = (v) => {
    setView(v);
    try {
      localStorage.setItem(VIEW_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const toggleSort = (by) => {
    // Same column flips direction; a new column starts asc for text, desc for numbers/dates
    const numeric = ['quantity', 'price', 'updated_at'].includes(by);
    setSort((s) => (s.by === by ? { by, order: s.order === 'asc' ? 'desc' : 'asc' } : { by, order: numeric ? 'desc' : 'asc' }));
    resetPage();
  };

  // Lightbox works over the items on the current page that have an image
  const imageItems = useMemo(() => result.data.filter((i) => i.image_url), [result.data]);
  const openPreview = (item) => setPreview(imageItems.findIndex((i) => i.id === item.id));
  const lightboxItems = useMemo(
    () =>
      imageItems.map((i) => ({
        url: i.image_view_url || i.image_url,
        title: i.item_name,
        subtitle: i.catalogue_name,
        details: [
          ['Type', STOCK_LABEL[i.stock_type]],
          ['Rack', i.rack_no || '—'],
          ['Lot', i.lot_no || '—'],
          ['Qty', `${qtyFmt(i.quantity)} ${i.unit}`],
          ['Price', priceFmt(i.price)],
        ],
      })),
    [imageItems]
  );

  const tiles = useMemo(() => {
    const t = summary?.byType;
    if (!t) return null;
    const all = Object.values(t).reduce((a, r) => ({ items: a.items + r.items, total_qty: a.total_qty + r.total_qty, with_image: a.with_image + r.with_image }), { items: 0, total_qty: 0, with_image: 0 });
    return { '': all, ...t };
  }, [summary]);

  const remove = async () => {
    setBusy(true);
    try {
      await inventoryApi.remove(toDelete.id);
      toast.success('Item deleted', toDelete.item_name);
      setToDelete(null);
      if (result.data.length === 1 && page > 1) setPage((p) => p - 1);
      load();
      loadSummary();
    } catch (err) {
      toast.error('Could not delete item', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const SortHead = ({ by, children, className = '' }) => (
    <th className={`th-sort ${className} ${sort.by === by ? 'is-sorted' : ''}`}>
      <button type="button" onClick={() => toggleSort(by)}>
        {children}
        {sort.by === by ? sort.order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} />}
      </button>
    </th>
  );

  const actionsCell = (item) =>
    (perms.edit || perms.delete) && (
      <div className="row-actions">
        {perms.edit && (
          <button className="icon-btn icon-btn--sm" title="Edit" onClick={() => setForm({ open: true, item })}>
            <Pencil size={15} />
          </button>
        )}
        {perms.delete && (
          <button className="icon-btn icon-btn--sm icon-btn--danger" title="Delete" onClick={() => setToDelete(item)}>
            <Trash2 size={15} />
          </button>
        )}
      </div>
    );

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Inventory Stock</h2>
          <p className="page-header__sub">
            {summary?.lastSync ? (
              <>
                Last synced {dateFmt(summary.lastSync.finished_at)}
                {summary.lastSync.started_by && <> by {summary.lastSync.started_by}</>} ·{' '}
              </>
            ) : (
              'Not synced yet · '
            )}
            {summary?.sheet && (
              <a className="inline-link" href={summary.sheet.url} target="_blank" rel="noreferrer noopener">
                Open Google Sheet <ExternalLink size={12} />
              </a>
            )}
          </p>
        </div>
        <div className="page-header__actions">
          {perms.edit && (
            <Button variant="secondary" icon={RefreshCw} onClick={() => setSyncOpen(true)}>
              Sync Google Sheet
            </Button>
          )}
          {perms.create && (
            <Button icon={Plus} onClick={() => setForm({ open: true, item: null })}>
              Add Item
            </Button>
          )}
        </div>
      </div>

      <div className="stock-tiles" role="tablist" aria-label="Stock type">
        {TYPE_TABS.map(({ key, label, icon: Icon }) => {
          const t = tiles?.[key];
          return (
            <button key={key || 'all'} role="tab" aria-selected={type === key} className={`stock-tile ${type === key ? 'is-active' : ''}`} onClick={() => changeType(key)}>
              <span className="stock-tile__icon">
                <Icon size={17} />
              </span>
              <span className="stock-tile__body">
                <span className="stock-tile__label">{label}</span>
                {t ? (
                  <>
                    <span className="stock-tile__value">{t.items.toLocaleString('en-IN')}</span>
                    <span className="stock-tile__sub">
                      {compact(t.total_qty)} mtr · {t.with_image.toLocaleString('en-IN')} with image
                    </span>
                  </>
                ) : (
                  <Skeleton width={70} height={20} />
                )}
              </span>
            </button>
          );
        })}
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search item, catalogue, rack or lot…" value={filters.search} onChange={setFilter('search')} />
          </label>
          <select className="toolbar__select toolbar__select--wide" value={filters.catalogue} onChange={setFilter('catalogue')} aria-label="Catalogue">
            <option value="">All catalogues</option>
            <option value="__none__">— No catalogue —</option>
            {catalogues.map((c) => (
              <option key={c.name} value={c.name}>
                {c.name} ({c.items})
              </option>
            ))}
          </select>
          <select className="toolbar__select" value={filters.stock} onChange={setFilter('stock')} aria-label="Quantity">
            <option value="">Any quantity</option>
            <option value="in">In stock (&gt; 0)</option>
            <option value="zero">Zero</option>
            <option value="negative">Negative</option>
          </select>
          <select className="toolbar__select" value={filters.image} onChange={setFilter('image')} aria-label="Image">
            <option value="">Any image</option>
            <option value="with">With image</option>
            <option value="without">Without image</option>
          </select>
          {hasFilters && (
            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => { setFilters(EMPTY_FILTERS); resetPage(); }}>
              Reset
            </Button>
          )}
          <div className="view-toggle" role="group" aria-label="View">
            <button className={view === 'table' ? 'is-active' : ''} onClick={() => changeView('table')} title="Table view" aria-pressed={view === 'table'}>
              <LayoutList size={15} />
            </button>
            <button className={view === 'grid' ? 'is-active' : ''} onClick={() => changeView('grid')} title="Gallery view" aria-pressed={view === 'grid'}>
              <LayoutGrid size={15} />
            </button>
          </div>
        </div>

        {view === 'table' ? (
          <div className="table-wrap table-wrap--flush">
            <table className="table inv-table">
              <thead>
                <tr>
                  <th className="inv-table__img">Image</th>
                  <SortHead by="item_name">Item</SortHead>
                  {!type && <th>Type</th>}
                  <SortHead by="rack_no">Rack</SortHead>
                  <th>Lot</th>
                  <SortHead by="quantity" className="num">Qty</SortHead>
                  <SortHead by="price" className="num">Price</SortHead>
                  <th>HSN</th>
                  <SortHead by="updated_at">Updated</SortHead>
                  {(perms.edit || perms.delete) && <th className="num">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {loading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i}>
                        <td><Skeleton width={44} height={44} radius={8} /></td>
                        <td><Skeleton width={220} /><Skeleton width={120} height={10} /></td>
                        {!type && <td><Skeleton width={60} /></td>}
                        <td><Skeleton width={110} /></td>
                        <td><Skeleton width={50} /></td>
                        <td><Skeleton width={50} /></td>
                        <td><Skeleton width={50} /></td>
                        <td><Skeleton width={40} /></td>
                        <td><Skeleton width={90} /></td>
                        {(perms.edit || perms.delete) && <td />}
                      </tr>
                    ))
                  : result.data.map((i) => (
                      <tr key={i.id}>
                        <td className="inv-table__img">
                          <ImageThumb url={i.image_view_url || i.image_url} alt={i.item_name} size={44} onClick={i.image_url ? () => openPreview(i) : undefined} />
                        </td>
                        <td className="inv-table__item">
                          <p className="cell-main">{i.item_name}</p>
                          <p className="cell-sub">{i.catalogue_name || 'No catalogue'}</p>
                        </td>
                        {!type && (
                          <td>
                            <Badge size="sm" variant={TYPE_BADGE[i.stock_type]}>{STOCK_LABEL[i.stock_type]}</Badge>
                          </td>
                        )}
                        <td>{i.rack_no || '—'}</td>
                        <td className="mono">{i.lot_no || '—'}</td>
                        <td className={`num qty ${i.quantity < 0 ? 'qty--neg' : i.quantity === 0 ? 'qty--zero' : ''}`}>
                          {qtyFmt(i.quantity)} <small>{i.unit}</small>
                        </td>
                        <td className="num">{priceFmt(i.price)}</td>
                        <td>{i.hsn_code || '—'}</td>
                        <td className="cell-sub">{dateFmt(i.updated_at)}</td>
                        {(perms.edit || perms.delete) && <td className="num">{actionsCell(i)}</td>}
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="inv-grid">
            {loading
              ? Array.from({ length: 12 }).map((_, i) => (
                  <div key={i} className="inv-card">
                    <Skeleton width="100%" height={170} radius={10} />
                    <Skeleton width="80%" />
                    <Skeleton width="50%" height={10} />
                  </div>
                ))
              : result.data.map((i) => (
                  <div key={i.id} className="inv-card">
                    <div className="inv-card__media">
                      <ImageThumb url={i.image_view_url || i.image_url} alt={i.item_name} size="fill" width={480} onClick={i.image_url ? () => openPreview(i) : undefined} />
                      <Badge size="sm" variant={TYPE_BADGE[i.stock_type]}>{STOCK_LABEL[i.stock_type]}</Badge>
                    </div>
                    <div className="inv-card__body">
                      <p className="inv-card__title" title={i.item_name}>{i.item_name}</p>
                      <p className="cell-sub">{i.catalogue_name || 'No catalogue'}</p>
                      <div className="inv-card__meta">
                        <span title="Rack">{i.rack_no || '—'}</span>
                        <span className={`qty ${i.quantity < 0 ? 'qty--neg' : ''}`}>{qtyFmt(i.quantity)} {i.unit}</span>
                      </div>
                      <div className="inv-card__foot">
                        <strong>{priceFmt(i.price)}</strong>
                        {actionsCell(i)}
                      </div>
                    </div>
                  </div>
                ))}
          </div>
        )}

        {!loading && result.data.length === 0 && (
          <div className="empty empty--inline">
            <span className="empty__icon">
              <Boxes size={22} />
            </span>
            <h2>{hasFilters ? 'No matching items' : 'No stock yet'}</h2>
            <p>{hasFilters ? 'Try a different search or filter.' : perms.edit ? 'Click “Sync Google Sheet” to import stock.' : 'Stock will appear here once it is synced.'}</p>
          </div>
        )}

        {result.total > 0 && (
          <div className="pagination-row">
            <Pagination page={page} limit={limit} total={result.total} onPage={setPage} />
            <select className="toolbar__select toolbar__select--sm" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); resetPage(); }} aria-label="Rows per page">
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <InventoryFormModal
        open={form.open}
        item={form.item}
        defaultType={type}
        onClose={() => setForm({ open: false, item: null })}
        onSaved={() => {
          setForm({ open: false, item: null });
          load();
          loadSummary();
        }}
      />

      <SyncModal
        open={syncOpen}
        sheet={summary?.sheet}
        onClose={() => setSyncOpen(false)}
        onSynced={() => {
          load();
          loadSummary();
        }}
      />

      <ConfirmDialog
        open={!!toDelete}
        busy={busy}
        onClose={() => setToDelete(null)}
        onConfirm={remove}
        title="Delete stock item?"
        message={
          toDelete?.source === 'SHEET'
            ? `"${toDelete.item_name}" will be removed. Note: it will be created again on the next full sync if it is still in the Google Sheet.`
            : `"${toDelete?.item_name}" will be permanently removed.`
        }
      />

      {preview !== null && preview >= 0 && (
        <Lightbox items={lightboxItems} index={preview} onIndex={setPreview} onClose={() => setPreview(null)} />
      )}
    </div>
  );
}
