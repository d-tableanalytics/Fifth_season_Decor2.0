import { z } from 'zod';
import { CLIENT_FIELDS, TRANSPORT_FIELDS, OPTIONS } from '../config/masterFields.js';

const blankToNull = (v) => (v === '' || v === undefined ? null : v);

const numberish = (label, int) =>
  z
    .union([z.number(), z.string().trim(), z.null()])
    .optional()
    .transform((v, ctx) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || Math.abs(n) >= 1e12) {
        ctx.addIssue({ code: 'custom', message: `${label} must be a number` });
        return z.NEVER;
      }
      return int ? Math.round(n) : n;
    });

const imageRef = (folder, max) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform(blankToNull)
    .refine((v) => !v || /^https?:\/\//i.test(v) || new RegExp(`^s3://${folder}/[\\w/.-]+$`).test(v), 'Must be an image link (http/https) or an uploaded image');

const label = (key) => key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

/** Build a zod object from a field list. `skip` keys are ignored (e.g. read-only codes). */
function schemaFor(fields, folder, skip = []) {
  const shape = {};
  for (const fd of fields) {
    if (skip.includes(fd.key)) continue;
    let s;
    switch (fd.type) {
      case 'text':
        if (fd.image) {
          s = imageRef(folder, fd.max);
          break;
        }
        s = z.string().trim().max(fd.max || 5000, `${label(fd.key)} must be at most ${fd.max} characters`).optional().nullable()
          .transform((v) => (v ? (fd.upper ? v.toUpperCase() : v).replace(/[ \t]+/g, ' ') : fd.default ?? null));
        if (fd.required) s = z.string().trim().min(1, `${label(fd.key)} is required`).max(fd.max);
        break;
      case 'int':
      case 'num':
        s = numberish(label(fd.key), fd.type === 'int');
        if (fd.min !== undefined) s = s.refine((v) => v === null || (v >= fd.min && v <= fd.max), `${label(fd.key)} is out of range`);
        break;
      case 'enum':
        s = z.union([z.enum(fd.options), z.literal(''), z.null()]).optional().transform((v) => (v ? v : fd.default ?? null));
        break;
      case 'multi':
        s = z.array(z.enum(fd.options)).optional().default([]);
        break;
      case 'bool':
        s = z.boolean().optional().default(fd.default ?? false);
        break;
      case 'date':
        s = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD'), z.literal(''), z.null()]).optional().transform(blankToNull);
        break;
      case 'json':
        s = z.array(destinationSchema).max(300).optional().default([]);
        break;
      default:
        s = z.any();
    }
    shape[fd.key] = s;
  }
  return shape;
}

const shortText = (max) => z.string().trim().max(max).optional().nullable().transform(blankToNull);

const destinationSchema = z.object({
  city: shortText(80),
  state: shortText(80),
  country: shortText(80),
  pin: shortText(10),
  contact_person: shortText(120),
  contact_number: shortText(20),
  gst: shortText(15),
  full_address: shortText(500),
});

export const transportSchema = z.object({
  ...schemaFor(TRANSPORT_FIELDS, 'transports', ['transport_id']),
});

const prioritySchema = z.object({
  type_of_order: z.union([z.enum(OPTIONS.type_of_order), z.literal(''), z.null()]).optional().transform(blankToNull),
  priority: z.union([z.enum(OPTIONS.priority), z.literal(''), z.null()]).optional().transform(blankToNull),
  transporter_type: z.union([z.enum(OPTIONS.transporter_type), z.literal(''), z.null()]).optional().transform(blankToNull),
  transport_ref: z.union([z.string().uuid(), z.literal(''), z.null()]).optional().transform(blankToNull),
});

const referralSchema = z.object({
  name: shortText(160),
  phone_number: shortText(20),
  city: shortText(80),
  comment: shortText(2000),
  photo_reference: imageRef('clients', 255),
});

const productSchema = z.object({
  product_ref_id: shortText(60),
  product_name: shortText(200),
  volume_of_purchase: numberish('Volume of purchase', false),
  price_per_unit: numberish('Price per unit', false),
  photo_reference: imageRef('clients', 255),
});

export const clientSchema = z.object({
  ...schemaFor(CLIENT_FIELDS, 'clients', ['client_id']),
  client_id: z.string().trim().toUpperCase().max(20).regex(/^[A-Z0-9_-]*$/, 'Client ID can only contain letters, numbers, - and _').optional().nullable().transform(blankToNull),
  transport_priorities: z.array(prioritySchema).max(100).optional().default([]),
  referrals: z.array(referralSchema).max(100).optional().default([]),
  top_selling_products: z.array(productSchema).max(100).optional().default([]),
});

export const listQuery = z.object({
  search: z.string().trim().max(120).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  order: z.enum(['asc', 'desc']).default('asc'),
});
