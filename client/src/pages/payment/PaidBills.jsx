import { useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw, RotateCcw, ReceiptIndianRupee, CheckCircle2, AlertTriangle, Users, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/FormControls';
import { MasterSyncModal } from '../../components/forms/MasterSyncModal';

const paidApi = {
  list: (params) => api.get('/paid-bills', { params }).then((r) => r.data),
  summary: () => api.get('/paid-bills/summary').then((r) => r.data.data),
  sync: () => api.post('/paid-bills/sync', {}, { timeout: 300_000 }).then((r) => r.data.data),
  syncLogs: () => api.get('/paid-bills/sync/logs').then((r) => r.data.data),
};

const STATUSES = [
  { key: '', label: 'Any status' },
  { key: 'on_time', label: 'Paid on time / early' },
  { key: 'late', label: 'Paid late' },
  { key: 'late_30', label: 'Late 30+ days' },
];
const SYNC_COLUMNS = {
  paidBills: [
    { key: 'imported', label: 'Paid bills loaded', tone: 'success' },
    { key: 'replaced', label: 'Old list cleared' },
    { key: 'invalidValues', label: 'Unreadable values', tone: 'warning', hint: 'Saved as blank' },
  ],
};

const inr = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const dateFmt = (d) => (d ? new Date(`${String(d).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');

/** Paid / late badge for "Days Early(-)/Late(+)" */
export function PaidLateBadge({ days }) {
  if (days == null) return <span className="cell-sub">—</span>;
  if (days <= 0) return <Badge size="sm" variant="success">{days < 0 ? `${-days} days early` : 'On due date'}</Badge>;
  return <Badge size="sm" variant={days > 30 ? 'danger' : 'warning'}>{days} days late</Badge>;
}

/** Payment › Paid Bills: bills already paid, from Tally ("Combined Data" sheet). */
export default function PaidBills() {
  const { can } = useAuth();
  const toast = useToast();
  const canSync = can('paid_bills', 'edit');

  const [summary, setSummary] = useState(null);
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState({ by: 'receipt_date', order: 'desc' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);

  const loadSummary = useCallback(() => paidApi.summary().then(setSummary).catch(() => {}), []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await paidApi.list({ page, limit: 25, sort: sort.by, order: sort.order, search: search || undefined, status: status || undefined }));
    } catch (err) {
      toast.error('Could not load paid bills', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, sort, search, status, toast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const reset = () => {
    setSearchText('');
    setStatus('');
    setPage(1);
  };
  const hasFilters = searchText || status;
  const toggleSort = (by) => {
    setSort((s) => (s.by === by ? { by, order: s.order === 'asc' ? 'desc' : 'asc' } : { by, order: by === 'party' ? 'asc' : 'desc' }));
    setPage(1);
  };
  const SortHead = ({ by, children, className = '' }) => (
    <th className={`th-sort ${className} ${sort.by === by ? 'is-sorted' : ''}`}>
      <button type="button" onClick={() => toggleSort(by)}>
        {children}
        {sort.by === by ? sort.order === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} /> : <ArrowUpDown size={12} />}
      </button>
    </th>
  );

  const onTimePct = summary?.bills ? Math.round((summary.on_time / summary.bills) * 100) : null;
  const tiles = [
    { label: 'Paid bills', value: summary && summary.bills.toLocaleString('en-IN'), sub: summary && `${summary.parties} parties`, icon: ReceiptIndianRupee },
    { label: 'Paid on time', value: summary && (onTimePct == null ? '—' : `${onTimePct}%`), sub: summary && `${summary.on_time.toLocaleString('en-IN')} bills on / before due date`, icon: CheckCircle2 },
    { label: 'Late 30+ days', value: summary && summary.late_30.toLocaleString('en-IN'), sub: summary && `avg ${summary.avg_late_days ?? 0} days late when late`, icon: AlertTriangle },
    { label: 'Receipts', value: summary && (summary.last_receipt ? dateFmt(summary.last_receipt) : '—'), sub: summary?.first_receipt ? `from ${dateFmt(summary.first_receipt)}` : 'Latest receipt', icon: Users },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Paid Bills</h2>
          <p className="page-header__sub">
            {summary?.lastSync ? <>Last synced {stamp(summary.lastSync.finished_at)}{summary.lastSync.started_by && <> by {summary.lastSync.started_by}</>} · </> : 'Not synced yet · '}
            {summary?.sheet && (
              <a className="inline-link" href={summary.sheet.url} target="_blank" rel="noreferrer noopener">
                Open Google Sheet <ExternalLink size={12} />
              </a>
            )}
          </p>
        </div>
        {canSync && (
          <Button variant="secondary" icon={RefreshCw} onClick={() => setSyncOpen(true)}>
            Sync Google Sheet
          </Button>
        )}
      </div>

      <div className="stock-tiles">
        {tiles.map(({ label, value, sub, icon: Icon }) => (
          <div key={label} className="stock-tile stock-tile--static">
            <span className="stock-tile__icon"><Icon size={17} /></span>
            <span className="stock-tile__body">
              <span className="stock-tile__label">{label}</span>
              {value == null ? <Skeleton width={80} height={20} /> : <span className="stock-tile__value">{value}</span>}
              {sub && <span className="stock-tile__sub">{sub}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search party or bill reference…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
          </label>
          <select className="toolbar__select" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} aria-label="Status">
            {STATUSES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          {hasFilters && <Button variant="ghost" size="sm" icon={RotateCcw} onClick={reset}>Reset</Button>}
          {!loading && (
            <div className="toolbar__end">
              <Badge variant="neutral">{result.total.toLocaleString('en-IN')} bills</Badge>
            </div>
          )}
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead>
              <tr>
                <SortHead by="receipt_date">Receipt Date</SortHead>
                <SortHead by="party">Party</SortHead>
                <th>Bill Ref No</th>
                <SortHead by="bill_date">Bill Date</SortHead>
                <th className="num">Credit Days</th>
                <SortHead by="due_date">Due Date</SortHead>
                <SortHead by="days_late" className="num">Early / Late</SortHead>
                <SortHead by="receipt_total" className="num">Receipt Total</SortHead>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 8 }).map((__, j) => <td key={j}><Skeleton width={j === 1 ? 200 : 80} /></td>)}
                    </tr>
                  ))
                : result.data.map((b) => (
                    <tr key={b.id}>
                      <td>{dateFmt(b.receipt_date)}</td>
                      <td className="cell-wrap cell-main">{b.party || '—'}</td>
                      <td className="mono">{b.bill_reference || '—'}</td>
                      <td>{dateFmt(b.bill_date)}</td>
                      <td className="num">{b.credit_days ?? '—'}</td>
                      <td>{dateFmt(b.due_date)}</td>
                      <td className="num"><PaidLateBadge days={b.days_late} /></td>
                      <td className="num">{inr(b.receipt_total)}</td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><ReceiptIndianRupee size={22} /></span>
              <h2>{hasFilters ? 'No matching bills' : 'No paid bills yet'}</h2>
              <p>{hasFilters ? 'Try a different search or filter.' : canSync ? 'Click “Sync Google Sheet” to load paid bills.' : 'Paid bills appear here once they are synced.'}</p>
            </div>
          )}
        </div>
        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      </div>

      <MasterSyncModal
        open={syncOpen}
        title="Sync Paid Bills"
        sheetUrl={summary?.sheet?.url}
        tabs={[{ key: 'paidBills', label: 'Paid Bills (Tally)', tabName: summary?.sheet?.tab, description: 'Full replace: the current list is cleared and reloaded from the sheet. If anything fails, the old list stays.' }]}
        columns={SYNC_COLUMNS}
        run={() => paidApi.sync()}
        loadLogs={paidApi.syncLogs}
        onClose={() => setSyncOpen(false)}
        onSynced={() => {
          load();
          loadSummary();
        }}
      />
    </div>
  );
}
