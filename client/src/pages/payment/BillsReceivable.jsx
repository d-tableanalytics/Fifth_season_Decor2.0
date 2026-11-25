import { useCallback, useEffect, useState } from 'react';
import { Search, RefreshCw, RotateCcw, ReceiptIndianRupee, Wallet, AlertTriangle, Users, ExternalLink, ArrowUp, ArrowDown, ArrowUpDown } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/FormControls';
import { MasterSyncModal } from '../../components/forms/MasterSyncModal';

const billsApi = {
  list: (params) => api.get('/bills-receivable', { params }).then((r) => r.data),
  summary: () => api.get('/bills-receivable/summary').then((r) => r.data.data),
  sync: () => api.post('/bills-receivable/sync', {}, { timeout: 300_000 }).then((r) => r.data.data),
  syncLogs: () => api.get('/bills-receivable/sync/logs').then((r) => r.data.data),
};

const AGES = [
  { key: '', label: 'Any age' },
  { key: 'not_due', label: 'Not due' },
  { key: '1_30', label: '1–30 days' },
  { key: '31_60', label: '31–60 days' },
  { key: '61_90', label: '61–90 days' },
  { key: '90_plus', label: '90+ days' },
];
const SYNC_COLUMNS = {
  bills: [
    { key: 'imported', label: 'Bills loaded', tone: 'success' },
    { key: 'replaced', label: 'Old snapshot cleared' },
    { key: 'invalidValues', label: 'Unreadable values', tone: 'warning', hint: 'Saved as blank' },
  ],
};

const inr = (v) => (v == null ? '—' : `₹${Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`);
const compactInr = (v) => {
  const a = Math.abs(v);
  const s = a >= 1e7 ? `${(a / 1e7).toFixed(2)} Cr` : a >= 1e5 ? `${(a / 1e5).toFixed(2)} L` : a.toLocaleString('en-IN', { maximumFractionDigits: 0 });
  return `${v < 0 ? '−' : ''}₹${s}`;
};
const dateFmt = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
const stamp = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const ageBadge = (days) => (days == null ? 'neutral' : days <= 0 ? 'success' : days <= 30 ? 'info' : days <= 90 ? 'warning' : 'danger');

export default function BillsReceivable() {
  const { can } = useAuth();
  const toast = useToast();
  const canSync = can('bills_receivable', 'edit');

  const [summary, setSummary] = useState(null);
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [age, setAge] = useState('');
  const [type, setType] = useState('');
  const [sort, setSort] = useState({ by: 'days_overdue', order: 'desc' });
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0, totalAmount: 0 });
  const [loading, setLoading] = useState(true);
  const [syncOpen, setSyncOpen] = useState(false);

  const loadSummary = useCallback(() => billsApi.summary().then(setSummary).catch(() => {}), []);
  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await billsApi.list({ page, limit: 25, sort: sort.by, order: sort.order, search: search || undefined, age: age || undefined, type: type || undefined }));
    } catch (err) {
      toast.error('Could not load bills', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, sort, search, age, type, toast]);

  useEffect(() => {
    load();
  }, [load]);
  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  const reset = () => {
    setSearchText('');
    setAge('');
    setType('');
    setPage(1);
  };
  const hasFilters = searchText || age || type;
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

  const tiles = [
    { label: 'Receivable', value: summary && compactInr(summary.receivable), sub: summary && `${summary.bills.toLocaleString('en-IN')} bills · ${summary.parties} parties`, icon: ReceiptIndianRupee },
    { label: 'Overdue', value: summary && compactInr(summary.overdue), sub: 'Past due date', icon: AlertTriangle },
    { label: 'Overdue 90+ days', value: summary && compactInr(summary.overdue_90), sub: 'Needs follow-up', icon: Users },
    { label: 'Advances / credits', value: summary && compactInr(summary.credits), sub: 'Positive balances', icon: Wallet },
  ];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Bills Receivable</h2>
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
          <select className="toolbar__select" value={age} onChange={(e) => { setAge(e.target.value); setPage(1); }} aria-label="Overdue age">
            {AGES.map((a) => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
          <select className="toolbar__select" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Type">
            <option value="">All amounts</option>
            <option value="receivable">Receivable (−, due from party)</option>
            <option value="credit">Advances / credits (+)</option>
          </select>
          {hasFilters && <Button variant="ghost" size="sm" icon={RotateCcw} onClick={reset}>Reset</Button>}
          {!loading && (
            <div className="toolbar__end">
              <Badge variant="neutral">{result.total.toLocaleString('en-IN')} bills · {inr(result.totalAmount)}</Badge>
            </div>
          )}
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead>
              <tr>
                <th>Bill Reference</th>
                <SortHead by="bill_date">Bill Date</SortHead>
                <SortHead by="due_date">Due Date</SortHead>
                <SortHead by="party">Party</SortHead>
                <SortHead by="amount" className="num">Amount</SortHead>
                <SortHead by="days_overdue" className="num">Days Overdue</SortHead>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 8 }).map((_, i) => (
                    <tr key={i}>
                      {Array.from({ length: 6 }).map((__, j) => <td key={j}><Skeleton width={j === 3 ? 220 : 80} /></td>)}
                    </tr>
                  ))
                : result.data.map((b) => (
                    <tr key={b.id}>
                      <td className="mono">{b.bill_reference || '—'}</td>
                      <td>{dateFmt(b.bill_date)}</td>
                      <td>{dateFmt(b.due_date)}</td>
                      <td className="cell-wrap cell-main">{b.party || '—'}</td>
                      <td className={`num qty ${b.amount > 0 ? 'qty--pos' : ''}`}>{inr(b.amount)}</td>
                      <td className="num">
                        <Badge size="sm" variant={ageBadge(b.days_overdue)}>
                          {b.days_overdue == null ? '—' : b.days_overdue <= 0 ? 'Not due' : `${b.days_overdue} days`}
                        </Badge>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><ReceiptIndianRupee size={22} /></span>
              <h2>{hasFilters ? 'No matching bills' : 'No bills yet'}</h2>
              <p>{hasFilters ? 'Try a different search or filter.' : canSync ? 'Click “Sync Google Sheet” to load bills.' : 'Bills appear here once they are synced.'}</p>
            </div>
          )}
        </div>
        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      </div>

      <MasterSyncModal
        open={syncOpen}
        title="Sync Bills Receivable"
        sheetUrl={summary?.sheet?.url}
        tabs={[{ key: 'bills', label: 'Bills Receivable', tabName: summary?.sheet?.tab, description: 'Full replace: the current list is cleared and reloaded from the sheet. If anything fails, the old list stays.' }]}
        columns={SYNC_COLUMNS}
        run={() => billsApi.sync()}
        loadLogs={billsApi.syncLogs}
        onClose={() => setSyncOpen(false)}
        onSynced={() => {
          load();
          loadSummary();
        }}
      />
    </div>
  );
}
