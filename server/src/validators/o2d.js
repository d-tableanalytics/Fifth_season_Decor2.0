import { z } from 'zod';
import { ORDER_MODES, UNITS } from '../config/o2d.js';

const text = (max, label) =>
  z.string().trim().max(max, `${label} must be at most ${max} characters`).optional().nullable().transform((v) => v || null);

const itemSchema = z.object({
  sku_code: z.string().trim().min(1, 'SKU code is required').max(160),
  catalogue_name: text(160, 'Catalogue name'),
  qty: z.coerce.number({ message: 'Qty must be a number' }).min(0.01, 'Qty must be at least 0.01').max(9999999999),
  unit: z.enum(UNITS, { message: 'Select a unit' }),
  remark: text(1000, 'Remark'),
});

export const orderSchema = z
  .object({
    order_mode: z.enum(ORDER_MODES, { message: 'Select an order mode' }),
    doer_id: z.coerce.number().int().positive().optional().nullable().or(z.literal('').transform(() => null)),
    contact_person_phone: z
      .string()
      .trim()
      .regex(/^\d{10}$/, 'Contact person phone must be 10 digits')
      .optional()
      .nullable()
      .or(z.literal('').transform(() => null)),
    client_ref: z.string().uuid({ message: 'Select a client' }),
    client_reference_order: text(100, 'Client reference order'),
    third_party_name: text(200, 'Third party name'),
    third_party_address: text(2000, 'Third party address'),
    priority: z.enum(['A', 'B', 'C', 'D', 'E']).optional().nullable().or(z.literal('').transform(() => null)),
    transport_source: z.enum(['CLIENT', 'OTHER']).optional().nullable().or(z.literal('').transform(() => null)),
    transport_ref: z.string().uuid().optional().nullable().or(z.literal('').transform(() => null)),
    transport_name: text(160, 'Transport name'),
    mode_of_dispatch: text(60, 'Mode of dispatch'),
    transport_contact: text(20, 'Contact number'),
    transport_address: text(2000, 'Transport address'),
    transport_city: text(80, 'Transport city'),
    team_remark: text(2000, 'Team remark'),
    customer_remark: text(2000, 'Customer remark'),
    items: z.array(itemSchema).min(1, 'Add at least one catalogue item').max(200),
    override_reason: text(1000, 'Reason'),
  })
  .superRefine((v, ctx) => {
    if (v.order_mode === 'THIRD_PARTY') {
      if (!v.third_party_name) ctx.addIssue({ code: 'custom', path: ['third_party_name'], message: 'Third party name is required' });
      if (!v.third_party_address) ctx.addIssue({ code: 'custom', path: ['third_party_address'], message: 'Third party address is required' });
    }
  })
  // Third-party fields only belong to THIRD_PARTY orders
  .transform((v) => (v.order_mode === 'THIRD_PARTY' ? v : { ...v, third_party_name: null, third_party_address: null }));

export const orderListQuery = z.object({
  tab: z.enum(['active', 'hold', 'cancelled']).default('active'),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(25),
});

export const reasonSchema = z.object({ reason: z.string().trim().min(1, 'Reason is required').max(1000) });
