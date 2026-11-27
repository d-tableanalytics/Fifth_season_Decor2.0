import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, FileText, Users } from 'lucide-react';
import { tasksApi } from '../../api/tasks';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Loader } from '../../components/ui/Loader';
import { TaskFormModal } from '../../components/tasks/TaskFormModal';
import { TaskDrawer } from '../../components/tasks/TaskDrawer';
import { ReassignModal } from '../../components/tasks/ReassignModal';
import { PdfPopup } from '../../components/tasks/PdfPopup';
import { Badge2, DelegationStatus, PriorityChip, fmtDT, dayWord, errMsg } from '../../components/tasks/taskUi';

const LIMIT = 20;
const D_STATUS = [['', 'Any status'], ['pending', 'Open'], ['today', 'Due today'], ['overdue', 'Delayed'], ['submitted', 'Awaiting verification'], ['completed', 'Completed']];
const C_STATUS = [['', 'Active and paused'], ['today', 'Due today'], ['active', 'Active'], ['delayed', 'Delayed'], ['paused', 'Paused']];
const EMPTY = { search: '', status: '', assignee: '', frequency: '', category: '', priority: '' };

const parseOpen = (v) => {
  const m = /^([dc])(\d+)$/.exec(v || '');
  return m ? { kind: m[1] === 'c' ? 'checklist' : 'delegation', id: Number(m[2]) } : null;
};

export default function Tasks() {
  const { user, can } = useAuth();
  const toast = useToast();
  const [params] = useSearchParams();
  const [meta, setMeta] = useState(null);
  const [tab, setTab] = useState(params.get('tab') === 'checklists' || params.get('open')?.startsWith('c') ? 'checklists' : 'delegations');
  const [scope, setScope] = useState(['mine', 'assigned', 'all'].includes(params.get('scope')) ? params.get('scope') : 'mine');
  const [filters, setFilters] = useState(EMPTY);
  const [page, setPage] = useState(1);
  const [res, setRes] = useState({ data: [], total: 0 });
  const [loading, setLoading] = useState(true);
  const [sel, setSel] = useState(new Map());
  const [drawer, setDrawer] = useState(parseOpen(params.get('open')));
  const [form, setForm] = useState(null); // { editing? }
  const [reassign, setReassign] = useState(null); // { tab }
  const [pdf, setPdf] = useState(false);
  const [denied, setDenied] = useState('');

  const canEdit = can('tasks_mine', 'edit');
  const canReassign = canEdit || can('pc_main', 'edit');
  const isCl = tab === 'checklists';
  const search = useDebounce(filters.search, 300);

  useEffect(() => { tasksApi.meta().then(setMeta).catch((e) => setDenied(errMsg(e))); }, []);

  const query = useMemo(() => {
    const q = { scope, page, limit: LIMIT, search, status: filters.status, assignee: filters.assignee, category: filters.category, priority: filters.priority };
    if (isCl) q.frequency = filters.frequency;
    return Object.fromEntries(Object.entries(q).filter(([, v]) => v !== '' && v != null));
  }, [scope, page, search, filters, isCl]);

  const load = useCallback(async () => {
    setLoading(true);
    try { setRes(await (isCl ? tasksApi.checklists : tasksApi.delegations)(query)); }
    catch (e) { toast.error('Could not load tasks', errMsg(e)); }
    finally { setLoading(false); }
  }, [isCl, query, toast]);
  useEffect(() => { load(); }, [load]);

  const setFilter = (patch) => { setFilters((f) => ({ ...f, ...patch })); setPage(1); };
  const switchTab = (t) => { setTab(t); setSel(new Map()); setFilters((f) => ({ ...f, status: '', frequency: '' })); setPage(1); };
  const pickDoer = (v) => {
    setFilter({ assignee: v });
    if (v && scope === 'mine') setScope(meta?.can_all ? 'all' : 'assigned');
  };
  const dirty = Object.entries(filters).some(([, v]) => v !== '');
  const kind = isCl ? 'checklist' : 'delegation';

  const toggleRow = (r) => setSel((m) => {
    const n = new Map(m);
    const k = `${kind}:${r.id}`;
    if (n.has(k)) n.delete(k); else n.set(k, { kind, id: r.id, title: r.title });
    return n;
  });
  const allOnPage = res.data.length > 0 && res.data.every((r) => sel.has(`${kind}:${r.id}`));
  const toggleAll = () => setSel((m) => {
    const n = new Map(m);
    res.data.forEach((r) => { const k = `${kind}:${r.id}`; if (allOnPage) n.delete(k); else n.set(k, { kind, id: r.id, title: r.title }); });
    return n;
  });

  const onSaved = ({ kind: k, id, isEdit, warning }) => {
    setForm(null);
    if (warning) toast.warning('Saved, but: ' + warning, undefined, 7000);
    else toast.success(isEdit ? 'Task updated' : 'Task assigned');
    setTab(k === 'checklist' ? 'checklists' : 'delegations');
    setSel(new Map());
    setDrawer({ kind: k, id });
    load();
  };

  if (denied) return <div className="page"><p className="tk-err">{denied}</p></div>;
  if (!meta) return <Loader label="Loading…" />;

  const who = filters.assignee
    ? meta.users.find((u) => String(u.id) === String(filters.assignee))?.name
    : scope === 'mine' ? 'Assigned to me' : scope === 'assigned' ? 'Assigned by me' : 'Everybody’s tasks';
  const pages = Math.max(1, Math.ceil(res.total / LIMIT));
  const selected = [...sel.values()];

  return (
    <div className="page tk-page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Tasks</h2>
          <p className="page-header__sub">Delegations are one-time tasks with a deadline. Checklists repeat by a frequency. Whoever gets a task is the assignee; whoever gave it is the assigner.</p>
        </div>
        <div className="page-header__actions">
          {canReassign && <Button variant="secondary" icon={Users} onClick={() => setReassign({ tab: selected.length ? 'selected' : 'leave' })}>{selected.length ? `Reassign doer (${selected.length})` : 'Reassign doer'}</Button>}
          {canEdit && <Button icon={Plus} onClick={() => setForm({})}>Add task</Button>}
        </div>
      </div>

      <div className="tk-tabs">
        <button type="button" className={!isCl ? 'is-on' : ''} onClick={() => switchTab('delegations')}>Delegations</button>
        <button type="button" className={isCl ? 'is-on' : ''} onClick={() => switchTab('checklists')}>Checklists</button>
      </div>

      <div className="tk-toolbar">
        <label className="tk-search"><Search size={15} />
          <input type="search" placeholder="Search tasks…" value={filters.search} onChange={(e) => setFilter({ search: e.target.value })} />
        </label>
        <select className="field__input" value={scope} onChange={(e) => { setScope(e.target.value); setPage(1); }}>
          <option value="mine">Assigned to me</option>
          <option value="assigned">Assigned by me</option>
          {meta.can_all && <option value="all">Everybody’s tasks</option>}
        </select>
        <select className="field__input" value={filters.status} onChange={(e) => setFilter({ status: e.target.value })}>
          {(isCl ? C_STATUS : D_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select className="field__input" value={filters.assignee} onChange={(e) => pickDoer(e.target.value)}>
          <option value="">All doers</option>
          {meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </select>
        {isCl && (
          <select className="field__input" value={filters.frequency} onChange={(e) => setFilter({ frequency: e.target.value })}>
            <option value="">Any frequency</option>
            {meta.frequencies.map((f) => <option key={f}>{f}</option>)}
          </select>
        )}
        <select className="field__input" value={filters.category} onChange={(e) => setFilter({ category: e.target.value })}>
          <option value="">All categories</option>
          {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select className="field__input" value={filters.priority} onChange={(e) => setFilter({ priority: e.target.value })}>
          <option value="">Any priority</option>
          {meta.priorities.map((p) => <option key={p}>{p}</option>)}
        </select>
        {isCl && <Button variant="secondary" size="sm" icon={FileText} onClick={() => setPdf(true)}>Generate PDF</Button>}
        {dirty && <Button variant="ghost" size="sm" onClick={() => { setFilters(EMPTY); setPage(1); }}>Clear</Button>}
      </div>

      <div className={`table-wrap tk-tablewrap ${loading ? 'is-loading' : ''}`}>
        <table className="table table--clickable">
          <thead>
            {isCl ? (
              <tr>
                <th><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all" /></th>
                <th>Checklist</th><th>Priority</th><th>Repeats</th><th>Assigned to</th><th>Assigned by</th><th>Next due</th><th>Done</th><th>Status</th>
              </tr>
            ) : (
              <tr>
                <th><input type="checkbox" checked={allOnPage} onChange={toggleAll} aria-label="Select all" /></th>
                <th>Task</th><th>Priority</th><th>Assigned to</th><th>Assigned by</th><th>Deadline</th><th>Progress</th><th>Status</th>
              </tr>
            )}
          </thead>
          <tbody>
            {!loading && !res.data.length && (
              <tr><td colSpan={isCl ? 9 : 8} className="tk-empty">
                {dirty ? 'No tasks match these filters' : isCl ? 'No checklists yet' : 'No tasks yet'}
                {!dirty && canEdit && <small>Press “+ Add task” to assign one.</small>}
              </td></tr>
            )}
            {res.data.map((r) => (
              <tr key={r.id} onClick={() => setDrawer({ kind, id: r.id })}>
                <td onClick={(e) => e.stopPropagation()}><input type="checkbox" checked={sel.has(`${kind}:${r.id}`)} onChange={() => toggleRow(r)} aria-label="Select" /></td>
                <td><strong>{r.title}</strong>{r.category_name && <small className="tk-sub2">{r.category_name}</small>}</td>
                <td><PriorityChip p={r.priority} /></td>
                {isCl && <td>{r.repeat_text}</td>}
                <td>{r.assignee_name}</td>
                <td>{r.assigner_name}</td>
                {isCl ? (
                  <>
                    <td>{r.next_due ? fmtDT(r.next_due) : '—'}</td>
                    <td>
                      <span>{r.done_count}</span>
                      <span className="tk-badges">
                        {r.done_late_count > 0 && <Badge2 tone="amber">{r.done_late_count} not on time</Badge2>}
                        {r.non_functional_count > 0 && <Badge2 tone="grey">{r.non_functional_count} non functional</Badge2>}
                        {r.not_done_count > 0 && <Badge2 tone="lavender">{r.not_done_count} not done</Badge2>}
                        {r.overdue > 0 && <Badge2 tone="red">{`${r.overdue} delayed${r.max_overdue_days ? ` · ${dayWord(r.max_overdue_days)}` : ''}`}</Badge2>}
                      </span>
                    </td>
                    <td><Badge2 tone={r.active ? 'green' : 'grey'}>{r.active ? 'Active' : 'Paused'}</Badge2></td>
                  </>
                ) : (
                  <>
                    <td className={r.is_overdue ? 'tk-late' : ''}>
                      {fmtDT(r.deadline)}
                      {r.revisions > 0 && <span className="tk-mini">↻ {r.revisions}</span>}
                      {r.revision_pending && <Badge2 tone="purple">Request</Badge2>}
                    </td>
                    <td>{r.checkpoints?.length ? `${r.checkpoints.filter((c) => c.done).length} / ${r.checkpoints.length}` : '—'}</td>
                    <td><DelegationStatus d={r} /></td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="tk-pager">
        <span>{res.total} {isCl ? 'checklists' : 'tasks'}</span>
        <span className="tk-spacer" />
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Button>
        <span>{page} / {pages}</span>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Button>
      </div>

      {form && (
        <TaskFormModal
          key={form.editing ? `${form.editing.kind}${form.editing.id}` : 'new'}
          open
          meta={meta}
          editing={form.editing}
          onClose={() => setForm(null)}
          onSaved={onSaved}
          onCategoryAdded={(c) => setMeta((m) => ({ ...m, categories: m.categories.some((x) => x.id === c.id) ? m.categories : [...m.categories, c] }))}
        />
      )}
      {drawer && (
        <TaskDrawer
          key={`${drawer.kind}${drawer.id}`}
          target={drawer}
          onClose={() => setDrawer(null)}
          onChanged={load}
          onDeleted={() => { setDrawer(null); toast.success('Deleted'); load(); }}
          onEdit={(detail) => { setDrawer(null); setForm({ editing: detail }); }}
        />
      )}
      {reassign && (
        <ReassignModal
          open
          items={selected}
          doers={meta.users}
          initialTab={reassign.tab}
          onClose={() => setReassign(null)}
          onDone={() => { setSel(new Map()); load(); }}
        />
      )}
      {pdf && (
        <PdfPopup
          open
          onClose={() => setPdf(false)}
          meId={user.id}
          who={who}
          filtered={dirty}
          filters={{ scope, search, status: filters.status, assignee: filters.assignee, category: filters.category, priority: filters.priority, frequency: filters.frequency }}
        />
      )}
    </div>
  );
}
