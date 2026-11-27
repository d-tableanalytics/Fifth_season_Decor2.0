import test from 'node:test';
import assert from 'node:assert/strict';
import { classify, delayDays, prepare, summarize, analyze, itemsFor } from '../src/services/tasks/report.js';
import { scoreTask, summarizeScore, scoreStatus, verificationText } from '../src/services/tasks/score.js';
import { buildPc } from '../src/services/tasks/pc.js';

const NOW = new Date('2026-10-10T10:00:00Z');
const row = (o) => ({ kind: 'd', task_id: 1, occ_id: 1, title: 'T', priority: 'Medium', assignee_id: 1, assignee_name: 'A', department: 'Ops', status: 'pending', due_at: '2026-10-12T04:30:00Z', reject_count: 0, ...o });

test('classification', () => {
  assert.equal(classify(row({ status: 'non_functional' }), NOW), 'non_functional');
  assert.equal(classify(row({ status: 'not_done' }), NOW), 'not_done');
  assert.equal(classify(row({ status: 'submitted' }), NOW), 'verify');
  assert.equal(classify(row({ status: 'completed', submitted_at: '2026-10-12T04:00:00Z' }), NOW), 'on_time');
  assert.equal(classify(row({ status: 'completed', completed_at: '2026-10-13T04:00:00Z' }), NOW), 'late');
  assert.equal(classify(row({ due_at: '2026-10-09T04:30:00Z' }), NOW), 'overdue');
  assert.equal(classify(row(), NOW), 'open');
  assert.equal(delayDays(row({ due_at: '2026-10-07T04:30:00Z' }), 'overdue', NOW), 3);
});
test('summary excludes non_functional and open from percentages', () => {
  const rows = prepare([
    row({ status: 'completed', submitted_at: '2026-10-11T00:00:00Z', due_at: '2026-10-12T04:30:00Z' }),
    row({ status: 'completed', completed_at: '2026-10-14T00:00:00Z', due_at: '2026-10-12T04:30:00Z' }),
    row({ due_at: '2026-10-08T04:30:00Z' }), row({ status: 'non_functional' }), row({}),
  ], NOW);
  const s = summarize(rows);
  assert.equal(s.total, 4); assert.equal(s.non_functional, 1); assert.equal(s.due, 3);
  assert.equal(s.pct.on_time, 33.3); assert.equal(s.pct.negative, 66.7);
  assert.equal(itemsFor('nope', rows, []), null);
  assert.equal(itemsFor('d_total', rows, []).data.length, 4);
  const a = analyze(rows, rows.filter((r) => r.cls === 'overdue'));
  assert.equal(a.ageing.find((x) => x.key === 'age_2_3').delegations, 1);
});
test('scoring formula', () => {
  const mk = (o, pr) => { const r = row(o); const sc = scoreTask(r, pr, NOW); return { kind: r.kind, ...sc }; };
  const tasks = [
    mk({ status: 'completed', submitted_at: '2026-10-11T00:00:00Z' }, 'High'), // on time +1
    mk({ status: 'completed', completed_at: '2026-10-14T00:00:00Z' }, 'Urgent'), // late +1 -3
    mk({ due_at: '2026-10-08T04:30:00Z' }, 'Medium'), // not done -1
    mk({ status: 'non_functional' }, 'Low'), mk({}, 'Low'),
  ];
  const s = summarizeScore(tasks);
  assert.equal(s.assigned, 4); assert.equal(s.due, 3);
  assert.equal(s.earned, 2); assert.equal(s.negative, -4); assert.equal(s.final, -2);
  assert.equal(s.max_marks, 2 + 3 + 1); assert.equal(s.late_pct, -50); assert.equal(s.not_done_pct, -16.7); assert.equal(s.negative_pct, -66.7);
  assert.equal(s.percent, -66.7);
  assert.equal(summarizeScore([]).negative_pct, 0);
  assert.equal(scoreStatus(row({ due_at: '2026-10-08T04:30:00Z' }), NOW), 'not_done');
  assert.match(verificationText(row({ verification_required: true, status: 'submitted', reject_count: 2 })), /Pending verification · rejected 2 times/);
});
test('pc grouping', () => {
  const rows = [
    row({ kind: 'c', task_id: 5, due_at: '2026-10-08T04:30:00Z' }), row({ kind: 'c', task_id: 5, due_at: '2026-10-10T03:00:00Z' }),
    row({ kind: 'c', task_id: 5, due_at: '2026-10-10T12:00:00Z' }), row({ task_id: 9, due_at: '2026-10-20T04:30:00Z' }),
  ];
  const r = buildPc(rows, { show: 'dues' }, NOW);
  assert.equal(r.tasks.length, 1); assert.equal(r.tasks[0].turns, 3); assert.equal(r.tasks[0].delayed_turns, 2); assert.equal(r.tasks[0].today_turns, 2);
  assert.equal(r.summary.oldest_days, 2); assert.equal(buildPc(rows, { show: 'delayed' }, NOW).tasks[0].turns, 2);
});
