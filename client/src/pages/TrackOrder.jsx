import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertTriangle, Check } from 'lucide-react';
import { promiseApi, dayFmt } from '../api/crm';
import { getErrorMessage } from '../api/client';
import { Logo, BRAND_NAME } from '../components/ui/Logo';
import { Loader } from '../components/ui/Loader';
import { Badge } from '../components/ui/Badge';

const qtyFmt = (n) => Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });

/** Public order tracking page (no login) sent to the customer when the order reaches Picking. */
export default function TrackOrder() {
  const { token } = useParams();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    promiseApi.track(token).then(setD).catch((err) => setError(getErrorMessage(err)));
  }, [token]);

  if (!d && !error) return <Loader fullscreen label="Loading…" />;

  return (
    <div className="login">
      <div className="login__card track">
        <div className="login__head">
          <Logo size={56} />
          <h1>{BRAND_NAME}</h1>
          {d && <p>{d.company_name}</p>}
        </div>

        {error ? (
          <div className="promise__msg"><AlertTriangle size={20} /><p>{error}</p></div>
        ) : (
          <>
            <div className="track__order">
              <span>Order</span>
              <strong>{d.order_no}</strong>
              {d.status === 'CANCELLED' && <Badge variant="danger">Cancelled</Badge>}
              {d.status === 'ON_HOLD' && <Badge variant="warning">On hold</Badge>}
            </div>

            <ol className="track__steps">
              {d.milestones.map((m) => (
                <li key={m.label} className={`track__step is-${m.state.toLowerCase()}`}>
                  <span className="track__dot">{(m.state === 'DONE' || m.state === 'SKIPPED') && <Check size={12} />}</span>
                  <span className="track__label">{m.label}</span>
                  <span className="track__date">{m.state === 'SKIPPED' ? 'Not needed' : m.at ? dayFmt(m.at) : m.state === 'CURRENT' ? 'In progress' : ''}</span>
                </li>
              ))}
            </ol>

            {d.items.length > 0 && (
              <div className="track__items">
                <span className="field__label">Items</span>
                <ul>
                  {d.items.map((i, k) => (
                    <li key={k}>
                      <span>{i.item}</span>
                      <strong>{qtyFmt(i.qty)} {i.unit}</strong>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {d.transport_name && <p className="promise__foot">Transport: {d.transport_name}</p>}
          </>
        )}
      </div>
    </div>
  );
}
