import { useLayoutEffect, useRef, useState } from 'react';

/** Round a max value up to a "nice" number so axis ticks read cleanly. */
const niceMax = (v) => {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
};

// Bar with 4px rounded data-end, square at the baseline
const barPath = (x, top, w, h, r = 4) => {
  if (h <= 0) return '';
  const rr = Math.min(r, w / 2, h);
  const base = top + h;
  return `M${x},${base}V${top + rr}Q${x},${top} ${x + rr},${top}H${x + w - rr}Q${x + w},${top} ${x + w},${top + rr}V${base}Z`;
};

/**
 * Single-series vertical bar chart with hover tooltip.
 * data: [{ key, label, fullLabel, value }]
 */
export function BarChart({ data, height = 230, formatValue = String, formatTick = String, seriesName }) {
  const wrapRef = useRef(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState(null);

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pad = { top: 14, right: 4, bottom: 34, left: 60 };
  const iw = Math.max(0, width - pad.left - pad.right);
  const ih = height - pad.top - pad.bottom;
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((t) => t * max);
  const step = data.length ? iw / data.length : 0;
  const barW = Math.max(4, Math.min(44, step * 0.56));
  const y = (v) => pad.top + ih - (v / max) * ih;
  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(1, Math.floor(iw / 64))));
  const hovered = hover != null ? data[hover] : null;

  return (
    <div className="chart" ref={wrapRef}>
      <svg width={width} height={height} role="img" aria-label={`${seriesName} bar chart`} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.left} x2={width - pad.right} y1={y(t)} y2={y(t)} className={t === 0 ? 'chart__baseline' : 'chart__grid'} />
            <text x={pad.left - 10} y={y(t)} dy="0.32em" textAnchor="end" className="chart__tick">
              {formatTick(t)}
            </text>
          </g>
        ))}

        {data.map((d, i) => {
          const cx = pad.left + step * i + step / 2;
          const top = y(d.value);
          return (
            <g key={d.key}>
              <path
                d={barPath(cx - barW / 2, top, barW, pad.top + ih - top)}
                className={`chart__bar ${hover != null && hover !== i ? 'is-dimmed' : ''}`}
              />
              {i % labelEvery === 0 && (
                <text x={cx} y={height - 10} textAnchor="middle" className="chart__tick">
                  {d.label}
                </text>
              )}
              {/* Hit target: whole column, larger than the bar */}
              <rect
                x={pad.left + step * i}
                y={pad.top}
                width={step}
                height={ih}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
                tabIndex={0}
                aria-label={`${d.fullLabel}: ${formatValue(d.value)}`}
              />
            </g>
          );
        })}
      </svg>

      {hovered && (
        <div
          className="chart__tooltip"
          style={{
            left: Math.min(Math.max(pad.left + step * hover + step / 2, 70), width - 70),
            top: y(hovered.value),
          }}
        >
          <p className="chart__tooltip-title">{hovered.fullLabel}</p>
          <p className="chart__tooltip-row">
            <span className="chart__swatch" />
            {seriesName}
            <strong>{formatValue(hovered.value)}</strong>
          </p>
        </div>
      )}

      {/* Table view for screen readers */}
      <table className="sr-only">
        <caption>{seriesName}</caption>
        <thead>
          <tr>
            <th>Date</th>
            <th>{seriesName}</th>
          </tr>
        </thead>
        <tbody>
          {data.map((d) => (
            <tr key={d.key}>
              <td>{d.fullLabel}</td>
              <td>{formatValue(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
