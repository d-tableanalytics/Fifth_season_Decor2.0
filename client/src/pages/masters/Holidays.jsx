import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { holidaysApi } from '../../api/tasks';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { ConfirmDialog, Modal } from '../../components/ui/Modal';
import { Skeleton } from '../../components/ui/Loader';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const dmy = (s) => s.split('-').reverse().join('/');
const note = (r) => (r.removed_turns || r.delegations_due
  ? ` ${r.removed_turns} untouched checklist turn(s) removed${r.delegations_due ? `; ${r.delegations_due} pending delegation(s) are due on these days` : ''}.`
  : '');

export default function Holidays() {
  const { can } = useAuth();
  const toast = useToast();
  const [data, setData] = useState({ data: [], weekly_off: [0] });
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState({ from: '', to: '', name: '' });
  const [busy, setBusy] = useState(false);
  const [edit, setEdit] = useState(null);
  const [toDelete, setToDelete] = useState(null);
  const canAdd = can('holidays', 'create');
  const canEdit = can('holidays', 'edit');
  const canDelete = can('holidays', 'delete');

  const load = useCallback(async () => {
    try { setData(await holidaysApi.list()); } catch (e) { toast.error('Could not load holidays', getErrorMessage(e)); } finally { setLoading(false); }
  }, [toast]);
  useEffect(() => { load(); }, [load]);

  const run = async (fn, ok) => {
    setBusy(true);
    try { const r = await fn(); toast.success(ok, note(r || {}).trim() || undefined, 6000); await load(); return true; }
    catch (e) { toast.error('Could not save', getErrorMessage(e)); return false; }
    finally { setBusy(false); }
  };

  const add = async (e) => {
    e.preventDefault();
    if (await run(() => holidaysApi.add({ from: form.from, to: form.to || form.from, name: form.name }), 'Holiday saved')) setForm({ from: '', to: '', name: '' });
  };
  const toggleDay = (d) => {
    const next = data.weekly_off.includes(d) ? data.weekly_off.filter((x) => x !== d) : [...data.weekly_off, d];
    run(() => holidaysApi.setWeeklyOff(next), 'Weekly off saved');
  };

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Holidays</h2>
          <p className="page-header__sub">No checklist turn is made on a holiday or a weekly off day, and a delegation deadline cannot fall on a holiday.</p>
        </div>
      </div>

      {canAdd && (
        <form className="card hol-form" onSubmit={add}>
          <Input label="From" type="date" required value={form.from} onChange={(e) => setForm({ ...form, from: e.target.value })} />
          <Input label="To (optional, max 60 days)" type="date" value={form.to} min={form.from} onChange={(e) => setForm({ ...form, to: e.target.value })} />
          <div style={{ gridColumn: 'span 2' }}>
            <Input label="Name" required maxLength={120} placeholder="e.g. Diwali" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <Button type="submit" icon={Plus} loading={busy}>Add holiday</Button>
        </form>
      )}

      <div className="card">
        <div className="card__head"><h3>Weekly off</h3></div>
        <div className="hol-week">
          {DAYS.map((n, d) => (
            <button key={n} type="button" disabled={!canEdit || busy} className={data.weekly_off.includes(d) ? 'is-on' : ''} onClick={() => toggleDay(d)}>{n}</button>
          ))}
        </div>
      </div>

      <div className="table-wrap table-wrap--flush">
        <table className="table">
          <thead><tr><th>Date</th><th>Name</th>{(canEdit || canDelete) && <th className="num">Actions</th>}</tr></thead>
          <tbody>
            {loading && Array.from({ length: 4 }).map((_, i) => <tr key={i}><td><Skeleton width={90} /></td><td><Skeleton width={160} /></td><td /></tr>)}
            {!loading && !data.data.length && <tr><td colSpan={3} className="cell-sub">No holidays added yet.</td></tr>}
            {data.data.map((h) => (
              <tr key={h.id}>
                <td>{dmy(h.holiday_date)}</td>
                <td>{h.name}</td>
                {(canEdit || canDelete) && (
                  <td className="num">
                    {canEdit && <button className="icon-btn" aria-label="Edit" onClick={() => setEdit({ id: h.id, date: h.holiday_date, name: h.name })}><Pencil size={15} /></button>}
                    {canDelete && <button className="icon-btn" aria-label="Delete" onClick={() => setToDelete(h)}><Trash2 size={15} /></button>}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal
        open={!!edit}
        title="Edit holiday"
        size="sm"
        busy={busy}
        onClose={() => setEdit(null)}
        footer={<><Button variant="secondary" onClick={() => setEdit(null)}>Cancel</Button>
          <Button loading={busy} onClick={async () => { if (await run(() => holidaysApi.update(edit.id, { date: edit.date, name: edit.name }), 'Holiday updated')) setEdit(null); }}>Save</Button></>}
      >
        {edit && (
          <div className="form-stack">
            <Input label="Date" type="date" required value={edit.date} onChange={(e) => setEdit({ ...edit, date: e.target.value })} />
            <Input label="Name" required maxLength={120} value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </div>
        )}
      </Modal>

      <ConfirmDialog
        open={!!toDelete}
        title="Delete holiday"
        message={toDelete ? `Delete “${toDelete.name}” (${dmy(toDelete.holiday_date)})? Checklist turns for that day will be made again.` : ''}
        busy={busy}
        onClose={() => setToDelete(null)}
        onConfirm={async () => { if (await run(() => holidaysApi.remove(toDelete.id), 'Holiday deleted')) setToDelete(null); }}
      />
    </div>
  );
}
