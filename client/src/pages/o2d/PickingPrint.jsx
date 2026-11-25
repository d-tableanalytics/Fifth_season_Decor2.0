import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Printer, AlertTriangle } from 'lucide-react';
import { o2dTypeBySlug } from '../../api/o2d';
import { getErrorMessage } from '../../api/client';
import { Logo, BRAND_NAME } from '../../components/ui/Logo';
import { Loader } from '../../components/ui/Loader';
import { Button } from '../../components/ui/Button';

const qty = (n) => Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const DEPT = { CUT: 'Cut', ROLL: 'Roll', IN_CHECKING: 'In Chk' };

/** Printable "Picking Order Details" (one page per order) or "Bulk Picking Summary" (all ticked orders, item-wise). */
export default function PickingPrint() {
  const [params] = useSearchParams();
  const mode = params.get('mode') === 'summary' ? 'summary' : 'details';
  const ids = (params.get('ids') || '').split(',').filter(Boolean);
  const [orders, setOrders] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    o2dTypeBySlug(params.get('type')).apis.picking.print(ids).then(setOrders).catch((err) => setError(getErrorMessage(err)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  if (error) {
    return (
      <div className="doc-page">
        <div className="doc"><div className="promise__msg"><AlertTriangle size={20} /><p>{error}</p></div></div>
      </div>
    );
  }
  if (!orders) return <Loader fullscreen label="Preparing…" />;

  const head = (title, sub) => (
    <header className="doc__head">
      <div className="doc__brand"><Logo size={44} /><strong>{BRAND_NAME}</strong></div>
      <div className="doc__title"><h1>{title}</h1><p>{sub}</p><p>{new Date().toLocaleString('en-IN')}</p></div>
    </header>
  );

  // Item-wise totals across all ticked orders
  const summary = [];
  if (mode === 'summary') {
    const map = new Map();
    for (const o of orders) {
      for (const l of o.lines) {
        const k = l.base;
        if (!map.has(k)) map.set(k, { item: l.item_name, unit: l.unit, required: 0, picked: 0, orders: [], locations: l.locations });
        const s = map.get(k);
        s.required += l.required;
        s.picked += l.picked;
        s.orders.push(`${o.system_order_no || o.enquiry_number} (${qty(l.required)})`);
      }
    }
    summary.push(...map.values());
  }

  return (
    <div className="doc-page">
      <div className="doc-page__bar"><Button icon={Printer} onClick={() => window.print()}>Print / Save PDF</Button></div>
      {mode === 'summary' ? (
        <article className="doc">
          {head('Bulk Picking Summary', `${orders.length} order(s)`)}
          <table className="doc__table">
            <thead><tr><th>#</th><th>Item</th><th className="num">Required</th><th className="num">Picked</th><th>Orders</th><th>Rack / Lot (available)</th></tr></thead>
            <tbody>
              {summary.map((s, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td>{s.item}</td>
                  <td className="num">{qty(s.required)} {s.unit}</td>
                  <td className="num">{qty(s.picked)}</td>
                  <td>{s.orders.join(', ')}</td>
                  <td>{s.locations.slice(0, 6).map((x, j) => <small key={j} className="doc__check"><span className="doc__box" aria-hidden="true" />{DEPT[x.stock_type]} · {x.rack_no || '—'} · {x.lot_no || '—'} · {qty(x.qty)}</small>)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </article>
      ) : (
        orders.map((o) => (
          <article key={o.id} className="doc doc--page">
            {head('Picking Order Details', o.system_order_no || o.enquiry_number)}
            <section className="doc__party">
              <span>Client</span>
              <strong>{o.company_name}</strong>
              <small>{o.client_id}{o.city ? ` · ${o.city}` : ''}{o.transport_name ? ` · Transport: ${o.transport_name}` : ''}</small>
              {(o.customer_remark || o.team_remark) && <small>{[o.customer_remark, o.team_remark].filter(Boolean).join(' · ')}</small>}
            </section>
            <table className="doc__table">
              <thead><tr><th>Line</th><th>Item</th><th className="num">Required</th><th className="num">Picked</th><th>Rack / Lot (available)</th><th>Picked pieces</th></tr></thead>
              <tbody>
                {o.lines.map((l) => (
                  <tr key={l.id}>
                    <td>{l.line}</td>
                    <td>{l.item_name}{l.state === 'NOT_FOUND' && <small>Not found</small>}</td>
                    <td className="num">{qty(l.required)} {l.unit}</td>
                    <td className="num">{qty(l.picked)}</td>
                    <td>{l.locations.length ? l.locations.map((x, j) => <small key={j} className="doc__check"><span className="doc__box" aria-hidden="true" />{DEPT[x.stock_type]} · {x.rack_no || '—'} · {x.lot_no || '—'} · {qty(x.qty)}</small>) : <small>—</small>}</td>
                    <td>{l.picks.length ? l.picks.map((p) => <small key={p.id}>{p.source} · {p.rack_no || '—'} · {p.lot_no || '—'} · {qty(p.qty)}</small>) : <small>—</small>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </article>
        ))
      )}
    </div>
  );
}
