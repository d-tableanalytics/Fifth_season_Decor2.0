import { query } from '../config/db.js';
import { ACTIONS, fullPermissions } from '../config/modules.js';

const COL = { view: 'can_view', create: 'can_create', edit: 'can_edit', delete: 'can_delete', approve: 'can_approve' };

/** DB rows -> { moduleKey: ['view', 'edit', ...] } */
export const rowsToPermissions = (rows) => {
  const out = {};
  for (const r of rows) {
    const actions = ACTIONS.filter((a) => r[COL[a]]);
    if (actions.length) out[r.module_key] = actions;
  }
  return out;
};

export async function getRolePermissions(roleId, db = { query }) {
  const { rows } = await db.query('SELECT * FROM role_permissions WHERE role_id = $1', [roleId]);
  return rowsToPermissions(rows);
}

/** Replace all permissions of a role (call inside a transaction). */
export async function replaceRolePermissions(client, roleId, permissions) {
  await client.query('DELETE FROM role_permissions WHERE role_id = $1', [roleId]);
  for (const [moduleKey, actions] of Object.entries(permissions)) {
    await client.query(
      `INSERT INTO role_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_approve)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [roleId, moduleKey, ...ACTIONS.map((a) => actions.includes(a))]
    );
  }
}

/**
 * The signed-in user's identity + effective permissions.
 * Loaded on every request, so role/permission/status changes apply immediately.
 */
export async function loadAccess(userId) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.is_active, u.employee_code, u.designation,
            r.id AS role_id, r.name AS role_name, r.is_super
       FROM users u JOIN roles r ON r.id = u.role_id
      WHERE u.id = $1`,
    [userId]
  );
  const u = rows[0];
  if (!u) return null;

  return {
    id: u.id,
    name: u.name,
    email: u.email,
    isActive: u.is_active,
    employeeCode: u.employee_code,
    designation: u.designation,
    role: { id: u.role_id, name: u.role_name, isSuper: u.is_super },
    permissions: u.is_super ? fullPermissions() : await getRolePermissions(u.role_id),
  };
}

export const can = (user, moduleKey, action = 'view') =>
  !!user && (user.role.isSuper || !!user.permissions[moduleKey]?.includes(action));
