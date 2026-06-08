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
import { authedFetch } from './authed-fetch';
import { verifiedSave, readbackGet, friendlySaveMessage } from './verified-save';

const API_URL = import.meta.env.VITE_API_URL;
if (!API_URL) {
  // Fail loud at import time — same posture as lib/queries.ts.
  // eslint-disable-next-line no-console
  console.warn('[mfg-products] VITE_API_URL is not set');
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
  /** Customer-facing SELLING price (POS Master / Main Account authored).
      SO-SKU spec P4 (D4): the SO line editor defaults unit price from this. */
  sell_price_sen: number | null;
  pwp_price_sen: number | null;    // PWP (换购) SELLING base price (0128)
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
  /** Migration 0161 — one-shot SKU minted from a remark + extra charge. */
  one_shot?: boolean;
  /** Migration 0161 — source SO doc number that triggered minting (e.g. 'SO-3012'). */
  source_doc_no?: string | null;
  /** Commander 2026-05-29 — the SKU's Model allowed_options (sizes / leg_heights
      / divan_heights / total_heights / specials). Non-empty pool = restrict the
      SO variant dropdowns to those values; null / empty = no restriction.
      SO-parity (Loo 2026-06-06) — `gaps` + `fabrics` surfaced too: the server
      gate (allowed-options-check.ts) already validates both; the SO line editor
      now mirrors POS and filters its Gap + Fabric dropdowns by the same pools. */
  allowed_options?: ModelAllowedOptions | null;
};

/** The Model's Modular (allowed_options) pools — single ON/OFF authority for
 *  what a SKU may sell with. `fabrics` holds fabric COLOUR codes
 *  (fabric_colours.colour_id, e.g. 'CG-002'), same vocabulary POS writes. */
export type ModelAllowedOptions = {
  sizes?: string[] | null;
  compartments?: string[] | null;
  divan_heights?: string[] | null;
  total_heights?: string[] | null;
  leg_heights?: string[] | null;
  gaps?: string[] | null;
  fabrics?: string[] | null;
  specials?: string[] | null;
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
  sofaCompartments?: string[];   // ['1A(LHF)','1A(RHF)','1NA',...] — sofa compartment codes
  mattressSizes?:    string[];   // ['K','Q','S','SS']
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
  // PR (Commander 2026-05-28): commander-editable Quick Presets. Replaces
  // the hardcoded COMBO_PRESETS array in SofaComboTab.tsx and the
  // QUICK_PRESET_META mirror in POS Configurator. Each entry names a
  // canonical module composition (e.g. "1-Seater" = 1A(LHF) + 1A(RHF)) so
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
      // verified-save (Wei Siang 2026-06-08): a price PATCH that returns 200 can
      // still LIE — a half-write or a stale cache can leave the old price in
      // place. Money is load-bearing, so we read the row back (cache-bypassing)
      // and confirm the price actually changed before reporting success. The
      // money columns are stored verbatim (PATCH: base_price_sen = basePriceSen),
      // so the comparison can't false-positive.
      const expect: Record<string, unknown> = {};
      if (body.basePriceSen !== undefined) expect.base_price_sen = body.basePriceSen;
      if (body.price1Sen    !== undefined) expect.price1_sen     = body.price1Sen;
      if (body.costPriceSen !== undefined) expect.cost_price_sen = body.costPriceSen;

      const result = await verifiedSave<{ product: Record<string, unknown> }>({
        endpoint: `/mfg-products/${id}`,
        method: 'PATCH',
        body,
        readback: () => readbackGet<{ product: Record<string, unknown> }>(`/mfg-products/${id}`),
        expect,
        accessor: (d, f) => d?.product?.[f],
      });

      if (!result.ok) {
        throw new Error(friendlySaveMessage(result, {
          noun: 'price',
          fieldNames: { base_price_sen: 'Base price', price1_sen: 'Price 1', cost_price_sen: 'Cost price' },
          fmt: (v) => (v == null ? '(blank)' : `RM${(Number(v) / 100).toFixed(2)}`),
        }));
      }
      return { ok: true as const, changed: 1 };
    },
    onError: (err) => {
      // Surface a money-save failure LOUDLY — a silent miss would let the
      // operator believe a price stuck when it didn't (verified-save).
      // eslint-disable-next-line no-alert
      window.alert(err instanceof Error ? err.message : String(err));
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

/* ─── Special Add-ons (migration 0134) — SO-parity read (Loo 2026-06-06) ───
 * The per-Model Product Add-ons system the POS configurator sells from and the
 * server prices from (buildSpecialsPoolFromAddons over the special_addons
 * table). The SO line editor's Specials accordion now reads THESE — the same
 * GET /special-addons the POS uses — instead of the legacy maintenance_config
 * specials/sofaSpecials string pools, so a rename/retire in the Special
 * Add-ons tab can never leave the Backend offering a code the server prices
 * at RM 0. Shapes mirror apps/pos/src/lib/queries.ts. */
export interface SpecialAddonChoice { label: string; extraSen: number; }
export interface SpecialAddonGroup { label: string; required: boolean; choices: SpecialAddonChoice[]; }
export interface SpecialAddonRow {
  id: string;
  code: string;
  label: string;
  soDescription: string;
  categories: string[];          // UPPERCASE mfg categories, e.g. ['BEDFRAME']
  sellingPriceSen: number;
  costPriceSen: number;
  optionGroups: SpecialAddonGroup[];
  active: boolean;
  sortOrder: number;
}

export const useSpecialAddons = () =>
  useQuery({
    queryKey: ['special-addons'],
    staleTime: 60_000,
    queryFn: async (): Promise<SpecialAddonRow[]> => {
      const body = await authedFetch<{ addons: SpecialAddonRow[] }>('/special-addons');
      return body.addons ?? [];
    },
  });

/* ─── Special Add-ons CRUD (Backend parity with the POS Special Add-ons tab,
 * Loo 2026-06-08) — same /special-addons Worker routes the POS hooks call, so
 * POS and Backend write the one shared table. Shapes mirror
 * apps/pos/src/lib/queries.ts. */
export interface SpecialAddonInput {
  code: string;
  label: string;
  soDescription: string;
  categories: string[];
  sellingPriceSen: number;
  costPriceSen: number;
  optionGroups: SpecialAddonGroup[];
  active: boolean;
  sortOrder: number;
}

export const useCreateSpecialAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: SpecialAddonInput) =>
      authedFetch<{ id: string }>('/special-addons', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['special-addons'] }); },
  });
};

export const useUpdateSpecialAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<SpecialAddonInput> }) =>
      authedFetch<void>(`/special-addons/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['special-addons'] }); },
  });
};

export const useDeleteSpecialAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<void>(`/special-addons/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['special-addons'] }); },
  });
};

/* ─── Order Add-ons (whole-order one-time fees: Dispose, Lift access) ───────
 * The `addons` table, written direct via supabase-js under RLS (SELECT all
 * staff, write is_admin) — same as the POS Order Add-ons section. Distinct
 * from the per-Model special_addons above. Mirrors apps/pos/src/lib/queries.ts
 * (AdminAddonRow / useAllAddons / useCreateAddon / useUpdateAddon). */
export interface AdminAddonRow {
  id: string;
  label: string;
  description: string | null;
  icon: string;
  kind: 'qty' | 'floors_items' | 'flat';
  category: string | null;
  price: number;
  perFloorItem: number | null;
  unit: string | null;
  defaultQty: number;
  stock: number | null;
  enabled: boolean;
  showAtHandover: boolean;
  /** Migration 0160 — per-add-on SERVICE SKU (SVC-*); NULL books under the
   *  generic SVC-ADDON bucket. */
  serviceSku: string | null;
  sortOrder: number;
}

export const useAllAddons = () =>
  useQuery({
    queryKey: ['addons-all'],
    staleTime: 60_000,
    queryFn: async (): Promise<AdminAddonRow[]> => {
      const { data, error } = await supabase
        .from('addons')
        .select('id, label, description, icon, kind, category, price, per_floor_item, unit, default_qty, stock, enabled, show_at_handover, service_sku, sort_order')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id, label: r.label, description: r.description, icon: r.icon, kind: r.kind,
        category: r.category, price: r.price, perFloorItem: r.per_floor_item, unit: r.unit,
        defaultQty: r.default_qty, stock: r.stock, enabled: r.enabled,
        showAtHandover: r.show_at_handover ?? false, serviceSku: r.service_sku ?? null,
        sortOrder: r.sort_order,
      }));
    },
  });

const invalidateBackendAddons = (qc: ReturnType<typeof useQueryClient>) => {
  void qc.invalidateQueries({ queryKey: ['addons'] });
  void qc.invalidateQueries({ queryKey: ['addons-all'] });
};

export const useUpdateAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: { price?: number; perFloorItem?: number | null; enabled?: boolean; showAtHandover?: boolean; serviceSku?: string | null } }) => {
      const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (patch.price !== undefined)          update.price = patch.price;
      if (patch.perFloorItem !== undefined)   update.per_floor_item = patch.perFloorItem;
      if (patch.enabled !== undefined)        update.enabled = patch.enabled;
      if (patch.showAtHandover !== undefined) update.show_at_handover = patch.showAtHandover;
      if (patch.serviceSku !== undefined)     update.service_sku = patch.serviceSku;
      const { error } = await supabase.from('addons').update(update).eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateBackendAddons(qc),
  });
};

export const useCreateAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (row: {
      id: string; label: string; description: string | null; icon: string;
      kind: 'qty' | 'floors_items' | 'flat'; category: string | null;
      price: number; perFloorItem: number | null; unit: string | null;
      stock: number | null; enabled: boolean; showAtHandover: boolean;
      serviceSku: string | null; sortOrder: number;
    }) => {
      const { error } = await supabase.from('addons').insert({
        id: row.id, label: row.label, description: row.description, icon: row.icon,
        kind: row.kind, category: row.category, price: row.price,
        per_floor_item: row.perFloorItem, unit: row.unit, stock: row.stock,
        enabled: row.enabled, show_at_handover: row.showAtHandover,
        service_sku: row.serviceSku, sort_order: row.sortOrder,
      });
      if (error) throw error;
    },
    onSuccess: () => invalidateBackendAddons(qc),
  });
};

/* Hard delete (Loo 2026-06-08). `cart_items.addon_id` FK (RESTRICT) blocks
 * deleting an add-on that's been used on an order — the caller surfaces that
 * as "use Off to retire it". Unused/test rows delete cleanly. */
export const useDeleteAddon = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('addons').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => invalidateBackendAddons(qc),
  });
};

/* ─── Model allowed_options by SKU code (SO-parity, Loo 2026-06-06) ────────
 * The SO line editor previously only knew a line's allowed_options when the
 * product was freshly picked this session (`picked` state) — EDITING an
 * already-saved line on SO Detail rendered every variant dropdown unfiltered.
 * This hook resolves the pools for any line by its item code, mirroring the
 * POS useModelAllowedSpecials/useModelAllowedFabricCodes joins. Returns null
 * for legacy/unknown codes (no Model link) → callers fall back to no
 * restriction, same as before. */
export const useModelAllowedOptionsByCode = (itemCode: string | undefined) =>
  useQuery({
    enabled: Boolean(itemCode),
    queryKey: ['model-allowed-options-by-code', itemCode],
    staleTime: 60_000,
    queryFn: async (): Promise<ModelAllowedOptions | null> => {
      if (!itemCode) return null;
      const { data, error } = await supabase
        .from('mfg_products')
        .select('product_models:model_id ( allowed_options )')
        .eq('code', itemCode)
        .limit(1);
      if (error) throw error;
      const row = (data ?? [])[0] as
        | { product_models?: { allowed_options?: ModelAllowedOptions | null } | Array<{ allowed_options?: ModelAllowedOptions | null }> | null }
        | undefined;
      const rel = Array.isArray(row?.product_models) ? row?.product_models[0] : row?.product_models;
      return rel?.allowed_options ?? null;
    },
  });

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
