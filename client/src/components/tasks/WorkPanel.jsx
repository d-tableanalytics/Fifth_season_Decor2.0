import { useRef, useState } from 'react';
import { X } from 'lucide-react';
import { Button } from '../ui/Button';
import { useToast } from '../../context/ToastContext';
import { fileSize, errMsg } from './taskUi';

/**
 * The doer's / verifier's work area for one delegation or one checklist turn.
 * Every on* callback returns a promise (the parent reloads the task); failures show as an error toast.
 */
export function WorkPanel({
  cps, status, evidenceRequired, verificationRequired, files = [], note, remark,
  canWork, canVerify, canRevert, nf = {}, onTick, onComplete, onVerify, onUpload, onDeleteFile, onNonFunctional, onRevert,
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [noteIn, setNoteIn] = useState('');
  const [nfOpen, setNfOpen] = useState(false);
  const [nfReason, setNfReason] = useState('');
  const [sbOpen, setSbOpen] = useState(false);
  const [sbRemark, setSbRemark] = useState('');
  const [sbDeadline, setSbDeadline] = useState('');
  const fileRef = useRef(null);

  const open = status === 'pending';
  const done = cps.filter((c) => c.done).length;
  const allTicked = done === cps.length;
  const evOk = !evidenceRequired || files.length > 0;
  const run = async (fn) => {
    setBusy(true);
    try { await fn(); } catch (e) { toast.error('Could not save', errMsg(e)); } finally { setBusy(false); }
  };
  const tick = (i, v) => run(() => onTick(cps.map((c, j) => (j === i ? v : c.done))));
  const hint = [!allTicked && 'Tick every checkpoint first.', !evOk && 'Upload the evidence first.'].filter(Boolean).join(' ');

  return (
    <div className="tk-work">
      {cps.length > 0 && (
        <div>
          <p className="tk-sub">Checkpoints <span className="tk-muted">{done} / {cps.length}</span></p>
          {cps.map((c, i) => (
            <label key={i} className="tk-cp">
              <input type="checkbox" checked={c.done} disabled={!(open && canWork) || busy} onChange={(e) => tick(i, e.target.checked)} />
              <span className={c.done ? 'is-done' : ''}>{c.text}</span>
            </label>
          ))}
        </div>
      )}

      {(evidenceRequired || files.length > 0) && (
        <div>
          <p className="tk-sub">Evidence {evidenceRequired && <span className="tk-req">required</span>}</p>
          <ul className="tk-files">
            {files.map((x) => (
              <li key={x.id}><a href={x.url} target="_blank" rel="noreferrer">{x.name}</a> <small>{fileSize(x.size)}</small>
                {open && (canWork || canVerify) && <button type="button" className="icon-btn" aria-label="Delete file" onClick={() => run(() => onDeleteFile(x.id))}><X size={14} /></button>}
              </li>
            ))}
          </ul>
          {open && canWork && (
            <>
              <input ref={fileRef} type="file" multiple hidden onChange={(e) => { const l = [...e.target.files]; e.target.value = ''; if (l.length) run(() => onUpload(l)); }} />
              <Button size="sm" variant="secondary" loading={busy} onClick={() => fileRef.current.click()}>Upload evidence</Button>
            </>
          )}
        </div>
      )}

      {note && <p className="tk-line"><strong>Note from the doer:</strong> {note}</p>}
      {remark && <p className="tk-line tk-line--orange"><strong>Assigner’s remark:</strong> {remark}</p>}

      {status === 'non_functional' && (
        <div className="tk-box tk-box--grey">
          <p><strong>Non functional:</strong> {nf.reason}</p>
          <p className="tk-muted">Not scored; kept as a separate record.</p>
          {canRevert && (
            <Button size="sm" variant="secondary" loading={busy}
              onClick={() => { if (window.confirm('Undo the non-functional mark? The turn goes back to pending.')) run(onRevert); }}>Undo non-functional</Button>
          )}
        </div>
      )}

      {open && canWork && nf.allowed && (
        nfOpen ? (
          <div className="tk-box">
            <input className="field__input" placeholder="e.g. machine was under repair" maxLength={500} value={nfReason} onChange={(e) => setNfReason(e.target.value)} />
            <p className="tk-muted">Why was it non-functional? (not scored)</p>
            <div className="tk-actions">
              <Button size="sm" variant="secondary" onClick={() => setNfOpen(false)}>Cancel</Button>
              <Button size="sm" loading={busy} onClick={() => run(async () => { await onNonFunctional(nfReason); setNfOpen(false); setNfReason(''); })}>Mark non-functional</Button>
            </div>
          </div>
        ) : (
          <button type="button" className="tk-link" onClick={() => setNfOpen(true)}>This task was non-functional today</button>
        )
      )}

      {open && canWork && (
        <div className="tk-box">
          <label className="field__label" htmlFor="tk-note">Note (optional)</label>
          <textarea id="tk-note" className="field__input" rows={2} maxLength={1000} placeholder="What was done" value={noteIn} onChange={(e) => setNoteIn(e.target.value)} />
          <div className="tk-actions">
            <Button loading={busy} disabled={!allTicked || !evOk} onClick={() => run(async () => { await onComplete(noteIn); setNoteIn(''); })}>
              {verificationRequired ? 'Submit for verification' : 'Mark as done'}
            </Button>
          </div>
          {hint && <p className="tk-muted">{hint}</p>}
        </div>
      )}

      {status === 'submitted' && canVerify && (
        <div className="tk-box tk-box--purple">
          {sbOpen ? (
            <>
              <label className="field__label">Why is it sent back?</label>
              <textarea className="field__input" rows={2} maxLength={500} value={sbRemark} onChange={(e) => setSbRemark(e.target.value)} />
              <label className="field__label">New deadline (optional — leave empty to keep the current one)</label>
              <input className="field__input" type="datetime-local" value={sbDeadline} onChange={(e) => setSbDeadline(e.target.value)} />
              <div className="tk-actions">
                <Button size="sm" variant="secondary" onClick={() => setSbOpen(false)}>Cancel</Button>
                <Button size="sm" variant="danger" loading={busy} onClick={() => run(async () => { await onVerify(false, sbRemark, sbDeadline); setSbOpen(false); })}>Send back</Button>
              </div>
            </>
          ) : (
            <div className="tk-actions">
              <Button size="sm" loading={busy} onClick={() => run(() => onVerify(true, '', ''))}>✓ Approve</Button>
              <Button size="sm" variant="secondary" onClick={() => setSbOpen(true)}>Send back</Button>
            </div>
          )}
        </div>
      )}
      {status === 'submitted' && !canVerify && <p className="tk-muted">Waiting for the assigner to verify.</p>}
    </div>
  );
}
