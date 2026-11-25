import { z } from 'zod';

const optionalText = (max) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const employeeBase = {
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email address').max(160),
  phone: z
    .string()
    .trim()
    .regex(/^[+\d][\d\s-]{6,18}$/, 'Enter a valid phone number')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  employee_code: optionalText(30),
  department: optionalText(80),
  designation: optionalText(80),
  joining_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Joining date must be YYYY-MM-DD')
    .optional()
    .nullable()
    .or(z.literal('').transform(() => null)),
  address: optionalText(500),
  role_id: z.coerce.number({ message: 'Select a role' }).int().positive('Select a role'),
  is_active: z.boolean().optional().default(true),
};

const password = z.string().min(8, 'Password must be at least 8 characters').max(72);

export const employeeCreateSchema = z.object({ ...employeeBase, password });

export const employeeUpdateSchema = z.object({
  ...employeeBase,
  password: password.optional().or(z.literal('').transform(() => undefined)),
});

export const employeeStatusSchema = z.object({ is_active: z.boolean() });

export const employeeListQuery = z.object({
  search: z.string().trim().max(100).optional(),
  role_id: z.coerce.number().int().positive().optional(),
  status: z.enum(['active', 'inactive']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(10),
});

export const roleSchema = z.object({
  name: z.string().trim().min(2, 'Role name must be at least 2 characters').max(80),
  description: optionalText(300),
  permissions: z.record(z.string(), z.array(z.string())).default({}),
});
