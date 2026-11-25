import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, AlertTriangle } from 'lucide-react';
import { promiseApi, inr, dayFmt } from '../api/crm';
import { getErrorMessage } from '../api/client';
import { Logo, BRAND_NAME } from '../components/ui/Logo';
import { Loader } from '../components/ui/Loader';
import { Button } from '../components/ui/Button';

const qtyFmt = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Public, printable Proforma Invoice (no login) — opened from the WhatsApp link or by CRM. */
export default function ProformaView() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    promiseApi.proforma(token).then(setD).catch((err) => setError(getErrorMessage(err)));
  }, [token]);

  if (error) {
    return (
      <div className="login">
        <div className="login__card">
          <div className="promise__msg"><AlertTriangle size={20} /><p>{error}</p></div>
        </div>
      </div>
    );
  }
  if (!d) return <Loader fullscreen label="Loading…" />;

  const address = d.full_address || [d.city, d.state, d.pin].filter(Boolean).join(', ');

  return (
    <div className="doc-page">
      <div className="doc-page__bar">
        <Button icon={Printer} onClick={() => window.print()}>Print / Save PDF</Button>
      </div>
      <article className="doc">
        <header className="doc__head">
          <div className="doc__brand">
            <Logo size={56} />
            <strong>{BRAND_NAME}</strong>
          </div>
          <div className="doc__title">
            <h1>Proforma Invoice</h1>
            <p><span>No.</span> {d.proforma_no}</p>
            <p><span>Date</span> {dayFmt(d.generated_at)}</p>
            <p><span>Order</span> {d.system_order_no || d.enquiry_number}</p>
          </div>
        </header>

        <section className="doc__party">
          <span>Bill to</span>
          <strong>{d.company_name}</strong>
          <small>Client ID {d.client_id}</small>
          {address && <small>{address}</small>}
          {d.gstin && <small>GSTIN {d.gstin}</small>}
        </section>

        <table className="doc__table">
          <thead>
            <tr>
              <th>#</th>
              <th>Item</th>
              <th className="num">Qty</th>
              <th>Unit</th>
              <th className="num">Rate</th>
              <th className="num">Amount</th>
            </tr>
          </thead>
          <tbody>
            {d.lines.map((l, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  {l.item}
                  {l.catalogue && <small>{l.catalogue}</small>}
                </td>
                <td className="num">{qtyFmt(l.qty)}</td>
                <td>{l.unit}</td>
                <td className="num">{l.rate != null ? inr(l.rate) : '—'}</td>
                <td className="num">{l.amount != null ? inr(l.amount) : '—'}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5}>Total</td>
              <td className="num">{inr(d.total)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="doc__note">This is a proforma invoice and not a tax invoice.</p>
      </article>
    </div>
  );
}
