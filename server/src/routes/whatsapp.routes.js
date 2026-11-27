import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requirePermission } from '../middleware/auth.js';
import { query, withTransaction } from '../config/db.js';
import { RECIPIENTS, RECIPIENT_KEYS, SETTING_KEYS, EVENTS, EVENT_KEYS } from '../config/whatsapp.js';
import { connectionStatus, fetchGroupsPage, GROUP_PAGE_SIZE, resolveRecipients, sendAndLog, getSetting, normalizePlaceholders } from '../services/whatsapp.js';
import { runLogged, syncLogs } from '../services/masterSync.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';

const router = Router();
router.use(requireAuth);
const view = requirePermission('whatsapp', 'view');
const manage = requirePermission('whatsapp', 'edit');

// Leading word of a group name, e.g. "FSD1166 HEERAMANI FURNISHING…" -> FSD1166
const SUGGEST_SQL = `upper(split_part(btrim(g.name), ' ', 1))`;

router.get('/status', view, async (req, res) => res.json({ data: await connectionStatus() }));
router.get('/recipients', view, (req, res) => res.json({ data: RECIPIENTS }));

/* ---------------- Groups ---------------- */

const groupQuery = z.object({
  search: z.string().trim().max(100).optional(),
  link: z.enum(['linked', 'unlinked', 'suggested']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

router.get('/groups', view, async (req, res) => {
  const q = groupQuery.parse(req.query);
  const params = [];
  const where = ['g.is_present'];
  if (q.search) {
    params.push(`%${q.search.replace(/[%_\\]/g, (m) => `\\${m}`)}%`);
    where.push(`(g.name ILIKE $1 OR g.group_id ILIKE $1 OR lc.client_id ILIKE $1 OR lc.company_name ILIKE $1)`);
  }
  if (q.link === 'linked') where.push('lc.id IS NOT NULL');
  if (q.link === 'unlinked') where.push('lc.id IS NULL');
  if (q.link === 'suggested') where.push('lc.id IS NULL AND sc.id IS NOT NULL');
  params.push(q.limit, (q.page - 1) * q.limit);
  const sql = `
    SELECT g.group_id, g.name, g.participants, g.admins, g.fetched_at,
           lc.id AS client_ref, lc.client_id, lc.company_name, lc.linked_count,
           CASE WHEN lc.id IS NULL THEN sc.id END AS suggested_ref,
           CASE WHEN lc.id IS NULL THEN sc.client_id END AS suggested_client_id,
           CASE WHEN lc.id IS NULL THEN sc.company_name END AS suggested_company,
           COUNT(*) OVER()::int AS total_count
      FROM whatsapp_groups g
      LEFT JOIN LATERAL (
        SELECT c.id, c.client_id, c.company_name, COUNT(*) OVER()::int AS linked_count
          FROM clients c WHERE c.whatsapp_group_id = g.group_id ORDER BY c.client_id LIMIT 1
      ) lc ON TRUE
      LEFT JOIN LATERAL (
        SELECT c.id, c.client_id, c.company_name FROM clients c
         WHERE c.client_id = ${SUGGEST_SQL} AND c.whatsapp_group_id IS NULL LIMIT 1
      ) sc ON TRUE
     WHERE ${where.join(' AND ')}
     ORDER BY (lc.id IS NULL) DESC, g.name
     LIMIT $${params.length - 1} OFFSET $${params.length}`;
  const [{ rows }, { rows: [s] }] = await Promise.all([
    query(sql, params),
    query(`SELECT COUNT(*) FILTER (WHERE g.is_present)::int AS groups,
                  COUNT(*) FILTER (WHERE g.is_present AND EXISTS (SELECT 1 FROM clients c WHERE c.whatsapp_group_id = g.group_id))::int AS linked,
                  MAX(g.fetched_at) AS last_fetched,
                  (SELECT COUNT(*)::int FROM clients c WHERE c.whatsapp_group_id IS NOT NULL
                     AND NOT EXISTS (SELECT 1 FROM whatsapp_groups x WHERE x.group_id = c.whatsapp_group_id AND x.is_present)) AS clients_unknown_group
             FROM whatsapp_groups g`),
  ]);
  res.json({ data: rows.map(({ total_count, ...r }) => r), total: rows[0]?.total_count ?? 0, page: q.page, limit: q.limit, summary: s });
});

/* Group fetch runs as a background job: 2,000+ groups take minutes and Maytapi is slow/flaky.
   Each page is saved as soon as it arrives, so progress survives a failure. */
let job = { running: false };

const upsertGroups = (groups) =>
  query(
    `INSERT INTO whatsapp_groups (group_id, name, participants, admins, is_present, fetched_at)
     SELECT t.*, TRUE, NOW() FROM unnest($1::text[], $2::text[], $3::int[], $4::int[]) AS t
     ON CONFLICT (group_id) DO UPDATE SET name = EXCLUDED.name, participants = EXCLUDED.participants,
       admins = EXCLUDED.admins, is_present = TRUE, fetched_at = NOW()`,
    [groups.map((g) => g.group_id), groups.map((g) => g.name), groups.map((g) => g.participants), groups.map((g) => g.admins)]
  );

async function runGroupFetch(userId) {
  job = { running: true, page: 0, fetched: 0, startedAt: new Date(), error: null, result: null };
  try {
    const [result] = await runLogged('whatsapp_groups', ['groups'], userId, async () => {
      const startedAt = new Date();
      const { rows: before } = await query('SELECT group_id FROM whatsapp_groups');
      const known = new Set(before.map((r) => r.group_id));
      const seen = new Set();
      for (let page = 1; page <= 100; page++) {
        job.page = page;
        const groups = (await fetchGroupsPage(page)).filter((g) => !seen.has(g.group_id));
        groups.forEach((g) => seen.add(g.group_id));
        if (groups.length) await upsertGroups(groups);
        job.fetched = seen.size;
        if (groups.length < GROUP_PAGE_SIZE) break;
        await new Promise((r) => setTimeout(r, 3000)); // be gentle with Maytapi
      }
      // Only a complete run may mark groups as gone
      const { rowCount: gone } = await query('UPDATE whatsapp_groups SET is_present = FALSE WHERE is_present AND fetched_at < $1', [startedAt]);
      const { rows: [l] } = await query(
        'SELECT COUNT(*)::int AS n FROM whatsapp_groups g WHERE g.is_present AND EXISTS (SELECT 1 FROM clients c WHERE c.whatsapp_group_id = g.group_id)'
      );
      return [{ key: 'groups', fetched: seen.size, new: [...seen].filter((id) => !known.has(id)).length, noLongerPresent: gone, linked: l.n }];
    }).then((r) => r.results);
    job.result = result;
  } catch (err) {
    job.error = err.message;
  } finally {
    job.running = false;
    job.finishedAt = new Date();
  }
}

/** Start fetching all groups in the background (no-op if already running). */
router.post('/groups/sync', manage, (req, res) => {
  if (!job.running) runGroupFetch(req.user.id);
  res.status(202).json({ data: job });
});

router.get('/groups/sync/status', view, (req, res) => res.json({ data: job }));

router.get('/groups/sync/logs', view, async (req, res) => res.json({ data: await syncLogs('whatsapp_groups') }));

const findGroup = async (groupId) => {
  const { rows } = await query('SELECT group_id, name FROM whatsapp_groups WHERE group_id = $1', [groupId]);
  if (!rows[0]) throw notFound('Group not found — fetch groups from Maytapi first');
  return rows[0];
};

/** Link a group to a client (clients.whatsapp_group_id). A group already linked elsewhere needs force=true to move. */
router.put('/groups/:groupId/link', manage, async (req, res) => {
  const body = z.object({ client_ref: z.string().uuid({ message: 'Select a client' }), force: z.boolean().optional() }).parse(req.body);
  const group = await findGroup(req.params.groupId);
  const { rows: client } = await query('SELECT id, client_id, company_name FROM clients WHERE id = $1', [body.client_ref]);
  if (!client[0]) throw badRequest('Selected client no longer exists');
  const { rows: others } = await query('SELECT client_id, company_name FROM clients WHERE whatsapp_group_id = $1 AND id <> $2', [group.group_id, body.client_ref]);
  if (others.length && !body.force) {
    const err = conflict(`This group is already linked to ${others.map((o) => `${o.client_id} ${o.company_name}`).join(', ')}`);
    err.details = { code: 'GROUP_ALREADY_LINKED', linkedTo: others };
    throw err;
  }
  await withTransaction(async (db) => {
    if (others.length) await db.query('UPDATE clients SET whatsapp_group_id = NULL, updated_at = NOW() WHERE whatsapp_group_id = $1 AND id <> $2', [group.group_id, body.client_ref]);
    await db.query('UPDATE clients SET whatsapp_group_id = $1, whatsapp_group_name = $2, updated_by = $3, updated_at = NOW() WHERE id = $4', [
      group.group_id, group.name, req.user.id, body.client_ref,
    ]);
  });
  res.json({ message: `Linked to ${client[0].client_id}` });
});

router.delete('/groups/:groupId/link', manage, async (req, res) => {
  const group = await findGroup(req.params.groupId);
  const { rowCount } = await query('UPDATE clients SET whatsapp_group_id = NULL, updated_by = $1, updated_at = NOW() WHERE whatsapp_group_id = $2', [
    req.user.id, group.group_id,
  ]);
  res.json({ message: rowCount ? 'Group unlinked' : 'Group was not linked' });
});

/** Link every unlinked group whose name starts with a Client ID of a client that has no group yet. */
router.post('/groups/link-suggested', manage, async (req, res) => {
  const { rowCount } = await query(
    `UPDATE clients c SET whatsapp_group_id = g.group_id, whatsapp_group_name = g.name, updated_by = $1, updated_at = NOW()
       FROM whatsapp_groups g
      WHERE g.is_present AND c.whatsapp_group_id IS NULL AND c.client_id = ${SUGGEST_SQL}
        AND NOT EXISTS (SELECT 1 FROM clients x WHERE x.whatsapp_group_id = g.group_id)`,
    [req.user.id]
  );
  res.json({ data: { linked: rowCount } });
});

router.get('/lookups/clients', manage, async (req, res) => {
  const s = String(req.query.search || '').trim().slice(0, 80);
  const { rows } = await query(
    `SELECT id, client_id, company_name, city, whatsapp_group_id FROM clients
      WHERE $1 = '' OR client_id ILIKE '%' || $1 || '%' OR company_name ILIKE '%' || $1 || '%'
      ORDER BY (upper(client_id) = upper($1)) DESC, company_name LIMIT 20`,
    [s]
  );
  res.json({ data: rows });
});

/* ---------------- Settings ---------------- */

router.get('/settings', view, async (req, res) => {
  const [crm, manager, { rows: employees }] = await Promise.all([
    getSetting(SETTING_KEYS.FSD_CRM_PERSON),
    getSetting(SETTING_KEYS.FSD_MANAGER),
    query('SELECT id, name, phone, designation FROM users WHERE is_active ORDER BY name'),
  ]);
  res.json({ data: { crm_person_user_id: crm, manager_user_id: manager, employees } });
});

router.put('/settings', manage, async (req, res) => {
  const body = z
    .object({
      crm_person_user_id: z.coerce.number().int().positive().nullable().optional(),
      manager_user_id: z.coerce.number().int().positive().nullable().optional(),
    })
    .parse(req.body);
  for (const [field, key] of [['crm_person_user_id', SETTING_KEYS.FSD_CRM_PERSON], ['manager_user_id', SETTING_KEYS.FSD_MANAGER]]) {
    const id = body[field] ?? null;
    if (id) {
      const { rows } = await query('SELECT phone FROM users WHERE id = $1 AND is_active', [id]);
      if (!rows[0]) throw badRequest('Selected employee is not active');
      if (!rows[0].phone) throw badRequest('Selected employee has no phone number in Employee Master');
    }
    await query(
      `INSERT INTO app_settings (key, value, updated_by, updated_at) VALUES ($1, $2, $3, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = NOW()`,
      [key, JSON.stringify(id), req.user.id]
    );
  }
  res.json({ message: 'Settings saved' });
});

/* ---------------- Test send ---------------- */

router.post('/test', manage, async (req, res) => {
  const body = z
    .object({
      recipients: z.array(z.enum(RECIPIENT_KEYS)).min(1, 'Select at least one recipient').max(RECIPIENT_KEYS.length),
      client_ref: z.string().uuid().optional().nullable(),
      message: z.string().trim().min(1, 'Message is required').max(2000),
    })
    .parse(req.body);
  const resolved = await resolveRecipients(body.recipients, body.client_ref);
  const results = [];
  for (const r of resolved) {
    if (!r.to) {
      results.push({ ...r, status: 'SKIPPED' });
      continue;
    }
    const log = await sendAndLog({ triggerKey: 'TEST', recipient: r, clientId: body.client_ref, message: body.message, userId: req.user.id });
    results.push({ ...r, status: log.status, error: log.error });
  }
  res.json({ data: results });
});

/* ---------------- Templates ---------------- */

router.get('/events', view, (req, res) => res.json({ data: EVENTS }));

const templateBody = z.object({
  name: z.string().trim().min(1, 'Name is required').max(150),
  event: z.enum(EVENT_KEYS),
  body: z.string().trim().min(1, 'Message body is required').max(4000),
  description: z.string().trim().max(500).optional().nullable(),
  enabled: z.boolean().optional(),
});

const dupEvent = (err) => {
  if (err.code === '23505') throw conflict('This event already has a template — edit it instead');
  throw err;
};

router.get('/templates', view, async (req, res) => {
  const { rows } = await query(
    'SELECT id, name, event, body, description, enabled, created_at, updated_at FROM whatsapp_templates WHERE deleted_at IS NULL ORDER BY created_at DESC'
  );
  res.json({ data: rows });
});

router.post('/templates', manage, async (req, res) => {
  const b = templateBody.parse(req.body);
  const { rows } = await query(
    `INSERT INTO whatsapp_templates (name, event, body, description, enabled, created_by, updated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$6) RETURNING id`,
    [b.name, b.event, normalizePlaceholders(b.body), b.description || null, b.enabled ?? true, req.user.id]
  ).catch(dupEvent);
  res.status(201).json({ data: rows[0], message: 'Template created' });
});

router.put('/templates/:id', manage, async (req, res) => {
  const b = templateBody.partial().parse(req.body);
  const { rowCount } = await query(
    `UPDATE whatsapp_templates SET name = COALESCE($1, name), event = COALESCE($2, event), body = COALESCE($3, body),
            description = COALESCE($4, description), enabled = COALESCE($5, enabled), updated_by = $6, updated_at = NOW()
      WHERE id = $7 AND deleted_at IS NULL`,
    [b.name ?? null, b.event ?? null, b.body == null ? null : normalizePlaceholders(b.body), b.description ?? null, b.enabled ?? null, req.user.id, req.params.id]
  ).catch(dupEvent);
  if (!rowCount) throw notFound('Template not found');
  res.json({ message: 'Template updated' });
});

router.delete('/templates/:id', manage, async (req, res) => {
  const { rowCount } = await query('UPDATE whatsapp_templates SET deleted_at = NOW(), updated_by = $1 WHERE id = $2 AND deleted_at IS NULL', [req.user.id, req.params.id]);
  if (!rowCount) throw notFound('Template not found');
  res.json({ message: 'Template deleted' });
});

/* ---------------- Send history ---------------- */

router.get('/logs', view, async (req, res) => {
  const q = z
    .object({
      status: z.enum(['SENT', 'FAILED']).optional(),
      event: z.string().max(60).optional(),
      search: z.string().trim().max(100).optional(),
      limit: z.coerce.number().int().min(1).max(300).default(100),
    })
    .parse(req.query);
  const params = [];
  const where = [];
  if (q.status) where.push(`m.status = $${params.push(q.status)}`);
  if (q.event) where.push(`m.trigger_key = $${params.push(q.event)}`);
  if (q.search) {
    const p = params.push(`%${q.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`);
    where.push(`(m.to_number ILIKE $${p} OR m.message ILIKE $${p} OR c.company_name ILIKE $${p})`);
  }
  const lim = params.push(q.limit);
  const { rows } = await query(
    `SELECT m.id, m.trigger_key, m.recipient_type, m.to_number, m.message, m.status, m.error, m.created_at,
            c.client_id, c.company_name, u.name AS sent_by_name
       FROM whatsapp_messages m
       LEFT JOIN clients c ON c.id = m.client_ref
       LEFT JOIN users u ON u.id = m.created_by
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY m.created_at DESC LIMIT $${lim}`,
    params
  );
  res.json({ data: rows });
});

export default router;
