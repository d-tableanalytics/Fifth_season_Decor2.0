import { useCallback, useEffect, useState } from 'react';
import { Search, PackageCheck, FileText, Files } from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/FormControls';
import { PickingModal } from './PickingModal';
import { useO2D } from '../../context/O2DContext';

const dateFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const qty = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** O2D › Cut › Picking queue — one row per order. */
export function PickingQueue() {
  const o2d = useO2D();
  const toast = useToast();
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0, counts: {} });
  const [loading, setLoading] = useState(true);
  const [ticked, setTicked] = useState([]);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await o2d.apis.picking.queue({ page, limit: 25, search: search || undefined }));
    } catch (err) {
      toast.error('Could not load the Picking queue', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const allOnPage = result.data.length > 0 && result.data.every((o) => ticked.includes(o.id));
  const print = (mode) => window.open(`/o2d/cut/picking/print?type=${o2d.slug}&mode=${mode}&ids=${ticked.join(',')}`, '_blank', 'noopener');

  return (
    <>
      <div className="picking-strip">
        <span><strong>{result.counts?.in_queue ?? 0}</strong> in queue</span>
        <span><strong>{result.counts?.on_hold ?? 0}</strong> held from Picking <small>(see Orders › On Hold)</small></span>
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search order no. or client…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
          </label>
          <div className="toolbar__actions">
            <Button size="sm" variant="secondary" icon={FileText} disabled={!ticked.length} onClick={() => print('details')}>Picking Order Details PDF</Button>
            <Button size="sm" variant="secondary" icon={Files} disabled={!ticked.length} onClick={() => print('summary')}>Bulk Picking Summary PDF</Button>
          </div>
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table table--clickable">
            <thead>
              <tr>
                <th className="th-check">
                  <input type="checkbox" aria-label="Select all on this page" checked={allOnPage}
                    onChange={() => setTicked((t) => (allOnPage ? t.filter((x) => !result.data.some((o) => o.id === x)) : [...new Set([...t, ...result.data.map((o) => o.id)])]))} />
                </th>
                <th>Timestamp</th>
                <th>Order No</th>
                <th>Client ID</th>
                <th>Client</th>
                <th className="num">Items</th>
                <th>Picking Progress</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: 8 }).map((__, j) => <td key={j}><Skeleton width={j === 4 ? 170 : 60} /></td>)}</tr>
                  ))
                : result.data.map((o) => {
                    const done = o.picked_qty >= o.required_qty && o.items > 0;
                    return (
                      <tr key={o.id} onClick={() => setOpenId(o.id)}>
                        <td className="th-check" onClick={(e) => e.stopPropagation()}>
                          <input type="checkbox" aria-label={`Select ${o.system_order_no || o.enquiry_number}`} checked={ticked.includes(o.id)} onChange={() => toggle(o.id)} />
                        </td>
                        <td className="cell-sub">{dateFmt(o.entered_at)}</td>
                        <td>
                          <span className="mono">{o.system_order_no || o.enquiry_number}</span>
                          {o.continues && <div><Badge size="sm" variant="info">Continues {o.continues}</Badge></div>}
                          {o.split_child && <div><Badge size="sm" variant="neutral">Ready items → {o.split_child}</Badge></div>}
                        </td>
                        <td className="mono mono--plain">{o.client_id}</td>
                        <td className="cell-wrap cell-main">{o.company_name}</td>
                        <td className="num">{o.items}</td>
                        <td>
                          <Badge size="sm" variant={done ? 'success' : o.picked_qty > 0 ? 'warning' : 'neutral'}>
                            {qty(o.picked_qty)} / {qty(o.required_qty)}
                          </Badge>
                          <div className="cell-sub">{o.lines_picked}/{o.items} items picked</div>
                        </td>
                        <td>
                          {o.not_found > 0 ? (
                            <Badge size="sm" variant="danger">{o.not_found} not found</Badge>
                          ) : (
                            <Badge size="sm" variant="brand">{o.picked_qty > 0 ? 'Picking' : 'To pick'}</Badge>
                          )}
                          {o.unsaved && <div className="cell-sub">Unsaved picks</div>}
                        </td>
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><PackageCheck size={22} /></span>
              <h2>{search ? 'No matching orders' : 'No orders waiting for Picking'}</h2>
              <p>Orders come here after CRM completes the Stock Check.</p>
            </div>
          )}
        </div>
        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      </div>

      {openId && <PickingModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </>
  );
}
