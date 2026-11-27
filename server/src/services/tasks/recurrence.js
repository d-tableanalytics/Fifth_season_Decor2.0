// Recurrence engine (spec 8.6) and verification schedule (spec 8.7). Pure functions, dates as 'YYYY-MM-DD' (IST).
import { badRequest } from '../../utils/httpError.js';
import { addDays, diffDays, weekday, daysInMonth, mondayOf } from '../../utils/ist.js';

export const FREQUENCIES = ['Daily', 'Weekly', 'Monthly', 'Yearly', 'Periodically', 'Custom'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const ymd = (s) => s.split('-').map(Number);

const uniqSorted = (arr, lo, hi) => [...new Set((arr || []).map(Number).filter((n) => Number.isInteger(n) && n >= lo && n <= hi))].sort((a, b) => a - b);

/** Clean the frequency-specific config; throws with the spec's messages. */
export function cleanConfig(frequency, cfg = {}, startDate) {
  if (!FREQUENCIES.includes(frequency)) throw badRequest('Choose how often the checklist repeats');
  if (!startDate) throw badRequest('Choose the start date');
  const c = cfg || {};
  const monthly = () => {
    let dates = uniqSorted(c.month_dates, 1, 31);
    const last = !!c.last_day;
    if (!dates.length && !last) dates = [ymd(startDate)[2]];
    return { month_dates: dates, last_day: last };
  };
  const weekly = () => {
    const days = uniqSorted(c.days, 0, 6);
    return { days: days.length ? days : [weekday(startDate)] };
  };
  switch (frequency) {
    case 'Daily':
    case 'Yearly':
      return {};
    case 'Weekly':
      return weekly();
    case 'Monthly':
      return monthly();
    case 'Periodically': {
      const every = Math.floor(Number(c.every));
      if (!(every >= 1 && every <= 365)) throw badRequest('Repeat every: enter a number of days between 1 and 365');
      return { every };
    }
    default: {
      // Custom
      const unit = c.unit;
      if (unit !== 'weeks' && unit !== 'months') throw badRequest('Choose week or month');
      const every = Math.floor(Number(c.every));
      const max = unit === 'weeks' ? 52 : 24;
      if (!(every >= 1 && every <= max)) throw badRequest(`Occur every: enter a number between 1 and ${max}`);
      return unit === 'weeks' ? { every, unit, ...weekly() } : { every, unit, ...monthly() };
    }
  }
}

const monthMatch = (cfg, y, m, d) => {
  const dim = daysInMonth(y, m);
  if (cfg.last_day && d === dim) return true;
  return (cfg.month_dates || []).some((x) => (x > dim ? dim : x) === d);
};

/** Is `date` a due day of the checklist (ignoring holidays / weekly off)? */
export function isDue({ frequency, start_date: start, end_date: end, config }, date) {
  if (date < start || (end && date > end)) return false;
  const cfg = config || {};
  const [y, m, d] = ymd(date);
  const [sy, sm, sd] = ymd(start);
  switch (frequency) {
    case 'Daily':
      return true;
    case 'Weekly':
      return (cfg.days || []).includes(weekday(date));
    case 'Monthly':
      return monthMatch(cfg, y, m, d);
    case 'Yearly': {
      if (m !== sm) return false;
      const dim = daysInMonth(y, m);
      return d === Math.min(sd, dim);
    }
    case 'Periodically':
      return diffDays(date, start) % cfg.every === 0;
    case 'Custom': {
      if (cfg.unit === 'weeks') {
        const w = Math.round(diffDays(mondayOf(date), mondayOf(start)) / 7);
        return w >= 0 && w % cfg.every === 0 && (cfg.days || []).includes(weekday(date));
      }
      const months = (y - sy) * 12 + (m - sm);
      return months >= 0 && months % cfg.every === 0 && monthMatch(cfg, y, m, d);
    }
    default:
      return false;
  }
}

/** All due dates in [from, to] (inclusive), skipping holidays (Set) and weekly-off weekdays (array). */
export function dueDates(cl, from, to, holidays = new Set(), weeklyOff = []) {
  const out = [];
  const lo = from < cl.start_date ? cl.start_date : from;
  for (let d = lo; d <= to; d = addDays(d, 1)) {
    if (holidays.has(d) || weeklyOff.includes(weekday(d))) continue;
    if (isDue(cl, d)) out.push(d);
  }
  return out;
}

// ---------- Verification schedule (8.7) ----------
export function cleanVerifyConfig(cfg = {}, startDate) {
  const c = cfg || {};
  const freq = c.freq || 'daily';
  switch (freq) {
    case 'daily':
      return { freq };
    case 'days': {
      const days = uniqSorted(c.days, 0, 6);
      if (!days.length) throw badRequest('Choose the days of the week on which the task is verified');
      return { freq, days };
    }
    case 'weekly': {
      const days = uniqSorted(c.days, 0, 6).slice(0, 1);
      if (!days.length) throw badRequest('Choose the weekday on which the task is verified');
      return { freq, days };
    }
    case 'fortnightly':
      return { freq, anchor: /^\d{4}-\d{2}-\d{2}$/.test(c.anchor || '') ? c.anchor : startDate };
    case 'monthly': {
      const raw = c.dom === '' || c.dom == null ? null : Math.floor(Number(c.dom));
      const dom = raw == null || Number.isNaN(raw) ? Number(ymd(startDate)[2]) : Math.min(31, Math.max(0, raw));
      return { freq, dom };
    }
    default:
      return { freq: 'daily' };
  }
}

/** First verification date on/after `from` ('YYYY-MM-DD'). */
export function nextVerifyDate(cfg, from) {
  const c = cfg || { freq: 'daily' };
  switch (c.freq) {
    case 'days':
    case 'weekly': {
      const days = c.days || [];
      for (let i = 0; i < 7; i += 1) {
        const d = addDays(from, i);
        if (days.includes(weekday(d))) return d;
      }
      return from;
    }
    case 'fortnightly': {
      const diff = diffDays(from, c.anchor);
      if (diff <= 0) return c.anchor;
      return addDays(c.anchor, Math.ceil(diff / 15) * 15);
    }
    case 'monthly': {
      let [y, m] = ymd(from);
      for (let i = 0; i < 14; i += 1) {
        const dim = daysInMonth(y, m);
        const day = c.dom === 0 ? dim : Math.min(c.dom, dim);
        const cand = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        if (cand >= from) return cand;
        m += 1;
        if (m > 12) { m = 1; y += 1; }
      }
      return from;
    }
    default:
      return from;
  }
}

export function describeVerify(cfg) {
  const c = cfg || { freq: 'daily' };
  switch (c.freq) {
    case 'days': {
      const n = (c.days || []).map((d) => DAY_NAMES[d]);
      return `Every ${n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}` : n[0]}`;
    }
    case 'weekly':
      return `Weekly, on ${DAY_NAMES[(c.days || [0])[0]]}`;
    case 'fortnightly':
      return `Every 15 days (from ${c.anchor})`;
    case 'monthly':
      return c.dom === 0 ? 'Monthly, on the last day' : `Monthly, on day ${c.dom}`;
    default:
      return 'Daily';
  }
}

/** "Weekly · Mon, Thu · 10:00" style text. */
export function describeRepeat(cl) {
  const SH = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const c = cl.config || {};
  const t = cl.due_time;
  const month = () => [...(c.month_dates || []), ...(c.last_day ? ['last day'] : [])].join(', ');
  switch (cl.frequency) {
    case 'Weekly':
      return `Weekly · ${(c.days || []).map((d) => SH[d]).join(', ')} · ${t}`;
    case 'Monthly':
      return `Monthly · ${month()} · ${t}`;
    case 'Yearly':
      return `Yearly · ${t}`;
    case 'Periodically':
      return `Every ${c.every} days · ${t}`;
    case 'Custom':
      return c.unit === 'weeks'
        ? `Every ${c.every} weeks · ${(c.days || []).map((d) => SH[d]).join(', ')} · ${t}`
        : `Every ${c.every} months · ${month()} · ${t}`;
    default:
      return `Daily · ${t}`;
  }
}
