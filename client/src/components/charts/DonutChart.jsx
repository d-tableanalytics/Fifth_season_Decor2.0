import { useState } from 'react';

const polar = (cx, cy, r, angle) => [cx + r * Math.cos(angle), cy + r * Math.sin(angle)];

const arcPath = (cx, cy, rOuter, rInner, start, end) => {
  // A full circle can't be drawn with one arc — nudge it just under 2π
  const sweep = Math.min(end - start, Math.PI * 2 - 0.0001);
  const e = start + sweep;
  const large = sweep > Math.PI ? 1 : 0;
  const [x1, y1] = polar(cx, cy, rOuter, start);
  const [x2, y2] = polar(cx, cy, rOuter, e);
  const [x3, y3] = polar(cx, cy, rInner, e);
  const [x4, y4] = polar(cx, cy, rInner, start);
  return `M${x1},${y1}A${rOuter},${rOuter} 0 ${large} 1 ${x2},${y2}L${x3},${y3}A${rInner},${rInner} 0 ${large} 0 ${x4},${y4}Z`;
};

/**
 * Donut chart with legend (labels + values, so identity is never colour-alone).
 * data: [{ label, value, color }] — colour is a CSS value, e.g. 'var(--chart-1)'.
 */
export function DonutChart({ data, unit = '', centerLabel = 'Total' }) {
  const [active, setActive] = useState(null);
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const size = 220;
  const c = size / 2;

  let angle = -Math.PI / 2;
  const slices = data.map((d) => {
    const start = angle;
    angle += (d.value / total) * Math.PI * 2;
    return { ...d, start, end: angle };
  });

  const shown = active != null ? data[active] : null;

  return (
    <div className="donut">
      <div className="donut__figure">
        <svg viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${centerLabel} donut chart`} onMouseLeave={() => setActive(null)}>
          {slices.map((s, i) => (
            <path
              key={s.label}
              d={arcPath(c, c, active === i ? 104 : 100, 66, s.start, s.end)}
              fill={s.color}
              className={`donut__slice ${active != null && active !== i ? 'is-dimmed' : ''}`}
              onMouseEnter={() => setActive(i)}
            />
          ))}
        </svg>
        <div className="donut__center">
          <strong>{(shown ? shown.value : total).toLocaleString('en-IN')}</strong>
          <span>{shown ? shown.label : centerLabel}</span>
        </div>
      </div>

      <ul className="donut__legend">
        {data.map((d, i) => (
          <li
            key={d.label}
            className={active === i ? 'is-active' : ''}
            onMouseEnter={() => setActive(i)}
            onMouseLeave={() => setActive(null)}
          >
            <span className="donut__dot" style={{ background: d.color }} />
            <span className="donut__label">{d.label}</span>
            <span className="donut__value">
              {d.value.toLocaleString('en-IN')}
              {unit}
            </span>
            <span className="donut__pct">{Math.round((d.value / total) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
