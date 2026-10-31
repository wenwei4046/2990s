// ----------------------------------------------------------------------------
// modular-bulk — Modular › a category's ⋯ › Edit several models (owner
// 2026-11-01: "click this can select the same modular table for the category,
// then when I turn on, I can turn on multiple or selected models").
//
// It is a Model's own Allowed Options drawer, over several Models of one
// category. What the person changes is held as EDITS — this option on, that one
// off — never as a copy of any one Model's options, so every Model keeps
// whatever it was not told to change. Save re-reads each Model it is about to
// write (its card may have been saved since the list loaded) and applies the
// edits to what it reads.
//
// The rules are the single drawer's, Model by Model:
// - each Model starts from seedModularOptions, as its card does;
// - Show in POS is the SKUs' shelf flag (show-in-pos.ts);
// - unticking a sofa accessory drops a Needed-to-order kind it was the last
//   piece of, and a kind can only be needed where a piece of it is offered;
// - a Sofa Accessory put back on the sofa loses its own colour list.
//
// One rule is this drawer's own: a COMPARTMENT turned on reaches only the
// Models that already have its SKU. Houzs creates the SKU, unpriced, when a
// compartment is ticked on a Model without one (its PATCH /product-models
// auto-create, Chairman 2026-06-02) — an unpriced module the tablet prices at
// RM 0 (CLAUDE.md, "Unpriced sofa modules"). Owner 2026-11-01: this changes
// Modular only, not Houzs ERP. A Model without the SKU keeps the compartment
// off and is named; ticking it on that Model's own card still creates the SKU.
// ----------------------------------------------------------------------------

import type { MaintenanceConfig } from './mfg-products-queries';
import type { AllowedOptions, ProductModelRow } from './product-models-queries';
import { isSingleSkuCategory } from './product-categories';
import { seedModularOptions } from './modular-options';
import { modelActiveAfter, modelShownInPos, skusToShelve, type ShelfSku } from './show-in-pos';
import {
  guessAccessoryRole,
  neededKindsOf,
  readAccessoryOnSofa,
  readAccessoryPlacement,
  readSofaAccessoriesNeeded,
  readSofaAccessoryIds,
  type SofaAccessoryRole,
} from '../sofa-accessories';

/* ─── Inputs ───────────────────────────────────────────────────────────── */

/** A SKU as the drawer needs it: its shelf flag, and its code for the
 *  compartment check. */
export type BulkSku = ShelfSku & { code?: string | null };

export type BulkModel = {
  id: string;
  name: string;
  model_code: string;
  category: string;
  active: boolean;
  allowed_options: AllowedOptions | null;
  skus: readonly BulkSku[];
};

/** A Sofa Accessory Model, as a sofa's ticked ids read it. */
export type BulkAccessory = { id: string; role: SofaAccessoryRole; onSofa: boolean };

export type BulkContext = {
  cfg: MaintenanceConfig;
  /** Every Sofa Accessory Model (category FABRIC_ACCESSORY). */
  accessories: readonly BulkAccessory[];
};

export const bulkModelOf = (row: Pick<ProductModelRow, 'id' | 'name' | 'model_code' | 'category' | 'active' | 'allowed_options'>, skus: readonly BulkSku[]): BulkModel => ({
  id: row.id,
  name: row.name,
  model_code: row.model_code,
  category: row.category,
  active: row.active,
  allowed_options: row.allowed_options ?? null,
  skus,
});

/** Its placement's role, or — until one is set — the one its name says, as
 *  the single drawer reads it. */
export const bulkAccessoryOf = (row: Pick<ProductModelRow, 'id' | 'name' | 'model_code' | 'allowed_options'>): BulkAccessory => ({
  id: row.id,
  role: readAccessoryPlacement(row.allowed_options)?.role ?? guessAccessoryRole(row.name, row.model_code),
  onSofa: readAccessoryOnSofa(row.allowed_options),
});

/* ─── Edits ────────────────────────────────────────────────────────────── */

export type BulkChipPool =
  | 'sizes' | 'compartments' | 'gaps' | 'leg_heights' | 'divan_heights'
  | 'specials' | 'fabrics' | 'sofa_accessories';

/** What the person has changed. Absent = each Model stays as it is. */
export type BulkEdits = {
  chips: Partial<Record<BulkChipPool, Record<string, boolean>>>;
  /** Needed to order, by kind. */
  needed: Partial<Record<SofaAccessoryRole, boolean>>;
  /** Single-SKU categories. */
  showInPos?: boolean;
  /** Sofa Accessory. */
  onSofa?: boolean;
};

export const NO_BULK_EDITS: BulkEdits = { chips: {}, needed: {} };

export type BulkEditKey =
  | { kind: 'chip'; pool: BulkChipPool; value: string }
  | { kind: 'needed'; role: SofaAccessoryRole }
  | { kind: 'showInPos' }
  | { kind: 'onSofa' };

export function bulkEditOf(edits: BulkEdits, key: BulkEditKey): boolean | undefined {
  switch (key.kind) {
    case 'chip': return edits.chips[key.pool]?.[key.value];
    case 'needed': return edits.needed[key.role];
    case 'showInPos': return edits.showInPos;
    case 'onSofa': return edits.onSofa;
  }
}

/** `edits` with one edit set — or, for undefined, taken away. */
export function withBulkEdit(edits: BulkEdits, key: BulkEditKey, value: boolean | undefined): BulkEdits {
  const next: BulkEdits = { ...edits, chips: { ...edits.chips }, needed: { ...edits.needed } };
  switch (key.kind) {
    case 'chip': {
      const pool = { ...(next.chips[key.pool] ?? {}) };
      if (value === undefined) delete pool[key.value];
      else pool[key.value] = value;
      if (Object.keys(pool).length > 0) next.chips[key.pool] = pool;
      else delete next.chips[key.pool];
      break;
    }
    case 'needed':
      if (value === undefined) delete next.needed[key.role];
      else next.needed[key.role] = value;
      break;
    case 'showInPos':
      if (value === undefined) delete next.showInPos;
      else next.showInPos = value;
      break;
    case 'onSofa':
      if (value === undefined) delete next.onSofa;
      else next.onSofa = value;
      break;
  }
  return next;
}

export function bulkEditCount(edits: BulkEdits): number {
  return Object.values(edits.chips).reduce((n, pool) => n + Object.keys(pool ?? {}).length, 0)
    + Object.keys(edits.needed).length
    + (edits.showInPos === undefined ? 0 : 1)
    + (edits.onSofa === undefined ? 0 : 1);
}

/* ─── One Model under the edits ────────────────────────────────────────── */

/** The pools each category's drawer shows. A Sofa Accessory has fabrics only
 *  while it is off the sofa (sold on its own, in its own colours). */
const POOLS_OF: Record<string, readonly BulkChipPool[]> = {
  SOFA: ['sizes', 'compartments', 'leg_heights', 'specials', 'fabrics', 'sofa_accessories'],
  BEDFRAME: ['sizes', 'gaps', 'leg_heights', 'divan_heights', 'specials', 'fabrics'],
  MATTRESS: ['sizes', 'specials'],
};

function poolApplies(category: string, pool: BulkChipPool, options: AllowedOptions): boolean {
  if (category === 'FABRIC_ACCESSORY') return pool === 'fabrics' && !readAccessoryOnSofa(options);
  return (POOLS_OF[category] ?? []).includes(pool);
}

/** Whether a sofa Model has the SKU a compartment is sold as — `MODEL-comp`,
 *  case-insensitive, as Houzs looks for it before creating one (HC-0176). */
export function hasCompartmentSku(model: Pick<BulkModel, 'model_code' | 'skus'>, comp: string): boolean {
  const want = `${model.model_code}-${comp}`.toUpperCase();
  return model.skus.some((s) => (s.code ?? '').toUpperCase() === want);
}

/** The accessories a sofa's ticked ids offer on its canvas: the ones on the sofa. */
export function bulkOffered(ids: readonly string[], ctx: BulkContext): Array<{ modelId: string; role: SofaAccessoryRole }> {
  return ctx.accessories
    .filter((a) => a.onSofa && ids.includes(a.id))
    .map((a) => ({ modelId: a.id, role: a.role }));
}

const sameList = (a: readonly unknown[], b: readonly unknown[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

function setValue(options: AllowedOptions, pool: BulkChipPool, value: string, on: boolean): void {
  const rec = options as Record<string, unknown>;
  const cur = Array.isArray(rec[pool]) ? (rec[pool] as unknown[]) : null;
  const has = cur?.includes(value) ?? false;
  if (on && !has) rec[pool] = [...(cur ?? []), value];
  else if (!on && has) rec[pool] = cur!.filter((x) => x !== value);
}

/** Sofa accessories, then Needed to order on what they leave offered. */
function applyAccessoryEdits(before: AllowedOptions, after: AllowedOptions, edits: BulkEdits, ctx: BulkContext): void {
  const idsBefore = readSofaAccessoryIds(before);
  let ids = [...idsBefore];
  for (const [id, on] of Object.entries(edits.chips.sofa_accessories ?? {})) {
    if (on && !ids.includes(id)) ids.push(id);
    else if (!on && ids.includes(id)) ids = ids.filter((x) => x !== id);
  }
  if (!sameList(ids, idsBefore)) after.sofa_accessories = ids;

  const neededBefore = readSofaAccessoriesNeeded(before, bulkOffered(idsBefore, ctx));
  const kinds = neededKindsOf(bulkOffered(ids, ctx));
  const on = new Set(neededBefore.filter((k) => kinds.includes(k)));
  for (const [kind, want] of Object.entries(edits.needed) as Array<[SofaAccessoryRole, boolean]>) {
    if (want && kinds.includes(kind)) on.add(kind);
    else if (!want) on.delete(kind);
  }
  const neededAfter = kinds.filter((k) => on.has(k));
  // Untouched, an earlier save's shape (#818 / #819) stays as it was.
  if (!sameList(neededAfter, neededBefore)) {
    if (neededAfter.length > 0) after.sofa_accessories_needed = neededAfter;
    else delete after.sofa_accessories_needed;
  }
}

export type BulkView = {
  model: BulkModel;
  /** The Model's options as its own card opens them. */
  before: AllowedOptions;
  /** …with the edits applied: what Save writes. */
  after: AllowedOptions;
  /** Show in POS after the edits — single-SKU categories; null otherwise. */
  shown: boolean | null;
  /** Compartments the edits turn on that this Model has no SKU for: left off. */
  skippedCompartments: string[];
};

export function bulkView(model: BulkModel, edits: BulkEdits, ctx: BulkContext): BulkView {
  const before = seedModularOptions(model, ctx.cfg);
  const after = JSON.parse(JSON.stringify(before)) as AllowedOptions;
  const skippedCompartments: string[] = [];

  // On or off the sofa first: an accessory's own colours are for off only.
  if (model.category === 'FABRIC_ACCESSORY' && edits.onSofa !== undefined) {
    const was = readAccessoryOnSofa(after);
    if (edits.onSofa && !was) {
      delete after.on_sofa;
      delete after.fabrics;
    } else if (!edits.onSofa && was) {
      after.on_sofa = false;
    }
  }

  for (const [pool, values] of Object.entries(edits.chips) as Array<[BulkChipPool, Record<string, boolean>]>) {
    if (pool === 'sofa_accessories' || !poolApplies(model.category, pool, after)) continue;
    for (const [value, on] of Object.entries(values)) {
      const ticked = Array.isArray(after.compartments) && after.compartments.includes(value);
      if (pool === 'compartments' && on && !ticked && !hasCompartmentSku(model, value)) {
        skippedCompartments.push(value);
        continue;
      }
      setValue(after, pool, value, on);
    }
  }
  if (model.category === 'SOFA') applyAccessoryEdits(before, after, edits, ctx);

  const shown = isSingleSkuCategory(model.category)
    ? (edits.showInPos ?? modelShownInPos(model.active, model.skus))
    : null;
  return { model, before, after, shown, skippedCompartments };
}

/* ─── Across the picked Models ─────────────────────────────────────────── */

/** How many of the picked Models an option is on for, out of those it is an
 *  option of. */
export type BulkTally = { on: number; of: number };
export type BulkState = 'on' | 'off' | 'mixed';

export const bulkState = ({ on, of }: BulkTally): BulkState =>
  on === 0 ? 'off' : on === of ? 'on' : 'mixed';

/** Whether a key reads on for one Model after the edits; null when it is not
 *  one of that Model's options. */
function onIn(v: BulkView, key: BulkEditKey, ctx: BulkContext): boolean | null {
  switch (key.kind) {
    case 'showInPos':
      return v.shown;
    case 'onSofa':
      return v.model.category === 'FABRIC_ACCESSORY' ? readAccessoryOnSofa(v.after) : null;
    case 'needed': {
      if (v.model.category !== 'SOFA') return null;
      const offered = bulkOffered(readSofaAccessoryIds(v.after), ctx);
      if (!neededKindsOf(offered).includes(key.role)) return null;
      return readSofaAccessoriesNeeded(v.after, offered).includes(key.role);
    }
    case 'chip': {
      if (!poolApplies(v.model.category, key.pool, v.after)) return null;
      const arr = (v.after as Record<string, unknown>)[key.pool];
      return Array.isArray(arr) && arr.includes(key.value);
    }
  }
}

export function bulkTally(views: readonly BulkView[], key: BulkEditKey, ctx: BulkContext): BulkTally {
  let on = 0;
  let of = 0;
  for (const v of views) {
    const r = onIn(v, key, ctx);
    if (r === null) continue;
    of += 1;
    if (r) on += 1;
  }
  return { on, of };
}

/** A tapped option's next edit, from how the picked Models read without it.
 *  Tapping goes on → off → back as they were, skipping a step that would look
 *  the same:
 *    on for some:  as they were → on → off → as they were
 *    on for all:   as they were → off → as they were
 *    on for none:  as they were → on → as they were */
export function nextBulkEdit(current: boolean | undefined, without: BulkState): boolean | undefined {
  if (current === undefined) return without !== 'on';
  if (current) return without === 'off' ? undefined : false;
  return without === 'off' ? true : undefined;
}

export function toggleBulkEdit(
  models: readonly BulkModel[],
  edits: BulkEdits,
  key: BulkEditKey,
  ctx: BulkContext,
): BulkEdits {
  const without = withBulkEdit(edits, key, undefined);
  const state = bulkState(bulkTally(models.map((m) => bulkView(m, without, ctx)), key, ctx));
  return withBulkEdit(edits, key, nextBulkEdit(bulkEditOf(edits, key), state));
}

/** "All on" / "All off" over several keys (a fabric series): each is set, or
 *  left alone where the picked Models already read that way. */
export function setBulkEdits(
  models: readonly BulkModel[],
  edits: BulkEdits,
  keys: readonly BulkEditKey[],
  on: boolean,
  ctx: BulkContext,
): BulkEdits {
  const without = keys.reduce((e, k) => withBulkEdit(e, k, undefined), edits);
  const views = models.map((m) => bulkView(m, without, ctx));
  return keys.reduce((e, k) => {
    const already = bulkState(bulkTally(views, k, ctx)) === (on ? 'on' : 'off');
    return withBulkEdit(e, k, already ? undefined : on);
  }, edits);
}

/* ─── Saving ───────────────────────────────────────────────────────────── */

export type BulkPlan = {
  id: string;
  name: string;
  /** PATCH /product-models/:id — only what changes; null when nothing does. */
  patch: { allowedOptions?: AllowedOptions; active?: boolean } | null;
  /** The SKUs Show in POS puts on or takes off the shelf; null for none. */
  shelve: { skuIds: string[]; on: boolean } | null;
  skippedCompartments: string[];
};

export const planChanges = (p: BulkPlan): boolean => p.patch !== null || p.shelve !== null;

/** What Save writes to one Model. Options go whole, seeded, as the single
 *  drawer's Save sends them — but only when the edits change them. */
export function bulkPlanOf(view: BulkView, edits: BulkEdits): BulkPlan {
  const { model, before, after } = view;
  const optionsChanged = JSON.stringify(before) !== JSON.stringify(after);
  const show = isSingleSkuCategory(model.category) ? edits.showInPos : undefined;
  const active = show === undefined ? model.active : modelActiveAfter(model.active, model.skus, show);
  const skuIds = show === undefined ? [] : skusToShelve(model.skus, show);
  const patch = {
    ...(optionsChanged ? { allowedOptions: after } : {}),
    ...(active !== model.active ? { active } : {}),
  };
  return {
    id: model.id,
    name: model.name,
    patch: Object.keys(patch).length > 0 ? patch : null,
    shelve: show !== undefined && skuIds.length > 0 ? { skuIds, on: show } : null,
    skippedCompartments: view.skippedCompartments,
  };
}

export type BulkIO = {
  /** The Model as it stands now, with every SKU it has. */
  load: (id: string) => Promise<BulkModel>;
  patchModel: (id: string, body: { allowedOptions?: AllowedOptions; active?: boolean }) => Promise<{ autoCreatedSkus?: string[] } | void>;
  shelveSkus: (skuIds: readonly string[], on: boolean) => Promise<void>;
};

export type BulkResult = {
  /** Models written. */
  saved: string[];
  /** Models already as asked once re-read. */
  unchanged: string[];
  failed: Array<{ name: string; message: string }>;
  /** SKUs Houzs reported creating. The compartment rule above means none; a
   *  name here is a rule broken, so the drawer shows it. */
  createdSkus: string[];
};

/** Re-read, plan and write each target, a few at a time. A Model that fails is
 *  named and the rest carry on; Save again re-reads, so it finishes the job
 *  without repeating what already landed. */
export async function runBulkSave(
  targets: ReadonlyArray<{ id: string; name: string }>,
  edits: BulkEdits,
  ctx: BulkContext,
  io: BulkIO,
  opts: { concurrency?: number; onProgress?: (done: number, total: number) => void } = {},
): Promise<BulkResult> {
  const outcome = new Map<string, { kind: 'saved' | 'unchanged' } | { kind: 'failed'; message: string }>();
  const created: string[] = [];
  let next = 0;
  let done = 0;
  const work = async (): Promise<void> => {
    while (next < targets.length) {
      const t = targets[next++]!;
      try {
        const model = await io.load(t.id);
        const plan = bulkPlanOf(bulkView(model, edits, ctx), edits);
        if (!planChanges(plan)) {
          outcome.set(t.id, { kind: 'unchanged' });
        } else {
          if (plan.patch) {
            const res = await io.patchModel(t.id, plan.patch);
            if (res && res.autoCreatedSkus?.length) created.push(...res.autoCreatedSkus);
          }
          if (plan.shelve) await io.shelveSkus(plan.shelve.skuIds, plan.shelve.on);
          outcome.set(t.id, { kind: 'saved' });
        }
      } catch (e) {
        outcome.set(t.id, { kind: 'failed', message: e instanceof Error ? e.message : String(e) });
      }
      done += 1;
      opts.onProgress?.(done, targets.length);
    }
  };
  const workers = Math.max(1, Math.min(opts.concurrency ?? 4, targets.length));
  await Promise.all(Array.from({ length: workers }, work));

  const result: BulkResult = { saved: [], unchanged: [], failed: [], createdSkus: created };
  for (const t of targets) {
    const o = outcome.get(t.id);
    if (!o) continue;
    if (o.kind === 'failed') result.failed.push({ name: t.name, message: o.message });
    else result[o.kind].push(t.name);
  }
  return result;
}
