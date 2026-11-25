import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, RefreshCw, RotateCcw, Pencil, Trash2, Truck, MapPinned, Users, CheckCircle2, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown, Eye } from 'lucide-react';
import { transportsApi, OPTIONS, optionLabel } from '../../api/masters';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { ConfirmDialog } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/FormControls';
import { MasterSyncModal } from '../../components/forms/MasterSyncModal';

const EMPTY_FILTERS = { search: '', transport_type: '', status: '' };
const dateFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const SYNC_COLUMNS = {
  transports: [
    { key: 'created', label: 'New transports', tone: 'success' },
    { key: 'updated', label: 'Updated', tone: 'info', hint: 'Blank fields filled and/or destinations added' },
    { key: 'unchanged', label: 'Unchanged' },
    { key: 'destinationsAdded', label: 'Destinations added', tone: 'success' },
    { key: 'ambiguousNames', label: 'Same name twice in ERP', tone: 'warning', hint: 'Matched to the lowest TRN id' },
  ],
};

export default function Transports() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const perms = { create: can('transport_master', 'create'), edit: can('transport_master', 'edit'), delete: can('transport_master', 'delete') };

  const [summary, setSummary] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ by: 'transport_id', order: 'asc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const search = useDebounce(filters.search);
  const [result, setResult] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadSummary = useCallback(() => transportsApi.summary().then(setSummary).catch(() => {}), []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(
        await transportsApi.list({
          page, limit, sort: sort.by, order: sort.order, search: search || undefined,
          transport_type: filters.transport_type || undefined, status: filters.status || undefined,
        })
      );
    } catch (err) {
      toast.error('Could not load transports', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, limit, sort, search, filters.transport_type, filters.status, toast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const setFilter = (key) => (e) => {
    setFilters((f) => ({ ...f, [key]: e.target.value }));
    setPage(1);
  };
  const hasFilters = Object.values(filters).some(Boolean);
  const toggleSort = (by) => {
    setSort((s) => (s.by === by ? { by, order: s.order === 'asc' ? 'desc' : 'asc' } : { by, order: by === 'clients' || by === 'updated_at' ? 'desc' : 'asc' }));
    setPage(1);
  };

  const remove = async () => {
    setBusy(true);
    try {
      await transportsApi.remove(toDelete.id);
      toast.success('Transport deleted', toDelete.transport_name);
      setToDelete(null);
      load();
      loadSummary();
    } catch (err) {
      toast.error('Could not delete transport', getErrorMessage(err));
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

  const tiles = [
    { label: 'Transports', value: summary?.total, icon: Truck },
    { label: 'Active', value: summary?.active, icon: CheckCircle2 },
    { label: 'Used by clients', value: summary?.in_use, icon: Users },
    { label: 'Destinations', value: summary?.destinations, icon: MapPinned },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Transport Master</h2>
          <p className="page-header__sub">
            {summary?.lastSync ? <>Last synced {dateFmt(summary.lastSync.finished_at)}{summary.lastSync.started_by && <> by {summary.lastSync.started_by}</>} · </> : 'Not synced yet · '}
            {summary?.sheet && (
              <a className="inline-link" href={summary.sheet.url} target="_blank" rel="noreferrer noopener">
                Open Google Sheet <ExternalLink size={12} />
              </a>
            )}
          </p>
        </div>
        <div className="page-header__actions">
          {perms.edit && perms.create && (
            <Button variant="secondary" icon={RefreshCw} onClick={() => setSyncOpen(true)}>
              Sync Google Sheet
            </Button>
          )}
          {perms.create && (
            <Button icon={Plus} onClick={() => navigate('/transport-master/new')}>
              Add Transport
            </Button>
          )}
        </div>
      </div>

      <div className="stock-tiles">
        {tiles.map(({ label, value, icon: Icon }) => (
          <div key={label} className="stock-tile stock-tile--static">
            <span className="stock-tile__icon"><Icon size={17} /></span>
            <span className="stock-tile__body">
              <span className="stock-tile__label">{label}</span>
              {value == null ? <Skeleton width={60} height={20} /> : <span className="stock-tile__value">{value.toLocaleString('en-IN')}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search TRN id, name, contact, city, destination…" value={filters.search} onChange={setFilter('search')} />
          </label>
          <select className="toolbar__select" value={filters.transport_type} onChange={setFilter('transport_type')} aria-label="Type">
            <option value="">All types</option>
            <option value="__none__">— Not set —</option>
            {OPTIONS.transport_type.map((o) => (
              <option key={o} value={o}>{optionLabel(o)}</option>
            ))}
          </select>
          <select className="toolbar__select" value={filters.status} onChange={setFilter('status')} aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          {hasFilters && (
            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => { setFilters(EMPTY_FILTERS); setPage(1); }}>
              Reset
            </Button>
          )}
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table table--clickable">
            <thead>
              <tr>
                <SortHead by="transport_id">TRN ID</SortHead>
                <SortHead by="transport_name">Transport</SortHead>
                <th>Contact</th>
                <SortHead by="transport_city">Based at</SortHead>
                <th>Type</th>
                <th className="num">Destinations</th>
                <SortHead by="clients" className="num">Clients</SortHead>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j}><Skeleton width={j === 1 ? 180 : 70} /></td>
                      ))}
                    </tr>
                  ))
                : result.data.map((t) => (
                    <tr key={t.id} className={t.is_active ? '' : 'is-muted'} onClick={() => navigate(`/transport-master/${t.id}`)}>
                      <td className="mono">{t.transport_id}</td>
                      <td className="cell-wrap">
                        <p className="cell-main">{t.transport_name}</p>
                        <p className="cell-sub">{t.gstin || '—'}</p>
                      </td>
                      <td>
                        <p>{t.transport_contact_person || '—'}</p>
                        <p className="cell-sub">{t.transport_contact_number || ''}</p>
                      </td>
                      <td>
                        <p>{t.transport_city || '—'}</p>
                        <p className="cell-sub">{t.transport_state || ''}</p>
                      </td>
                      <td>{t.transport_type ? <Badge size="sm" variant="info">{optionLabel(t.transport_type)}</Badge> : <span className="cell-sub">—</span>}</td>
                      <td className="num">{t.destination_count || '—'}</td>
                      <td className="num">{t.client_count ? <Badge size="sm" variant="brand">{t.client_count}</Badge> : <span className="cell-sub">0</span>}</td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <button className="icon-btn icon-btn--sm" title={perms.edit ? 'Edit' : 'View'} onClick={() => navigate(`/transport-master/${t.id}`)}>
                            {perms.edit ? <Pencil size={15} /> : <Eye size={15} />}
                          </button>
                          {perms.delete && (
                            <button
                              className="icon-btn icon-btn--sm icon-btn--danger"
                              title={t.client_count ? `Used by ${t.client_count} clients` : 'Delete'}
                              disabled={t.client_count > 0}
                              onClick={() => setToDelete(t)}
                            >
                              <Trash2 size={15} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><Truck size={22} /></span>
              <h2>{hasFilters ? 'No matching transports' : 'No transports yet'}</h2>
              <p>{hasFilters ? 'Try a different search or filter.' : 'Add a transport or sync from Google Sheet.'}</p>
            </div>
          )}
        </div>

        {result.total > 0 && (
          <div className="pagination-row">
            <Pagination page={page} limit={limit} total={result.total} onPage={setPage} />
            <select className="toolbar__select toolbar__select--sm" value={limit} onChange={(e) => { setLimit(Number(e.target.value)); setPage(1); }} aria-label="Rows per page">
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>{n} / page</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <MasterSyncModal
        open={syncOpen}
        title="Sync transports with Google Sheet"
        sheetUrl={summary?.sheet?.url}
        tabs={[{ key: 'transports', label: 'Transport Master', tabName: summary?.sheet?.tab, description: 'Rows are grouped by transport name. New names get the next TRN ID; existing transports get blank fields filled and new destinations added.' }]}
        columns={SYNC_COLUMNS}
        notes="Existing transport details are never overwritten — only blank fields are filled."
        run={() => transportsApi.sync()}
        loadLogs={transportsApi.syncLogs}
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
        title="Delete transport?"
        message={`"${toDelete?.transport_name}" (${toDelete?.transport_id}) will be permanently removed.`}
      />
    </div>
  );
}
