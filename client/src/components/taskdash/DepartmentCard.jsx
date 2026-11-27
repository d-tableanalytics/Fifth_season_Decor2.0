import { pct } from './common';

const RATING = { good: ['Good', 'good'], average: ['Average', 'average'], attention: ['Needs attention', 'attention'], few: ['Not rated', ''] };

export function DepartmentCard({ departments = [], best, weakest, selected, onSelect }) {
  return (
    <div className="card">
      <div className="card__head"><h3>Department Analysis</h3></div>
      {(best || weakest) && (
        <div className="td-banner">
          {best && <span>🏆 Best: <b>{best.department}</b> · {pct(best.on_time_pct)} on time</span>}
          {weakest && <span>⚠ Weakest: <b>{weakest.department}</b> · {pct(weakest.on_time_pct)} on time, {(weakest.not_done || 0) + (weakest.overdue || 0)} missed</span>}
        </div>
      )}
      {!departments.length ? <p className="td-empty">No tasks in this period.</p> : (
        <div className="td-scroll">
          <table className="table td-table-sm">
            <thead>
              <tr>
                <th>Department</th><th className="num">Tasks</th><th>On time</th><th className="num">Late</th><th className="num">Not done</th>
                <th className="num">Overdue days</th><th>Repeated misses</th><th className="num">Rejected</th><th className="num">Pending verif.</th>
                <th className="num">Checklist compliance</th><th>Rating</th>
              </tr>
            </thead>
            <tbody>
              {departments.map((d) => {
                const [label, cls] = RATING[d.rating] || RATING.few;
                return (
                  <tr key={d.department} className={`td-row-click ${selected === d.department ? 'is-sel' : ''}`} onClick={() => onSelect(selected === d.department ? '' : d.department)}>
                    <td>{d.department}</td>
                    <td className="num">{d.total}</td>
                    <td><span className="td-mini"><i style={{ width: `${Math.min(100, d.on_time_pct || 0)}%` }} /></span>{pct(d.on_time_pct)}</td>
                    <td className="num">{d.late}</td>
                    <td className="num">{d.not_done}</td>
                    <td className="num">{d.delay_days}</td>
                    <td>{d.repeated_misses ? `${d.repeated_misses}${d.top_repeated ? ` · ${d.top_repeated.title} (${d.top_repeated.count}×)` : ''}` : '0'}</td>
                    <td className="num">{d.rejects}</td>
                    <td className="num">{d.verify}</td>
                    <td className="num">{d.compliance == null ? '—' : pct(d.compliance)}</td>
                    <td><span className={`td-chip ${cls ? `td-chip--${cls}` : ''}`}>{label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="td-note">Good: 80%+ on time · Average: 60–79% · Needs attention: below 60% · departments with fewer than 3 due tasks are not rated. Set each person’s department on the Staff page.</p>
    </div>
  );
}
