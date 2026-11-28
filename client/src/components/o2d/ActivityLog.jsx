import { useEffect, useState } from 'react';
import { History, ChevronDown, ChevronRight } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { STAGE_LABELS } from '../../api/o2d';
import { Badge } from '../ui/Badge';

const stamp = (d) => new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });

// Readable names for the logged actions; anything else is shown as "Word Word"
const EVENT_LABEL = {
  CREATED: 'Order created', EDITED: 'Order edited', REMARK: 'Remark', STOCK_DECISION: 'Stock check decision', STOCK_PICKED: 'Picked',
  NOT_FOUND: 'Marked not found', PICKING_BATCH: 'Picking batch saved', CUT_SAVED: 'Cut details saved', PICKED_QTY_CORRECTED: 'Picked qty corrected',
  PARCEL_PACKED: 'Parcel packed', LR_CAPTURED: 'LR captured', LR_SENT: 'LR sent', DN_NUMBER_EDITED: 'Delivery note no. edited',
  CHALLAN_GENERATED: 'Challan generated', DISPATCHED: 'Dispatched', HANDOVER: 'Handed over', DELIVERED: 'Delivered',
  LEDGER_SENT: 'Ledger sent', PAYMENT_LINK_CREATED: 'Payment link created', PAYMENT_PROMISE: 'Customer promise', PAYMENT_APPROVED: 'Payment approved',
  PAYMENT_REJECTED: 'Payment rejected', ADVANCE_RECEIVED: 'Advance received', PROFORMA_GENERATED: 'Proforma generated', PROFORMA_UPDATED: 'Proforma regenerated',
  SEND_BACK: 'Sent back', HOLD: 'Put on hold', RESUMED: 'Resumed', CANCELLED: 'Cancelled', REACTIVATED: 'Reactivated',
};
const label = (e) => EVENT_LABEL[e] || e.toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Who did what, when — every step of the order, item-wise. Used to trace a credit note back to the step
 * (and person) that caused it. Collapsed by default; loads on first open.
 */
export function ActivityLog({ orderId }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [item, setItem] = useState('');

  useEffect(() => {
    if (!open || data) return;
    api.get(`/o2d/orders/${orderId}/activity`).then((r) => setData(r.data.data)).catch((err) => setError(getErrorMessage(err)));
  }, [open, data, orderId]);

  const picked = data?.items.find((i) => i.id === item);
  // An item's rows: logged against it, or naming its SKU (covers entries made before an order edit renumbered the items)
  const rows = !data ? [] : picked ? data.rows.filter((r) => r.item_ids.includes(picked.id) || (r.text || '').includes(picked.sku_code)) : data.rows;

  return (
    <section className="activity">
      <button type="button" className="activity__toggle" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <History size={14} /> Activity log <span className="cell-sub">— who did what, when</span>
      </button>
      {open && (
        <>
          {error ? (
            <p className="cell-sub">Could not load — {error}</p>
          ) : !data ? (
            <p className="cell-sub">Loading…</p>
          ) : (
            <>
              <select className="toolbar__select activity__filter" value={item} onChange={(e) => setItem(e.target.value)} aria-label="Item">
                <option value="">All steps ({data.rows.length})</option>
                {data.items.map((i) => <option key={i.id} value={i.id}>Line {i.line} · {i.sku_code}</option>)}
              </select>
              <ol className="activity__list">
                {rows.map((r) => (
                  <li key={r.key}>
                    <span className="activity__when">{stamp(r.at)}</span>
                    <span className="activity__who">{r.by || (r.by_customer ? 'Customer' : 'System')}{r.by_code && <span className="cell-sub"> · {r.by_code}</span>}</span>
                    <span className="activity__what">
                      <strong>{label(r.event)}</strong>
                      {(r.from_stage || r.to_stage) && (
                        <Badge size="sm" variant="neutral">
                          {r.from_stage && r.to_stage && r.from_stage !== r.to_stage
                            ? `${STAGE_LABELS[r.from_stage] || r.from_stage} → ${STAGE_LABELS[r.to_stage] || r.to_stage}`
                            : STAGE_LABELS[r.to_stage || r.from_stage] || r.to_stage || r.from_stage}
                        </Badge>
                      )}
                      {r.text && <span className="activity__text">{r.text}</span>}
                    </span>
                  </li>
                ))}
                {!rows.length && <li className="cell-sub">Nothing logged for this item.</li>}
              </ol>
            </>
          )}
        </>
      )}
    </section>
  );
}
