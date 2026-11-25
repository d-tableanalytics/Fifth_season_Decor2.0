import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { Search, Package, ScanLine } from 'lucide-react';
import { STAGE_LABELS } from '../../api/o2d';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton, Loader } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/FormControls';
import { PackOrderModal } from './PackOrderModal';
import { useO2D } from '../../context/O2DContext';

const ScanCodeModal = lazy(() => import('../../components/ui/ScanCodeModal').then((m) => ({ default: m.ScanCodeModal })));

const dateFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
export const PACK_STATUS = {
  NOT_STARTED: { label: 'Not started', variant: 'neutral' },
  PARTIALLY_PACKED: { label: 'Partially packed', variant: 'warning' },
  FULLY_PACKED: { label: 'Fully packed', variant: 'success' },
};

/** O2D › Cut › Packing queue — one row per order; scan an order no. or a parcel sticker to open it. */
export function PackingQueue() {
  const o2d = useO2D();
  const { can } = useAuth();
  const toast = useToast();
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(null); // { id, parcelId }
  const [code, setCode] = useState('');
  const [scanning, setScanning] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await o2d.apis.packing.queue({ page, limit: 25, search: search || undefined }));
    } catch (err) {
      toast.error('Could not load Packing', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => {
    load();
  }, [load]);

  /** Opening only — scanning never packs anything. */
  const openCode = async (value) => {
    const c = String(value || '').trim();
    if (!c) return;
    try {
      const r = await o2d.apis.packing.lookup(c);
      setCode('');
      setOpen({ id: r.order_id, parcelId: r.parcel_id });
    } catch (err) {
      toast.error('Not found', getErrorMessage(err));
    }
  };

  return (
    <>
      <div className="picking-strip">
        <span><strong>{result.total}</strong> order(s) at Packing</span>
        <form className="pack-scan" onSubmit={(e) => { e.preventDefault(); openCode(code); }}>
          <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Scan / enter Order No or PKT-…" aria-label="Order number or parcel code" />
          <Button size="sm" type="submit" variant="secondary" disabled={!code.trim()}>Open</Button>
          {can(o2d.perm, 'edit') && <Button size="sm" type="button" icon={ScanLine} onClick={() => setScanning(true)}>Scan to Pack</Button>}
        </form>
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
                <th className="num">Picked</th>
                <th className="num">Packed</th>
                <th className="num">Pending</th>
                <th className="num">Parcels</th>
                <th>Packing Status</th>
                <th>Last Packed</th>
                <th>Lot No</th>
                <th>Stage</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <tr key={i}>{Array.from({ length: 14 }).map((__, j) => <td key={j}><Skeleton width={j === 3 ? 150 : 50} /></td>)}</tr>)
                : result.data.map((o) => (
                    <tr key={o.id} onClick={() => setOpen({ id: o.id })}>
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
                      <td className="num">{qty(o.picked)}</td>
                      <td className="num">{qty(o.packed)}</td>
                      <td className={`num ${o.pending > 0 ? 'text-danger' : ''}`}>{qty(o.pending)}</td>
                      <td className="num">{o.parcels}</td>
                      <td><Badge size="sm" variant={PACK_STATUS[o.packing_status].variant}>{PACK_STATUS[o.packing_status].label}</Badge></td>
                      <td className="cell-sub">{o.last_packed_at ? <>{dateFmt(o.last_packed_at)}<div>{o.last_packed_by || ''}</div></> : '—'}</td>
                      <td className="cell-wrap cell-sub">{o.lot_nos || '—'}</td>
                      <td><Badge size="sm" variant={o.workflow_status === 'PACKING_COMPLETED' ? 'success' : 'brand'}>{STAGE_LABELS[o.workflow_status] || o.workflow_status}</Badge></td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><Package size={22} /></span>
              <h2>{search ? 'No matching orders' : 'Nothing at Packing'}</h2>
              <p>Orders come here from Delivery Note › Move to Packing.</p>
            </div>
          )}
        </div>
        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      </div>

      {scanning && (
        <Suspense fallback={<Loader fullscreen label="Opening camera…" />}>
          <ScanCodeModal
            title="Scan to Pack"
            hint="Cut Item label (order no.) or a parcel sticker (PKT-…)"
            onClose={() => setScanning(false)}
            onScan={(text) => {
              setScanning(false);
              openCode(text);
            }}
          />
        </Suspense>
      )}
      {open && <PackOrderModal id={open.id} highlight={open.parcelId} onClose={() => setOpen(null)} onChanged={load} />}
    </>
  );
}
