import { useEffect, useRef, useState } from 'react';
import { CalendarDays, ChevronDown, Check } from 'lucide-react';

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);

export const RANGE_PRESETS = [
  { key: 'today', label: 'Today', get: (t) => [t, t] },
  { key: 'yesterday', label: 'Yesterday', get: (t) => [addDays(t, -1), addDays(t, -1)] },
  { key: 'last7', label: 'Last 7 Days', get: (t) => [addDays(t, -6), t] },
  { key: 'last14', label: 'Last 14 Days', get: (t) => [addDays(t, -13), t] },
  { key: 'last30', label: 'Last 30 Days', get: (t) => [addDays(t, -29), t] },
  { key: 'month', label: 'This Month', get: (t) => [new Date(t.getFullYear(), t.getMonth(), 1), t] },
];

export const getRange = (key) => {
  const preset = RANGE_PRESETS.find((p) => p.key === key) || RANGE_PRESETS[2];
  const [from, to] = preset.get(startOfDay(new Date()));
  return { key: preset.key, label: preset.label, from, to };
};

/** Every day in the range, inclusive. */
export const daysInRange = ({ from, to }) => {
  const out = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
};

const fmt = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
export const formatRange = ({ from, to }) =>
  from.getTime() === to.getTime() ? fmt.format(from) : `${fmt.format(from)} - ${fmt.format(to)}`;

export function DateRangePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false);
    const esc = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, [open]);

  return (
    <div className="daterange" ref={ref}>
      <button type="button" className="daterange__btn" onClick={() => setOpen((o) => !o)} aria-haspopup="listbox" aria-expanded={open}>
        <CalendarDays size={15} strokeWidth={1.75} className="daterange__icon" />
        <span>{formatRange(value)}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <ul className="daterange__menu" role="listbox" aria-label="Date range">
          {RANGE_PRESETS.map((p) => (
            <li key={p.key}>
              <button
                type="button"
                role="option"
                aria-selected={p.key === value.key}
                className={`daterange__opt ${p.key === value.key ? 'is-selected' : ''}`}
                onClick={() => {
                  onChange(getRange(p.key));
                  setOpen(false);
                }}
              >
                <span>{p.label}</span>
                {p.key === value.key && <Check size={16} />}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
