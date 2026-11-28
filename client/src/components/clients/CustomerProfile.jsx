import { useEffect, useState } from 'react';
import { Star, PhoneCall, FileSpreadsheet, Sparkles } from 'lucide-react';
import api, { getErrorMessage } from '../../api/client';
import { inr, dayFmt, stampFmt } from '../../api/crm';
import { STAGE_LABELS } from '../../api/o2d';
import { Badge } from '../ui/Badge';
import { Loader } from '../ui/Loader';
import { Modal } from '../ui/Modal';
import { PaidLateBadge } from '../../pages/payment/PaidBills';

const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'orders', label: 'Orders' },
  { key: 'items', label: 'Items' },
  { key: 'payments', label: 'Payments' },
  { key: 'talks', label: 'Conversations' },
];
const qtyFmt = (n) => (n == null ? '—' : Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }));
const RATING_VARIANT = { Excellent: 'success', Good: 'success', Average: 'warning', Risky: 'danger', 'High risk': 'danger' };
const PROMISE_VARIANT = { APPROVED: 'success', REJECTED: 'danger', PENDING: 'warning' };

function Stars({ value }) {
  return (
    <span className="cprofile__stars" aria-label={`${value} of 5`}>
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={16} className={value >= i ? 'is-full' : value >= i - 0.5 ? 'is-half' : ''} />
      ))}
    </span>
  );
}

function Pending({ icon: Icon, title, children }) {
  return (
    <div className="cprofile__pending">
      <Icon size={16} />
      <div><strong>{title}</strong><p className="cell-sub">{children}</p></div>
    </div>
  );
}

/** Customer Profile body — used in the profile modal and as the "History" tab of Payment Check / Stock Check. */
export function CustomerProfile({ clientId }) {
  const [p, setP] = useState(null);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');

  useEffect(() => {
    setP(null);
    setError('');
    api.get(`/clients/${clientId}/profile`).then((r) => setP(r.data.data)).catch((err) => setError(getErrorMessage(err)));
  }, [clientId]);

  if (error) return <p className="cell-sub">Could not load the profile — {error}</p>;
  if (!p) return <Loader label="Loading profile…" />;
  const { client: c, stats: s, rating: r, payment: pay } = p;
  const ph = pay.paid;

  return (
    <div className="cprofile">
      <div className="segmented" role="tablist" aria-label="Profile">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => setTab(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <>
          <div className="cprofile__rating">
            <div>
              <Stars value={r.stars} />
              <strong>{r.stars.toFixed(1)}</strong>
              <Badge size="sm" variant={RATING_VARIANT[r.label]}>{r.label}</Badge>
              <span className="cell-sub">score {r.score}/100</span>
            </div>
            <p className="cell-sub">
              Payment {r.parts.payment} · Credit use {r.parts.credit} · Orders {r.parts.orders}
              {r.provisional && ' — provisional: no paid bills from Tally found for this party name'}
            </p>
          </div>

          <div className="crm-facts">
            <div><span>Credit limit</span><strong>{c.credit_limit != null ? inr(c.credit_limit) : 'Not set'}</strong>{pay.credit_used_pct != null && <small>{pay.credit_used_pct}% used</small>}</div>
            <div><span>Credit days</span><strong>{c.credit_days != null ? `${c.credit_days} days` : 'Not set'}</strong></div>
            <div><span>Outstanding</span><strong>{inr(pay.outstanding)}</strong>{pay.overdue_bills > 0 && <small>{inr(pay.overdue_amount)} overdue · max {pay.max_days_overdue} days</small>}</div>
            <div><span>Payment</span><strong>{c.skip_payment_check ? 'Skip Payment' : c.payment_mode || '—'}</strong><small>{c.client_type || ''}</small></div>
            <div>
              <span>Pays on time</span>
              <strong>{ph.on_time_pct != null ? `${ph.on_time_pct}%` : '—'}</strong>
              <small>{ph.bills ? `${ph.bills} paid bills · avg ${ph.avg_late_days} days late when late` : 'No paid bills from Tally'}</small>
            </div>
            <div><span>Orders</span><strong>{s.total_orders}</strong><small>Cut {s.by_type.CUT} · Roll {s.by_type.ROLL}{s.cancelled ? ` · ${s.cancelled} cancelled` : ''}</small></div>
            <div><span>Order frequency</span><strong>{s.avg_gap_days != null ? `every ~${s.avg_gap_days} days` : '—'}</strong><small>{s.orders_last_90d} in last 90 days</small></div>
            <div><span>Last order</span><strong>{s.last_order_at ? dayFmt(s.last_order_at) : '—'}</strong>{s.days_since_last != null && <small>{s.days_since_last} days ago</small>}</div>
            <div><span>Total</span><strong>{qtyFmt(s.total_qty)} qty</strong>{s.total_value > 0 && <small>{inr(s.total_value)} (proforma)</small>}</div>
          </div>

          <h4 className="crm-pay__title">Buys most</h4>
          {p.top_items.length ? (
            <ul className="cprofile__top">
              {p.top_items.slice(0, 5).map((i) => (
                <li key={`${i.item}-${i.order_type}`}>
                  <span className="cell-wrap">{i.item}</span>
                  <Badge size="sm" variant="neutral">{i.order_type}</Badge>
                  <span className="cell-sub">{qtyFmt(i.qty)} {i.unit} · {i.orders} order(s)</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cell-sub">No orders yet.</p>
          )}

          <div className="crm-facts">
            <div><span>Owner</span><strong>{c.owner_name || '—'}</strong><small>{c.owner_contact_no || ''}</small></div>
            <div><span>Sales person</span><strong>{c.sales_person_name || c.sales_person_emp_id || '—'}</strong></div>
            <div><span>Location</span><strong>{[c.city, c.state].filter(Boolean).join(', ') || '—'}</strong><small>{c.zone || ''}</small></div>
            <div><span>Client since</span><strong>{dayFmt(c.created_at)}</strong></div>
          </div>
        </>
      )}

      {tab === 'orders' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Date</th><th>Order</th><th>Type</th><th className="num">Items</th><th className="num">Qty</th><th className="num">Value</th><th>Stage</th></tr>
            </thead>
            <tbody>
              {p.orders.map((o) => (
                <tr key={o.id}>
                  <td>{dayFmt(o.created_at)}</td>
                  <td className="mono mono--plain">{o.system_order_no || o.enquiry_number}</td>
                  <td><Badge size="sm" variant="neutral">{o.order_type}</Badge></td>
                  <td className="num">{o.item_count}</td>
                  <td className="num">{qtyFmt(o.total_qty)}</td>
                  <td className="num">{o.value != null ? inr(o.value) : <span className="cell-sub">—</span>}</td>
                  <td>{o.status === 'ACTIVE' ? STAGE_LABELS[o.workflow_status] || o.workflow_status : <Badge size="sm" variant={o.status === 'CANCELLED' ? 'danger' : 'warning'}>{o.status}</Badge>}</td>
                </tr>
              ))}
              {!p.orders.length && <tr><td colSpan={7} className="cell-sub">No orders yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'items' && (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Item</th><th>Type</th><th className="num">Orders</th><th className="num">Total qty</th><th>Last ordered</th></tr>
            </thead>
            <tbody>
              {p.top_items.map((i) => (
                <tr key={`${i.item}-${i.order_type}`}>
                  <td className="cell-wrap">{i.item}</td>
                  <td><Badge size="sm" variant="neutral">{i.order_type}</Badge></td>
                  <td className="num">{i.orders}</td>
                  <td className="num">{qtyFmt(i.qty)} {i.unit}</td>
                  <td>{dayFmt(i.last_at)}</td>
                </tr>
              ))}
              {!p.top_items.length && <tr><td colSpan={5} className="cell-sub">No items ordered yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'payments' && (
        <>
          <h4 className="crm-pay__title">
            Paid bills (Tally)
            {ph.bills > 0 && <span className="cell-sub"> · {ph.bills} bills · {ph.on_time_pct}% on time · {ph.late} late ({ph.late_30} over 30 days) · max {ph.max_late_days} days late{ph.recent_on_time_pct != null && ` · last 20: ${ph.recent_on_time_pct}% on time`}</span>}
          </h4>
          {p.sources.tally_payments ? (
            <div className="table-wrap cprofile__paid">
              <table className="table">
                <thead>
                  <tr><th>Receipt Date</th><th>Bill Ref No</th><th>Bill Date</th><th className="num">Credit Days</th><th>Due Date</th><th className="num">Early / Late</th><th className="num">Receipt Total</th></tr>
                </thead>
                <tbody>
                  {pay.paid_bills.map((b, i) => (
                    <tr key={`${b.bill_reference}-${i}`}>
                      <td>{dayFmt(b.receipt_date)}</td>
                      <td className="mono mono--plain">{b.bill_reference || '—'}</td>
                      <td>{dayFmt(b.bill_date)}</td>
                      <td className="num">{b.credit_days ?? '—'}</td>
                      <td>{dayFmt(b.due_date)}</td>
                      <td className="num"><PaidLateBadge days={b.days_late} /></td>
                      <td className="num">{inr(b.receipt_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <Pending icon={FileSpreadsheet} title="No paid bills found">
              No bill in Payment › Paid Bills has this party name. The match is by name — the Tally party name must equal the company name in Client Master.
            </Pending>
          )}
          <h4 className="crm-pay__title">Open bills (latest Bills Receivable sync)</h4>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Bill Ref</th><th>Bill Date</th><th>Due Date</th><th className="num">Overdue</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {pay.bills.map((b, i) => (
                  <tr key={`${b.bill_reference}-${i}`}>
                    <td className="mono mono--plain">{b.bill_reference || '—'}</td>
                    <td>{dayFmt(b.bill_date)}</td>
                    <td>{dayFmt(b.due_date)}</td>
                    <td className="num">{b.days_overdue > 0 ? <Badge size="sm" variant={b.days_overdue > 90 ? 'danger' : 'warning'}>{b.days_overdue} days</Badge> : <span className="cell-sub">Not due</span>}</td>
                    <td className="num">{inr(b.amount)}</td>
                  </tr>
                ))}
                {!pay.bills.length && <tr><td colSpan={5} className="cell-sub">No open bills.</td></tr>}
              </tbody>
            </table>
          </div>

          <h4 className="crm-pay__title">Payment promises <span className="cell-sub">· {pay.promises_approved} approved · {pay.promises_rejected} rejected</span></h4>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Submitted</th><th>Order</th><th className="num">Pending</th><th>Promise</th><th>Status</th><th>Remark</th></tr>
              </thead>
              <tbody>
                {pay.promises.map((r) => (
                  <tr key={r.id}>
                    <td>{stampFmt(r.submitted_at)}</td>
                    <td className="mono mono--plain">{r.order_no}</td>
                    <td className="num">{inr(r.pending_amount)}</td>
                    <td>{inr(r.promise_amount)} by {dayFmt(r.promise_date)}{r.customer_note && <div className="cell-sub">{r.customer_note}</div>}</td>
                    <td><Badge size="sm" variant={PROMISE_VARIANT[r.status]}>{r.status}</Badge>{r.decided_by && <div className="cell-sub">{r.decided_by}</div>}</td>
                    <td className="cell-wrap">{r.decision_remark || <span className="cell-sub">—</span>}</td>
                  </tr>
                ))}
                {!pay.promises.length && <tr><td colSpan={6} className="cell-sub">No payment promises.</td></tr>}
              </tbody>
            </table>
          </div>

          <h4 className="crm-pay__title">Advance payments</h4>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr><th>Received</th><th>Order</th><th className="num">Amount</th><th>Reference</th><th>By</th></tr>
              </thead>
              <tbody>
                {pay.advances.map((a, i) => (
                  <tr key={i}>
                    <td>{stampFmt(a.received_at)}</td>
                    <td className="mono mono--plain">{a.order_no}</td>
                    <td className="num">{inr(a.amount)}</td>
                    <td>{a.reference}{a.remark && <div className="cell-sub">{a.remark}</div>}</td>
                    <td>{a.received_by || '—'}</td>
                  </tr>
                ))}
                {!pay.advances.length && <tr><td colSpan={5} className="cell-sub">No advance payments.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'talks' && (
        <>
          {!p.sources.runo_calls && (
            <Pending icon={PhoneCall} title="Calls (Runo)">
              Not connected yet. Once Runo is connected, every call with this customer and its transcript shows here.
            </Pending>
          )}
          <h4 className="crm-pay__title">Remarks across orders</h4>
          {p.remarks.length ? (
            <ul className="remarks__list">
              {p.remarks.map((r) => (
                <li key={r.id}>
                  <div className="remarks__meta">
                    <Badge size="sm" variant="brand">{STAGE_LABELS[r.stage] || r.stage}</Badge>
                    <span className="mono mono--plain">{r.order_no}</span>
                    <span className="cell-sub">{r.by || '—'} · {stampFmt(r.at)}</span>
                  </div>
                  <p>{r.remark}</p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="cell-sub">No remarks yet.</p>
          )}
        </>
      )}
    </div>
  );
}

/** Top tabs of the Payment Check / Stock Check modals: the stage itself, the customer's History, and Suggestion. */
export function ViewTabs({ value, onChange, first }) {
  const tabs = [
    { key: 'check', label: first },
    { key: 'history', label: 'History' },
    { key: 'suggestion', label: 'Suggestion' },
  ];
  return (
    <div className="segmented cprofile__views" role="tablist" aria-label="View">
      {tabs.map((t) => (
        <button key={t.key} type="button" role="tab" aria-selected={value === t.key} className={value === t.key ? 'is-active' : ''} onClick={() => onChange(t.key)}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

/** AI suggestion (how to talk to the customer / what alternatives to offer) — OpenAI is the next step. */
export function SuggestionPanel() {
  return (
    <Pending icon={Sparkles} title="AI suggestion">
      Coming next: OpenAI will read this customer&apos;s payment record, orders and conversations and suggest how to talk to them
      (and, in Stock Check, which alternatives to offer).
    </Pending>
  );
}

/** Profile in its own modal — opened by clicking a customer's name. */
export function CustomerProfileModal({ client, onClose }) {
  return (
    <Modal open size="xl" onClose={onClose} title={client.company_name} subtitle={`${client.client_id || ''} · Customer Profile`}>
      <CustomerProfile clientId={client.id} />
    </Modal>
  );
}

/** A customer's name that opens the profile (stops the row click underneath). */
export function CustomerName({ client, className = '' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={`link-btn ${className}`}
        title="Open customer profile"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {client.company_name}
      </button>
      {/* the modal is a portal, but React events still bubble to the row underneath */}
      {open && <span onClick={(e) => e.stopPropagation()}><CustomerProfileModal client={client} onClose={() => setOpen(false)} /></span>}
    </>
  );
}
