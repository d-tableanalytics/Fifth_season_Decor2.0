import { readFile } from 'node:fs/promises';
import bcrypt from 'bcryptjs';
import { pool, withTransaction } from '../config/db.js';
import { sanitizePermissions } from '../config/modules.js';
import { replaceRolePermissions } from '../services/access.js';

const SUPER_ROLE = 'Super Administrator';

// Starter roles — created only if they don't exist yet; edit freely from the UI afterwards.
const DEFAULT_ROLES = [
  {
    name: 'Manager',
    description: 'Runs day-to-day operations. Can manage staff but not roles.',
    permissions: {
      dashboard: ['view'],
      inventory: ['view', 'create', 'edit', 'delete'],
      o2d_cut: ['view', 'create', 'edit', 'delete', 'approve'],
      o2d_roll: ['view', 'create', 'edit', 'delete', 'approve'],
      planning_dispatch: ['view', 'create', 'edit', 'delete'],
      client_master: ['view', 'create', 'edit', 'delete'],
      transport_master: ['view', 'create', 'edit', 'delete'],
      crm_leads: ['view', 'create', 'edit', 'delete'],
      crm_followups: ['view', 'create', 'edit', 'delete'],
      dispatch_pending: ['view', 'create', 'edit', 'delete'],
      dispatch_completed: ['view', 'edit'],
      tasks_mine: ['view', 'create', 'edit'],
      tasks_all: ['view', 'create', 'edit', 'delete'],
      employees: ['view', 'create', 'edit'],
      roles: ['view'],
    },
  },
  {
    name: 'Staff',
    description: 'Front-line staff. Creates orders and leads, manages own tasks.',
    permissions: {
      dashboard: ['view'],
      inventory: ['view'],
      o2d_cut: ['view', 'create'],
      o2d_roll: ['view', 'create'],
      client_master: ['view'],
      crm_leads: ['view', 'create', 'edit'],
      crm_followups: ['view', 'create', 'edit'],
      tasks_mine: ['view', 'create', 'edit'],
    },
  },
];

const ensureRole = async (client, { name, description, isSuper = false, isSystem = false, permissions }) => {
  const existing = await client.query('SELECT id FROM roles WHERE LOWER(name) = LOWER($1)', [name]);
  if (existing.rows[0]) return { id: existing.rows[0].id, created: false };
  const { rows } = await client.query(
    'INSERT INTO roles (name, description, is_super, is_system) VALUES ($1, $2, $3, $4) RETURNING id',
    [name, description, isSuper, isSystem]
  );
  if (permissions) await replaceRolePermissions(client, rows[0].id, sanitizePermissions(permissions));
  return { id: rows[0].id, created: true };
};

const run = async () => {
  const schema = await readFile(new URL('./schema.sql', import.meta.url), 'utf8');
  await pool.query(schema);
  console.log('✔ Schema applied');

  await withTransaction(async (client) => {
    const superRole = await ensureRole(client, {
      name: SUPER_ROLE,
      description: 'Full access to every module. Cannot be edited or deleted.',
      isSuper: true,
      isSystem: true,
    });
    const roleIds = { [SUPER_ROLE]: superRole.id };
    for (const r of DEFAULT_ROLES) {
      const res = await ensureRole(client, r);
      roleIds[r.name] = res.id;
      if (res.created) console.log(`✔ Role created: ${r.name}`);
    }

    // O2D menu split into Cut / Roll: carry old "o2d_orders" access over to both, then drop retired keys
    for (const key of ['o2d_cut', 'o2d_roll']) {
      await client.query(
        `INSERT INTO role_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete)
         SELECT role_id, $1, can_view, can_create, can_edit, can_delete FROM role_permissions WHERE module_key = 'o2d_orders'
         ON CONFLICT (role_id, module_key) DO NOTHING`,
        [key]
      );
    }
    await client.query("DELETE FROM role_permissions WHERE module_key IN ('o2d_orders', 'o2d_tracking')");

    // Upgrade path from the first version (users.role text column -> role_id)
    const legacy = await client.query(
      "SELECT 1 FROM information_schema.columns WHERE table_name = 'users' AND column_name = 'role'"
    );
    if (legacy.rowCount) {
      await client.query(
        `UPDATE users SET role_id = CASE role WHEN 'admin' THEN $1::int WHEN 'manager' THEN $2::int ELSE $3::int END
         WHERE role_id IS NULL`,
        [roleIds[SUPER_ROLE], roleIds.Manager, roleIds.Staff]
      );
      await client.query('ALTER TABLE users DROP COLUMN role');
      console.log('✔ Migrated legacy users.role to role_id');
    }

    // First admin
    const { SEED_ADMIN_NAME, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } = process.env;
    if (SEED_ADMIN_EMAIL && SEED_ADMIN_PASSWORD) {
      const hash = await bcrypt.hash(SEED_ADMIN_PASSWORD, 10);
      const { rowCount } = await client.query(
        `INSERT INTO users (name, email, password_hash, role_id, designation)
         VALUES ($1, LOWER($2), $3, $4, 'Administrator')
         ON CONFLICT (email) DO NOTHING`,
        [SEED_ADMIN_NAME || 'Admin', SEED_ADMIN_EMAIL, hash, roleIds[SUPER_ROLE]]
      );
      console.log(rowCount ? `✔ Admin created: ${SEED_ADMIN_EMAIL}` : `• Admin already exists: ${SEED_ADMIN_EMAIL}`);
    }

    // Anyone still without a role gets Staff; then make role mandatory
    await client.query('UPDATE users SET role_id = $1 WHERE role_id IS NULL', [roleIds.Staff]);
    await client.query('ALTER TABLE users ALTER COLUMN role_id SET NOT NULL');

    // Backfill employee codes
    await client.query(
      "UPDATE users SET employee_code = 'EMP-' || LPAD(id::text, 4, '0') WHERE employee_code IS NULL"
    );
  });
  console.log('✔ Roles & employees ready');
};

run()
  .catch((err) => {
    console.error('✖ Migration failed:', err.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
