import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Printer, AlertTriangle } from 'lucide-react';
import { o2dTypeBySlug } from '../../api/o2d';
import { getErrorMessage } from '../../api/client';
import { Logo, BRAND_NAME } from '../../components/ui/Logo';
import { Loader } from '../../components/ui/Loader';
import { Button } from '../../components/ui/Button';

const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Internal Delivery Note (handover slip) — one page per order. Not the commercial dispatch challan. */
export default function DeliveryNotePrint() {
  const [params] = useSearchParams();
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const list = (k) => (params.get(k) || '').split(',').filter(Boolean);
    o2dTypeBySlug(params.get('type')).apis.deliveryNote.print({ orders: list('orders'), items: list('items') }).then(setOrders).catch((err) => setError(getErrorMessage(err)));
  }, [params]);

  if (error) return <div className="doc-page"><div className="doc"><div className="promise__msg"><AlertTriangle size={20} /><p>{error}</p></div></div></div>;
  if (!orders) return <Loader fullscreen label="Preparing…" />;

  return (
    <div className="doc-page">
      <div className="doc-page__bar"><Button icon={Printer} onClick={() => window.print()}>Print / Save PDF</Button></div>
      {orders.map((o) => (
        <article key={o.id} className="doc doc--page">
          <header className="doc__head">
            <div className="doc__brand"><Logo size={44} /><strong>{BRAND_NAME}</strong></div>
            <div className="doc__title">
              <h1>Delivery Note</h1>
              <p><span>No.</span> {o.delivery_note_no || '—'}</p>
              <p><span>Order</span> {o.order_no}</p>
              <p><span>Date</span> {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            </div>
          </header>
          <section className="doc__party doc__party--split">
            <div>
              <span>Client</span>
              <strong>{o.company_name}</strong>
              <small>{o.client_id}{o.city ? ` · ${o.city}` : ''}</small>
            </div>
            <div>
              <span>Transport</span>
              <strong>{o.transport_name || '—'}</strong>
              <small>{[o.transport_city, o.transport_contact, o.mode_of_dispatch].filter(Boolean).join(' · ')}</small>
              {o.lr_number && <small>LR No. {o.lr_number}</small>}
            </div>
            {o2dTypeBySlug(params.get('type')).ioc && (
              <div>
                <span>IOC Numbers</span>
                <strong>{o.ioc_numbers || '—'}</strong>
              </div>
            )}
          </section>
          <table className="doc__table">
            <thead><tr><th>Line</th><th>Item</th><th>Lot No</th><th className="num">Cut Qty</th><th className="num">Wastage</th><th>Unit</th></tr></thead>
            <tbody>
              {o.items.map((it) => (
                <tr key={it.item_id}>
                  <td>{it.line}</td>
                  <td>{it.item_name}</td>
                  <td>{it.lot_no || '—'}</td>
                  <td className="num">{qty(it.cut_qty)}</td>
                  <td className="num">{qty(it.wastage_qty)}</td>
                  <td>{it.unit}</td>
                </tr>
              ))}
            </tbody>
            <tfoot><tr><td colSpan={3}>Total</td><td className="num">{qty(o.items.reduce((s, it) => s + it.cut_qty, 0))}</td><td className="num">{qty(o.items.reduce((s, it) => s + it.wastage_qty, 0))}</td><td /></tr></tfoot>
          </table>
          {(o.customer_remark || o.team_remark) && <p className="doc__note">{[o.customer_remark, o.team_remark].filter(Boolean).join(' · ')}</p>}
          <p className="doc__note">Internal handover slip — not the dispatch challan.</p>
        </article>
      ))}
    </div>
  );
}
