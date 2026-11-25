import { useCallback, useEffect, useState } from 'react';
import { Search, Scissors, Layers, FileText } from 'lucide-react';
import { STAGE_LABELS } from '../../api/o2d';
import { getErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton, Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/FormControls';
import { CutDetailsModal } from './CutDetailsModal';
import { useO2D } from '../../context/O2DContext';

const dateFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** O2D › Cut › Cutting queue — one row per order. */
export function CuttingQueue() {
  const o2d = useO2D();
  const toast = useToast();
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);
  const [batchesOpen, setBatchesOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await o2d.apis.cutting.queue({ page, limit: 25, search: search || undefined }));
    } catch (err) {
      toast.error('Could not load the Cutting queue', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <>
      <div className="picking-strip">
        <span><strong>{result.total}</strong> order(s) at Cutting</span>
        {o2d.ioc && <Button size="sm" variant="secondary" icon={Layers} onClick={() => setBatchesOpen(true)}>IOC Batches</Button>}
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search order no. or client…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
          </label>
        </div>
        <div className="table-wrap table-wrap--flush">
          <table className="table table--clickable">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Order No</th>
                <th>Client ID</th>
                <th>Client</th>
                <th className="num">Items</th>
                <th className="num">Total Qty</th>
                <th>Cut</th>
                <th>Lot No</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <tr key={i}>{Array.from({ length: 9 }).map((__, j) => <td key={j}><Skeleton width={j === 3 ? 160 : 60} /></td>)}</tr>)
                : result.data.map((o) => (
                    <tr key={o.id} onClick={() => setOpenId(o.id)}>
                      <td className="cell-sub">{dateFmt(o.entered_at)}</td>
                      <td>
                        <span className="mono">{o.system_order_no || o.enquiry_number}</span>
                        {o.sent_back && <div><Badge size="sm" variant="warning">Sent back</Badge></div>}
                        {o.has_remarks && <div><Badge size="sm" variant="info">Remarks</Badge></div>}
                      </td>
                      <td className="mono mono--plain">{o.client_id}</td>
                      <td className="cell-wrap cell-main">{o.company_name}</td>
                      <td className="num">{o.items}</td>
                      <td className="num">{qty(o.total_qty)}</td>
                      <td>
                        <Badge size="sm" variant={o.cut_qty >= o.total_qty ? 'success' : o.cut_qty > 0 ? 'warning' : 'neutral'}>{qty(o.cut_qty)} / {qty(o.total_qty)}</Badge>
                      </td>
                      <td className="cell-wrap cell-sub">{o.lot_nos || '—'}</td>
                      <td><Badge size="sm" variant="brand">{STAGE_LABELS[o.workflow_status] || o.workflow_status}</Badge></td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><Scissors size={22} /></span>
              <h2>{search ? 'No matching orders' : 'No orders at Cutting'}</h2>
              <p>Orders come here automatically when every item is picked.</p>
            </div>
          )}
        </div>
        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      </div>

      {openId && <CutDetailsModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
      {batchesOpen && <IocBatchesModal onClose={() => setBatchesOpen(false)} />}
    </>
  );
}

/** Global, date-wise IOC batches (Cut and Roll orders together). */
function IocBatchesModal({ onClose }) {
  const o2d = useO2D();
  const toast = useToast();
  const [rows, setRows] = useState(null);
  useEffect(() => {
    o2d.apis.cutting.iocBatches().then(setRows).catch((err) => {
      toast.error('Could not load IOC batches', getErrorMessage(err));
      setRows([]);
    });
  }, [toast]);
  return (
    <Modal open size="lg" onClose={onClose} title="IOC Batches" subtitle="One batch per day with IOC Meter entries · Cut and Roll orders">
      {!rows ? (
        <Loader label="Loading…" />
      ) : rows.length ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Batch</th><th>Date</th><th className="num">Orders</th><th className="num">Lots</th><th className="num">Total IOC Meter</th><th /></tr></thead>
            <tbody>
              {rows.map((b) => (
                <tr key={b.batch_no}>
                  <td className="mono">{b.batch_no}</td>
                  <td>{new Date(`${String(b.batch_date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</td>
                  <td className="num">{b.orders}</td>
                  <td className="num">{b.lots}</td>
                  <td className="num">{qty(b.total_meter)}</td>
                  <td className="num">
                    <a className="btn btn--ghost btn--sm" href={`/o2d/ioc-batches/${b.batch_no}/print`} target="_blank" rel="noreferrer noopener"><FileText size={14} /> PDF</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="cell-sub">No IOC batch yet — a batch is created the first time an IOC Meter is saved on a day.</p>
      )}
    </Modal>
  );
}
