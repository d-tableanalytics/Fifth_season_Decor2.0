import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { can } from '../services/access.js';
import { query, withTransaction } from '../config/db.js';
import { ZONES } from '../config/zones.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';

const pin = z.string().trim().regex(/^\d{6}$/, 'PIN code must be 6 digits');
const zone = z.enum(ZONES, { message: 'Select a zone' });
const areaName = z.string().trim().max(160).optional().nullable().transform((v) => v || null);

const router = Router();
router.use(requireAuth);

/** PIN → zone list for the Client / Transport forms (auto-fill). */
const canUseMap = (req, res, next) =>
  ['client_master', 'transport_master'].some((m) => can(req.user, m, 'create') || can(req.user, m, 'edit')) || can(req.user, 'route_planning', 'view')
    ? next()
    : res.status(403).json({ message: 'You do not have permission to perform this action' });

router.get('/options', (req, res) => res.json({ data: ZONES }));

router.get('/map', canUseMap, async (req, res) => {
  const { rows } = await query('SELECT pincode, zone FROM zone_pincode_map');
  res.json({ data: rows });
});

router.get('/', requirePermission('route_planning', 'view'), async (req, res) => {
  const search = String(req.query.search || '').trim().slice(0, 80);
  const zoneFilter = ZONES.includes(req.query.zone) ? req.query.zone : null;
  const { rows } = await query(
    `SELECT id, pincode, area_name, zone, updated_at FROM zone_pincode_map
      WHERE ($1 = '' OR pincode ILIKE '%' || $1 || '%' OR area_name ILIKE '%' || $1 || '%')
        AND ($2::text IS NULL OR zone = $2)
      ORDER BY zone, pincode`,
    [search, zoneFilter]
  );
  res.json({ data: rows });
});

/** Bulk map: many PINs → one zone. Existing PINs are reported as conflicts, never overwritten. */
router.post('/bulk', requirePermission('route_planning', 'edit'), async (req, res) => {
  const body = z.object({ pincodes: z.string().max(20000), zone, area_name: areaName }).parse(req.body);
  const tokens = [...new Set(body.pincodes.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean))];
  if (!tokens.length) throw badRequest('Enter at least one PIN code');
  if (tokens.length > 1000) throw badRequest('Map at most 1000 PIN codes at a time');
  const invalid = tokens.filter((t) => !/^\d{6}$/.test(t));
  const created = [];
  const conflicts = [];
  for (const p of tokens.filter((t) => /^\d{6}$/.test(t))) {
    const { rows } = await query(
      `INSERT INTO zone_pincode_map (pincode, area_name, zone, created_by, updated_by) VALUES ($1, $2, $3, $4, $4)
       ON CONFLICT (pincode) DO NOTHING RETURNING pincode`,
      [p, body.area_name, body.zone, req.user.id]
    );
    if (rows[0]) created.push(p);
    else {
      const { rows: ex } = await query('SELECT zone FROM zone_pincode_map WHERE pincode = $1', [p]);
      conflicts.push({ pincode: p, zone: ex[0]?.zone });
    }
  }
  res.status(created.length ? 201 : 200).json({ data: { created, conflicts, invalid } });
});

router.put('/:id', requirePermission('route_planning', 'edit'), async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw notFound('Mapping not found');
  const body = z.object({ pincode: pin, area_name: areaName, zone }).parse(req.body);
  const { rows: other } = await query('SELECT zone FROM zone_pincode_map WHERE pincode = $1 AND id <> $2', [body.pincode, id]);
  if (other[0]) throw conflict(`PIN ${body.pincode} is already mapped to ${other[0].zone}`);
  const { rows } = await query(
    `UPDATE zone_pincode_map SET pincode = $1, area_name = $2, zone = $3, updated_by = $4, updated_at = NOW()
      WHERE id = $5 RETURNING id, pincode, area_name, zone, updated_at`,
    [body.pincode, body.area_name, body.zone, req.user.id, id]
  );
  if (!rows[0]) throw notFound('Mapping not found');
  res.json({ data: rows[0] });
});

// Deleting does not clear zones already saved on clients/transports
router.delete('/:id', requirePermission('route_planning', 'edit'), async (req, res) => {
  const { rowCount } = await query('DELETE FROM zone_pincode_map WHERE id = $1', [Number(req.params.id) || 0]);
  if (!rowCount) throw notFound('Mapping not found');
  res.json({ message: 'Mapping deleted' });
});

/** "Connect Old Entries": fill BLANK zones from an exact PIN match (clients + transports). */
router.post('/backfill', requirePermission('route_planning', 'edit'), async (req, res) => {
  const fill = (table, pinCol) =>
    withTransaction(async (db) => {
      const { rows } = await db.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE zone IS NULL AND NULLIF(trim(${pinCol}), '') IS NOT NULL`);
      const { rowCount } = await db.query(
        `UPDATE ${table} t SET zone = m.zone, updated_at = NOW()
           FROM zone_pincode_map m
          WHERE t.zone IS NULL AND trim(t.${pinCol}) = m.pincode`
      );
      return { candidates: rows[0].n, updated: rowCount };
    });
  const [clients, transports] = await Promise.all([fill('clients', 'pin'), fill('transports', 'transport_pin')]);
  res.json({ data: { clients, transports } });
});

export default router;
