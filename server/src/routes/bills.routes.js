import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { query, withTransaction } from '../config/db.js';
import { GOOGLE_SHEET_ID, MASTER_TABS } from '../config/sheets.js';
import { normHeader } from '../config/masterFields.js';
import { fetchSheetTab } from '../services/googleSheet.js';
import { runLogged, syncLogs } from '../services/masterSync.js';
import { HttpError } from '../utils/httpError.js';

const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** '23-Feb-23' / '23-Feb-2023' / '2023-02-23' -> 'YYYY-MM-DD'; undefined if unreadable, null if blank. */
export function toDate(v) {
  const s = String(v ?? '').trim();
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{2}|\d{4})$/);
  if (m && MONTHS[m[2].toLowerCase()]) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${String(MONTHS[m[2].toLowerCase()]).padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? s : undefined;
}
export const toNum = (v) => {
  const s = String(v ?? '').replace(/[,₹\s]/g, '');
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) && Math.abs(n) < 1e12 ? n : undefined;
};
export const text = (v, max) => String(v ?? '').replace(/\s+/g, ' ').trim().slice(0, max) || null;

const COLUMNS = {
  bill_reference: 'billreference',
  bill_date: 'billdate',
  due_date: 'duedate',
  amount: 'amount',
  party: 'party',
  days_overdue: 'daysoverdue',
};

/** Full replace: the old snapshot is cleared and reloaded in one transaction (all-or-nothing). */
async function syncBills(userId) {
  return runLogged('bills_receivable', ['bills'], userId, async () => {
    const tab = await fetchSheetTab(GOOGLE_SHEET_ID, MASTER_TABS.bills);
    const h = tab.headers.map(normHeader);
    const idx = Object.fromEntries(Object.entries(COLUMNS).map(([k, name]) => [k, h.indexOf(name)]));
    const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => k);
    if (missing.length) throw new HttpError(422, `The "${MASTER_TABS.bills}" tab is missing column(s): ${missing.join(', ')}`);

    let invalidValues = 0;
    const rows = [];
    for (const r of tab.rows) {
      if (!r.some((v) => String(v).trim())) continue;
      const fix = (v) => (v === undefined ? (invalidValues++, null) : v);
      const days = toNum(r[idx.days_overdue]);
      rows.push({
        bill_reference: text(r[idx.bill_reference], 60),
        bill_date: fix(toDate(r[idx.bill_date])),
        due_date: fix(toDate(r[idx.due_date])),
        amount: fix(toNum(r[idx.amount])),
        party: text(r[idx.party], 200),
        days_overdue: days === undefined ? fix(undefined) : days === null ? null : Math.round(days),
      });
    }

    return withTransaction(async (db) => {
      const { rows: before } = await db.query('SELECT COUNT(*)::int AS n FROM bills_receivable');
      await db.query('DELETE FROM bills_receivable');
      for (let i = 0; i < rows.length; i += 2000) {
        const chunk = rows.slice(i, i + 2000);
        const col = (k) => chunk.map((x) => x[k]);
        await db.query(
          `INSERT INTO bills_receivable (bill_reference, bill_date, due_date, amount, party, days_overdue, row_no)
           SELECT * FROM unnest($1::text[], $2::date[], $3::date[], $4::numeric[], $5::text[], $6::int[], $7::int[])`,
          [col('bill_reference'), col('bill_date'), col('due_date'), col('amount'), col('party'), col('days_overdue'), chunk.map((_, j) => i + j + 1)]
        );
      }
      return [{ key: 'bills', tab: MASTER_TABS.bills, sheetRows: rows.length, replaced: before[0].n, imported: rows.length, invalidValues }];
    });
  });
}

const AGE = {
  not_due: 'COALESCE(days_overdue, 0) <= 0',
  '1_30': 'days_overdue BETWEEN 1 AND 30',
  '31_60': 'days_overdue BETWEEN 31 AND 60',
  '61_90': 'days_overdue BETWEEN 61 AND 90',
  '90_plus': 'days_overdue > 90',
};
const SORTS = { days_overdue: 'days_overdue', amount: 'amount', bill_date: 'bill_date', due_date: 'due_date', party: 'party' };

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  age: z.enum(Object.keys(AGE)).optional(),
  type: z.enum(['receivable', 'credit']).optional(),
  sort: z.enum(Object.keys(SORTS)).default('days_overdue'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('bills_receivable', 'view'), async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = [];
  const params = [];
  if (q.search) {
    params.push(`%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(party ILIKE $${params.length} OR bill_reference ILIKE $${params.length})`);
  }
  if (q.age) where.push(AGE[q.age]);
  // Sheet convention (Tally): negative = due from the party (Dr), positive = advance / credit
  if (q.type) where.push(q.type === 'receivable' ? 'amount < 0' : 'amount > 0');
  params.push(q.limit, (q.page - 1) * q.limit);
  const { rows } = await query(
    `SELECT id, bill_reference, bill_date, due_date, amount::float AS amount, party, days_overdue,
            COUNT(*) OVER()::int AS total_count, COALESCE(SUM(amount) OVER(), 0)::float AS total_amount
       FROM bills_receivable ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${SORTS[q.sort]} ${q.order} NULLS LAST, row_no
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({
    data: rows.map(({ total_count, total_amount, ...r }) => r),
    total: rows[0]?.total_count ?? 0,
    totalAmount: rows[0]?.total_amount ?? 0,
    page: q.page,
    limit: q.limit,
  });
});

router.get('/summary', requirePermission('bills_receivable', 'view'), async (req, res) => {
  const [{ rows: [s] }, { rows: last }] = await Promise.all([
    query(`SELECT COUNT(*)::int AS bills,
                  COALESCE(-SUM(amount) FILTER (WHERE amount < 0), 0)::float AS receivable,
                  COALESCE(SUM(amount) FILTER (WHERE amount > 0), 0)::float AS credits,
                  COALESCE(-SUM(amount) FILTER (WHERE amount < 0 AND days_overdue > 0), 0)::float AS overdue,
                  COALESCE(-SUM(amount) FILTER (WHERE amount < 0 AND days_overdue > 90), 0)::float AS overdue_90,
                  COUNT(DISTINCT party)::int AS parties
             FROM bills_receivable`),
    query(`SELECT l.finished_at, u.name AS started_by FROM sheet_sync_logs l LEFT JOIN users u ON u.id = l.started_by
            WHERE l.module = 'bills_receivable' AND l.status = 'SUCCESS' ORDER BY l.finished_at DESC LIMIT 1`),
  ]);
  res.json({ data: { ...s, lastSync: last[0] || null, sheet: { url: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`, tab: MASTER_TABS.bills } } });
});

router.get('/sync/logs', requirePermission('bills_receivable', 'view'), async (req, res) => res.json({ data: await syncLogs('bills_receivable') }));
router.post('/sync', requirePermission('bills_receivable', 'edit'), async (req, res) => res.json({ data: await syncBills(req.user.id) }));

export default router;
