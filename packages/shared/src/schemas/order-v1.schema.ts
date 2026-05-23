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
  // Paid-extra add-ons attached to this configured line (e.g. extra pillows
  // beyond the included free ones). Server recomputes these against the
  // current addons table — drifted prices reject with 422.
  addonExtras: z
    .array(z.object({ addonId: z.string(), qty: z.number().int().positive() }))
    .optional(),
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

// Handover-redesign (Phase 4.5) optional addon entry. Server reloads addon
// rows from the `addons` table at recompute time, so the client only needs to
// identify each addon by id and supply the variable arguments. Empty/missing
// optional numeric args default to 1 (qty) / 0 (floors, items) on the server.
export const handoverAddonSchema = z.object({
  addonId: z.string(),
  qty: z.number().int().positive().optional(),
  floorsCount: z.number().int().nonnegative().optional(),
  itemsCount: z.number().int().nonnegative().optional(),
});

export const orderV1PostSchema = z.object({
  customer: z.object({
    name: z.string().min(1),
    phone: z.string().optional(),
    email: z.string().optional(),
    address: z.string().optional(),
    addressLine2: z.string().optional(),
    postcode: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
  }),
  // credit/debit folded into 'merchant' (2026-05-23). POS sends merchant/installment/transfer/cash.
  paymentMethod: z.enum(['merchant', 'installment', 'transfer', 'cash']),
  approvalCode: z.string().optional(),
  // Installment term — 6 or 12 months. Required iff paymentMethod = 'installment'
  // (enforced by the .superRefine below). 0% installment — never affects pricing.
  installmentMonths: z.union([z.literal(6), z.literal(12)]).nullable().optional(),
  // Merchant acquirer / terminal. Required iff paymentMethod = 'merchant'.
  merchantProvider: z.enum(['GHL', 'HLB', 'MBB', 'PBB']).nullable().optional(),
  notes: z.string().optional(),
  // ISO YYYY-MM-DD; omit when customer wants delivery TBD.
  deliveryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'invalid_date_format').optional(),
  // Free-form slot label, e.g. '12:00 – 15:00'. Only meaningful when deliveryDate present.
  deliverySlot: z.string().max(64).optional(),
  lines: z.array(orderLineSchema).min(1),

  // ─── Handover-redesign (Phase 4.5) ───────────────────────────────────
  // All optional → backward-compatible with pre-redesign POS clients.
  // Mapped to `orders` columns by migration 0023.
  customerType:        z.enum(['new', 'existing']).optional(),
  buildingType:        z.enum(['condo', 'landed', 'apartment', 'office', 'shop', 'other']).optional(),
  billingSame:         z.boolean().optional(),
  // Billing address — only present when billingSame === false.
  // Persisted to orders.customer_billing_* (migration 0028).
  billingAddress:        z.string().optional(),
  billingAddressLine2:   z.string().optional(),
  billingPostcode:       z.string().optional(),
  billingCity:           z.string().optional(),
  billingState:          z.string().optional(),
  salespersonId:       z.string().uuid().optional(),
  specialInstructions: z.string().max(1000).optional(),
  // When true, customer chose delivery TBD — address fields may be blank.
  addressLater:        z.boolean().optional(),
  // Handover-time logistics addons (dispose, lift, assemble). Server recomputes
  // total against the current `addons` table — drifted prices reject with 409.
  addons:              z.array(handoverAddonSchema).optional(),
  // Amount collected at handover (whole MYR). Flows into `orders.paid` via the
  // RPC's `paid` key; defaults to 0 server-side when omitted (legacy clients).
  paid:                z.number().int().nonnegative().optional(),
  // Additional delivery fee keyed in by POS sales at handover. No cap; server
  // clamps negatives to 0. Server-recomputed delivery fee = config.baseFee
  // + (crossCategoryFee if ≥2 product categories) + this. (Migration 0029)
  additionalDeliveryFee: z.number().int().nonnegative().optional(),

  // Client-submitted total — server recomputes and rejects with 409 if drift
  // exceeds 0.5%. Never trusted as the actual saved amount.
  clientTotal: z.number().int().nonnegative(),

  // Slip MVP (Phase 4): present iff paymentMethod=transfer. Server-side RPC
  // validates session ownership + status='uploaded' and promotes atomically.
  uploadSessionId: z.string().uuid().optional(),

  // Customer e-signature captured by the Handover SignaturePad — a base64
  // PNG data URL. Persisted as-is on orders.signature_data so the printed
  // Sales Order can re-render it 1:1. Sales-flow path is optional (so older
  // POS clients still parse), but Handover gates submit on form.signed, so
  // in practice every new order arrives with one.
  signatureData: z.string().optional(),
}).superRefine((v, ctx) => {
  if (v.paymentMethod === 'installment') {
    if (v.installmentMonths !== 6 && v.installmentMonths !== 12) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['installmentMonths'],
        message: 'installment_term_required' });
    }
  } else if (v.installmentMonths !== undefined && v.installmentMonths !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['installmentMonths'],
      message: 'installment_term_only_for_installment' });
  }

  if (v.paymentMethod === 'merchant') {
    if (!v.merchantProvider) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['merchantProvider'],
        message: 'merchant_provider_required' });
    }
  } else if (v.merchantProvider !== undefined && v.merchantProvider !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['merchantProvider'],
      message: 'merchant_provider_only_for_merchant' });
  }
});

export type OrderV1PostBody = z.infer<typeof orderV1PostSchema>;
export type OrderLineDto = z.infer<typeof orderLineSchema>;
export type HandoverAddonDto = z.infer<typeof handoverAddonSchema>;
