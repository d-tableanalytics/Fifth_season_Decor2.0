import { useCallback, useEffect, useState } from 'react';
import { Search, Wallet, Send, Link2, RefreshCw, Phone, CheckCircle2, XCircle } from 'lucide-react';
import { crmApi, LEDGER_RECIPIENTS, inr, dayFmt, stampFmt } from '../../api/crm';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton, Loader } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { Pagination } from '../../components/ui/FormControls';
import { RemarksSection } from '../../components/o2d/RemarksSection';
import { CustomerName, CustomerProfile, SuggestionPanel, ViewTabs } from '../../components/clients/CustomerProfile';

const TABS = [
  { key: 'awaiting', label: 'Awaiting Customer' },
  { key: 'pending_approval', label: 'Pending Manager Approval' },
];

/** Payment Check tab of CRM › Cut / Roll. */
export default function PaymentCheck({ type = 'CUT' }) {
  const toast = useToast();
  const [tab, setTab] = useState('awaiting');
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0, counts: {} });
  const [loading, setLoading] = useState(true);
  const [openId, setOpenId] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await crmApi.paymentList({ type, tab, page, limit: 25, search: search || undefined }));
    } catch (err) {
      toast.error('Could not load orders', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [type, tab, page, search, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const pendingTab = tab === 'pending_approval';

  return (
    <>
      <div className="card card--flush">
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Payment status">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => { setTab(t.key); setPage(1); }}>
                {t.label}
                <span className="segmented__count">{result.counts?.[t.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search enquiry no. or client…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
          </label>
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table table--clickable">
            <thead>
              <tr>
                <th>{pendingTab ? 'Submitted' : 'Came In'}</th>
                <th>Enquiry No</th>
                <th>Client ID</th>
                <th>Client</th>
                <th className="num">Pending Bills</th>
                <th className="num">Pending Amount</th>
                {pendingTab ? (
                  <>
                    <th>Promise Date</th>
                    <th className="num">Promise Amount</th>
                  </>
                ) : (
                  <th>Ledger Sent</th>
                )}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: pendingTab ? 8 : 7 }).map((__, j) => <td key={j}><Skeleton width={j === 3 ? 180 : 70} /></td>)}</tr>
                  ))
                : result.data.map((o) => (
                    <tr key={o.id} onClick={() => setOpenId(o.id)}>
                      <td className="cell-sub">{stampFmt(pendingTab ? o.submitted_at : o.checked_at)}</td>
                      <td className="mono">{o.enquiry_number}</td>
                      <td className="mono mono--plain">{o.client_id}</td>
                      <td className="cell-wrap cell-main"><CustomerName client={{ id: o.client_ref, client_id: o.client_id, company_name: o.company_name }} /></td>
                      <td className="num">{o.pending_bills}</td>
                      <td className="num">{inr(o.pending_amount)}</td>
                      {pendingTab ? (
                        <>
                          <td>{dayFmt(o.promise_date)}</td>
                          <td className="num">{inr(o.promise_amount)}</td>
                        </>
                      ) : (
                        <td>{o.link_sent_at ? <Badge size="sm" variant="info">{stampFmt(o.link_sent_at)}</Badge> : <Badge size="sm" variant="warning">Not sent</Badge>}</td>
                      )}
                    </tr>
                  ))}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><Wallet size={22} /></span>
              <h2>{search ? 'No matching orders' : pendingTab ? 'No promises waiting for approval' : 'No orders waiting for payment'}</h2>
            </div>
          )}
        </div>
        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      </div>

      {openId && (
        <PaymentCheckModal
          id={openId}
          onClose={() => setOpenId(null)}
          onChanged={load}
        />
      )}
    </>
  );
}

function PaymentCheckModal({ id, onClose, onChanged }) {
  const { can } = useAuth();
  const toast = useToast();
  const canEdit = can('crm_payment_check', 'edit');
  const [d, setD] = useState(null);
  const [recipients, setRecipients] = useState(['CLIENT_OWNER']);
  const [busy, setBusy] = useState('');
  const [link, setLink] = useState('');
  const [results, setResults] = useState(null);
  const [view, setView] = useState('check');

  const load = useCallback(() => crmApi.payment(id).then(setD).catch((err) => {
    toast.error('Could not open order', getErrorMessage(err));
    onClose();
  }), [id, toast, onClose]);

  useEffect(() => {
    load();
  }, [load]);

  const awaiting = d?.payment_status === 'AWAITING_CUSTOMER';

  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success('Link copied');
    } catch {
      toast.info('Copy the link from the box');
    }
  };

  const doLink = async () => {
    setBusy('link');
    try {
      const r = await crmApi.paymentLink(id);
      setLink(r.link);
      copy(r.link);
    } catch (err) {
      toast.error('Could not create link', getErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const doSend = async () => {
    setBusy('send');
    try {
      const r = await crmApi.sendLedger(id, recipients);
      setLink(r.link);
      setResults(r.results);
      const sent = r.results.filter((x) => x.status === 'SENT').length;
      if (sent) toast.success('Ledger sent on WhatsApp', `${sent} of ${r.results.length} recipient(s)`);
      else toast.error('Nothing was sent', 'See the reasons below');
      load();
      onChanged();
    } catch (err) {
      toast.error('Could not send ledger', getErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const doRecheck = async () => {
    setBusy('recheck');
    try {
      const r = await crmApi.recheck(id);
      toast.success(r.message);
      onChanged();
      if (r.data.moved) onClose();
      else load();
    } catch (err) {
      toast.error('Could not re-check bills', getErrorMessage(err));
    } finally {
      setBusy('');
    }
  };

  const contacts = d
    ? [
        { label: 'Owner', name: d.owner_name, phone: d.owner_whatsapp_no || d.owner_contact_no },
        { label: 'Accountant', name: d.accounts_person_name, phone: d.accounts_person_whatsapp_no },
        { label: 'Sales person', name: d.customer_sales_person_name, phone: d.customer_sales_person_whatsapp_no || d.customer_sales_person_contact },
      ]
    : [];

  return (
    <Modal open size="xl" onClose={onClose} busy={!!busy} title={d ? `${d.enquiry_number} · Payment Check` : 'Payment Check'} subtitle={d ? `${d.client_id} — ${d.company_name}` : ''}>
      {!d ? (
        <Loader label="Loading…" />
      ) : (
      <>
        <ViewTabs value={view} onChange={setView} first="Payment Check" />
        {view === 'history' ? (
          <CustomerProfile clientId={d.client_ref} />
        ) : view === 'suggestion' ? (
          <SuggestionPanel />
        ) : (
        <div className="crm-pay">
          <div className="crm-facts">
            <div><span>Status</span><Badge size="sm" variant={awaiting ? 'warning' : 'info'}>{awaiting ? 'Awaiting customer' : 'Pending manager approval'}</Badge></div>
            <div><span>Pending</span><strong>{inr(d.bills_total)}</strong><small>{d.bills.length} bill(s)</small></div>
            <div><span>Ledger sent</span><strong>{d.link_sent_at ? stampFmt(d.link_sent_at) : '—'}</strong>{d.link_sent_by && <small>by {d.link_sent_by}</small>}</div>
            {!awaiting && (
              <div><span>Promise</span><strong>{inr(d.promise_amount)} by {dayFmt(d.promise_date)}</strong>{d.customer_note && <small>{d.customer_note}</small>}</div>
            )}
          </div>

          <h4 className="crm-pay__title">Call the client</h4>
          <ul className="crm-contacts">
            {contacts.map((c) => (
              <li key={c.label}>
                <span className="cell-sub">{c.label}</span>
                <span>{c.name || '—'}</span>
                {c.phone ? <a className="inline-link" href={`tel:${c.phone}`}><Phone size={13} /> {c.phone}</a> : <span className="cell-sub">No number</span>}
              </li>
            ))}
            <li>
              <span className="cell-sub">WhatsApp group</span>
              <span>{d.whatsapp_group_name || (d.whatsapp_group_id ? 'Linked' : '—')}</span>
              <span className="cell-sub">{d.whatsapp_group_id ? 'Linked' : 'Not linked'}</span>
            </li>
          </ul>

          <h4 className="crm-pay__title">Pending invoices (ledger)</h4>
          <div className="table-wrap crm-pay__bills">
            <table className="table">
              <thead>
                <tr><th>#</th><th>Bill Ref</th><th>Bill Date</th><th>Due Date</th><th className="num">Overdue</th><th className="num">Amount</th></tr>
              </thead>
              <tbody>
                {d.bills.map((b, i) => (
                  <tr key={`${b.bill_reference}-${i}`}>
                    <td className="cell-sub">{i + 1}</td>
                    <td className="mono mono--plain">{b.bill_reference || '—'}</td>
                    <td>{dayFmt(b.bill_date)}</td>
                    <td>{dayFmt(b.due_date)}</td>
                    <td className="num">{b.days_overdue > 0 ? <Badge size="sm" variant={b.days_overdue > 90 ? 'danger' : 'warning'}>{b.days_overdue} days</Badge> : <span className="cell-sub">Not due</span>}</td>
                    <td className="num">{inr(b.amount)}</td>
                  </tr>
                ))}
                {!d.bills.length && <tr><td colSpan={6} className="cell-sub">No pending bills in the latest Bills Receivable sync — use Re-check bills.</td></tr>}
              </tbody>
              {d.bills.length > 0 && (
                <tfoot><tr><td colSpan={5}><strong>Total</strong></td><td className="num"><strong>{inr(d.bills_total)}</strong></td></tr></tfoot>
              )}
            </table>
          </div>

          {canEdit && awaiting && (
            <>
              <h4 className="crm-pay__title">Send ledger + customer link on WhatsApp</h4>
              <div className="chip-select">
                {LEDGER_RECIPIENTS.map((r) => (
                  <button key={r.key} type="button" className={`chip-select__chip ${recipients.includes(r.key) ? 'is-on' : ''}`}
                    onClick={() => setRecipients((x) => (x.includes(r.key) ? x.filter((k) => k !== r.key) : [...x, r.key]))}>
                    {r.label}
                  </button>
                ))}
              </div>
              <p className="cell-sub crm-pay__hint">The customer opens the link, picks a promise payment date and amount, and sends it for manager approval. A new link replaces the old one.</p>
            </>
          )}

          {link && (
            <div className="crm-link">
              <input readOnly value={link} onFocus={(e) => e.target.select()} aria-label="Customer link" />
              <Button size="sm" variant="secondary" icon={Link2} onClick={() => copy(link)}>Copy</Button>
            </div>
          )}

          {results && (
            <ul className="sync-history">
              {results.map((r) => (
                <li key={r.type}>
                  {r.status === 'SENT' ? <CheckCircle2 size={15} className="ok" /> : <XCircle size={15} className="bad" />}
                  <span className="sync-history__what">
                    {r.label} {r.to ? <span className="mono mono--plain">→ {r.to}</span> : ''}
                    {r.status !== 'SENT' && <small> — {r.error || r.reason}</small>}
                  </span>
                  <span className="sync-history__meta">{r.status}</span>
                </li>
              ))}
            </ul>
          )}

          <RemarksSection orderId={id} />

          {canEdit && (
            <div className="form-card__foot crm-pay__actions">
              <Button variant="ghost" icon={RefreshCw} loading={busy === 'recheck'} disabled={!!busy} onClick={doRecheck}>Re-check bills</Button>
              {awaiting && (
                <>
                  <Button variant="secondary" icon={Link2} loading={busy === 'link'} disabled={!!busy} onClick={doLink}>Get link only</Button>
                  <Button icon={Send} loading={busy === 'send'} disabled={!!busy || !recipients.length || !d.bills.length} onClick={doSend}>Send on WhatsApp</Button>
                </>
              )}
            </div>
          )}
        </div>
        )}
      </>
      )}
    </Modal>
  );
}
