// ----------------------------------------------------------------------------
// customer-credits — append-only ledger of customer credit balances
// (Commander 2026-05-30, Edge #11).
//
// When a customer overpays, or when a paid Sales Invoice is cancelled, the
// excess turns into a CREDIT BALANCE the customer can spend on future invoices.
// Each event = one row in customer_credits. Sum of amount_centi per
// debtor_code = current credit balance. Apply-to-SI writes a NEGATIVE entry
// AND a payment row on the new SI, so paid_centi advances naturally and the
// SI shows as "covered by previous credit".
//
// This also handles Edge #9: when an SI with paid_centi > 0 is cancelled, the
// cash on the books stays put — the customer just carries the equivalent as a
// credit. No automatic refund.
// ----------------------------------------------------------------------------

export type CreditSourceType =
  | 'SI_CANCEL_REFUND'   // SI was cancelled with paid_centi > 0 → credit equal to paid_centi
  | 'OVERPAY'            // payment recorded > remaining due → excess turned into credit
  | 'APPLIED_TO_SI'      // negative entry — credit applied to a new invoice
  | 'MANUAL_ADJUST';     // operator-entered adjustment

export type AddCreditInput = {
  debtorCode: string;
  debtorName?: string | null;
  amountCenti: number;                    // signed: + adds, − applies
  sourceType: CreditSourceType;
  sourceDocNo?: string | null;
  sourceDocId?: string | null;
  notes?: string | null;
  createdBy?: string | null;
};

/** Insert one ledger row. Idempotency note: callers that need it (cancel /
 *  apply) check existence first via the (sourceType, sourceDocNo) pair before
 *  calling addCustomerCredit. */
export async function addCustomerCredit(sb: any, args: AddCreditInput): Promise<{ ok: boolean; id?: string; reason?: string }> {
  if (!args.debtorCode || !args.debtorCode.trim()) return { ok: false, reason: 'debtor_code_required' };
  if (!Number.isFinite(args.amountCenti) || args.amountCenti === 0) return { ok: false, reason: 'amount_zero' };
  const { data, error } = await sb.from('customer_credits').insert({
    debtor_code:   args.debtorCode,
    debtor_name:   args.debtorName ?? null,
    amount_centi:  Math.round(args.amountCenti),
    source_type:   args.sourceType,
    source_doc_no: args.sourceDocNo ?? null,
    source_doc_id: args.sourceDocId ?? null,
    notes:         args.notes ?? null,
    created_by:    args.createdBy ?? null,
  }).select('id').single();
  if (error) return { ok: false, reason: error.message };
  return { ok: true, id: (data as { id: string }).id };
}

/** Sum the live credit balance for a customer. */
export async function getCustomerCreditBalance(sb: any, debtorCode: string): Promise<number> {
  if (!debtorCode || !debtorCode.trim()) return 0;
  const { data } = await sb
    .from('customer_credits')
    .select('amount_centi')
    .eq('debtor_code', debtorCode);
  let sum = 0;
  for (const r of (data ?? []) as Array<{ amount_centi: number }>) sum += Number(r.amount_centi ?? 0);
  return sum;
}

/**
 * Apply available customer credit toward a new Sales Invoice.
 *
 *   1. Resolve current balance for debtorCode.
 *   2. Apply = min(balance, remainingDueCenti).
 *   3. Insert a sales_invoice_payments row (method='credit', amount = applied).
 *   4. Insert a customer_credits APPLIED_TO_SI row with amount = −applied.
 *   5. Increment sales_invoices.paid_centi by the applied amount.
 *
 * No-op when balance ≤ 0. Idempotent via a guard: if a credit-payment for
 * this SI already exists, we don't re-apply.
 */
export async function applyCustomerCreditToSi(
  sb: any,
  args: {
    debtorCode: string;
    debtorName?: string | null;
    siId: string;
    siNumber: string;
    remainingDueCenti: number;
    createdBy?: string | null;
  },
): Promise<{ applied: number; reason?: string }> {
  if (!args.debtorCode || !args.debtorCode.trim()) return { applied: 0, reason: 'no_debtor' };
  if (!(args.remainingDueCenti > 0)) return { applied: 0, reason: 'no_due' };

  // Idempotency — already applied to this SI?
  const { data: existing } = await sb
    .from('sales_invoice_payments')
    .select('id, amount_centi')
    .eq('sales_invoice_id', args.siId)
    .eq('method', 'credit')
    .limit(1);
  if (existing && existing.length > 0) {
    return { applied: 0, reason: 'already_applied' };
  }

  const balance = await getCustomerCreditBalance(sb, args.debtorCode);
  if (balance <= 0) return { applied: 0, reason: 'no_balance' };
  const apply = Math.min(balance, args.remainingDueCenti);
  if (apply <= 0) return { applied: 0, reason: 'no_due' };

  // 1. Payment row on the SI — marks the SI as (partly) paid.
  const { error: payErr } = await sb.from('sales_invoice_payments').insert({
    sales_invoice_id: args.siId,
    method: 'credit',
    amount_centi: apply,
    note: `Applied customer credit balance toward ${args.siNumber}`,
    created_by: args.createdBy ?? null,
  });
  if (payErr) return { applied: 0, reason: payErr.message };

  // 2. Ledger entry — negative (credit consumed).
  await addCustomerCredit(sb, {
    debtorCode: args.debtorCode,
    debtorName: args.debtorName ?? null,
    amountCenti: -apply,
    sourceType: 'APPLIED_TO_SI',
    sourceDocNo: args.siNumber,
    sourceDocId: args.siId,
    notes: `Auto-applied to ${args.siNumber}`,
    createdBy: args.createdBy ?? null,
  });

  // 3. Bump SI's paid_centi.
  const { data: cur } = await sb.from('sales_invoices').select('paid_centi').eq('id', args.siId).maybeSingle();
  const newPaid = Number((cur as { paid_centi: number } | null)?.paid_centi ?? 0) + apply;
  await sb.from('sales_invoices').update({ paid_centi: newPaid }).eq('id', args.siId);

  return { applied: apply };
}

/**
 * Record a refund-as-credit when a paid Sales Invoice is cancelled. Looks at
 * paid_centi > 0 → writes a positive credit row for the customer (idempotent
 * on source_doc_no, so a second cancel-PATCH no-ops).
 */
export async function creditFromCancelledSi(
  sb: any,
  args: { siId: string; siNumber: string; debtorCode: string | null; debtorName: string | null; paidCenti: number; createdBy?: string | null },
): Promise<{ credited: number; reason?: string }> {
  if (!args.debtorCode || !args.debtorCode.trim()) return { credited: 0, reason: 'no_debtor' };
  if (!(args.paidCenti > 0)) return { credited: 0, reason: 'no_paid' };

  // Idempotency — already credited for this cancel?
  const { data: existing } = await sb
    .from('customer_credits')
    .select('id, amount_centi')
    .eq('source_type', 'SI_CANCEL_REFUND')
    .eq('source_doc_no', args.siNumber)
    .limit(1);
  if (existing && existing.length > 0) {
    return { credited: 0, reason: 'already_credited' };
  }

  const r = await addCustomerCredit(sb, {
    debtorCode: args.debtorCode,
    debtorName: args.debtorName ?? null,
    amountCenti: args.paidCenti,
    sourceType: 'SI_CANCEL_REFUND',
    sourceDocNo: args.siNumber,
    sourceDocId: args.siId,
    notes: `Cancelled invoice ${args.siNumber} carried ${args.paidCenti / 100} as customer credit.`,
    createdBy: args.createdBy ?? null,
  });
  return r.ok ? { credited: args.paidCenti } : { credited: 0, reason: r.reason };
}
