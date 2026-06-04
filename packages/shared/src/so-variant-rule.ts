// ----------------------------------------------------------------------------
// so-variant-rule — the ONE source of truth for "a Sales Order line's
// category-required variants are all filled".
//
// History: the rule was born in the Backend coordinator vocabulary
// (sofa → seatHeight + legHeight + fabricCode) and hand-copied into four
// places: apps/api so-variant-check, backend SoLineCard, SalesOrderDetail,
// and sales-order/types. The POS handover speaks a DIFFERENT vocabulary for
// the same physical facts — sofa seat depth is `variants.depth` and the sofa
// leg pick is `variants.sofaLegHeight` (PR #473) — so the moment PR #448
// started threading the POS Process Date onto the SO, every POS sofa order
// with a Process Date 409'd `variants_incomplete` (2026-06-04, Bernard's
// RM 3,365 order at the handover screen).
//
// The server already treats these keys as the same axis everywhere else:
//   mfg-sales-orders.ts  → combo lookup height = depth ?? seatHeight
//   allowed-options-check → legPick = legHeight ?? sofaLegHeight
// This module encodes that equivalence ONCE: each required axis lists every
// key that satisfies it. The canonical key (first alias) is what offender
// reports name, so coordinator-facing messages keep the Backend vocabulary.
//
// Pure — no I/O. Shared by apps/api (409 gate), apps/backend (save gates +
// warning banners), and any future surface. Do NOT hand-copy the lists again.
// ----------------------------------------------------------------------------

export type VariantAxis = {
  /** Canonical key — what offender lists / `missing` arrays report. */
  key: string;
  /** Human label for coordinator-facing messages ("missing: Seat Height"). */
  label: string;
  /** Every variant key that satisfies this axis (canonical first). */
  aliases: readonly string[];
};

export const REQUIRED_VARIANT_AXES_BY_CATEGORY: Record<string, readonly VariantAxis[]> = {
  bedframe: [
    { key: 'divanHeight', label: 'Divan Height', aliases: ['divanHeight'] },
    { key: 'legHeight',   label: 'Leg Height',   aliases: ['legHeight'] },
    { key: 'gap',         label: 'Gap',          aliases: ['gap'] },
    { key: 'fabricCode',  label: 'Fabrics',      aliases: ['fabricCode'] },
  ],
  sofa: [
    // Backend coordinators fill seatHeight; the POS configurator captures the
    // same physical pick as `depth` (always set — Configurator activeDepth).
    { key: 'seatHeight',  label: 'Seat Height',  aliases: ['seatHeight', 'depth'] },
    // Backend fills legHeight; POS sends sofaLegHeight (PR #473 leg picker).
    { key: 'legHeight',   label: 'Leg Height',   aliases: ['legHeight', 'sofaLegHeight'] },
    { key: 'fabricCode',  label: 'Fabrics',      aliases: ['fabricCode'] },
  ],
};

const isEmpty = (val: unknown): boolean =>
  val === undefined || val === null || String(val).trim() === '';

/** The axes a line leaves unsatisfied — [] when the line is complete or its
 *  category has no mandatory variants (mattress / accessory / service). An
 *  axis is satisfied when ANY of its aliases carries a non-empty value. */
export function missingVariantAxes(
  itemGroup: string | null | undefined,
  variants: Record<string, unknown> | null | undefined,
): VariantAxis[] {
  const axes = REQUIRED_VARIANT_AXES_BY_CATEGORY[(itemGroup ?? '').toLowerCase()];
  if (!axes) return [];
  const v = variants ?? {};
  return axes.filter((axis) => axis.aliases.every((k) => isEmpty(v[k])));
}
