import { AGEING_COLORS, CLASS_COLORS, CLASS_LABELS, CLASS_ORDER } from './common';

/** Trend · <period>: stacked bars per day (max 62 days), both kinds summed. */
export function TrendCard({ trend = [], periodLabel }) {
  const days = trend.slice(-62).map((t) => {
    const by = {};
    CLASS_ORDER.forEach((k) => { by[k] = (t.d?.[k] || 0) + (t.c?.[k] || 0); });
    return { date: t.date, by, total: CLASS_ORDER.reduce((a, k) => a + by[k], 0) };
  });
  const max = Math.max(1, ...days.map((d) => d.total));
  const W = 560, H = 190, L = 28, B = 22, T = 8;
  const bw = (W - L) / Math.max(days.length, 1);
  const every = days.length <= 14 ? 1 : 3;
  const y = (v) => T + (H - T - B) * (1 - v / max);
  return (
    <div className="card">
      <div className="card__head"><h3>Trend · {periodLabel}</h3></div>
      {!days.length ? <p className="td-empty">No tasks in this period.</p> : (
        <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label="Trend by day">
          {[0, 0.5, 1].map((f) => (
            <g key={f}>
              <line x1={L} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="#d9dde3" strokeDasharray="3 3" />
              <text x={L - 4} y={y(max * f) + 3} fontSize="9" textAnchor="end" fill="#8a909a">{Math.round(max * f)}</text>
            </g>
          ))}
          {days.map((d, i) => {
            let acc = 0;
            return (
              <g key={d.date}>
                <title>{`${d.date.split('-').reverse().join('/')} — ${CLASS_ORDER.filter((k) => d.by[k]).map((k) => `${CLASS_LABELS[k]}: ${d.by[k]}`).join(', ') || 'none'}`}</title>
                {CLASS_ORDER.map((k) => {
                  if (!d.by[k]) return null;
                  const h = (H - T - B) * (d.by[k] / max);
                  const el = <rect key={k} x={L + i * bw + 1} y={y(acc + d.by[k])} width={Math.max(bw - 2, 1)} height={h} fill={CLASS_COLORS[k]} />;
                  acc += d.by[k];
                  return el;
                })}
                {i % every === 0 && <text x={L + i * bw + bw / 2} y={H - 8} fontSize="8.5" textAnchor="middle" fill="#8a909a">{d.date.slice(8)}</text>}
              </g>
            );
          })}
        </svg>
      )}
      <div className="td-legend-row">
        {CLASS_ORDER.map((k) => <span key={k}><i style={{ background: CLASS_COLORS[k] }} />{CLASS_LABELS[k]}</span>)}
      </div>
    </div>
  );
}

export function AgeingCard({ ageing = [], onDrill }) {
  const max = Math.max(1, ...ageing.map((a) => a.delegations + a.checklists));
  return (
    <div className="card">
      <div className="card__head"><h3>Overdue Ageing</h3></div>
      <div className="td-age">
        {ageing.map((a, i) => (
          <div className="td-age__row" key={a.key}>
            <span>{a.label}</span>
            <div className="td-age__bar" title={`${a.delegations} delegations · ${a.checklists} checklists`}>
              <i style={{ width: `${(a.delegations / max) * 100}%`, background: AGEING_COLORS[i] }} />
              <i style={{ width: `${(a.checklists / max) * 100}%`, background: AGEING_COLORS[i], opacity: 0.45 }} />
            </div>
            <button type="button" className="td-age__count" onClick={() => onDrill(a.key, `Overdue ageing · ${a.label}`)}>{a.delegations + a.checklists}</button>
          </div>
        ))}
      </div>
      <p className="td-note">Dark bar: delegations · light bar: checklists</p>
    </div>
  );
}
