import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  pricing_kind: 'sofa_build' | 'size_variants' | 'flat' | 'tbc';
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
      const { data, error } = await supabase
        .from('products')
        .select(
          'id, sku, name, detail, size_display, img_key, thumb_key, pricing_kind, flat_price, recliner_upgrade_price, stock, low_at, visible, category_id, series_id, included_addons, updated_at',
        )
        .eq('id', productId)
        .maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('not_found');
      return data as typeof data & { included_addons: { addonId: string; qty: number }[] };
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

export const useProductSizes = (productId: string | undefined) =>
  useQuery({
    enabled: !!productId,
    queryKey: ['product', productId, 'sizes'],
    queryFn: async (): Promise<ProductSizeRow[]> => {
      if (!productId) throw new Error('no productId');
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
