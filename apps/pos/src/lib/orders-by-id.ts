import { useQuery } from '@tanstack/react-query';
import { describeSofaLine } from '@2990s/shared';
import { supabase } from './supabase';

export interface OrderDetail {
  id: string;
  placed_at: string;
  customer_name: string;
  customer_phone: string | null;
  customer_email: string | null;
  customer_address: string | null;           // line 1 + line 2 joined
  customer_address_line2: string | null;
  customer_postcode: string | null;
  customer_city: string | null;
  customer_state: string | null;
  delivery_date: string | null;
  payment_method: string;
  paid: number;
  subtotal: number;
  addon_total: number;
  delivery_fee_base: number;
  delivery_fee_cross_category: number;
  delivery_fee_additional: number;
  total: number;
  signature_data: string | null;
  showroom: { id: string; name: string; address: string | null; phone: string | null } | null;
  dominantCategory: { id: string; label: string; hero_image_key: string | null } | null;
  lines: {
    product_id:   string;
    product_name: string;
    product_sku:  string | null;
    qty:          number;
    unit_price:   number;
    line_total:   number;
    /** Config-derived line description (e.g. "2-Seater + 2 Power slide",
     *  "1A-LHF + 2A-RHF"). null when the product has no describable config. */
    description:  string | null;
  }[];
}

export const useOrderById = (orderId: string | undefined) =>
  useQuery({
    enabled: !!orderId,
    queryKey: ['order-detail', orderId],
    queryFn: async (): Promise<OrderDetail> => {
      if (!orderId) throw new Error('no id');

      const { data: row, error: orderErr } = await supabase
        .from('orders')
        .select(`
          id, placed_at,
          customer_name, customer_phone, customer_email,
          customer_address, customer_address_line2,
          customer_postcode, customer_city, customer_state,
          delivery_date, payment_method, paid,
          subtotal, addon_total,
          delivery_fee_base, delivery_fee_cross_category, delivery_fee_additional,
          total,
          signature_data,
          showroom_id
        `)
        .eq('id', orderId)
        .maybeSingle();
      if (orderErr) throw orderErr;
      if (!row) throw new Error('not_found');

      const { data: items, error: itemErr } = await supabase
        .from('order_items')
        .select(`
          product_id, qty, unit_price, line_total, config,
          products ( name, sku, category_id )
        `)
        .eq('order_id', orderId)
        .eq('kind', 'product');
      if (itemErr) throw itemErr;

      const lines = (items ?? []).map((i: any) => {
        const config = i.config;
        let description: string | null = null;
        if (config && config.kind === 'sofa') {
          description = describeSofaLine(config);
          if (config.depth) description += ` · ${config.depth}"`;  // F5: show depth
        }
        return {
          product_id:   i.product_id,
          product_name: i.products?.name ?? '',
          product_sku:  i.products?.sku ?? null,
          qty:          i.qty,
          unit_price:   i.unit_price ?? 0,
          line_total:   i.line_total,
          description,
        };
      });

      let showroom: OrderDetail['showroom'] = null;
      if (row.showroom_id) {
        const { data: sr } = await supabase
          .from('showrooms')
          .select('id, name, address, phone')
          .eq('id', row.showroom_id)
          .maybeSingle();
        if (sr) showroom = sr as OrderDetail['showroom'];
      }

      const byCat = new Map<string, number>();
      for (const i of items ?? []) {
        const cat: string | null = (i as any).products?.category_id ?? null;
        if (cat) byCat.set(cat, (byCat.get(cat) ?? 0) + (i.line_total as number));
      }
      const dominantId = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      let dominantCategory: OrderDetail['dominantCategory'] = null;
      if (dominantId) {
        const { data: cat } = await supabase
          .from('categories')
          .select('id, label, hero_image_key')
          .eq('id', dominantId)
          .maybeSingle();
        if (cat) dominantCategory = cat as any;
      }

      return {
        id: row.id,
        placed_at: row.placed_at,
        customer_name:               row.customer_name,
        customer_phone:              row.customer_phone ?? null,
        customer_email:              row.customer_email,
        customer_address:            [row.customer_address, row.customer_address_line2].filter(Boolean).join(', ') || null,
        customer_address_line2:      row.customer_address_line2,
        customer_postcode:           row.customer_postcode ?? null,
        customer_city:               row.customer_city ?? null,
        customer_state:              row.customer_state ?? null,
        delivery_date:               row.delivery_date,
        payment_method:              row.payment_method,
        paid:                        row.paid,
        subtotal:                    row.subtotal ?? 0,
        addon_total:                 row.addon_total ?? 0,
        delivery_fee_base:           row.delivery_fee_base ?? 0,
        delivery_fee_cross_category: row.delivery_fee_cross_category ?? 0,
        delivery_fee_additional:     row.delivery_fee_additional ?? 0,
        total:                       row.total,
        signature_data:              row.signature_data ?? null,
        showroom,
        dominantCategory,
        lines,
      };
    },
  });
