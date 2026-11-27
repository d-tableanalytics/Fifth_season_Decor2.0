import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { tasksApi, saveBlob } from '../../api/tasks';
import { getErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { useDebounce } from '../../hooks/useDebounce';
import { Button } from '../../components/ui/Button';
import { Select } from '../../components/ui/FormControls';
import { Input } from '../../components/ui/Input';
import { Skeleton } from '../../components/ui/Loader';
import { PERIODS, periodRange, dmy, taskLink } from '../../components/taskdash/common';
import { AnalysisCard } from '../../components/taskdash/AnalysisCard';
import { TrendCard, AgeingCard } from '../../components/taskdash/TrendAgeing';
import { DepartmentCard } from '../../components/taskdash/DepartmentCard';
import { TopMissed, MostDelayed, MaxMisses, TopPerformers, NeedsAttention } from '../../components/taskdash/RankedLists';
import { PerformanceScore } from '../../components/taskdash/PerformanceScore';
import { DrillModal } from '../../components/taskdash/DrillModal';

export default function TaskDashboard() {
  const toast = useToast();
  const navigate = useNavigate();
  const [meta, setMeta] = useState({ users: [], categories: [], can_all: false });
  const [period, setPeriod] = useState('today');
  const [custom, setCustom] = useState(periodRange('today'));
  const [doer, setDoer] = useState('');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState('');
  const [searchText, setSearchText] = useState('');
  const search = useDebounce(searchText, 300);
  const [data, setData] = useState(null);
  const [depts, setDepts] = useState([]);
  const [drill, setDrill] = useState(null);
  const [busy, setBusy] = useState('');

  useEffect(() => { tasksApi.meta().then((m) => { setMeta(m); setDepts((old) => [...new Set([...old, ...(m.departments || [])])].sort()); }).catch(() => {}); }, []);

  const range = period === 'custom' ? custom : periodRange(period);
  const filters = useMemo(() => {
    const f = { from: range.from, to: range.to };
    if (doer) f.doer = doer;
    if (department) f.department = department;
    if (category) f.category = category;
    if (kind) f.kind = kind;
    if (search.trim()) f.search = search.trim();
    return f;
  }, [range.from, range.to, doer, department, category, kind, search]);
  const key = JSON.stringify(filters);

  useEffect(() => {
    let live = true;
    setData(null);
    tasksApi.report(filters).then((r) => {
      if (!live) return;
      setData(r);
      setDepts((old) => [...new Set([...old, ...r.departments.map((d) => d.department)])].sort());
    }).catch((e) => live && toast.error('Could not load the dashboard', getErrorMessage(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const download = async (kindName, fn, fallback, busyText) => {
    setBusy(busyText);
    try { saveBlob(await fn(filters), fallback); } catch (e) { toast.error('Could not make the PDF', getErrorMessage(e)); } finally { setBusy(''); }
  };
  const openDrill = (metric, title) => setDrill({ metric, title });
  const periodLabel = `${dmy(range.from)}${range.to !== range.from ? ` – ${dmy(range.to)}` : ''}`;

  return (
    <div className="page td-page">
      <div className="page-header">
        <div>
          <h2 className="page-header__title">Task Dashboard</h2>
          <p className="page-header__sub">
            Delegations and checklists, kept apart. {meta.can_all ? 'Everybody’s tasks.' : 'Your tasks and the tasks you gave or verify.'} Click any number for the tasks behind it.
          </p>
        </div>
        <div className="td-actions">
          {meta.can_all && (
            <Button variant="secondary" loading={busy === 'people'} onClick={() => download('people', tasksApi.reportPeoplePdf, 'task-reports-all-people.pdf', 'people')}>
              {busy === 'people' ? 'Making the reports…' : 'Download all individual person-wise reports'}
            </Button>
          )}
          <Button loading={busy === 'pdf'} onClick={() => download('pdf', tasksApi.reportPdf, 'task-dashboard.pdf', 'pdf')}>
            {busy === 'pdf' ? 'Making the PDF…' : 'Download PDF'}
          </Button>
        </div>
      </div>

      <div className="card td-filters">
        <div className="td-seg" role="group" aria-label="Period">
          {PERIODS.map(([k, l]) => <button key={k} type="button" className={period === k ? 'is-on' : ''} onClick={() => { if (k === 'custom') setCustom(range); setPeriod(k); }}>{l}</button>)}
        </div>
        {period === 'custom' && (
          <div className="td-dates">
            <Input type="date" aria-label="From" value={custom.from} max={custom.to} onChange={(e) => e.target.value && setCustom({ ...custom, from: e.target.value })} />
            <Input type="date" aria-label="To" value={custom.to} min={custom.from} onChange={(e) => e.target.value && setCustom({ ...custom, to: e.target.value })} />
          </div>
        )}
        {meta.can_all && (
          <Select value={doer} onChange={(e) => setDoer(e.target.value)} aria-label="Doer">
            <option value="">All doers</option>
            {meta.users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </Select>
        )}
        <Select value={department} onChange={(e) => setDepartment(e.target.value)} aria-label="Department">
          <option value="">All departments</option>
          {depts.map((d) => <option key={d} value={d}>{d}</option>)}
        </Select>
        <Select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Category">
          <option value="">All categories</option>
          {meta.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="td-seg" role="group" aria-label="Kind">
          {[['', 'All'], ['delegation', 'Delegation'], ['checklist', 'Checklist']].map(([k, l]) => <button key={k} type="button" className={kind === k ? 'is-on' : ''} onClick={() => setKind(k)}>{l}</button>)}
        </div>
        <Input type="search" placeholder="Task…" value={searchText} onChange={(e) => setSearchText(e.target.value)} aria-label="Search" />
      </div>

      <PerformanceScore filters={{ ...filters, kind: undefined }} onPickDoer={meta.can_all ? setDoer : () => {}} />

      {!data ? <Skeleton height={260} /> : (
        <>
          <div className="td-grid2">
            <AnalysisCard kind="d" s={data.delegation} onDrill={openDrill} />
            <AnalysisCard kind="c" s={data.checklist} onDrill={openDrill} />
          </div>
          <div className="td-grid2">
            <TrendCard trend={data.trend} periodLabel={periodLabel} />
            <AgeingCard ageing={data.ageing} onDrill={openDrill} />
          </div>
          <DepartmentCard departments={data.departments} best={data.best_department} weakest={data.weakest_department}
            selected={department} onSelect={setDepartment} />
          <div className="td-grid3">
            <TopMissed rows={data.top_missed} onOpen={(o) => navigate(taskLink(o))} />
            <MostDelayed rows={data.most_delayed} onOpen={(o) => navigate(taskLink(o))} />
            <MaxMisses rows={data.max_misses} />
          </div>
          <div className="td-grid2">
            <TopPerformers rows={data.top_performers} />
            <NeedsAttention rows={data.needs_attention} />
          </div>
        </>
      )}
      <DrillModal drill={drill} filters={filters} onClose={() => setDrill(null)} />
    </div>
  );
}
