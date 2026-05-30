import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Personal Quick Picks — the salesperson's own saved sofa layouts, stored
 * per-device (localStorage). The central/global Quick Picks live in
 * `sofa_combo_pricing` (Master Admin curates them); this is the personal layer
 * (COST-SELL-SPLIT-PLAN D6). DB-backed cross-device sync is post-pilot.
 *
 * A pick is just a saved module layout — picking it drops the modules into the
 * build and prices through the same module + Combo engine, exactly like a
 * global combo pick. Mirrors `state/quotes.ts` (Zustand + persist).
 */
export interface PersonalQuickPick {
  id: string;
  /** auth.users.id of the salesperson who saved it; null if unknown. */
  staffId: string | null;
  /** mfg_products.base_model — scopes the pick to one sofa Model. */
  baseModel: string;
  label: string;
  /** Flat module ids (each a `cell.moduleId`), one per laid-out cell. */
  modules: string[];
  depth: string;
  savedAt: number;
}

interface QuickPicksState {
  picks: PersonalQuickPick[];
  /** Save a new personal pick. Returns the created row (with id + savedAt). */
  addPick: (input: Omit<PersonalQuickPick, 'id' | 'savedAt'>) => PersonalQuickPick;
  removePick: (id: string) => void;
  /** This staff's picks for one sofa Model (the configurator's "Yours" group). */
  listForStaff: (staffId: string | null, baseModel: string) => PersonalQuickPick[];
  clear: () => void;
}

let _seq = 0;
const nextId = (): string => `qp-${Date.now().toString(36)}-${(_seq++).toString(36)}`;

export const useQuickPicks = create<QuickPicksState>()(
  persist(
    (set, get) => ({
      picks: [],

      addPick(input) {
        const pick: PersonalQuickPick = { ...input, id: nextId(), savedAt: Date.now() };
        set({ picks: [pick, ...get().picks] });
        return pick;
      },

      removePick(id) {
        set({ picks: get().picks.filter((p) => p.id !== id) });
      },

      listForStaff(staffId, baseModel) {
        return get().picks.filter((p) => p.staffId === staffId && p.baseModel === baseModel);
      },

      clear() {
        set({ picks: [] });
      },
    }),
    {
      name: 'pos-quickpicks-v1',
      storage: createJSONStorage(() => localStorage),
    },
  ),
);
