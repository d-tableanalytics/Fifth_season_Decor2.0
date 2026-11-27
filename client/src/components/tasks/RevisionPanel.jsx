import { useState } from 'react';
import { Button } from '../ui/Button';
import { useToast } from '../../context/ToastContext';
import { tasksApi } from '../../api/tasks';
import { Badge2, fmtDT, errMsg } from './taskUi';

const SOURCE = { request: 'Asked by assignee', assigner: 'Changed by assigner', send_back: 'Sent back with a new deadline' };

/** Deadline revisions panel of a delegation (spec 18.3). `d` = delegation detail. */
export function RevisionPanel({ d, isAssigner, isAssignee, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [asking, setAsking] = useState(false);
  const [nd, setNd] = useState('');
  const [reason, setReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [remark, setRemark] = useState('');
  const [alt, setAlt] = useState('');
  const [hist, setHist] = useState(false);

  const pending = d.pending_revision;
  const canAsk = isAssignee && d.status === 'pending' && !pending;
  if (!d.revisions && !pending && !canAsk) return null;

  const run = async (fn) => {
    setBusy(true);
    try { await fn(); await onChange(); } catch (e) { toast.error('Could not save', errMsg(e)); } finally { setBusy(false); }
  };
  const log = d.revision_log || [];
  return (
    <section className="tk-sec">
      <h4>Deadline revisions · {d.revisions ? `revised ${d.revisions} time${d.revisions === 1 ? '' : 's'}` : 'never revised'}</h4>

      {pending && (
        <div className="tk-box tk-box--purple">
          <p><strong>{pending.requested_by_name}</strong> asks for <strong>{fmtDT(pending.new_deadline, true)}</strong> (now {fmtDT(pending.old_deadline, true)})</p>
          {pending.reason && <p className="tk-muted">{pending.reason}</p>}
          {isAssigner ? (
            rejecting ? (
              <>
                <label className="field__label">Why is it rejected?</label>
                <textarea className="field__input" rows={2} maxLength={500} value={remark} onChange={(e) => setRemark(e.target.value)} />
                <div className="tk-actions">
                  <Button size="sm" variant="secondary" onClick={() => setRejecting(false)}>Cancel</Button>
                  <Button size="sm" variant="danger" loading={busy} onClick={() => run(() => tasksApi.decideRevision(d.id, pending.id, { approve: false, remark }))}>Reject</Button>
                </div>
              </>
            ) : (
              <>
                <label className="field__label">Approve with another deadline (optional)</label>
                <input className="field__input" type="datetime-local" value={alt} onChange={(e) => setAlt(e.target.value)} />
                <div className="tk-actions">
                  <Button size="sm" loading={busy} onClick={() => run(() => tasksApi.decideRevision(d.id, pending.id, { approve: true, ...(alt && { new_deadline: alt }) }))}>✓ Approve</Button>
                  <Button size="sm" variant="secondary" onClick={() => setRejecting(true)}>Reject</Button>
                </div>
              </>
            )
          ) : <p className="tk-muted">Waiting for the assigner to decide.</p>}
        </div>
      )}

      {canAsk && (asking ? (
        <div className="tk-box">
          <label className="field__label">New deadline</label>
          <input className="field__input" type="datetime-local" value={nd} onChange={(e) => setNd(e.target.value)} />
          <label className="field__label">Why is more time needed?</label>
          <textarea className="field__input" rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="tk-actions">
            <Button size="sm" variant="secondary" onClick={() => setAsking(false)}>Cancel</Button>
            <Button size="sm" loading={busy} onClick={() => run(async () => { await tasksApi.requestRevision(d.id, { new_deadline: nd, reason }); setAsking(false); setNd(''); setReason(''); })}>Send request</Button>
          </div>
        </div>
      ) : <button type="button" className="tk-link" onClick={() => setAsking(true)}>↻ Request deadline revision</button>)}

      {log.length > 0 && (
        <>
          <button type="button" className="tk-link" onClick={() => setHist((v) => !v)}>{hist ? 'Hide' : 'Show'} history ({log.length})</button>
          {hist && (
            <ul className="tk-hist">
              {log.map((r) => (
                <li key={r.id}>
                  <div>{fmtDT(r.old_deadline, true)} → <strong>{fmtDT(r.new_deadline, true)}</strong>{' '}
                    <Badge2 tone={r.status === 'approved' ? 'green' : r.status === 'rejected' ? 'red' : 'purple'}>{r.status === 'approved' ? 'Approved' : r.status === 'rejected' ? 'Rejected' : 'Pending'}</Badge2></div>
                  <small>{SOURCE[r.source]}{r.requested_by_name ? ` · ${r.requested_by_name}` : ''}{r.reason ? ` · ${r.reason}` : ''}</small>
                  {r.decided_by_name && <small>Decided by {r.decided_by_name}{r.decision_remark ? `: ${r.decision_remark}` : ''}</small>}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
