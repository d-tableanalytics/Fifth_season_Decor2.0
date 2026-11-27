import { useEffect, useState } from 'react';
import { tasksApi, saveBlob } from '../../api/tasks';
import { getErrorMessage } from '../../api/client';
import { useToast } from '../../context/ToastContext';
import { Button } from '../ui/Button';
import { Modal } from '../ui/Modal';
import { Skeleton } from '../ui/Loader';
import { dmy, fmtDT, pct } from './common';

const MODES = [['combined', 'Delegation + Checklist'], ['delegation', 'Delegation'], ['checklist', 'Checklist']];
const PRIOS = ['Urgent', 'High', 'Medium', 'Low'];
const neg = (v) => (Number(v) < 0 ? 'td-neg' : '');

const Kpi = ({ label, value, tone, onClick }) => {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} className="td-kpi" onClick={onClick}>
      <b className={tone}>{value}</b><span>{label}</span>
    </Tag>
  );
};

function Summary({ S, onNegative, onFinal }) {
  return (
    <>
      <div className="td-kpis">
        <Kpi label="Total negative performance" value={pct(S.negative_pct)} tone={neg(S.negative_pct)} />
        <Kpi label="Late negative" value={pct(S.late_pct)} tone={neg(S.late_pct)} />
        <Kpi label="Work not done negative" value={pct(S.not_done_pct)} tone={neg(S.not_done_pct)} />
        <Kpi label="Maximum priority marks" value={S.max_marks} />
      </div>
      <div className="td-kpis">
        <Kpi label="Total assigned" value={S.assigned} />
        <Kpi label="Work done" value={S.done} />
        <Kpi label="Work done but not on time" value={S.late} />
        <Kpi label="Work not done" value={S.not_done} />
        <Kpi label="Total negative marks" value={S.negative} tone={neg(S.negative)} onClick={onNegative} />
        <Kpi label="Final performance score" value={S.final} onClick={onFinal} />
      </div>
    </>
  );
}

export function PerformanceScore({ filters, onPickDoer }) {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [mode, setMode] = useState('combined');
  const [busy, setBusy] = useState(false);
  const [modal, setModal] = useState(null); // 'negative' | 'final'
  const key = JSON.stringify(filters);

  useEffect(() => {
    let live = true;
    setData(null);
    tasksApi.score(filters).then((r) => live && setData(r)).catch((e) => toast.error('Could not load the score', getErrorMessage(e)));
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const pdf = async () => {
    setBusy(true);
    try { saveBlob(await tasksApi.scorePdf(filters), 'performance-scoring.pdf'); } catch (e) { toast.error('Could not make the PDF', getErrorMessage(e)); } finally { setBusy(false); }
  };

  const person = data?.person;
  const S = data && person ? data[mode] : null;
  const tasks = (data?.tasks || []).filter((t) => mode === 'combined' || t.module.toLowerCase() === mode);
  const period = data ? `${dmy(data.period.from)} – ${dmy(data.period.to)}` : '';

  return (
    <div className="card">
      <div className="card__head">
        <h3>Performance Score{person ? ` · ${person.name}` : ''}</h3>
        <Button size="sm" variant="secondary" loading={busy} onClick={pdf}>Scoring report (PDF)</Button>
      </div>
      {!data ? <Skeleton height={90} /> : (
        <>
          <p className="td-formula">{period} · {data.formula}</p>

          {!person && (
            <>
              <div className="td-kpis">
                <Kpi label="Total negative performance" value={pct(data.totals.combined.negative_pct)} tone={neg(data.totals.combined.negative_pct)} />
                <Kpi label="Delegation" value={pct(data.totals.delegation.negative_pct)} tone={neg(data.totals.delegation.negative_pct)} />
                <Kpi label="Checklist" value={pct(data.totals.checklist.negative_pct)} tone={neg(data.totals.checklist.negative_pct)} />
                <Kpi label="Work done but not on time" value={data.totals.combined.late} />
                <Kpi label="Work not done" value={data.totals.combined.not_done} />
                <Kpi label="Maximum priority marks" value={data.totals.combined.max_marks} />
              </div>
              {!data.people.length ? <p className="td-empty">No scored tasks in this period.</p> : (
                <div className="td-scroll">
                  <table className="table td-table-sm">
                    <thead><tr><th>Person</th><th className="num">Delegation</th><th className="num">Checklist</th><th className="num">Marks earned</th><th className="num">Negative marks</th><th className="num">Final score</th><th className="num">Negative performance</th></tr></thead>
                    <tbody>
                      {data.people.map((p) => (
                        <tr key={p.id} className="td-row-click" onClick={() => onPickDoer(String(p.id))}>
                          <td>{p.name}<br /><span className="td-sub">{p.department || 'No department'}</span></td>
                          <td className="num">{pct(p.delegation.negative_pct)}</td>
                          <td className="num">{pct(p.checklist.negative_pct)}</td>
                          <td className="num">{p.earned}</td>
                          <td className="num td-neg">{p.negative}</td>
                          <td className="num"><b>{p.final}</b></td>
                          <td className="num td-neg">{pct(p.negative_pct)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              <p className="td-note">Click a person for the full breakdown, task by task.</p>
            </>
          )}

          {person && S && (
            <>
              <div className="td-seg" role="group" aria-label="Score scope">
                {MODES.map(([k, l]) => <button key={k} type="button" className={mode === k ? 'is-on' : ''} onClick={() => setMode(k)}>{l}</button>)}
              </div>
              <Summary S={S} onNegative={() => setModal('negative')} onFinal={() => setModal('final')} />

              <div className="td-score2">
                <div className="td-scroll">
                  <table className="table td-table-sm">
                    <thead><tr><th>Measure</th><th className="num">Delegation</th><th className="num">Checklist</th><th className="num">Combined</th></tr></thead>
                    <tbody>
                      {[
                        ['Tasks assigned', 'assigned'], ['Work done', 'done'], ['Work done but not on time', 'late'], ['Work not done', 'not_done'],
                        ['Non-functional (not scored)', 'non_functional'], ['Not due yet', 'open'],
                      ].map(([l, k]) => (
                        <tr key={k}><td>{l}</td>{['delegation', 'checklist', 'combined'].map((m) => <td className="num" key={m}>{data[m][k]}</td>)}</tr>
                      ))}
                      <tr><td>Tasks by priority</td>{['delegation', 'checklist', 'combined'].map((m) => (
                        <td className="num" key={m}>{PRIOS.map((p) => `${p[0]}:${data[m].by_priority.find((x) => x.priority === p)?.assigned || 0}`).join(' ')}</td>
                      ))}</tr>
                      <tr><td>Marks earned</td>{['delegation', 'checklist', 'combined'].map((m) => <td className="num" key={m}>{data[m].earned}</td>)}</tr>
                      <tr><td>Negative marks</td>{['delegation', 'checklist', 'combined'].map((m) => (
                        <td className="num td-neg" key={m}><button type="button" className="td-linkbtn td-neg" onClick={() => { setMode(m); setModal('negative'); }}>{data[m].negative}</button></td>
                      ))}</tr>
                      <tr><td>Max marks</td>{['delegation', 'checklist', 'combined'].map((m) => <td className="num" key={m}>{data[m].max_marks}</td>)}</tr>
                      <tr><td>Late negative %</td>{['delegation', 'checklist', 'combined'].map((m) => <td className="num td-neg" key={m}>{pct(data[m].late_pct)}</td>)}</tr>
                      <tr><td>Not-done negative %</td>{['delegation', 'checklist', 'combined'].map((m) => <td className="num td-neg" key={m}>{pct(data[m].not_done_pct)}</td>)}</tr>
                      <tr><td><b>Total negative performance %</b></td>{['delegation', 'checklist', 'combined'].map((m) => <td className="num td-neg" key={m}><b>{pct(data[m].negative_pct)}</b></td>)}</tr>
                      <tr><td><b>Final score (%)</b></td>{['delegation', 'checklist', 'combined'].map((m) => <td className="num" key={m}><b>{pct(data[m].percent)}</b></td>)}</tr>
                    </tbody>
                  </table>
                </div>
                <div>
                  <table className="table td-table-sm">
                    <thead><tr><th>Priority</th><th className="num">Per miss</th><th className="num">Max marks</th><th className="num">Work not done</th><th className="num">Done but not on time</th><th className="num">Total deducted</th></tr></thead>
                    <tbody>
                      {PRIOS.map((p) => { const r = S.by_priority.find((x) => x.priority === p) || {}; return (
                        <tr key={p}><td><span className={`td-chip td-chip--${p}`}>{p}</span></td><td className="num">-{r.penalty}</td><td className="num">{r.max || 0}</td><td className="num">{r.not_done || 0}</td><td className="num">{r.late || 0}</td><td className="num">{r.deducted || 0}</td></tr>
                      ); })}
                      <tr><td colSpan={5}><b>Total</b></td><td className="num"><b>{S.total_deducted}</b></td></tr>
                    </tbody>
                  </table>
                  <p className="td-note">Final score = marks earned ({S.earned}) + negative marks ({S.negative}) = {S.final}.</p>
                </div>
              </div>

              <div className="td-scroll" style={{ marginTop: 14 }}>
                <table className="table td-table-sm">
                  <thead><tr><th>Task</th><th>Module</th><th>Assigned</th><th>Due</th><th>Completed</th><th>Priority</th><th>Status</th><th>Verification</th><th className="num">Base</th><th className="num">Deduction</th><th className="num">Task score</th><th>Reason</th></tr></thead>
                  <tbody>
                    {tasks.map((t) => (
                      <tr key={`${t.kind}${t.task_id}${t.occ_id || ''}`}>
                        <td>{t.title}</td><td>{t.module}</td><td>{fmtDT(t.assigned_at, true)}</td><td>{fmtDT(t.due_at, true)}</td>
                        <td>{t.completed_at ? fmtDT(t.completed_at, true) : '—'}</td>
                        <td><span className={`td-chip td-chip--${t.priority}`}>{t.priority}</span></td>
                        <td><span className={`td-chip td-chip--${t.status}`}>{t.status_label}</span></td>
                        <td>{t.verification}</td>
                        <td className="num">{t.base > 0 ? `+${t.base}` : t.base}</td><td className="num td-neg">{t.deduction || 0}</td><td className="num">{t.score}</td>
                        <td>{t.reason}</td>
                      </tr>
                    ))}
                    <tr><td colSpan={8}><b>Total</b></td>
                      <td className="num"><b>{tasks.reduce((a, t) => a + (t.base || 0), 0)}</b></td>
                      <td className="num td-neg"><b>{tasks.reduce((a, t) => a + (t.deduction || 0), 0)}</b></td>
                      <td className="num"><b>{tasks.reduce((a, t) => a + (t.score || 0), 0)}</b></td><td /></tr>
                  </tbody>
                </table>
              </div>

              {data.audit?.length > 0 && (
                <>
                  <h4 style={{ margin: '14px 0 6px' }}>Audit · changes that can affect marks</h4>
                  <div className="td-scroll">
                    <table className="table td-table-sm">
                      <thead><tr><th>When</th><th>Task</th><th>Change</th><th>From</th><th>To</th><th>By</th><th>Note</th></tr></thead>
                      <tbody>{data.audit.map((a, i) => (
                        <tr key={i}><td>{fmtDT(a.at, true)}</td><td>{a.task}</td><td>{a.change}</td><td>{a.from}</td><td>{a.to}</td><td>{a.by}</td><td>{a.note}</td></tr>
                      ))}</tbody>
                    </table>
                  </div>
                </>
              )}

              <Modal open={!!modal} title={modal === 'negative' ? 'Negative marks' : 'Final performance score'} size="lg" onClose={() => setModal(null)}>
                {modal === 'final' && <p>Final score = marks earned ({S.earned}) + negative marks ({S.negative}) = <b>{S.final}</b> ({pct(S.percent)} of the tasks already due).</p>}
                {PRIOS.map((p) => {
                  const rows = tasks.filter((t) => t.priority === p && t.deduction);
                  const r = S.by_priority.find((x) => x.priority === p);
                  if (!rows.length) return null;
                  return (
                    <div key={p} style={{ marginBottom: 12 }}>
                      <h4>{p} priority: {r?.deducted || 0} marks</h4>
                      <ul className="td-rank">
                        {rows.map((t) => <li key={`${t.kind}${t.task_id}${t.occ_id || ''}`}><span className="td-rank__t">{t.title}<br /><span className="td-sub">{t.reason}</span></span><span className="td-rank__v td-neg">{t.deduction}</span></li>)}
                      </ul>
                    </div>
                  );
                })}
                {!tasks.some((t) => t.deduction) && <p className="td-empty">No marks were deducted.</p>}
              </Modal>
            </>
          )}
          {person && !S && <p className="td-empty">No data.</p>}
        </>
      )}
    </div>
  );
}
