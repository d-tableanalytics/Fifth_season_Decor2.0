import { z } from 'zod';
import { STOCK_TYPES } from '../config/sheets.js';

const text = (max) =>
  z
    .string()
    .trim()
    .max(max, `Must be at most ${max} characters`)
    .optional()
    .nullable()
    .transform((v) => (v ? v.replace(/\s+/g, ' ') : null));

const money = (label) =>
  z
    .union([z.number(), z.string().trim()])
    .optional()
    .nullable()
    .transform((v, ctx) => {
      if (v === '' || v === null || v === undefined) return null;
      const n = Number(v);
      if (!Number.isFinite(n) || Math.abs(n) >= 1e10) {
        ctx.addIssue({ code: 'custom', message: `${label} must be a number` });
        return z.NEVER;
      }
      return Math.round(n * 100) / 100;
    });

export const inventoryItemSchema = z.object({
  stock_type: z.enum(STOCK_TYPES, { message: 'Select a stock type' }),
  item_name: z.string().trim().min(1, 'Item name is required').max(160).transform((v) => v.replace(/\s+/g, ' ')),
  rack_no: z.string().trim().max(80).optional().default('').transform((v) => v.replace(/\s+/g, ' ')),
  quantity: money('Quantity').transform((v) => v ?? 0),
  unit: z.string().trim().max(20).optional().default('Mtr').transform((v) => v || 'Mtr'),
  catalogue_name: text(160),
  // http(s) link, or an `s3://inventory/...` reference returned by the upload API
  image_url: text(255).refine(
    (v) => !v || /^https?:\/\//i.test(v) || /^s3:\/\/inventory\/[\w/.-]+$/.test(v),
    'Image URL must start with http:// or https://'
  ),
  hsn_code: text(20),
  lot_no: text(60),
  price: money('Price'),
}).refine((v) => v.stock_type === 'IN_CHECKING' || v.rack_no, { message: 'Rack no. is required', path: ['rack_no'] });

export const inventoryListQuery = z.object({
  stock_type: z.enum(STOCK_TYPES).optional(),
  search: z.string().trim().max(120).optional(),
  catalogue: z.string().trim().max(160).optional(),
  stock: z.enum(['in', 'zero', 'negative']).optional(),
  image: z.enum(['with', 'without']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  sort: z.enum(['item_name', 'quantity', 'price', 'rack_no', 'catalogue_name', 'updated_at']).default('item_name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const syncSchema = z.object({
  stock_types: z.array(z.enum(STOCK_TYPES)).min(1, 'Select at least one sheet tab').transform((a) => [...new Set(a)]),
  mode: z.enum(['full', 'price']).default('full'),
});
