// Phase 2 step E first cut. Slimmer than order.schema.ts on purpose:
// - No addons (cart UI doesn't have them yet)
// - No emergency contact, slip (handover UI ports later)
// - No multi-payment audit trail
//
// delivery_date / delivery_slot land on the schema column (was previously
// stuffed into orders.notes — fixed in Bug #7).
//
// Will replace the broader orderPostSchema as the canonical input once
// handover UI catches up. Keeping both in tree avoids a flag day.

import { z } from 'zod';

const cellSchema = z.object({
  id: z.string().optional(),
  moduleId: z.string(),
  x: z.number(),
  y: z.number(),
  rot: z.union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)]),
  recliners: z.array(z.object({ seatIdx: z.number().int(), open: z.boolean() })).optional(),
});

const sofaLineConfigSchema = z.object({
  kind: z.literal('sofa'),
  productId: z.string().uuid(),
  bundleId: z.string().optional(),
  cells: z.array(cellSchema).optional(),
  depth: z.enum(['24', '28']).optional(),
});

const sizeLineConfigSchema = z.object({
  kind: z.literal('size'),
  productId: z.string().uuid(),
  sizeId: z.string(),
});

// Flat-priced products (mattresses with single price, sofas without modular
// configuration, bedframes). Server looks up products.flat_price for the
// canonical amount; client only needs to identify the product. (Bug #2 fix)
const flatLineConfigSchema = z.object({
  kind: z.literal('flat'),
  productId: z.string().uuid(),
});

export const orderLineConfigSchema = z.discriminatedUnion('kind', [
  sofaLineConfigSchema,
  sizeLineConfigSchema,
  flatLineConfigSchema,
]);

export const orderLineSchema = z.object({
  qty: z.number().int().positive(),
  config: orderLineConfigSchema,
});

export const orderV1PostSchema = z.object({
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    postcode: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  }),
  paymentMethod: z.enum(['credit', 'debit', 'installment', 'transfer']),
  approvalCode: z.string().optional(),
  notes: z.string().optional(),
  // ISO YYYY-MM-DD; omit when customer wants delivery TBD.
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date_format').optional(),
  // Free-form slot label, e.g. '12:00 – 15:00'. Only meaningful when deliveryDate present.
  deliverySlot: z.string().max(64).optional(),
  lines: z.array(orderLineSchema).min(1),

  // Client-submitted total — server recomputes and rejects with 409 if drift
  // exceeds 0.5%. Never trusted as the actual saved amount.
  clientTotal: z.number().int().nonnegative(),

  // Slip MVP (Phase 4): present iff paymentMethod=transfer. Server-side RPC
  // validates session ownership + status='uploaded' and promotes atomically.
  uploadSessionId: z.string().uuid().optional(),
});

export type OrderV1PostBody = z.infer<typeof orderV1PostSchema>;
export type OrderLineDto = z.infer<typeof orderLineSchema>;
