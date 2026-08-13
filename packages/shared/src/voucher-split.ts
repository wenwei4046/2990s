// ----------------------------------------------------------------------------
// Campaign voucher — apportioning a fixed money value across order lines.
//
// A Home Voucher ("RM 500 off") is order-level in the customer's head, but
// `mfg_sales_orders` has NO discount column — the only discount channel in the
// schema is `mfg_sales_order_items.discount_centi`, per line. So a fixed-value
// voucher has to be split across the lines it applies to.
//
// WHY PROPORTIONAL, not "put it all on one line":
//   · Margin, commission and the per-category revenue splits
//     (mattress_sofa_centi / bedframe_centi / accessories_centi / others_centi)
//     are all computed PER LINE. Dumping RM 500 on a RM 1,000 mattress makes
//     that line read as a 50% discount with wrecked margin while the sofa
//     beside it looks untouched — and the category split is then wrong.
//   · The server clamps each line to `0 <= discount <= qty * unit`
//     (mfg-sales-orders.ts, create + add-line + edit paths, 422
//     `invalid_discount`). A proportional share is `(line / total) * voucher`,
//     which can never exceed its own line so long as the voucher does not
//     exceed the order — so proportional satisfies the clamp by construction,
//     where "all on one line" needs spill-over logic.
//
// Sen are indivisible, so the naive `round(share)` per line does not sum back
// to the voucher. We use LARGEST REMAINDER: floor every share, then hand the
// leftover sen out one at a time to the lines with the biggest fractional part.
// The result always sums to EXACTLY the applied amount — which matters because
// the customer sees one number on the printed SO and the lines must reconcile
// to it.
//
// ⚠️ SOFA BUILDS — known upstream hazard, not handled here. When one cart line
// explodes into module rows the server assigns the whole line discount to
// module row 0 (`i === 0 ? discount : 0`), while the bound is checked against
// the whole build. A share larger than the lead module's own value therefore
// persists a NEGATIVE total_centi / line_margin_centi with nothing rejecting
// it. Callers should treat a sofa build as ONE line here (its combined total)
// and must not apply a voucher larger than the lead module's value until that
// is fixed server-side.
// ----------------------------------------------------------------------------

export interface VoucherSplitLine {
  /** Caller's line identity — cart line key, item id, whatever it needs back. */
  key: string;
  /** qty × unit price, in sen, BEFORE any discount. Non-positive lines are skipped. */
  lineTotalCenti: number;
}

export interface VoucherSplitShare {
  key: string;
  /** Sen to put in this line's `discountCenti`. Always ≤ the line's own total. */
  discountCenti: number;
}

export interface VoucherSplit {
  shares: VoucherSplitShare[];
  /** What was actually apportioned — capped at the order's own value. */
  appliedCenti: number;
  /** voucher − applied. Non-zero when the voucher is worth more than the order. */
  unusedCenti: number;
}

/**
 * Split `voucherCenti` across `lines` in proportion to each line's value.
 *
 * Guarantees:
 *   · `sum(shares) === appliedCenti` exactly — no rounding leak
 *   · every share is ≤ that line's own `lineTotalCenti`
 *   · `appliedCenti === min(voucherCenti, sum of positive line totals)`
 *   · deterministic — ties in the remainder break by input order
 *
 * A voucher bigger than the order does NOT go negative; it caps and reports the
 * remainder as `unusedCenti` so the caller can decide (block it, warn, or let
 * the order go to zero). Deliberately not decided here — that is policy.
 */
export const splitVoucherAcrossLines = (
  lines: VoucherSplitLine[],
  voucherCenti: number,
): VoucherSplit => {
  const zero = (): VoucherSplit => ({
    shares: lines.map((l) => ({ key: l.key, discountCenti: 0 })),
    appliedCenti: 0,
    unusedCenti: Math.max(0, Math.trunc(voucherCenti) || 0),
  });

  const voucher = Math.trunc(voucherCenti);
  if (!Number.isFinite(voucher) || voucher <= 0) return zero();

  // Only positive lines can carry a discount; zero/negative ones are ignored
  // but still returned with a 0 share so callers can map 1:1 over their input.
  const eligible = lines
    .map((l, index) => ({ ...l, index, value: Math.trunc(l.lineTotalCenti) }))
    .filter((l) => Number.isFinite(l.value) && l.value > 0);

  const orderTotal = eligible.reduce((s, l) => s + l.value, 0);
  if (orderTotal <= 0) return zero();

  const applied = Math.min(voucher, orderTotal);

  // Largest remainder: floor each exact share, then distribute the leftover.
  const parts = eligible.map((l) => {
    const exact = (l.value * applied) / orderTotal;
    const floor = Math.floor(exact);
    return { ...l, floor, frac: exact - floor };
  });

  let leftover = applied - parts.reduce((s, p) => s + p.floor, 0);

  // Biggest fractional part first; input order breaks ties so the result is
  // stable across runs. Only lines with headroom can take an extra sen — a
  // share must never exceed its own line.
  const queue = [...parts].sort((a, b) => b.frac - a.frac || a.index - b.index);
  const bonus = new Map<string, number>();
  for (const p of queue) {
    if (leftover <= 0) break;
    if (p.floor + (bonus.get(p.key) ?? 0) >= p.value) continue;
    bonus.set(p.key, (bonus.get(p.key) ?? 0) + 1);
    leftover -= 1;
  }

  const byKey = new Map(parts.map((p) => [p.key, p.floor + (bonus.get(p.key) ?? 0)]));

  return {
    shares: lines.map((l) => ({ key: l.key, discountCenti: byKey.get(l.key) ?? 0 })),
    appliedCenti: applied,
    unusedCenti: voucher - applied,
  };
};
