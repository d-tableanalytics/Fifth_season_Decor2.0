import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tasksApi } from '../../api/tasks';
import { getErrorMessage } from '../../api/client';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/FormControls';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Loader';
import { fmtDT, taskLink } from '../../components/taskdash/common';
import { ReassignModal } from '../../components/tasks/ReassignModal';

const SHOW = [['dues', 'Dues (delayed + today)'], ['delayed', 'Delayed'], ['today', 'Due today']];

const delayText = (t) => {
  if (t.kind === 'c') return t.delayed_turns ? `${t.late_days} days · ${t.delayed_turns} turn${t.delayed_turns === 1 ? '' : 's'} delayed` : 'Due today';
  return t.delayed ? `Delayed ${t.late_days} day${t.late_days === 1 ? '' : 's'}` : 'Due today';
};

export default function PcDashboard() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const canEdit = can('pc_main', 'edit');
  const [meta, setMeta] = useState({ users: [], categories: [] });
  const [show, setShow] = useState('dues');
  const [doer, setDoer] = useState('');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
  const [priority, setPriority] = useState('');
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText, 300);
  const [data, setData] = useState(null);
  const [sel, setSel] = useState({});
  const [reassign, setReassign] = useState(false);

  useEffect(() => { tasksApi.meta().then(setMeta).catch(() => {}); }, []);

  const params = useMemo(() => {
    const p = { show };
    if (doer) p.doer = doer;
    if (department) p.department = department;
    if (category) p.category = category;
    if (kind) p.kind = kind;
    if (priority) p.priority = priority;
    if (search.trim()) p.search = search.trim();
    return p;
  }, [show, doer, department, category, kind, priority, search]);

  const load = useCallback(() => {
    tasksApi.pc(params).then(setData).catch((e) => toast.error('Could not load the PC Dashboard', getErrorMessage(e)));
  }, [params, toast]);
  useEffect(() => { load(); }, [load]);

  const filtered = !!(doer || department || category || kind || priority || searchText);
  const clear = () => { setDoer(''); setDepartment(''); setCategory(''); setKind(''); setPriority(''); setSearchText(''); };
  const items = Object.values(sel);
  const doerName = doer ? meta.users.find((u) => String(u.id) === doer)?.name || data?.doers.find((d) => String(d.id) === doer)?.name : '';
  const toggle = (t) => setSel((s) => { const k = t.open; const n = { ...s }; if (n[k]) delete n[k]; else n[k] = { kind: t.kind === 'd' ? 'delegation' : 'checklist', id: t.id }; return n; });
  const allOn = data?.tasks.length > 0 && data.tasks.every((t) => sel[t.open]);
  const toggleAll = () => setSel((s) => {
    if (allOn) { const n = { ...s }; data.tasks.forEach((t) => delete n[t.open]); return n; }
    const n = { ...s };
    data.tasks.forEach((t) => { n[t.open] = { kind: t.kind === 'd' ? 'delegation' : 'checklist', id: t.id }; });
    return n;
  });

  const sm = data?.summary;
  return (
    <div className="page td-page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">PC Dashboard</h2>
          <p className="page-header__sub">
            Every doer’s dues and delayed tasks, to follow up.{canEdit ? ' Tick tasks and give them to another doer.' : ''}
          </p>
        </div>
        {canEdit && <Button disabled={!items.length} onClick={() => setReassign(true)}>Reassign doer{items.length ? ` (${items.length})` : ''}</Button>}
      </div>

      <div className="td-seg" role="group" aria-label="Show" style={{ alignSelf: 'flex-start' }}>
        {SHOW.map(([k, l]) => <button key={k} type="button" className={show === k ? 'is-on' : ''} onClick={() => setShow(k)}>{l}</button>)}
      </div>

      <div className="td-stats">
        <div className="td-stat"><b>{sm ? sm.tasks : '…'}</b><span>Tasks with dues</span></div>
        <div className="td-stat td-stat--red"><b>{sm ? sm.delayed_tasks : '…'}</b><span>Delayed tasks</span></div>
        <div className="td-stat"><b>{sm ? `${sm.doers_delayed} / ${sm.doers}` : '…'}</b><span>Doers with delays</span></div>
        <div className="td-stat"><b>{sm ? sm.today : '…'}</b><span>Turns due today</span></div>
        <div className="td-stat"><b>{sm ? `${sm.oldest_days} d` : '…'}</b><span>Oldest delay</span></div>
      </div>

      <div className="card td-filters">
        <Select value={doer} onChange={(e) => setDoer(e.target.value)} aria-label="Doer">
          <option value="">All doers</option>
          {meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {(data?.departments || []).map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type">
          <option value="">All types</option>
          <option value="delegation">Delegation</option>
          <option value="checklist">Checklist</option>
        </Select>
        <Select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Priority">
          <option value="">Any priority</option>
          {['Urgent', 'High', 'Medium', 'Low'].map((p) => <option key={p}>{p}</option>)}
        </Select>
        <Input type="search" placeholder="Search tasks…" value={searchText} onChange={(e) => setSearchText(e.target.value)} aria-label="Search" />
        {filtered && <Button variant="secondary" onClick={clear}>Clear</Button>}
      </div>

      <div className="card">
        <div className="card__head"><h3>Doers</h3></div>
        {!data ? <Skeleton height={80} /> : !data.doers.length ? <p className="td-empty">No dues — everyone is up to date.</p> : (
          <div className="td-scroll">
            <table className="table td-table-sm">
              <thead><tr><th>Doer</th><th>Department</th><th className="num">Tasks</th><th className="num">Delayed</th><th className="num">Due today</th><th className="num">Oldest delay</th><th /></tr></thead>
              <tbody>
                {data.doers.map((d) => (
                  <tr key={d.id} className={`td-row-click ${String(d.id) === doer ? 'is-sel' : ''}`} onClick={() => setDoer(String(d.id) === doer ? '' : String(d.id))}>
                    <td>{d.name}</td><td>{d.department || '—'}</td><td className="num">{d.tasks}</td>
                    <td className="num">{d.delayed}{d.delayed_delegations ? <span className="td-sub"> · {d.delayed_delegations} delegation{d.delayed_delegations === 1 ? '' : 's'}</span> : null}</td>
                    <td className="num">{d.today}</td><td className="num">{d.oldest_days ? `${d.oldest_days} d` : '—'}</td>
                    <td><button type="button" className="td-linkbtn">{String(d.id) === doer ? 'Show all' : 'View tasks'}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card__head"><h3>Tasks{doerName ? ` of ${doerName}` : ''} ({data ? data.tasks.length : '…'})</h3></div>
        {!data ? <Skeleton height={120} /> : !data.tasks.length ? <p className="td-empty">No tasks match.</p> : (
          <div className="td-scroll">
            <table className="table td-table-sm">
              <thead>
                <tr>
                  {canEdit && <th><input type="checkbox" checked={allOn} onChange={toggleAll} aria-label="Select all" /></th>}
                  <th>Task</th><th>Type</th><th>Doer</th><th>Assigned by</th><th>Due</th><th>Delay</th><th>Priority</th>
                </tr>
              </thead>
              <tbody>
                {data.tasks.map((t) => (
                  <tr key={t.open} className="td-row-click" onClick={() => navigate(taskLink(t.open))}>
                    {canEdit && <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={!!sel[t.open]} onChange={() => toggle(t)} aria-label="Select task" /></td>}
                    <td>{t.title}{t.category && <><br /><span className="td-sub">{t.category}</span></>}</td>
                    <td>{t.kind === 'd' ? 'Delegation' : `Checklist${t.frequency ? ` · ${t.frequency}` : ''}`}</td>
                    <td>{t.doer}<br /><span className="td-sub">{t.department || '—'}</span></td>
                    <td>{t.assigner || '—'}</td>
                    <td>{fmtDT(t.due_at, true)}</td>
                    <td className={t.delayed ? 'td-neg' : ''}>{delayText(t)}</td>
                    <td><span className={`td-chip td-chip--${t.priority}`}>{t.priority}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {canEdit && (
        <ReassignModal open={reassign} items={items} initialTab="selected" onClose={() => setReassign(false)} onDone={() => { setReassign(false); setSel({}); load(); }} />
      )}
    </div>
  );
}
