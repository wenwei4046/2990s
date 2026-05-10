import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Cell, Depth } from '@2990s/shared';

/**
 * Cart line snapshot. The `total` field is what we display in the cart and
 * what the POS submits to POST /orders. The server recomputes the total from
 * current pricing tables and rejects with 409 if it drifts more than 0.5%.
 */
export interface SofaConfigSnapshot {
  kind: 'sofa';
  productId: string;
  productName: string;
  bundleId?: string;     // set when Quick-Pick
  cells?: Cell[];        // set when Custom-build
  depth?: Depth;
  total: number;
  summary: string;       // e.g. "3+L · Bundle"
}

export interface SizeConfigSnapshot {
  kind: 'size';
  productId: string;
  productName: string;
  sizeId: string;
  total: number;
  summary: string;       // e.g. "Queen"
  /** Paid-extra add-ons attached to this configured line (e.g. extra pillows
   *  beyond the included free ones). NOT included_addons — those are derived
   *  from product.included_addons server-side and don't add to the price. */
  addonExtras?: { addonId: string; qty: number }[];
}

// Flat-priced products (single price per product — mattresses, bedframes, sofas
// without modular configuration). Server validates against products.flat_price.
// (Bug #2 fix)
export interface FlatConfigSnapshot {
  kind: 'flat';
  productId: string;
  productName: string;
  total: number;
  summary: string;       // e.g. "Flat price"
}

export type CartConfig = SofaConfigSnapshot | SizeConfigSnapshot | FlatConfigSnapshot;

export interface CartLine {
  key: string;
  qty: number;
  config: CartConfig;
}

interface CartState {
  lines: CartLine[];
  addConfigured: (config: CartConfig, opts?: { editingKey?: string }) => string;
  setQty: (key: string, qty: number) => void;
  remove: (key: string) => void;
  clear: () => void;
  restore: (lines: CartLine[]) => void;
}

export const useCart = create<CartState>()(
  persist(
    (set, get) => ({
      lines: [],

      addConfigured(config, opts) {
        const editingKey = opts?.editingKey;
        if (editingKey && get().lines.some((l) => l.key === editingKey)) {
          set({ lines: get().lines.map((l) => (l.key === editingKey ? { ...l, config } : l)) });
          return editingKey;
        }
        const key = `cfg-${Math.random().toString(36).slice(2, 9)}`;
        set({ lines: [...get().lines, { key, qty: 1, config }] });
        return key;
      },

      setQty(key, qty) {
        if (qty < 1) {
          get().remove(key);
          return;
        }
        set({ lines: get().lines.map((l) => (l.key === key ? { ...l, qty } : l)) });
      },

      remove(key) {
        set({ lines: get().lines.filter((l) => l.key !== key) });
      },

      clear() {
        set({ lines: [] });
      },

      restore(lines) {
        set({ lines: lines.map((l) => ({ ...l })) });
      },
    }),
    {
      name: 'pos-cart-v1',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);

export const cartSubtotal = (lines: CartLine[]): number =>
  lines.reduce((sum, l) => sum + l.qty * l.config.total, 0);

export const cartItemCount = (lines: CartLine[]): number =>
  lines.reduce((sum, l) => sum + l.qty, 0);
