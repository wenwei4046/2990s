// ----------------------------------------------------------------------------
// TanStack Query hooks for the Products & Maintenance page.
// Calls /mfg-products and /maintenance-config on the Worker API.
//
// Conventions match the existing useProducts() in queries.ts:
//   - 30s staleTime
//   - error surfaced via .error so the page can render a Banner
//   - mutations invalidate the relevant cache keys
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { MaintPoolEntry } from '@2990s/shared';
import { supabase } from '../supabase';

import { authedFetch, API_URL } from '../apiClient';

/* ────────────────────────── Types ────────────────────────────────────── */

export type MfgCategory = 'BEDFRAME' | 'SOFA' | 'ACCESSORY' | 'MATTRESS' | 'SERVICE';

export type SofaPriceTier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';

export type SeatHeightPrice = {
  height: string;
  /** COST (Backend-owned). Optional: an entry may be selling-only (a POS grid
      price for a slot Backend hasn't costed). resolveSeatHeightSen skips
      cost-absent entries so cost never falls to a fabricated 0. */
  priceSen?: number;
  /** Missing tier means legacy row — treat as PRICE_2 (HOOKKA's historic default,
      kept so we don't have to one-shot migrate existing data). */
  tier?: SofaPriceTier;
  /** Buyer SELLING price (sen) the POS Edit-Price grid authors (Chairman
      2026-06-01). `priceSen` stays COST (Backend-owned). Unset on cost-only rows
      → the selling read falls through to the flat module sell_price_sen. */
  sellingPriceSen?: number;
};

export type MfgProductRow = {
  id: string;
  code: string;
  name: string;
  category: MfgCategory;
  description: string | null;
  base_model: string | null;
  /** PR — supplier_sku auto-suffix (Commander 2026-05-27). Surfaced on the
      wire for bedframe / mattress SKUs so the supplier-mapping bulk-create
      can derive a per-SKU suffix ("5539" → "5539-K") instead of writing the
      literal model-level code into every binding. NULL for sofa / accessory /
      service rows; helper falls back to parsing `code` after the first '-'. */
  size_code: string | null;
  size_label: string | null;
  base_price_sen: number | null;   // COST (Price 2) — 0109 cost/sell split
  price1_sen: number | null;       // COST (Price 1, cheaper tier)
  sell_price_sen: number | null;   // SELLING (POS customer-facing). Master Account edits this.
  pwp_price_sen: number | null;    // PWP (换购) SELLING base price (0128). Used instead of sell_price_sen on a valid PWP reward line.
  unit_m3_milli: number;
  status: 'ACTIVE' | 'INACTIVE';   // COST/PO side — NOT showroom visibility (use pos_active)
  pos_active: boolean;             // D5 — selling-only POS catalog visibility (Master Account writes)
  included_addons: { addonId: string; qty: number }[]; // D7 — permanent free gifts (display-only)
  default_free_gifts: { giftProductId: string; qty: number; campaignName?: string | null }[]; // 0170 — accessory free gifts (auto-added at RM 0)
  sku_code: string | null;
  /** PR — supplier-mapping-by-model: optional FK to product_models.id so the
      supplier mapping picker can group SKUs by Model client-side. NULL for
      orphan SKUs that haven't been folded into a Model yet. */
  model_id: string | null;
  /* PR #104 — fabric_usage_centi / production_time_minutes / fabric_color
     dropped from the API response (2990's retail catalogue doesn't track
     them). Columns still exist on the DB; UI / CSV no longer expose. */
  /** Free-text brand label — mainly used for MATTRESS SKUs. */
  branding: string | null;
  sub_assemblies: unknown;
  pieces: unknown;
  /** Sofa-only: flat array of `{ height, priceSen, tier? }` from seat_height_prices
      JSONB. A sofa SKU can carry up to (sizes × 3 tiers) entries. */
  seat_height_prices: SeatHeightPrice[] | null;
  default_variants: unknown;
  updated_at: string;
  /** Migration 0161 — one-shot SKU minted from a remark + extra charge. */
  one_shot?: boolean;
  /** Migration 0161 — source SO doc number that triggered minting (e.g. 'SO-3012'). */
  source_doc_no?: string | null;
};

/* PR #216 — Commander 2026-05-27: parallel cost-side editor. Operation
 * can input estimated `costSen` next to each `priceSen` on Maintenance
 * surcharge rows. Read by computeMfgLineCost() in @2990s/shared. Opt-in
 * per row — absence keeps cost-side surcharge at 0.
 *
 * PR — Commander 2026-05-28: commander's mental model treats the legacy
 * `priceSen` field as COST (the benchmark / purchase price recorded on
 * Backend) — it must NEVER surface on POS. POS now writes a parallel
 * `sellingPriceSen` field that sales_director sets via the POS Maintenance
 * editor. Backend keeps reading priceSen as before; POS read paths show
 * sellingPriceSen and fall through to "—" when unset. Both are optional on
 * the wire so existing rows stay shape-identical until first edit. */
export type PricedOption = {
  value: string;
  priceSen: number;
  costSen?: number;
  /** Selling price authored on POS by sales_director. Independent of priceSen
   *  (which commander on Backend treats as cost benchmark). View-only on POS
   *  for non-director roles. */
  sellingPriceSen?: number;
  /** Owner spec 2026-06-12 — inactive options hide from NEW-entry pickers
   *  only; price/cost lookups keep resolving them for existing docs. */
  active?: boolean;
};

/* Owner spec 2026-06-12 — string-pool entries are either a plain string
 * (= active, historic shape) or { value, active } once toggled off on the
 * Backend Maintenance tab. Unwrap via maintValues / maintActiveValues from
 * @2990s/shared. */
export type { MaintPoolEntry } from '@2990s/shared';

export type MaintenanceConfig = {
  divanHeights:    PricedOption[];
  legHeights:      PricedOption[];
  totalHeights:    PricedOption[];
  gaps:            MaintPoolEntry[];
  specials:        PricedOption[];
  sofaLegHeights:  PricedOption[];
  sofaSpecials:    PricedOption[];
  sofaSizes:       MaintPoolEntry[];
  // PR #50 — master pools that drive Model.allowed_options ticking + the
  // "+ Add Code" wizard. Optional on the wire because old maintenance rows
  // don't have them; the UI seeds defaults on first read.
  bedframeSizes?:    MaintPoolEntry[];   // ['K','Q','S','SS','SK','SP'] — bedframe size codes
  sofaCompartments?: MaintPoolEntry[];   // ['1A(LHF)','1A(RHF)','1NA',...] — sofa compartment codes
  mattressSizes?:    MaintPoolEntry[];   // ['K','Q','S','SS']
  // BRANDING pool — simple value list (no prices). Mirror of the Backend
  // MaintenanceConfig field: POS reads the same /maintenance-config blob, so
  // surfacing it here keeps the POS Maintenance tab's Products Maintenance group
  // in parity with Backend (and an admin edit on either side stays in sync).
  // Optional on the wire; absent/empty = empty pool.
  brandings?:        MaintPoolEntry[];   // ['HILTON','SEALY','2990S',...]
  // SUPPLY CATEGORY pool (owner spec 2026-06-12) — simple value list. Mirror of
  // the Backend field; on Backend it feeds the Suppliers list filter chips + the
  // supplier form's Supply Category toggles. POS has no Suppliers page, but
  // surfaces the pool for view/edit parity. Optional; absent/empty = empty pool.
  supplierCategories?: MaintPoolEntry[]; // ['Sofa','Bedframe','Mattress',...]
  // PR #220 (Commander 2026-05-27): per-compartment design metadata — POS
  // module designs (image + description + default price) brought into the
  // Maintenance UI for back-office reference. Keyed by compartment code,
  // so the parallel `sofaCompartments: string[]` order/membership stays
  // the source of truth for existing readers (ProductModelDetail, generator).
  // All fields optional; the UI auto-seeds defaults from SOFA_MODULES when
  // absent — commander overrides land here only on Save.
  sofaCompartmentMeta?: Record<string, {
    imageKey?: string;          // 'sofa-modules/1A(LHF).png' — relative to /public
    description?: string;       // free-text label commander may override
    defaultPriceCenti?: number; // cents (1 RM = 100). 0/absent = no default.
  }>;
  // PR (Commander 2026-05-28): commander-editable Quick Presets. Mirror of
  // the field on the Backend MaintenanceConfig — POS reads the same blob
  // via /maintenance-config/resolved?scope=master so the New Combo dialog,
  // POS Configurator Quick Pick, and POS Customize sidebar all stay in
  // sync. Falls back to DEFAULT_SOFA_QUICK_PRESETS when absent. The id is
  // the stable preset_id Sofa Combo Rules reference — never rename after
  // a combo has been saved with it.
  sofaQuickPresets?: {
    id: string;
    label: string;
    modules: string[];
    sortOrder?: number;
    active?: boolean;
    defaultTier?: SofaPriceTier;
  }[];
  // PR #92 — Commander 2026-05-26: "King, 6FT, 183 那些，如果我要改的话，怎
  // 么样去改呢？" The size code alone (K/Q/S/...) used to be the only thing
  // editable in Maintenance; label ("6FT") + dimensions ("183X190CM") were
  // hardcoded in lib/size-info.ts. Override map lets commander edit them
  // per-code from the same Bedframe Sizes / Mattress Sizes tab. Empty/
  // missing entry falls back to the static SIZE_INFO map for backwards
  // compat with deployments that haven't customised yet.
  sizeLabels?: Record<string, { label?: string; dimensions?: string }>;
  // PR #72 — Per-category SKU code + name templates. Commander 2026-05-26:
  // wants to customise the format himself instead of relying on hardcoded
  // generators. Optional; the server falls back to its built-in defaults
  // when these are empty so existing Models keep working.
  //
  // Available placeholders (substituted at generate-time):
  //   {branding}       Model.branding (may be empty)
  //   {model_code}     Model.model_code
  //   {model_name}     Model.name (whitespace-trimmed)
  //   {size}           Size code   (K/Q/S/SS/SK/SP) — BEDFRAME, MATTRESS
  //   {size_label}     Size label  (6FT, 5FT, 3FT, 3.5FT, 200X200CM, ...)
  //   {dimensions}     "WxLCM"     (BEDFRAME: 183X190CM, etc.)
  //   {width}          width cm    (MATTRESS dim parts)
  //   {length}         length cm
  //   {thickness}      mattress thickness cm (from Model.allowed_options)
  //   {compartment}    Sofa compartment code (1A(LHF), 1A(RHF), ...)
  bedframeCodeFormat?: string;   // default: '{model_code}-({size})'
  bedframeNameFormat?: string;   // default: '{branding} BEDFRAME ({size_label}) ({dimensions})'
  sofaCodeFormat?:     string;   // default: '{model_code}-{compartment}'
  sofaNameFormat?:     string;   // default: '{model_name} {compartment}'
  mattressCodeFormat?: string;   // default: '{model_code} MATT ({size})'
  mattressNameFormat?: string;   // default: '{model_name} ({width}x{length}x{thickness}CM)'
};

export type MaintenanceResolved = {
  data: MaintenanceConfig | null;
  effectiveFrom: string | null;
  hasPendingPriceChange: boolean;
  pendingEffectiveFrom: string | null;
};

export type MaintenanceHistoryRow = {
  id: string;
  scope: string;
  config: MaintenanceConfig;
  effectiveFrom: string;
  notes: string;
  createdAt: string;
  createdBy: string | null;
  isPending: boolean;
};

/* ────────────────────────── Hooks ────────────────────────────────────── */

export function useMfgProducts(opts?: {
  category?: MfgCategory;
  search?: string;
  /**
   * Task #102 — Optional gate so search-as-you-type callers (SoLineCard's
   * product picker) can avoid firing one query per keystroke. Defaults to
   * `true` so existing callers (list pages, stock-take seeders, supplier
   * detail product attach modal) keep their eager behaviour.
   *
   * Typical search-as-you-type usage:
   *   useMfgProducts({
   *     search: debouncedQ,
   *     enabled: showPicker && debouncedQ.trim().length >= 2,
   *   });
   */
  enabled?: boolean;
}) {
  return useQuery({
    queryKey: ['mfg-products', opts?.category ?? 'all', opts?.search ?? ''],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (opts?.category) params.set('category', opts.category);
      if (opts?.search) params.set('search', opts.search);
      const res = await authedFetch<{ products: MfgProductRow[] }>(
        `/mfg-products${params.toString() ? `?${params.toString()}` : ''}`,
      );
      return res.products;
    },
    enabled: opts?.enabled ?? true,
    staleTime: 30_000,
    // Surface schema-missing errors (HTTP 500 'relation does not exist')
    // immediately instead of cycling through 3 default retries + exponential
    // backoff (~7s of "Loading…" before the error banner shows).
    retry: 1,
    retryDelay: 800,
  });
}

export function useUpdateMfgProductPrices() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      id: string;
      basePriceSen?: number | null;
      price1Sen?: number | null;
      costPriceSen?: number | null;
      sellPriceSen?: number | null;
      pwpPriceSen?: number | null;
      seatHeightPrices?: SeatHeightPrice[];
      branding?: string | null;
      subAssemblies?: string[];
      pieces?: { count: number; names: string[] } | null;
      defaultVariants?: Record<string, unknown>;
      notes?: string;
      /* PR #89 — SKU Master inline edit. Shared with the price PATCH
         endpoint since they all hit /mfg-products/:id. */
      code?: string;
      name?: string;
    }) => {
      const { id, ...body } = args;
      return authedFetch<{ ok: boolean; changed: number }>(`/mfg-products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-products'] });
    },
  });
}

/* (Removed 2026-06-01) useUpdateMfgProductPosActive — the standalone per-SKU
   "Visible" toggle was retired so Master Admin's Modular ON/OFF (allowed_options)
   is the single source of truth. The server mirrors allowed_options.sizes onto
   pos_active (PATCH /product-models cascade); pos_active is no longer set from a
   client toggle. */

/** D7 (Phase 3) — Master Account per-SKU permanent free gifts. Writes the
 *  selling-only `included_addons` ({addonId, qty}[]). The POS Configurator
 *  renders "× N INCLUDED". DISPLAY-ONLY — no inventory/cost deduction. */
export function useUpdateMfgProductGifts() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; includedAddons: { addonId: string; qty: number }[] }) => {
      const { id, includedAddons } = args;
      return authedFetch<{ ok: boolean; changed: number }>(`/mfg-products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ includedAddons }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-products'] });
    },
  });
}


export type MasterPriceHistoryRow = {
  id: string;
  product_code: string;
  field: string;
  old_value_sen: number | null;
  new_value_sen: number | null;
  reason: string | null;
  changed_at: string;
  changed_by: string | null;
};

export function useMfgProductPriceHistory(id: string | null) {
  return useQuery({
    queryKey: ['mfg-product-price-history', id],
    queryFn: () => authedFetch<{ history: MasterPriceHistoryRow[] }>(`/mfg-products/${id}/price-history`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/* PR #38 — Suppliers carrying a given product (via supplier_material_bindings). */
export type ProductSupplierRow = {
  id: string;
  supplier_id: string;
  supplier_sku: string;
  unit_price_centi: number;
  currency: string;
  lead_time_days: number;
  moq: number;
  is_main_supplier: boolean;
  notes: string | null;
  suppliers: {
    code: string;
    name: string;
    phone: string | null;
  } | null;
};
export function useMfgProductSuppliers(id: string | null) {
  return useQuery({
    queryKey: ['mfg-product-suppliers', id],
    queryFn: () => authedFetch<{
      product: { code: string; name: string; category: string };
      suppliers: ProductSupplierRow[];
    }>(`/mfg-products/${id}/suppliers`),
    enabled: Boolean(id),
    staleTime: 30_000,
  });
}

/** Body shape for POST /mfg-products. id + status default server-side. */
export type NewMfgProductInput = {
  code: string;
  name: string;
  category: MfgCategory;
  description?: string;
  baseModel?: string;
  sizeCode?: string;
  sizeLabel?: string;
  basePriceSen?: number | null;
  price1Sen?: number | null;
  costPriceSen?: number | null;
  unitM3Milli?: number;
  fabricUsageCenti?: number;
  productionTimeMinutes?: number;
  branding?: string;
  fabricColor?: string;
};

export function useCreateMfgProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewMfgProductInput) =>
      authedFetch<{ id: string; code: string }>(`/mfg-products`, {
        method: 'POST', body: JSON.stringify(body),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-products'] });
    },
  });
}

/* PR #82 (Commander 2026-05-26) — DELETE /mfg-products/:id. SKU Master
   multi-select delete fans out N parallel mutateAsync calls; per-row 404
   / 409 surface as a failed-mutation rejection the caller handles.
   PR #94 — Optional `force` flag adds ?force=true which wipes
   inventory_stock_lots / inventory_movements / supplier_material_bindings
   rows that reference this SKU before dropping it. Front-end exposes
   force as a follow-up "Force delete" button after a normal delete fails
   so commander never destroys side data unintentionally. */
export function useDeleteMfgProduct() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (args: string | { id: string; force?: boolean }) => {
      const id    = typeof args === 'string' ? args : args.id;
      const force = typeof args === 'string' ? false : !!args.force;
      const qs    = force ? '?force=true' : '';
      return authedFetch<void>(`/mfg-products/${encodeURIComponent(id)}${qs}`, { method: 'DELETE' });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-products'] });
    },
  });
}

/* Maintenance config */

/**
 * Maintenance config resolved at the given scope.
 *
 * PR #208 — accepts an `opts.enabled` flag so callers can defer the fetch
 * (e.g. PO pages waiting for the supplier id before scoping the query, or
 * the supplier-pricing tab fetching the master fallback only when the
 * supplier scope is empty). Defaults to enabled when `scope` is truthy.
 */
export function useMaintenanceConfig(
  scope = 'master',
  opts?: { enabled?: boolean },
) {
  const enabled = opts?.enabled ?? Boolean(scope);
  return useQuery({
    queryKey: ['maintenance-config', 'resolved', scope],
    queryFn: () =>
      authedFetch<MaintenanceResolved>(`/maintenance-config/resolved?scope=${encodeURIComponent(scope)}`),
    enabled,
    staleTime: 60_000,
    // See useMfgProducts comment — settle errors fast for the migration-pending case.
    retry: 1,
    retryDelay: 800,
  });
}

export function useMaintenanceConfigHistory(scope = 'master') {
  return useQuery({
    queryKey: ['maintenance-config', 'history', scope],
    queryFn: () =>
      authedFetch<{ history: MaintenanceHistoryRow[] }>(
        `/maintenance-config/history?scope=${encodeURIComponent(scope)}`,
      ),
    staleTime: 30_000,
  });
}

/**
 * Maintenance-is-master cascade rename (Loo 2026-06-04). Renames a sofa
 * compartment code text ATOMICALLY across the whole stack: SKU master
 * (code+name), every doc-line snapshot (SO/DO/SI/GRN/PO/PI/PR/consignment),
 * Modular allowed_options, combos, quick picks, in-flight carts and the
 * maintenance config blobs. Backed by the rename_sofa_compartment()
 * SECURITY DEFINER function (migration 0149); admin only.
 */
export function useRenameSofaCompartment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { from: string; to: string }) => {
      return authedFetch<{ ok: boolean; result: unknown }>(
        `/maintenance-config/sofa-compartments/rename`,
        { method: 'POST', body: JSON.stringify(args) },
      );
    },
    onSuccess: () => {
      // The cascade touches SKUs, models, combos and the config itself.
      qc.invalidateQueries({ queryKey: ['maintenance-config'] });
      qc.invalidateQueries({ queryKey: ['mfg-products'] });
      qc.invalidateQueries({ queryKey: ['product-models'] });
      qc.invalidateQueries({ queryKey: ['sofa-combos'] });
    },
  });
}

export function useSaveMaintenanceConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      scope: string;
      config: MaintenanceConfig;
      effectiveFrom: string;
      notes?: string;
    }) => {
      return authedFetch<{
        id: string;
        scope: string;
        config: MaintenanceConfig;
        effectiveFrom: string;
        notes: string;
      }>(`/maintenance-config/changes`, {
        method: 'POST',
        body: JSON.stringify(args),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-config'] });
    },
  });
}

/* ─── Sofa Compartment photo upload / delete (PR — Commander 2026-05-28) ──
 *
 * Each compartment code (1A(LHF) / 1A(RHF) / 1NA / 2A(LHF) / …) gets its
 * own hero photo. The Worker stores the file in R2 under
 * `sofa-compartments/{code}/{uuid}.{ext}` and patches the master-scope
 * maintenance_config row's `sofaCompartmentMeta[code].imageKey`.
 *
 * Multipart POST — same posture as useUploadProductModelPhoto:
 *   - never set content-type by hand (fetch picks the boundary from FormData)
 *   - authedFetch only stamps content-type for string bodies, so FormData
 *     slips past it correctly.
 *
 * On success we invalidate the master maintenance-config caches so the
 * Backend Sofa Compartments list re-renders with the new imageKey, and the
 * POS catalog (which subscribes via Realtime to maintenance_config_history)
 * picks the new key up within ~300ms. */

export function useUploadSofaCompartmentPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ code, file }: { code: string; file: File }) => {
      const fd = new FormData();
      fd.append('file', file);
      return authedFetch<{ photoUrl: string; photoKey: string }>(
        `/maintenance-config/sofa-compartments/${encodeURIComponent(code)}/photo`,
        { method: 'POST', body: fd },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-config'] });
    },
  });
}

export function useDeleteSofaCompartmentPhoto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (code: string) => {
      return authedFetch<{ ok: true }>(
        `/maintenance-config/sofa-compartments/${encodeURIComponent(code)}/photo`,
        { method: 'DELETE' },
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['maintenance-config'] });
    },
  });
}

export function useDeleteMaintenanceConfigRow() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`${API_URL}/maintenance-config/changes/${id}`, {
        method: 'DELETE',
        headers: {
          authorization: `Bearer ${(await supabase.auth.getSession()).data.session?.access_token ?? ''}`,
        },
      });
      if (!res.ok && res.status !== 204) {
        throw new Error(`${res.status} ${res.statusText}`);
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maintenance-config'] }),
  });
}
