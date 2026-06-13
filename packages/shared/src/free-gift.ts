// Default Free Gift (accessory) — pure, shared by the POS cart reconciler and
// the server SO-create validator. NO voucher codes: a gift is deterministic
// from the trigger's configured `default_free_gifts`. The GIFT is always an
// accessory; the TRIGGER may be a product (matched by id/model) or a sofa combo
// (matched by combo, D9). One gift set per qualifying item (qty scales).

export interface DefaultFreeGift {
  /** mfg_products.id of an ACCESSORY product (the gift). */
  giftProductId: string;
  /** count PER qualifying trigger unit (>= 1). */
  qty: number;
  /** free-text; null/blank => the line shows "Free gift". */
  campaignName?: string | null;
}

/** A trigger present in the cart/order, with the gifts it grants. */
export interface FreeGiftTrigger {
  /** cart line key (client) or a stable per-line ref (server). */
  triggerKey: string;
  /** product id ('product') or combo id ('combo'). */
  triggerRef: string;
  triggerKind: 'product' | 'combo';
  /** the trigger LINE's qty (gift qty scales by this). */
  triggerQty: number;
  gifts: DefaultFreeGift[];
}

/** A gift line the cart SHOULD contain. */
export interface DesiredFreeGift {
  key: string;
  triggerKey: string;
  giftProductId: string;
  qty: number;
  campaignName: string | null;
}

/** A gift line the order DOES contain (server side), to validate. */
export interface FreeGiftLineClaim {
  idx: number;
  giftProductId: string;
  qty: number;
}

export interface FreeGiftRejection {
  idx: number;
  giftProductId: string;
  reason: 'no_trigger' | 'qty_exceeds_allowance';
}

/** Deterministic cart-line key so the reconciler can find/replace a gift line. */
export const freeGiftLineKey = (triggerKey: string, entryIndex: number): string =>
  `gift-${triggerKey}-${entryIndex}`;

/** Coerce raw jsonb into clean DefaultFreeGift[] (drops malformed entries). */
export function parseDefaultFreeGifts(raw: unknown): DefaultFreeGift[] {
  if (!Array.isArray(raw)) return [];
  const out: DefaultFreeGift[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const r = e as Record<string, unknown>;
    const giftProductId = typeof r.giftProductId === 'string' ? r.giftProductId.trim() : '';
    const qty = typeof r.qty === 'number' ? Math.floor(r.qty) : NaN;
    if (!giftProductId || !Number.isFinite(qty) || qty < 1) continue;
    const campaignName =
      typeof r.campaignName === 'string' && r.campaignName.trim() !== '' ? r.campaignName.trim() : null;
    out.push({ giftProductId, qty, campaignName });
  }
  return out;
}

/** The gift lines the cart should contain, scaled by each trigger's qty. */
export function computeDesiredFreeGifts(triggers: FreeGiftTrigger[]): DesiredFreeGift[] {
  const desired: DesiredFreeGift[] = [];
  for (const t of triggers) {
    t.gifts.forEach((g, i) => {
      desired.push({
        key: freeGiftLineKey(t.triggerKey, i),
        triggerKey: t.triggerKey,
        giftProductId: g.giftProductId,
        qty: Math.max(1, g.qty) * Math.max(1, t.triggerQty),
        campaignName: g.campaignName ?? null,
      });
    });
  }
  return desired;
}

/**
 * Server-side eligibility. Each claimed gift line must be covered by the order's
 * triggers: the gift product must be granted by some trigger, and the TOTAL
 * claimed qty for a gift product must not exceed the SUM of allowances
 * (Σ entry.qty × trigger.qty) across all triggers that grant it.
 */
export function validateFreeGiftClaims(
  claims: FreeGiftLineClaim[],
  triggers: FreeGiftTrigger[],
): { valid: number[]; rejected: FreeGiftRejection[] } {
  const allowance = new Map<string, number>();
  for (const t of triggers) {
    for (const g of t.gifts) {
      const cur = allowance.get(g.giftProductId) ?? 0;
      allowance.set(g.giftProductId, cur + Math.max(1, g.qty) * Math.max(1, t.triggerQty));
    }
  }
  const valid: number[] = [];
  const rejected: FreeGiftRejection[] = [];
  const remaining = new Map(allowance);
  for (const claim of claims) {
    if (!allowance.has(claim.giftProductId)) {
      rejected.push({ idx: claim.idx, giftProductId: claim.giftProductId, reason: 'no_trigger' });
      continue;
    }
    const left = remaining.get(claim.giftProductId) ?? 0;
    if (claim.qty > left) {
      rejected.push({ idx: claim.idx, giftProductId: claim.giftProductId, reason: 'qty_exceeds_allowance' });
      continue;
    }
    remaining.set(claim.giftProductId, left - claim.qty);
    valid.push(claim.idx);
  }
  return { valid, rejected };
}
