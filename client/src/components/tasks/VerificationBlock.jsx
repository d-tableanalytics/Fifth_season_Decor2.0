import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/Button';
import { useToast } from '../../context/ToastContext';
import { tasksApi } from '../../api/tasks';
import { fmtDT, errMsg } from './taskUi';

const dayLabel = (s) =>
  new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })
    .format(new Date(`${s}T12:00:00+05:30`)).replace(/^(\w+) /, '$1, ');

/** Verification overview + batch verify of a checklist (spec 18.3). */
export function VerificationBlock({ cl, reloadKey, onChange }) {
  const toast = useToast();
  const [v, setV] = useState(null);
  const [remark, setRemark] = useState('');
  const [busy, setBusy] = useState(false);
  const [showVerified, setShowVerified] = useState(false);

  const load = useCallback(() => tasksApi.checklistVerification(cl.id).then(setV).catch(() => setV(null)), [cl.id]);
  useEffect(() => { load(); }, [load, reloadKey]);
  if (!cl.verification_required || !v) return null;

  const batch = async (approve) => {
    if (!approve && !remark.trim()) { window.alert('Write why they are sent back'); return; }
    setBusy(true);
    try {
      await tasksApi.verifyBatch({ checklist_id: cl.id, approve, remark });
      setRemark('');
      await onChange();
    } catch (e) { toast.error('Could not save', errMsg(e)); } finally { setBusy(false); }
  };

  return (
    <section className="tk-sec">
      <h4>Verification · {v.schedule}</h4>
      <p className="tk-muted">
        To verify now: <strong>{v.to_verify.length}</strong> · waiting for their verification day: <strong>{v.waiting.length}</strong>
        {v.next_on ? ` (next: ${dayLabel(v.next_on)})` : ''} · verified: <strong>{v.verified.length}</strong>
      </p>
      {v.to_verify.length > 0 && (
        <ul className="tk-hist">{v.to_verify.map((t) => <li key={t.id}>{fmtDT(t.due_at)}{t.note ? <small>{t.note}</small> : null}</li>)}</ul>
      )}
      {v.can_verify && v.to_verify.length > 0 && (
        <div className="tk-box tk-box--purple">
          <input className="field__input" placeholder="Remark (needed to send back)" maxLength={500} value={remark} onChange={(e) => setRemark(e.target.value)} />
          <div className="tk-actions">
            <Button size="sm" loading={busy} onClick={() => batch(true)}>{`Verify all (${v.to_verify.length})`}</Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => batch(false)}>Send all back</Button>
          </div>
        </div>
      )}
      {v.waiting.map((t) => <p key={t.id} className="tk-muted">{fmtDT(t.due_at)} · To be verified on {dayLabel(t.verify_on)}</p>)}
      {v.verified.length > 0 && (
        <>
          <button type="button" className="tk-link" onClick={() => setShowVerified((x) => !x)}>Verified turns ({v.verified.length})</button>
          {showVerified && <ul className="tk-hist">{v.verified.map((t) => <li key={t.id}>{fmtDT(t.due_at)} · {t.status === 'completed' ? 'Verified' : 'Sent back'}{t.verify_remark ? <small>{t.verify_remark}</small> : null}</li>)}</ul>}
        </>
      )}
    </section>
  );
}
