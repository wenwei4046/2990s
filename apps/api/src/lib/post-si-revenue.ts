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
