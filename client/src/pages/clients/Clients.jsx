import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus, Search, RefreshCw, RotateCcw, Pencil, Trash2, Users, UserCheck, Truck, Clock, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown, Eye,
} from 'lucide-react';
import { clientsApi, OPTIONS, optionLabel, CONFIRMATION_BADGE } from '../../api/masters';
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

const EMPTY_FILTERS = { search: '', state: '', zone: '', registration_type: '', client_confirmation: '', transport: '', status: '', skip_payment: '' };
const dateFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const inr = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN')}`);

const SYNC_TABS = (sheet) => [
  { key: 'clients', label: 'Client Master', tabName: sheet?.tabs?.clients, description: 'Adds new Client IDs. Existing clients are never overwritten.' },
  { key: 'priorities', label: 'Transport Priority', tabName: sheet?.tabs?.priorities, description: 'Adds new client ↔ transport priorities, linked by TRN ID.' },
];
const SYNC_COLUMNS = {
  clients: [
    { key: 'created', label: 'New clients', tone: 'success' },
    { key: 'skippedExisting', label: 'Already in ERP', hint: 'Existing Client IDs are not overwritten' },
    { key: 'creditFilled', label: 'Credit limit / days filled', tone: 'success', hint: 'Only blank values of existing clients' },
    { key: 'duplicates', label: 'Duplicate IDs in sheet' },
    { key: 'skippedBlank', label: 'Blank rows' },
  ],
  priorities: [
    { key: 'added', label: 'New priorities', tone: 'success' },
    { key: 'alreadyPresent', label: 'Already in ERP' },
    { key: 'unknownClient', label: 'Unknown client', tone: 'warning', hint: 'Client ID not found in Client Master' },
    { key: 'unlinkedTransport', label: 'TRN not found', tone: 'warning' },
  ],
};

export default function Clients() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const perms = { create: can('client_master', 'create'), edit: can('client_master', 'edit'), delete: can('client_master', 'delete') };

  const [summary, setSummary] = useState(null);
  const [filterOptions, setFilterOptions] = useState({ states: [], zones: [] });
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [sort, setSort] = useState({ by: 'company_name', order: 'asc' });
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const search = useDebounce(filters.search);
  const [result, setResult] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [busy, setBusy] = useState(false);

  const loadSummary = useCallback(() => {
    clientsApi.summary().then(setSummary).catch(() => {});
    clientsApi.filters().then(setFilterOptions).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit, sort: sort.by, order: sort.order, search: search || undefined };
      for (const k of ['state', 'zone', 'registration_type', 'client_confirmation', 'transport', 'status', 'skip_payment']) if (filters[k]) params[k] = filters[k];
      setResult(await clientsApi.list(params));
    } catch (err) {
      toast.error('Could not load clients', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, limit, sort, search, filters, toast]);

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
    setSort((s) => (s.by === by ? { by, order: s.order === 'asc' ? 'desc' : 'asc' } : { by, order: ['credit_limit', 'updated_at'].includes(by) ? 'desc' : 'asc' }));
    setPage(1);
  };
  const quick = (patch) => {
    setFilters({ ...EMPTY_FILTERS, ...patch });
    setPage(1);
  };

  const tiles = useMemo(
    () => [
      { key: 'all', label: 'All clients', value: summary?.total, icon: Users, active: !hasFilters, onClick: () => quick({}) },
      { key: 'active', label: 'Active', value: summary?.active, icon: UserCheck, active: filters.status === 'active' && Object.values(filters).filter(Boolean).length === 1, onClick: () => quick({ status: 'active' }) },
      { key: 'transport', label: 'With transport', value: summary?.with_transport, icon: Truck, active: filters.transport === 'with' && Object.values(filters).filter(Boolean).length === 1, onClick: () => quick({ transport: 'with' }) },
      { key: 'pending', label: 'Pending approval', value: summary?.pending, icon: Clock, active: filters.client_confirmation === 'PENDING_APPROVAL', onClick: () => quick({ client_confirmation: 'PENDING_APPROVAL' }) },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [summary, filters, hasFilters]
  );

  const remove = async () => {
    setBusy(true);
    try {
      await clientsApi.remove(toDelete.id);
      toast.success('Client deleted', toDelete.company_name);
      setToDelete(null);
      load();
      loadSummary();
    } catch (err) {
      toast.error('Could not delete client', getErrorMessage(err));
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

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Client Master</h2>
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
            <Button icon={Plus} onClick={() => navigate('/client-master/new')}>
              Add Client
            </Button>
          )}
        </div>
      </div>

      <div className="stock-tiles">
        {tiles.map(({ key, label, value, icon: Icon, active, onClick }) => (
          <button key={key} className={`stock-tile ${active ? 'is-active' : ''}`} onClick={onClick}>
            <span className="stock-tile__icon">
              <Icon size={17} />
            </span>
            <span className="stock-tile__body">
              <span className="stock-tile__label">{label}</span>
              {value == null ? <Skeleton width={60} height={20} /> : <span className="stock-tile__value">{value.toLocaleString('en-IN')}</span>}
            </span>
          </button>
        ))}
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search ID, company, city, GSTIN, owner, phone…" value={filters.search} onChange={setFilter('search')} />
          </label>
          <select className="toolbar__select" value={filters.state} onChange={setFilter('state')} aria-label="State">
            <option value="">All states</option>
            {filterOptions.states.map((s) => (
              <option key={s.name} value={s.name}>
                {s.name} ({s.n})
              </option>
            ))}
          </select>
          <select className="toolbar__select" value={filters.zone} onChange={setFilter('zone')} aria-label="Zone">
            <option value="">All zones</option>
            <option value="__none__">— No zone —</option>
            {filterOptions.zones.map((z) => (
              <option key={z.name} value={z.name}>
                {z.name} ({z.n})
              </option>
            ))}
          </select>
          <select className="toolbar__select" value={filters.registration_type} onChange={setFilter('registration_type')} aria-label="Registration type">
            <option value="">Any registration</option>
            {OPTIONS.registration_type.map((o) => (
              <option key={o} value={o}>{optionLabel(o)}</option>
            ))}
          </select>
          <select className="toolbar__select" value={filters.client_confirmation} onChange={setFilter('client_confirmation')} aria-label="Confirmation">
            <option value="">Any confirmation</option>
            {OPTIONS.client_confirmation.map((o) => (
              <option key={o} value={o}>{optionLabel(o)}</option>
            ))}
          </select>
          <select className="toolbar__select" value={filters.transport} onChange={setFilter('transport')} aria-label="Transport">
            <option value="">Any transport</option>
            <option value="with">With transport</option>
            <option value="without">Without transport</option>
            <option value="unlinked">TRN not found</option>
          </select>
          <select className="toolbar__select" value={filters.status} onChange={setFilter('status')} aria-label="Status">
            <option value="">Any status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <select className="toolbar__select" value={filters.skip_payment} onChange={setFilter('skip_payment')} aria-label="Payment check">
            <option value="">Any payment check</option>
            <option value="yes">Skip payment customers</option>
            <option value="no">Normal payment check</option>
          </select>
          {hasFilters && (
            <Button variant="ghost" size="sm" icon={RotateCcw} onClick={() => quick({})}>
              Reset
            </Button>
          )}
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table table--clickable">
            <thead>
              <tr>
                <SortHead by="client_id">Client</SortHead>
                <SortHead by="company_name">Company</SortHead>
                <SortHead by="city">Location</SortHead>
                <th>GSTIN</th>
                <th>Transports</th>
                <SortHead by="credit_limit" className="num">Credit</SortHead>
                <th>Status</th>
                <th className="num">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((__, j) => (
                        <td key={j}><Skeleton width={j === 1 ? 200 : 80} /></td>
                      ))}
                    </tr>
                  ))
                : result.data.map((c) => (
                    <tr key={c.id} className={c.is_active ? '' : 'is-muted'} onClick={() => navigate(`/client-master/${c.id}`)}>
                      <td>
                        <p className="mono">{c.client_id}</p>
                        <p className="cell-sub">{c.visit_no || '—'}</p>
                      </td>
                      <td className="cell-wrap">
                        <p className="cell-main">{c.company_name}</p>
                        <p className="cell-sub">
                          {[c.owner_name, c.owner_contact_no].filter(Boolean).join(' · ') || '—'}
                        </p>
                      </td>
                      <td>
                        <p>{c.city || '—'}</p>
                        <p className="cell-sub">
                          {c.state || ''}
                          {c.zone && <> · {c.zone}</>}
                        </p>
                      </td>
                      <td className="mono mono--plain">{c.gstin || '—'}</td>
                      <td>
                        {c.transports?.length ? (
                          <div className="chip-list">
                            {c.transports.map((t) => (
                              <span key={t.id} className="mini-chip" title={t.transport_id}>{t.transport_name}</span>
                            ))}
                            {c.priority_count > c.transports.length && <span className="cell-sub">{c.priority_count} rules</span>}
                          </div>
                        ) : (
                          <span className="cell-sub">{c.priority_count ? `${c.priority_count} rules, no transport` : 'None'}</span>
                        )}
                      </td>
                      <td className="num">
                        <p>{inr(c.credit_limit)}</p>
                        <p className="cell-sub">{c.credit_days != null ? `${c.credit_days} days` : ''}</p>
                      </td>
                      <td>
                        <Badge size="sm" variant={CONFIRMATION_BADGE[c.client_confirmation]}>{optionLabel(c.client_confirmation)}</Badge>
                        {c.skip_payment_check && <p><Badge size="sm" variant="warning">Skip payment</Badge></p>}
                        {!c.is_active && <p className="cell-sub">Inactive</p>}
                      </td>
                      <td className="num" onClick={(e) => e.stopPropagation()}>
                        <div className="row-actions">
                          <button className="icon-btn icon-btn--sm" title={perms.edit ? 'Edit' : 'View'} onClick={() => navigate(`/client-master/${c.id}`)}>
                            {perms.edit ? <Pencil size={15} /> : <Eye size={15} />}
                          </button>
                          {perms.delete && (
                            <button className="icon-btn icon-btn--sm icon-btn--danger" title="Delete" onClick={() => setToDelete(c)}>
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
              <span className="empty__icon"><Users size={22} /></span>
              <h2>{hasFilters ? 'No matching clients' : 'No clients yet'}</h2>
              <p>{hasFilters ? 'Try a different search or filter.' : 'Add a client or sync from Google Sheet.'}</p>
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
        title="Sync clients with Google Sheet"
        sheetUrl={summary?.sheet?.url}
        tabs={SYNC_TABS(summary?.sheet)}
        columns={SYNC_COLUMNS}
        run={clientsApi.sync}
        loadLogs={clientsApi.syncLogs}
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
        title="Delete client?"
        message={`"${toDelete?.company_name}" (${toDelete?.client_id}) and its transport priorities, referrals and products will be permanently removed. Consider marking the client inactive instead.`}
      />
    </div>
  );
}
