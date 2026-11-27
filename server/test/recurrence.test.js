import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanConfig, dueDates, nextVerifyDate, cleanVerifyConfig, describeVerify } from '../src/services/tasks/recurrence.js';
import { istDate, istToDate, fmtDateTime } from '../src/utils/ist.js';

const mk = (frequency, config, start = '2026-01-01', end = null) => ({ frequency, start_date: start, end_date: end, config: cleanConfig(frequency, config, start) });

test('weekly Mon+Thu over 62 days skips holidays and weekly off', () => {
  const cl = mk('Weekly', { days: [1, 4] }, '2026-10-01');
  const all = dueDates(cl, '2026-10-01', '2026-12-01');
  assert.ok(all.length >= 17 && all.length <= 18);
  const hol = new Set([all[1]]);
  assert.equal(dueDates(cl, '2026-10-01', '2026-12-01', hol).length, all.length - 1);
  assert.equal(dueDates(cl, '2026-10-01', '2026-12-01', new Set(), [1]).every((d) => new Date(d + 'T00:00:00Z').getUTCDay() === 4), true);
});
test('monthly short month falls on last day; last_day flag', () => {
  const cl = mk('Monthly', { month_dates: [31] }, '2026-01-31');
  assert.deepEqual(dueDates(cl, '2026-02-01', '2026-04-30'), ['2026-02-28', '2026-03-31', '2026-04-30']);
  const l = mk('Monthly', { last_day: true }, '2026-01-01');
  assert.deepEqual(dueDates(l, '2028-02-01', '2028-02-29'), ['2028-02-29']);
});
test('yearly 29 Feb -> 28 Feb in non-leap years', () => {
  const cl = mk('Yearly', {}, '2024-02-29');
  assert.deepEqual(dueDates(cl, '2025-01-01', '2025-12-31'), ['2025-02-28']);
  assert.deepEqual(dueDates(cl, '2028-01-01', '2028-12-31'), ['2028-02-29']);
});
test('periodically, end date, nothing before start', () => {
  const cl = mk('Periodically', { every: 5 }, '2026-03-01', '2026-03-12');
  assert.deepEqual(dueDates(cl, '2026-02-20', '2026-04-01'), ['2026-03-01', '2026-03-06', '2026-03-11']);
});
test('custom every 2 weeks / 2 months', () => {
  const w = mk('Custom', { every: 2, unit: 'weeks', days: [1] }, '2026-03-02');
  assert.deepEqual(dueDates(w, '2026-03-01', '2026-03-31'), ['2026-03-02', '2026-03-16', '2026-03-30']);
  const m = mk('Custom', { every: 2, unit: 'months', month_dates: [10] }, '2026-01-10');
  assert.deepEqual(dueDates(m, '2026-01-01', '2026-06-30'), ['2026-01-10', '2026-03-10', '2026-05-10']);
});
test('config errors', () => {
  assert.throws(() => cleanConfig('Periodically', { every: 0 }, '2026-01-01'), /between 1 and 365/);
  assert.throws(() => cleanConfig('Custom', { every: 1 }, '2026-01-01'), /Choose week or month/);
  assert.throws(() => cleanConfig(undefined, {}, '2026-01-01'), /how often/);
  assert.throws(() => cleanConfig('Daily', {}, ''), /start date/);
});
test('verification schedule', () => {
  assert.equal(nextVerifyDate({ freq: 'daily' }, '2026-10-07'), '2026-10-07');
  assert.equal(nextVerifyDate({ freq: 'weekly', days: [5] }, '2026-10-07'), '2026-10-09'); // Wed -> Fri
  assert.equal(nextVerifyDate({ freq: 'fortnightly', anchor: '2026-10-01' }, '2026-10-02'), '2026-10-16');
  assert.equal(nextVerifyDate({ freq: 'monthly', dom: 0 }, '2026-02-10'), '2026-02-28');
  assert.equal(nextVerifyDate({ freq: 'monthly', dom: 31 }, '2026-02-29' > '2026-02-28' ? '2026-03-01' : '2026-02-10'), '2026-03-31');
  assert.throws(() => cleanVerifyConfig({ freq: 'days', days: [] }, '2026-01-01'), /days of the week/);
  assert.equal(describeVerify({ freq: 'days', days: [2, 5] }), 'Every Tuesday and Friday');
  assert.equal(describeVerify({ freq: 'monthly', dom: 0 }), 'Monthly, on the last day');
});
test('IST helpers', () => {
  assert.equal(istDate(new Date('2026-10-04T19:00:00Z')), '2026-10-05'); // 00:30 IST next day
  assert.equal(istToDate('2026-10-05', '10:00').toISOString(), '2026-10-05T04:30:00.000Z');
  assert.equal(fmtDateTime(new Date('2026-10-05T04:30:00Z')), '05 Oct, 10:00 am');
});
