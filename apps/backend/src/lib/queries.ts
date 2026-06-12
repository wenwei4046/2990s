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

// CompartmentLibrary / BundleLibrary / SizeLibrary hooks removed 2026-06-04 —
// their sole consumer was the legacy-retail PricingEditor (sofa product_bundles
// pricing UI), retired when product_bundles was emptied and the 15 legacy
// sofa_build products were hidden. Live sofa pricing is the mfg layer
// (mfg_products + sofa_combo_pricing).

export interface FabricLibrary {
  id: string;
  label: string;
  tier: string;
  defaultSurcharge: number;
  active: boolean;
  sortOrder: number;
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

// All fabrics (incl. inactive) so admin can re-enable.
export const useFabricLibrary = () =>
  useQuery({
    queryKey: ['library', 'fabrics'],
    queryFn: async (): Promise<FabricLibrary[]> => {
      const { data, error } = await supabase
        .from('fabric_library')
        .select('id, label, tier, default_surcharge, active, sort_order')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        tier: r.tier,
        defaultSurcharge: r.default_surcharge,
        active: r.active,
        sortOrder: r.sort_order,
      }));
    },
    ...LIBRARY_OPTS,
  });


export interface DriverRow {
  id: string;
  driverCode: string;
  name: string;
  phone: string;
  icNumber: string | null;
  vehicle: string | null;
  active: boolean;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  whatsappNumber: string | null;
  email: string | null;
}

export const useDrivers = () =>
  useQuery({
    queryKey: ['drivers'],
    queryFn: async (): Promise<DriverRow[]> => {
      const { data, error } = await supabase
        .from('drivers')
        .select('id, driver_code, name, phone, ic_number, vehicle, active')
        .order('driver_code');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        driverCode: r.driver_code,
        name: r.name,
        phone: r.phone,
        icNumber: r.ic_number,
        vehicle: r.vehicle,
        active: r.active,
      }));
    },
    staleTime: 60_000,
  });

export const useSuppliers = () =>
  useQuery({
    queryKey: ['suppliers'],
    queryFn: async (): Promise<Supplier[]> => {
      const { data, error } = await supabase
        .from('suppliers')
        .select('id, code, name, whatsapp_number, email')
        .order('code');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        code: r.code,
        name: r.name,
        whatsappNumber: r.whatsapp_number,
        email: r.email,
      }));
    },
    staleTime: 60_000,
  });

/* ─── Addons admin (Phase 1 leftover) ─── */

export type AddonKind = 'qty' | 'floors_items';

export interface AddonRow {
  id: string;
  label: string;
  description: string | null;
  icon: string;
  kind: AddonKind;
  category: string | null;
  price: number;
  perFloorItem: number | null;
  unit: string | null;
  defaultQty: number;
  stock: number | null;
  enabled: boolean;
  sortOrder: number;
  updatedAt: string;
}

export const useAddons = () =>
  useQuery({
    queryKey: ['addons'],
    queryFn: async (): Promise<AddonRow[]> => {
      const { data, error } = await supabase
        .from('addons')
        .select(
          'id, label, description, icon, kind, category, price, per_floor_item, unit, default_qty, stock, enabled, sort_order, updated_at',
        )
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        label: r.label,
        description: r.description,
        icon: r.icon,
        kind: r.kind as AddonKind,
        category: r.category,
        price: r.price,
        perFloorItem: r.per_floor_item,
        unit: r.unit,
        defaultQty: r.default_qty,
        stock: r.stock,
        enabled: r.enabled,
        sortOrder: r.sort_order,
        updatedAt: r.updated_at,
      }));
    },
    staleTime: 60_000,
  });
