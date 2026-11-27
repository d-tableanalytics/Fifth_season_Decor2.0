import { useMemo, useRef, useState } from 'react';
import { Plus, X, Paperclip } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';
import { Input } from '../ui/Input';
import { Select, Textarea } from '../ui/FormControls';
import { tasksApi } from '../../api/tasks';
import { VoiceRecorder } from './VoiceRecorder';
import { UNIT_MIN, WEEK, fileSize, minutesToUnit, plusHoursLocal, todayStr, toLocalInput, errMsg } from './taskUi';

const VERIFY_FREQ = [
  ['daily', 'Daily'], ['days', 'Specific days of the week'], ['weekly', 'Weekly'], ['fortnightly', 'Fortnightly (every 15 days)'], ['monthly', 'Monthly'],
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MAX_FILE = 25 * 1024 * 1024;

function initial(editing, meta) {
  const cl = editing?.kind === 'checklist';
  const base = {
    isChecklist: cl,
    title: '', assignee_id: '', description: '', category_id: '', priority: 'Medium',
    evidence_required: false, verification_required: false, non_functional_allowed: false, verifier_id: '',
    vf: { freq: 'daily', days: [], anchor: '', dom: '' },
    deadline: plusHoursLocal(24),
    frequency: 'Daily', due_time: '10:00', start_date: todayStr(), end_date: '',
    cfg: { days: [], month_dates: [], last_day: false, every: 5, unit: 'weeks' },
    checkpoints: [], delay_rule: 'carry_forward', reminders: [],
  };
  if (!editing) return base;
  const vc = editing.verify_config || {};
  return {
    ...base,
    title: editing.title || '', assignee_id: editing.assignee_id || '', description: editing.description || '',
    category_id: editing.category_id || '', priority: editing.priority || 'Medium',
    evidence_required: !!editing.evidence_required, verification_required: !!editing.verification_required,
    non_functional_allowed: !!editing.non_functional_allowed, verifier_id: editing.verifier_id || '',
    vf: { freq: vc.freq || 'daily', days: vc.days || [], anchor: vc.anchor || '', dom: vc.dom == null ? '' : vc.dom },
    deadline: editing.deadline ? toLocalInput(editing.deadline) : base.deadline,
    frequency: editing.frequency || 'Daily', due_time: editing.due_time || '10:00',
    start_date: editing.start_date || todayStr(), end_date: editing.end_date || '',
    cfg: { ...base.cfg, ...(editing.config || {}), every: editing.config?.every || 5, unit: editing.config?.unit || 'weeks' },
    checkpoints: (editing.checkpoints || []).map((c) => (typeof c === 'string' ? c : c.text)),
    delay_rule: editing.delay_rule || 'carry_forward',
    reminders: (editing.reminders || []).map(minutesToUnit),
  };
}

const Chips = ({ values, onToggle, single }) => (
  <div className="tk-chips">
    {WEEK.map(([v, label]) => (
      <button key={v} type="button" className={`tk-chip ${values.includes(v) ? 'is-on' : ''}`} onClick={() => onToggle(v, single)}>{label}</button>
    ))}
  </div>
);

export function TaskFormModal({ open, onClose, meta, editing, onSaved, onCategoryAdded }) {
  const isEdit = !!editing;
  const [f, setF] = useState(() => initial(editing, meta));
  const [cats, setCats] = useState(meta.categories);
  const [addingCat, setAddingCat] = useState(false);
  const [catName, setCatName] = useState('');
  const [cpText, setCpText] = useState('');
  const [existingFiles, setExistingFiles] = useState((editing?.files || []).filter((x) => x.purpose === 'attachment'));
  const [newFiles, setNewFiles] = useState([]);
  const [voice, setVoice] = useState(null);
  const [existingVoice, setExistingVoice] = useState(editing?.voice_url || null);
  const [voiceRemoved, setVoiceRemoved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileInput = useRef(null);
  const set = (patch) => setF((s) => ({ ...s, ...patch }));
  const setCfg = (patch) => setF((s) => ({ ...s, cfg: { ...s.cfg, ...patch } }));
  const setVf = (patch) => setF((s) => ({ ...s, vf: { ...s.vf, ...patch } }));
  const toggle = (arr, v) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v].sort((a, b) => a - b));

  const holiday = useMemo(() => {
    if (f.isChecklist || !f.deadline) return null;
    return meta.holidays.find((h) => h.date === f.deadline.slice(0, 10)) || null;
  }, [f.isChecklist, f.deadline, meta.holidays]);

  const addCategory = async () => {
    const name = catName.trim();
    if (!name) return;
    try {
      const c = await tasksApi.addCategory(name);
      setCats((l) => (l.some((x) => x.id === c.id) ? l : [...l, c].sort((a, b) => a.name.localeCompare(b.name))));
      onCategoryAdded?.(c);
      set({ category_id: c.id });
      setAddingCat(false);
      setCatName('');
    } catch (e) { setError(errMsg(e)); }
  };

  const addCp = () => {
    const t = cpText.trim();
    if (!t) return;
    set({ checkpoints: [...f.checkpoints, t].slice(0, 30) });
    setCpText('');
  };

  const pickFiles = (list) => {
    const room = 5 - newFiles.length;
    const chosen = [...list].slice(0, Math.max(0, room));
    const big = chosen.find((x) => x.size > MAX_FILE);
    if (big) { setError('A file is larger than 25 MB'); return; }
    setNewFiles((l) => [...l, ...chosen]);
  };

  const removeExisting = async (file) => {
    try { await tasksApi.deleteFile(file.id); setExistingFiles((l) => l.filter((x) => x.id !== file.id)); } catch (e) { setError(errMsg(e)); }
  };

  const buildBody = () => {
    const body = {
      title: f.title, description: f.description, assignee_id: Number(f.assignee_id) || null,
      category_id: f.category_id ? Number(f.category_id) : null, priority: f.priority,
      evidence_required: f.evidence_required, verification_required: f.verification_required,
      verifier_id: f.verification_required && f.verifier_id ? Number(f.verifier_id) : null,
      checkpoints: f.checkpoints,
      reminders: f.reminders.map((r) => Math.round(Number(r.n) * UNIT_MIN[r.unit])).filter((n) => n > 0),
    };
    if (!f.isChecklist) return { ...body, deadline: f.deadline };
    let config = {};
    if (f.frequency === 'Weekly') config = { days: f.cfg.days };
    else if (f.frequency === 'Monthly') config = { month_dates: f.cfg.month_dates, last_day: f.cfg.last_day };
    else if (f.frequency === 'Periodically') config = { every: Number(f.cfg.every) };
    else if (f.frequency === 'Custom') {
      config = f.cfg.unit === 'weeks'
        ? { every: Number(f.cfg.every), unit: 'weeks', days: f.cfg.days }
        : { every: Number(f.cfg.every), unit: 'months', month_dates: f.cfg.month_dates, last_day: f.cfg.last_day };
    }
    const vf = f.vf;
    const verify_config = { freq: vf.freq, ...(['days', 'weekly'].includes(vf.freq) && { days: vf.days }), ...(vf.freq === 'fortnightly' && { anchor: vf.anchor || f.start_date }), ...(vf.freq === 'monthly' && { dom: vf.dom }) };
    return {
      ...body, frequency: f.frequency, due_time: f.due_time, start_date: f.start_date, end_date: f.end_date || null,
      config, delay_rule: f.delay_rule, non_functional_allowed: f.non_functional_allowed, verify_config,
    };
  };

  const submit = async () => {
    setError('');
    if (holiday) { setError(`${holiday.name}: this day is a holiday. Choose a working day.`); return; }
    if (!f.title.trim()) { setError('Enter the task title'); return; }
    if (!f.assignee_id) { setError('Choose who the task is assigned to'); return; }
    setBusy(true);
    try {
      const kind = f.isChecklist ? 'checklist' : 'delegation';
      const body = buildBody();
      const saved = isEdit
        ? await (f.isChecklist ? tasksApi.updateChecklist : tasksApi.updateDelegation)(editing.id, body)
        : await (f.isChecklist ? tasksApi.createChecklist : tasksApi.createDelegation)(body);
      let warning = '';
      try {
        if (voiceRemoved && !voice) await tasksApi.deleteVoice(kind, saved.id);
        if (newFiles.length) await tasksApi.uploadFiles(kind, saved.id, 'attachment', newFiles);
        if (voice) await tasksApi.uploadVoice(kind, saved.id, voice);
      } catch (e) { warning = errMsg(e); }
      onSaved({ kind, id: saved.id, isEdit, warning });
    } catch (e) {
      setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const label = busy ? 'Saving…' : isEdit ? 'Save changes' : f.isChecklist ? 'Create checklist' : 'Assign task';
  const monthGrid = (
    <div className="tk-monthgrid">
      {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
        <button key={d} type="button" className={`tk-chip ${f.cfg.month_dates.includes(d) ? 'is-on' : ''}`} onClick={() => setCfg({ month_dates: toggle(f.cfg.month_dates, d) })}>{d}</button>
      ))}
      <button type="button" className={`tk-chip tk-chip--wide ${f.cfg.last_day ? 'is-on' : ''}`} onClick={() => setCfg({ last_day: !f.cfg.last_day })}>LAST DAY</button>
    </div>
  );
  const weekChips = (
    <>
      <Chips values={f.cfg.days} onToggle={(v) => setCfg({ days: toggle(f.cfg.days, v) })} />
      {!f.cfg.days.length && <p className="tk-muted">No day chosen: the start date’s weekday is used.</p>}
    </>
  );

  return (
    <Modal
      open={open}
      size="xl"
      busy={busy}
      onClose={onClose}
      title={`${isEdit ? 'Edit task' : 'Add task'} · ${f.isChecklist ? 'Checklist (repeats)' : 'Delegation (one deadline)'}`}
      footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} loading={busy}>{label}</Button></>}
    >
      <div className="tk-form">
        <div className="tk-form__full">
          <span className="field__label">Is checklist?</span>
          <div className="tk-seg">
            <button type="button" disabled={isEdit} className={!f.isChecklist ? 'is-on' : ''} onClick={() => set({ isChecklist: false })}>No · delegation</button>
            <button type="button" disabled={isEdit} className={f.isChecklist ? 'is-on' : ''} onClick={() => set({ isChecklist: true })}>Yes · repeats</button>
          </div>
        </div>

        <div className="tk-form__2"><Input label="Title" required maxLength={200} value={f.title} onChange={(e) => set({ title: e.target.value })} /></div>
        <Select label="Assign to" required value={f.assignee_id} onChange={(e) => set({ assignee_id: e.target.value })}>
          <option value="">Choose the doer</option>
          {meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}{u.id === meta.me.id ? ' (me)' : ''}</option>)}
        </Select>

        <div className="tk-form__full"><Textarea label="Description" rows={2} maxLength={4000} value={f.description} onChange={(e) => set({ description: e.target.value })} /></div>

        <div>
          {addingCat ? (
            <div className="field">
              <span className="field__label">New category</span>
              <div className="tk-inline">
                <input className="field__input" autoFocus value={catName} maxLength={80} onChange={(e) => setCatName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCategory(); } }} />
                <Button size="sm" onClick={addCategory}>Add</Button>
                <button type="button" className="icon-btn" aria-label="Cancel" onClick={() => setAddingCat(false)}><X size={15} /></button>
              </div>
            </div>
          ) : (
            <Select label="Category" value={f.category_id} onChange={(e) => (e.target.value === '__new' ? setAddingCat(true) : set({ category_id: e.target.value }))}>
              <option value="">No category</option>
              {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              <option value="__new">＋ Add new category…</option>
            </Select>
          )}
        </div>
        <Select label="Priority" value={f.priority} onChange={(e) => set({ priority: e.target.value })}>
          {meta.priorities.map((p) => <option key={p}>{p}</option>)}
        </Select>
        <div className="field">
          <span className="field__label">Needs</span>
          <label className="tk-check"><input type="checkbox" checked={f.evidence_required} onChange={(e) => set({ evidence_required: e.target.checked })} /> Evidence required</label>
          <label className="tk-check"><input type="checkbox" checked={f.verification_required} onChange={(e) => set({ verification_required: e.target.checked })} /> Verification required</label>
          {f.isChecklist && (
            <label className="tk-check" title="When the work could not be done because of a reason outside the doer’s control (e.g. machine under repair), the turn can be marked non-functional. It is not scored and not counted in any total or percentage.">
              <input type="checkbox" checked={f.non_functional_allowed} onChange={(e) => set({ non_functional_allowed: e.target.checked })} /> Non-functional applicable
            </label>
          )}
        </div>

        {f.verification_required && (
          <Select label="Verified by" required value={f.verifier_id} onChange={(e) => set({ verifier_id: e.target.value })}>
            <option value="">Select who verifies…</option>
            {meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}

        {f.isChecklist && f.verification_required && (
          <div className="tk-form__full tk-box tk-box--purple">
            <strong>Verification frequency</strong>
            <div className="tk-form__row">
              <Select value={f.vf.freq} onChange={(e) => setVf({ freq: e.target.value, days: [] })}>
                {VERIFY_FREQ.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </Select>
              {f.vf.freq === 'days' && <Chips values={f.vf.days} onToggle={(v) => setVf({ days: toggle(f.vf.days, v) })} />}
              {f.vf.freq === 'weekly' && (
                <Select value={f.vf.days[0] ?? ''} onChange={(e) => setVf({ days: e.target.value === '' ? [] : [Number(e.target.value)] })}>
                  <option value="">Choose the weekday</option>
                  {WEEKDAYS.map((n, i) => <option key={n} value={i}>{n}</option>)}
                </Select>
              )}
              {f.vf.freq === 'fortnightly' && <Input label="First verification on" type="date" value={f.vf.anchor} onChange={(e) => setVf({ anchor: e.target.value })} />}
              {f.vf.freq === 'monthly' && (
                <Select value={f.vf.dom} onChange={(e) => setVf({ dom: e.target.value === '' ? '' : Number(e.target.value) })}>
                  <option value="">Same date as the start date</option>
                  {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => <option key={d} value={d}>Day {d}</option>)}
                  <option value={0}>Last day</option>
                </Select>
              )}
            </div>
            <p className="tk-muted">The doer keeps doing the task as set below. The finished turns reach the verifier’s “to verify” list only on the chosen day(s), all together.</p>
          </div>
        )}

        {!f.isChecklist && (
          <div className="tk-form__2">
            <Input label="Deadline" type="datetime-local" required value={f.deadline} onChange={(e) => set({ deadline: e.target.value })} />
            {holiday && <p className="tk-err">{holiday.name}: this day is a holiday. Choose a working day.</p>}
          </div>
        )}

        {f.isChecklist && (
          <>
            <Select label="Frequency" value={f.frequency} onChange={(e) => set({ frequency: e.target.value })}>
              {meta.frequencies.map((x) => <option key={x}>{x}</option>)}
            </Select>
            <Input label="Due time (each time)" type="time" required value={f.due_time} onChange={(e) => set({ due_time: e.target.value })} />
            <Input label="Starts on" type="date" required value={f.start_date} onChange={(e) => set({ start_date: e.target.value })} />
            <Input label="Ends on (optional)" type="date" value={f.end_date} min={f.start_date} onChange={(e) => set({ end_date: e.target.value })} />
            <div className="tk-form__full tk-box">
              {f.frequency === 'Daily' && <p>Repeats every day.</p>}
              {f.frequency === 'Yearly' && <p>Repeats every year on the day and month of the start date.</p>}
              {f.frequency === 'Weekly' && weekChips}
              {f.frequency === 'Monthly' && monthGrid}
              {f.frequency === 'Periodically' && (
                <label className="tk-inline">REPEAT EVERY
                  <input className="field__input tk-num" type="number" min={1} max={365} value={f.cfg.every} onChange={(e) => setCfg({ every: e.target.value })} /> DAY(S)
                </label>
              )}
              {f.frequency === 'Custom' && (
                <>
                  <label className="tk-inline">OCCUR EVERY
                    <input className="field__input tk-num" type="number" min={1} max={f.cfg.unit === 'weeks' ? 52 : 24} value={f.cfg.every} onChange={(e) => setCfg({ every: e.target.value })} />
                    <select className="field__input tk-unit" value={f.cfg.unit} onChange={(e) => setCfg({ unit: e.target.value })}>
                      <option value="weeks">Weeks</option><option value="months">Months</option>
                    </select>
                  </label>
                  {f.cfg.unit === 'weeks' ? weekChips : monthGrid}
                </>
              )}
            </div>
          </>
        )}

        <div className="tk-form__full">
          <span className="field__label">Checkpoints (steps to tick off)</span>
          <ol className="tk-cplist">
            {f.checkpoints.map((c, i) => (
              <li key={`${c}-${i}`}><span>{c}</span><button type="button" className="icon-btn" aria-label="Remove" onClick={() => set({ checkpoints: f.checkpoints.filter((_, j) => j !== i) })}><X size={14} /></button></li>
            ))}
          </ol>
          <div className="tk-inline">
            <input className="field__input" placeholder="Add a checkpoint and press Enter" maxLength={200} value={cpText} onChange={(e) => setCpText(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addCp(); } }} />
            <Button size="sm" variant="secondary" onClick={addCp}>Add</Button>
          </div>
        </div>

        {f.isChecklist && (
          <div className="tk-form__full">
            <span className="field__label">If a turn is missed (deadline passes) <span className="field__req">*</span></span>
            <div className="tk-radios">
              {[['carry_forward', 'Carry forward as Delayed', 'The task stays open the next day too and shows “Delayed / Overdue” until it is completed.'],
                ['close', 'Close as Work Not Done', 'If it is not done by its date, it is closed automatically as “Work Not Done”. The next turn is made as usual.']].map(([v, t, d]) => (
                <label key={v} className={`tk-radio ${f.delay_rule === v ? 'is-on' : ''}`}>
                  <input type="radio" name="delay_rule" checked={f.delay_rule === v} onChange={() => set({ delay_rule: v })} />
                  <span><strong>{t}</strong><small>{d}</small></span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div className="tk-form__full">
          <span className="field__label">Reminders ({f.isChecklist ? 'before each due time' : 'before the deadline'})</span>
          {f.reminders.map((r, i) => (
            <div key={i} className="tk-inline tk-rem">
              <input className="field__input tk-num" type="number" min={1} value={r.n}
                onChange={(e) => set({ reminders: f.reminders.map((x, j) => (j === i ? { ...x, n: e.target.value } : x)) })} />
              <select className="field__input tk-unit" value={r.unit} onChange={(e) => set({ reminders: f.reminders.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)) })}>
                <option value="minutes">minutes</option><option value="hours">hours</option><option value="days">days</option>
              </select>
              <span>before</span>
              <button type="button" className="icon-btn" aria-label="Remove" onClick={() => set({ reminders: f.reminders.filter((_, j) => j !== i) })}><X size={14} /></button>
            </div>
          ))}
          {f.reminders.length < 10 && (
            <button type="button" className="tk-link" onClick={() => set({ reminders: [...f.reminders, f.reminders.length ? { n: 15, unit: 'minutes' } : { n: 1, unit: 'hours' }] })}>
              <Plus size={13} /> Add reminder
            </button>
          )}
        </div>

        <div className="tk-form__full">
          <span className="field__label">Attachments</span>
          <ul className="tk-files">
            {existingFiles.map((x) => (
              <li key={x.id}><a href={x.url} target="_blank" rel="noreferrer"><Paperclip size={13} /> {x.name}</a> <small>{fileSize(x.size)}</small>
                <button type="button" className="icon-btn" aria-label="Delete file" onClick={() => removeExisting(x)}><X size={14} /></button></li>
            ))}
            {newFiles.map((x, i) => (
              <li key={`${x.name}-${i}`}><span><Paperclip size={13} /> {x.name}</span> <small>{fileSize(x.size)}</small>
                <button type="button" className="icon-btn" aria-label="Remove file" onClick={() => setNewFiles((l) => l.filter((_, j) => j !== i))}><X size={14} /></button></li>
            ))}
          </ul>
          <input ref={fileInput} type="file" multiple hidden onChange={(e) => { pickFiles(e.target.files); e.target.value = ''; }} />
          <Button size="sm" variant="secondary" onClick={() => fileInput.current.click()} disabled={newFiles.length >= 5}>Choose files</Button>
          <span className="tk-muted"> max 5 files, 25 MB each</span>
        </div>

        <div className="tk-form__full">
          <span className="field__label">Voice note</span>
          <VoiceRecorder value={voice} onChange={setVoice} existingUrl={voiceRemoved ? null : existingVoice}
            onRemoveExisting={() => { setVoiceRemoved(true); setExistingVoice(null); }} />
        </div>

        {error && <p className="tk-err tk-form__full">{error}</p>}
      </div>
    </Modal>
  );
}
