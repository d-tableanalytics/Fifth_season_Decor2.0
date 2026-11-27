import { CLASS_COLORS, CLASS_LABELS, CLASS_ORDER, pct, num1 } from './common';

const R = 54;
const C = 2 * Math.PI * R;

function Donut({ s }) {
  const total = CLASS_ORDER.reduce((a, k) => a + (s[k] || 0), 0);
  let offset = 0;
  return (
    <div className="td-donut">
      <svg viewBox="0 0 140 140" width="140" height="140" role="img" aria-label="Task result split">
        <circle cx="70" cy="70" r={R} fill="none" stroke="#eef1f5" strokeWidth="16" />
        {total > 0 && CLASS_ORDER.map((k) => {
          const v = s[k] || 0;
          if (!v) return null;
          const len = (v / total) * C;
          const el = (
            <circle key={k} cx="70" cy="70" r={R} fill="none" stroke={CLASS_COLORS[k]} strokeWidth="16"
              strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-offset} transform="rotate(-90 70 70)">
              <title>{`${CLASS_LABELS[k]}: ${v}`}</title>
            </circle>
          );
          offset += len;
          return el;
        })}
      </svg>
      <div className="td-donut__mid"><b>{pct(s.pct?.negative)}</b><span>NEGATIVE</span></div>
    </div>
  );
}

/** Delegation / Checklist analysis card (spec 15.4 #4). kind = 'd' | 'c' */
export function AnalysisCard({ kind, s, onDrill }) {
  const isC = kind === 'c';
  const p = s.pct || {};
  const total = CLASS_ORDER.reduce((a, k) => a + (s[k] || 0), 0);
  const tiles = [
    [isC ? 'Total due' : 'Total tasks', 'total', s.total, '#c09d52'],
    ['Work Done', 'on_time', s.on_time, CLASS_COLORS.on_time],
    ['Work Done But Not On Time', 'late', s.late, CLASS_COLORS.late],
    ...(isC ? [['Work Not Done', 'not_done', s.not_done, CLASS_COLORS.not_done], ['Non functional (not counted)', 'non_functional', s.non_functional, CLASS_COLORS.non_functional]] : []),
    [isC ? 'Delayed' : 'Currently overdue', 'overdue', s.overdue, CLASS_COLORS.overdue],
    ['Pending verification', 'verify', s.verify, CLASS_COLORS.verify],
  ];
  return (
    <div className="card">
      <div className="card__head">
        <h3>{isC ? 'Checklist Analysis' : 'Delegation Analysis'}</h3>
        <span className="td-sub">{s.total} tasks in this period</span>
      </div>
      <div className="td-an__top">
        <Donut s={s} />
        <div className="td-legend">
          {CLASS_ORDER.map((k) => (
            <div key={k}>
              <span><i style={{ background: CLASS_COLORS[k] }} />{CLASS_LABELS[k]}</span>
              <span>{s[k] || 0} · {total ? pct(((s[k] || 0) / total) * 100) : '0%'}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="td-tiles">
        {tiles.map(([label, key, val, tone]) => (
          <button key={key} type="button" className="td-tile" style={{ '--tone': tone }} onClick={() => onDrill(`${kind}_${key}`, `${isC ? 'Checklist' : 'Delegation'} · ${label}`)}>
            <b>{val || 0}</b><span>{label}</span>
          </button>
        ))}
      </div>
      <div className="td-rates">
        <span>Negative <b>{pct(p.negative)}</b></span>
        <span>Done but not on time <b>{pct(p.late)}</b></span>
        {isC && <span>Not done <b>{pct(p.not_done)}</b></span>}
        <span>On time <b>{pct(p.on_time)}</b></span>
        <span>Overdue <b>{pct(p.overdue)}</b></span>
        <span>Average delay <b>{num1(s.avg_delay)} days</b></span>
        {isC && <span>Compliance <b>{s.compliance == null ? '—' : pct(s.compliance)}</b></span>}
        <span className="td-rates__foot">of the {s.due || 0} tasks already due</span>
      </div>
    </div>
  );
}
