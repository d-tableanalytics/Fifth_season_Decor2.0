import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { query, withTransaction } from '../config/db.js';
import { GOOGLE_SHEET_ID, MASTER_TABS } from '../config/sheets.js';
import { normHeader } from '../config/masterFields.js';
import { fetchSheetTab } from '../services/googleSheet.js';
import { runLogged, syncLogs } from '../services/masterSync.js';
import { HttpError } from '../utils/httpError.js';
import { toDate, toNum, text } from './bills.routes.js';

/** Sheet "Combined Data" (Tally receipts) -> bills_paid. Header names are matched loosely (case / spaces / symbols ignored). */
const COLUMNS = {
  receipt_date: 'receiptdate',
  party: 'partyname',
  bill_reference: 'billrefno',
  bill_date: 'billdate',
  credit_days: 'creditdays',
  due_date: 'duedate',
  days_late: 'daysearlylate',
  receipt_total: 'receipttotal',
};
const DATES = new Set(['receipt_date', 'bill_date', 'due_date']);
const INTS = new Set(['credit_days', 'days_late']);

/** Full replace: the old list is cleared and reloaded in one transaction (all-or-nothing). */
async function syncPaidBills(userId) {
  return runLogged('paid_bills', ['paidBills'], userId, async () => {
    const tab = await fetchSheetTab(GOOGLE_SHEET_ID, MASTER_TABS.paidBills);
    const h = tab.headers.map(normHeader);
    // "Days Early(-)/Late(+)" normalises with extra characters — match by prefix
    const idx = Object.fromEntries(Object.entries(COLUMNS).map(([k, name]) => [k, h.findIndex((x) => x === name || x.startsWith(name))]));
    const missing = Object.entries(idx).filter(([, i]) => i < 0).map(([k]) => k);
    if (missing.length) throw new HttpError(422, `The "${MASTER_TABS.paidBills}" tab is missing column(s): ${missing.join(', ')}`);

    let invalidValues = 0;
    const rows = [];
    for (const r of tab.rows) {
      if (!r.some((v) => String(v).trim())) continue;
      const fix = (v) => (v === undefined ? (invalidValues++, null) : v);
      const row = {};
      for (const k of Object.keys(COLUMNS)) {
        const v = r[idx[k]];
        if (DATES.has(k)) row[k] = fix(toDate(v));
        else if (INTS.has(k)) {
          const n = fix(toNum(v));
          row[k] = n == null ? null : Math.round(n);
        } else if (k === 'receipt_total') row[k] = fix(toNum(v));
        else row[k] = text(v, k === 'party' ? 200 : 60);
      }
      rows.push(row);
    }

    return withTransaction(async (db) => {
      const { rows: before } = await db.query('SELECT COUNT(*)::int AS n FROM bills_paid');
      await db.query('DELETE FROM bills_paid');
      for (let i = 0; i < rows.length; i += 2000) {
        const chunk = rows.slice(i, i + 2000);
        const col = (k) => chunk.map((x) => x[k]);
        await db.query(
          `INSERT INTO bills_paid (receipt_date, party, bill_reference, bill_date, credit_days, due_date, days_late, receipt_total, row_no)
           SELECT * FROM unnest($1::date[], $2::text[], $3::text[], $4::date[], $5::int[], $6::date[], $7::int[], $8::numeric[], $9::int[])`,
          [col('receipt_date'), col('party'), col('bill_reference'), col('bill_date'), col('credit_days'), col('due_date'), col('days_late'),
            col('receipt_total'), chunk.map((_, j) => i + j + 1)]
        );
      }
      return [{ key: 'paidBills', tab: MASTER_TABS.paidBills, sheetRows: rows.length, replaced: before[0].n, imported: rows.length, invalidValues }];
    });
  });
}

const STATUS = {
  on_time: 'COALESCE(days_late, 0) <= 0',
  late: 'days_late > 0',
  late_30: 'days_late > 30',
};
const SORTS = { receipt_date: 'receipt_date', bill_date: 'bill_date', due_date: 'due_date', days_late: 'days_late', receipt_total: 'receipt_total', party: 'party' };

const listQuery = z.object({
  search: z.string().trim().max(100).optional(),
  status: z.enum(Object.keys(STATUS)).optional(),
  sort: z.enum(Object.keys(SORTS)).default('receipt_date'),
  order: z.enum(['asc', 'desc']).default('desc'),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

const router = Router();
router.use(requireAuth);

router.get('/', requirePermission('paid_bills', 'view'), async (req, res) => {
  const q = listQuery.parse(req.query);
  const where = [];
  const params = [];
  if (q.search) {
    params.push(`%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(party ILIKE $${params.length} OR bill_reference ILIKE $${params.length})`);
  }
  if (q.status) where.push(STATUS[q.status]);
  params.push(q.limit, (q.page - 1) * q.limit);
  const { rows } = await query(
    `SELECT id, receipt_date, party, bill_reference, bill_date, credit_days, due_date, days_late, receipt_total::float AS receipt_total,
            COUNT(*) OVER()::int AS total_count
       FROM bills_paid ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY ${SORTS[q.sort]} ${q.order} NULLS LAST, row_no
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ data: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0, page: q.page, limit: q.limit });
});

router.get('/summary', requirePermission('paid_bills', 'view'), async (req, res) => {
  const [{ rows: [s] }, { rows: last }] = await Promise.all([
    query(`SELECT COUNT(*)::int AS bills, COUNT(DISTINCT lower(btrim(party)))::int AS parties,
                  COUNT(*) FILTER (WHERE COALESCE(days_late, 0) <= 0)::int AS on_time,
                  COUNT(*) FILTER (WHERE days_late > 30)::int AS late_30,
                  ROUND(AVG(days_late) FILTER (WHERE days_late > 0))::int AS avg_late_days,
                  MIN(receipt_date) AS first_receipt, MAX(receipt_date) AS last_receipt
             FROM bills_paid`),
    query(`SELECT l.finished_at, u.name AS started_by FROM sheet_sync_logs l LEFT JOIN users u ON u.id = l.started_by
            WHERE l.module = 'paid_bills' AND l.status = 'SUCCESS' ORDER BY l.finished_at DESC LIMIT 1`),
  ]);
  res.json({ data: { ...s, lastSync: last[0] || null, sheet: { url: `https://docs.google.com/spreadsheets/d/${GOOGLE_SHEET_ID}/edit`, tab: MASTER_TABS.paidBills } } });
});

router.get('/sync/logs', requirePermission('paid_bills', 'view'), async (req, res) => res.json({ data: await syncLogs('paid_bills') }));
router.post('/sync', requirePermission('paid_bills', 'edit'), async (req, res) => res.json({ data: await syncPaidBills(req.user.id) }));

export default router;
