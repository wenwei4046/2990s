import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export interface CatalogProduct {
  id: string;
  sku: string;
  name: string;
  detail: string | null;
  size_display: string | null;
  img_key: string | null;
  thumb_key: string | null;
  pricing_kind: 'sofa_build' | 'size_variants' | 'bedframe_build' | 'flat' | 'tbc';
  flat_price: number | null;
  recliner_upgrade_price: number | null;
  stock: number;
  low_at: number;
  visible: boolean;
  category: { id: string; label: string; icon: string; tbc: boolean } | null;
  series: { id: string; label: string; active: boolean } | null;
}

interface ProductsResponse {
  products: CatalogProduct[];
}

export const useCatalog = () =>
  useQuery({
    queryKey: ['catalog'],
    queryFn: async (): Promise<CatalogProduct[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/products`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /products failed (${res.status})`);
      const body = (await res.json()) as ProductsResponse;
      return body.products;
    },
    staleTime: 30_000,
  });

// Realtime subscription on `products`. Any INSERT/UPDATE/DELETE invalidates the
// catalog query so the table refetches within ~300ms — replaces the prototype's
// localStorage push from Backend → POS.
export const useCatalogRealtime = () => {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('catalog-products')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products' },
        () => {
          void qc.invalidateQueries({ queryKey: ['catalog'] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
};

/* ─── Per-product pricing (configurator screens) ───────────────────── */

export interface ProductBundleRow { bundleId: string; active: boolean; price: number }
export interface ProductCompartmentRow { compartmentId: string; active: boolean; price: number }
export interface ProductSizeRow { sizeId: string; active: boolean; price: number }

export const useProduct = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId],
    queryFn: async () => {
      if (!productId) throw new Error('no productId');
      /* Legacy path: `products` is the prototype's retail catalogue table.
         Production starts EMPTY (PORT_DESIGN.md §10 Decision 10) — only
         the per-Model `mfg_products` is seeded by commander via the
         Backend SKU Master. POS Catalog cards link to `/configure/{mfg.id}`
         (the mfg SKU id), so the lookup below misses every time.

         PR — Commander 2026-05-28 (CATALOG ROUTING FIX): when products
         doesn't have the row, fall back to mfg_products + product_models
         and synthesise a CatalogProduct-shaped object the Configurator
         can render. The Configurator only touches a small subset of the
         columns (recliner_upgrade_price / seat_upgrade_label /
         seat_upgrade_footrest / depth_options / included_addons / etc.),
         so defaults are safe for now — sofa pricing data flows in from
         `useSofaCustomizerData` + `useProductCompartments` regardless.

         BUGFIX 2026-05-28 (commander caught "Loading product…" hang):
         mfg_products.id is a TEXT key shaped `mfg-<12hex>` (e.g.
         mfg-9f684f4b9336). products.id is a UUID column. Querying
         products by a non-UUID text id makes Postgres throw "invalid
         input syntax for type uuid", which the old `if (error) throw`
         propagated → the Configurator (which renders "Loading product…"
         whenever `!data`) was stuck forever. Skip the products query
         entirely for mfg- ids; only legacy UUID ids hit the retail table. */
      const isMfgId = productId.startsWith('mfg-');
      if (!isMfgId) {
        const { data, error } = await supabase
          .from('products')
          .select(
            'id, sku, name, detail, size_display, img_key, thumb_key, pricing_kind, flat_price, recliner_upgrade_price, seat_upgrade_label, seat_upgrade_footrest, depth_options, stock, low_at, visible, category_id, series_id, included_addons, updated_at',
          )
          .eq('id', productId)
          .maybeSingle();
        if (error) throw error;
        if (data) {
          return data as typeof data & {
            included_addons: { addonId: string; qty: number }[];
            seat_upgrade_label: string | null;
            seat_upgrade_footrest: boolean;
            depth_options: string | null;
            // legacy products table has no base_model column — typed optional
            // so downstream code that checks product.data?.base_model compiles.
            base_model?: string | null;
          };
        }
      }

      /* Fallback: look up by mfg_products.id (what the Catalog cards link
         to). mfg category enum → legacy pricing_kind. SOFA → 'sofa_build',
         BEDFRAME → 'bedframe_build', MATTRESS → 'size_variants', everything
         else → 'flat'. Keeps the Configurator's existing branch logic
         working without porting it to talk to mfg_products directly. */
      const { data: mfgData, error: mfgErr } = await supabase
        .from('mfg_products')
        .select(
          'id, code, name, category, description, branding, size_label, base_price_sen, base_model',
        )
        .eq('id', productId)
        .maybeSingle();
      if (mfgErr) throw mfgErr;
      if (!mfgData) throw new Error('not_found');

      const mfg = mfgData as {
        id: string;
        code: string;
        name: string;
        category: 'SOFA' | 'BEDFRAME' | 'MATTRESS' | 'ACCESSORY' | 'SERVICE';
        description: string | null;
        branding: string | null;
        size_label: string | null;
        base_price_sen: number | null;
        base_model: string | null;
      };

      const pricingKind: 'sofa_build' | 'bedframe_build' | 'size_variants' | 'flat' =
        mfg.category === 'SOFA'     ? 'sofa_build'     :
        mfg.category === 'BEDFRAME' ? 'bedframe_build' :
        mfg.category === 'MATTRESS' ? 'size_variants'  :
                                       'flat';

      // Synthesise a row shape matching the products select() above so
      // downstream code that reads `product.data?.foo` keeps working.
      // base_price_sen is in sen (cents); flat_price expects ringgit
      // (legacy schema uses whole-RM integers — see CLAUDE.md "Money").
      return {
        id: mfg.id,
        sku: mfg.code,
        name: mfg.name,
        detail: mfg.description,
        size_display: mfg.size_label,
        img_key: null,
        thumb_key: null,
        pricing_kind: pricingKind,
        flat_price: mfg.base_price_sen != null ? Math.round(mfg.base_price_sen / 100) : null,
        recliner_upgrade_price: 0,
        seat_upgrade_label: null,
        seat_upgrade_footrest: true,
        depth_options: null,
        stock: 0,
        low_at: 0,
        visible: true,
        /* BUGFIX 2026-05-28: the Configurator topbar chip does
           `p.category_id.toUpperCase()` — a null here crashed the whole
           configure route ("Cannot read properties of null (reading
           'toUpperCase')"). Stamp the lowercased mfg category so the chip
           reads e.g. "BOOQIT · SOFA". */
        category_id: mfg.category ? mfg.category.toLowerCase() : null,
        /* base_model is needed by Configurator so it can pass it to
           useSofaCombos() and filter Quick Pick combos to this Model. */
        base_model: mfg.base_model,
        series_id: null,
        included_addons: [] as { addonId: string; qty: number }[],
        updated_at: new Date().toISOString(),
      };
    },
  });

/* ─── Add-ons (used by Configurator's PILLOWS + ADD-ON sections) ───── */

export interface AddonRow {
  id: string;
  label: string;
  description: string | null;
  icon: string;
  kind: 'qty' | 'floors_items' | 'flat';
  category: string | null;
  price: number;
  perFloorItem: number | null;
  unit: string | null;
  enabled: boolean;
}

export const useAddons = () =>
  useQuery({
    queryKey: ['addons'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<AddonRow[]> => {
      const { data, error } = await supabase
        .from('addons')
        .select('id, label, description, icon, kind, category, price, per_floor_item, unit, enabled')
        .eq('enabled', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        description: r.description,
        icon: r.icon,
        kind: r.kind,
        category: r.category,
        price: r.price,
        perFloorItem: r.per_floor_item,
        unit: r.unit,
        enabled: r.enabled,
      }));
    },
  });

export const useProductBundles = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'bundles'],
    queryFn: async (): Promise<ProductBundleRow[]> => {
      if (!productId) throw new Error('no productId');
      const { data, error } = await supabase
        .from('product_bundles')
        .select('bundle_id, active, price')
        .eq('product_id', productId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        bundleId: r.bundle_id,
        active: r.active,
        price: r.price,
      }));
    },
  });

export const useProductCompartments = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'compartments'],
    queryFn: async (): Promise<ProductCompartmentRow[]> => {
      if (!productId) throw new Error('no productId');
      const { data, error } = await supabase
        .from('product_compartments')
        .select('compartment_id, active, price')
        .eq('product_id', productId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        compartmentId: r.compartment_id,
        active: r.active,
        price: r.price,
      }));
    },
  });

/* ─── Sofa fabric & colour (spec 2026-05-24) ─── */

export interface FabricLibraryRow {
  id: string;
  label: string;
  tier: string;
  defaultSurcharge: number;
  active: boolean;
  sortOrder: number;
}
export interface FabricColourRow {
  fabricId: string;
  colourId: string;
  label: string;
  swatchHex: string | null;
  active: boolean;
  sortOrder: number;
}
export interface ProductFabricRow {
  fabricId: string;
  active: boolean;
  surcharge: number;
}

// Global fabric collection (active only) — drives the POS swatch palette.
export const useFabricLibrary = () =>
  useQuery({
    queryKey: ['fabric-library'],
    queryFn: async (): Promise<FabricLibraryRow[]> => {
      const { data, error } = await supabase
        .from('fabric_library')
        .select('id, label, tier, default_surcharge, active, sort_order')
        .eq('active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id, label: r.label, tier: r.tier, defaultSurcharge: r.default_surcharge,
        active: r.active, sortOrder: r.sort_order,
      }));
    },
  });

// All active colours (global, small) — filtered per fabric in the picker.
export const useFabricColours = () =>
  useQuery({
    queryKey: ['fabric-colours'],
    queryFn: async (): Promise<FabricColourRow[]> => {
      const { data, error } = await supabase
        .from('fabric_colours')
        .select('fabric_id, colour_id, label, swatch_hex, active, sort_order')
        .eq('active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        fabricId: r.fabric_id, colourId: r.colour_id, label: r.label,
        swatchHex: r.swatch_hex, active: r.active, sortOrder: r.sort_order,
      }));
    },
  });

// Per-Model fabric availability + surcharge.
export const useProductFabrics = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'fabrics'],
    queryFn: async (): Promise<ProductFabricRow[]> => {
      if (!productId) throw new Error('no productId');
      const { data, error } = await supabase
        .from('product_fabrics')
        .select('fabric_id, active, surcharge')
        .eq('product_id', productId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        fabricId: r.fabric_id, active: r.active, surcharge: r.surcharge,
      }));
    },
  });

/* ─── Bedframe configurator (spec 2026-05-25) ─────────────────────────
 * Mirrors the sofa fabric/colour hooks. Colour = global `bedframe_colours`
 * library ∩ the Model's `product_bedframe_colours` ticks (surcharge lives on
 * the global colour, no per-Model override). Options = global `bedframe_options`
 * (gap / leg_height / divan_height / total_height / special), grouped by `kind`
 * in the configurator. All surcharges 0 for pilot. */

export interface BedframeColourRow {
  id: string;
  label: string;
  swatchHex: string | null;
  surcharge: number;
  sortOrder: number;
}
export interface BedframeOptionRow {
  id: string;
  kind: string; // 'gap'|'leg_height'|'divan_height'|'total_height'|'special'
  value: string;
  surcharge: number;
  sortOrder: number;
}

// Colours offered for a given bedframe Model = global active bedframe_colours
// intersected with the Model's active product_bedframe_colours ticks.
export const useBedframeColours = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['bedframe-colours', productId],
    queryFn: async (): Promise<BedframeColourRow[]> => {
      if (!productId) throw new Error('no productId');
      const [globalRes, tickRes] = await Promise.all([
        supabase
          .from('bedframe_colours')
          .select('id, label, swatch_hex, surcharge, active, sort_order')
          .eq('active', true)
          .order('sort_order'),
        supabase
          .from('product_bedframe_colours')
          .select('colour_id, active')
          .eq('product_id', productId)
          .eq('active', true),
      ]);
      if (globalRes.error) throw globalRes.error;
      if (tickRes.error) throw tickRes.error;
      const ticked = new Set((tickRes.data ?? []).map((r) => r.colour_id));
      return (globalRes.data ?? [])
        .filter((r) => ticked.has(r.id))
        .map((r) => ({
          id: r.id, label: r.label, swatchHex: r.swatch_hex,
          surcharge: r.surcharge, sortOrder: r.sort_order,
        }));
    },
  });

// Global bedframe option choice-lists (active only). Small + changes rarely
// (Backend admin), so cache aggressively like size_library — no realtime.
export const useBedframeOptions = () =>
  useQuery({
    queryKey: ['bedframe-options'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<BedframeOptionRow[]> => {
      const { data, error } = await supabase
        .from('bedframe_options')
        .select('id, kind, value, surcharge, active, sort_order')
        .eq('active', true)
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id, kind: r.kind, value: r.value,
        surcharge: r.surcharge, sortOrder: r.sort_order,
      }));
    },
  });

/** Maps HOOKKA mfg_products.size_code → size_library.id (seeded in seed-libraries.sql).
 *  Only the 4 standard bed sizes have library entries at MVP; SK/SP/7FT etc. are ignored
 *  until size_library is extended to include them. */
const MFG_SIZE_CODE_TO_LIB: Record<string, string> = {
  K: 'king', Q: 'queen', S: 'single', SS: 'super-single',
};

export const useProductSizes = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'sizes'],
    queryFn: async (): Promise<ProductSizeRow[]> => {
      if (!productId) throw new Error('no productId');

      /* ── mfg-* path (new manufacturer SKU system) ──────────────────────────
         The POS catalog links to `/configure/{mfg.id}` where `mfg.id` is a
         TEXT key like `mfg-4ea1697f0783`. `product_size_variants.product_id`
         is a UUID FK to the legacy `products` table — passing a mfg- id
         directly returns zero rows (Postgres type coercion makes it a no-op,
         not an error).

         Fix: two-step resolve.
           1. Fetch `retail_product_id` (nullable UUID bridge) + `model_id`
              from `mfg_products`.
           2a. If `retail_product_id` is set → use `product_size_variants` as
               normal (admin-configured prices from Backend SKU Master).
           2b. Otherwise → fetch all sibling SKUs that share the same
               `model_id` and synthesise ProductSizeRow[] from their
               `size_code` + `base_price_sen`. Works even if `retail_product_id`
               is never populated — prices come directly from mfg data.
           2c. Truly orphan SKU (no model, no retail link) → single size entry
               from its own `size_code`/`base_price_sen`. */
      if (productId.startsWith('mfg-')) {
        const { data: mfgRow, error: mfgErr } = await supabase
          .from('mfg_products')
          .select('retail_product_id, model_id, size_code, base_price_sen')
          .eq('id', productId)
          .maybeSingle();
        if (mfgErr) throw mfgErr;
        if (!mfgRow) return [];

        // 2a — retail bridge exists: use admin-configured product_size_variants
        if (mfgRow.retail_product_id) {
          const { data, error } = await supabase
            .from('product_size_variants')
            .select('size_id, active, price')
            .eq('product_id', mfgRow.retail_product_id);
          if (error) throw error;
          if (data && data.length > 0) {
            return data.map((r) => ({ sizeId: r.size_id, active: r.active, price: r.price }));
          }
          // Fall through to mfg siblings if the retail link exists but has no variants yet.
        }

        // 2b — derive sizes from mfg_products siblings (same model_id)
        if (mfgRow.model_id) {
          const { data: siblings, error: sibErr } = await supabase
            .from('mfg_products')
            .select('size_code, base_price_sen, status')
            .eq('model_id', mfgRow.model_id)
            .eq('status', 'ACTIVE');
          if (sibErr) throw sibErr;
          const rows = (siblings ?? [])
            .filter((s) => s.size_code && s.size_code in MFG_SIZE_CODE_TO_LIB)
            .map((s) => ({
              sizeId: MFG_SIZE_CODE_TO_LIB[s.size_code!] as string,
              active: true,
              price: s.base_price_sen != null ? Math.round(s.base_price_sen / 100) : 0,
            }));
          if (rows.length > 0) return rows;
        }

        // 2c — orphan SKU: single size from this SKU's own code + price
        if (mfgRow.size_code && mfgRow.size_code in MFG_SIZE_CODE_TO_LIB) {
          return [{
            sizeId: MFG_SIZE_CODE_TO_LIB[mfgRow.size_code] as string,
            active: true,
            price: mfgRow.base_price_sen != null ? Math.round(mfgRow.base_price_sen / 100) : 0,
          }];
        }

        return [];
      }

      // ── Legacy UUID path (retail `products` table) ──────────────────────────
      const { data, error } = await supabase
        .from('product_size_variants')
        .select('size_id, active, price')
        .eq('product_id', productId);
      if (error) throw error;
      return (data ?? []).map((r) => ({
        sizeId: r.size_id,
        active: r.active,
        price: r.price,
      }));
    },
  });

// size_library is small (7 rows) and changes rarely — cache aggressively so
// every Configurator screen doesn't re-fetch.
export interface SizeLibraryRow {
  id: string;
  label: string;
  widthCm: number;
  lengthCm: number;
  sortOrder: number;
}
export const useSizeLibrary = () =>
  useQuery({
    queryKey: ['size_library'],
    staleTime: 5 * 60 * 1000,
    queryFn: async (): Promise<SizeLibraryRow[]> => {
      const { data, error } = await supabase
        .from('size_library')
        .select('id, label, width_cm, length_cm, sort_order')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        widthCm: r.width_cm,
        lengthCm: r.length_cm,
        sortOrder: r.sort_order,
      }));
    },
  });

// All categories — including the TBC ones (Dining/Bathroom/Kids zone/Accessories).
// We can't derive these from the product list because TBC categories are by
// definition empty. Catalog sidebar reads from here so the "To be confirmed"
// section shows even when no products exist for those categories yet.
export interface CategoryRow {
  id: string;
  label: string;
  icon: string;
  tbc: boolean;
  sortOrder: number;
}
export const useCategoriesAll = () =>
  useQuery({
    queryKey: ['categories_all'],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<CategoryRow[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, label, icon, tbc, sort_order')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        icon: r.icon,
        tbc: r.tbc,
        sortOrder: r.sort_order,
      }));
    },
  });

/* ─── Backend SKU Master catalog (mfg_products × product_models) ───────────
 *
 * PR — Commander 2026-05-27: "你的这个第一张照片，应该要接上我的这个 Product
 * Module 这一边。然后我的 Product Module 这一边也是会 upload 照片，所以就会
 * 变成第三张照片". POS Catalog needs to surface the SKU rows commander seeds
 * via the Backend (Products & Maintenance) AND show the Model-level photos
 * he uploaded via PR #97. The legacy `/products` table is the retail layer
 * that hasn't been wired through for Phase 1.5 yet — `mfg_products` is the
 * source of truth for what's in stock.
 *
 * The query joins:
 *   - mfg_products (status = ACTIVE) → one row per SKU
 *   - product_models (active = true) → for the photo_url + Model name
 * Categories sidebar counts roll up from this list (mattress / sofa /
 * bedframe). Cards render `model.photo_url` when present; fall back to the
 * monogram placeholder.
 *
 * Why direct Supabase (not the API): mfg_products / product_models have no
 * RLS configured (admin-managed catalogue, all authed staff can read). The
 * Worker /mfg-products route is auth'd via supabaseAuth which forwards the
 * same JWT; using the JS client here saves the extra hop and avoids a new
 * POS-specific endpoint. If RLS gets added later, swap to a Worker route.
 * ───────────────────────────────────────────────────────────────────────── */

export type MfgCatalogCategory = 'SOFA' | 'BEDFRAME' | 'MATTRESS' | 'ACCESSORY' | 'SERVICE';

export interface MfgCatalogRow {
  id:            string;
  code:          string;
  name:          string;
  category:      MfgCatalogCategory;
  /** Lowercase categories table id ('sofa' / 'bedframe' / 'mattress' / …).
      Derived from `category` so the sidebar filter can match against the
      `categories` table without UI doing two enum mappings. */
  categoryId:    string;
  description:   string | null;
  /** From mfg_products.branding (denormalized from the Model in PR #65). */
  branding:      string | null;
  sizeLabel:     string | null;
  basePriceSen:  number | null;
  modelId:       string | null;
  /** product_models.name — used for the card subtitle when present. */
  modelName:     string | null;
  /** product_models.photo_url — hero image flowed from the Model. */
  photoUrl:      string | null;
}

/** Resolve a Model photo_url (stored as relative proxy path
 *  `/product-models/{id}/photo/{key}`) against VITE_API_URL so the
 *  rendered <img> works from the POS origin. Absolute URLs (legacy /
 *  externally-hosted photos) pass through untouched. Returns null when
 *  there's no photo. */
function resolvePhotoUrl(raw: string | null): string | null {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!API_URL) return raw; // best effort during local dev — let it break visibly
  return raw.startsWith('/') ? `${API_URL}${raw}` : `${API_URL}/${raw}`;
}

/** Map mfg category enum → /categories table id used by the sidebar. */
const MFG_CATEGORY_ID: Record<MfgCatalogCategory, string> = {
  SOFA:      'sofa',
  BEDFRAME:  'bedframe',
  MATTRESS:  'mattress',
  ACCESSORY: 'accessory',
  SERVICE:   'accessory', // services aren't a catalog category — bucket under accessory tab
};

export const useMfgCatalog = () =>
  useQuery({
    queryKey: ['mfg-catalog'],
    staleTime: 30_000,
    queryFn: async (): Promise<MfgCatalogRow[]> => {
      // Two-step fetch: (1) ACTIVE SKUs, (2) active Models referenced by them.
      // Supabase JS supports embedded select via the FK (mfg_products.model_id
      // → product_models.id) — the cheap path. If the embed fails (no FK
      // metadata cached) the rows still come back with a NULL model field
      // and the card falls back to the monogram placeholder.
      const { data, error } = await supabase
        .from('mfg_products')
        .select(
          'id, code, name, category, description, branding, size_label, base_price_sen, model_id, ' +
          'product_models:model_id ( id, name, photo_url, active )',
        )
        .eq('status', 'ACTIVE')
        .order('code', { ascending: true });
      if (error) throw error;

      // PR — Use `as unknown as` two-step cast because the supabase-js return
      // type for `select(...)` with an embedded FK is sometimes inferred as
      // `GenericStringError[]` when the schema cache hasn't materialised the
      // relationship yet (same fix pattern as task #94 hotfix).
      const rows = (data ?? []) as unknown as Array<{
        id:              string;
        code:            string;
        name:            string;
        category:        MfgCatalogCategory;
        description:     string | null;
        branding:        string | null;
        size_label:      string | null;
        base_price_sen:  number | null;
        model_id:        string | null;
        // Supabase embeds come back as an object OR an array depending on the
        // join cardinality the schema cache infers. mfg_products → product_models
        // is a single-record FK so we expect an object, but the type defaults
        // to an array in PostgREST. Coerce defensively.
        product_models:  { id: string; name: string; photo_url: string | null; active: boolean } |
                         Array<{ id: string; name: string; photo_url: string | null; active: boolean }> |
                         null;
      }>;

      return rows
        .map((r) => {
          const m = Array.isArray(r.product_models) ? r.product_models[0] : r.product_models;
          // Hide SKUs whose Model is currently deactivated — commander's
          // "All off" toggle on the Model Detail page should pull the whole
          // Model's variants from the POS catalog. SKUs without a model link
          // still show (orphan SKUs predate the Model layer).
          if (m && m.active === false) return null;
          return {
            id:           r.id,
            code:         r.code,
            name:         r.name,
            category:     r.category,
            categoryId:   MFG_CATEGORY_ID[r.category] ?? 'accessory',
            description:  r.description,
            branding:     r.branding,
            sizeLabel:    r.size_label,
            basePriceSen: r.base_price_sen,
            modelId:      r.model_id,
            modelName:    m?.name ?? null,
            // photo_url is stored as a relative proxy path from the API
            // (e.g. "/product-models/{id}/photo/{key}") — resolve against
            // VITE_API_URL so the <img> works from the POS origin. Absolute
            // URLs (legacy / migrated rows) pass through unchanged.
            photoUrl:     resolvePhotoUrl(m?.photo_url ?? null),
          } satisfies MfgCatalogRow;
        })
        .filter((r): r is MfgCatalogRow => r !== null);
    },
  });

/* ─── Sofa Customizer per-Model data (PR — Commander 2026-05-28) ──────────
 *
 * The POS Configurator's Custom build mode used to read the palette from
 * the LEGACY product_compartments table (per-Model active/price ticks). The
 * source of truth is now Backend → Products → Modular → [Model] → Allowed
 * Options (commander ticks which compartments + sizes this Model offers).
 *
 * This hook resolves a leadSkuId (the link target on /configure/:id) up to
 * the Model row's allowed_options, then ANDs that against the master
 * maintenance config's sofaCompartments pool + sofaCompartmentMeta map.
 * Output: an array of ResolvedCompartment rows the CustomBuilder palette
 * can render (image src, description, default price), grouped by the POS
 * palette buckets (1-seater / 2-seater / Corner / L-Shape / Accessory).
 *
 * The configurator can pass this data into <CustomBuilder modelCustomizer />
 * as an override layer; absent the prop the builder falls back to the
 * legacy pricing.compartments filter + bundled /sofa-modules/*.png assets.
 * ─────────────────────────────────────────────────────────────────────── */

export interface ResolvedSofaCompartment {
  /** Raw code as commander typed it (e.g. '1A-LHF' or '1A(LHF)'). */
  code:        string;
  /** Normalized code (collapsed to dash form) — matches shared SOFA_MODULES.id. */
  normalizedCode: string;
  /** Free-text label for the palette card. */
  label:       string;
  /** Default price in cents (1 RM = 100). 0 = no default. */
  priceSen:    number;
  /** Fully-resolved image URL — Worker proxy when uploaded, /sofa-modules/<id>.png
   *  fallback otherwise. null = no image. */
  imageUrl:    string | null;
  /** POS palette group (1-seater / 2-seater / Corner / L-Shape / Accessory / Other). */
  group:       'Other' | '1-seater' | '2-seater' | 'Corner' | 'L-Shape' | 'Accessory';
}

export interface SofaCustomizerData {
  /** Compartments commander ticked on this Model, intersected with the master
   *  compartment pool. Each row carries the resolved photo + price + label. */
  compartments: ResolvedSofaCompartment[];
  /** Seat-size inches commander ticked (24/26/28/30/32/35). */
  sizes:        string[];
  /** Leg height options ticked (subset of master pool). */
  legHeights:   string[];
  /** Special options ticked. */
  specials:     string[];
  /** The Model row that resolved (so caller can show Model name / branding). */
  modelId:      string;
  modelName:    string;
  modelCode:    string;
}

interface MaintenanceCompartmentMeta {
  imageKey?:          string;
  description?:       string;
  defaultPriceCenti?: number;
}

/** Resolve a Maintenance compartment imageKey to a fetchable URL.
 *   - Worker-uploaded photos (`sofa-compartments/{code}/...`) go through the
 *     public Worker proxy so the POS <img src> works from any origin.
 *   - Legacy bundled paths (`sofa-modules/...`) go through /public.
 *   - Absolute http(s) URLs pass through. */
function resolveCompartmentPhoto(code: string, imageKey: string | undefined): string | null {
  if (!imageKey) return null;
  if (/^https?:\/\//i.test(imageKey)) return imageKey;
  if (imageKey.startsWith('sofa-compartments/')) {
    if (!API_URL) return null;
    return `${API_URL}/maintenance-config/sofa-compartments/${encodeURIComponent(code)}/photo/${encodeURIComponent(imageKey)}`;
  }
  return `/${imageKey}`;
}

/** Classify a compartment code into the POS palette group. Mirrors
 *  `classifySofaCompartment` from @2990s/shared so the hook stays usable
 *  without importing the heavy sofa-build module here. */
function classifyCompartmentCode(rawCode: string): ResolvedSofaCompartment['group'] {
  const norm = rawCode.trim().replace(/\(([^)]*)\)/g, '-$1').replace(/-+$/, '');
  if (/^L[-(]/i.test(norm) || /^L$/i.test(norm)) return 'L-Shape';
  if (/^CNR$/i.test(norm) || /^CORNER/i.test(norm)) return 'Corner';
  if (/^STOOL|^Console|^WC-/i.test(norm)) return 'Accessory';
  if (/^2/.test(norm)) return '2-seater';
  if (/^1/.test(norm)) return '1-seater';
  return 'Other';
}

/** Fetch + resolve everything the Custom Builder needs per the Model
 *  commander ticked from. Pass any SKU id from the catalog click — we
 *  follow `mfg_products.model_id → product_models` to land on the Model.
 *  When the SKU has no model_id (orphan, predates the Model layer), the
 *  query resolves to null and the configurator falls back to its legacy
 *  per-Model `products` row. */
export const useSofaCustomizerData = (leadSkuId: string | undefined) =>
  useQuery({
    enabled: !!leadSkuId,
    queryKey: ['sofa-customizer-data', leadSkuId],
    queryFn: async (): Promise<SofaCustomizerData | null> => {
      if (!leadSkuId) return null;

      // Step 1: resolve the SKU → Model. mfg_products carries the model_id FK.
      const { data: sku, error: skuErr } = await supabase
        .from('mfg_products')
        .select('id, model_id, category, product_models:model_id ( id, name, model_code, allowed_options, active )')
        .eq('id', leadSkuId)
        .maybeSingle();
      if (skuErr) throw skuErr;
      if (!sku) return null;

      const model = Array.isArray(sku.product_models)
        ? sku.product_models[0]
        : sku.product_models;
      if (!model || sku.category !== 'SOFA') return null;

      const allowed = (model.allowed_options ?? {}) as {
        compartments?: string[];
        sizes?:        string[];
        leg_heights?:  string[];
        specials?:     string[];
      };

      // Step 2: pull the current effective master maintenance config so we
      // can resolve compartment images + descriptions + default prices.
      const { data: cfgRow, error: cfgErr } = await supabase
        .from('maintenance_config_history')
        .select('config')
        .eq('scope', 'master')
        .lte('effective_from', new Date().toISOString().slice(0, 10))
        .order('effective_from', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (cfgErr) throw cfgErr;
      const cfg = (cfgRow?.config ?? {}) as {
        sofaCompartmentMeta?: Record<string, MaintenanceCompartmentMeta>;
        sofaCompartments?:    string[];
      };
      const metaMap = cfg.sofaCompartmentMeta ?? {};

      const tickedCompartments = allowed.compartments ?? [];
      const compartments: ResolvedSofaCompartment[] = tickedCompartments.map((rawCode) => {
        const meta = metaMap[rawCode] ?? {};
        // Legacy bundled SVG fallback — when commander hasn't uploaded a
        // photo yet, render the design-system's hand-drawn SVG so the
        // palette card isn't empty. Maintenance UI auto-seeds the imageKey
        // (defaulting to `sofa-modules/<NORM_ID>.svg`) on read but stored
        // overrides may omit it.
        const norm = rawCode.trim().replace(/\(([^)]*)\)/g, '-$1').replace(/-+$/, '');
        const imageKey = meta.imageKey ?? `sofa-modules/${norm}.svg`;
        return {
          code:           rawCode,
          normalizedCode: norm,
          label:          meta.description ?? rawCode,
          priceSen:       meta.defaultPriceCenti ?? 0,
          imageUrl:       resolveCompartmentPhoto(rawCode, imageKey),
          group:          classifyCompartmentCode(rawCode),
        };
      });

      return {
        compartments,
        sizes:      allowed.sizes ?? [],
        legHeights: allowed.leg_heights ?? [],
        specials:   allowed.specials ?? [],
        modelId:    model.id,
        modelName:  model.name,
        modelCode:  model.model_code,
      };
    },
    staleTime: 30_000,
  });

/** Realtime invalidate on mfg_products + product_models edits so commander's
 *  Backend changes land on the POS catalog within ~300ms. Mirrors the
 *  prototype's localStorage push but via Supabase Realtime. */
export const useMfgCatalogRealtime = () => {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('mfg-catalog')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mfg_products' },
        () => { void qc.invalidateQueries({ queryKey: ['mfg-catalog'] }); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_models' },
        () => { void qc.invalidateQueries({ queryKey: ['mfg-catalog'] }); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc]);
};

// my_localities is a static Malaysia postcode dataset (~3000 rows). Fetched
// once and cached forever — the seed file regenerates only when the upstream
// dataset is refreshed (see packages/db/scripts/build-my-localities-seed.mjs).
// Used by Handover to drive cascading state → city → postcode dropdowns.
//
// Supabase PostgREST caps responses at 1000 rows; we page through with
// .range() and stop when a batch returns short. Three round-trips on first
// open, then served from cache for the rest of the session.
export interface LocalityRow {
  postcode: string;
  city: string;
  state: string;
  stateCode: string;
}
const LOCALITY_PAGE = 1000;
export const useLocalities = () =>
  useQuery({
    queryKey: ['my_localities'],
    staleTime: Infinity,
    gcTime: Infinity,
    queryFn: async (): Promise<LocalityRow[]> => {
      const all: LocalityRow[] = [];
      for (let from = 0; ; from += LOCALITY_PAGE) {
        const { data, error } = await supabase
          .from('my_localities')
          .select('postcode, city, state, state_code')
          .order('state')
          .order('city')
          .order('postcode')
          .range(from, from + LOCALITY_PAGE - 1);
        if (error) throw error;
        const page = data ?? [];
        for (const r of page) {
          all.push({ postcode: r.postcode, city: r.city, state: r.state, stateCode: r.state_code });
        }
        if (page.length < LOCALITY_PAGE) break;
      }
      return all;
    },
  });

/** PR — Commander 2026-05-28: realtime invalidate the sofa customizer
 *  cache whenever commander edits the Model row (allowed_options) OR the
 *  master maintenance_config_history row (compartment meta). Mirrors the
 *  catalog realtime hook; mount inside the Configurator so a price/photo
 *  tweak in the Backend lands within ~300ms. */
export const useSofaCustomizerRealtime = (leadSkuId: string | undefined) => {
  const qc = useQueryClient();
  useEffect(() => {
    if (!leadSkuId) return;
    const channel = supabase
      .channel(`sofa-customizer-${leadSkuId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_models' },
        () => { void qc.invalidateQueries({ queryKey: ['sofa-customizer-data', leadSkuId] }); },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'maintenance_config_history' },
        () => { void qc.invalidateQueries({ queryKey: ['sofa-customizer-data', leadSkuId] }); },
      )
      .subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [qc, leadSkuId]);
};

// Realtime invalidate any product_bundles / product_compartments / product_size_variants
// row matching this productId. Used inside Configurator so Backend price tweaks
// land within ~300ms.
export const useProductPricingRealtime = (productId: string | undefined) => {
  const qc = useQueryClient();
  useEffect(() => {
    if (!productId) return;
    const channel = supabase
      .channel(`product-pricing-${productId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_bundles', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId, 'bundles'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_compartments', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId, 'compartments'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_fabrics', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId, 'fabrics'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_bedframe_colours', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['bedframe-colours', productId] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'product_size_variants', filter: `product_id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId, 'sizes'] }),
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'products', filter: `id=eq.${productId}` },
        () => void qc.invalidateQueries({ queryKey: ['product', productId] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc, productId]);
};

/* ─── Delivery fee config ─── */

export interface DeliveryFeeConfigRow {
  baseFee:                  number;
  crossCategoryFee:         number;
  mattressBedframeLeadDays: number;
  sofaLeadDays:             number;
}

export const useDeliveryFeeConfig = () =>
  useQuery({
    queryKey: ['delivery-fee-config'],
    queryFn: async (): Promise<DeliveryFeeConfigRow> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/delivery-fees`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /delivery-fees failed (${res.status})`);
      const body = (await res.json()) as {
        baseFee:                  number;
        crossCategoryFee:         number;
        mattressBedframeLeadDays: number;
        sofaLeadDays:             number;
      };
      return {
        baseFee:                  body.baseFee,
        crossCategoryFee:         body.crossCategoryFee,
        mattressBedframeLeadDays: body.mattressBedframeLeadDays,
        sofaLeadDays:             body.sofaLeadDays,
      };
    },
    staleTime: 60_000,
  });

/* ─── Sales staff (LockScreen pre-session list) ───────────────────────
 *
 * This query is unique: it MUST work BEFORE Supabase auth, because the
 * LockScreen shows the staff picker before anyone has logged in. So we
 * hit the unauthenticated Worker route directly (no bearer token), and
 * cache the last response in localStorage so cold-boot offline still
 * shows the picker. The route is authenticated by network position
 * (CF Worker behind the same domain) + showroomId filtering, not JWT.
 */

const SHOWROOM_ID = import.meta.env.VITE_POS_SHOWROOM_ID as string | undefined;

export interface SalesStaffRow {
  id: string;
  staffCode: string;
  name: string;
  initials: string;
  color: string;
}

const SALES_STAFF_CACHE_KEY = 'pos:sales-staff-cache';

/* ─── Sales stats (My Orders KPI cards) ────────────────────────────────
 *
 * Calendar-month totals + counts for the current sales user, scoped to
 * the user's home showroom. RLS would clamp this to "own orders only"
 * if hit via the JS client — the server endpoint uses service-role to
 * compute showroom-wide aggregates and then returns both numbers.
 */

export interface SalesStatsRow {
  monthLabel:     string;
  monthStart:     string;
  monthEnd:       string;
  staffName:      string;
  showroomTotal:  number;
  showroomCount:  number;
  personalTotal:  number;
  personalCount:  number;
}

export const useSalesStats = (enabled = true) =>
  useQuery({
    enabled,
    queryKey: ['pos', 'sales-stats'],
    staleTime: 60_000,
    queryFn: async (): Promise<SalesStatsRow> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token   = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/pos/sales-stats`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /pos/sales-stats failed (${res.status})`);
      return await res.json() as SalesStatsRow;
    },
  });

/* ─── Sofa Combo Pricing ──────────────────────────────────────────────
   Commander 2026-05-28: Sofa Combos defined in Backend = COSTING; the same
   rows surfaced in POS = SELLING PRICE. POS Quick Pick auto-renders one
   card per combo (combo.label + the price for the active seat height).
   ────────────────────────────────────────────────────────────────────── */

export type SofaPriceTier = 'PRICE_1' | 'PRICE_2' | 'PRICE_3';

export interface SofaComboRow {
  id: string;
  baseModel: string;
  modules: string[];
  tier: SofaPriceTier | null;
  customerId: string | null;
  pricesByHeight: Record<string, number | null>;
  label: string | null;
  effectiveFrom: string;
  deletedAt: string | null;
  notes: string;
  createdAt: string;
  updatedAt: string;
  createdBy: string | null;
}

/**
 * Fetch active sofa-combo rows. Pass `baseModel` to filter; omit for ALL.
 * Returns [] when the API is unreachable (combos are optional — Quick Pick
 * still works with the legacy BUNDLES path).
 *
 * 2026-05-28: POS doesn't yet have a clean POS-product → mfg_products.base_model
 * link, so the Configurator fetches ALL combos and shows them as a separate
 * "Combo Pricing" row. Each card carries the base_model chip so commander can
 * see at a glance which Model the combo applies to. Filtering by current Model
 * lands once the retail↔mfg bridge surfaces base_model on CatalogProduct.
 */
export const useSofaCombos = (baseModel?: string | null) =>
  useQuery({
    queryKey: ['sofa-combos', baseModel ?? 'all'],
    queryFn: async (): Promise<SofaComboRow[]> => {
      if (!API_URL) return [];
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) return [];  // POS may render anonymously; quietly skip
      const params = new URLSearchParams();
      if (baseModel) params.set('baseModel', baseModel);
      params.set('customerId', '__all__');  // 2990 is B2C — only default-scope rows
      const res = await fetch(
        `${API_URL}/sofa-combos?${params.toString()}`,
        { headers: { authorization: `Bearer ${token}` } },
      );
      if (!res.ok) return [];
      const body = (await res.json()) as { rules: SofaComboRow[] };
      return body.rules ?? [];
    },
    staleTime: 30_000,
  });

/* Commander 2026-05-28 — "Save as Quick Pick" from POS Customize.
   Persists the current cell layout as a new Sofa Combo row so it
   appears in the Quick Pick row next time. Backend Maintenance can
   then tweak the price tier / effective date later. */
export const useCreateSofaCombo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      baseModel: string;       // '' allowed (wildcard)
      modules: string[];
      tier: SofaPriceTier | null;
      pricesByHeight: Record<string, number | null>;  // centi
      label?: string | null;
      effectiveFrom: string;   // 'YYYY-MM-DD'
      notes?: string | null;
    }): Promise<SofaComboRow> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/sofa-combos`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          baseModel: body.baseModel,
          modules: body.modules,
          tier: body.tier,
          customerId: null,  // 2990 is B2C
          pricesByHeight: body.pricesByHeight,
          label: body.label ?? null,
          effectiveFrom: body.effectiveFrom,
          notes: body.notes ?? null,
        }),
      });
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
        throw new Error(`POST /sofa-combos failed (${res.status}): ${detail}`);
      }
      return (await res.json()) as SofaComboRow;
    },
    onSuccess: () => {
      // Combos refetch so the new card lands in Quick Pick on next render.
      void qc.invalidateQueries({ queryKey: ['sofa-combos'] });
    },
  });
};

/* Commander 2026-05-28 — POS-native "New Order" flow (Topic 4 path 2:
   customer-first). POSTs a minimal SO header to /mfg-sales-orders with
   empty items[]; items can be added later from the SO detail. Returns
   the new docNo so the caller navigates to /handover-confirmed/{docNo}. */
export const useNewOrderMutation = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: {
      debtorName: string;
      phone?: string;
      email?: string;
      address1?: string;
      address2?: string;
      customerState?: string;
      city?: string;
      postcode?: string;
      buildingType?: string;
      customerType?: string;
      note?: string;
    }): Promise<{ docNo: string }> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/mfg-sales-orders`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ ...body, items: [] }),
      });
      if (!res.ok) {
        let detail = '';
        try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text(); }
        throw new Error(`POST /mfg-sales-orders failed (${res.status}): ${detail}`);
      }
      const data = (await res.json()) as { docNo?: string; doc_no?: string };
      const docNo = data.docNo ?? data.doc_no ?? '';
      if (!docNo) throw new Error('no_doc_no_returned');
      return { docNo };
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['mfg-sales-orders'] });
    },
  });
};

export const useShowroomSalesStaff = () =>
  useQuery({
    queryKey: ['pos', 'sales-staff', SHOWROOM_ID ?? 'all'],
    queryFn: async (): Promise<SalesStaffRow[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const qs = SHOWROOM_ID ? `?showroomId=${encodeURIComponent(SHOWROOM_ID)}` : '';
      const res = await fetch(`${API_URL}/pos/sales-staff${qs}`);
      if (!res.ok) throw new Error(`GET /pos/sales-staff failed (${res.status})`);
      const rows = (await res.json()) as SalesStaffRow[];
      try { localStorage.setItem(SALES_STAFF_CACHE_KEY, JSON.stringify(rows)); } catch { /* quota */ }
      return rows;
    },
    staleTime: 5 * 60_000,
    placeholderData: () => {
      try {
        const cached = localStorage.getItem(SALES_STAFF_CACHE_KEY);
        if (cached) return JSON.parse(cached) as SalesStaffRow[];
      } catch { /* parse */ }
      return undefined;
    },
  });
