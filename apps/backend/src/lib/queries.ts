// Server-cache hooks. Library tables stale-forever (rarely change), products
// stale-30s (Realtime invalidates this in Phase 1.5).

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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

/* ─── Orders board (Phase 2 step G — list-only; Phase 3 swaps in 6-lane) ─── */

export type OrderLane =
  | 'received'
  | 'proceed'
  | 'logistics'
  | 'ready'
  | 'dispatched'
  | 'delivered'
  | 'cancelled';

export interface CartItem {
  productId: string;
  productName: string;
  productCat: string;
  supplierId: string | null;
  sku: string;
  size: string | null;
  colour: string | null;
  qty: number;
  imgKey: string | null;
  /** True when this (order_id, sku) already has a purchase_order_lines row.
   *  Used to skip already-purchased items in the PO scan modal so cross-supplier
   *  orders can be split across multiple POs. (Cross-supplier split-PO fix) */
  purchased: boolean;
}

export interface OrderListRow {
  id: string;
  placedAt: string;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
  customerCity: string | null;
  total: number;
  paid: number;
  lane: OrderLane;
  paymentMethod: string;
  showroomId: string;
  poIssued: boolean;
  slipState: 'none' | 'pending' | 'verified' | 'flagged';
  deliveryDate: string | null;
  staffName: string;
  staffInitials: string;
  staffColor: string;
  cart: CartItem[];
}

export const useOrders = () =>
  useQuery({
    queryKey: ['orders'],
    queryFn: async (): Promise<OrderListRow[]> => {
      // Two parallel reads: orders + their items, and the universe of
      // purchase_order_lines so we can mark each cart item as purchased or not.
      // RLS scopes both to authenticated coordinators.
      const [{ data, error }, { data: poLineRows, error: poErr }] = await Promise.all([
        supabase
          .from('orders')
          .select(`
            id, placed_at, customer_name, customer_phone,
            customer_address, customer_city,
            total, paid, lane, payment_method, showroom_id,
            po_issued, slip_state, delivery_date,
            staff:staff_id ( name, initials, color ),
            order_items (
              qty, kind, config,
              products ( id, name, category_id, supplier_id, sku, img_key, thumb_key )
            )
          `)
          .order('placed_at', { ascending: false })
          .limit(100),
        supabase
          .from('purchase_order_lines')
          .select('order_id, sku'),
      ]);
      if (error) throw error;
      if (poErr) throw poErr;

      // Set of "{order_id}|{sku}" already covered by some PO. Used per-cart-item
      // to mark `purchased: true`, which the PO scan modal then filters out.
      const purchased = new Set<string>(
        (poLineRows ?? []).map((l: any) => `${l.order_id}|${l.sku}`),
      );

      return (data ?? []).map((r: any) => ({
        id: r.id,
        placedAt: r.placed_at,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerAddress: r.customer_address ?? null,
        customerCity: r.customer_city ?? null,
        total: r.total,
        paid: r.paid ?? 0,
        lane: r.lane as OrderLane,
        paymentMethod: r.payment_method,
        showroomId: r.showroom_id,
        poIssued: r.po_issued ?? false,
        slipState: (r.slip_state ?? 'none') as OrderListRow['slipState'],
        deliveryDate: r.delivery_date ?? null,
        staffName: r.staff?.name ?? '—',
        staffInitials: r.staff?.initials ?? '?',
        staffColor: r.staff?.color ?? '#999999',
        cart: ((r.order_items ?? []) as any[])
          .filter((it) => it.kind === 'product' && it.products)
          .map((it) => ({
            productId: it.products.id,
            productName: it.products.name,
            productCat: it.products.category_id,
            supplierId: it.products.supplier_id,
            sku: it.products.sku,
            size: it.config?.size ?? null,
            colour: it.config?.colour ?? null,
            qty: it.qty,
            imgKey: it.products.thumb_key ?? it.products.img_key ?? null,
            purchased: purchased.has(`${r.id}|${it.products.sku}`),
          })),
      }));
    },
    staleTime: 5_000,
  });

export interface OrderDetail {
  id: string;
  placedAt: string;
  staffId: string;
  showroomId: string;
  lane: OrderLane;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  customerAddress: string | null;
  customerPostcode: string | null;
  customerCity: string | null;
  customerState: string | null;
  subtotal: number;
  addonTotal: number;
  total: number;
  paid: number;
  paymentMethod: string;
  approvalCode: string | null;
  notes: string | null;
  slipKey: string | null;
  slipState: 'none' | 'pending' | 'verified' | 'flagged';
  slipVerifiedBy: string | null;
  slipVerifiedAt: string | null;
  slipFlagReason: string | null;
  // Phase 4-C dispatch fields
  driverId: string | null;
  confirmedDeliveryDate: string | null;  // ISO date 'YYYY-MM-DD' or null
  confirmedWith: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  doSigned: boolean;
  doKey: string | null;
  deliveryDate: string | null;  // customer's expected — needed for override warning
  poIssued: boolean;
  poIssuedAt: string | null;     // ISO timestamp or null
  poIssuedBy: string | null;     // staff id or null
}

export const useOrderDetail = (orderId: string | null) =>
  useQuery({
    enabled: !!orderId,
    queryKey: ['order', orderId],
    queryFn: async (): Promise<OrderDetail> => {
      const { data, error } = await supabase
        .from('orders')
        .select(
          'id, placed_at, staff_id, showroom_id, lane, ' +
          'customer_name, customer_phone, customer_email, ' +
          'customer_address, customer_postcode, customer_city, customer_state, ' +
          'subtotal, addon_total, total, paid, ' +
          'payment_method, approval_code, notes, ' +
          'slip_key, slip_state, slip_verified_by, slip_verified_at, slip_flag_reason, ' +
          'driver_id, confirmed_delivery_date, confirmed_with, ' +
          'dispatched_at, delivered_at, do_signed, do_key, delivery_date, ' +
          'po_issued, po_issued_at, po_issued_by'
        )
        .eq('id', orderId!)
        .single();
      if (error || !data) throw error ?? new Error('order_not_found');
      const r = data as any;
      return {
        id: r.id,
        placedAt: r.placed_at,
        staffId: r.staff_id,
        showroomId: r.showroom_id,
        lane: r.lane as OrderLane,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        customerEmail: r.customer_email,
        customerAddress: r.customer_address,
        customerPostcode: r.customer_postcode,
        customerCity: r.customer_city,
        customerState: r.customer_state,
        subtotal: r.subtotal,
        addonTotal: r.addon_total,
        total: r.total,
        paid: r.paid,
        paymentMethod: r.payment_method,
        approvalCode: r.approval_code,
        notes: r.notes,
        slipKey: r.slip_key,
        slipState: r.slip_state,
        slipVerifiedBy: r.slip_verified_by,
        slipVerifiedAt: r.slip_verified_at,
        slipFlagReason: r.slip_flag_reason,
        driverId: r.driver_id,
        confirmedDeliveryDate: r.confirmed_delivery_date,
        confirmedWith: r.confirmed_with,
        dispatchedAt: r.dispatched_at,
        deliveredAt: r.delivered_at,
        doSigned: r.do_signed,
        doKey: r.do_key,
        deliveryDate: r.delivery_date,
        poIssued: r.po_issued,
        poIssuedAt: r.po_issued_at,
        poIssuedBy: r.po_issued_by,
      };
    },
  });

/* ─── Slip verification queue (Phase 4 sub-project B) ─── */

export interface SlipQueueRow {
  id: string;                       // order id (SO-XXXX)
  placedAt: string;
  customerName: string;
  customerPhone: string | null;
  total: number;
  paymentMethod: string;
  showroomId: string;
  slipKey: string | null;
  slipState: 'none' | 'pending' | 'verified' | 'flagged';
  slipVerifiedBy: string | null;
  slipVerifiedAt: string | null;
  slipFlagReason: string | null;
}

// Coordinator queue: every order whose slip is awaiting human review.
// Excludes cancelled lanes — coordinator shouldn't burn cycles on dead orders.
export const useSlipQueue = () =>
  useQuery({
    queryKey: ['slip-queue'],
    queryFn: async (): Promise<SlipQueueRow[]> => {
      const { data, error } = await supabase
        .from('orders')
        .select(
          'id, placed_at, customer_name, customer_phone, total, payment_method, showroom_id, ' +
          'slip_key, slip_state, slip_verified_by, slip_verified_at, slip_flag_reason',
        )
        .eq('slip_state', 'pending')
        .neq('lane', 'cancelled')
        .order('placed_at', { ascending: true })
        .limit(100);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        placedAt: r.placed_at,
        customerName: r.customer_name,
        customerPhone: r.customer_phone,
        total: r.total,
        paymentMethod: r.payment_method,
        showroomId: r.showroom_id,
        slipKey: r.slip_key,
        slipState: r.slip_state,
        slipVerifiedBy: r.slip_verified_by,
        slipVerifiedAt: r.slip_verified_at,
        slipFlagReason: r.slip_flag_reason,
      }));
    },
    staleTime: 5_000,
  });

// Realtime invalidate slip-queue on any orders row INSERT/UPDATE. The 5s
// staleTime above stays as a backstop in case the channel disconnects, but
// the live subscription means new uploads land instantly + verifies/flags
// remove the row in ~300ms instead of up to 5s. (T21 deferred work)
export const useSlipQueueRealtime = () => {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('slip-queue')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => void qc.invalidateQueries({ queryKey: ['slip-queue'] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
};

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

export interface PurchaseOrderLine {
  id: string;
  purchaseOrderId: string;
  orderId: string;
  sku: string;
  name: string;
  size: string | null;
  colour: string | null;
  qty: number;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplier: Supplier;
  createdAt: string;
  createdBy: { id: string; name: string };
  lines: PurchaseOrderLine[];
  referencedOrderIds: string[];
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

export const usePurchaseOrders = (orderId: string | null) =>
  useQuery({
    queryKey: ['purchase-orders', 'by-order', orderId],
    enabled: !!orderId,
    queryFn: async (): Promise<{ id: string; poNumber: string; createdAt: string }[]> => {
      if (!orderId) return [];
      // Fetch via purchase_order_lines → purchase_orders join
      const { data, error } = await supabase
        .from('purchase_order_lines')
        .select('purchase_orders ( id, po_number, created_at )')
        .eq('order_id', orderId);
      if (error) throw error;
      const seen = new Set<string>();
      const result: { id: string; poNumber: string; createdAt: string }[] = [];
      for (const row of data ?? []) {
        const po = (row as any).purchase_orders;
        if (po && !seen.has(po.id)) {
          seen.add(po.id);
          result.push({ id: po.id, poNumber: po.po_number, createdAt: po.created_at });
        }
      }
      return result;
    },
    staleTime: 30_000,
  });

/**
 * Realtime subscription on `orders`. Any INSERT/UPDATE/DELETE invalidates
 * the orders list query. Returns the latest payload of an INSERT so the
 * page can highlight a row or pop a toast — null in steady state.
 *
 * Requires migration 0007_orders_realtime.sql to add `orders` to the
 * supabase_realtime publication.
 *
 * onInsert is captured in a ref so callers don't need to memoize their
 * callback to keep the channel stable. Subscribing once on mount is the
 * intended behaviour — re-subscribing on every parent render would tear
 * down + recreate the channel and miss in-flight INSERTs.
 */
export const useOrdersRealtime = (onInsert?: (row: OrderListRow) => void) => {
  const qc = useQueryClient();
  const onInsertRef = useRef(onInsert);
  useEffect(() => { onInsertRef.current = onInsert; }, [onInsert]);

  useEffect(() => {
    const channel = supabase
      .channel('orders-board')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        (payload) => {
          void qc.invalidateQueries({ queryKey: ['orders'] });
          if (payload.eventType === 'INSERT' && onInsertRef.current) {
            const r = payload.new as Record<string, unknown>;
            onInsertRef.current({
              id: String(r.id),
              placedAt: String(r.placed_at),
              customerName: String(r.customer_name),
              customerPhone: (r.customer_phone as string | null) ?? null,
              customerAddress: (r.customer_address as string | null) ?? null,
              customerCity: (r.customer_city as string | null) ?? null,
              total: Number(r.total),
              paid: Number(r.paid ?? 0),
              lane: r.lane as OrderLane,
              paymentMethod: String(r.payment_method),
              showroomId: String(r.showroom_id),
              poIssued: Boolean(r.po_issued ?? false),
              slipState: ((r.slip_state as string) ?? 'none') as OrderListRow['slipState'],
              deliveryDate: (r.delivery_date as string | null) ?? null,
              staffName: '—',
              staffInitials: '?',
              staffColor: '#999999',
              cart: [],
            });
          }
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
};

/* ─── Addons admin (Phase 1 leftover) ─── */

export type AddonKind = 'qty' | 'floors_items';

export interface AddonRow {
  id: string;
  label: string;
  description: string | null;
  icon: string;
  kind: AddonKind;
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
          'id, label, description, icon, kind, price, per_floor_item, unit, default_qty, stock, enabled, sort_order, updated_at',
        )
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        label: r.label,
        description: r.description,
        icon: r.icon,
        kind: r.kind as AddonKind,
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
