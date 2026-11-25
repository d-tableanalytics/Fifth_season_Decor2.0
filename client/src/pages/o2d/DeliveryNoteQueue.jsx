import { useCallback, useEffect, useState } from 'react';
import { Search, FileCheck2, FileText, Pencil, Lock, Check, X } from 'lucide-react';

import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { Pagination } from '../../components/ui/FormControls';
import { DeliveryNoteModal } from './DeliveryNoteModal';
import { useO2D } from '../../context/O2DContext';

const dateFmt = (d) => (d ? new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Delivery Note number cell: editable exactly once (the logged change locks it). */
export function DnNumberCell({ orderId, value, locked, onSaved }) {
  const o2d = useO2D();
  const { can } = useAuth();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value || '');
  const [busy, setBusy] = useState(false);
  const canEdit = can(o2d.perm, 'edit') && !locked;

  const save = async () => {
    if (!text.trim() || text.trim() === value) return setEditing(false);
    if (!window.confirm(`Change the Delivery Note number to "${text.trim()}"? It can be changed only once.`)) return;
    setBusy(true);
    try {
      const r = await o2d.apis.deliveryNote.editNumber(orderId, text.trim());
      toast.success(r.message);
      setEditing(false);
      onSaved(r.data);
    } catch (err) {
      toast.error('Could not change the number', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (editing) {
    return (
      <span className="dn-edit" onClick={(e) => e.stopPropagation()}>
        <input autoFocus maxLength={30} value={text} disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }} />
        <button type="button" className="icon-btn icon-btn--sm icon-btn--ok" disabled={busy} onClick={save} aria-label="Save"><Check size={14} /></button>
        <button type="button" className="icon-btn icon-btn--sm" disabled={busy} onClick={() => setEditing(false)} aria-label="Cancel"><X size={14} /></button>
      </span>
    );
  }
  return (
    <span className="dn-cell">
      <span className="mono">{value || '—'}</span>
      {locked ? (
        <Lock size={12} className="cell-sub" aria-label="Changed once — locked" />
      ) : canEdit ? (
        <button type="button" className="icon-btn icon-btn--sm" title="Edit (only once)" onClick={(e) => { e.stopPropagation(); setText(value || ''); setEditing(true); }}><Pencil size={12} /></button>
      ) : null}
    </span>
  );
}

/** O2D › Cut › Delivery Note — one row per order. */
export function DeliveryNoteQueue() {
  const o2d = useO2D();
  const toast = useToast();
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], orders: 0 });
  const [loading, setLoading] = useState(true);
  const [ticked, setTicked] = useState([]);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await o2d.apis.deliveryNote.queue({ page, limit: 25, search: search || undefined }));
    } catch (err) {
      toast.error('Could not load Delivery Note', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [page, search, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const toggle = (id) => setTicked((t) => (t.includes(id) ? t.filter((x) => x !== id) : [...t, id]));
  const allOnPage = result.data.length > 0 && result.data.every((r) => ticked.includes(r.order_id));

  return (
    <>
      <div className="picking-strip">
        <span><strong>{result.orders}</strong> order(s) at Delivery Note</span>
        <Button size="sm" icon={FileText} disabled={!ticked.length} onClick={() => window.open(`/o2d/delivery-note/print?type=${o2d.slug}&orders=${ticked.join(',')}`, '_blank', 'noopener')}>
          Generate Delivery Note ({ticked.length})
        </Button>
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search order, DN no. or client…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
          </label>
        </div>
        <div className="table-wrap table-wrap--flush">
          <table className="table table--clickable dn-table">
            <thead>
              <tr>
                <th className="th-check">
                  <input type="checkbox" aria-label="Select all on this page" checked={allOnPage}
                    onChange={() => setTicked((t) => (allOnPage ? t.filter((x) => !result.data.some((r) => r.order_id === x)) : [...new Set([...t, ...result.data.map((r) => r.order_id)])]))} />
                </th>
                <th>Timestamp</th>
                <th>Order No</th>
                <th>Client ID</th>
                <th>Customer</th>
                <th className="num">Items</th>
                <th>Lot No</th>
                <th className="num">Original Size</th>
                <th className="num">Cut Size</th>
                <th className="num">Balance</th>
                <th>Transport</th>
                <th>Delivery Note No</th>
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 5 }).map((_, i) => <tr key={i}>{Array.from({ length: 12 }).map((__, j) => <td key={j}><Skeleton width={j === 4 ? 150 : 50} /></td>)}</tr>)
                : result.data.map((r) => (
                    <tr key={r.order_id} onClick={() => setOpenId(r.order_id)}>
                      <td className="th-check" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" aria-label={`Select ${r.order_no}`} checked={ticked.includes(r.order_id)} onChange={() => toggle(r.order_id)} />
                      </td>
                      <td className="cell-sub">{dateFmt(r.entered_at)}</td>
                      <td>
                        <span className="mono">{r.order_no}</span>
                        {r.sent_back && <div><Badge size="sm" variant="warning">Sent back</Badge></div>}
                        {r.has_remarks && <div><Badge size="sm" variant="info">Remarks</Badge></div>}
                      </td>
                      <td className="mono mono--plain">{r.client_id}</td>
                      <td className="cell-wrap cell-main">{r.company_name}</td>
                      <td className="num">{r.items}</td>
                      <td className="cell-sub">{r.lot_no || '—'}</td>
                      <td className="num">{qty(r.original)}</td>
                      <td className="num">{qty(r.cut_qty)}</td>
                      <td className={`num ${r.balance > 0 ? 'text-danger' : ''}`}>{qty(r.balance)}</td>
                      <td className="cell-wrap cell-sub">{r.transport_name || '—'}</td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <DnNumberCell orderId={r.order_id} value={r.delivery_note_no} locked={r.dn_locked} onSaved={load} />
                      </td>
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><FileCheck2 size={22} /></span>
              <h2>{search ? 'No matching orders' : 'Nothing at Delivery Note'}</h2>
              <p>Orders come here automatically when every item is cut.</p>
            </div>
          )}
        </div>
        {result.orders > 0 && <Pagination page={page} limit={25} total={result.orders} onPage={setPage} />}
      </div>

      {openId && <DeliveryNoteModal id={openId} onClose={() => setOpenId(null)} onChanged={load} />}
    </>
  );
}
