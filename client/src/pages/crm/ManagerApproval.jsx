import { useCallback, useEffect, useState } from 'react';
import { Search, ShieldCheck, Check, X } from 'lucide-react';
import { crmApi, inr, dayFmt, stampFmt } from '../../api/crm';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Skeleton } from '../../components/ui/Loader';
import { Modal } from '../../components/ui/Modal';
import { Pagination, Textarea } from '../../components/ui/FormControls';

const TABS = [
  { key: 'pending', label: 'Pending' },
  { key: 'approved', label: 'Approved' },
  { key: 'rejected', label: 'Rejected' },
];
const TYPES = [
  { key: '', label: 'Cut & Roll' },
  { key: 'CUT', label: 'Cut' },
  { key: 'ROLL', label: 'Roll' },
];

/** Manager Approval — customers' payment promises and the manager's decisions. */
export default function ManagerApproval() {
  const { can } = useAuth();
  const toast = useToast();
  const canDecide = can('crm_manager_approval', 'approve');
  const [tab, setTab] = useState('pending');
  const [type, setType] = useState('');
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText);
  const [page, setPage] = useState(1);
  const [result, setResult] = useState({ data: [], total: 0, counts: {} });
  const [loading, setLoading] = useState(true);
  const [decision, setDecision] = useState(null); // { row, approve }
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setResult(await crmApi.approvalList({ tab, page, limit: 25, type: type || undefined, search: search || undefined }));
    } catch (err) {
      toast.error('Could not load approvals', getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [tab, type, page, search, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const open = (row, approve) => {
    setRemark('');
    setDecision({ row, approve });
  };

  const submit = async () => {
    setBusy(true);
    try {
      const r = await crmApi.decide(decision.row.id, decision.approve, remark.trim() || null);
      toast.success(r.message, decision.row.enquiry_number);
      setDecision(null);
      load();
    } catch (err) {
      toast.error('Could not save decision', getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const pending = tab === 'pending';
  const cols = pending ? (canDecide ? 9 : 8) : 10;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Manager Approval</h2>
          <p className="page-header__sub">Payment promises from customers</p>
        </div>
      </div>

      <div className="card card--flush">
        <div className="toolbar">
          <div className="segmented" role="tablist" aria-label="Approval status">
            {TABS.map((t) => (
              <button key={t.key} role="tab" aria-selected={tab === t.key} className={tab === t.key ? 'is-active' : ''} onClick={() => { setTab(t.key); setPage(1); }}>
                {t.label}
                <span className="segmented__count">{result.counts?.[t.key] ?? 0}</span>
              </button>
            ))}
          </div>
          <select className="toolbar__select" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }} aria-label="Order type">
            {TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
          <label className="toolbar__search">
            <Search size={15} />
            <input type="search" placeholder="Search enquiry no. or client…" value={searchText} onChange={(e) => { setSearchText(e.target.value); setPage(1); }} />
          </label>
        </div>

        <div className="table-wrap table-wrap--flush">
          <table className="table">
            <thead>
              <tr>
                <th>Submitted</th>
                <th>Enquiry No</th>
                <th>Client</th>
                <th className="num">Pending</th>
                <th>Promise Date</th>
                <th className="num">Promise Amount</th>
                <th>Customer Note</th>
                {pending ? (
                  <th>Order</th>
                ) : (
                  <>
                    <th>Decided</th>
                    <th>By</th>
                    <th>Remark</th>
                  </>
                )}
                {pending && canDecide && <th className="num">Actions</th>}
              </tr>
            </thead>
            <tbody>
              {loading
                ? Array.from({ length: 6 }).map((_, i) => (
                    <tr key={i}>{Array.from({ length: cols }).map((__, j) => <td key={j}><Skeleton width={j === 2 ? 170 : 70} /></td>)}</tr>
                  ))
                : result.data.map((r) => {
                    const decidable = r.order_status === 'ACTIVE' && r.workflow_status === 'PAYMENT_CHECK';
                    return (
                      <tr key={r.id}>
                        <td className="cell-sub">{stampFmt(r.submitted_at)}</td>
                        <td>
                          <span className="mono">{r.enquiry_number}</span>{' '}
                          <Badge size="sm" variant="neutral">{r.order_type === 'CUT' ? 'Cut' : 'Roll'}</Badge>
                        </td>
                        <td className="cell-wrap cell-main">
                          <span className="mono mono--plain">{r.client_id}</span> {r.company_name}
                        </td>
                        <td className="num">{inr(r.pending_amount)}<div className="cell-sub">{r.pending_bills} bill(s)</div></td>
                        <td>{dayFmt(r.promise_date)}</td>
                        <td className="num">{inr(r.promise_amount)}</td>
                        <td className="cell-wrap">{r.customer_note || <span className="cell-sub">—</span>}</td>
                        {pending ? (
                          <td>{decidable ? <Badge size="sm" variant="warning">Awaiting decision</Badge> : <Badge size="sm" variant="danger">{r.order_status === 'ON_HOLD' ? 'On hold' : 'Not at Payment Check'}</Badge>}</td>
                        ) : (
                          <>
                            <td className="cell-sub">{stampFmt(r.decided_at)}</td>
                            <td>{r.decided_by || '—'}</td>
                            <td className="cell-wrap">{r.decision_remark || <span className="cell-sub">—</span>}</td>
                          </>
                        )}
                        {pending && canDecide && (
                          <td className="num">
                            <div className="row-actions">
                              <button className="icon-btn icon-btn--sm icon-btn--ok" title="Approve" aria-label="Approve" disabled={!decidable} onClick={() => open(r, true)}><Check size={15} /></button>
                              <button className="icon-btn icon-btn--sm icon-btn--danger" title="Reject" aria-label="Reject" disabled={!decidable} onClick={() => open(r, false)}><X size={15} /></button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
            </tbody>
          </table>
          {!loading && result.data.length === 0 && (
            <div className="empty empty--inline">
              <span className="empty__icon"><ShieldCheck size={22} /></span>
              <h2>{search ? 'No matching requests' : pending ? 'No requests waiting for approval' : `No ${tab} requests`}</h2>
            </div>
          )}
        </div>
        {result.total > 0 && <Pagination page={page} limit={25} total={result.total} onPage={setPage} />}
      </div>

      <Modal
        open={!!decision}
        busy={busy}
        onClose={() => setDecision(null)}
        title={decision?.approve ? 'Approve payment promise?' : 'Reject payment promise?'}
        subtitle={decision ? `${decision.row.enquiry_number} · ${decision.row.company_name}` : ''}
        footer={
          <>
            <Button variant="secondary" onClick={() => setDecision(null)} disabled={busy}>Cancel</Button>
            <Button
              variant={decision?.approve ? 'primary' : 'danger'}
              loading={busy}
              disabled={!decision?.approve && !remark.trim()}
              onClick={submit}
            >
              {decision?.approve ? 'Approve' : 'Reject'}
            </Button>
          </>
        }
      >
        {decision && (
          <>
            <p className="cell-sub" style={{ marginBottom: 12 }}>
              Promise: <strong>{inr(decision.row.promise_amount)}</strong> by <strong>{dayFmt(decision.row.promise_date)}</strong> against {inr(decision.row.pending_amount)} pending.{' '}
              {decision.approve ? 'The order will move to Stock Check.' : 'The order stays at Payment Check as pending and CRM can send a new link.'}
            </p>
            <Textarea
              label={decision.approve ? 'Remark (optional)' : 'Reason for rejection'}
              required={!decision.approve}
              rows={3}
              maxLength={1000}
              value={remark}
              onChange={(e) => setRemark(e.target.value)}
            />
          </>
        )}
      </Modal>
    </div>
  );
}
