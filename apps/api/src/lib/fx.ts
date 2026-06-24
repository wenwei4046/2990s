// ----------------------------------------------------------------------------
// fx.ts — multi-currency helpers for the procure-to-pay money path.
//
// Two documents carry an exchange rate (MYR per 1 unit of the doc's currency):
//   · purchase_invoices.exchange_rate (migration 0188) — converts the AP journal
//     entry to MYR at GL-post time.
//   · grns.exchange_rate (migration 0190) — converts the inventory IN unit cost
//     (the FIFO lot) to MYR at receive time.
//
// Both mirror the SAME shape (originally inlined in purchase-invoices.ts as
// normalizeExchangeRate): MYR is ALWAYS rate 1; a foreign rate must be a finite
// number > 0, else it falls back to 1 so a malformed rate can NEVER zero out the
// money. rate = 1 ⇒ toMyrSen is a byte-for-byte NO-OP (round(x*1) === x for an
// integer sen amount), so existing MYR flows are unchanged.
// ----------------------------------------------------------------------------

/**
 * Normalise an incoming exchange rate against a currency, for WRITE paths
 * (GRN / PI create + update). MYR forces 1; a foreign rate must be finite > 0
 * (else 1). Returns a JS number; PostgREST stores it into numeric(14,6).
 * Identical to purchase-invoices.ts normalizeExchangeRate (migration 0188).
 */
export function normalizeExchangeRate(raw: unknown, currency: string): number {
  if (String(currency).toUpperCase() === 'MYR') return 1;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Guard a rate READ back from the DB (numeric → string|number|null). A missing /
 * non-positive / non-finite rate degrades to 1 — never zero out the money. MYR
 * rows always store 1 (enforced on write), so this only ever matters for a
 * malformed foreign rate. Mirrors the inline guard in accounting.ts postPiAccounting.
 */
export function safeRate(raw: unknown): number {
  const n = Number(raw ?? 1);
  return Number.isFinite(n) && n > 0 ? n : 1;
}

/**
 * Convert a foreign-currency sen amount to MYR sen at the given rate.
 * round(foreignSen * rate). rate === 1 ⇒ returns foreignSen unchanged (the
 * MYR no-op): Math.round(intSen * 1) === intSen.
 */
export function toMyrSen(foreignSen: number, rate: unknown): number {
  return Math.round(Number(foreignSen ?? 0) * safeRate(rate));
}
