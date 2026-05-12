// Product Zod schema — drives both SkuDrawer client validation and
// POST /api/products server validation. Discriminated by pricingKind so
// each variant carries exactly the pricing rows it needs.

import { z } from 'zod';

// Whole-MYR money — INTEGER per CLAUDE.md. No sen.
const money = z.number().int().min(0).max(1_000_000);

// SKU code: uppercase letters, digits, hyphens. Prefix-N convention
// (MAT-001, SOF-101) is human convention, not schema-enforced.
const skuCode = z
  .string()
  .min(1)
  .max(40)
  .regex(/^[A-Z0-9-]+$/, 'SKU must be uppercase letters, digits, hyphens');

// Per-Model add-ons that ship FREE with the product (e.g. mattress includes
// 2 memory foam pillows). POS reads this from products.included_addons jsonb
// and renders the PILLOWS section in the Configurator. NOT priced — the
// addon is a free extra; total stays at the size base price.
const includedAddon = z.object({
  addonId: z.string().min(1),
  qty:     z.number().int().min(1).max(20),
});

// Identity + inventory + visibility — fields shared by every pricing variant.
const productBase = z.object({
  sku:             skuCode,
  categoryId:      z.string().min(1),
  seriesId:        z.string().min(1).nullable(),
  name:            z.string().min(1).max(120),
  detail:          z.string().max(280).nullable(),
  sizeDisplay:     z.string().max(80).nullable(),
  imgKey:          z.string().max(200).nullable(),
  thumbKey:        z.string().max(200).nullable(),
  stock:           z.number().int().min(0),
  lowAt:           z.number().int().min(0),
  visible:         z.boolean(),
  includedAddons:  z.array(includedAddon).max(20).default([]),
});

// Sofa: 13 compartments + 5 bundles + 1 recliner upgrade price.
// Library row counts are enforced upstream (server checks compartmentId/bundleId
// against compartment_library/bundle_library); schema only validates shape.
const sofaPricingRow = z.object({
  compartmentId: z.string().min(1),
  active:        z.boolean(),
  price:         money,
});
const sofaBundleRow = z.object({
  bundleId: z.string().min(1),
  active:   z.boolean(),
  price:    money,
});

export const sofaProductSchema = productBase.extend({
  pricingKind:          z.literal('sofa_build'),
  reclinerUpgradePrice: money,
  compartments:         z.array(sofaPricingRow).min(1),
  bundles:              z.array(sofaBundleRow).min(1),
});

// Mattress / bedframe: 4 sizes (Single, Super Single, Queen, King).
const sizeRow = z.object({
  sizeId: z.string().min(1),
  active: z.boolean(),
  price:  money,
});

export const sizeProductSchema = productBase.extend({
  pricingKind: z.literal('size_variants'),
  sizes:       z.array(sizeRow).min(1),
});

// Flat: single fixed price.
export const flatProductSchema = productBase.extend({
  pricingKind: z.literal('flat'),
  flatPrice:   money,
});

// TBC: not yet priced.
export const tbcProductSchema = productBase.extend({
  pricingKind: z.literal('tbc'),
});

// At least one row must be active AND have a price > RM 0. Applied at the
// outer discriminated-union level so the rule reaches the SKU drawer (via
// zodResolver) and POST /api/products on the server. Mattress / bedframe
// SKUs require ≥1 priced size; sofa SKUs require ≥1 priced Quick-Pick bundle.
// Compartments are intentionally NOT checked — Custom Build is a secondary
// flow, Quick-Pick is the primary POS entry point for sofas.
export const productSchema = z.discriminatedUnion('pricingKind', [
  sofaProductSchema,
  sizeProductSchema,
  flatProductSchema,
  tbcProductSchema,
]).superRefine((val, ctx) => {
  if (val.pricingKind === 'size_variants') {
    const ok = val.sizes.some((s) => s.active && s.price > 0);
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['sizes'],
        message: 'Activate at least one size and fill in its price.',
      });
    }
  } else if (val.pricingKind === 'sofa_build') {
    const ok = val.bundles.some((b) => b.active && b.price > 0);
    if (!ok) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['bundles'],
        message: 'Activate at least one Quick-Pick bundle and fill in its price.',
      });
    }
  }
});

export type ProductInput      = z.infer<typeof productSchema>;
export type SofaProductInput  = z.infer<typeof sofaProductSchema>;
export type SizeProductInput  = z.infer<typeof sizeProductSchema>;
export type FlatProductInput  = z.infer<typeof flatProductSchema>;
export type TbcProductInput   = z.infer<typeof tbcProductSchema>;
