import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../config/db.js';
import {
  employeeCreateSchema,
  employeeUpdateSchema,
  employeeStatusSchema,
  employeeListQuery,
} from '../validators/schemas.js';
import { badRequest, forbidden, notFound } from '../utils/httpError.js';

const SELECT_EMPLOYEE = `
  SELECT u.id, u.employee_code, u.name, u.email, u.phone, u.department, u.designation,
         u.joining_date, u.address, u.is_active, u.last_login_at, u.created_at, u.updated_at,
         json_build_object('id', r.id, 'name', r.name, 'is_super', r.is_super) AS role
    FROM users u JOIN roles r ON r.id = u.role_id`;

const findEmployee = async (id) => {
  const { rows } = await query(`${SELECT_EMPLOYEE} WHERE u.id = $1`, [id]);
  if (!rows[0]) throw notFound('Employee not found');
  return rows[0];
};

const findRole = async (id) => {
  const { rows } = await query('SELECT id, is_super FROM roles WHERE id = $1', [id]);
  if (!rows[0]) throw badRequest('Selected role does not exist');
  return rows[0];
};

const activeSuperAdminCount = async () => {
  const { rows } = await query(
    'SELECT COUNT(*)::int AS n FROM users u JOIN roles r ON r.id = u.role_id WHERE r.is_super AND u.is_active'
  );
  return rows[0].n;
};

/** Only a super-admin may create, change or remove super-admins. */
const assertCanManage = (actor, targetIsSuper) => {
  if (targetIsSuper && !actor.role.isSuper) throw forbidden('Only a Super Administrator can manage Super Administrators');
};

/** Block changes that would leave the system with no active super-admin. */
const assertNotLastSuper = async (employee, stillSuperAndActive) => {
  if (employee.role.is_super && employee.is_active && !stillSuperAndActive && (await activeSuperAdminCount()) <= 1) {
    throw badRequest('At least one active Super Administrator is required');
  }
};

export const listEmployees = async (req, res) => {
  const q = employeeListQuery.parse(req.query);
  const where = [];
  const params = [];
  if (q.search) {
    params.push(`%${q.search}%`);
    where.push(
      `(u.name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.employee_code ILIKE $${params.length} OR u.phone ILIKE $${params.length})`
    );
  }
  if (q.role_id) {
    params.push(q.role_id);
    where.push(`u.role_id = $${params.length}`);
  }
  if (q.status) where.push(q.status === 'active' ? 'u.is_active' : 'NOT u.is_active');

  params.push(q.limit, (q.page - 1) * q.limit);
  const { rows } = await query(
    `SELECT e.*, COUNT(*) OVER()::int AS total_count FROM (${SELECT_EMPLOYEE}
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}) e
      ORDER BY e.created_at DESC, e.id DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  const total = rows[0]?.total_count ?? 0;
  res.json({ data: rows.map(({ total_count, ...r }) => r), total, page: q.page, limit: q.limit });
};

export const getEmployee = async (req, res) => {
  res.json({ data: await findEmployee(req.params.id) });
};

export const roleOptions = async (req, res) => {
  const { rows } = await query('SELECT id, name, is_super FROM roles ORDER BY is_super DESC, name');
  // Non-super users can't assign the super role, so don't offer it
  res.json({ data: req.user.role.isSuper ? rows : rows.filter((r) => !r.is_super) });
};

export const createEmployee = async (req, res) => {
  const body = employeeCreateSchema.parse(req.body);
  const role = await findRole(body.role_id);
  assertCanManage(req.user, role.is_super);

  const hash = await bcrypt.hash(body.password, 10);
  const id = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (name, email, password_hash, role_id, employee_code, phone, department,
                          designation, joining_date, address, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [
        body.name, body.email, hash, body.role_id, body.employee_code, body.phone, body.department,
        body.designation, body.joining_date, body.address, body.is_active,
      ]
    );
    const newId = rows[0].id;
    if (!body.employee_code) {
      await client.query("UPDATE users SET employee_code = 'EMP-' || LPAD(id::text, 4, '0') WHERE id = $1", [newId]);
    }
    return newId;
  });
  res.status(201).json({ data: await findEmployee(id) });
};

export const updateEmployee = async (req, res) => {
  const employee = await findEmployee(req.params.id);
  const body = employeeUpdateSchema.parse(req.body);
  const role = await findRole(body.role_id);
  const isSelf = employee.id === req.user.id;

  assertCanManage(req.user, employee.role.is_super || role.is_super);
  if (isSelf && body.role_id !== employee.role.id) throw badRequest('You cannot change your own role');
  if (isSelf && !body.is_active) throw badRequest('You cannot deactivate your own account');
  await assertNotLastSuper(employee, role.is_super && body.is_active);

  const params = [
    body.name, body.email, body.role_id, body.employee_code || employee.employee_code, body.phone,
    body.department, body.designation, body.joining_date, body.address, body.is_active, employee.id,
  ];
  let pwSql = '';
  if (body.password) {
    params.push(await bcrypt.hash(body.password, 10));
    pwSql = `, password_hash = $${params.length}`;
  }
  await query(
    `UPDATE users SET name=$1, email=$2, role_id=$3, employee_code=$4, phone=$5, department=$6,
            designation=$7, joining_date=$8, address=$9, is_active=$10, updated_at=NOW()${pwSql}
      WHERE id = $11`,
    params
  );
  res.json({ data: await findEmployee(employee.id) });
};

export const setEmployeeStatus = async (req, res) => {
  const employee = await findEmployee(req.params.id);
  const { is_active } = employeeStatusSchema.parse(req.body);
  if (employee.id === req.user.id) throw badRequest('You cannot change your own status');
  assertCanManage(req.user, employee.role.is_super);
  await assertNotLastSuper(employee, is_active);

  await query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2', [is_active, employee.id]);
  res.json({ data: await findEmployee(employee.id) });
};

export const deleteEmployee = async (req, res) => {
  const employee = await findEmployee(req.params.id);
  if (employee.id === req.user.id) throw badRequest('You cannot delete your own account');
  assertCanManage(req.user, employee.role.is_super);
  await assertNotLastSuper(employee, false);

  await query('DELETE FROM users WHERE id = $1', [employee.id]);
  res.json({ message: 'Employee deleted' });
};
