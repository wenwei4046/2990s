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
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) {
  // Fail loud at import time — same posture as lib/queries.ts.
  // eslint-disable-next-line no-console
  console.warn('[mfg-products] VITE_API_URL is not set');
}

async function authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    let detail = '';
    try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  // PR #98 — Commander 2026-05-26: bulk SKU delete reported "Deleted 0/22.
  // 22 failed" with "Unexpected end of JSON input" even though the server
  // actually deleted every row. Cause: DELETE returns 204 No Content (empty
  // body, REST convention); this helper unconditionally called res.json()
  // which throws on an empty body. Handle 204 / empty bodies cleanly so
  // callers typed authedFetch<void> resolve instead of rejecting.
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  if (!text) return undefined as T;
  return JSON.parse(text) as T;
}

/* ────────────────────────── Types ────────────────────────────────────── */

export type MfgCategory = 'BEDFRAME' | 'SOFA' | 'ACCESSORY' | 'MATTRESS' | 'SERVICE';

export type SofaPriceTier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';

export type SeatHeightPrice = {
  height: string;
  priceSen: number;
  /** Missing tier means legacy row — treat as PRICE_2 (HOOKKA's historic default,
      kept so we don't have to one-shot migrate existing data). */
  tier?: SofaPriceTier;
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
  base_price_sen: number | null;
  price1_sen: number | null;
  unit_m3_milli: number;
  status: 'ACTIVE' | 'INACTIVE';
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
};

/* PR #216 — Commander 2026-05-27: parallel cost-side editor. Operation
 * can input estimated `costSen` next to each `priceSen` on Maintenance
 * surcharge rows. Read by computeMfgLineCost() in @2990s/shared. Opt-in
 * per row — absence keeps cost-side surcharge at 0.
 *
 * PR — Commander 2026-05-28: `priceSen` is the COST benchmark (commander's
 * mental model: Backend prices = cost). The customer-facing SELLING surcharge
 * lives on `sellingPriceSen` (authored by the Sales Director on POS, PR #257).
 * computeMfgLinePrice() in @2990s/shared adds `sellingPriceSen` (not priceSen)
 * to the selling line total, and the SO create/edit variant dropdowns only
 * show a `(+MYR …)` price suffix when `sellingPriceSen > 0` — so today, with
 * it unset, the dropdowns stay clean and variant surcharges contribute 0 to
 * the selling subtotal. Optional on the wire; older rows stay shape-identical. */
export type PricedOption = { value: string; priceSen: number; costSen?: number; sellingPriceSen?: number };

export type MaintenanceConfig = {
  divanHeights:    PricedOption[];
  legHeights:      PricedOption[];
  totalHeights:    PricedOption[];
  gaps:            string[];
  specials:        PricedOption[];
  sofaLegHeights:  PricedOption[];
  sofaSpecials:    PricedOption[];
  sofaSizes:       string[];
  // PR #50 — master pools that drive Model.allowed_options ticking + the
  // "+ Add Code" wizard. Optional on the wire because old maintenance rows
  // don't have them; the UI seeds defaults on first read.
  bedframeSizes?:    string[];   // ['K','Q','S','SS','SK','SP'] — bedframe size codes
  sofaCompartments?: string[];   // ['1A-LHF','1A-RHF','1NA',...] — sofa compartment codes
  mattressSizes?:    string[];   // ['K','Q','S','SS']
  // PR #220 (Commander 2026-05-27): per-compartment design metadata — POS
  // module designs (image + description + default price) brought into the
  // Maintenance UI for back-office reference. Keyed by compartment code,
  // so the parallel `sofaCompartments: string[]` order/membership stays
  // the source of truth for existing readers (ProductModelDetail, generator).
  // All fields optional; the UI auto-seeds defaults from SOFA_MODULES when
  // absent — commander overrides land here only on Save.
  sofaCompartmentMeta?: Record<string, {
    imageKey?: string;          // 'sofa-modules/1A-LHF.png' — relative to /public
    description?: string;       // free-text label commander may override
    defaultPriceCenti?: number; // cents (1 RM = 100). 0/absent = no default.
  }>;
  // PR (Commander 2026-05-28): commander-editable Quick Presets. Replaces
  // the hardcoded COMBO_PRESETS array in SofaComboTab.tsx and the
  // QUICK_PRESET_META mirror in POS Configurator. Each entry names a
  // canonical module composition (e.g. "1-Seater" = 1A-LHF + 1A-RHF) so
  // operation can compose Sofa Combo Rules without manually toggling
  // compartments every time. When this field is absent, both readers
  // fall back to DEFAULT_SOFA_QUICK_PRESETS in @2990s/shared so existing
  // deployments keep working until commander overrides via Maintenance.
  // The id is the stable preset_id Sofa Combo Rules reference — never
  // rename after a combo has been saved with it.
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
  //   {compartment}    Sofa compartment code (1A-LHF, 1A-RHF, ...)
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

/** PR #87 — Per-SKU active toggle, used from the Model detail page's
 *  "SKU variants" table. Commander hits this when a specific SKU stops
 *  selling (e.g. a size variant gets discontinued) — the row stays with its
 *  history, stock, and pricing intact, but the SO/PO line picker stops
 *  surfacing it. Re-activating is a single click back. */
export function useUpdateMfgProductStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; status: 'ACTIVE' | 'INACTIVE' }) => {
      const { id, status } = args;
      return authedFetch<{ ok: boolean; changed: number }>(`/mfg-products/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['mfg-products'] });
      qc.invalidateQueries({ queryKey: ['product-models'] });
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
