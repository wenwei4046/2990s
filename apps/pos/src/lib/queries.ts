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
