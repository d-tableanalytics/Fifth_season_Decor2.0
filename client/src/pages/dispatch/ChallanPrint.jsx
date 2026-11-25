import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, AlertTriangle } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { Logo, BRAND_NAME } from '../../components/ui/Logo';
import { Loader } from '../../components/ui/Loader';
import { Button } from '../../components/ui/Button';

const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const inr = (n) => `₹${Number(n ?? 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Commercial dispatch challan (per order). */
export default function ChallanPrint() {
  const { id } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    api.get(`/dispatch-planning/${id}/challan`).then((r) => setD(r.data.data)).catch((err) => setError(getErrorMessage(err)));
  }, [id]);

  if (error) return <div className="doc-page"><div className="doc"><div className="promise__msg"><AlertTriangle size={20} /><p>{error}</p></div></div></div>;
  if (!d) return <Loader fullscreen label="Loading…" />;
  const c = d.challan;
  const address = d.full_address || [d.city, d.state, d.pin].filter(Boolean).join(', ');

  return (
    <div className="doc-page">
      <div className="doc-page__bar"><Button icon={Printer} onClick={() => window.print()}>Print / Save PDF</Button></div>
      <article className="doc">
        <header className="doc__head">
          <div className="doc__brand"><Logo size={48} /><strong>{BRAND_NAME}</strong></div>
          <div className="doc__title">
            <h1>Delivery Challan</h1>
            <p><span>No.</span> {c.challan_no}</p>
            <p><span>Date</span> {new Date(c.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            <p><span>Order</span> {d.order_no}{d.delivery_note_no ? ` · ${d.delivery_note_no}` : ''}</p>
          </div>
        </header>
        <section className="doc__party doc__party--split">
          <div>
            <span>Bill to</span>
            <strong>{d.company_name}</strong>
            <small>{d.client_id}</small>
            {address && <small>{address}</small>}
            {d.gstin && <small>GSTIN {d.gstin}</small>}
          </div>
          <div>
            <span>Transport</span>
            <strong>{d.transport_name || '—'}</strong>
            <small>{[d.transport_city, d.mode_of_dispatch].filter(Boolean).join(' · ')}</small>
            {d.lr_number && <small>LR No. {d.lr_number}</small>}
          </div>
          <div>
            <span>Parcels</span>
            <strong>{c.tot_parcels}</strong>
            {c.packed_by && <small>Packed by {c.packed_by}</small>}
            {c.salesman && <small>Salesman {c.salesman}</small>}
          </div>
        </section>
        <table className="doc__table">
          <thead>
            <tr><th>#</th><th>Item</th><th>HSN</th><th className="num">Qty</th><th>Unit</th><th className="num">Rate</th><th className="num">Disc %</th><th className="num">Boxes</th><th className="num">Amount</th></tr>
          </thead>
          <tbody>
            {c.items.map((it, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>{it.item_name}</td>
                <td>{it.hsn_code || '—'}</td>
                <td className="num">{qty(it.qty)}</td>
                <td>{it.unit}</td>
                <td className="num">{inr(it.rate)}</td>
                <td className="num">{qty(it.discount_pct)}</td>
                <td className="num">{it.box_count}</td>
                <td className="num">{inr(it.amount)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr><td colSpan={3}>Total</td><td className="num">{qty(c.total_qty)}</td><td colSpan={4} className="num">Gross {inr(c.total_gross_amount)} · Discount {inr(c.total_discount)}</td><td className="num">{inr(c.net_total_amount)}</td></tr>
          </tfoot>
        </table>
      </article>
    </div>
  );
}
