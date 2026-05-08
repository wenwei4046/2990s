import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { cartSubtotal, type CartLine } from './cart';

/**
 * Saved quotes — local-only at pilot. Migrates to a Supabase `quotes` table
 * post-pilot per PORT_DESIGN §6 ("useQuotes — TBD post-pilot"). The id format
 * `Q-XXXX` is human-readable and printed on the quote slip.
 *
 * Save semantics (matches prototype/pos-app.jsx:141):
 * - If a quote already exists for this customer name, update it instead of
 *   creating a duplicate. Pressing Save twice in the same session never spams.
 * - First-time save creates Q-1001 + counts up.
 */
export interface SavedQuote {
  id: string;
  customerName: string;
  lines: CartLine[];
  subtotal: number;
  savedAt: number;
  updatedAt?: number;
  staffId?: string | null;
}

interface QuotesState {
  quotes: SavedQuote[];
  saveQuote: (input: { customerName: string; lines: CartLine[]; staffId?: string | null }) => SavedQuote;
  loadQuote: (id: string) => SavedQuote | undefined;
  removeQuote: (id: string) => void;
  clear: () => void;
}

export const useQuotes = create<QuotesState>()(
  persist(
    (set, get) => ({
      quotes: [],

      saveQuote({ customerName, lines, staffId }) {
        const subtotal = cartSubtotal(lines);
        const lc = customerName.trim().toLowerCase();
        const now = Date.now();
        const existing = get().quotes.find((q) => q.customerName.trim().toLowerCase() === lc);
        if (existing) {
          const updated: SavedQuote = {
            ...existing,
            lines: lines.map((l) => ({ ...l })),
            subtotal,
            updatedAt: now,
            staffId: staffId ?? existing.staffId ?? null,
          };
          set({ quotes: get().quotes.map((q) => (q.id === existing.id ? updated : q)) });
          return updated;
        }
        const id = `Q-${1000 + get().quotes.length + 1}`;
        const q: SavedQuote = {
          id,
          customerName,
          lines: lines.map((l) => ({ ...l })),
          subtotal,
          savedAt: now,
          staffId: staffId ?? null,
        };
        set({ quotes: [q, ...get().quotes] });
        return q;
      },

      loadQuote(id) {
        return get().quotes.find((q) => q.id === id);
      },

      removeQuote(id) {
        set({ quotes: get().quotes.filter((q) => q.id !== id) });
      },

      clear() {
        set({ quotes: [] });
      },
    }),
    {
      name: 'pos-quotes-v1',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
