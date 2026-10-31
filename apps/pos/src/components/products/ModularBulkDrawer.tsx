import { useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { Eye, EyeOff, ListChecks, MoreHorizontal, Package, Sofa } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@2990s/design-system';
import {
  NO_BULK_EDITS,
  bulkAccessoryOf,
  bulkEditCount,
  bulkEditOf,
  bulkModelOf,
  bulkOffered,
  bulkPlanOf,
  bulkState,
  bulkTally,
  bulkView,
  planChanges,
  runBulkSave,
  setBulkEdits,
  toggleBulkEdit,
  type BulkChipPool,
  type BulkContext,
  type BulkEditKey,
  type BulkEdits,
  type BulkIO,
  type BulkResult,
  type BulkTally,
} from '../../lib/products/modular-bulk';
import { modularChipPools } from '../../lib/products/modular-options';
import {
  fetchProductModel,
  forgetProductModels,
  invalidateAfterModelSave,
  patchProductModel,
  useProductModels,
  type ProductModelRow,
} from '../../lib/products/product-models-queries';
import { setSkusOnPos, useMaintenanceConfig, type MfgProductRow } from '../../lib/products/mfg-products-queries';
import { isSingleSkuCategory, productCategoryLabel } from '../../lib/products/product-categories';
import { modelShownInPos } from '../../lib/products/show-in-pos';
import { useFabricColours, useFabricLibrary, useSpecialAddons } from '../../lib/queries';
import { useFabricSeriesNames } from '../../lib/fabric-series-queries';
import { groupFabricSeries } from '../../lib/fabric-series-groups';
import {
  NEEDED_KIND_LABEL,
  neededKindsOf,
  readAccessoryOnSofa,
  readSofaAccessoryIds,
  type SofaAccessoryRole,
} from '../../lib/sofa-accessories';
import { DrawerShell } from './DrawerShell';
import { FabricAllowedSection } from './FabricAllowedSection';
import pageStyles from '../../pages/Products.module.css';
import s from './ModularBulkDrawer.module.css';

/* ════════════════════════════════════════════════════════════════════════
   Products › Modular › a category's ⋯ › Edit several models (owner 2026-11-01)

   Each category's section in Modular carries ⋯; its one item opens the
   Allowed Options drawer over several Models of that category at once. Pick
   the Models (all of them, to start), then turn options on or off: each change
   reaches every picked Model, and whatever is left alone stays as each Model
   has it. The rules are lib/products/modular-bulk.ts — including the one this
   drawer adds: a compartment is turned on only where its SKU already exists,
   so a save here never makes Houzs create an unpriced SKU (owner: this
   changes Modular only, not Houzs ERP). This file is the screen.
   ════════════════════════════════════════════════════════════════════════ */

const SECTION_LABEL: CSSProperties = {
  fontFamily: 'var(--font-button)',
  fontSize: 'var(--fs-12)',
  fontWeight: 600,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--fg-muted)',
  marginBottom: 'var(--space-2)',
};

const NOTE: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-12)',
  lineHeight: 1.45,
  color: 'var(--fg-muted)',
  margin: 'var(--space-2) 0 0',
};

const SMALL_PILL: CSSProperties = {
  padding: '2px 10px',
  borderRadius: 999,
  border: '1px solid var(--line)',
  background: 'transparent',
  color: 'var(--c-ink)',
  cursor: 'pointer',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-12)',
  fontWeight: 600,
};

/** Rings an option whose on/off the drawer is about to change. */
const CHANGED_RING = '0 0 0 2px var(--c-paper), 0 0 0 3.5px var(--c-ink)';

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "A, B and C", or "A, B, C and 4 more". */
const listNames = (names: readonly string[], max = 3): string => {
  if (names.length <= 1) return names.join('');
  if (names.length <= max) return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `${names.slice(0, max).join(', ')} and ${names.length - max} more`;
};

/** ⋯ at the end of a category's section header, and its menu. */
export const ModularCategoryMenu = ({ label, onEditSeveral }: { label: string; onEditSeveral: () => void }) => {
  const [open, setOpen] = useState(false);
  return (
    <div className={s.moreWrap} onKeyDown={(e) => { if (e.key === 'Escape') setOpen(false); }}>
      <button
        type="button"
        className={`${s.moreBtn} ${open ? s.moreBtnOpen : ''}`}
        aria-label={`More for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <MoreHorizontal size={20} strokeWidth={1.75} />
      </button>
      {open && (
        <>
          <div className={s.moreScrim} onClick={() => setOpen(false)} />
          <div className={s.morePop} role="menu">
            <button
              type="button"
              role="menuitem"
              className={s.moreItem}
              onClick={() => { setOpen(false); onEditSeveral(); }}
            >
              <ListChecks size={20} strokeWidth={1.75} className={s.moreItemIcon} />
              <span className={s.moreItemText}>
                <span className={s.moreItemTitle}>Edit several models…</span>
                <span className={s.moreItemSub}>
                  Turn options on or off for many {label.toLowerCase()} models at once
                </span>
              </span>
            </button>
          </div>
        </>
      )}
    </div>
  );
};

/** An option chip over several Models: filled when on for all of them,
 *  dashed with a count when on for some, plain when on for none. */
const BulkChip = ({
  text,
  tally,
  changed,
  onClick,
}: {
  text: string;
  tally: BulkTally;
  changed: boolean;
  onClick: () => void;
}) => {
  const state = bulkState(tally);
  return (
    <button
      type="button"
      aria-pressed={state === 'mixed' ? 'mixed' : state === 'on'}
      title={`On for ${tally.on} of ${tally.of} picked`}
      onClick={onClick}
      style={{
        padding: '4px 12px',
        borderRadius: 999,
        border: `1px ${state === 'mixed' ? 'dashed' : 'solid'} ${state === 'off' ? 'var(--line)' : 'var(--c-orange)'}`,
        background: state === 'on' ? 'var(--c-orange)' : 'var(--c-cream)',
        color: state === 'on' ? 'var(--c-paper)' : 'var(--c-ink)',
        boxShadow: changed ? CHANGED_RING : undefined,
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-13)',
        fontWeight: 600,
        cursor: 'pointer',
        transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
      }}
    >
      {text}
      {state === 'mixed' && (
        <span style={{ marginLeft: 6, fontWeight: 500, color: 'var(--fg-muted)' }}>{tally.on}/{tally.of}</span>
      )}
    </button>
  );
};

const BulkOptionsSection = ({
  label,
  pool,
  labelOf,
  tallyOf,
  isChanged,
  onToggle,
  children,
}: {
  label: string;
  pool: readonly string[];
  /** Chip text when the stored value is not readable (an id). */
  labelOf?: (v: string) => string;
  tallyOf: (v: string) => BulkTally;
  isChanged: (v: string) => boolean;
  onToggle: (v: string) => void;
  /** Notes under the chips. */
  children?: ReactNode;
}) => (
  <div style={{ marginBottom: 'var(--space-4)' }}>
    <div style={SECTION_LABEL}>{label}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
      {pool.map((v) => (
        <BulkChip
          key={v}
          text={labelOf ? labelOf(v) : v}
          tally={tallyOf(v)}
          changed={isChanged(v)}
          onClick={() => onToggle(v)}
        />
      ))}
    </div>
    {children}
  </div>
);

/** DrawerSwitch over several Models — On, Off, or Some. */
const BulkSwitch = ({
  title,
  detail,
  tally,
  changed,
  onToggle,
  onIcon,
  offIcon,
}: {
  title: string;
  detail: string;
  tally: BulkTally;
  changed: boolean;
  onToggle: () => void;
  onIcon: ReactNode;
  offIcon: ReactNode;
}) => {
  const state = bulkState(tally);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      gap: 'var(--space-3)', marginTop: 'var(--space-4)', padding: 'var(--space-3)',
      border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md, 10px)',
      background: 'var(--c-paper)',
    }}>
      <div>
        <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--c-ink)' }}>
          {title}
        </div>
        <div style={{ ...NOTE, marginTop: 2 }}>{detail}</div>
      </div>
      <button
        type="button"
        aria-pressed={state === 'mixed' ? 'mixed' : state === 'on'}
        aria-label={title}
        onClick={onToggle}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: 6, flexShrink: 0,
          padding: '8px 16px', borderRadius: 'var(--radius-pill, 999px)',
          border: `1px ${state === 'mixed' ? 'dashed' : 'solid'} var(--line-strong)`,
          cursor: 'pointer',
          fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', fontWeight: 600,
          background: state === 'on' ? 'var(--c-ink)' : 'transparent',
          color: state === 'on' ? 'var(--c-paper)' : 'var(--c-ink)',
          boxShadow: changed ? CHANGED_RING : undefined,
        }}
      >
        {state === 'on' ? onIcon : offIcon}
        {state === 'on' ? 'On' : state === 'off' ? 'Off' : 'Some'}
      </button>
    </div>
  );
};

const BulkResultNote = ({ result }: { result: BulkResult }) => (
  <div role="status" style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 'var(--space-2)' }}>
    {result.saved.length > 0 && (
      <p style={{ ...NOTE, margin: 0, color: 'var(--c-ink)' }}>Saved {plural(result.saved.length, 'model')}.</p>
    )}
    {result.unchanged.length > 0 && (
      <p style={{ ...NOTE, margin: 0 }}>
        {listNames(result.unchanged)} already read this way, so {result.unchanged.length === 1 ? 'it was' : 'they were'} left alone.
      </p>
    )}
    {result.failed.length > 0 && (
      <p style={{ ...NOTE, margin: 0, color: 'var(--c-festive-b)' }} role="alert">
        Could not save {result.failed.map((f) => `${f.name} (${f.message})`).join(', ')}. Try again to finish {result.failed.length === 1 ? 'it' : 'them'}.
      </p>
    )}
    {result.createdSkus.length > 0 && (
      <p style={{ ...NOTE, margin: 0, color: 'var(--c-burnt)' }} role="alert">
        Houzs created {plural(result.createdSkus.length, 'SKU')} with no price: {result.createdSkus.join(', ')}. Set {result.createdSkus.length === 1 ? 'its price' : 'their prices'} in SKU Master.
      </p>
    )}
  </div>
);

const FIELDSET_RESET: CSSProperties = { border: 0, padding: 0, margin: 0, minWidth: 0 };

export const ModularBulkDrawer = ({
  category,
  models,
  skusByModelId,
  onClose,
}: {
  category: string;
  /** The category's Models, as its section in Modular lists them. */
  models: readonly ProductModelRow[];
  skusByModelId: ReadonlyMap<string, readonly MfgProductRow[]>;
  onClose: () => void;
}) => {
  const qc = useQueryClient();
  const masterCfg = useMaintenanceConfig('master');
  const specialAddons = useSpecialAddons();
  const isSofa = category === 'SOFA';
  const isBedframe = category === 'BEDFRAME';
  const isFlat = isSingleSkuCategory(category);
  const isSofaAccessory = category === 'FABRIC_ACCESSORY';
  // What a sofa's ticked accessory ids offer on its canvas.
  const accessoryModels = useProductModels({ category: 'FABRIC_ACCESSORY', enabled: isSofa });
  const fabricLib = useFabricLibrary();
  const fabricColours = useFabricColours();
  const fabricSeriesNames = useFabricSeriesNames();
  const fabricGroups = useMemo(
    () => groupFabricSeries(fabricLib.data ?? [], fabricColours.data ?? [], fabricSeriesNames.data ?? []),
    [fabricLib.data, fabricColours.data, fabricSeriesNames.data],
  );

  const [picked, setPicked] = useState<ReadonlySet<string>>(() => new Set(models.map((m) => m.id)));
  const [edits, setEdits] = useState<BulkEdits>(NO_BULK_EDITS);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const saving = progress !== null;

  const cfg = masterCfg.data?.data ?? null;
  const ctx = useMemo<BulkContext | null>(
    () => (cfg ? { cfg, accessories: (accessoryModels.data ?? []).map(bulkAccessoryOf) } : null),
    [cfg, accessoryModels.data],
  );
  const pickedRows = useMemo(() => models.filter((m) => picked.has(m.id)), [models, picked]);
  const bulkModels = useMemo(
    () => pickedRows.map((m) => bulkModelOf(m, skusByModelId.get(m.id) ?? [])),
    [pickedRows, skusByModelId],
  );
  const views = useMemo(
    () => (ctx ? bulkModels.map((m) => bulkView(m, edits, ctx)) : []),
    [bulkModels, edits, ctx],
  );
  const plans = useMemo(() => views.map((v) => bulkPlanOf(v, edits)), [views, edits]);
  const toSave = plans.filter(planChanges);

  const tally = (key: BulkEditKey): BulkTally => (ctx ? bulkTally(views, key, ctx) : { on: 0, of: 0 });
  const changed = (key: BulkEditKey) => bulkEditOf(edits, key) !== undefined;
  const toggle = (key: BulkEditKey) => {
    if (!ctx) return;
    setResult(null);
    setEdits((e) => toggleBulkEdit(bulkModels, e, key, ctx));
  };
  const chipProps = (pool: BulkChipPool) => ({
    tallyOf: (value: string) => tally({ kind: 'chip', pool, value }),
    isChanged: (value: string) => changed({ kind: 'chip', pool, value }),
    onToggle: (value: string) => toggle({ kind: 'chip', pool, value }),
  });
  const fabricKey = (value: string): BulkEditKey => ({ kind: 'chip', pool: 'fabrics', value });
  const fabricProps = {
    series: fabricGroups.series,
    coloursBySeries: fabricGroups.coloursBySeries,
    isLoading: fabricLib.isLoading || fabricColours.isLoading || fabricSeriesNames.isLoading,
    error: fabricLib.error || fabricColours.error || fabricSeriesNames.error,
    isTicked: (code: string) => bulkState(tally(fabricKey(code))) === 'on',
    mixedOf: (code: string) => {
      const t = tally(fabricKey(code));
      return bulkState(t) === 'mixed' ? `${t.on}/${t.of}` : null;
    },
    isChanged: (code: string) => changed(fabricKey(code)),
    onToggle: (code: string) => toggle(fabricKey(code)),
    onSetAll: (codes: string[], on: boolean) => {
      if (!ctx) return;
      setResult(null);
      setEdits((e) => setBulkEdits(bulkModels, e, codes.map(fabricKey), on, ctx));
    },
  };

  const togglePick = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });

  const pools = cfg ? modularChipPools(category, cfg, specialAddons.data ?? []) : null;
  // Sofa accessories as one Model's drawer lists them, plus any a picked Model
  // ticks (so an accessory switched off can still be unticked).
  const tickedAccessories = new Set(views.flatMap((v) => [...readSofaAccessoryIds(v.before), ...readSofaAccessoryIds(v.after)]));
  const sofaAccessoryPool = isSofa
    ? (accessoryModels.data ?? [])
      .map((a) => ({ a, onSofa: readAccessoryOnSofa(a.allowed_options) }))
      .filter(({ a, onSofa }) => (a.active && onSofa) || tickedAccessories.has(a.id))
      .map(({ a, onSofa }) => ({
        id: a.id,
        label: !a.active ? `${a.name} (off)` : !onSofa ? `${a.name} (not on the sofa)` : a.name,
      }))
    : [];
  // The kinds any picked Model offers a piece of.
  const neededPool = isSofa && ctx
    ? neededKindsOf(views.flatMap((v) => bulkOffered(readSofaAccessoryIds(v.after), ctx)))
    : [];
  // Compartments asked on that a picked Model has no SKU for, by compartment.
  const skippedByComp = new Map<string, string[]>();
  for (const p of plans) {
    for (const comp of p.skippedCompartments) skippedByComp.set(comp, [...(skippedByComp.get(comp) ?? []), p.name]);
  }
  const offSofaCount = isSofaAccessory ? views.filter((v) => !readAccessoryOnSofa(v.after)).length : 0;
  const showTally = tally({ kind: 'showInPos' });
  const onSofaTally = tally({ kind: 'onSofa' });

  const io: BulkIO = {
    // Re-read: its card may have been saved since the list loaded. Straight
    // from the API, never into the cache — a copy cached here is from before
    // the write, and a card opened next would start its draft from it.
    load: async (id) => {
      const res = await fetchProductModel(id);
      return bulkModelOf(res.model, res.skus);
    },
    patchModel: (id, body) => patchProductModel(id, body),
    shelveSkus: (skuIds, on) => setSkusOnPos(skuIds, on),
  };
  const onSave = async () => {
    if (!ctx || saving || toSave.length === 0) return;
    const targets = toSave.map((p) => ({ id: p.id, name: p.name }));
    setSaveError(null);
    setResult(null);
    setProgress({ done: 0, total: targets.length });
    try {
      const res = await runBulkSave(targets, edits, ctx, io, {
        onProgress: (done, total) => setProgress({ done, total }),
      });
      // A card opened earlier left its Model cached, and no card is open to
      // refetch it: drop it, or that card would reopen on the old options
      // (its draft starts from the first data it sees) and its Save would put
      // them back.
      forgetProductModels(qc, targets.map((t) => t.id));
      // Refetch before showing the result, so every chip reads what was saved.
      await invalidateAfterModelSave(qc);
      setResult(res);
      if (res.failed.length === 0) setEdits(NO_BULK_EDITS);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
    }
  };
  const close = () => { if (!saving) onClose(); };
  const label = productCategoryLabel(category);

  return (
    <DrawerShell title={`Allowed Options · ${label} models`} onClose={close}>
      <p className={pageStyles.eyebrow} style={{ marginBottom: 'var(--space-4)' }}>
        Pick the models, then turn options on or off. Each change goes to every
        model picked; anything you leave alone stays as each model has it.
      </p>

      <fieldset disabled={saving} style={FIELDSET_RESET}>
        <div style={{ marginBottom: 'var(--space-5)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            <div style={{ ...SECTION_LABEL, marginBottom: 0 }}>Models</div>
            <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              {pickedRows.length} of {models.length} picked
            </span>
            <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 'var(--space-1)' }}>
              <button type="button" style={SMALL_PILL} onClick={() => setPicked(new Set(models.map((m) => m.id)))}>
                Select all
              </button>
              <button type="button" style={SMALL_PILL} onClick={() => setPicked(new Set())}>
                Clear
              </button>
            </span>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))',
            gap: '2px var(--space-3)',
            maxHeight: 220,
            overflowY: 'auto',
            padding: 'var(--space-2)',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--c-cream)',
          }}>
            {models.map((m) => (
              <label
                key={m.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, padding: '4px 2px',
                  fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)', color: 'var(--c-ink)', cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={picked.has(m.id)}
                  onChange={() => togglePick(m.id)}
                  style={{ accentColor: 'var(--c-ink)', margin: 0, flexShrink: 0 }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</span>
                {isFlat && !modelShownInPos(m.active, skusByModelId.get(m.id) ?? []) && (
                  <EyeOff size={16} strokeWidth={1.75} aria-label="Hidden from POS" style={{ flexShrink: 0, color: 'var(--fg-muted)' }} />
                )}
              </label>
            ))}
          </div>
          {pickedRows.length > 0 && (
            <p style={NOTE}>
              Filled: on for every picked model. Dashed: on for some, with how many.
              Tapping goes on, off, then back to how it was; a ring marks what you
              have changed.
            </p>
          )}
        </div>

        {!ctx || !pools ? (
          <p className={pageStyles.eyebrow}>
            {masterCfg.error ? 'Could not load the option lists.' : 'Loading options…'}
          </p>
        ) : pickedRows.length === 0 ? (
          <p className={pageStyles.eyebrow}>Pick at least one model to change its options.</p>
        ) : isFlat ? (
          <>
            <BulkSwitch
              title="Show in POS"
              detail={showTally.on === showTally.of
                ? 'On — sales staff can add them to an order.'
                : showTally.on === 0
                  ? 'Off — hidden from the POS catalog.'
                  : `On for ${showTally.on} of ${showTally.of} picked models.`}
              tally={showTally}
              changed={changed({ kind: 'showInPos' })}
              onToggle={() => toggle({ kind: 'showInPos' })}
              onIcon={<Eye size={16} strokeWidth={1.75} />}
              offIcon={<EyeOff size={16} strokeWidth={1.75} />}
            />
            {isSofaAccessory && (
              <BulkSwitch
                title="On the sofa"
                detail={onSofaTally.on === onSofaTally.of
                  ? 'On — added on a sofa’s Custom build.'
                  : onSofaTally.on === 0
                    ? 'Off — sold on their own, like any accessory.'
                    : `${onSofaTally.on} of ${onSofaTally.of} picked pieces go on the sofa.`}
                tally={onSofaTally}
                changed={changed({ kind: 'onSofa' })}
                onToggle={() => toggle({ kind: 'onSofa' })}
                onIcon={<Sofa size={16} strokeWidth={1.75} />}
                offIcon={<Package size={16} strokeWidth={1.75} />}
              />
            )}
            {isSofaAccessory && offSofaCount > 0 && (
              <div style={{ marginTop: 'var(--space-5)' }}>
                <FabricAllowedSection {...fabricProps} />
                <p style={{ ...NOTE, marginTop: 'calc(-1 * var(--space-2))' }}>
                  For the {plural(offSofaCount, 'picked piece')} sold on {offSofaCount === 1 ? 'its' : 'their'} own.
                  A piece with none ticked can be had in every colour.
                </p>
              </div>
            )}
            {isSofaAccessory && (
              <p style={{ ...NOTE, marginTop: 'var(--space-4)' }}>
                Where a piece goes on the sofa is set on its own card.
              </p>
            )}
          </>
        ) : (
          <>
            {pools.sizes.length > 0 && (
              <BulkOptionsSection label={isSofa ? 'Seat sizes (inches)' : 'Sizes'} pool={pools.sizes} {...chipProps('sizes')} />
            )}
            {isSofa && pools.compartments.length > 0 && (
              <BulkOptionsSection label="Compartments" pool={pools.compartments} {...chipProps('compartments')}>
                <p style={NOTE}>
                  Turned on here, a compartment reaches only the models that already
                  have its SKU, so no new SKU is made. To add one to a model without
                  it, tick it on that model’s own card.
                </p>
                {[...skippedByComp].map(([comp, names]) => (
                  <p key={comp} style={{ ...NOTE, color: 'var(--c-burnt)' }}>
                    {comp} stays off on {listNames(names)}: no {comp} SKU yet.
                  </p>
                ))}
              </BulkOptionsSection>
            )}
            {pools.gaps.length > 0 && (
              <BulkOptionsSection label="Mattress gaps" pool={pools.gaps} {...chipProps('gaps')} />
            )}
            {pools.leg_heights.length > 0 && (
              <BulkOptionsSection label="Leg heights" pool={pools.leg_heights} {...chipProps('leg_heights')} />
            )}
            {pools.divan_heights.length > 0 && (
              <BulkOptionsSection label="Divan heights" pool={pools.divan_heights} {...chipProps('divan_heights')} />
            )}
            {pools.specials.length > 0 && (
              <BulkOptionsSection label="Special Add-ons" pool={pools.specials} {...chipProps('specials')} />
            )}
            {isSofa && sofaAccessoryPool.length > 0 && (
              <BulkOptionsSection
                label="Sofa accessories"
                pool={sofaAccessoryPool.map((a) => a.id)}
                labelOf={(id) => sofaAccessoryPool.find((a) => a.id === id)?.label ?? id}
                {...chipProps('sofa_accessories')}
              />
            )}
            {isSofa && neededPool.length > 0 && (
              <BulkOptionsSection
                label="Needed to order"
                pool={neededPool}
                labelOf={(k) => NEEDED_KIND_LABEL[k as SofaAccessoryRole]}
                tallyOf={(k) => tally({ kind: 'needed', role: k as SofaAccessoryRole })}
                isChanged={(k) => changed({ kind: 'needed', role: k as SofaAccessoryRole })}
                onToggle={(k) => toggle({ kind: 'needed', role: k as SofaAccessoryRole })}
              >
                <p style={NOTE}>
                  Each sofa of a model with a kind ticked needs it before it can be
                  ordered. A kind counts only on the models that offer a piece of it.
                </p>
              </BulkOptionsSection>
            )}
            {(isSofa || isBedframe) && <FabricAllowedSection {...fabricProps} />}
          </>
        )}
      </fieldset>

      <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--line)' }}>
        {result && <BulkResultNote result={result} />}
        {saveError && (
          <p style={{ ...NOTE, color: 'var(--c-festive-b)' }} role="alert">Save failed — {saveError}</p>
        )}
        {!result && pickedRows.length > 0 && (
          <p style={{ ...NOTE, margin: 0 }}>
            {toSave.length > 0
              ? `Saves ${toSave.length} of the ${plural(pickedRows.length, 'picked model')}.`
              : bulkEditCount(edits) === 0
                ? 'Nothing changed yet.'
                : 'The picked models already read this way.'}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-3)' }}>
          <Button variant="ghost" size="md" onClick={close} disabled={saving}>
            <span>{!result ? 'Cancel' : result.failed.length === 0 ? 'Done' : 'Close'}</span>
          </Button>
          <Button variant="primary" size="md" onClick={() => void onSave()} disabled={saving || toSave.length === 0}>
            <span>
              {progress
                ? `Saving… ${progress.done} of ${progress.total}`
                : result && result.failed.length > 0 ? 'Try again' : 'Save'}
            </span>
          </Button>
        </div>
      </div>
    </DrawerShell>
  );
};
