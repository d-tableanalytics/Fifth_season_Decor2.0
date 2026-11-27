// Shared constants / helpers for the Task Dashboard & PC Dashboard screens.
export const CLASS_COLORS = {
  on_time: '#2fb97c', late: '#f2b600', not_done: '#e5484d', overdue: '#ff7a45',
  verify: '#8b5cf6', open: '#c9d3e0', non_functional: '#94a3b8',
};
export const CLASS_LABELS = {
  on_time: 'Work Done', late: 'Work Done But Not On Time', not_done: 'Work Not Done', overdue: 'Overdue',
  verify: 'Pending verification', open: 'Not due yet', non_functional: 'Non functional',
};
export const AGEING_COLORS = ['#f2b600', '#ff9a45', '#ff6a45', '#d93a3f'];
export const CLASS_ORDER = ['on_time', 'late', 'not_done', 'overdue', 'verify', 'open'];

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const parse = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
const addDays = (s, n) => { const d = parse(s); d.setUTCDate(d.getUTCDate() + n); return ymd(d); };

export const todayIST = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

/** Date range for a period preset (IST calendar days). */
export function periodRange(period, today = todayIST()) {
  const d = parse(today);
  if (period === 'week') {
    const mon = addDays(today, -((d.getUTCDay() + 6) % 7));
    return { from: mon, to: addDays(mon, 6) };
  }
  if (period === 'month') {
    const first = `${today.slice(0, 7)}-01`;
    const last = ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)));
    return { from: first, to: last };
  }
  if (period === 'prev') {
    const first = ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)));
    const last = ymd(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0)));
    return { from: first, to: last };
  }
  return { from: today, to: today };
}

export const PERIODS = [
  ['today', 'Today'], ['week', 'This Week'], ['month', 'This Month'], ['prev', 'Previous Month'], ['custom', 'Custom'],
];

export const dmy = (s) => (s ? String(s).slice(0, 10).split('-').reverse().join('/') : '');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** '5 Oct, 10:00 am' in IST */
export function fmtDT(iso, year = false) {
  if (!iso) return '—';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', day: 'numeric', month: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  }).formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.day} ${MON[Number(p.month) - 1]}${year ? ` ${p.year}` : ''}, ${p.hour}:${p.minute} ${String(p.dayPeriod).toLowerCase()}`;
}
export const pct = (v) => `${Math.round((Number(v) || 0) * 10) / 10}%`;
export const num1 = (v) => String(Math.round((Number(v) || 0) * 10) / 10);
export const taskLink = (open) => `/tasks?${String(open).startsWith('c') ? 'tab=checklists&' : ''}open=${open}`;
