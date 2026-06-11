// ---------------------------------------------------------------------------
// /scan-so — Claude-powered OCR for HANDWRITTEN showroom sale-order slips
// (phone photos of Zanotti / AKEMI-style carbon-copy forms) → structured JSON
// the Backend "Scan Order" modal turns into a prefilled New SO.
//
// Ported from HOOKKA's scan-po.ts (typed customer-PO PDFs) and adapted:
//   • input is image(s) (jpeg/png/webp) or a PDF, not PDF-only;
//   • catalog injection pulls live from Supabase Postgres (mfg_products,
//     fabric_trackings, maintenance config sofa sizes/leg heights);
//   • few-shot pool = the 5 most recent operator-CONFIRMED so_scan_samples
//     rows (no gold marking / per-customer distill in v1).
//
// Endpoints:
//   POST /scan-so/extract              — multipart image(s)/pdf → JSON + sampleId
//   POST /scan-so/samples/:id/confirm  — store operator-corrected JSON
//
// Setup:
//   npx wrangler secret put ANTHROPIC_API_KEY
//
// Prompt caching: the SYSTEM_PROMPT + catalog block is sent as a
// cache_control:ephemeral prefix — identical across calls until the catalog
// changes, so repeat scans within 5 min get the ~90% cached-input discount.
//
// Auth: same as mfg-sales-orders write routes — supabaseAuth on every
// endpoint (any signed-in staff member; RLS scopes what the user client can
// read). Sample rows are written via the service-role client so extraction
// works even before migration 0164's RLS policy lands.
// ---------------------------------------------------------------------------

import { Hono } from 'hono';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';

export const scanSo = new Hono<{ Bindings: Env; Variables: Variables }>();
scanSo.use('*', supabaseAuth);

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const CLAUDE_MODEL = 'claude-sonnet-4-6';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

const IMAGE_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// ArrayBuffer -> base64. Workers don't expose Node's Buffer; the chunked loop
// keeps stack usage bounded for large files. (Ported from HOOKKA scan-po.)
function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return btoa(binary);
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

// JSON-coercion recovery (ported verbatim from HOOKKA scan-po.ts) — Claude
// sometimes wraps the result in fences, sometimes adds a "Looking at the
// image…" preamble, sometimes both. Parse a best-effort substring rather
// than fail the whole extraction.
function stripJsonFences(text: string): string {
  let trimmed = text.trim();

  // 1) ```json … ``` or ``` … ```
  const fenceRe = /^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/;
  const fenceMatch = trimmed.match(fenceRe);
  if (fenceMatch?.[1]) trimmed = fenceMatch[1].trim();

  // 2) Strip any chain-of-thought preamble. The valid payload always starts
  //    with `{` — take from the first `{` to the last `}`.
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace > 0 && lastBrace > firstBrace) {
    trimmed = trimmed.slice(firstBrace, lastBrace + 1).trim();
  }

  return trimmed;
}

// ===========================================================================
// Catalog — pulled live from Supabase on every /extract call.
// ===========================================================================
type CatalogSku = {
  code: string;
  name: string;
  category: string;       // SOFA | BEDFRAME | MATTRESS | ACCESSORY | SERVICE
  baseModel: string | null;
};
type CatalogFabric = { code: string; description: string | null };
type Catalog = {
  skus: CatalogSku[];
  fabrics: CatalogFabric[];
  sofaSizes: string[];
  sofaLegHeights: string[];
};

// MaintenanceConfig option entries are either plain strings or
// { value, priceSen? } objects — accept both (mirrors @2990s/shared
// mfg-pricing MfgPricedOption).
function optionValues(arr: unknown): string[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((x) => {
      if (typeof x === 'string') return x;
      if (x && typeof x === 'object' && 'value' in x) {
        const v = (x as { value?: unknown }).value;
        return typeof v === 'string' ? v : '';
      }
      return '';
    })
    .filter(Boolean);
}

async function loadCatalog(sb: SupabaseClient): Promise<Catalog> {
  const [prodRes, fabRes, cfgRes] = await Promise.all([
    sb
      .from('mfg_products')
      .select('code, name, category, base_model')
      .eq('status', 'ACTIVE')
      .order('category')
      .order('code')
      .limit(5000),
    sb
      .from('fabric_trackings')
      .select('fabric_code, fabric_description')
      .order('fabric_code')
      .limit(5000),
    sb
      .from('maintenance_config_history')
      .select('config')
      .eq('scope', 'master')
      .order('effective_from', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);

  const skus: CatalogSku[] = ((prodRes.data as Array<{
    code: string; name: string; category: string; base_model: string | null;
  }> | null) ?? []).map((p) => ({
    code: p.code,
    name: p.name,
    category: p.category,
    baseModel: p.base_model ?? null,
  }));

  const fabrics: CatalogFabric[] = ((fabRes.data as Array<{
    fabric_code: string; fabric_description: string | null;
  }> | null) ?? []).map((f) => ({
    code: f.fabric_code,
    description: f.fabric_description ?? null,
  }));

  let sofaSizes: string[] = [];
  let sofaLegHeights: string[] = [];
  const cfg = (cfgRes.data as { config?: Record<string, unknown> } | null)?.config;
  if (cfg && typeof cfg === 'object') {
    sofaSizes = Array.isArray(cfg.sofaSizes)
      ? (cfg.sofaSizes as unknown[]).filter((x): x is string => typeof x === 'string')
      : [];
    sofaLegHeights = optionValues(cfg.sofaLegHeights);
  }

  return { skus, fabrics, sofaSizes, sofaLegHeights };
}

function formatCatalog(c: Catalog): string {
  const lines: string[] = [];
  const byCategory = new Map<string, CatalogSku[]>();
  for (const s of c.skus) {
    const list = byCategory.get(s.category) ?? [];
    list.push(s);
    byCategory.set(s.category, list);
  }
  // SERVICE gets its own labelled section (delivery / lift / dispose fees),
  // the goods categories follow.
  for (const cat of ['SOFA', 'BEDFRAME', 'MATTRESS', 'ACCESSORY', 'SERVICE']) {
    const list = byCategory.get(cat);
    if (!list || list.length === 0) continue;
    lines.push(`=== ${cat} SKUS (code | name | base model) ===`);
    for (const s of list) {
      lines.push(`${s.code} | ${s.name}${s.baseModel ? ` | ${s.baseModel}` : ''}`);
    }
    lines.push('');
  }

  lines.push('=== FABRICS (code | description) ===');
  for (const f of c.fabrics) lines.push(`${f.code} | ${f.description ?? ''}`);
  lines.push('');

  lines.push('=== SOFA SIZES (seat sizes) ===');
  lines.push(c.sofaSizes.join(', ') || '—');
  lines.push('');
  lines.push('=== SOFA LEG HEIGHTS ===');
  lines.push(c.sofaLegHeights.join(', ') || '—');

  return lines.join('\n');
}

// ===========================================================================
// Prompt
// ===========================================================================
const SYSTEM_PROMPT = `You extract structured data from photos of HANDWRITTEN showroom sale-order slips at 2990's Home, a Malaysian furniture retailer. The slips are carbon-copy order forms (Zanotti / AKEMI style): a printed header block (customer name, contact, address, delivery date) filled in by hand, a handwritten line-item table (description, qty, price), and a footer with totals, deposit, payment method, and the salesperson's name.

The handwriting is often rushed, slanted, abbreviated, and mixed-case. Phone photos may be skewed, shadowed, or low-contrast. Read carefully; prefer extracting a raw transcription over guessing.

A reference CATALOG follows this prompt (live product SKUs, fabrics, sofa sizes, leg heights). Use it for fuzzy matching.

EXTRACTION RULES
================
1. customerName — the customer's name from the header block (NOT the salesperson).
2. address — full delivery address as one string, exactly as written (keep unit numbers, taman names, postcode, state).
3. phones — ALL phone numbers on the slip, as raw strings exactly as written (e.g. "012-345 6789", "+6017 888 9999"). Multiple numbers are common (customer + spouse). Do NOT normalize or reformat.
4. location — the showroom / venue / branch the order was taken at, if written (often a header checkbox or stamp).
5. deliveryDate — as written. If it is a real date, convert to YYYY-MM-DD (slips write DD/MM or DD/MM/YYYY — Malaysian day-first). If it says "TBC", "call first", "after CNY" or any non-date text, return that text verbatim.
6. processingDate — the order/slip date if present, YYYY-MM-DD when parseable, else verbatim text, else null.
7. salesRep — the salesperson's name from the footer/header.
8. paymentMethod — as written ("cash", "TNG", "bank transfer", "CC", deposit slips etc.). null if absent.
9. depositRm / totalRm — RM amounts as NUMBERS (e.g. "RM 1,500" → 1500, "550.50" → 550.5). null when blank.
10. remarks — any handwritten notes that are not line items (delivery instructions, "lift access", "self collect", floor info…), one string.

LINE ITEMS
==========
For EVERY handwritten row in the item table output one lines[] entry:
- rawText — the row's text VERBATIM, exactly as written, including misspellings and abbreviations. This is the source of truth for the operator; never clean it up.
- qtyGuess — quantity (default 1 when blank or unreadable).
- priceRmGuess — the row's unit price in RM as a number; null when blank. If only a line total is written and qty > 1, still report the written figure and say so in notes.
- skuMatch — your best FUZZY match against the catalog SKUS:
    { "code": <exact catalog code>, "confidence": 0-1, "reason": <short why> }
  Handwriting mangles model names — match tolerantly:
    • misspellings: "Ultimatee" / "Ultmate" → the ULTIMATE model's SKU.
    • partial names: "Hilton K" → the HILTON bedframe King-size SKU.
    • base-model + size: a written size (King/Queen/K/Q/6FT/5FT) picks the size variant within the base model.
  Rules:
    • The code MUST be copied character-for-character from the catalog. NEVER invent, modify, or extrapolate a code that is not in the catalog.
    • When you cannot find a defensible match, skuMatch = null and let rawText speak. A null with good rawText is worth more than a wrong code.
    • confidence: 0.9+ only when the written text clearly identifies one specific catalog row; 0.5-0.8 when the model matches but the size/variant is ambiguous; below 0.5 prefer null.
- fabricMatch — same idea against the FABRICS catalog when the row (or a margin note) names a fabric/colour code; null otherwise. Same never-invent rule.
- notes — anything else on the row the operator should see (free gifts, "FOC", sizes that don't match the catalog, unreadable words flagged as "[illegible]").

Delivery fees, disposal fees and lift/stair-carry charges written as rows ARE line items — match them against the SERVICE SKUS section.

OUTPUT
======
Return STRICT JSON, no markdown fences, no prose:
{
  "customerName": string | null,
  "address": string | null,
  "phones": string[],
  "location": string | null,
  "deliveryDate": string | null,
  "processingDate": string | null,
  "salesRep": string | null,
  "paymentMethod": string | null,
  "depositRm": number | null,
  "totalRm": number | null,
  "remarks": string | null,
  "lines": [{
    "rawText": string,
    "qtyGuess": number,
    "priceRmGuess": number | null,
    "skuMatch": { "code": string, "confidence": number, "reason": string } | null,
    "fabricMatch": { "code": string, "confidence": number, "reason": string } | null,
    "notes": string | null
  }]
}`;

// ===========================================================================
// Types
// ===========================================================================
type SkuMatch = { code: string; confidence: number; reason: string };
type ExtractedLine = {
  rawText: string;
  qtyGuess: number;
  priceRmGuess: number | null;
  skuMatch: SkuMatch | null;
  fabricMatch: SkuMatch | null;
  notes: string | null;
};
type ExtractedSlip = {
  customerName: string | null;
  address: string | null;
  phones: string[];
  location: string | null;
  deliveryDate: string | null;
  processingDate: string | null;
  salesRep: string | null;
  paymentMethod: string | null;
  depositRm: number | null;
  totalRm: number | null;
  remarks: string | null;
  lines: ExtractedLine[];
};

type AnthropicResponse = {
  content?: Array<{ type: string; text?: string }>;
  error?: { type: string; message: string };
  usage?: { cache_creation_input_tokens?: number; cache_read_input_tokens?: number };
};

type Warning = { field: string; value: string; message: string; lineIdx?: number };

// Defensive normalisation — Claude occasionally omits fields or returns the
// wrong primitive type. Coerce into the ExtractedSlip shape so the frontend
// never sees undefined where it expects an array.
function normalizeSlip(raw: unknown): ExtractedSlip {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown): string | null =>
    typeof v === 'string' && v.trim() !== '' ? v : null;
  const num = (v: unknown): number | null =>
    typeof v === 'number' && Number.isFinite(v) ? v : null;
  const match = (v: unknown): SkuMatch | null => {
    if (!v || typeof v !== 'object') return null;
    const m = v as Record<string, unknown>;
    if (typeof m.code !== 'string' || m.code.trim() === '') return null;
    return {
      code: m.code,
      confidence: typeof m.confidence === 'number' ? Math.max(0, Math.min(1, m.confidence)) : 0,
      reason: typeof m.reason === 'string' ? m.reason : '',
    };
  };
  const lines: ExtractedLine[] = Array.isArray(r.lines)
    ? (r.lines as unknown[]).map((l) => {
        const li = (l && typeof l === 'object' ? l : {}) as Record<string, unknown>;
        return {
          rawText: typeof li.rawText === 'string' ? li.rawText : '',
          qtyGuess:
            typeof li.qtyGuess === 'number' && Number.isFinite(li.qtyGuess) && li.qtyGuess > 0
              ? li.qtyGuess
              : 1,
          priceRmGuess: num(li.priceRmGuess),
          skuMatch: match(li.skuMatch),
          fabricMatch: match(li.fabricMatch),
          notes: str(li.notes),
        };
      })
    : [];
  return {
    customerName: str(r.customerName),
    address: str(r.address),
    phones: Array.isArray(r.phones)
      ? (r.phones as unknown[]).filter((p): p is string => typeof p === 'string' && p.trim() !== '')
      : [],
    location: str(r.location),
    deliveryDate: str(r.deliveryDate),
    processingDate: str(r.processingDate),
    salesRep: str(r.salesRep),
    paymentMethod: str(r.paymentMethod),
    depositRm: num(r.depositRm),
    totalRm: num(r.totalRm),
    remarks: str(r.remarks),
    lines,
  };
}

// Catalog-bound validation: a skuMatch/fabricMatch whose code is NOT in the
// live catalog is cleared to null (never-invent rule, enforced server-side —
// same belt-and-braces as HOOKKA's validateAndEnrichPO). Case-insensitive
// snap to the canonical catalog casing on hit.
function validateSlip(slip: ExtractedSlip, catalog: Catalog): Warning[] {
  const warnings: Warning[] = [];
  const skuCanon = new Map(catalog.skus.map((s) => [s.code.toUpperCase(), s.code]));
  const fabricCanon = new Map(catalog.fabrics.map((f) => [f.code.toUpperCase(), f.code]));

  slip.lines.forEach((line, i) => {
    if (line.skuMatch) {
      const canon = skuCanon.get(line.skuMatch.code.toUpperCase());
      if (canon) {
        line.skuMatch.code = canon;
      } else {
        warnings.push({
          field: 'skuMatch',
          value: line.skuMatch.code,
          message: `Line ${i + 1}: suggested SKU not in catalog — cleared; pick manually.`,
          lineIdx: i,
        });
        line.skuMatch = null;
      }
    }
    if (line.fabricMatch) {
      const canon = fabricCanon.get(line.fabricMatch.code.toUpperCase());
      if (canon) {
        line.fabricMatch.code = canon;
      } else {
        warnings.push({
          field: 'fabricMatch',
          value: line.fabricMatch.code,
          message: `Line ${i + 1}: suggested fabric not in catalog — cleared.`,
          lineIdx: i,
        });
        line.fabricMatch = null;
      }
    }
  });
  return warnings;
}

// Service-role client — sample-row reads/writes bypass RLS so extraction
// works regardless of policy state (same pattern as mfg-sales-orders.ts's
// admin client). Auth is already enforced by supabaseAuth on the router.
function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function isMissingTable(err: { code?: string; message?: string } | null): boolean {
  return err?.code === '42P01' || /so_scan_samples.*does not exist|relation .* does not exist/i.test(err?.message ?? '');
}

const TABLE_MISSING_MSG =
  'so_scan_samples table missing — apply packages/db/migrations/0164_so_scan_samples.sql to this database.';

// ===========================================================================
// POST /scan-so/extract
// ===========================================================================
scanSo.post('/extract', async (c) => {
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return c.json(
      { error: 'anthropic_key_missing', reason: 'Run: npx wrangler secret put ANTHROPIC_API_KEY' },
      503,
    );
  }

  let formData: FormData;
  try {
    formData = await c.req.formData();
  } catch (e) {
    return c.json({ error: 'bad_request', reason: `Invalid multipart body: ${(e as Error).message}` }, 400);
  }

  // Accept files under any field name ("file", "files", repeated) — the
  // modal sends `file` repeatedly but be liberal in what we accept.
  // (entries cast to unknown: @cloudflare/workers-types narrows
  // FormDataEntryValue to string, which breaks the instanceof check.)
  const files: File[] = [];
  for (const [, v] of formData.entries() as Iterable<[string, unknown]>) {
    if (v instanceof File && v.size > 0) files.push(v);
  }
  if (files.length === 0) {
    return c.json({ error: 'bad_request', reason: 'No file uploaded.' }, 400);
  }

  // Build Claude content blocks (image or document per file).
  type ContentBlock = Record<string, unknown>;
  const fileBlocks: ContentBlock[] = [];
  let firstBuffer: ArrayBuffer | null = null;
  for (const file of files) {
    if (file.size > MAX_FILE_BYTES) {
      return c.json(
        { error: 'bad_request', reason: `File too large (${(file.size / 1024 / 1024).toFixed(1)}MB). Max 20MB.` },
        400,
      );
    }
    const mime = file.type || '';
    const name = (file.name || '').toLowerCase();
    const isPdf = mime === 'application/pdf' || name.endsWith('.pdf');
    const isImage =
      IMAGE_MIMES.has(mime) ||
      name.endsWith('.jpg') || name.endsWith('.jpeg') ||
      name.endsWith('.png') || name.endsWith('.webp');
    if (!isPdf && !isImage) {
      return c.json(
        { error: 'bad_request', reason: `Unsupported file type "${mime || name}". Use JPEG / PNG / WEBP / PDF.` },
        400,
      );
    }
    const buf = await file.arrayBuffer();
    if (!firstBuffer) firstBuffer = buf;
    const data = toBase64(buf);
    if (isPdf) {
      fileBlocks.push({
        type: 'document',
        source: { type: 'base64', media_type: 'application/pdf', data },
      });
    } else {
      const mediaType = IMAGE_MIMES.has(mime)
        ? mime
        : name.endsWith('.png') ? 'image/png'
        : name.endsWith('.webp') ? 'image/webp'
        : 'image/jpeg';
      fileBlocks.push({
        type: 'image',
        source: { type: 'base64', media_type: mediaType, data },
      });
    }
  }

  const imageSha256 = firstBuffer ? await sha256Hex(firstBuffer) : null;

  // Catalog via the user-scoped client (RLS applies, same visibility the
  // operator already has on the SKU master screens).
  const sb = c.get('supabase');
  const catalog = await loadCatalog(sb);
  const catalogText = formatCatalog(catalog);

  // Cached prefix = SYSTEM_PROMPT + catalog. Identical across calls until
  // the catalog changes → Anthropic prompt-cache hit (~90% discount within
  // 5 min). Few-shot examples stay OUTSIDE the cache boundary so a new
  // confirmed sample doesn't invalidate the cache.
  const cachedPrefix = `${SYSTEM_PROMPT}\n\nCATALOG\n=======\n${catalogText}`;

  // Few-shot pool: 5 most recent operator-confirmed samples. Best-effort —
  // table missing (migration not applied) just skips it.
  const svc = serviceClient(c.env);
  let fewShotText = '';
  try {
    const { data: rows } = await svc
      .from('so_scan_samples')
      .select('corrected')
      .not('corrected', 'is', null)
      .order('created_at', { ascending: false })
      .limit(5);
    const examples = (rows as Array<{ corrected: unknown }> | null) ?? [];
    if (examples.length > 0) {
      const blocks = examples
        .map((r, i) => `Example ${i + 1} (operator-confirmed):\n${JSON.stringify(r.corrected)}`)
        .join('\n\n');
      fewShotText =
        `FEW-SHOT EXAMPLES from previous slips, corrected by the operator. ` +
        `Apply the same field conventions, transcription style, and matching judgement:\n\n${blocks}`;
    }
  } catch {
    /* best-effort */
  }

  let errorMsg: string | null = null;
  let parsed: ExtractedSlip | null = null;
  let claudeText = '';
  let cacheHit = false;
  let cacheCreated = false;

  try {
    const resp = await fetch(ANTHROPIC_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: CLAUDE_MODEL,
        max_tokens: 8192,
        // temperature=0 — deterministic OCR. Same slip + same prompt must
        // produce identical output so wrong fields are reproducible bugs,
        // not a flaky lottery (lesson from the HOOKKA scan-po rollout).
        temperature: 0,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: cachedPrefix, cache_control: { type: 'ephemeral' } },
              ...(fewShotText ? [{ type: 'text', text: fewShotText }] : []),
              ...fileBlocks,
              {
                type: 'text',
                text:
                  'Extract the sale-order slip above using the rules + catalog. ' +
                  "OUTPUT FORMAT: Your response must be VALID JSON ONLY. Do NOT write any preamble, explanation, analysis, or chain-of-thought. Do NOT start with phrases like 'Looking at the image…'. Do NOT wrap in markdown fences. The very first character of your response must be '{' and the very last must be '}'.",
              },
            ],
          },
        ],
      }),
    });

    const bodyText = await resp.text();
    if (!resp.ok) {
      errorMsg = `Anthropic ${resp.status}: ${bodyText.slice(0, 500)}`;
    } else {
      let parsedResp: AnthropicResponse;
      try {
        parsedResp = JSON.parse(bodyText) as AnthropicResponse;
      } catch {
        errorMsg = `Anthropic returned non-JSON: ${bodyText.slice(0, 300)}`;
        parsedResp = {};
      }
      if (parsedResp.error) {
        errorMsg = `Anthropic: ${parsedResp.error.type}: ${parsedResp.error.message}`;
      } else {
        cacheHit = (parsedResp.usage?.cache_read_input_tokens ?? 0) > 0;
        cacheCreated = (parsedResp.usage?.cache_creation_input_tokens ?? 0) > 0;
        const firstText = parsedResp.content?.find((b) => b.type === 'text')?.text ?? '';
        claudeText = stripJsonFences(firstText);
        try {
          parsed = normalizeSlip(JSON.parse(claudeText));
        } catch (e) {
          errorMsg = `Claude returned invalid JSON: ${(e as Error).message}. Raw: ${claudeText.slice(0, 300)}`;
        }
      }
    }
  } catch (e) {
    errorMsg = `Network/fetch error: ${(e as Error).message}`;
  }

  // Persist the sample row (status EXTRACTED, or FAILED with the error blob).
  let sampleId: string | null = null;
  let sampleInsertError: string | null = null;
  try {
    const { data: inserted, error: insErr } = await svc
      .from('so_scan_samples')
      .insert({
        image_sha256: imageSha256,
        extracted: parsed ?? { error: errorMsg, claudeText },
        status: parsed ? 'EXTRACTED' : 'FAILED',
      })
      .select('id')
      .single();
    if (insErr) {
      sampleInsertError = isMissingTable(insErr) ? TABLE_MISSING_MSG : insErr.message;
      console.error('so_scan_samples insert failed:', insErr.message);
    } else {
      sampleId = (inserted as { id: string } | null)?.id ?? null;
    }
  } catch (e) {
    sampleInsertError = (e as Error).message;
    console.error('so_scan_samples insert failed:', sampleInsertError);
  }

  if (!parsed) {
    return c.json({ error: 'extract_failed', reason: errorMsg ?? 'Extraction failed.', sampleId }, 502);
  }

  const warnings = validateSlip(parsed, catalog);

  return c.json({
    success: true,
    data: {
      sampleId,
      extracted: parsed,
      warnings,
      // Slim catalog so the modal's SKU/fabric pickers work without a second
      // round-trip.
      catalog: {
        skus: catalog.skus,
        fabrics: catalog.fabrics,
      },
      meta: { cacheHit, cacheCreated, files: files.length, sampleInsertError },
    },
  });
});

// ===========================================================================
// POST /scan-so/samples/:id/confirm — store the operator-corrected JSON.
// Called by the modal when the operator clicks "Open in New SO"; the
// corrected blob becomes a few-shot example for future extractions.
// ===========================================================================
scanSo.post('/samples/:id/confirm', async (c) => {
  const id = c.req.param('id');
  if (!id) return c.json({ error: 'bad_request', reason: 'Missing sample id.' }, 400);

  let body: { corrected?: unknown };
  try {
    body = (await c.req.json()) as { corrected?: unknown };
  } catch {
    return c.json({ error: 'bad_request', reason: 'Invalid JSON body.' }, 400);
  }
  if (body.corrected === undefined || body.corrected === null) {
    return c.json({ error: 'bad_request', reason: 'Missing `corrected`.' }, 400);
  }

  const svc = serviceClient(c.env);
  const { data: updated, error } = await svc
    .from('so_scan_samples')
    .update({ corrected: body.corrected, status: 'CONFIRMED' })
    .eq('id', id)
    .select('id');

  if (error) {
    if (isMissingTable(error)) {
      return c.json({ error: 'table_missing', reason: TABLE_MISSING_MSG }, 503);
    }
    return c.json({ error: 'update_failed', reason: error.message }, 500);
  }
  if (!updated || updated.length === 0) {
    return c.json({ error: 'not_found', reason: 'Sample not found.' }, 404);
  }
  return c.json({ success: true });
});
