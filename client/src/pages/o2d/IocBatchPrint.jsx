import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Printer, AlertTriangle } from 'lucide-react';
import { cuttingApi } from '../../api/o2d';
import { getErrorMessage } from '../../api/client';
import { Logo, BRAND_NAME } from '../../components/ui/Logo';
import { Loader } from '../../components/ui/Loader';
import { Button } from '../../components/ui/Button';

const qty = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));

/** Printable IOC batch: every Roll lot with an IOC Meter on that day, grouped by order. */
export default function IocBatchPrint() {
  const { no } = useParams();
  const [b, setB] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => {
    cuttingApi.iocBatch(no).then(setB).catch((err) => setError(getErrorMessage(err)));
  }, [no]);

  if (error) return <div className="doc-page"><div className="doc"><div className="promise__msg"><AlertTriangle size={20} /><p>{error}</p></div></div></div>;
  if (!b) return <Loader fullscreen label="Loading…" />;

  const groups = [];
  for (const r of b.rows) {
    let g = groups.find((x) => x.order_no === r.order_no);
    if (!g) groups.push((g = { order_no: r.order_no, client: `${r.client_id} · ${r.company_name}`, type: r.order_type, rows: [] }));
    g.rows.push(r);
  }
  const total = b.rows.reduce((s, r) => s + (r.ioc_meter || 0), 0);

  return (
    <div className="doc-page">
      <div className="doc-page__bar"><Button icon={Printer} onClick={() => window.print()}>Print / Save PDF</Button></div>
      <article className="doc">
        <header className="doc__head">
          <div className="doc__brand"><Logo size={44} /><strong>{BRAND_NAME}</strong></div>
          <div className="doc__title">
            <h1>IOC Batch {b.batch_no}</h1>
            <p>{new Date(`${String(b.batch_date).slice(0, 10)}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}</p>
            <p>{groups.length} order(s) · {b.rows.length} lot(s) · {qty(total)} IOC meter</p>
          </div>
        </header>
        {groups.map((g) => (
          <section key={g.order_no} className="doc__group">
            <h3>{g.order_no} <small>{g.type === 'CUT' ? 'Cut' : 'Roll'} · {g.client}</small></h3>
            <table className="doc__table">
              <thead><tr><th>Item</th><th>Rack</th><th>Lot</th><th className="num">Picked</th><th className="num">IOC Meter</th><th className="num">Cut</th></tr></thead>
              <tbody>
                {g.rows.map((r, i) => (
                  <tr key={i}><td>{r.item_name}</td><td>{r.rack_no || '—'}</td><td>{r.lot_no || '—'}</td><td className="num">{qty(r.picked)}</td><td className="num">{qty(r.ioc_meter)}</td><td className="num">{qty(r.cut_qty)}</td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ))}
      </article>
    </div>
  );
}
