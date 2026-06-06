// ----------------------------------------------------------------------------
// so-line-display — CUSTOMER-FACING display folding of SO lines.
//
// Loo 2026-06-05: on customer-facing surfaces (POS SalesOrderPrint, Backend
// sales-order-pdf, POS order drawer) a configured sofa should read as ONE line
// per Model with the combined price ("SOFA BOOQIT — MYR 3,115.00"), while the
// persisted per-module SKU lines (P3 sofa split, so-sofa-split.ts) stay
// untouched and keep driving Backend SO Details, reports, DO picking and
// inventory. This module is a pure RENDER-TIME fold — it never mutates lines.
//
// Grouping key: variants.buildKey (written by the SO create path per build,
// e.g. "build-1") + variants.cellIndex for in-group order. Lines without a
// buildKey (legacy pre-P3 SOs, services, bedframes, mattresses) pass through
// 1:1 — legacy multi-row sofas CANNOT be grouped reliably (SO-2606-010 holds
// three different Models as separate single-module purchases), so we never
// guess.
//
// Money: the P3 split floors every share and puts the rounding residue on the
// last line, so summing unit_price_centi / total_centi across a buildKey group
// reconstructs the build total EXACTLY (discount is netted on the lead line's
// total already).
//
// PWP notes (same ask): pwp_codes always intended the unused voucher to print
// on the SO (schema.ts: "printed on the SO, redeemable cross-order") — this is
// the render half. The reward line carries variants.pwpCode/pwpTriggerLabel;
// the trigger line is matched via pwp_codes.trigger_item_code at print time.
// ----------------------------------------------------------------------------

/** Minimal raw SO line shape (snake_case = the API row verbatim). Callers pass
 *  their richer row type; the fold preserves it via the generic. */
export interface RawSoDisplayLine {
  item_code: string;
  description?: string | null;
  description2?: string | null;
  qty?: number | null;
  unit_price_centi?: number | null;
  discount_centi?: number | null;
  total_centi?: number | null;
  variants?: unknown;
  /** Per-line operator remark (mfg_sales_order_items.remark). Optional —
   *  legacy callers that don't select it simply fold without remarks. */
  remark?: string | null;
}

/** One display row after folding: either a single original line, or a sofa
 *  build folded to one Model-level row. `lines` always holds the originals. */
export interface SoDisplayGroup<T extends RawSoDisplayLine> {
  kind: 'single' | 'sofa-build';
  lines: T[];
  /** Folded presentation — only for kind 'sofa-build'. */
  display?: {
    /** Model token, e.g. 'BOOQIT' (item_code prefix before the module code). */
    itemCode: string;
    /** 'SOFA BOOQIT' — module suffix dropped. */
    description: string;
    /** '1B(LHF) + 2A(RHF) + CNR' — from variants.summary, else module codes. */
    composition: string | null;
    /** Shared per-line variant summary (e.g. 'EZ-003 / SEAT 28 / LEG 4"'). */
    description2: string | null;
    qty: number;
    unitPriceCenti: number;
    discountCenti: number;
    totalCenti: number;
    /** Lead line's remark, else the first non-empty remark in the group. */
    remark: string | null;
  };
}

const readVariants = (line: RawSoDisplayLine): Record<string, unknown> | null =>
  line.variants && typeof line.variants === 'object' && !Array.isArray(line.variants)
    ? (line.variants as Record<string, unknown>)
    : null;

const readBuildKey = (line: RawSoDisplayLine): string | null => {
  const v = readVariants(line);
  const k = v?.buildKey;
  return typeof k === 'string' && k.trim() !== '' ? k : null;
};

const readCellIndex = (line: RawSoDisplayLine): number => {
  const v = readVariants(line);
  const idx = v?.cellIndex;
  return typeof idx === 'number' && Number.isFinite(idx) ? idx : Number.MAX_SAFE_INTEGER;
};

/** Model token from a module SKU: everything before the LAST '-'.
 *  'BOOQIT-2A(RHF)' → 'BOOQIT'. Compartment codes are parens-vocabulary
 *  (1A(LHF) — the dash vocabulary was eliminated 2026-06-04) so the module
 *  suffix itself never contains '-'. */
const modelTokenOf = (itemCode: string): string | null => {
  const idx = itemCode.lastIndexOf('-');
  return idx > 0 ? itemCode.slice(0, idx) : null;
};

/** Module code = the suffix after the last '-'. */
const moduleCodeOf = (itemCode: string): string =>
  itemCode.slice(itemCode.lastIndexOf('-') + 1);

/** Composition from variants.summary's first ' · ' segment
 *  ("1B(LHF) + 2A(RHF) + CNR · 28\" · EZ/EZ-003 Light Brown" → the first part),
 *  falling back to the module codes in cellIndex order. */
const compositionOf = <T extends RawSoDisplayLine>(lines: T[]): string | null => {
  const v = readVariants(lines[0]!);
  const summary = v?.summary;
  if (typeof summary === 'string' && summary.trim() !== '') {
    const first = summary.split('·')[0]?.trim();
    if (first) return first;
  }
  const codes = lines.map((l) => moduleCodeOf(l.item_code)).filter(Boolean);
  return codes.length > 0 ? codes.join(' + ') : null;
};

/**
 * Fold per-module sofa lines (same variants.buildKey, >1 line, all qty 1) into
 * one Model-level display group; everything else passes through as 'single'.
 * Output preserves the input order — a folded group sits where its first line
 * was. Pure; never mutates the input lines.
 */
export function groupSoLinesForDisplay<T extends RawSoDisplayLine>(
  lines: T[],
): SoDisplayGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const line of lines) {
    const key = readBuildKey(line);
    if (!key) continue;
    const arr = byKey.get(key) ?? [];
    arr.push(line);
    byKey.set(key, arr);
  }

  const out: SoDisplayGroup<T>[] = [];
  const folded = new Set<T>();
  for (const line of lines) {
    if (folded.has(line)) continue;
    const key = readBuildKey(line);
    const group = key ? byKey.get(key) : null;

    // Fold only real multi-module builds where every line is one unit and the
    // Model token is consistent — anything irregular stays per-SKU (honest
    // fallback; never guess a grouping the data doesn't support).
    const models = group?.map((l) => modelTokenOf(l.item_code)) ?? [];
    const model = models[0] ?? null;
    const foldable =
      !!group && group.length > 1 &&
      group.every((l) => Number(l.qty ?? 0) === 1) &&
      !!model && models.every((m) => m === model);

    if (!foldable || !group) {
      out.push({ kind: 'single', lines: [line] });
      continue;
    }

    const ordered = [...group].sort((a, b) => readCellIndex(a) - readCellIndex(b));
    for (const l of ordered) folded.add(l);
    const lead = ordered[0]!;
    out.push({
      kind: 'sofa-build',
      lines: ordered,
      display: {
        itemCode: model!,
        description: `SOFA ${model!}`,
        composition: compositionOf(ordered),
        description2: lead.description2 ?? null,
        qty: 1,
        unitPriceCenti: ordered.reduce((s, l) => s + Number(l.unit_price_centi ?? 0), 0),
        discountCenti: Number(lead.discount_centi ?? 0),
        totalCenti: ordered.reduce((s, l) => s + Number(l.total_centi ?? 0), 0),
        remark: ordered.find((l) => typeof l.remark === 'string' && l.remark.trim() !== '')?.remark ?? null,
      },
    });
  }
  return out;
}

// ─────────────────────────────── PWP notes ──────────────────────────────────

/** pwp_codes row as returned by GET /mfg-sales-orders/:docNo (codes whose
 *  source_doc_no = this SO — i.e. vouchers THIS order's trigger items issued). */
export interface SoPwpCodeRow {
  code: string;
  status: string; // RESERVED | USED | AVAILABLE
  trigger_item_code?: string | null;
  redeemed_doc_no?: string | null;
}

export interface SoPwpNote {
  /** 'used' renders accented (voucher consumed), 'unused' renders muted. */
  tone: 'used' | 'unused';
  text: string;
}

/** Notes for a REWARD line (variants.pwp === true): the voucher it consumed. */
export function pwpRewardNote(variants: unknown): SoPwpNote | null {
  const v = variants && typeof variants === 'object' && !Array.isArray(variants)
    ? (variants as Record<string, unknown>)
    : null;
  if (v?.pwp !== true) return null;
  const code = typeof v.pwpCode === 'string' && v.pwpCode.trim() !== '' ? v.pwpCode : null;
  const label = typeof v.pwpTriggerLabel === 'string' && v.pwpTriggerLabel.trim() !== ''
    ? v.pwpTriggerLabel
    : null;
  const parts = ['PWP price'];
  if (code) parts.push(`PWP: ${code}`);
  if (label) parts.push(`redeemed with ${label}`);
  return { tone: 'used', text: parts.join(' · ') };
}

/** Notes for a TRIGGER line: vouchers this SO issued off this item_code.
 *  USED → short reference; otherwise → 排法 A "issued, not redeemed yet". */
export function pwpTriggerNotes(
  itemCodes: string[],
  codes: SoPwpCodeRow[] | null | undefined,
): SoPwpNote[] {
  if (!codes || codes.length === 0) return [];
  const mine = codes.filter(
    (cd) => !!cd.trigger_item_code && itemCodes.includes(cd.trigger_item_code),
  );
  return mine.map((cd) =>
    cd.status === 'USED'
      ? { tone: 'used' as const, text: `PWP: ${cd.code}` }
      : { tone: 'unused' as const, text: `PWP voucher issued: ${cd.code} · not redeemed yet` },
  );
}
