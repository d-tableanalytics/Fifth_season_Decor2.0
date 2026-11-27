import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, Paperclip } from 'lucide-react';
import { Button } from '../ui/Button';
import { ConfirmDialog } from '../ui/Modal';
import { useToast } from '../../context/ToastContext';
import { useAuth } from '../../context/AuthContext';
import { tasksApi } from '../../api/tasks';
import { WorkPanel } from './WorkPanel';
import { RevisionPanel } from './RevisionPanel';
import { VerificationBlock } from './VerificationBlock';
import {
  Badge2, DelegationStatus, PriorityChip, TurnStatus, fileSize, fmtD, fmtDT, istDateOf, reminderText, todayStr, errMsg,
} from './taskUi';

const needs = (d) => [d.evidence_required && 'Evidence', d.verification_required && 'Verification'].filter(Boolean).join(' + ') || 'Nothing extra';
const Fact = ({ k, children }) => (<div className="tk-fact"><span>{k}</span><strong>{children || '—'}</strong></div>);

function Reassignments({ list }) {
  if (!list?.length) return null;
  return (
    <section className="tk-sec">
      <h4>Reassignment history</h4>
      <ul className="tk-hist">
        {list.map((r) => (
          <li key={r.id}>
            <div>{r.is_return ? <>Returned to <strong>{r.to_name}</strong> · the period was over</> : <>{r.from_name} → <strong>{r.to_name}</strong> · by {r.by_name || 'System'}</>}</div>
            <small>{fmtDT(r.at, true)}{r.period_to ? ` · for ${fmtD(r.period_from || r.period_to)} to ${fmtD(r.period_to)}` : ''}{r.reason ? ` · ${r.reason}` : ''}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Slide-in task details (spec 18.3). target = { kind: 'delegation'|'checklist', id }. */
export function TaskDrawer({ target, onClose, onEdit, onChanged, onDeleted }) {
  const toast = useToast();
  const { user, can } = useAuth();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [openTurn, setOpenTurn] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const isCl = target.kind === 'checklist';
  const allEdit = can('tasks_all', 'edit');

  const load = useCallback(async () => {
    try {
      const r = await (isCl ? tasksApi.checklist : tasksApi.delegation)(target.id);
      setD(r);
      setError('');
      setTick((t) => t + 1);
    } catch (e) { setError(errMsg(e)); }
  }, [isCl, target.id]);
  useEffect(() => { setD(null); load(); }, [load]);
  useEffect(() => {
    const k = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', k);
    return () => document.removeEventListener('keydown', k);
  }, [onClose]);

  const changed = async () => { await load(); onChanged?.(); };
  const isAssigner = d && (d.assigner_id === user.id || allEdit);
  const isAssignee = d && (d.assignee_id === user.id || allEdit);

  const remove = async () => {
    setBusy(true);
    try { await (isCl ? tasksApi.deleteChecklist : tasksApi.deleteDelegation)(d.id); setConfirmDel(false); onDeleted?.(); }
    catch (e) { toast.error('Could not delete', errMsg(e)); } finally { setBusy(false); }
  };
  const toggleActive = async () => {
    try { await tasksApi.setChecklistActive(d.id, !d.active); await changed(); } catch (e) { toast.error('Could not save', errMsg(e)); }
  };

  const delegationWork = () => {
    const verifier = d.verifier_effective_id === user.id || allEdit;
    return (
      <WorkPanel
        cps={(d.checkpoints || []).map((c) => ({ text: c.text, done: !!c.done }))}
        status={d.status}
        evidenceRequired={d.evidence_required}
        verificationRequired={d.verification_required}
        files={(d.files || []).filter((x) => x.purpose === 'evidence')}
        note={d.completed_note}
        remark={d.verify_remark}
        canWork={isAssignee}
        canVerify={verifier}
        onTick={async (done) => { await tasksApi.tickDelegation(d.id, done); await changed(); }}
        onComplete={async (note) => { await tasksApi.completeDelegation(d.id, { note }); await changed(); }}
        onVerify={async (approve, remark, deadline) => { await tasksApi.verifyDelegation(d.id, { approve, remark, ...(deadline && { deadline }) }); await changed(); }}
        onUpload={async (files) => { await tasksApi.uploadFiles('delegation', d.id, 'evidence', files); await changed(); }}
        onDeleteFile={async (id) => { await tasksApi.deleteFile(id); await changed(); }}
      />
    );
  };

  const turnWork = (t) => (
    <WorkPanel
      cps={(d.checkpoints || []).map((text, i) => ({ text, done: !!t.checkpoints_done?.[i] }))}
      status={t.status}
      evidenceRequired={d.evidence_required}
      verificationRequired={d.verification_required}
      files={(t.files || []).filter((x) => x.purpose === 'evidence')}
      note={t.note}
      remark={t.verify_remark}
      canWork={isAssignee && !t.is_future}
      canVerify={d.can_verify}
      canRevert={can('tasks_revert', 'edit')}
      nf={{ allowed: d.non_functional_allowed, reason: t.non_functional_reason }}
      onTick={async (done) => { await tasksApi.tickOccurrence(t.id, done); await changed(); }}
      onComplete={async (note) => { await tasksApi.completeOccurrence(t.id, { note }); await changed(); }}
      onVerify={async (approve, remark, nd) => { await tasksApi.verifyOccurrence(t.id, { approve, remark, ...(nd && { new_due: nd }) }); await changed(); }}
      onUpload={async (files) => { await tasksApi.uploadFiles('occurrence', t.id, 'evidence', files); await changed(); }}
      onDeleteFile={async (id) => { await tasksApi.deleteFile(id); await changed(); }}
      onNonFunctional={async (reason) => { await tasksApi.nonFunctional(t.id, reason); await changed(); }}
      onRevert={async () => { await tasksApi.revertNonFunctional(t.id); await changed(); }}
    />
  );

  const turns = d?.turns || [];
  const today = todayStr();
  const todays = turns.filter((t) => istDateOf(t.due_at) === today);
  const summary = d && isCl && [
    `${d.done_count} done${d.done_late_count ? ` (${d.done_late_count} not on time)` : ''}`,
    `${d.not_done_count} not done`,
    d.non_functional_count ? `${d.non_functional_count} non functional` : null,
    d.overdue ? `${d.overdue} delayed` : null,
  ].filter(Boolean).join(' · ');

  return createPortal(
    <div className="tk-drawer-bg" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="tk-drawer" role="dialog" aria-label="Task details">
        <header className="tk-drawer__head">
          <div>
            <h3>{d?.title || 'Task'} <span className="tk-muted">· {isCl ? 'Checklist' : 'Delegation'}</span></h3>
            {d && (isCl ? <Badge2 tone={d.active ? 'green' : 'grey'}>{d.active ? 'Active' : 'Paused'}</Badge2> : <DelegationStatus d={d} />)}
          </div>
          <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
        </header>

        <div className="tk-drawer__body">
          {!d && !error && <p className="tk-muted">Loading…</p>}
          {error && <p className="tk-err">{error}</p>}
          {d && (
            <>
              <div className="tk-facts">
                <Fact k="Assigned to">{d.assignee_name}</Fact>
                <Fact k="Assigned by">{d.assigner_name}</Fact>
                <Fact k="Priority"><PriorityChip p={d.priority} /></Fact>
                <Fact k="Category">{d.category_name}</Fact>
                {isCl ? (
                  <>
                    <Fact k="Repeats">{d.repeat_text}</Fact>
                    <Fact k="Next due">{d.next_due ? fmtDT(d.next_due, true) : null}</Fact>
                  </>
                ) : (
                  <Fact k="Deadline">{fmtDT(d.deadline, true)}{d.revisions ? <small> Revised ×{d.revisions}</small> : null}</Fact>
                )}
                <Fact k="Reminders">{reminderText(d.reminders)}</Fact>
                <Fact k="Needs">{needs(d)}</Fact>
                <Fact k="Verified by">{d.verification_required ? d.verifier_name || d.assigner_name : null}</Fact>
              </div>

              {d.description && <section className="tk-sec"><h4>Description</h4><p className="tk-pre">{d.description}</p></section>}
              <Reassignments list={d.reassignments} />
              {d.voice_url && <section className="tk-sec"><h4>Voice note</h4><audio controls src={d.voice_url} /></section>}
              {(d.files || []).some((x) => x.purpose === 'attachment') && (
                <section className="tk-sec">
                  <h4>Attachments</h4>
                  <ul className="tk-files">
                    {d.files.filter((x) => x.purpose === 'attachment').map((x) => (
                      <li key={x.id}><a href={x.url} target="_blank" rel="noreferrer"><Paperclip size={13} /> {x.name}</a> <small>{fileSize(x.size)}</small></li>
                    ))}
                  </ul>
                </section>
              )}

              {!isCl && (
                <>
                  <RevisionPanel d={d} isAssigner={isAssigner} isAssignee={isAssignee} onChange={changed} />
                  <section className="tk-sec"><h4>Work</h4>{delegationWork()}</section>
                </>
              )}

              {isCl && (
                <>
                  <VerificationBlock cl={d} reloadKey={tick} onChange={changed} />
                  <section className="tk-sec">
                    <h4>Today’s task {todays.length > 0 && <span className="tk-muted">· {todays.length} turn{todays.length === 1 ? '' : 's'} due today</span>}</h4>
                    {!todays.length && <p className="tk-muted">No turn is due today.</p>}
                    {todays.map((t) => (
                      <div key={t.id} className="tk-turn is-open">
                        <div className="tk-turn__head"><span>{fmtDT(t.due_at)}</span><TurnStatus t={t} /></div>
                        {turnWork(t)}
                      </div>
                    ))}
                  </section>
                  <section className="tk-sec">
                    <h4>Turns</h4>
                    <p className="tk-muted">{summary}</p>
                    <p className="tk-muted">{d.delay_rule === 'close'
                      ? 'A missed turn is closed automatically as “Work Not Done” when its date ends.'
                      : 'A missed turn stays open and shows “Delayed / Overdue” until it is completed.'}</p>
                    {turns.map((t) => {
                      const upcoming = t.is_future && t.status === 'pending';
                      const open = openTurn === t.id;
                      return (
                        <div key={t.id} className={`tk-turn ${open ? 'is-open' : ''}`}>
                          <button type="button" className="tk-turn__head" onClick={() => setOpenTurn(open ? null : t.id)}>
                            <span>{fmtDT(t.due_at)}</span>
                            {upcoming ? <Badge2 tone="grey">Upcoming</Badge2> : <TurnStatus t={t} />}
                          </button>
                          {open && (upcoming
                            ? <p className="tk-muted">This turn is for a coming day: it can be done only on its own day.</p>
                            : turnWork(t))}
                        </div>
                      );
                    })}
                  </section>
                </>
              )}
            </>
          )}
        </div>

        {d && isAssigner && (
          <footer className="tk-drawer__foot">
            <Button variant="danger" onClick={() => setConfirmDel(true)}>Delete</Button>
            <span className="tk-spacer" />
            {isCl && <Button variant="secondary" onClick={toggleActive}>{d.active ? 'Pause' : 'Resume'}</Button>}
            {(isCl || d.status !== 'completed') && <Button onClick={() => onEdit({ ...d, kind: target.kind })}>Edit</Button>}
          </footer>
        )}
      </aside>
      <ConfirmDialog
        open={confirmDel}
        title="Delete"
        message={isCl ? 'Delete this checklist and all its turns?' : 'Delete this task?'}
        busy={busy}
        onClose={() => setConfirmDel(false)}
        onConfirm={remove}
      />
    </div>,
    document.body
  );
}
