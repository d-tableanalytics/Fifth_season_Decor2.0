// Shared helpers + small components for the Task Management screens. All times are Indian time (IST).
const TZ = 'Asia/Kolkata';

const parts = (d, opts) =>
  Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: TZ, ...opts }).formatToParts(d).map((x) => [x.type, x.value]));

/** '5 Oct, 10:00 am' (with year: '5 Oct 2026, 10:00 am') */
export function fmtDT(v, year = false) {
  if (!v) return '';
  const p = parts(new Date(v), { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true });
  return `${p.day} ${p.month}${year ? ` ${p.year}` : ''}, ${p.hour}:${p.minute} ${String(p.dayPeriod || '').toLowerCase()}`;
}
/** '5 Oct' from a 'YYYY-MM-DD' string or timestamp */
export function fmtD(v, year = false) {
  if (!v) return '';
  const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T12:00:00+05:30`) : new Date(v);
  const p = parts(d, { day: 'numeric', month: 'short', year: 'numeric' });
  return `${p.day} ${p.month}${year ? ` ${p.year}` : ''}`;
}
export const fmtDmy = (s) => String(s).slice(0, 10).split('-').reverse().join('/');
/** Timestamp -> 'YYYY-MM-DDTHH:MM' (IST) for <input type="datetime-local"> */
export function toLocalInput(v) {
  const p = parts(new Date(v), { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
  return `${p.year}-${p.month}-${p.day}T${p.hour === '24' ? '00' : p.hour}:${p.minute}`;
}
export const todayStr = () => toLocalInput(new Date()).slice(0, 10);
export const istDateOf = (v) => toLocalInput(v).slice(0, 10);
export const plusHoursLocal = (h) => toLocalInput(new Date(Date.now() + h * 3600000));

export const fileSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round((n || 0) / 1024))} KB`);
export const dayWord = (n) => `${n} Day${n === 1 ? '' : 's'}`;

// ---------- reminders (stored in minutes, shown in the largest whole unit) ----------
export const UNIT_MIN = { minutes: 1, hours: 60, days: 1440 };
export function minutesToUnit(m) {
  if (m % 1440 === 0) return { n: m / 1440, unit: 'days' };
  if (m % 60 === 0) return { n: m / 60, unit: 'hours' };
  return { n: m, unit: 'minutes' };
}
export function reminderText(list) {
  if (!list?.length) return 'None';
  const short = { days: 'day', hours: 'hr', minutes: 'min' };
  return `${list.map((m) => { const u = minutesToUnit(m); return `${u.n} ${short[u.unit]}`; }).join(', ')} before`;
}

export const WEEK = [
  [1, 'MON'], [2, 'TUE'], [3, 'WED'], [4, 'THU'], [5, 'FRI'], [6, 'SAT'], [0, 'SUN'],
];
export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// ---------- chips / badges ----------
export const PriorityChip = ({ p }) => <span className={`tk-prio tk-prio--${String(p).toLowerCase()}`}>{p}</span>;
export const Badge2 = ({ tone, children }) => <span className={`tk-badge tk-badge--${tone}`}>{children}</span>;

export function DelegationStatus({ d }) {
  if (d.status === 'completed') return <Badge2 tone="green">Completed</Badge2>;
  if (d.status === 'submitted') return <Badge2 tone="purple">Awaiting verification</Badge2>;
  if (d.is_overdue) return <Badge2 tone="red">{d.overdue_days >= 1 ? `Delayed · ${dayWord(d.overdue_days)} Overdue` : 'Delayed'}</Badge2>;
  return <Badge2 tone="blue">Open</Badge2>;
}

export function TurnStatus({ t }) {
  switch (t.work_status) {
    case 'done': return <Badge2 tone="green">Work Done</Badge2>;
    case 'done_late': return <Badge2 tone="amber">Work Done – Not On Time</Badge2>;
    case 'not_done': return <Badge2 tone="lavender">Work Not Done</Badge2>;
    case 'non_functional': return <Badge2 tone="grey">Non Functional</Badge2>;
    case 'verify': return <Badge2 tone="purple">{`Awaiting verification${t.on_time === false ? ' · not on time' : ''}`}</Badge2>;
    case 'delayed': return <Badge2 tone="red">{t.overdue_days >= 1 ? `Delayed · ${dayWord(t.overdue_days)} Overdue` : 'Delayed'}</Badge2>;
    default: return <Badge2 tone="blue">Open</Badge2>;
  }
}

export const errMsg = (e) => e?.response?.data?.message || e?.message || 'Something went wrong';
