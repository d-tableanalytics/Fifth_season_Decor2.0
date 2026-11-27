import { Router } from 'express';
import { query, withTransaction } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { badRequest, notFound } from '../utils/httpError.js';
import { addDays, diffDays, weekday } from '../utils/ist.js';
import { cleanText, posInt, generateTurns, untouchedSql } from '../services/tasks/common.js';

const router = Router();
router.use(requireAuth);

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(new Date(`${s}T00:00:00Z`).getTime());
const IST_DATE = "(o.due_at AT TIME ZONE 'Asia/Kolkata')::date";

/** Delete untouched turns on these dates / weekdays (past ones too). Returns count removed. */
async function removeUntouched(db, { dates = [], weekdays = [] }) {
  const { rowCount } = await db.query(
    `DELETE FROM checklist_occurrences o
      WHERE ${untouchedSql('o')} AND (${IST_DATE} = ANY($1::date[]) OR EXTRACT(DOW FROM ${IST_DATE})::int = ANY($2::int[]))`,
    [dates, weekdays]
  );
  return rowCount;
}
const delegationsDue = async (db, dates, weekdays = []) =>
  Number((await db.query(
    `SELECT COUNT(*) FROM delegations d WHERE d.status = 'pending'
       AND ((d.deadline AT TIME ZONE 'Asia/Kolkata')::date = ANY($1::date[])
         OR EXTRACT(DOW FROM d.deadline AT TIME ZONE 'Asia/Kolkata')::int = ANY($2::int[]))`, [dates, weekdays])).rows[0].count);

router.get('/', requirePermission('holidays', 'view'), async (req, res) => {
  const [h, w] = await Promise.all([
    query('SELECT id, holiday_date, name FROM holidays ORDER BY holiday_date'),
    query('SELECT weekly_off FROM work_settings WHERE id = 1'),
  ]);
  res.json({ data: h.rows, weekly_off: (w.rows[0]?.weekly_off || [0]).map(Number) });
});

// Add one date, or a range (max 60 days): { date } or { from, to }, plus name
router.post('/', requirePermission('holidays', 'create'), async (req, res) => {
  const name = cleanText(req.body.name, 120);
  if (!name) throw badRequest('Enter the holiday name');
  const from = req.body.from || req.body.date;
  const to = req.body.to || from;
  if (!isDate(from) || !isDate(to)) throw badRequest('Choose the holiday date');
  if (to < from) throw badRequest('The “to” date cannot be before the “from” date');
  if (diffDays(to, from) >= 60) throw badRequest('A holiday range can be at most 60 days');
  const dates = [];
  for (let d = from; d <= to; d = addDays(d, 1)) dates.push(d);
  const out = await withTransaction(async (db) => {
    await db.query(
      `INSERT INTO holidays (holiday_date, name) SELECT d, $2 FROM unnest($1::date[]) d
       ON CONFLICT (holiday_date) DO UPDATE SET name = EXCLUDED.name`, [dates, name]);
    return { removed_turns: await removeUntouched(db, { dates }), delegations_due: await delegationsDue(db, dates) };
  });
  res.status(201).json({ message: 'Holiday saved', ...out });
});

router.put('/weekly-off', requirePermission('holidays', 'edit'), async (req, res) => {
  const days = [...new Set((Array.isArray(req.body.days) ? req.body.days : []).map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort();
  const out = await withTransaction(async (db) => {
    const old = (await db.query('SELECT weekly_off FROM work_settings WHERE id = 1')).rows[0]?.weekly_off || [];
    await db.query('UPDATE work_settings SET weekly_off = $1::smallint[] WHERE id = 1', [days]);
    const added = days.filter((d) => !old.includes(d));
    const res2 = { removed_turns: added.length ? await removeUntouched(db, { weekdays: added }) : 0, delegations_due: await delegationsDue(db, [], added) };
    await generateTurns(db);
    return res2;
  });
  res.json({ message: 'Weekly off saved', weekly_off: days, ...out });
});

router.put('/:id', requirePermission('holidays', 'edit'), async (req, res) => {
  const id = posInt(req.params.id) || (() => { throw notFound('Holiday not found'); })();
  const name = cleanText(req.body.name, 120);
  if (!name) throw badRequest('Enter the holiday name');
  const date = req.body.date;
  if (!isDate(date)) throw badRequest('Choose the holiday date');
  const out = await withTransaction(async (db) => {
    const cur = (await db.query('SELECT holiday_date FROM holidays WHERE id = $1', [id])).rows[0];
    if (!cur) throw notFound('Holiday not found');
    if (date !== cur.holiday_date && (await db.query('SELECT 1 FROM holidays WHERE holiday_date = $1', [date])).rowCount)
      throw badRequest('There is already a holiday on that date');
    await db.query('UPDATE holidays SET holiday_date = $1, name = $2 WHERE id = $3', [date, name, id]);
    const moved = date !== cur.holiday_date;
    if (moved) await generateTurns(db); // the old date works again
    return { removed_turns: await removeUntouched(db, { dates: [date] }), delegations_due: await delegationsDue(db, [date]) };
  });
  res.json({ message: 'Holiday updated', ...out });
});

router.delete('/:id', requirePermission('holidays', 'delete'), async (req, res) => {
  const id = posInt(req.params.id) || (() => { throw notFound('Holiday not found'); })();
  await withTransaction(async (db) => {
    const { rowCount } = await db.query('DELETE FROM holidays WHERE id = $1', [id]);
    if (!rowCount) throw notFound('Holiday not found');
    await generateTurns(db);
  });
  res.json({ message: 'Holiday deleted' });
});

export default router;
export { weekday };
