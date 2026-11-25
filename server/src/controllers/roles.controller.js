import { query, withTransaction } from '../config/db.js';
import { sanitizePermissions, fullPermissions } from '../config/modules.js';
import { getRolePermissions, replaceRolePermissions } from '../services/access.js';
import { roleSchema } from '../validators/schemas.js';
import { badRequest, conflict, notFound } from '../utils/httpError.js';

const findRole = async (id) => {
  const { rows } = await query('SELECT * FROM roles WHERE id = $1', [id]);
  if (!rows[0]) throw notFound('Role not found');
  return rows[0];
};

export const listRoles = async (req, res) => {
  const { rows } = await query(
    `SELECT r.id, r.name, r.description, r.is_super, r.is_system, r.updated_at,
            COUNT(u.id)::int AS user_count,
            (SELECT COUNT(*)::int FROM role_permissions p WHERE p.role_id = r.id) AS module_count
       FROM roles r LEFT JOIN users u ON u.role_id = r.id
      GROUP BY r.id
      ORDER BY r.is_super DESC, r.name`
  );
  res.json({ data: rows });
};

export const getRole = async (req, res) => {
  const role = await findRole(req.params.id);
  const permissions = role.is_super ? fullPermissions() : await getRolePermissions(role.id);
  res.json({ data: { ...role, permissions } });
};

export const createRole = async (req, res) => {
  const body = roleSchema.parse(req.body);
  const permissions = sanitizePermissions(body.permissions);

  const role = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING *',
      [body.name, body.description]
    );
    await replaceRolePermissions(client, rows[0].id, permissions);
    return rows[0];
  });
  res.status(201).json({ data: { ...role, permissions } });
};

export const updateRole = async (req, res) => {
  const role = await findRole(req.params.id);
  if (role.is_super) throw badRequest('The Super Administrator role cannot be modified');

  const body = roleSchema.parse(req.body);
  const permissions = sanitizePermissions(body.permissions);

  const updated = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'UPDATE roles SET name = $1, description = $2, updated_at = NOW() WHERE id = $3 RETURNING *',
      [body.name, body.description, role.id]
    );
    await replaceRolePermissions(client, role.id, permissions);
    return rows[0];
  });
  res.json({ data: { ...updated, permissions } });
};

export const deleteRole = async (req, res) => {
  const role = await findRole(req.params.id);
  if (role.is_system) throw badRequest('System roles cannot be deleted');

  const { rows } = await query('SELECT COUNT(*)::int AS n FROM users WHERE role_id = $1', [role.id]);
  if (rows[0].n > 0) {
    throw conflict(`${rows[0].n} employee(s) have this role. Assign them another role before deleting it.`);
  }
  await query('DELETE FROM roles WHERE id = $1', [role.id]);
  res.json({ message: 'Role deleted' });
};
