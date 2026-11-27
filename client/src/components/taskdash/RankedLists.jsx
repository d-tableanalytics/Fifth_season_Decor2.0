import { pct } from './common';

function Rank({ title, sub, tone = '', empty, rows, children }) {
  return (
    <div className={`card ${tone}`}>
      <div className="card__head"><h3>{title}</h3>{sub && <span className="td-sub">{sub}</span>}</div>
      {!rows.length ? <p className="td-empty">{empty}</p> : <ol className="td-rank">{children}</ol>}
    </div>
  );
}
const N = ({ i }) => <span className="td-rank__n">{i + 1}</span>;

export const TopMissed = ({ rows = [], onOpen }) => (
  <Rank title="Top Missed Tasks" empty="Nothing missed." rows={rows}>
    {rows.map((r, i) => (
      <li key={`${r.kind}${r.task_id}`} className="is-click" onClick={() => onOpen(r.open)}>
        <N i={i} /><span className="td-rank__t">{r.title}<br /><span className="td-sub">{r.doer}</span></span><span className="td-rank__v">{r.count}×</span>
      </li>
    ))}
  </Rank>
);

export const MostDelayed = ({ rows = [], onOpen }) => (
  <Rank title="Most Delayed Tasks" empty="Nothing is delayed." rows={rows}>
    {rows.map((r, i) => (
      <li key={`${r.kind}${r.task_id}${r.occ_id || ''}`} className="is-click" onClick={() => onOpen(r.open)}>
        <N i={i} /><span className="td-rank__t">{r.title}<br /><span className="td-sub">{r.doer}</span></span><span className="td-rank__v">{r.days} d</span>
      </li>
    ))}
  </Rank>
);

export const MaxMisses = ({ rows = [] }) => (
  <Rank title="Employees with Maximum Misses" empty="No misses." rows={rows}>
    {rows.map((r, i) => (
      <li key={r.id}><N i={i} /><span className="td-rank__t">{r.name}<br /><span className="td-sub">{r.department || 'No department'} · {r.tasks} tasks</span></span><span className="td-rank__v">{r.misses}</span></li>
    ))}
  </Rank>
);

export const TopPerformers = ({ rows = [] }) => (
  <Rank title="Top Performers" sub="best on-time % (3+ tasks)" tone="td-card--good" empty="Not enough tasks yet." rows={rows}>
    {rows.map((r, i) => (
      <li key={r.id}><N i={i} /><span className="td-rank__t">{r.name}<br /><span className="td-sub">{r.tasks} tasks</span></span><span className="td-rank__v td-pos">{pct(r.on_time_pct)}</span></li>
    ))}
  </Rank>
);

export const NeedsAttention = ({ rows = [] }) => (
  <Rank title="Needs Attention" sub="lowest on-time %" tone="td-card--warn" empty="Everyone is on track." rows={rows}>
    {rows.map((r, i) => (
      <li key={r.id}><N i={i} /><span className="td-rank__t">{r.name}<br /><span className="td-sub">{r.misses} missed · {r.tasks} tasks</span></span><span className="td-rank__v td-neg">{pct(r.on_time_pct)}</span></li>
    ))}
  </Rank>
);
