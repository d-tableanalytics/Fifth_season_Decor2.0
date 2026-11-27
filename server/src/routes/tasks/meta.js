import { Router } from 'express';
import { query } from '../../config/db.js';
import { badRequest, cleanText, perms, PRIORITIES } from '../../services/tasks/common.js';
import { FREQUENCIES } from '../../services/tasks/recurrence.js';
import { addDays, todayIST } from '../../utils/ist.js';

const router = Router();

router.get('/meta', async (req, res) => {
  const [users, cats, hol, dep] = await Promise.all([
    query('SELECT id, name FROM users WHERE is_active ORDER BY LOWER(name)'),
    query('SELECT id, name FROM task_categories ORDER BY LOWER(name)'),
    query('SELECT holiday_date AS date, name FROM holidays WHERE holiday_date >= $1 ORDER BY holiday_date LIMIT 800', [addDays(todayIST(), -30)]),
    query("SELECT DISTINCT TRIM(department) AS d FROM users WHERE is_active AND TRIM(COALESCE(department, '')) <> '' ORDER BY 1"),
  ]);
  res.json({
    users: users.rows,
    categories: cats.rows,
    priorities: PRIORITIES,
    frequencies: FREQUENCIES,
    units: ['weeks', 'months'],
    me: { id: req.user.id, name: req.user.name },
    can_all: perms(req.user).allView,
    holidays: hol.rows,
    departments: perms(req.user).allView || perms(req.user).pcView ? dep.rows.map((r) => r.d) : [],
  });
});

// Find or create (case-insensitive)
router.post('/categories', async (req, res) => {
  const name = cleanText(req.body?.name, 80);
  if (!name) throw badRequest('Enter the category name');
  const found = await query('SELECT id, name FROM task_categories WHERE LOWER(name) = LOWER($1)', [name]);
  if (found.rows[0]) return res.json(found.rows[0]);
  const { rows } = await query(
    'INSERT INTO task_categories (name) VALUES ($1) ON CONFLICT DO NOTHING RETURNING id, name', [name]);
  if (rows[0]) return res.status(201).json(rows[0]);
  res.json((await query('SELECT id, name FROM task_categories WHERE LOWER(name) = LOWER($1)', [name])).rows[0]);
});

export default router;
