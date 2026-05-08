// Server-cache hooks. Library tables stale-forever (rarely change), products
// stale-30s (Realtime invalidates this in Phase 1.5).

import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export interface Category {
  id: string;
  label: string;
  icon: string;
  tbc: boolean;
  sortOrder: number;
}

export interface Series {
  id: string;
  label: string;
  active: boolean;
}

export interface CompartmentLibrary {
  id: string;
  compGroup: '1-seater' | '2-seater' | 'Corner' | 'L-Shape' | 'Accessory';
  label: string;
  widthCm: number;
  depthCm: number;
  cushions: number;
  defaultPrice: number;
  artFilename: string | null;
  isAccessory: boolean;
  sortOrder: number;
}

export interface BundleLibrary {
  id: string;
  label: string;
  sub: string;
  signature: string;
  baseWidthCm: number;
  baseDepthCm: number;
  cushions: number;
  defaultPrice: number;
  sortOrder: number;
}

export interface SizeLibrary {
  id: string;
  label: string;
  widthCm: number;
  lengthCm: number;
  sortOrder: number;
}

export interface ProductRow {
  id: string;
  sku: string;
  categoryId: string;
  seriesId: string | null;
  pricingKind: 'sofa_build' | 'size_variants' | 'flat' | 'tbc';
  name: string;
  detail: string | null;
  sizeDisplay: string | null;
  imgKey: string | null;
  thumbKey: string | null;
  stock: number;
  lowAt: number;
  visible: boolean;
  flatPrice: number | null;
  reclinerUpgradePrice: number | null;
  updatedAt: string;
}

const LIBRARY_OPTS = { staleTime: Infinity, gcTime: Infinity };

export const useCategories = () =>
  useQuery({
    queryKey: ['library', 'categories'],
    queryFn: async (): Promise<Category[]> => {
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
    ...LIBRARY_OPTS,
  });

export const useSeries = () =>
  useQuery({
    queryKey: ['library', 'series'],
    queryFn: async (): Promise<Series[]> => {
      const { data, error } = await supabase
        .from('series')
        .select('id, label, active')
        .order('label');
      if (error) throw error;
      return data ?? [];
    },
    ...LIBRARY_OPTS,
  });

export const useCompartmentLibrary = () =>
  useQuery({
    queryKey: ['library', 'compartments'],
    queryFn: async (): Promise<CompartmentLibrary[]> => {
      const { data, error } = await supabase
        .from('compartment_library')
        .select(
          'id, comp_group, label, width_cm, depth_cm, cushions, default_price, art_filename, is_accessory, sort_order',
        )
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        compGroup: r.comp_group,
        label: r.label,
        widthCm: r.width_cm,
        depthCm: r.depth_cm,
        cushions: r.cushions,
        defaultPrice: r.default_price,
        artFilename: r.art_filename,
        isAccessory: r.is_accessory,
        sortOrder: r.sort_order,
      }));
    },
    ...LIBRARY_OPTS,
  });

export const useBundleLibrary = () =>
  useQuery({
    queryKey: ['library', 'bundles'],
    queryFn: async (): Promise<BundleLibrary[]> => {
      const { data, error } = await supabase
        .from('bundle_library')
        .select(
          'id, label, sub, signature, base_width_cm, base_depth_cm, cushions, default_price, sort_order',
        )
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        sub: r.sub,
        signature: r.signature,
        baseWidthCm: r.base_width_cm,
        baseDepthCm: r.base_depth_cm,
        cushions: r.cushions,
        defaultPrice: r.default_price,
        sortOrder: r.sort_order,
      }));
    },
    ...LIBRARY_OPTS,
  });

export const useSizeLibrary = () =>
  useQuery({
    queryKey: ['library', 'sizes'],
    queryFn: async (): Promise<SizeLibrary[]> => {
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
    ...LIBRARY_OPTS,
  });

export const useProducts = () =>
  useQuery({
    queryKey: ['products'],
    queryFn: async (): Promise<ProductRow[]> => {
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, sku, category_id, series_id, pricing_kind, name, detail, size_display, img_key, thumb_key, stock, low_at, visible, flat_price, recliner_upgrade_price, updated_at',
        )
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        sku: r.sku,
        categoryId: r.category_id,
        seriesId: r.series_id,
        pricingKind: r.pricing_kind,
        name: r.name,
        detail: r.detail,
        sizeDisplay: r.size_display,
        imgKey: r.img_key,
        thumbKey: r.thumb_key,
        stock: r.stock,
        lowAt: r.low_at,
        visible: r.visible,
        flatPrice: r.flat_price,
        reclinerUpgradePrice: r.recliner_upgrade_price,
        updatedAt: r.updated_at,
      }));
    },
    staleTime: 30_000,
  });

// Pricing rows for a single product — fetched only when editing.
export interface ProductCompartmentRow {
  compartmentId: string;
  active: boolean;
  price: number;
}
export interface ProductBundleRow {
  bundleId: string;
  active: boolean;
  price: number;
}
export interface ProductSizeRow {
  sizeId: string;
  active: boolean;
  price: number;
}

export const useProductPricing = (productId: string | null, pricingKind: ProductRow['pricingKind'] | null) =>
  useQuery({
    enabled: !!productId && (pricingKind === 'sofa_build' || pricingKind === 'size_variants'),
    queryKey: ['product', productId, 'pricing', pricingKind],
    queryFn: async () => {
      if (!productId) throw new Error('no productId');

      if (pricingKind === 'sofa_build') {
        const [comps, bundles] = await Promise.all([
          supabase
            .from('product_compartments')
            .select('compartment_id, active, price')
            .eq('product_id', productId),
          supabase
            .from('product_bundles')
            .select('bundle_id, active, price')
            .eq('product_id', productId),
        ]);
        if (comps.error) throw comps.error;
        if (bundles.error) throw bundles.error;
        return {
          kind: 'sofa_build' as const,
          compartments: (comps.data ?? []).map((r) => ({
            compartmentId: r.compartment_id,
            active: r.active,
            price: r.price,
          })),
          bundles: (bundles.data ?? []).map((r) => ({
            bundleId: r.bundle_id,
            active: r.active,
            price: r.price,
          })),
        };
      }

      // size_variants
      const sizes = await supabase
        .from('product_size_variants')
        .select('size_id, active, price')
        .eq('product_id', productId);
      if (sizes.error) throw sizes.error;
      return {
        kind: 'size_variants' as const,
        sizes: (sizes.data ?? []).map((r) => ({
          sizeId: r.size_id,
          active: r.active,
          price: r.price,
        })),
      };
    },
  });
