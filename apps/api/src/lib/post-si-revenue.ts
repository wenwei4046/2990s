// ----------------------------------------------------------------------------
// post-si-revenue — idempotent Sales Invoice → General Ledger posting.
//
// Confirming / creating a Sales Invoice records revenue: it writes a balanced
// journal entry Dr 1100 (Accounts Receivable) / Cr 4000 (Sales Revenue) for the
// invoice total into journal_entries + journal_entry_lines, then marks it
// posted.
//
// IDEMPOTENT: keyed on (source_type='SI', source_doc_no=invoice_number). If a
// JE for that invoice already exists, this is a no-op that reports the existing
// JE — it never double-posts. This is the single source of truth shared by:
//   • POST /accounting/post/si/:invoiceNumber  (manual / explicit re-post)
//   • POST /sales-invoices                     (auto-post on create/confirm)
// ----------------------------------------------------------------------------

const padMmDd = (d: Date): string => {
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const yy = String(d.getFullYear()).slice(-2);
  return `${yy}${m}`;
};

const nextJeNo = async (sb: any, date: Date): Promise<string> => {
  const prefix = `JE-${padMmDd(date)}`;
  const { data } = await sb
    .from('journal_entries')
    .select('je_no')
    .like('je_no', `${prefix}-%`)
    .order('je_no', { ascending: false })
    .limit(1);
  const last = data?.[0]?.je_no ?? null;
  const lastN = last ? parseInt(String(last).split('-').pop() ?? '0', 10) : 0;
  return `${prefix}-${String(lastN + 1).padStart(4, '0')}`;
};

export type PostSiResult =
  | { ok: true; status: 'posted'; jeNo: string; jeId: string; totalSen: number }
  | { ok: true; status: 'already_posted'; jeNo: string; jeId: string }
  | { ok: false; status: 'invoice_not_found' | 'zero_total' | 'je_insert_failed' | 'lines_insert_failed' | 'post_failed'; reason?: string };

/**
 * Post (or no-op if already posted) the GL entry for a Sales Invoice.
 * Returns a structured result; never throws on the expected failure paths.
 */
export async function postSiRevenue(sb: any, invoiceNumber: string): Promise<PostSiResult> {
  // ── Idempotency guard — has this SI already been posted? ──
  const { data: existing } = await sb
    .from('journal_entries')
    .select('id, je_no')
    .eq('source_type', 'SI')
    .eq('source_doc_no', invoiceNumber)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: true, status: 'already_posted', jeNo: existing[0].je_no, jeId: existing[0].id };
  }

  const { data: si, error } = await sb
    .from('sales_invoices')
    .select('invoice_number, invoice_date, debtor_code, debtor_name, total_centi')
    .eq('invoice_number', invoiceNumber)
    .single();
  if (error || !si) return { ok: false, status: 'invoice_not_found' };

  const totalSen = Number(si.total_centi);
  if (totalSen <= 0) return { ok: false, status: 'zero_total' };

  const lines = [
    {
      accountCode: '1100',                                   // Accounts Receivable
      debitSen: totalSen,
      creditSen: 0,
      partyType: 'CUSTOMER',
      partyCode: si.debtor_code,
      partyName: si.debtor_name,
      notes: `AR for ${si.invoice_number}`,
    },
    {
      accountCode: '4000',                                   // Sales Revenue
      debitSen: 0,
      creditSen: totalSen,
      partyType: null,
      partyCode: null,
      partyName: null,
      notes: `Revenue from ${si.invoice_number}`,
    },
  ];

  const jeNo = await nextJeNo(sb, new Date(si.invoice_date));
  const { data: je, error: jeErr } = await sb
    .from('journal_entries')
    .insert({
      je_no: jeNo,
      entry_date: si.invoice_date,
      source_type: 'SI',
      source_doc_no: si.invoice_number,
      narration: `Sales invoice ${si.invoice_number} — ${si.debtor_name}`,
      total_debit_sen: totalSen,
      total_credit_sen: totalSen,
    })
    .select('*')
    .single();
  if (jeErr) return { ok: false, status: 'je_insert_failed', reason: jeErr.message };

  const lineRows = lines.map((l, i) => ({
    journal_entry_id: je.id,
    line_no: i + 1,
    account_code: l.accountCode,
    debit_sen: l.debitSen ?? 0,
    credit_sen: l.creditSen ?? 0,
    party_type: l.partyType ?? null,
    party_code: l.partyCode ?? null,
    party_name: l.partyName ?? null,
    notes: l.notes ?? null,
  }));
  const { error: linesErr } = await sb.from('journal_entry_lines').insert(lineRows);
  if (linesErr) {
    await sb.from('journal_entries').delete().eq('id', je.id);
    return { ok: false, status: 'lines_insert_failed', reason: linesErr.message };
  }

  const { error: postErr } = await sb
    .from('journal_entries')
    .update({ posted: true })
    .eq('id', je.id);
  if (postErr) return { ok: false, status: 'post_failed', reason: postErr.message };

  return { ok: true, status: 'posted', jeNo: je.je_no, jeId: je.id, totalSen };
}

export type ReverseSiResult =
  | { ok: true; status: 'reversed'; jeNo: string; jeId: string }
  | { ok: true; status: 'already_reversed' | 'nothing_to_reverse' }
  | { ok: false; status: 'reversal_insert_failed' | 'reversal_lines_failed'; reason?: string };

/**
 * Reverse (void) the revenue JE for a Sales Invoice when it is CANCELLED.
 *
 * Writes a MIRROR journal entry — Dr 4000 (Sales Revenue) / Cr 1100 (Accounts
 * Receivable) for the same total — that nets the original to zero, then flags
 * the original `reversed = true` + `reversed_by_je`. The trial-balance /
 * account-balance views (migration 0052) only count `posted = TRUE AND
 * reversed = FALSE`, so once flagged the original revenue no longer counts and
 * the reversing entry exactly cancels it — net GL impact zero.
 *
 * IDEMPOTENT: keyed on the original JE's `reversed` flag AND on the existence
 * of a reversing JE (source_type='SI_REVERSAL', source_doc_no=invoice_number).
 * Re-cancelling, retries, or a second status PATCH all no-op.
 */
export async function reverseSiRevenue(sb: any, invoiceNumber: string): Promise<ReverseSiResult> {
  // Find the original posted SI revenue JE. Nothing posted → nothing to reverse.
  const { data: origRows } = await sb
    .from('journal_entries')
    .select('id, je_no, entry_date, reversed, total_debit_sen, total_credit_sen, narration')
    .eq('source_type', 'SI')
    .eq('source_doc_no', invoiceNumber)
    .limit(1);
  const orig = origRows?.[0] as
    | { id: string; je_no: string; entry_date: string; reversed: boolean; total_debit_sen: number; total_credit_sen: number; narration: string | null }
    | undefined;
  if (!orig) return { ok: true, status: 'nothing_to_reverse' };

  // Idempotency guard #1 — the original is already flagged reversed.
  if (orig.reversed) return { ok: true, status: 'already_reversed' };

  // Idempotency guard #2 — a reversing JE already exists for this invoice.
  const { data: revExisting } = await sb
    .from('journal_entries')
    .select('id, je_no')
    .eq('source_type', 'SI_REVERSAL')
    .eq('source_doc_no', invoiceNumber)
    .limit(1);
  if (revExisting && revExisting.length > 0) {
    // The reversing JE exists but the flag never got set — make the flag stick.
    await sb.from('journal_entries').update({ reversed: true, reversed_by_je: revExisting[0].id }).eq('id', orig.id);
    return { ok: true, status: 'already_reversed' };
  }

  const totalSen = Number(orig.total_debit_sen ?? orig.total_credit_sen ?? 0);
  if (totalSen <= 0) {
    // Nothing of value to reverse — just flag it so re-cancels no-op.
    await sb.from('journal_entries').update({ reversed: true }).eq('id', orig.id);
    return { ok: true, status: 'reversed', jeNo: orig.je_no, jeId: orig.id };
  }

  // Load the original lines so the reversal mirrors the SAME accounts + parties,
  // just with debit/credit swapped (a faithful contra entry).
  const { data: origLines } = await sb
    .from('journal_entry_lines')
    .select('account_code, debit_sen, credit_sen, party_type, party_code, party_name, notes')
    .eq('journal_entry_id', orig.id)
    .order('line_no');
  const oLines = (origLines ?? []) as Array<{
    account_code: string; debit_sen: number; credit_sen: number;
    party_type: string | null; party_code: string | null; party_name: string | null; notes: string | null;
  }>;

  const revJeNo = await nextJeNo(sb, new Date(orig.entry_date));
  const { data: revJe, error: revErr } = await sb
    .from('journal_entries')
    .insert({
      je_no: revJeNo,
      entry_date: new Date().toISOString().slice(0, 10),
      source_type: 'SI_REVERSAL',
      source_doc_no: invoiceNumber,
      narration: `Reversal of ${orig.je_no} — Sales invoice ${invoiceNumber} cancelled`,
      total_debit_sen: totalSen,
      total_credit_sen: totalSen,
      reversed_by_je: orig.id,
    })
    .select('*')
    .single();
  if (revErr) return { ok: false, status: 'reversal_insert_failed', reason: revErr.message };

  // Swap each original line's debit/credit so the reversal nets the original to
  // zero. Fall back to the canonical 2-line entry if the original had no lines.
  const swapped = oLines.length > 0
    ? oLines.map((l, i) => ({
        journal_entry_id: revJe.id,
        line_no: i + 1,
        account_code: l.account_code,
        debit_sen: Number(l.credit_sen ?? 0),
        credit_sen: Number(l.debit_sen ?? 0),
        party_type: l.party_type ?? null,
        party_code: l.party_code ?? null,
        party_name: l.party_name ?? null,
        notes: `Reversal — ${l.notes ?? ''}`.trim(),
      }))
    : [
        { journal_entry_id: revJe.id, line_no: 1, account_code: '4000', debit_sen: totalSen, credit_sen: 0, party_type: null, party_code: null, party_name: null, notes: `Reverse revenue ${invoiceNumber}` },
        { journal_entry_id: revJe.id, line_no: 2, account_code: '1100', debit_sen: 0, credit_sen: totalSen, party_type: null, party_code: null, party_name: null, notes: `Reverse AR ${invoiceNumber}` },
      ];
  const { error: linesErr } = await sb.from('journal_entry_lines').insert(swapped);
  if (linesErr) {
    await sb.from('journal_entries').delete().eq('id', revJe.id);
    return { ok: false, status: 'reversal_lines_failed', reason: linesErr.message };
  }

  // Post the reversal + flag the original. Order matters: if the flag update
  // fails the reversing JE still exists, so guard #2 makes a retry idempotent.
  await sb.from('journal_entries').update({ posted: true }).eq('id', revJe.id);
  await sb.from('journal_entries').update({ reversed: true, reversed_by_je: revJe.id }).eq('id', orig.id);

  return { ok: true, status: 'reversed', jeNo: revJe.je_no, jeId: revJe.id };
}
