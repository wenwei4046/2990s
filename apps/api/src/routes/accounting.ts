// ----------------------------------------------------------------------------
// /accounting — simple double-entry accounting layer (PR #36).
//
// Endpoints:
//   GET    /accounts                  — chart of accounts
//   GET    /journal-entries           — list (filter by date range / source)
//   GET    /journal-entries/:id       — one JE w/ lines
//   POST   /journal-entries           — create draft JE (lines included)
//   POST   /journal-entries/:id/post  — mark posted (trigger checks balance)
//   POST   /post/si/:invoiceNumber    — auto-post a SI: Dr AR, Cr Revenue
//   POST   /post/pi/:invoiceNumber    — auto-post a PI: Dr Inventory, Cr AP
//   GET    /gl                        — flat GL stream (v_gl_entries)
//   GET    /balances                  — running account balances (v_account_balances)
//   GET    /ar-aging                  — v_ar_aging
//   GET    /ap-aging                  — v_ap_aging
//
// Note: this is intentionally minimal — single legal entity, single currency.
// ERPNext-style chart hierarchy + cost centres are deferred.
// ----------------------------------------------------------------------------

import { Hono } from 'hono';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const accounting = new Hono<{ Bindings: Env; Variables: Variables }>();
accounting.use('*', supabaseAuth);

/* ════════════════════════════════════════════════════════════════════════
   Helpers
   ════════════════════════════════════════════════════════════════════════ */

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

type JeLineIn = {
  accountCode: string;
  debitSen?: number;
  creditSen?: number;
  partyType?: string | null;
  partyCode?: string | null;
  partyName?: string | null;
  notes?: string | null;
};

/* ════════════════════════════════════════════════════════════════════════
   Chart of Accounts
   ════════════════════════════════════════════════════════════════════════ */

accounting.get('/accounts', async (c) => {
  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('accounts')
    .select('account_code, account_name, account_type, parent_code, is_active')
    .order('account_code');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ accounts: data ?? [] });
});

/* ════════════════════════════════════════════════════════════════════════
   Journal Entries
   ════════════════════════════════════════════════════════════════════════ */

accounting.get('/journal-entries', async (c) => {
  const sb = c.get('supabase');
  const sourceType = c.req.query('sourceType');
  const sourceDocNo = c.req.query('sourceDocNo');
  const from = c.req.query('from');
  const to = c.req.query('to');
  const posted = c.req.query('posted');

  let q = sb.from('journal_entries')
    .select('id, je_no, entry_date, source_type, source_doc_no, narration, total_debit_sen, total_credit_sen, posted, posted_at, reversed, created_at')
    .order('entry_date', { ascending: false })
    .order('je_no', { ascending: false });

  if (sourceType)  q = q.eq('source_type', sourceType);
  if (sourceDocNo) q = q.eq('source_doc_no', sourceDocNo);
  if (from)        q = q.gte('entry_date', from);
  if (to)          q = q.lte('entry_date', to);
  if (posted === 'true')  q = q.eq('posted', true);
  if (posted === 'false') q = q.eq('posted', false);

  const { data, error } = await q.limit(500);
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ journalEntries: data ?? [] });
});

accounting.get('/journal-entries/:id', async (c) => {
  const id = c.req.param('id');
  const sb = c.get('supabase');
  const { data: je, error: e1 } = await sb
    .from('journal_entries')
    .select('*')
    .eq('id', id)
    .single();
  if (e1) return c.json({ error: 'not_found', reason: e1.message }, 404);
  const { data: lines, error: e2 } = await sb
    .from('journal_entry_lines')
    .select('*')
    .eq('journal_entry_id', id)
    .order('line_no');
  if (e2) return c.json({ error: 'load_failed', reason: e2.message }, 500);
  return c.json({ journalEntry: je, lines: lines ?? [] });
});

accounting.post('/journal-entries', async (c) => {
  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: 'invalid_json' }, 400); }

  const entryDate = body.entryDate ?? new Date().toISOString().slice(0, 10);
  const sourceType = String(body.sourceType ?? 'MANUAL');
  const sourceDocNo = body.sourceDocNo ?? null;
  const narration = body.narration ?? null;
  const lines = Array.isArray(body.lines) ? (body.lines as JeLineIn[]) : [];
  if (lines.length < 2) return c.json({ error: 'min_2_lines' }, 400);

  let dr = 0, cr = 0;
  for (const l of lines) {
    dr += Number(l.debitSen ?? 0);
    cr += Number(l.creditSen ?? 0);
  }
  if (dr !== cr) return c.json({ error: 'unbalanced', debit: dr, credit: cr }, 400);
  if (dr === 0) return c.json({ error: 'zero_amount' }, 400);

  const sb = c.get('supabase');
  const jeNo = await nextJeNo(sb, new Date(entryDate));

  const { data: je, error: jeErr } = await sb
    .from('journal_entries')
    .insert({
      je_no: jeNo,
      entry_date: entryDate,
      source_type: sourceType,
      source_doc_no: sourceDocNo,
      narration,
      total_debit_sen: dr,
      total_credit_sen: cr,
    })
    .select('*')
    .single();
  if (jeErr) return c.json({ error: 'insert_failed', reason: jeErr.message }, 500);

  const lineRows = lines.map((l, i) => ({
    journal_entry_id: je.id,
    line_no: i + 1,
    account_code: l.accountCode,
    debit_sen: Number(l.debitSen ?? 0),
    credit_sen: Number(l.creditSen ?? 0),
    party_type: l.partyType ?? null,
    party_code: l.partyCode ?? null,
    party_name: l.partyName ?? null,
    notes: l.notes ?? null,
  }));
  const { error: linesErr } = await sb.from('journal_entry_lines').insert(lineRows);
  if (linesErr) {
    await sb.from('journal_entries').delete().eq('id', je.id);
    return c.json({ error: 'lines_insert_failed', reason: linesErr.message }, 500);
  }
  return c.json({ journalEntry: je, lineCount: lineRows.length }, 201);
});

accounting.post('/journal-entries/:id/post', async (c) => {
  const id = c.req.param('id');
  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('journal_entries')
    .update({ posted: true })
    .eq('id', id)
    .select('*')
    .single();
  if (error) {
    // The trigger throws if unbalanced — pass through as 400
    if (String(error.message).includes('not balanced')) {
      return c.json({ error: 'unbalanced', reason: error.message }, 400);
    }
    return c.json({ error: 'post_failed', reason: error.message }, 500);
  }
  return c.json({ journalEntry: data });
});

/* ════════════════════════════════════════════════════════════════════════
   Auto-post helpers — SI / PI confirm
   ════════════════════════════════════════════════════════════════════════ */

accounting.post('/post/si/:invoiceNumber', async (c) => {
  const invoiceNumber = c.req.param('invoiceNumber');
  const sb = c.get('supabase');

  // Avoid duplicate posting
  const { data: existing } = await sb
    .from('journal_entries')
    .select('id, je_no')
    .eq('source_type', 'SI')
    .eq('source_doc_no', invoiceNumber)
    .limit(1);
  if (existing && existing.length > 0) {
    return c.json({ error: 'already_posted', existingJe: existing[0] }, 409);
  }

  const { data: si, error } = await sb
    .from('sales_invoices')
    .select('invoice_number, invoice_date, debtor_code, debtor_name, total_centi, discount_centi, tax_centi, subtotal_centi')
    .eq('invoice_number', invoiceNumber)
    .single();
  if (error || !si) return c.json({ error: 'invoice_not_found' }, 404);

  const totalSen = Number(si.total_centi);
  if (totalSen <= 0) return c.json({ error: 'zero_total' }, 400);

  const lines: JeLineIn[] = [
    {
      accountCode: '1100',                                   // Accounts Receivable
      debitSen: totalSen,
      partyType: 'CUSTOMER',
      partyCode: si.debtor_code,
      partyName: si.debtor_name,
      notes: `AR for ${si.invoice_number}`,
    },
    {
      accountCode: '4000',                                   // Sales Revenue
      creditSen: totalSen,
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
  if (jeErr) return c.json({ error: 'je_insert_failed', reason: jeErr.message }, 500);

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
    return c.json({ error: 'lines_insert_failed', reason: linesErr.message }, 500);
  }

  const { error: postErr } = await sb
    .from('journal_entries')
    .update({ posted: true })
    .eq('id', je.id);
  if (postErr) return c.json({ error: 'post_failed', reason: postErr.message }, 500);

  return c.json({ ok: true, jeNo: je.je_no, jeId: je.id, totalSen });
});

accounting.post('/post/pi/:invoiceNumber', async (c) => {
  const invoiceNumber = c.req.param('invoiceNumber');
  const sb = c.get('supabase');

  const { data: existing } = await sb
    .from('journal_entries')
    .select('id, je_no')
    .eq('source_type', 'PI')
    .eq('source_doc_no', invoiceNumber)
    .limit(1);
  if (existing && existing.length > 0) {
    return c.json({ error: 'already_posted', existingJe: existing[0] }, 409);
  }

  const { data: piRaw, error } = await sb
    .from('purchase_invoices')
    .select('id, invoice_number, invoice_date, supplier_id, total_centi, suppliers(code, name)')
    .eq('invoice_number', invoiceNumber)
    .single();
  if (error || !piRaw) return c.json({ error: 'invoice_not_found' }, 404);
  // Cast through `unknown` — Supabase JS without generated types returns
  // `GenericStringError` from `.select(string).single()` even when data is
  // populated. Project-wide pattern; see routes/admin.ts L97.
  const pi = piRaw as unknown as {
    id: string;
    invoice_number: string;
    invoice_date: string;
    supplier_id: string | null;
    total_centi: number;
    suppliers: { code: string | null; name: string | null } | null;
  };

  const totalSen = Number(pi.total_centi);
  if (totalSen <= 0) return c.json({ error: 'zero_total' }, 400);

  const supplier = pi.suppliers ?? { code: null, name: null };
  const lines: JeLineIn[] = [
    {
      accountCode: '1200',                                   // Inventory (simplification: all PI → Inventory)
      debitSen: totalSen,
      notes: `Inventory from ${pi.invoice_number}`,
    },
    {
      accountCode: '2000',                                   // Accounts Payable
      creditSen: totalSen,
      partyType: 'SUPPLIER',
      partyCode: supplier.code ?? null,
      partyName: supplier.name ?? null,
      notes: `AP for ${pi.invoice_number}`,
    },
  ];

  const jeNo = await nextJeNo(sb, new Date(pi.invoice_date));
  const { data: je, error: jeErr } = await sb
    .from('journal_entries')
    .insert({
      je_no: jeNo,
      entry_date: pi.invoice_date,
      source_type: 'PI',
      source_doc_no: pi.invoice_number,
      narration: `Purchase invoice ${pi.invoice_number} — ${supplier.name ?? ''}`,
      total_debit_sen: totalSen,
      total_credit_sen: totalSen,
    })
    .select('*')
    .single();
  if (jeErr) return c.json({ error: 'je_insert_failed', reason: jeErr.message }, 500);

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
    return c.json({ error: 'lines_insert_failed', reason: linesErr.message }, 500);
  }

  const { error: postErr } = await sb
    .from('journal_entries')
    .update({ posted: true })
    .eq('id', je.id);
  if (postErr) return c.json({ error: 'post_failed', reason: postErr.message }, 500);

  return c.json({ ok: true, jeNo: je.je_no, jeId: je.id, totalSen });
});

/* ════════════════════════════════════════════════════════════════════════
   GL stream + balances + aging
   ════════════════════════════════════════════════════════════════════════ */

accounting.get('/gl', async (c) => {
  const sb = c.get('supabase');
  const accountCode = c.req.query('accountCode');
  const from = c.req.query('from');
  const to = c.req.query('to');

  let q = sb.from('v_gl_entries').select('*').limit(1000);
  if (accountCode) q = q.eq('account_code', accountCode);
  if (from)        q = q.gte('entry_date', from);
  if (to)          q = q.lte('entry_date', to);

  const { data, error } = await q;
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ glEntries: data ?? [] });
});

accounting.get('/balances', async (c) => {
  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('v_account_balances')
    .select('*');
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ balances: data ?? [] });
});

accounting.get('/ar-aging', async (c) => {
  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('v_ar_aging')
    .select('*')
    .order('days_overdue', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ arAging: data ?? [] });
});

accounting.get('/ap-aging', async (c) => {
  const sb = c.get('supabase');
  const { data, error } = await sb
    .from('v_ap_aging')
    .select('*')
    .order('days_overdue', { ascending: false });
  if (error) return c.json({ error: 'load_failed', reason: error.message }, 500);
  return c.json({ apAging: data ?? [] });
});
