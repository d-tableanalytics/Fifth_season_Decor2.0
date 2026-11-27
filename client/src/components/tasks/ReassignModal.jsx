import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select } from '../ui/FormControls';
import { useToast } from '../../context/ToastContext';
import { tasksApi } from '../../api/tasks';
import { fmtDT, todayStr, errMsg } from './taskUi';

/**
 * Reassign modal (spec 18.4).
 * items = [{ kind: 'delegation'|'checklist', id, title }] (the selected tasks); doers = [{id,name}] (loaded when omitted);
 * initialTab = 'selected' | 'leave'; onDone(result) after a successful reassign.
 */
export function ReassignModal({ open, onClose, items = [], doers, onDone, initialTab }) {
  const toast = useToast();
  const [users, setUsers] = useState(doers || []);
  const [tab, setTab] = useState(initialTab || (items.length ? 'selected' : 'leave'));
  const [doer, setDoer] = useState('');
  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [found, setFound] = useState(null); // { delegations, checklists } | null
  const [loadingFound, setLoadingFound] = useState(false);
  const [ticked, setTicked] = useState({});
  const [target, setTarget] = useState('');
  const [pFrom, setPFrom] = useState('');
  const [pTo, setPTo] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (doers) { setUsers(doers); return; }
    tasksApi.meta().then((m) => setUsers(m.users)).catch(() => {});
  }, [doers]);

  useEffect(() => {
    if (tab !== 'leave' || !doer) { setFound(null); return undefined; }
    let live = true;
    setLoadingFound(true);
    tasksApi.leavePreview({ doer, from, to: to || from })
      .then((r) => {
        if (!live) return;
        setFound(r);
        const t = {};
        r.delegations.forEach((x) => { t[`delegation:${x.id}`] = true; });
        r.checklists.forEach((x) => { t[`checklist:${x.id}`] = true; });
        setTicked(t);
      })
      .catch((e) => live && setError(errMsg(e)))
      .finally(() => live && setLoadingFound(false));
    return () => { live = false; };
  }, [tab, doer, from, to]);

  const chosen = useMemo(() => {
    if (tab === 'selected') return items.map((i) => ({ kind: i.kind, id: i.id }));
    if (!found) return [];
    return [
      ...found.delegations.filter((x) => ticked[`delegation:${x.id}`]).map((x) => ({ kind: 'delegation', id: x.id })),
      ...found.checklists.filter((x) => ticked[`checklist:${x.id}`]).map((x) => ({ kind: 'checklist', id: x.id })),
    ];
  }, [tab, items, found, ticked]);

  const submit = async () => {
    setError('');
    if (!target) { setError('Choose who the tasks are given to'); return; }
    if (!chosen.length) { setError('Select at least one task'); return; }
    const body = { to: Number(target), items: chosen, reason: reason || undefined };
    if (tab === 'leave') { body.from_date = from; body.to_date = to || from; }
    else { if (pFrom) body.from_date = pFrom; if (pTo) body.to_date = pTo; }
    if (body.from_date && body.to_date && body.to_date < body.from_date) { setError('The “to” date cannot be before the “from” date'); return; }
    setBusy(true);
    try {
      const r = await tasksApi.reassign(body);
      const skipped = r.skipped || [];
      toast.success(`${r.moved} task${r.moved === 1 ? '' : 's'} reassigned${skipped.length ? `, ${skipped.length} skipped (${skipped.join('; ')})` : ''}`, undefined, skipped.length ? 9000 : 4000);
      onDone?.(r);
      onClose();
    } catch (e) { setError(errMsg(e)); } finally { setBusy(false); }
  };

  const targets = users.filter((u) => String(u.id) !== String(doer));
  return (
    <Modal
      open={open}
      title="Reassign doer"
      onClose={onClose}
      busy={busy}
      size="lg"
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
        <Button onClick={submit} loading={busy}>{`Reassign ${chosen.length} task${chosen.length === 1 ? '' : 's'}`}</Button></>}
    >
      <div className="tk-reassign">
        <div className="tk-pills">
          <button type="button" disabled={!items.length} className={tab === 'selected' ? 'is-on' : ''} onClick={() => setTab('selected')}>{`Selected tasks (${items.length})`}</button>
          <button type="button" className={tab === 'leave' ? 'is-on' : ''} onClick={() => setTab('leave')}>Doer on leave</button>
        </div>

        {tab === 'leave' ? (
          <>
            <div className="tk-grid3">
              <Select label="Doer on leave" required value={doer} onChange={(e) => setDoer(e.target.value)}>
                <option value="">Choose the doer</option>
                {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
              </Select>
              <Input label="From date" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
              <Input label="To date" type="date" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
            </div>
            {loadingFound && <p className="tk-muted">Looking for their tasks…</p>}
            {found && !loadingFound && !found.delegations.length && !found.checklists.length && (
              <p className="tk-muted">This doer has no open task of yours in these dates.</p>
            )}
            {found && (
              <ul className="tk-picklist">
                {found.delegations.map((x) => (
                  <li key={`d${x.id}`}><label><input type="checkbox" checked={!!ticked[`delegation:${x.id}`]} onChange={(e) => setTicked({ ...ticked, [`delegation:${x.id}`]: e.target.checked })} />
                    <span><strong>{x.title}</strong><small>Delegation · due {fmtDT(x.deadline)}</small></span></label></li>
                ))}
                {found.checklists.map((x) => (
                  <li key={`c${x.id}`}><label><input type="checkbox" checked={!!ticked[`checklist:${x.id}`]} onChange={(e) => setTicked({ ...ticked, [`checklist:${x.id}`]: e.target.checked })} />
                    <span><strong>{x.title}</strong><small>{`Checklist · ${x.repeat_text} · ${x.turns} turns in these dates`}</small></span></label></li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <ul className="tk-picklist tk-picklist--plain">
            {items.map((x) => <li key={`${x.kind}${x.id}`}><span><strong>{x.title}</strong><small>{x.kind === 'checklist' ? 'Checklist' : 'Delegation'}</small></span></li>)}
          </ul>
        )}

        <Select label="Give them to" required value={target} onChange={(e) => setTarget(e.target.value)}>
          <option value="">Choose who the tasks are given to</option>
          {targets.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        {tab === 'selected' && (
          <div className="tk-grid2">
            <Input label="From (optional)" type="date" value={pFrom} onChange={(e) => setPFrom(e.target.value)} />
            <Input label="To (optional)" type="date" value={pTo} min={pFrom} onChange={(e) => setPTo(e.target.value)} />
          </div>
        )}
        <Input label="Reason" maxLength={300} placeholder="e.g. on leave" value={reason} onChange={(e) => setReason(e.target.value)} />
        <p className="tk-muted">The task details, deadline and checklist / delegation stay the same; only the doer changes. A checklist given with a “to” date returns to its first doer by itself after that date; without one the change is permanent.</p>
        {error && <p className="tk-err">{error}</p>}
      </div>
    </Modal>
  );
}
