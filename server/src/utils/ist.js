// All task business dates/times are Indian time (Asia/Kolkata, UTC+05:30, no DST).
const OFFSET_MS = 330 * 60000;
const pad = (n) => String(n).padStart(2, '0');
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Date -> { y, m, d, hh, mm, dow } as seen in IST. */
export function istParts(date) {
  const x = new Date(new Date(date).getTime() + OFFSET_MS);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), hh: x.getUTCHours(), mm: x.getUTCMinutes(), dow: x.getUTCDay() };
}

export const istDate = (date = new Date()) => {
  const p = istParts(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
};
export const todayIST = () => istDate(new Date());

const parseYmd = (s) => s.split('-').map(Number);
const dayNum = (s) => {
  const [y, m, d] = parseYmd(s);
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
};
const fromDayNum = (n) => {
  const x = new Date(n * 86400000);
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
};

export const addDays = (s, n) => fromDayNum(dayNum(s) + n);
export const diffDays = (a, b) => dayNum(a) - dayNum(b); // a - b in days
export const weekday = (s) => {
  const [y, m, d] = parseYmd(s);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
};
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
export const mondayOf = (s) => addDays(s, -((weekday(s) + 6) % 7));

/** 'YYYY-MM-DD' + 'HH:MM' (IST) -> Date */
export function istToDate(dateStr, time = '00:00') {
  const [y, m, d] = parseYmd(dateStr);
  const [hh, mm] = time.split(':').map(Number);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - OFFSET_MS);
}

/** '05 Oct, 10:00 am' (IST) */
export function fmtDateTime(date, withYear = false) {
  if (!date) return '';
  const p = istParts(date);
  const h12 = p.hh % 12 || 12;
  return `${pad(p.d)} ${MONTHS[p.m - 1]}${withYear ? ` ${p.y}` : ''}, ${pad(h12)}:${pad(p.mm)} ${p.hh < 12 ? 'am' : 'pm'}`;
}
/** dd/mm/yyyy from 'YYYY-MM-DD' (or a Date, in IST) */
export function fmtDmy(v) {
  const s = typeof v === 'string' ? v.slice(0, 10) : istDate(v);
  const [y, m, d] = parseYmd(s);
  return `${pad(d)}/${pad(m)}/${y}`;
}
/** Date -> 'YYYY-MM-DDTHH:MM' IST (for datetime-local) */
export const istLocal = (date) => {
  const p = istParts(date);
  return `${p.y}-${pad(p.m)}-${pad(p.d)}T${pad(p.hh)}:${pad(p.mm)}`;
};
/** Parse a client deadline: ISO with offset, or 'YYYY-MM-DDTHH:MM' meaning IST. */
export function parseDeadline(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})(?::\d{2}(?:\.\d+)?)?$/);
  if (m) return istToDate(m[1], m[2]);
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}
