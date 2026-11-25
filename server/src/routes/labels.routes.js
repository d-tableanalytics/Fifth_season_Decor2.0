import { Router } from 'express';
import { z } from 'zod';
import { query, withTransaction } from '../config/db.js';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { LABEL_STAGES, STAGE_KEYS, stageRecords, stageData } from '../services/labels.js';
import { badRequest, notFound } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);
const view = requirePermission('label_design', 'view');

const ELEMENT_TYPES = ['text', 'barcode', 'qr', 'image', 'rect', 'ellipse', 'line'];
const num = (min, max) => z.coerce.number().min(min).max(max);

/** Designer element: position/size in mm; content may contain {{field}} bindings. Extra style keys are kept as-is. */
const elementSchema = z
  .object({
    id: z.string().min(1).max(40),
    type: z.enum(ELEMENT_TYPES),
    x: num(-50, 450),
    y: num(-50, 450),
    w: num(0, 450),
    h: num(0, 450),
    content: z.string().max(2000).optional(),
    src: z.string().max(400_000).optional(), // image: URL or small data: URL
  })
  .passthrough();

const templateSchema = z.object({
  name: z.string({ message: 'Name is required' }).trim().min(1, 'Name is required').max(120),
  stage: z.enum(STAGE_KEYS, { message: 'Choose a stage' }),
  width_mm: num(10, 400),
  height_mm: num(10, 400),
  elements: z.array(elementSchema).max(200, 'Too many elements'),
  print_config: z
    .object({
      paper: z.string().max(30).optional(),
      paper_w: num(10, 1000).optional(),
      paper_h: num(10, 1000).optional(),
      per_row: z.coerce.number().int().min(1).max(20).optional(),
      gap_x: num(0, 100).optional(),
      gap_y: num(0, 100).optional(),
      margin: num(0, 100).optional(),
      copies: z.coerce.number().int().min(1).max(100).optional(),
      printer: z.string().max(120).optional(),
    })
    .default({}),
});

const COLS = 'id, name, stage, width_mm::float AS width_mm, height_mm::float AS height_mm, elements, print_config, is_default, updated_at';

router.get('/stages', view, (req, res) => res.json({ data: LABEL_STAGES }));

router.get('/templates', view, async (req, res) => {
  const stage = STAGE_KEYS.includes(req.query.stage) ? req.query.stage : null;
  const { rows } = await query(
    `SELECT t.id, t.name, t.stage, t.width_mm::float AS width_mm, t.height_mm::float AS height_mm, t.is_default, t.updated_at, u.name AS updated_by
       FROM label_templates t LEFT JOIN users u ON u.id = t.updated_by
      WHERE ($1::text IS NULL OR t.stage = $1) ORDER BY t.stage, t.is_default DESC, t.name`,
    [stage]
  );
  res.json({ data: rows });
});

const findTemplate = async (id) => {
  const n = Number(id);
  if (!Number.isInteger(n) || n < 1) throw notFound('Template not found');
  const { rows } = await query(`SELECT ${COLS} FROM label_templates WHERE id = $1`, [n]);
  if (!rows[0]) throw notFound('Template not found');
  return rows[0];
};

router.get('/templates/:id', view, async (req, res) => res.json({ data: await findTemplate(req.params.id) }));

router.post('/templates', requirePermission('label_design', 'create'), async (req, res) => {
  const b = templateSchema.parse(req.body);
  const { rows } = await query(
    `INSERT INTO label_templates (name, stage, width_mm, height_mm, elements, print_config, is_default, created_by, updated_by)
     VALUES ($1, $2::varchar, $3, $4, $5, $6, NOT EXISTS (SELECT 1 FROM label_templates WHERE stage = $2::varchar AND is_default), $7, $7)
     RETURNING ${COLS}`,
    [b.name, b.stage, b.width_mm, b.height_mm, JSON.stringify(b.elements), JSON.stringify(b.print_config), req.user.id]
  );
  res.status(201).json({ data: rows[0] });
});

router.put('/templates/:id', requirePermission('label_design', 'edit'), async (req, res) => {
  const t = await findTemplate(req.params.id);
  const b = templateSchema.parse(req.body);
  if (b.stage !== t.stage && t.is_default) throw badRequest('This is the default template of its stage — make another template default before changing its stage');
  const { rows } = await query(
    `UPDATE label_templates SET name = $1, stage = $2, width_mm = $3, height_mm = $4, elements = $5, print_config = $6,
            updated_by = $7, updated_at = NOW() WHERE id = $8 RETURNING ${COLS}`,
    [b.name, b.stage, b.width_mm, b.height_mm, JSON.stringify(b.elements), JSON.stringify(b.print_config), req.user.id, t.id]
  );
  res.json({ data: rows[0] });
});

/** One default template per stage (used when a stage prints without choosing a template). */
router.post('/templates/:id/default', requirePermission('label_design', 'edit'), async (req, res) => {
  const t = await findTemplate(req.params.id);
  await withTransaction(async (db) => {
    await db.query('UPDATE label_templates SET is_default = FALSE WHERE stage = $1 AND is_default', [t.stage]);
    await db.query('UPDATE label_templates SET is_default = TRUE, updated_by = $1, updated_at = NOW() WHERE id = $2', [req.user.id, t.id]);
  });
  res.json({ message: `"${t.name}" is now the default ${t.stage.replace('_', ' ').toLowerCase()} label` });
});

router.delete('/templates/:id', requirePermission('label_design', 'delete'), async (req, res) => {
  const t = await findTemplate(req.params.id);
  await query('DELETE FROM label_templates WHERE id = $1', [t.id]);
  res.json({ message: 'Template deleted' });
});

/** Records of a stage to preview / print labels for. */
router.get('/records', view, async (req, res) => res.json({ data: await stageRecords(String(req.query.stage), String(req.query.search || '')) }));

/** Field values of the chosen records (live preview + print). */
router.get('/data', view, async (req, res) => {
  const ids = String(req.query.ids || '').split(',').map((x) => x.trim()).filter(Boolean);
  res.json({ data: await stageData(String(req.query.stage), ids, req.user) });
});

export default router;
