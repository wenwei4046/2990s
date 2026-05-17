import { useQuery } from '@tanstack/react-query';
import { supabase } from './supabase';

export interface OrderDetail {
  id: string;
  placed_at: string;
  customer_name: string;
  customer_email: string | null;
  customer_address: string | null;
  customer_address_line2: string | null;
  delivery_date: string | null;
  payment_method: string;
  paid: number;
  total: number;
  dominantCategory: { id: string; label: string; hero_image_key: string | null } | null;
  lines: { product_id: string; product_name: string; qty: number; line_total: number }[];
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
          id, placed_at, customer_name, customer_email,
          customer_address, customer_address_line2,
          delivery_date, payment_method, paid, total
        `)
        .eq('id', orderId)
        .maybeSingle();
      if (orderErr) throw orderErr;
      if (!row) throw new Error('not_found');

      const { data: items, error: itemErr } = await supabase
        .from('order_items')
        .select(`
          product_id, qty, line_total,
          products ( name, category_id )
        `)
        .eq('order_id', orderId)
        .eq('kind', 'product');
      if (itemErr) throw itemErr;

      const lines = (items ?? []).map((i: any) => ({
        product_id: i.product_id,
        product_name: i.products?.name ?? '',
        qty: i.qty,
        line_total: i.line_total,
      }));

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
        customer_name: row.customer_name,
        customer_email: row.customer_email,
        customer_address: [row.customer_address, row.customer_address_line2].filter(Boolean).join(', ') || null,
        customer_address_line2: row.customer_address_line2,
        delivery_date: row.delivery_date,
        payment_method: row.payment_method,
        paid: row.paid,
        total: row.total,
        dominantCategory,
        lines,
      };
    },
  });
