import { useCallback, useEffect, useState } from 'react';
import { Search, PackageSearch, RefreshCw } from 'lucide-react';
import { crmApi, stampFmt } from '../../api/crm';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { Button } from '../../components/ui/Button';
import { MasterSyncModal } from '../../components/forms/MasterSyncModal';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/FormControls';
import { StockCheckModal } from './StockCheckModal';

const ALT_SYNC_COLUMNS = {
  alt_color: [
    { key: 'imported', label: 'Alternatives loaded', tone: 'success' },
    { key: 'replaced', label: 'Old list cleared' },
    { key: 'incomplete', label: 'Rows with a blank cell', tone: 'warning', hint: 'Skipped' },
    { key: 'skipped', label: 'Repeated / same item', hint: 'Skipped' },
    { key: 'notInInventory', label: 'Alternatives not in inventory', tone: 'warning', hint: 'Shown with 0 stock' },
  ],
};

/** Stock Check tab of CRM › Cut / Roll. */
export default function StockCheck({ type = 'CUT' }) {
  const toast = useToast();
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const canSync = useAuth().can('crm_stock_check', 'edit');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await crmApi.stockList({ type, page, limit: 25, search: search || undefined }));
    } catch (err) {
      toast.error('Could not load orders', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [type, page, search, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search enquiry no. or client…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
          </label>
          {canSync && (
            <Button size="sm" variant="secondary" icon={RefreshCw} onClick={() => setSyncOpen(true)}>Sync Alternatives</Button>
          )}
        </div>
        <div className="table-wrap table-wrap--flush">
          <table className="table table--clickable">
            <thead>
              <tr>
                <th>Arrived</th>
                <th>Enquiry No</th>
                <th>Type</th>
                <th>Client ID</th>
                <th>Client</th>
                <th className="num">Items</th>
                <th>Checked</th>
                <th>Transporter</th>
                <th>Why here</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 9 }).map((__, j) => <td key={j}><Skeleton width={j === 4 ? 180 : 70} /></td>)}</tr>
                  ))
                : result.data.map((o) => (
                    <tr key={o.id} onClick={() => setOpenId(o.id)}>
                      <td className="cell-sub">{stampFmt(o.arrived_at)}</td>
                      <td className="mono">{o.enquiry_number}</td>
                      <td><Badge size="sm" variant="neutral">{o.order_type === 'CUT' ? 'Cut' : 'Roll'}</Badge></td>
                      <td className="mono mono--plain">{o.client_id}</td>
                      <td className="cell-wrap cell-main">{o.company_name}</td>
                      <td className="num">{o.lines}</td>
                      <td>
                        <Badge size="sm" variant={o.checked === 0 ? 'neutral' : o.checked >= o.lines ? 'success' : 'warning'}>
                          {o.checked}/{o.lines}
                        </Badge>
                      </td>
                      <td>{o.transport_name || <span className="cell-sub">—</span>}</td>
                      <td className="cell-wrap">
                        <Badge size="sm" variant={o.skip_payment_check ? 'warning' : 'success'}>{o.skip_payment_check ? 'Skip Payment' : 'Payment clear'}</Badge>{' '}
                        <span className="cell-sub">{o.arrived_reason}</span>
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><PackageSearch size={22} /></span>
              <h2>{search ? 'No matching orders' : 'No orders at Stock Check'}</h2>
            </div>
          )}
        </div>
        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
        <MasterSyncModal
          open={syncOpen}
          title="Sync Alternative Items"
          tabs={[{ key: 'alt_color', label: 'Alternative color', tabName: 'Alternative_color', description: 'Full replace: Order item → alternate color. If anything fails, the old list stays.' }]}
          columns={ALT_SYNC_COLUMNS}
          run={() => crmApi.altSync()}
          loadLogs={crmApi.altSyncLogs}
          onClose={() => setSyncOpen(false)}
          onSynced={() => {}}
        />
        {openId && <StockCheckModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </div>
  );
}
