// ----------------------------------------------------------------------------
// Applying a Campaign Promo voucher to the cart.
//
// This is the decision layer between "salesperson clicked Apply" and "the order
// payload carries discountCenti". Pure — no fetch, no store — so every rule is
// testable without a cart or a network.
//
// THE FLOW IT SERVES (see campaign-promo-queries.ts for the calls):
//   1. planVoucher()  → refuse, or return per-line discounts
//   2. claim          → reserves stock. A 409 here means STOP; do not apply.
//   3. submit to Houzs with the discounts on the lines
//   4. confirm on success / release on failure
//
// WHY THE MONEY IS A PER-LINE DISCOUNT AT ALL: mfg_sales_orders has no discount
// column — the only channel is mfg_sales_order_items.discount_centi. Houzs
// accepts it from the client (its drift gate compares UNIT price only) and
// bounds it server-side at 0 <= discount <= qty * unit per line. So a voucher
// must arrive already apportioned, and every share must respect that bound —
// which proportional splitting satisfies by construction.
// ----------------------------------------------------------------------------
import { splitVoucherAcrossLines } from '@2990s/shared/voucher-split';

export interface VoucherCartLine {
  /** Cart line key — what the handover payload uses to match lines back up. */
  key: string;
  /** Units of this line. Feeds the campaign's minimum-items rule. */
  qty: number;
  /** qty × unit price in sen, BEFORE discount. */
  lineTotalCenti: number;
  /**
   * True when this cart line explodes into several module rows server-side.
   *
   * ⚠️ SOFA BUILDS CARRY NO DISCOUNT. The server assigns a cart line's WHOLE
   * discount to module row 0 (`i === 0 ? discount : 0`, mfg-sales-orders.ts:2746)
   * while bounding it against the whole build — so a share bigger than the lead
   * module persists a negative total_centi / line_margin_centi with nothing
   * rejecting it.
   *
   * So a sofa may only ever carry what row 0 can hold. `sofaLeadModuleCenti`
   * below is that figure, and a sofa without one contributes nothing — which is
   * the common case for a Model with unpriced modules, deliberately so.
   *
   * The real fix is server-side (spread a build's discount across its module
   * rows with the same weights the price already uses — `distributeProportionally`
   * is called one line above where the discount is dumped on row 0). When that
   * lands, drop the cap and let sofas take a proportional share like anything
   * else.
   */
  isSofaBuild?: boolean;
  /**
   * For a sofa build: the sen value of MODULE ROW 0 — the row the server drops
   * this line's whole discount onto. `leadModuleValueCenti` in
   * `@2990s/shared/voucher-sofa-cap` computes it, and returns null whenever it
   * cannot be proven; pass undefined then and the sofa carries nothing.
   *
   * This is the row's TOTAL headroom, not a budget — `SOFA_LEAD_MODULE_SAFETY`
   * below decides how much of it we are willing to spend.
   */
  sofaLeadModuleCenti?: number;
}

/**
 * The share of module row 0 a sofa line may actually use.
 *
 * Row 0's value is computed from the CLIENT's build price and the CLIENT's
 * module map. The server recomputes both, and the drift gate only guarantees
 * the build prices agree within 0.5% — the per-module weights could differ
 * again if depth or fabric tier resolve differently on the two sides.
 *
 * A quarter leaves 4× headroom over the drift tolerance. It costs nothing in
 * practice: row 0 of a real priced sofa is worth hundreds of ringgit, so the
 * RM 20 / 30 / 50 denominations clear it comfortably. Only a large voucher
 * against a cheap or many-piece sofa gets turned away — which is the case that
 * would have gone negative.
 */
const SOFA_LEAD_MODULE_SAFETY = 0.25;

/** What this sofa line may carry: capped by row 0's headroom AND by its own
 *  value (the server clamps every line at `0 <= discount <= qty * unit`). */
const sofaCapacityCenti = (l: VoucherCartLine): number => {
  const lead = l.sofaLeadModuleCenti;
  if (typeof lead !== 'number' || !Number.isFinite(lead) || lead <= 0) return 0;
  return Math.max(0, Math.min(Math.floor(lead * SOFA_LEAD_MODULE_SAFETY), l.lineTotalCenti));
};

export interface VoucherCampaign {
  id: string;
  name: string;
  valueCenti: number;
  remaining: number;
  minPurchaseQty: number;
  active: boolean;
}

export type VoucherRefusal =
  | 'inactive'
  | 'sold_out'
  | 'below_min_items'
  | 'empty_cart'
  | 'exceeds_order_total'
  /** Every payable line is a sofa build, so there is nothing that may carry the
   *  discount. See the note on `isSofaBuild`. */
  | 'sofa_only_order';

export interface VoucherPlan {
  ok: true;
  /** Per cart line, the sen to place in discountCenti. Lines not listed get 0. */
  discountByLineKey: Record<string, number>;
  /** What actually comes off — equals the voucher value; we refuse otherwise. */
  appliedCenti: number;
}

export interface VoucherRefused {
  ok: false;
  reason: VoucherRefusal;
  /** Ready to show; the caller should not have to build copy from the code. */
  message: string;
}

export const planVoucher = (
  campaign: VoucherCampaign,
  lines: VoucherCartLine[],
): VoucherPlan | VoucherRefused => {
  const no = (reason: VoucherRefusal, message: string): VoucherRefused => ({ ok: false, reason, message });

  if (!campaign.active) return no('inactive', `${campaign.name} is not active.`);
  if (campaign.remaining <= 0) return no('sold_out', `${campaign.name} is fully redeemed.`);

  const payable = lines.filter((l) => l.lineTotalCenti > 0);
  if (payable.length === 0) return no('empty_cart', 'Add an item before applying a voucher.');

  const totalQty = payable.reduce((s, l) => s + Math.max(0, l.qty), 0);
  if (totalQty < campaign.minPurchaseQty) {
    return no(
      'below_min_items',
      `${campaign.name} needs at least ${campaign.minPurchaseQty} item(s) in the order — there ${totalQty === 1 ? 'is' : 'are'} ${totalQty}.`,
    );
  }

  /* Non-sofa lines take the voucher FIRST. When they can cover it this is the
     whole story, and the behaviour is exactly what it always was — a sofa in
     the basket changes nothing. */
  const nonSofa = payable.filter((l) => !l.isSofaBuild);
  const nonSofaTotal = nonSofa.reduce((s, l) => s + l.lineTotalCenti, 0);
  const discountByLineKey: Record<string, number> = {};

  if (campaign.valueCenti <= nonSofaTotal) {
    const split = splitVoucherAcrossLines(
      nonSofa.map((l) => ({ key: l.key, lineTotalCenti: l.lineTotalCenti })),
      campaign.valueCenti,
    );
    for (const s of split.shares) if (s.discountCenti > 0) discountByLineKey[s.key] = s.discountCenti;
    return { ok: true, discountByLineKey, appliedCenti: split.appliedCenti };
  }

  /* Not enough elsewhere, so the sofas cover the shortfall — but only up to what
     module row 0 can hold, because that is the single row the server will put
     each line's whole discount on. A sofa whose row 0 could not be established
     contributes 0 capacity and is passed over. */
  const sofas = payable.filter((l) => l.isSofaBuild);
  const sofaCapacity = sofas.reduce((s, l) => s + sofaCapacityCenti(l), 0);

  /* Refuse rather than part-apply. splitVoucherAcrossLines would happily cap and
     report the remainder, but a voucher that silently comes off at less than
     face value is worse than one that won't apply — the customer is holding a
     RM 500 note and the screen says RM 300. Make it a conversation, not a
     surprise. */
  if (campaign.valueCenti > nonSofaTotal + sofaCapacity) {
    /* Copy fix 2026-08-13: the old message said "sofa-only order", which reads
       as a blanket rule — but sofa-only orders on Lyyar/Booqit apply vouchers
       fine. The real condition is that NO sofa here has a PRICED lead piece
       (the one row the server puts a sofa's whole discount on), so there is
       nothing to prove a safe amount against. Say that, or the salesperson
       compares two sofa-only orders behaving differently and concludes the
       feature is broken. */
    if (nonSofa.length === 0 && sofaCapacity === 0) {
      return no(
        'sofa_only_order',
        `${campaign.name} can't be applied — none of these sofas can carry a discount (their first piece has no price in the catalogue). Add a non-sofa item, or pass it to the office to apply by hand.`,
      );
    }
    return no(
      'exceeds_order_total',
      sofas.length > 0
        ? `${campaign.name} is worth more than this order can safely take — a sofa only carries a small part of a discount, on its first piece. Add another item, use a smaller voucher, or pass it to the office.`
        : `${campaign.name} is worth more than this order. Add items, or use a smaller voucher.`,
    );
  }

  // Non-sofa lines give everything they have, then the sofas cover the rest —
  // each within its own cap, in cart order so the result is stable.
  for (const l of nonSofa) discountByLineKey[l.key] = l.lineTotalCenti;
  let left = campaign.valueCenti - nonSofaTotal;
  for (const l of sofas) {
    if (left <= 0) break;
    const take = Math.min(sofaCapacityCenti(l), left);
    if (take > 0) {
      discountByLineKey[l.key] = take;
      left -= take;
    }
  }

  return { ok: true, discountByLineKey, appliedCenti: campaign.valueCenti };
};
