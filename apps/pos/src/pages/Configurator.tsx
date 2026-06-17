import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Hourglass, X, Plus, Minus, Package, Trash2, FlipHorizontal2 } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM, BUNDLES, findModule, moduleFootprint, cellsBbox, buildComboLabel, computeSofaPrice, sofaModuleSellingPricesFromSkus, mirrorModules, canMirror, fabricTierAddon, matchComboSubset, comboChargedPrices, orderSofaCellsLeftToRight, type BundleDef, type Cell, type Depth, type SofaProductPricing, type FabricTier } from '@2990s/shared';
import { resolvePwp, type PwpLineInput } from '@2990s/shared/pwp';
import { usePwpRules, useMyReservedPwpCodes, validatePwpCode } from '../lib/products/pwp-queries';
import {
  useProduct,
  useProductBundles,
  useProductCompartments,
  useProductSizes,
  useSizeLibrary,
  useProductPricingRealtime,
  useProductFabrics,
  useFabricLibrary,
  useFabricColours,
  useModelAllowedFabricCodes,
  useModelAllowedSpecials,
  useSpecialAddons,
  useFabricTierAddonConfig,
  useModelFabricTierOverrides,
  useAddons,
  useBedframeColours,
  useBedframeCustomizerData,
  useSofaCustomizerData,
  useSofaCustomizerRealtime,
  useSofaLegHeights,
  useSofaCombos,
  useSofaQuickPicks,
  useSofaQuickPicksRealtime,
  useDeleteSofaQuickPick,
  type AddonRow,
  type ProductFabricRow,
  type BedframeOptionRow,
} from '../lib/queries';
import { useStaff, isGlobalCurator } from '../lib/staff';
import { useMyQuickPicks, useDeletePersonalQuickPick } from '../lib/personal-quick-picks';
import {
  useCart,
  type CartLine,
  type SofaConfigSnapshot,
  type SizeConfigSnapshot,
  type FlatConfigSnapshot,
  type BedframeConfigSnapshot,
} from '../state/cart';
/* TBC sofa exchange (Loo 2026-06-12) — "Confirm Change" marshals the build
   exactly like the handover does and replaces the SO build server-side. */
import { fetchItemCodeMap, cartLinesToSoItems } from '../lib/pos-handover-so';
import {
  useSoHeaderForAdd,
  useAddProductToPlacedSo,
  AddSoItemApiError,
  type AddSoItemBody,
} from '../lib/queries';
import { supabase } from '../lib/supabase';
import { CustomBuilder, centerCellsInRoom } from './CustomBuilder';
import { FabricColourPicker, type FabricSelection } from '../components/FabricColourPicker';
import {
  BedframeOptions,
  OptionSelect,
  emptyBedframeSelection,
  bedframeSurcharge,
  addonSurchargeRM,
  type BedframeSelection,
} from '../components/BedframeOptions';
import {
  SpecialAddonsPicker,
  specialSelsSurcharge,
  specialSelSurchargeRM,
  type SpecialSel,
} from '../components/SpecialAddonsPicker';
import { SofaCellsPreview } from '../components/SofaCellsPreview';
import { Topbar } from '../components/Topbar';
import styles from './Configurator.module.css';

// Friendly text for a /pwp-codes validation failure (shown under Insert PWP Code).
function pwpReasonText(reason?: string): string {
  switch (reason) {
    case 'not_found':                return 'No such PWP code.';
    case 'already_used':             return 'This PWP code was already used.';
    case 'not_redeemable':           return 'This PWP code is not redeemable.';
    case 'reward_category_mismatch': return 'This code is for a different product type.';
    case 'reward_model_ineligible':  return 'This code cannot be used on this Model.';
    default:                         return 'This PWP code cannot be applied.';
  }
}

interface SizeRow {
  id: string;
  label: string;
  widthCm: number;
  lengthCm: number;
  price: number | null;
  pwpPrice: number | null;   // PWP (换购, 0128) base price for this size, whole MYR. null = not set.
  active: boolean;
}

// Quick-Pick preset metadata — sub label + 24" baseline footprint (cm).
// Width grows 10cm per cushion at 28" depth; depth stays constant.
// Mirrors prototype/pos-sofa-config.jsx → QUICK_PRESETS, kept Configurator-local
// because it's purely UI sizing for the hero plan-view canvas.
//
// NOTE (Commander 2026-05-28): commander-editable Quick Presets now live on
// MaintenanceConfig.sofaQuickPresets (see Backend Maintenance → SOFA → Quick
// Presets). This map remains the geometry source — it's keyed by Quick Pick
// BUNDLE id (1S/2S/3S/2+L/3+L/2WC/2PS/CORNER from packages/shared BUNDLES),
// not the maintenance preset_id (1S/2S/3S-L/3S-R/2+L-L/2+L-R/...). The two
// coincidentally overlap on ids like '1S' and '2WC' but are otherwise
// disjoint domains. Wiring the Quick Pick screen to read from
// sofaQuickPresets directly is deferred — would require unifying bundle
// pricing (product_bundles) with preset pricing (sofa_combos), which is
// out of scope for this PR.
const QUICK_PRESET_META: Record<string, { sub: string; cushions: number; baseW: number; baseD: number }> = {
  '1S':  { sub: 'Single seat',           cushions: 2, baseW: 190, baseD: 95 },
  '2S':  { sub: 'Two seats',             cushions: 3, baseW: 265, baseD: 95 },
  // 2.5-Seater reuses 2S.png (see bundleArtSrc) rendered ~25cm wider.
  '2.5S':{ sub: 'Two-and-a-half seats',  cushions: 3, baseW: 290, baseD: 95 },
  '3S':  { sub: 'Three seats',           cushions: 4, baseW: 316, baseD: 95 },
  '2+L': { sub: '2-seater with chaise',  cushions: 3, baseW: 253, baseD: 165 },
  '3+L': { sub: '3-seater with chaise',  cushions: 4, baseW: 360, baseD: 165 },
  // F6: 2-seater + wood console = 1A(95) + WC-45(45) + 1A(95) = 235cm.
  '2WC': { sub: '2-seater with wood console', cushions: 2, baseW: 235, baseD: 95 },
  // F7: power-slide combo — a 2-seater, same footprint as 2S.
  '2PS': { sub: '2-seater · 2 power slide',   cushions: 3, baseW: 265, baseD: 95 },
  // F4: corner package (composed preview, no single PNG). L-shape: corner + 2A
  // across the top, 1A chaise dropping down the left (253×190 @24", 283×200 @28").
  CORNER: { sub: '1A + corner + 2A',          cushions: 3, baseW: 253, baseD: 190 },
};

// Composed-preview cells for presets that have NO single composite PNG (F6
// console, F4 corner) — rendered via <SofaCellsPreview> from module art. Cell
// x/y are computed from each module's ACTUAL width at the chosen seat depth
// (modules grow ~10cm/cushion at 28") so neighbours always abut — no gap at
// 24" AND no overlap at 28". Memoised per (bundle, depth) so the returned array
// keeps a stable reference (SofaCellsPreview's effect deps on `cells`).
const presetCellsCache = new Map<string, Cell[]>();
const buildPresetCells = (bundleId: string, depth: Depth): Cell[] | undefined => {
  const key = `${bundleId}-${depth}`;
  const hit = presetCellsCache.get(key);
  if (hit) return hit;
  const wOf = (id: string): number => {
    const m = findModule(id);
    return m ? moduleFootprint(m, 0, depth).w : 0;
  };
  let cells: Cell[] | undefined;
  if (bundleId === '2WC') {
    // 1A + wood console + 1A, left to right.
    const a = wOf('1A(LHF)');
    const c = wOf('Console');
    cells = [
      { id: 'wc-l', moduleId: '1A(LHF)', x: 0,     y: 0, rot: 0 },
      { id: 'wc-c', moduleId: 'Console', x: a,     y: 0, rot: 0 },
      { id: 'wc-r', moduleId: '1A(RHF)', x: a + c, y: 0, rot: 0 },
    ];
  } else if (bundleId === 'CORNER') {
    // L-shape: corner + 2-seater across the top; 1A chaise drops down the left
    // (rot 270 → backrest on the outer-left edge, seat opening into the room).
    // CNR depth (m.d) is constant with seat depth, so the chaise sits at y = 95.
    const cnrW = wOf('CNR');
    cells = [
      { id: 'cn-cnr', moduleId: 'CNR',    x: 0,    y: 0,  rot: 0 },
      { id: 'cn-2a',  moduleId: '2A(RHF)', x: cnrW, y: 0,  rot: 0 },
      { id: 'cn-1a',  moduleId: '1A(LHF)', x: 0,    y: 95, rot: 270 },
    ];
  }
  if (cells) presetCellsCache.set(key, cells);
  return cells;
};

/* Build cells from a Backend Sofa Combo's slot-set. Commander 2026-05-28 —
   placed left-to-right in slot order, all rot=0. Combos from the maintenance
   UI are typically sequential (e.g. 1A(LHF) + Console + 1A(RHF)), so a simple
   linear lay-out matches commander's intent. For L-shape combos the
   user-saved order should already have the chaise at the appropriate end.

   OR-set per slot (PR combo-or-per-slot): each slot may hold multiple
   alternative codes. The preview / pre-populated layout picks the FIRST code
   in each slot as the representative — the user can swap to any OR-alternative
   in Customize and the combo price still matches (set-cover match is
   order-independent). */
const cellsFromComboModules = (modules: readonly string[][], depth: Depth): Cell[] => {
  // Corner layout (corner + 2-seater + 1-seater) is an L, not a straight row.
  // A saved Quick Pick stores only its module LIST (no x/y/rot), so without this
  // an L-corner would re-render flat — "one line, no curve". The chaise (the
  // 1-seater leg) drops down on the side its HAND faces: LHF → bottom-left
  // (corner top-left, 2-seater top-right, chaise rot 270 so its back is on the
  // outer-left and its arm at the foot); RHF → the whole L mirrors to the other
  // hand (corner top-right, 2-seater top-left, chaise bottom-right rot 90). This
  // is what makes the Quick Pick "mirror left↔right" flip the entire corner
  // instead of just swapping arm codes in place. The cells abut, so groupSofas
  // still sees one connected sofa and pricing is unchanged. Any other module-set
  // falls through to the straight left-to-right row below.
  const ids = modules.map((slot) => slot[0] ?? '').filter(Boolean);
  if (ids.length === 3) {
    const cnr = ids.find((id) => findModule(id)?.group === 'Corner');
    const two = ids.find((id) => findModule(id)?.group === '2-seater');
    const one = ids.find((id) => findModule(id)?.group === '1-seater');
    if (cnr && two && one) {
      const cnrFp = moduleFootprint(findModule(cnr)!, 0, depth);
      const twoFp = moduleFootprint(findModule(two)!, 0, depth);
      const chaiseRight = one.includes('RHF');
      if (chaiseRight) {
        const totalW = twoFp.w + cnrFp.w;
        const chaiseW = moduleFootprint(findModule(one)!, 90, depth).w;
        return [
          { id: 'combo-2a',  moduleId: two, x: 0,                y: 0,        rot: 0 },
          { id: 'combo-cnr', moduleId: cnr, x: twoFp.w,          y: 0,        rot: 0 },
          { id: 'combo-1a',  moduleId: one, x: totalW - chaiseW, y: cnrFp.h,  rot: 90 },
        ];
      }
      return [
        { id: 'combo-cnr', moduleId: cnr, x: 0,        y: 0,         rot: 0 },
        { id: 'combo-2a',  moduleId: two, x: cnrFp.w,  y: 0,         rot: 0 },
        { id: 'combo-1a',  moduleId: one, x: 0,        y: cnrFp.h,   rot: 270 },
      ];
    }
  }
  const cells: Cell[] = [];
  let x = 0;
  modules.forEach((slot, idx) => {
    const moduleId = slot[0] ?? '';
    if (!moduleId) return;
    const m = findModule(moduleId);
    const w = m ? moduleFootprint(m, 0, depth).w : 0;
    cells.push({ id: `combo-${idx}`, moduleId, x, y: 0, rot: 0 });
    x += w;
  });
  return cells;
};

/* Left-to-right Quick-Pick labels (Loo 2026-06-12). A stored pick's slot
   order (and any label minted from it at save time) is the save-time canvas
   order — an L-corner reads "CNR + 1B(LHF) + 2A(RHF)" when the walk order is
   "1B(LHF) + CNR + 2A(RHF)". Lay the modules out exactly like the preview
   does and walk them. OR-set slots (Backend combo curation) can't be
   expressed as cells → null (caller keeps the stored label / slot join). */
const qpWalkLabel = (modules: readonly string[][], depth: Depth): string | null => {
  if (modules.some((slot) => slot.length > 1)) return null;
  const cells = cellsFromComboModules(modules, depth);
  if (cells.length === 0) return null;
  return orderSofaCellsLeftToRight(cells, depth).map((c) => c.moduleId).join(' + ');
};

/* A curated human name ("Family corner") survives; a label that is just the
   pick's module codes joined (the personal-pick default minted at save) is a
   SEQUENCE and must re-read in walk order. */
const qpLabelIsCodeJoin = (label: string | null | undefined, modules: readonly string[][]): boolean => {
  if (!label || label.trim() === '') return true;
  const toks = label.split('+').map((s) => s.trim()).filter(Boolean).sort();
  const mods = modules.map((s) => s[0] ?? '').filter(Boolean).sort();
  return toks.length === mods.length && toks.every((t, i) => t === mods[i]);
};

const quickPresetDims = (bundleId: string, depth: Depth): { w: number; d: number } => {
  const m = QUICK_PRESET_META[bundleId];
  if (!m) return { w: 0, d: 0 };
  // Mirror the engine (sofa-build widthOffsetPerCushion): 2.5cm/inch/cushion.
  const offsetPerCushion = Math.max(0, (parseInt(depth, 10) - 24) * 2.5);
  return { w: m.baseW + offsetPerCushion * m.cushions, d: m.baseD };
};

const isLShapeBundle = (id: string | null | undefined): boolean =>
  id === '2+L' || id === '3+L';

// Aspect (w/h) of a sofa layout at a given seat size. The composed hero anchors
// its preview HEIGHT on the layout's aspect at the LARGEST offered seat size, so
// growing the seat widens the sofa left-right instead of shrinking the whole
// plan-view (mirrors the single-PNG hero's scaleX widen). undefined when the
// layout has no measurable footprint.
const layoutAnchorAspect = (cells: Cell[], depth: Depth): number | undefined => {
  const bb = cellsBbox(cells, depth);
  return bb && bb.h > 0 ? bb.w / bb.h : undefined;
};

/* A salesperson-facing Quick Pick — a saved sofa LAYOUT (Chairman 2026-05-31).
   Unifies the two layers the configurator shows: GLOBAL (sofa_quick_picks,
   Master-Admin-curated) + PERSONAL ("Yours", per-device localStorage). It
   carries NO price — the card computes its price by running `modules` through
   the engine (à-la-carte sum, or the Combo price on match). */
interface QuickPickItem {
  id: string;
  source: 'global' | 'personal';
  label: string | null;
  /** OR-set per slot. Personal picks store flat ids → wrapped as singletons. */
  modules: string[][];
  depth: string;
}

export const Configurator = () => {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  // Back / Cancel = go back one history entry, identical to the browser/swipe
  // Back the user also uses — so it pops to the EXACT catalogue entry they came
  // from (category lives in the URL, scroll is restored by <ScrollRestoration>),
  // or to /cart when editing a cart line. Opened cold (deep link / first load,
  // no in-app history to pop) → fall back to a fresh /catalogue.
  const backToCatalog = () => {
    const idx = (window.history.state?.idx ?? 0) as number;
    if (idx > 0) navigate(-1);
    // Sofa exchange or add-to-order enters from My orders — a cold load
    // (refresh) should fall back THERE, not to the catalogue.
    else if (new URLSearchParams(window.location.search).get('swapDoc')) navigate('/my-orders');
    else if (new URLSearchParams(window.location.search).get('addToOrder')) navigate('/my-orders');
    else navigate('/catalog');
  };
  const product = useProduct(productId);
  const bundles = useProductBundles(productId);
  const compartments = useProductCompartments(productId);
  const productFabrics = useProductFabrics(productId);
  // Global fabric library — used to derive ProductFabricRow[] for mfg sofa
  // products whose fabric list comes from sofaCustomizer.fabricIds rather than
  // the product_fabrics UUID-FK table.
  const fabricLib = useFabricLibrary();
  const fabricColours = useFabricColours();
  const addonCfgQ = useFabricTierAddonConfig();  // migration 0124 — fabric-tier Δ amounts
  // migration 0172 — per-Model fabric-tier Δ override, resolved by this product's
  // model_id. Fed to every Δ surface so the figure matches the server recompute.
  const modelOverridesQ = useModelFabricTierOverrides();
  const modelFabricOverride = useMemo(() => {
    const id = (product.data as { model_id?: string | null } | null)?.model_id ?? null;
    if (!id) return null;
    const row = (modelOverridesQ.data ?? []).find((r) => r.modelId === id);
    return row ? { tier2Delta: row.tier2Delta, tier3Delta: row.tier3Delta } : null;
  }, [modelOverridesQ.data, product.data]);

  // Fabrics are a SERIES (fabric_library) / COLOUR (fabric_colours) library
  // synced from the Backend Fabric Converter (migration 0127). A Model offers a
  // set of COLOUR codes (allowed_options.fabrics, ticked in the Modular drawer);
  // the picker shows the series that own ≥1 enabled colour, then those colours.
  // This helper turns an enabled colour-code list → the series rows the picker takes.
  const buildFabricSeriesRows = useCallback((codes: string[]): ProductFabricRow[] => {
    const enabled = new Set(codes);
    const seriesWithColour = new Set(
      (fabricColours.data ?? []).filter((c) => enabled.has(c.colourId)).map((c) => c.fabricId),
    );
    return (fabricLib.data ?? [])
      .filter((f) => seriesWithColour.has(f.id))
      .map((f) => ({ fabricId: f.id, active: f.active, surcharge: f.defaultSurcharge }));
  }, [fabricColours.data, fabricLib.data]);

  // Bedframe enabled fabric colour codes = the Model's allowed_options.fabrics
  // (per-Model, set in the Modular drawer). Empty → "No fabrics enabled".
  const bedframeAllowedFabricsQ = useModelAllowedFabricCodes(productId);
  const bedframeFabricCodes = useMemo(() => bedframeAllowedFabricsQ.data ?? [], [bedframeAllowedFabricsQ.data]);
  const bedframeFabricRows = useMemo<ProductFabricRow[]>(
    () => buildFabricSeriesRows(bedframeFabricCodes),
    [buildFabricSeriesRows, bedframeFabricCodes],
  );
  useProductPricingRealtime(productId);
  /* PR — Commander 2026-05-28: Sofa Customize wires to Model.allowed_options.
   * The query resolves to null for non-sofa SKUs / orphan SKUs (no model_id),
   * in which case CustomBuilder falls back to the legacy
   * product_compartments tick map. Realtime keeps it in sync with commander's
   * Backend edits without a refresh. */
  const sofaCustomizer = useSofaCustomizerData(productId);
  useSofaCustomizerRealtime(productId);
  // Sofa leg height (Loo 2026-06-03) — options + SELLING price from the master
  // sofaLegHeights pool ∩ this Model's allowed_options.leg_heights. Lifted here
  // so it survives the Quick Pick ⇄ Customize toggle (like sofaSpecialSel) and
  // both modes' rails + all three add paths read one source.
  const sofaLegOpts = useSofaLegHeights(productId);
  const [sofaLegValue, setSofaLegValue] = useState<string | null>(null);

  const [picked, setPicked] = useState<string | null>(null);
  // Saved Quick Pick selection — mutually exclusive with `picked` (bundle).
  // When non-null, the hero shows the pick's cells and "Add to Cart" builds
  // from its modules. A Quick Pick is a LAYOUT (Chairman 2026-05-31); its price
  // is computed by the engine (à-la-carte, or a matched Combo's price).
  const [pickedQP, setPickedQP] = useState<QuickPickItem | null>(null);
  const [pickedSizeId, setPickedSizeId] = useState<string | null>(null);
  const [pillowExtras, setPillowExtras] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<'quick' | 'custom'>('quick');
  // Sofa Custom Build cells lifted here so they survive Quick Pick ⇄ Customize
  // toggles within this Configurator session. Resets only when Configurator
  // unmounts (Back button → leave the product page).
  const [sofaCells, setSofaCells] = useState<Cell[]>([]);
  // Sofa Quick-Pick toolbar state. quickFlip controls the L/R orientation of
  // L-shape bundles (2+L, 3+L); activeDepth toggles 24"/28" seat depth which
  // affects per-cushion footprint (~10cm wider per cushion at 28"). Both
  // surface in the topbar action slot per UI_REFERENCE.md.
  const [quickFlip, setQuickFlip] = useState<'L' | 'R'>('R');
  const [activeDepth, setActiveDepth] = useState<Depth>('24');
  // Quick Pick L↔R mirror (2026-06-01). Per-order toggle on the selected saved
  // Quick Pick; reset whenever a different pick is selected. Only meaningful for
  // asymmetric layouts (canMirror) — the card hides the control otherwise.
  const [qpMirror, setQpMirror] = useState(false);
  // Chosen fabric + colour (spec 2026-05-24). Required before Add-to-Cart for
  // sofas; the picker resolves labels/hex/surcharge so the snapshot + LIVE
  // TOTAL render without another lookup.
  const [fabricSel, setFabricSel] = useState<FabricSelection | null>(null);
  // Bedframe configurator selection (spec 2026-05-25) — colour + dimension
  // options. Size reuses pickedSizeId. The picker resolves labels/hex/surcharge
  // so the snapshot + LIVE TOTAL render without another lookup.
  // (The "Special size" free text was removed 2026-06-11, Loo — the product-page
  // Remark covers it and surfaces everywhere; old lines keep variants.sizeOther.)
  const [bfSel, setBfSel] = useState<BedframeSelection>(emptyBedframeSelection);
  // Special Add-ons (migration 0134) selections for sofa + mattress (bedframe
  // uses bfSel.specials). Lifted here so sofa survives Quick⇄Customize toggles.
  const [sofaSpecialSel, setSofaSpecialSel] = useState<SpecialSel[]>([]);
  const [mattressSpecialSel, setMattressSpecialSel] = useState<SpecialSel[]>([]);

  const sizes = useProductSizes(productId);
  const sizeLib = useSizeLibrary();
  const addons = useAddons();
  /* Commander 2026-05-28 — Sofa Combo Pricing from Backend surfaces in
     POS Quick Pick. Filtered to this Model's base_model so combo cards
     only show combos the commander configured for this exact sofa Model.
     base_model comes from the useProduct mfg fallback path (added
     2026-05-28). Null/undefined → no filter → shows all combos (safe
     fallback for legacy UUID products that don't have a base_model). */
  const sofaCombosQ = useSofaCombos(product.data?.base_model);
  // Quick Picks (Phase 5) — saved LAYOUTS the salesperson taps to start.
  // GLOBAL layer (Master-Admin-curated, shared) + PERSONAL "Yours" (per-device).
  // Combos stay invisible: they auto-apply via the engine on module match.
  const globalQPsQ = useSofaQuickPicks(product.data?.base_model);
  useSofaQuickPicksRealtime();
  const deleteGlobalQP = useDeleteSofaQuickPick();
  // Personal Quick Picks are now DB-backed (WS1) so they follow the salesperson
  // across devices. The server RLS-scopes them to the logged-in staff; we also
  // key the query by staff id (below) so a stale cache can't flash the previous
  // user's picks after an in-SPA account switch on a shared tablet.
  const { data: staff } = useStaff();
  const myQPsQ = useMyQuickPicks(staff?.id, product.data?.base_model);
  const deletePersonalQP = useDeletePersonalQuickPick();
  const canCurateQP = isGlobalCurator(staff?.role);
  const addConfigured = useCart((s) => s.addConfigured);
  const cartLines = useCart((s) => s.lines);

  // Unified Quick Pick list: global first, then this salesperson's personal
  // picks for this Model. Personal picks store flat module ids → wrap each as a
  // singleton OR-set slot so both layers share the cells/preview path.
  const baseModelStr = product.data?.base_model ?? '';
  const globalQPItems = useMemo<QuickPickItem[]>(
    // Re-filter by base model client-side too: a sofa SKU with no base_model
    // (legacy/orphan) must NOT show other Models' shared layouts (Phase 5
    // review — defends alongside the server's required-scope guard).
    () => (globalQPsQ.data ?? [])
      .filter((r) => !!baseModelStr && r.baseModel === baseModelStr)
      .map((r) => ({
        id: r.id, source: 'global' as const, label: r.label, modules: r.modules, depth: r.depth,
      })),
    [globalQPsQ.data, baseModelStr],
  );
  const personalQPItems = useMemo<QuickPickItem[]>(
    // Server already scopes to the logged-in salesperson (RLS) + this base
    // model, and stores modules as string[][] (OR-set slots) — use them as-is.
    () => (myQPsQ.data ?? []).map((p) => ({
      id: p.id, source: 'personal' as const, label: p.label,
      modules: p.modules, depth: p.depth,
    })),
    [myQPsQ.data],
  );

  // ─── Edit mode ───────────────────────────────────────────────────────────
  // The cart's Edit button navigates to /configure/:productId?edit=<lineKey>.
  // We resolve the line, hydrate this Configurator's local state ONCE (after the
  // queries that kind needs have loaded), then Add-to-Cart replaces in place via
  // editingKey instead of appending a new line.
  const [searchParams] = useSearchParams();
  const editKey = searchParams.get('edit');
  const editingLine = useMemo(
    () => (editKey ? cartLines.find((l) => l.key === editKey) ?? null : null),
    [editKey, cartLines],
  );
  const isEditing = editingLine != null && editingLine.config.productId === productId;
  const hydratedRef = useRef(false);
  // Defensive reset — edit always enters from /cart on a fresh mount, but if the
  // target key/product changes the one-shot guard shouldn't stay latched.
  useEffect(() => { hydratedRef.current = false; }, [editKey, productId]);

  /* ── TBC sofa exchange (Loo 2026-06-12) ──────────────────────────────
     Entered from My orders ("Change product" on a sofa build): ?swapDoc /
     ?swapItem / ?swapTotal identify the SO build being replaced. The sofa
     paths' primary button becomes "Confirm Change" and, instead of adding to
     the cart, the build is marshalled exactly like the handover (real module
     SKU codes via fetchItemCodeMap) and POSTed to tbc-swap-sofa, which
     reprices it on the create path's authoritative engine. The floor rule
     (bill never below the original SO total) is pre-checked here and
     re-enforced server-side. */
  const location = useLocation();
  const swapDoc = searchParams.get('swapDoc');
  const swapItemId = searchParams.get('swapItem');
  const swapPrevTotalCenti = Math.max(0, Number(searchParams.get('swapTotal') ?? '0') || 0);
  const isSwapMode = !!(swapDoc && swapItemId);
  const [swapPending, setSwapPending] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);
  // "Same Model" seeds the canvas with the SO build's current cells (passed
  // via nav state — lost on a hard refresh, which simply starts blank).
  const swapSeededRef = useRef(false);
  useEffect(() => {
    if (!isSwapMode || swapSeededRef.current) return;
    const cellsIn = (location.state as { swapCells?: Array<{ moduleId: string; x: number; y: number; rot: number }> } | null)?.swapCells;
    if (cellsIn && cellsIn.length > 0) {
      setSofaCells(cellsIn.map((c) => ({
        id: typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
          ? crypto.randomUUID()
          : `c-${Math.random().toString(36).slice(2, 10)}`,
        moduleId: c.moduleId, x: c.x, y: c.y, rot: c.rot,
      } as Cell)));
      setMode('custom');
    }
    swapSeededRef.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSwapMode]);
  /* ── Add-product-to-placed-SO mode (Task 6, free-item-campaign) ────────
     Entered from My orders "Add product" — ?addToOrder=SO-XXXX carries the
     target SO. The primary button becomes "Add to this order"; the build is
     marshalled exactly like the handover path (fetchItemCodeMap + cartLinesToSoItems)
     and POSTed to POST /:docNo/items. Honest pricing: the server recompute
     is authoritative — a drift 400 surfaces the server's figure so the
     salesperson can re-submit at the correct price. */
  const addToOrderDoc = searchParams.get('addToOrder');
  const isAddToOrderMode = !!addToOrderDoc;
  const soHeaderQ = useSoHeaderForAdd(addToOrderDoc ?? undefined);
  const soHeader = soHeaderQ.data;
  const addToOrderMutation = useAddProductToPlacedSo();
  const [addToOrderPending, setAddToOrderPending] = useState(false);
  const [addToOrderError, setAddToOrderError] = useState<string | null>(null);

  /** Marshal and POST a configured snapshot to POST /:docNo/items. Works
   *  for any product kind — the same CartLine + fetchItemCodeMap path the
   *  handover uses, scoped to a single item. */
  const confirmAddToOrder = async (
    snapshot: SofaConfigSnapshot | SizeConfigSnapshot | BedframeConfigSnapshot | FlatConfigSnapshot,
    qty = 1,
  ) => {
    if (!addToOrderDoc || addToOrderPending || !soHeader?.addEligible) return;
    setAddToOrderError(null);
    setAddToOrderPending(true);
    try {
      // Wrap the snapshot as a temporary CartLine so fetchItemCodeMap can
      // resolve the real mfg_products.code the same way the handover does.
      const tempLine: CartLine = {
        key: `ato-${Date.now()}`,
        qty,
        config: snapshot,
      };
      const resolution = await fetchItemCodeMap([tempLine]);
      const [soItem] = cartLinesToSoItems([tempLine], undefined, resolution);
      if (!soItem) throw new Error('Failed to marshal item.');
      // PosHandoffItem is a superset of AddSoItemBody (extra fields: description,
      // cartLineKey) — the API ignores the extras. Cast to satisfy TS.
      await addToOrderMutation.mutateAsync({ docNo: addToOrderDoc, item: soItem as unknown as AddSoItemBody });
      navigate(`/my-orders`);
    } catch (err) {
      if (err instanceof AddSoItemApiError) {
        const { payload } = err;
        // pricing_drift: surface both figures + let user re-submit.
        if (payload.error === 'pricing_drift' && payload.itemCode) {
          const clientRm = Math.round((payload.client ?? 0) / 100).toLocaleString('en-MY');
          const serverRm = Math.round((payload.server ?? 0) / 100).toLocaleString('en-MY');
          setAddToOrderError(
            `The server priced this item differently — tablet: RM ${clientRm}, server: RM ${serverRm}. `
            + `The server price is authoritative. Hard-refresh the app (or go back and re-enter) to pick up the current pricing.`,
          );
        } else if (payload.error === 'so_has_downstream') {
          setAddToOrderError('This order already has a Delivery Order or Invoice — no more items can be added.');
        } else if (payload.error === 'SO_PROCESSING_LOCKED') {
          setAddToOrderError('This order is processing-locked — the processing date has passed.');
        } else if (payload.error === 'free_item_not_eligible') {
          setAddToOrderError('This free item campaign is not eligible for this order.');
        } else if (payload.error === 'pwp_code_rejected') {
          setAddToOrderError('The PWP code was rejected — it may already be used or not applicable here.');
        } else if (payload.error === 'free_and_pwp_exclusive') {
          setAddToOrderError('A free-item line and a PWP redemption cannot be on the same order.');
        } else {
          const detail = payload.reason ?? payload.message;
          setAddToOrderError(`Add failed: ${payload.error}${detail ? ` — ${detail}` : ''}`);
        }
      } else {
        setAddToOrderError(err instanceof Error ? err.message : 'Add failed.');
      }
    } finally {
      setAddToOrderPending(false);
    }
  };

  const confirmSwap = async (snapshot: SofaConfigSnapshot) => {
    if (!swapDoc || !swapItemId || swapPending) return;
    setSwapError(null);
    if (snapshot.total * 100 < swapPrevTotalCenti) {
      setSwapError(`This build (RM ${snapshot.total.toLocaleString('en-MY')}) is below the original build's RM ${Math.round(swapPrevTotalCenti / 100).toLocaleString('en-MY')} — the bill can't go below the original sales order total.`);
      return;
    }
    setSwapPending(true);
    try {
      const apiUrl = import.meta.env.VITE_API_URL as string | undefined;
      if (!apiUrl) throw new Error('VITE_API_URL is not set');
      const line: CartLine = { key: `swap-${swapItemId}`, qty: 1, config: snapshot };
      const resolution = await fetchItemCodeMap([line]);
      const [soItem] = cartLinesToSoItems([line], undefined, resolution);
      const token = (await supabase.auth.getSession()).data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${apiUrl}/mfg-sales-orders/${swapDoc}/items/${swapItemId}/tbc-swap-sofa`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        body: JSON.stringify({ item: soItem }),
      });
      if (!res.ok) {
        let payload: Record<string, unknown> = { error: `http_${res.status}` };
        try { payload = (await res.json()) as Record<string, unknown>; } catch { /* non-JSON */ }
        const err = String(payload.error ?? '');
        throw new Error(
          err === 'so_total_below_original'
            ? 'This build would bring the bill below the original sales order total.'
            : err === 'pricing_drift'
              ? 'The server priced this build differently — hard-refresh the app and try again.'
              : String(payload.reason ?? payload.message ?? err ?? 'Exchange failed.'),
        );
      }
      navigate('/my-orders');
    } catch (e) {
      setSwapError(e instanceof Error ? e.message : 'Exchange failed.');
    } finally {
      setSwapPending(false);
    }
  };

  // Per-line ITEM remark + special add-on (note + extra charge) — keyed on the
  // product page, stored in the cart snapshot, lands on the SO line (Loo
  // 2026-06-13). Two separate fields now: lineRemark → variants.remark (the SO's
  // "Remark:" line); lineExtraNote + lineExtraRm → the special add-on
  // (variants.extraAddonNote + extraAddonAmountRM → custom_specials). The old
  // pos_product_remark gate is removed — both fields always show.
  const [lineRemark, setLineRemark] = useState('');
  const [lineExtraNote, setLineExtraNote] = useState('');
  const [lineExtraRm, setLineExtraRm] = useState(0);
  // Line quantity (Loo 2026-06-12) — mattress + bedframe only. The snapshot
  // total stays PER-UNIT (server scales unit × qty); qty rides the cart line.
  const [lineQty, setLineQty] = useState(1);
  useEffect(() => { setLineRemark(''); setLineExtraNote(''); setLineExtraRm(0); setLineQty(1); }, [editKey, productId]);
  // Effective extra (whole MYR, per unit). Declared up here because the
  // size/bedframe/sofa totals below fold it in.
  const effectiveExtraRm = Math.max(0, Math.min(99999, Math.round(lineExtraRm || 0)));

  // Bedframe colour + option libraries (also used by <BedframeOptions>; React
  // Query dedupes). The parent needs them to rebuild bfSel labels + surcharges
  // when editing a bedframe line.
  const bedframeColours = useBedframeColours(productId);
  const bedframeOptions = useBedframeCustomizerData(productId);
  // Special Add-ons (migration 0134) — the Model's allowed codes ∩ the active
  // BEDFRAME add-ons. Drives the BedframeOptions picker + edit-hydration. These
  // hooks MUST stay above the `if (product.isLoading) return` guard below
  // (hooks order — a hook after it crashes with "Rendered more hooks").
  const allSpecialAddonsQ = useSpecialAddons();
  const bedframeAllowedSpecialsQ = useModelAllowedSpecials(productId);
  const bedframeSpecialAddons = useMemo(() => {
    const allowed = new Set(bedframeAllowedSpecialsQ.data ?? []);
    return (allSpecialAddonsQ.data ?? []).filter(
      (a) => a.active && a.categories.includes('BEDFRAME') && allowed.has(a.code),
    );
  }, [allSpecialAddonsQ.data, bedframeAllowedSpecialsQ.data]);
  // Same allowed-codes query (per-Model) re-filtered per category for sofa + mattress.
  const sofaSpecialAddons = useMemo(() => {
    const allowed = new Set(bedframeAllowedSpecialsQ.data ?? []);
    return (allSpecialAddonsQ.data ?? []).filter(
      (a) => a.active && a.categories.includes('SOFA') && allowed.has(a.code),
    );
  }, [allSpecialAddonsQ.data, bedframeAllowedSpecialsQ.data]);
  const mattressSpecialAddons = useMemo(() => {
    const allowed = new Set(bedframeAllowedSpecialsQ.data ?? []);
    return (allSpecialAddonsQ.data ?? []).filter(
      (a) => a.active && a.categories.includes('MATTRESS') && allowed.has(a.code),
    );
  }, [allSpecialAddonsQ.data, bedframeAllowedSpecialsQ.data]);

  // ── PWP (换购, 0128) — can the CURRENT product be redeemed at its PWP price? ──
  // Active rules + the cart decide it, via the SAME pure resolvePwp the server
  // uses, so the toggle + price the salesperson sees match what the server will
  // lock (no surprise 400 at checkout). The toggle disappears once the allowance
  // is used up (Chairman 2026-06-02). triggerLabel = the mattress this reward
  // binds to → shown on the invoice sub-line.
  const pwpRulesQ = usePwpRules();
  const [usePwp, setUsePwp] = useState(false);
  // Cross-order "Insert PWP Code" state (declared early so its reset runs BEFORE
  // the edit-hydrate effect below, which re-applies a saved code).
  const [insertCodeInput, setInsertCodeInput] = useState('');
  const [insertedCode, setInsertedCode] = useState<string | null>(null);
  // 'promo' lets the inserted code redeem this reward free even with no PWP price (migration 0145).
  const [insertedCodeType, setInsertedCodeType] = useState<'pwp' | 'promo'>('pwp');
  const [insertErr, setInsertErr] = useState<string | null>(null);
  const [insertChecking, setInsertChecking] = useState(false);
  // Sofa PWP voucher state — lifted here (2026-06-02) so the redeem control can
  // live in the shared Quick Pick / Customize top bar (sofaCenterSlot) and price
  // BOTH modes. Was inside CustomBuilder (Customize-only). Server logic unchanged.
  const [sofaPwpInput, setSofaPwpInput] = useState('');
  const [sofaPwpCode, setSofaPwpCode] = useState<string | null>(null);
  const [sofaPwpComboIds, setSofaPwpComboIds] = useState<string[]>([]);
  const [sofaPwpErr, setSofaPwpErr] = useState<string | null>(null);
  const [sofaPwpChecking, setSofaPwpChecking] = useState(false);
  useEffect(() => { // never leak the toggle / code across products
    setUsePwp(false);
    setInsertCodeInput(''); setInsertedCode(null); setInsertedCodeType('pwp'); setInsertErr(null);
    setSofaPwpInput(''); setSofaPwpCode(null); setSofaPwpComboIds([]); setSofaPwpErr(null);
    setSofaLegValue(null);
  }, [productId]);
  const pwpEval = useMemo(() => {
    const rules = pwpRulesQ.data ?? [];
    const candCategory = String((product.data as { category_id?: string | null } | null)?.category_id ?? '').toUpperCase();
    const candModelId = (product.data as { model_id?: string | null } | null)?.model_id ?? null;
    if (rules.length === 0 || !candCategory) return { available: false, triggerLabel: null as string | null };
    // Existing cart lines → PwpLineInput[] (exclude the line being edited so it
    // isn't counted against its own allowance).
    const others = cartLines.filter((l) => !(editKey && l.key === editKey));
    const baseInputs: PwpLineInput[] = others.map((l, i) => {
      const c = l.config as { kind: string; category?: string; modelId?: string | null; productName?: string; pwp?: boolean };
      return {
        idx: i,
        category: String(c.category ?? '').toUpperCase(),
        modelId: c.modelId ?? null,
        qty: l.qty,
        productName: c.productName,
        pwpRequested: c.kind === 'bedframe' ? c.pwp === true : false,
        /* Promo one-way (Loo 2026-06-06) — a line already bought with a code
           never opens promo allowance (a free ARRUS can't fund the next free
           ARRUS), while 'pwp' chains stay allowed. */
        isReward: c.pwp === true,
      };
    });
    const candidateIdx = baseInputs.length;
    const candidate: PwpLineInput = {
      idx: candidateIdx, category: candCategory, modelId: candModelId, qty: 1,
      productName: product.data?.name, pwpRequested: true,
    };
    const grant = resolvePwp(rules, [...baseInputs, candidate]).find((g) => g.idx === candidateIdx);
    return { available: !!grant, triggerLabel: grant?.triggerRef?.name ?? null };
  }, [pwpRulesQ.data, product.data, cartLines, editKey]);

  // ── PWP Code Voucher (0130) — the reward this product would redeem against. ──
  const reservedCodesQ = useMyReservedPwpCodes();
  const pwpRewardCategory = String((product.data as { category_id?: string | null } | null)?.category_id ?? '').toUpperCase();
  const pwpRewardModelId = (product.data as { model_id?: string | null } | null)?.model_id ?? null;
  // The next RESERVED code in THIS cart eligible for this reward, not already
  // applied to another line — consumed in the ORDER the trigger lines were added
  // (Chairman 2026-06-02: 3 mattresses → their codes used first-added-first). The
  // "Auto Fill" button drops it into the Insert PWP Code field. The salesperson
  // can't otherwise see same-cart codes (they're server-generated, invisible
  // until the trigger SO confirms).
  const sameCartPick = useMemo(() => {
    const codes = reservedCodesQ.data ?? [];
    const lineOrder = new Map(cartLines.map((l, i) => [l.key, i]));
    const applied = new Set(
      cartLines
        .filter((l) => !(editKey && l.key === editKey))
        .flatMap((l) => { const c = l.config as { pwpCode?: string }; return c.pwpCode ? [c.pwpCode] : []; }),
    );
    const eligible = codes.filter((rc) =>
      rc.cartLineKey &&
      String(rc.rewardCategory).toUpperCase() === pwpRewardCategory &&
      (rc.eligibleRewardModelIds.length === 0 ||
        (pwpRewardModelId != null && rc.eligibleRewardModelIds.includes(pwpRewardModelId))) &&
      !applied.has(rc.code),
    );
    // Order by the trigger line's cart position (first-added trigger first).
    eligible.sort((a, b) =>
      (lineOrder.get(a.cartLineKey ?? '') ?? 1e9) - (lineOrder.get(b.cartLineKey ?? '') ?? 1e9));
    return eligible[0] ?? null;
  }, [reservedCodesQ.data, cartLines, editKey, pwpRewardCategory, pwpRewardModelId]);
  const sameCartCode = sameCartPick?.code ?? null;
  // A promo code redeems this reward free even when the size has no PWP price set.
  const sameCartIsPromo = sameCartPick?.type === 'promo';

  const applyInsertedCode = async (codeArg?: string) => {
    const code = (codeArg ?? insertCodeInput).trim().toUpperCase();
    if (!code) return;
    setInsertCodeInput(code);
    // One code = one redemption (Loo 2026-06-06) — the manual Insert path used
    // to accept a code already applied on another cart line (the DB row stays
    // AVAILABLE until Confirm, so the server validate alone can't catch it).
    const appliedElsewhere = cartLines.some((l) =>
      !(editKey && l.key === editKey) && (l.config as { pwpCode?: string }).pwpCode === code);
    if (appliedElsewhere) {
      setInsertedCode(null);
      setInsertErr('This PWP code is already applied to another item in this cart.');
      return;
    }
    setInsertChecking(true); setInsertErr(null);
    try {
      const res = await validatePwpCode({ code, rewardCategory: pwpRewardCategory, rewardModelId: pwpRewardModelId });
      if (!res.valid) { setInsertedCode(null); setInsertErr(pwpReasonText(res.reason)); return; }
      // A 'pwp' code still needs a set PWP price; a 'promo' code may redeem free.
      const isPromo = res.type === 'promo';
      if (!isPromo && !(pickedSize?.pwpPrice != null && pickedSize.pwpPrice > 0)) {
        setInsertedCode(null);
        setInsertErr('This size has no PWP price set — set it in SKU Master first.');
        return;
      }
      setInsertedCode(code);
      setInsertedCodeType(isPromo ? 'promo' : 'pwp');
    } catch { setInsertedCode(null); setInsertErr('Could not validate the code.'); }
    finally { setInsertChecking(false); }
  };

  // Fabric availability for the sofa configurator.
  // • mfg-{12hex} products: derive from sofaCustomizer.fabricIds (allowed_options)
  //   joined against the global fabric_library. Only active entries pass.
  //   product_fabrics has a UUID FK so querying it with mfg IDs would crash.
  // • Legacy UUID products: use useProductFabrics as before (product_fabrics rows).
  // Declared here (before the edit-hydration useEffect) so it's in scope for both
  // the hydration logic and the FabricColourPicker render below.
  // Sofa enabled fabric colour codes: mfg → the Model's allowed_options.fabrics
  // (via sofaCustomizer); legacy UUID products keep their product_fabrics rows
  // (no colour gate). Empty → "No fabrics enabled".
  const sofaFabricCodes = useMemo<string[]>(
    () => (productId?.startsWith('mfg-') ? (sofaCustomizer.data?.fabricIds ?? []) : []),
    [productId, sofaCustomizer.data],
  );
  const derivedFabricRows = useMemo<ProductFabricRow[]>(() => {
    if (!productId?.startsWith('mfg-')) return productFabrics.data ?? [];
    return buildFabricSeriesRows(sofaFabricCodes);
  }, [productId, productFabrics.data, sofaFabricCodes, buildFabricSeriesRows]);

  // One-shot hydration from the edited cart line. Waits for the per-kind query
  // data so re-derived surcharges/labels are accurate, not stale 0s.
  useEffect(() => {
    if (!isEditing || hydratedRef.current || !editingLine) return;
    const cfg = editingLine.config;

    if (cfg.kind === 'size') {
      // Wait for the product row — the PWP re-arm below validates against the
      // product's reward category/model, which are '' until the query lands.
      if (product.data == null) return;
      setPickedSizeId(cfg.sizeId);
      const next: Record<string, number> = {};
      for (const e of cfg.addonExtras ?? []) next[e.addonId] = e.qty;
      setPillowExtras(next);
      setMattressSpecialSel((cfg.specialIds ?? []).map((code, i) => {
        const addon = mattressSpecialAddons.find((a) => a.code === code);
        const choices = cfg.specialChoices?.[code] ?? [];
        return { id: code, label: addon?.label ?? cfg.specialLabels?.[i] ?? code, surcharge: addon ? specialSelSurchargeRM(addon, choices) : 0, choices };
      }));
      // PWP (换购) — re-arm the redemption if this line had it (mirror of the
      // bedframe branch below). Without this, editing a redeemed mattress
      // dropped the voucher silently AND unlocked the quantity stepper at the
      // full price (review 2026-06-12).
      setUsePwp(cfg.pwp === true);
      if (cfg.pwp && cfg.pwpCode) {
        setInsertedCode(cfg.pwpCode); setInsertCodeInput(cfg.pwpCode);
        void validatePwpCode({ code: cfg.pwpCode, rewardCategory: pwpRewardCategory, rewardModelId: pwpRewardModelId })
          .then((res) => { if (res.valid && res.type) setInsertedCodeType(res.type); })
          .catch(() => { /* keep 'pwp' default; server stays authoritative */ });
      }
      setLineRemark(cfg.remark ?? '');
      setLineExtraNote(cfg.extraAddonNote ?? '');
      setLineExtraRm(cfg.extraAddonAmountRM ?? 0);
      setLineQty(Math.max(1, editingLine.qty));
      hydratedRef.current = true;
    } else if (cfg.kind === 'bedframe') {
      if (bedframeColours.data == null || bedframeOptions.data == null || fabricLib.data == null) return;
      const cRow = bedframeColours.data.find((c) => c.id === cfg.colourId);
      const optById = new Map(bedframeOptions.data.map((o) => [o.id, o]));
      const gap = cfg.gapId ? optById.get(cfg.gapId) : undefined;
      const leg = cfg.legHeightId ? optById.get(cfg.legHeightId) : undefined;
      const divan = cfg.divanHeightId ? optById.get(cfg.divanHeightId) : undefined;
      setPickedSizeId(cfg.sizeId);
      setBfSel({
        colourId: cfg.colourId ?? null,
        colourLabel: cRow?.label ?? cfg.colourLabel ?? null,
        colourHex: cRow?.swatchHex ?? cfg.colourHex ?? null,
        colourSurcharge: cRow?.surcharge ?? 0,
        gapId: cfg.gapId ?? null,
        gapLabel: gap?.value ?? cfg.gapLabel ?? null,
        gapSurcharge: gap?.surcharge ?? 0,
        legId: cfg.legHeightId ?? null,
        legLabel: leg?.value ?? cfg.legHeightLabel ?? null,
        legSurcharge: leg?.surcharge ?? 0,
        divanId: cfg.divanHeightId ?? null,
        divanLabel: divan?.value ?? cfg.divanHeightLabel ?? null,
        divanSurcharge: divan?.surcharge ?? 0,
        // Special Add-ons (migration 0134): cfg.specialIds holds codes; rebuild
        // from special_addons + saved specialChoices. Falls back to the saved
        // label when the code no longer exists in the live add-on list.
        specials: (cfg.specialIds ?? []).map((code, i) => {
          const addon = bedframeSpecialAddons.find((a) => a.code === code);
          const choices = cfg.specialChoices?.[code] ?? [];
          return {
            id: code,
            label: addon?.label ?? cfg.specialLabels?.[i] ?? code,
            surcharge: addon ? addonSurchargeRM(addon, choices) : 0,
            choices,
          };
        }),
      });
      // Bedframe colour now comes from the chosen fabric (migration 0124) —
      // hydrate fabricSel from the snapshot so editing pre-selects it. A KIV
      // line (Loo 2026-06-12) has fabricId but NO colourId — hydrate it too,
      // or editing the line would silently drop the fabric (and its tier Δ).
      if (cfg.fabricId) {
        const libRow = (fabricLib.data ?? []).find((f) => f.id === cfg.fabricId);
        setFabricSel({
          fabricId: cfg.fabricId, colourId: cfg.colourId ?? null,
          fabricLabel: cfg.fabricLabel ?? '', colourLabel: cfg.colourId ? (cfg.colourLabel ?? '') : null,
          colourHex: cfg.colourHex ?? null, surcharge: 0,
          sofaTier: libRow?.sofaTier ?? null, bedframeTier: libRow?.bedframeTier ?? null,
        });
      }
      // PWP (换购) — re-arm the redemption if this line had it. We re-apply the
      // exact saved code via the cross-order path so editing never loses or
      // re-rolls the voucher (server re-validates it at Confirm).
      setUsePwp(cfg.pwp === true);
      if (cfg.pwp && cfg.pwpCode) {
        setInsertedCode(cfg.pwpCode); setInsertCodeInput(cfg.pwpCode);
        // Recover the code's type so a promo (free) reward re-prices to RM0 on the
        // client too — otherwise it'd show full price and drift-reject at Confirm.
        void validatePwpCode({ code: cfg.pwpCode, rewardCategory: pwpRewardCategory, rewardModelId: pwpRewardModelId })
          .then((res) => { if (res.valid && res.type) setInsertedCodeType(res.type); })
          .catch(() => { /* keep 'pwp' default; server stays authoritative */ });
      }
      setLineRemark(cfg.remark ?? '');
      setLineExtraNote(cfg.extraAddonNote ?? '');
      setLineExtraRm(cfg.extraAddonAmountRM ?? 0);
      setLineQty(Math.max(1, editingLine.qty));
      hydratedRef.current = true;
    } else if (cfg.kind === 'sofa') {
      // Wait for fabric data to be ready — for mfg products this means both
      // sofaCustomizer + fabricLib must have loaded (derivedFabricRows depends
      // on both). For legacy UUID products productFabrics.data must be ready.
      const fabricsReady = productId?.startsWith('mfg-')
        ? sofaCustomizer.data != null && fabricLib.data != null
        : productFabrics.data != null;
      if (!fabricsReady) return;
      // PWP edit (2026-06-02) — re-deriving the matched reward combo needs the
      // combos loaded; defer the one-shot hydrate until they arrive.
      if (cfg.pwp && cfg.pwpCode && sofaCombosQ.data == null) return;
      setActiveDepth(cfg.depth ?? '24');
      // KIV line (Loo 2026-06-12): fabricId without colourId still hydrates —
      // the fabric tier Δ is part of the saved price and must survive an edit.
      if (cfg.fabricId) {
        const pf = derivedFabricRows.find((f) => f.fabricId === cfg.fabricId);
        const libRow = (fabricLib.data ?? []).find((f) => f.id === cfg.fabricId);
        setFabricSel({
          fabricId: cfg.fabricId,
          colourId: cfg.colourId ?? null,
          fabricLabel: cfg.fabricLabel ?? '',
          colourLabel: cfg.colourId ? (cfg.colourLabel ?? '') : null,
          colourHex: cfg.colourHex ?? null,
          surcharge: pf?.surcharge ?? 0,
          sofaTier: libRow?.sofaTier ?? null,
          bedframeTier: libRow?.bedframeTier ?? null,
        });
      }
      if (cfg.cells && cfg.cells.length > 0) {
        setMode('custom');
        setSofaCells(cfg.cells);
        // PWP (换购) — re-arm the saved voucher via the cross-order path. Match
        // the saved build against the loaded combos so the live total + chip
        // reflect the PWP price; the server re-validates + locks it at Confirm.
        if (cfg.pwp && cfg.pwpCode) {
          const builtMods = cfg.cells.map((c) => c.moduleId).filter(Boolean);
          const matched = (sofaCombosQ.data ?? [])
            .filter((c) => matchComboSubset(builtMods, c.modules) != null)
            .map((c) => c.id);
          setSofaPwpCode(cfg.pwpCode);
          setSofaPwpInput(cfg.pwpCode);
          setSofaPwpComboIds(matched.length > 0 ? [matched[0]!] : []);
        }
      } else if (cfg.bundleId) {
        setMode('quick');
        setPicked(cfg.bundleId);
        if (cfg.summary?.includes('L-facing')) setQuickFlip('L');
        else if (cfg.summary?.includes('R-facing')) setQuickFlip('R');
      }
      setSofaSpecialSel((cfg.specialIds ?? []).map((code, i) => {
        const addon = sofaSpecialAddons.find((a) => a.code === code);
        const choices = cfg.specialChoices?.[code] ?? [];
        return { id: code, label: addon?.label ?? cfg.specialLabels?.[i] ?? code, surcharge: addon ? specialSelSurchargeRM(addon, choices) : 0, choices };
      }));
      setSofaLegValue(cfg.sofaLegHeight ?? null);
      setLineRemark(cfg.remark ?? '');
      setLineExtraNote(cfg.extraAddonNote ?? '');
      setLineExtraRm(cfg.extraAddonAmountRM ?? 0);
      hydratedRef.current = true;
    }
  }, [isEditing, editingLine, bedframeColours.data, bedframeOptions.data,
      productFabrics.data, sofaCustomizer.data, fabricLib.data, productId, derivedFabricRows,
      sofaCombosQ.data, product.data]);

  // Depth-aware per-Model module SELLING map (sen) at the current seat depth,
  // tier P1 (SOFA-SELLING Phase B; Chairman 2026-06-01: run at P1 — the default
  // — with no fabric-tier variation yet; the global Δ2/Δ3 tier add is a later
  // change). Prefers each SKU's per-(depth,P1) seat_height_prices[].sellingPriceSen
  // (what the POS Edit-Price grid writes), falls back to flat sell_price_sen.
  // Built from the SAME raw rows + same (depth, P1) the server recompute uses, so
  // the drift gate can't diverge. Re-derives when the user toggles seat depth.
  const depthSellingMap = useMemo(
    () => sofaModuleSellingPricesFromSkus(
      sofaCustomizer.data?.sellingRows ?? [],
      sofaCustomizer.data?.modelCode,
      activeDepth,
      'PRICE_1',
    ),
    [sofaCustomizer.data?.sellingRows, sofaCustomizer.data?.modelCode, activeDepth],
  );
  // The modelCustomizer the Customize palette renders, with each compartment's
  // displayed price overridden to the depth-aware P1 selling (so the palette card
  // shows exactly what the live total + server charge). Falls back to the flat
  // query price when a module isn't in the depth map.
  const modelCustomizerForDepth = useMemo(() => {
    const base = sofaCustomizer.data;
    if (!base) return null;
    return {
      ...base,
      compartments: base.compartments.map((cc) => ({
        ...cc,
        priceSen: depthSellingMap[cc.normalizedCode] ?? cc.priceSen,
      })),
    };
  }, [sofaCustomizer.data, depthSellingMap]);

  // Build the SofaProductPricing struct that the shared pure functions expect.
  // Commander 2026-05-28 — added combos + fabricTier + comboHeight so groupPrice
  // can apply combo-price OVERRIDE: when the group's modules + tier match a
  // Backend Sofa Combo, the combo's pricesByHeight[activeDepth] wins over
  // bundle / à la carte. baseModel left empty for now — pickComboPrice
  // treats empty as wildcard until POS product ↔ mfg base_model bridges.
  const sofaPricing = useMemo<SofaProductPricing>(() => ({
    /* mfg products have no product_compartments rows (UUID FK), so the legacy
       hook returns []. Without this fallback computeSofaPrice would price every
       module at 0 → a custom (non-combo) build totals RM 0. Derive the
       per-compartment SELLING price from the Model's per-module SKU prices
       (SOFA-SELLING-PLAN, Chairman 2026-05-31: each module = its own mfg SKU
       sell_price_sen; a custom build SUMS them, a matched Combo overrides) —
       depth-aware P1 selling from modelCustomizerForDepth.compartments[].priceSen.
       compartmentId = normalizedCode so it matches a laid-out cell.moduleId. The
       server selling recompute builds the SAME map from the same SKUs at the same
       (depth, P1), so its drift-reject can't diverge. */
    compartments: (compartments.data && compartments.data.length > 0)
      ? compartments.data
      : (modelCustomizerForDepth?.compartments ?? []).map((cc) => ({
          compartmentId: cc.normalizedCode,
          active: true,
          price: Math.round(cc.priceSen / 100),
        })),
    bundles: bundles.data ?? [],
    reclinerUpgradePrice: product.data?.recliner_upgrade_price ?? 0,
    seatUpgradeLabel: product.data?.seat_upgrade_label ?? null,
    seatUpgradeFootrest: product.data?.seat_upgrade_footrest ?? true,
    combos: sofaCombosQ.data ?? [],
    /* Combo + seat-base lookup tier. Chairman 2026-06-01: the whole sofa runs
       at P1 — the module seat-height SELLING map is built at PRICE_1 (see
       depthSellingMap above) and EVERY sofa_combo_pricing row is authored at
       PRICE_1, so the combo match MUST query PRICE_1 too or no combo ever
       applies (the bug: combos were queried at PRICE_2 and silently never
       matched → 1A-only Quick Picks priced RM0). The fabric-tier difference is
       a separate flat add-on (PR #407), NOT a base-tier switch, so this stays
       fixed at PRICE_1. */
    fabricTier: 'PRICE_1',
    comboHeight: activeDepth,
    /* Empty = wildcard match. The combos fed in are ALREADY scoped to this
       Model by useSofaCombos(base_model), and the server drift gate
       (computeSofaSellingSen) also passes '' — keep them identical so the POS
       live price and the server recompute never diverge (Phase 5 review). */
    baseModel: '',
  }), [
    compartments.data, bundles.data, modelCustomizerForDepth,
    product.data?.recliner_upgrade_price,
    product.data?.seat_upgrade_label,
    product.data?.seat_upgrade_footrest,
    sofaCombosQ.data,
    activeDepth,
  ]);

  // PWP-effective sofa pricing — when a sofa PWP voucher is applied, the matched
  // reward combo is charged its PWP price (selling-over-cost merge). Feeds BOTH
  // the Quick Pick price (priceForLayout) and the Customize builder. GATED: with
  // no code applied it returns sofaPricing UNCHANGED (same reference) → zero
  // price change to the normal sofa flow (verify this no-op first).
  const effectiveSofaPricing = useMemo<SofaProductPricing>(() => {
    if (sofaPwpComboIds.length === 0) return sofaPricing;
    const set = new Set(sofaPwpComboIds);
    return {
      ...sofaPricing,
      combos: (sofaPricing.combos ?? []).map((c) =>
        set.has(c.id) ? { ...c, pricesByHeight: comboChargedPrices(c.pwpPricesByHeight, c.pricesByHeight) } : c,
      ),
    };
  }, [sofaPricing, sofaPwpComboIds]);

  // Price a Quick Pick LAYOUT (Chairman 2026-05-31): run its modules through the
  // SAME engine the build uses — à-la-carte module sum, or the Combo price when
  // the layout matches a Combo. One price source (the engine); the QP table
  // stores none. Returns whole MYR, or null when nothing prices (unpriced).
  const priceForLayout = useCallback((modules: string[][]): number | null => {
    const cells = cellsFromComboModules(modules, activeDepth);
    if (cells.length === 0) return null;
    const total = computeSofaPrice(cells, activeDepth, effectiveSofaPricing).total;
    return total > 0 ? Math.round(total) : null;
  }, [activeDepth, effectiveSofaPricing]);

  // ── Sofa PWP voucher (2026-06-02) — redeem control lifted to the shared top
  // bar so BOTH Quick Pick + Customize can apply a code. PWP applies only to
  // ENGINE-priced, cells-carrying builds: a saved Quick Pick (pickedQP) or a
  // Customize build. A fixed-price bundle preset has no cells, so the server
  // can't combo-recompute it (mfg-sales-orders.extractSofaComboLookupArgs needs
  // cells) — it never participates in PWP (sofaBuiltModules stays empty there).
  // NOTE: these hooks MUST stay above the early-return guard below (Rules of
  // Hooks) — the Configurator bails early while the product query is loading.
  const sofaBuiltModules = useMemo<string[]>(() => {
    if (mode === 'custom') return sofaCells.map((c) => c.moduleId).filter(Boolean);
    if (pickedQP) {
      const qpModules = qpMirror ? mirrorModules(pickedQP.modules) : pickedQP.modules;
      return qpModules.map((slot) => slot[0] ?? '').filter(Boolean);
    }
    return [];
  }, [mode, sofaCells, pickedQP, qpMirror]);

  // Combo ids the current build matches — the reward a sofa code must name.
  const sofaMatchedComboIds = useMemo(
    () => (sofaPricing.combos ?? []).filter((c) => matchComboSubset(sofaBuiltModules, c.modules) != null).map((c) => c.id),
    [sofaPricing.combos, sofaBuiltModules],
  );

  // Same-cart: the next RESERVED sofa code in THIS cart whose reward matches the
  // build, not already applied to another line — FIFO by cart position (mirrors
  // sameCartCode). "Auto Fill" drops it into the field + applies it.
  const sameCartSofa = useMemo(() => {
    const codes = reservedCodesQ.data ?? [];
    const lineOrder = new Map(cartLines.map((l, i) => [l.key, i]));
    const applied = new Set(
      cartLines
        .filter((l) => !(editKey && l.key === editKey))
        .flatMap((l) => { const c = l.config as { pwpCode?: string }; return c.pwpCode ? [c.pwpCode] : []; }),
    );
    const matchedSet = new Set(sofaMatchedComboIds);
    const eligible = codes.filter((rc) =>
      rc.cartLineKey &&
      String(rc.rewardCategory).toUpperCase() === 'SOFA' &&
      !applied.has(rc.code) &&
      (rc.rewardComboIds ?? []).some((id) => matchedSet.has(id)),
    );
    eligible.sort((a, b) =>
      (lineOrder.get(a.cartLineKey ?? '') ?? 1e9) - (lineOrder.get(b.cartLineKey ?? '') ?? 1e9));
    const top = eligible[0];
    if (!top) return null;
    const comboId = (top.rewardComboIds ?? []).find((id) => matchedSet.has(id));
    return comboId ? { code: top.code, comboId } : null;
  }, [reservedCodesQ.data, cartLines, editKey, sofaMatchedComboIds]);

  // Validate + apply a sofa PWP code against the build's matched combos (plain
  // fn, not a hook). Mirrors CustomBuilder's old applyPwpCode; codeArg lets Auto
  // Fill apply a same-cart code.
  const applySofaPwp = async (codeArg?: string) => {
    const code = (codeArg ?? sofaPwpInput).trim().toUpperCase();
    if (!code) return;
    setSofaPwpInput(code);
    // One code = one redemption (Loo 2026-06-06) — mirror applyInsertedCode's
    // already-on-another-line gate; the server validate can't see the cart.
    const appliedElsewhere = cartLines.some((l) =>
      !(editKey && l.key === editKey) && (l.config as { pwpCode?: string }).pwpCode === code);
    if (appliedElsewhere) {
      setSofaPwpCode(null); setSofaPwpComboIds([]);
      setSofaPwpErr('This PWP code is already applied to another item in this cart.');
      return;
    }
    setSofaPwpChecking(true); setSofaPwpErr(null);
    try {
      const matched = (sofaPricing.combos ?? []).filter((c) => matchComboSubset(sofaBuiltModules, c.modules) != null);
      if (matched.length === 0) { setSofaPwpCode(null); setSofaPwpComboIds([]); setSofaPwpErr('This build does not match any sofa combo.'); return; }
      let okCombo: string | null = null;
      for (const c of matched) {
        const res = await validatePwpCode({ code, rewardCategory: 'SOFA', rewardComboId: c.id });
        if (res.valid) { okCombo = c.id; break; }
      }
      if (okCombo) { setSofaPwpCode(code); setSofaPwpComboIds([okCombo]); }
      else { setSofaPwpCode(null); setSofaPwpComboIds([]); setSofaPwpErr('This PWP code cannot be applied to this build.'); }
    } catch { setSofaPwpCode(null); setSofaPwpComboIds([]); setSofaPwpErr('Could not validate the code.'); }
    finally { setSofaPwpChecking(false); }
  };

  // The applied grant is "live" only while the current build still matches it (a
  // plain derived value, not a hook). A build change auto-degrades the chip
  // without a reset effect (the engine also won't apply a non-matching combo, so
  // the price stays correct); the code is cleared outright only on a product
  // switch (the productId reset above).
  const sofaPwpApplied = sofaPwpCode != null && sofaPwpComboIds.some((id) => sofaMatchedComboIds.includes(id));

  // F5: per-Model seat depths ('24,30' → ['24','30']). Fallback ['24'] so the
  // toggle always has a value (only rendered for sofas, which always seed it).
  //
  // PR — Commander 2026-05-28: when the Model's allowed_options.sizes is set
  // (Backend → Products → Modular → [Model] → Allowed Options → Seat sizes),
  // it takes precedence over the legacy product.depth_options CSV. Falls
  // through to depth_options when the customizer isn't available (orphan
  // SKUs / unmigrated Models) so existing Models keep their toggles.
  const depthOptions = useMemo<Depth[]>(() => {
    // Sorted ascending so the toggle reads small→large AND depthOptions[0] is
    // the smallest — the configurator defaults to the smallest seat depth, the
    // salesperson picks larger if the customer wants (Chairman 2026-05-31: no
    // per-kit default-size setting; just default smallest).
    const sortAsc = (xs: Depth[]) => [...xs].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
    const fromAllowed = (sofaCustomizer.data?.sizes ?? []).filter(Boolean);
    if (fromAllowed.length > 0) return sortAsc(fromAllowed as Depth[]);
    const raw: string = product.data?.depth_options ?? '';
    const parsed = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return parsed.length > 0 ? sortAsc(parsed) : ['24'];
  }, [product.data?.depth_options, sofaCustomizer.data?.sizes]);

  // Keep activeDepth within the Model's offered depths (default to the smallest
  // — depthOptions is sorted ascending, so [0] is the smallest).
  useEffect(() => {
    if (!depthOptions.includes(activeDepth)) setActiveDepth(depthOptions[0] ?? '24');
  }, [depthOptions, activeDepth]);

  // Build size rows once per data refresh (used by isSize render + topbar
  // action slot). Only sizes the Master Admin turned ON in Modular surface —
  // useProductSizes already drops sizes that are OFF in allowed_options /
  // pos_active, so a size that isn't returned is omitted from the grid entirely
  // (Chairman 2026-06-01: OFF = gone, not a dimmed tile). A size kept but
  // cost-discontinued (status) still lands dimmed + non-clickable.
  const sizeRows = useMemo<SizeRow[]>(() => {
    const lib = sizeLib.data ?? [];
    const variants = sizes.data ?? [];
    return lib
      .filter((l) => l.sortOrder < 100)
      .map((l): SizeRow | null => {
        const variant = variants.find((v) => v.sizeId === l.id);
        if (!variant) return null; // OFF in Modular / not offered → gone
        return {
          id: l.id,
          label: l.label,
          widthCm: l.widthCm,
          lengthCm: l.lengthCm,
          price: variant.price ?? null,
          pwpPrice: variant.pwpPrice ?? null,
          active: variant.active,
        };
      })
      .filter((r): r is SizeRow => r !== null);
  }, [sizeLib.data, sizes.data]);

  const pickedSize = sizeRows.find((r) => r.id === pickedSizeId) ?? null;
  const sizeBase = pickedSize?.price ?? 0;
  const canAddSize = pickedSize != null && pickedSize.active && pickedSize.price != null;

  // Lookup map for addon details (used by both PILLOWS and ADD-ON sections).
  const addonsById = useMemo(() => {
    const m = new Map<string, AddonRow>();
    for (const a of addons.data ?? []) m.set(a.id, a);
    return m;
  }, [addons.data]);

  // Addon extras the staff can attach (e.g. extra pillows beyond the free
  // pair). Filter to category=pillow for mattress configurator.
  const pillowAddOns = useMemo(
    () => (addons.data ?? []).filter((a) => a.category === 'pillow' && a.unit === 'pillow'),
    [addons.data],
  );

  // Live total = size base + sum(extra qty × addon price).
  const extrasTotal = useMemo(() => {
    let sum = 0;
    for (const [addonId, qty] of Object.entries(pillowExtras)) {
      const addon = addonsById.get(addonId);
      if (!addon || qty < 1) continue;
      sum += addon.price * qty;
    }
    return sum;
  }, [pillowExtras, addonsById]);

  if (product.isLoading) return <p className={styles.empty}>Loading product…</p>;
  if (product.error || !product.data) {
    return (
      <>
      <Topbar step="cart" />
      <main className={styles.shell}>
        <p className={styles.empty}>
          Product not found. <Link to="/catalog">← Back to catalog</Link>
        </p>
      </main>
      </>
    );
  }

  const p = product.data;
  const isSofa = p.pricing_kind === 'sofa_build';
  const isSize = p.pricing_kind === 'size_variants';
  const isBedframe = p.pricing_kind === 'bedframe_build';
  // DIVAN ONLY base — collapses the configurator to size + colour + leg (no
  // mattress gap / divan height / total height / specials). Keyed off the SKU.
  const isDivan = p.sku === 'BED-DIVAN';

  // Bedframe line total = picked size base + every selected surcharge (all 0
  // for pilot, but threaded so a future Backend price edit flows through).
  // Fabric-tier add-on (migration 0124) — bedframe picks a fabric (fabricSel);
  // its bedframe tier adds a flat Δ (server adds the same). 0 with default data.
  const bedframeFabricDelta = fabricSel && addonCfgQ.data
    ? fabricTierAddon('BEDFRAME', fabricSel.bedframeTier as FabricTier | null, addonCfgQ.data, modelFabricOverride)
    : 0;
  // PWP Code Voucher (0130) — the bedframe's base becomes its per-size PWP price
  // (fabric Δ + option surcharges still stack; server adds the same on the PWP
  // base). Two ways in: (a) same-cart toggle (a qualifying trigger is in the
  // cart + a RESERVED code to consume); (b) a validated cross-order "Insert PWP
  // Code". Both gate on the picked size actually having a PWP price.
  // PWP applies to a bed frame OR a mattress (both reward categories). The picked
  // size's pwpPrice is the base; same-cart toggle or cross-order Insert PWP Code.
  const pwpUnitPrice = pickedSize?.pwpPrice ?? null;
  const isRewardCat = isBedframe || isSize;
  const hasPwpPrice = isRewardCat && pwpUnitPrice != null && pwpUnitPrice > 0;
  // A 'promo' code (migration 0145) redeems this reward FREE even with no PWP
  // price set; a 'pwp' code still needs a price > 0. Same-cart learns the type
  // from the reserved code; cross-order from the validate response.
  const sameCartOk = isRewardCat && (hasPwpPrice || sameCartIsPromo);
  const crossOk = isRewardCat && (hasPwpPrice || insertedCodeType === 'promo');
  const pwpToggleAvailable = sameCartOk && pwpEval.available && sameCartCode != null;
  const sameCartPwpActive = pwpToggleAvailable && usePwp;
  const crossPwpActive = crossOk && insertedCode != null;
  const pwpActive = sameCartPwpActive || crossPwpActive;
  const appliedPwpCode = crossPwpActive ? insertedCode : (sameCartPwpActive ? sameCartCode : null);
  // Redeemed unit price: a promo with no set price is free (0); else the size's PWP price.
  const redeemedUnitPrice = pwpUnitPrice ?? 0;
  const bedframeBase = pwpActive ? redeemedUnitPrice : sizeBase;
  const bedframeTotal = bedframeBase + bedframeSurcharge(bfSel) + bedframeFabricDelta + effectiveExtraRm;
  // Mattress (size) line total — PWP base when redeemed, else the size price.
  const sizeTotal = (pwpActive ? redeemedUnitPrice : sizeBase) + extrasTotal
    + specialSelsSurcharge(mattressSpecialSel) + effectiveExtraRm;

  /* PWP Code Voucher (0130/0132) — shared section for the bed frame + mattress
     reward configurators (discoverability, Chairman 2026-06-02). Always shown so
     a salesperson can redeem a voucher; a note explains when no PWP price is set.
     The same-cart toggle appears when a qualifying trigger + reserved code are in
     the cart; "Insert PWP Code" redeems a cross-order voucher. */
  const pwpRailSection = (
    <RailSection title="PWP & Promo Voucher">
      {insertedCode ? (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-2)', padding: 'var(--space-2) 0' }}>
          <span style={{ fontSize: 'var(--fs-12)' }}>
            <span style={{ fontWeight: 600 }}>PWP code {insertedCode}</span>
            <span style={{ display: 'block', color: 'var(--fg-muted)' }}>
              Applied · RM {redeemedUnitPrice.toLocaleString('en-MY')}
            </span>
          </span>
          <Button variant="ghost" onClick={() => { setInsertedCode(null); setInsertedCodeType('pwp'); setInsertCodeInput(''); setInsertErr(null); }}>
            Remove
          </Button>
        </div>
      ) : (
        <div style={{ paddingTop: 'var(--space-2)' }}>
          <label style={{ display: 'block', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 'var(--space-1)' }}>
            Insert PWP Code
          </label>
          {sameCartCode && sameCartOk && (
            <p style={{ margin: '0 0 var(--space-1)', fontSize: 'var(--fs-12)', color: 'var(--c-burnt, #A6471E)' }}>
              A PWP code from this cart is ready{pwpEval.triggerLabel ? ` (from ${pwpEval.triggerLabel})` : ''} — tap Auto Fill.
            </p>
          )}
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input
              type="text"
              value={insertCodeInput}
              onChange={(e) => { setInsertCodeInput(e.target.value); setInsertErr(null); }}
              placeholder="PWP-1234ABCD"
              style={{ flex: 1, textTransform: 'uppercase' }}
            />
            {sameCartCode && sameCartOk && (
              <Button
                variant="primary"
                onClick={() => void applyInsertedCode(sameCartCode)}
                disabled={insertChecking}
              >
                Auto Fill
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={() => void applyInsertedCode()}
              disabled={insertChecking || !insertCodeInput.trim()}
            >
              {insertChecking ? 'Checking…' : 'Apply'}
            </Button>
          </div>
          {insertErr && (
            <p style={{ margin: 'var(--space-1) 0 0', fontSize: 'var(--fs-12)', color: 'var(--c-danger, #B4321A)' }}>{insertErr}</p>
          )}
        </div>
      )}
    </RailSection>
  );

  // Special add-on (note + extra charge) — Loo 2026-06-13. The description + amount
  // feed variants.extraAddonNote + extraAddonAmountRM → custom_specials (a charged
  // special add-on on the SO). Rendered directly below the SPECIAL ADD-ON chips.
  const specialAddonRailSection = (
    <RailSection title="Special add-on" sub="Optional — adds a charged item to the sales order">
      <label className={styles.sizeOtherField}>
        <span className={styles.sizeOtherLabel}>Description</span>
        <textarea
          className={styles.sizeOtherInput}
          rows={2}
          placeholder="What's the add-on for…"
          value={lineExtraNote}
          maxLength={300}
          onChange={(e) => setLineExtraNote(e.target.value)}
          style={{ resize: 'vertical' }}
        />
      </label>
      <label className={styles.sizeOtherField}>
        <span className={styles.sizeOtherLabel}>Amount (RM)</span>
        <input
          className={styles.sizeOtherInput}
          type="number"
          min={0}
          step={1}
          placeholder="0"
          value={lineExtraRm || ''}
          onChange={(e) => setLineExtraRm(Math.max(0, Math.min(99999, Math.round(Number(e.target.value) || 0))))}
        />
      </label>
    </RailSection>
  );
  // Item remark — Loo 2026-06-13. A plain per-line remark → variants.remark →
  // mfg_sales_order_items.remark; prints as the SO's "Remark:" line. Separate from
  // the special add-on note above; sits directly below it.
  const remarkRailSection = (
    <RailSection title="Remark" sub="Optional — prints on the sales order">
      <label className={styles.sizeOtherField}>
        <span className={styles.sizeOtherLabel}>Remark</span>
        <textarea
          className={styles.sizeOtherInput}
          rows={2}
          placeholder="Remark for this item…"
          value={lineRemark}
          maxLength={300}
          onChange={(e) => setLineRemark(e.target.value)}
          style={{ resize: 'vertical' }}
        />
      </label>
    </RailSection>
  );
  // Combined pair (special add-on, then item remark) — rendered right after the
  // SPECIAL ADD-ON chips on each product rail.
  const remarkExtraRailSection = (
    <>
      {specialAddonRailSection}
      {remarkRailSection}
    </>
  );

  /* Line quantity (Loo 2026-06-12) — mattress + bedframe rails only. The
     effective qty pins to 1 while a PWP/promo code is applied: one code = one
     redemption = one unit (the cart store + server claim loop enforce the same
     rule). The LIVE TOTAL and the hint below show qty × the per-unit total;
     the cart snapshot total stays per-unit. */
  const qtyEffective = pwpActive ? 1 : lineQty;
  const qtyUnitRm = isBedframe ? bedframeTotal : sizeTotal;
  const quantityRailSection = (
    <RailSection title="Quantity" sub={pwpActive ? 'PWP — one unit per code' : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
        <span className={styles.stepper}>
          <button
            type="button"
            className={styles.stepperBtn}
            onClick={() => setLineQty((q) => Math.max(1, q - 1))}
            disabled={pwpActive || qtyEffective <= 1}
            aria-label="Decrease quantity"
          >
            <Minus size={12} strokeWidth={2} />
          </button>
          <span className={styles.stepperVal}>{qtyEffective}</span>
          <button
            type="button"
            className={styles.stepperBtn}
            onClick={() => setLineQty((q) => q + 1)}
            disabled={pwpActive}
            aria-label="Increase quantity"
          >
            <Plus size={12} strokeWidth={2} />
          </button>
        </span>
        {qtyEffective > 1 && qtyUnitRm > 0 && (
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {qtyEffective} × RM {qtyUnitRm.toLocaleString('en-MY')} = RM {(qtyEffective * qtyUnitRm).toLocaleString('en-MY')}
          </span>
        )}
      </div>
    </RailSection>
  );
  // Required: size (active+priced) only — it picks the SKU itself. Fabric +
  // colour, gap, leg height and divan height are ALL optional at Add-to-Cart
  // (Loo 2026-06-11) — the customer may confirm them later. The SO-side
  // so-variant-rule still demands gap + legHeight + divanHeight + fabricCode
  // before a Processing date / Proceed, so production never starts on an
  // unconfirmed spec. Unpicked options add RM0 on both client and server
  // (lookupSelling(null) = 0), so the drift gate stays aligned.
  const canAddBedframe =
    isBedframe && pickedSize != null && pickedSize.active && pickedSize.price != null;

  const handleAddBedframe = () => {
    if (!canAddBedframe || pickedSize == null || pickedSize.price == null) return;
    const parts = [pickedSize.label];
    if (fabricSel?.fabricLabel) parts.push(fabricSel.fabricLabel);
    if (fabricSel?.colourLabel) parts.push(fabricSel.colourLabel);
    else if (fabricSel) parts.push('Colour KIV');
    if (bfSel.gapLabel) parts.push(`Gap ${bfSel.gapLabel}`);
    if (bfSel.legLabel) parts.push(`Leg ${bfSel.legLabel}`);
    if (bfSel.divanLabel) parts.push(`Divan ${bfSel.divanLabel}`);
    if (bfSel.specials.length > 0) parts.push(bfSel.specials.map((s) => s.label).join(' + '));
    const snapshot: BedframeConfigSnapshot = {
      kind: 'bedframe',
      productId: p.id,
      productName: p.name,
      sizeId: pickedSize.id,
      // Optional since 2026-06-11: absent = customer confirms fabric later.
      // Colour KIV (Loo 2026-06-12): fabric committed (tier Δ charged), colour
      // keys omitted — the SO's Fabrics axis stays open for the later fill-in.
      ...(fabricSel ? {
        fabricId: fabricSel.fabricId,
        fabricLabel: fabricSel.fabricLabel,
        ...(fabricSel.colourId ? {
          colourId: fabricSel.colourId,
          colourLabel: fabricSel.colourLabel,
          ...(fabricSel.colourHex ? { colourHex: fabricSel.colourHex } : {}),
        } : {}),
      } : {}),
      fabricTierDelta: bedframeFabricDelta,
      // PWP (换购, 0128) identity + grant. modelId/category let the cart re-resolve
      // PWP across lines; pwp/pwpTriggerLabel record the redemption for the invoice.
      modelId: (p as { model_id?: string | null }).model_id ?? null,
      category: String(p.category_id ?? '').toUpperCase(),
      ...(pwpActive && appliedPwpCode
        ? { pwp: true, pwpCode: appliedPwpCode, pwpTriggerLabel: crossPwpActive ? null : pwpEval.triggerLabel,
            pwpOriginalTotal: sizeBase + bedframeSurcharge(bfSel) + bedframeFabricDelta + effectiveExtraRm }
        : {}),
      // Per-line remark + extra charge (spec 2026-06-06). The extra is already
      // folded into bedframeTotal (and pwpOriginalTotal) — declared here only so
      // the server's drift gate adds the same per-unit amount.
      ...(lineRemark.trim() ? { remark: lineRemark.trim() } : {}),
      ...(lineExtraNote.trim() ? { extraAddonNote: lineExtraNote.trim() } : {}),
      ...(effectiveExtraRm > 0 ? { extraAddonAmountRM: effectiveExtraRm } : {}),
      ...(bfSel.gapId ? { gapId: bfSel.gapId, gapLabel: bfSel.gapLabel } : {}),
      ...(bfSel.legId ? { legHeightId: bfSel.legId, legHeightLabel: bfSel.legLabel } : {}),
      ...(bfSel.divanId ? { divanHeightId: bfSel.divanId, divanHeightLabel: bfSel.divanLabel } : {}),
      ...(bfSel.specials.length > 0
        ? {
            specialIds: bfSel.specials.map((s) => s.id),            // = special_addons codes
            specialLabels: bfSel.specials.map((s) => s.label),
            specialChoices: Object.fromEntries(
              bfSel.specials.map((s) => [s.id, s.choices ?? []]),
            ),
          }
        : {}),
      total: bedframeTotal,
      summary: parts.join(' · '),
    };
    if (isAddToOrderMode) { void confirmAddToOrder(snapshot, qtyEffective); return; }
    addConfigured(snapshot, { ...(isEditing && editKey ? { editingKey: editKey } : {}), qty: qtyEffective });
    navigate(isEditing ? '/cart' : '/catalog');
  };

  const handleAddSize = () => {
    if (!canAddSize || pickedSize == null || pickedSize.price == null) return;
    const extrasArr = Object.entries(pillowExtras)
      .filter(([, qty]) => qty > 0)
      .map(([addonId, qty]) => ({ addonId, qty }));
    const extraSummary = extrasArr.length > 0
      ? ` + ${extrasArr.reduce((s, e) => s + e.qty, 0)} extra pillow${extrasArr.reduce((s, e) => s + e.qty, 0) > 1 ? 's' : ''}`
      : '';
    const snapshot: SizeConfigSnapshot = {
      kind: 'size',
      productId: p.id,
      productName: p.name,
      sizeId: pickedSize.id,
      // PWP (换购, 0128) identity — a mattress line is a PWP trigger; these let the
      // bedframe configurator detect a qualifying trigger in the cart.
      modelId: (p as { model_id?: string | null }).model_id ?? null,
      category: String(p.category_id ?? '').toUpperCase(),
      // PWP Code Voucher (0130) — a mattress redeemed at its PWP price. sizeTotal
      // already reflects the PWP base; the server re-validates the code at Confirm.
      ...(pwpActive && appliedPwpCode
        ? { pwp: true, pwpCode: appliedPwpCode, pwpTriggerLabel: crossPwpActive ? null : pwpEval.triggerLabel,
            pwpOriginalTotal: sizeBase + extrasTotal + specialSelsSurcharge(mattressSpecialSel) + effectiveExtraRm }
        : {}),
      // Per-line remark + extra charge (spec 2026-06-06). The extra is already
      // folded into sizeTotal (and pwpOriginalTotal) — declared here only so the
      // server's drift gate adds the same per-unit amount.
      ...(lineRemark.trim() ? { remark: lineRemark.trim() } : {}),
      ...(lineExtraNote.trim() ? { extraAddonNote: lineExtraNote.trim() } : {}),
      ...(effectiveExtraRm > 0 ? { extraAddonAmountRM: effectiveExtraRm } : {}),
      total: sizeTotal,
      summary: `${pickedSize.label}${extraSummary}`,
      addonExtras: extrasArr.length > 0 ? extrasArr : undefined,
      ...(mattressSpecialSel.length > 0 ? {
        specialIds: mattressSpecialSel.map((s) => s.id),
        specialLabels: mattressSpecialSel.map((s) => s.label),
        specialChoices: Object.fromEntries(mattressSpecialSel.map((s) => [s.id, s.choices ?? []])),
      } : {}),
    };
    if (isAddToOrderMode) { void confirmAddToOrder(snapshot, qtyEffective); return; }
    addConfigured(snapshot, { ...(isEditing && editKey ? { editingKey: editKey } : {}), qty: qtyEffective });
    navigate(isEditing ? '/cart' : '/catalog');
  };

  const bumpExtra = (addonId: string, delta: number) => {
    setPillowExtras((prev) => {
      const next = { ...prev };
      const cur = next[addonId] ?? 0;
      const updated = Math.max(0, cur + delta);
      if (updated === 0) delete next[addonId];
      else next[addonId] = updated;
      return next;
    });
  };

  // ─── Sofa Quick-Pick state lifted from <SofaQuickPick> so the topbar action
  // slot can show the picked bundle + LIVE TOTAL and own the Add-to-Cart CTA.
  const sofaBundleRows = BUNDLES.map((b) => {
    const row = (bundles.data ?? []).find((r) => r.bundleId === b.id);
    return { bundle: b, price: row?.price ?? null, active: row?.active ?? false };
  });
  const pickedSofaRow = sofaBundleRows.find((r) => r.bundle.id === picked) ?? null;

  // Quick Pick selection price: computed from its layout via the engine.
  // effectiveQPModules applies the L↔R mirror toggle (2026-06-01) so the price,
  // hero preview, and cart line all reflect the flipped orientation.
  const effectiveQPModules = pickedQP
    ? (qpMirror ? mirrorModules(pickedQP.modules) : pickedQP.modules)
    : null;
  // Topbar label + the cart summary minted from it (Loo 2026-06-12): a
  // curated human name survives; a code-sequence label re-reads in walk order
  // (qpWalkLabel). A mirrored pick can't reuse its stored label either way
  // (it still names the un-flipped hands), so it always re-derives.
  const qpDisplayLabel = (() => {
    if (!pickedQP || !effectiveQPModules) return '';
    if (qpMirror || qpLabelIsCodeJoin(pickedQP.label, pickedQP.modules)) {
      return qpWalkLabel(effectiveQPModules, activeDepth) ?? buildComboLabel(effectiveQPModules);
    }
    return pickedQP.label!;
  })();
  const qpPickPrice = effectiveQPModules ? (priceForLayout(effectiveQPModules) ?? 0) : 0;

  // Fabric-tier add-on (migration 0124): per-item flat Δ from the chosen
  // fabric's SELLING tier — replaces the old per-fabric surcharge. The server
  // adds the SAME Δ via the shared fabricTierAddon, so the figure can't drift.
  const sofaFabricDelta = fabricSel && addonCfgQ.data
    ? fabricTierAddon('SOFA', fabricSel.sofaTier as FabricTier | null, addonCfgQ.data, modelFabricOverride)
    : 0;
  const sofaSpecialDelta = specialSelsSurcharge(sofaSpecialSel);
  // Sofa leg height — reuse the bedframe OptionSelect (same look). Options come
  // from the allowed ∩ priced pool; the chosen value's surcharge folds into the
  // live total + each cart line; the server reprices it from sofaLegHeights.
  const sofaLegRows: BedframeOptionRow[] = (sofaLegOpts.data ?? []).map((o, i) => ({
    id: o.value, kind: 'leg_height', value: o.value, surcharge: o.surcharge, sortOrder: i,
  }));
  const sofaLegSurcharge = sofaLegRows.find((o) => o.value === sofaLegValue)?.surcharge ?? 0;
  // Leg height is OPTIONAL at Add-to-Cart (Loo 2026-06-11, reversing the
  // 2026-06-03 compulsory rule) — the customer may confirm it later. The
  // so-variant-rule legHeight axis still blocks a Processing date / Proceed
  // until it's filled.
  const sofaLegBlock = sofaLegRows.length > 0 ? (
    <OptionSelect
      label="Leg height"
      opts={sofaLegRows}
      selectedId={sofaLegValue}
      onPick={(o) => setSofaLegValue(o.value)}
      onClear={() => setSofaLegValue(null)}
    />
  ) : null;
  const sofaTotal = (pickedQP
    ? qpPickPrice + sofaFabricDelta
    : (pickedSofaRow?.price ?? 0) + (pickedSofaRow ? sofaFabricDelta : 0)) + sofaSpecialDelta + sofaLegSurcharge + effectiveExtraRm;

  // Fabric + colour AND leg height are OPTIONAL at Add-to-Cart (Loo
  // 2026-06-11) — some customers can't confirm them yet. The SO-side rule
  // still demands fabricCode + legHeight before a Processing date / Proceed
  // (shared so-variant-rule, API 409 variants_incomplete), so the order can't
  // reach production unconfirmed.
  const canAddSofa =
    ((pickedSofaRow != null && pickedSofaRow.active && pickedSofaRow.price != null) ||
     (pickedQP != null && qpPickPrice > 0));

  // Bundle Quick Pick → Add to Cart.
  const handleAddSofa = () => {
    if (pickedSofaRow == null || pickedSofaRow.price == null) return;
    const lShape = isLShapeBundle(pickedSofaRow.bundle.id);
    const fabricSuffix = fabricSel ? ` · ${fabricSel.fabricLabel}/${fabricSel.colourLabel ?? 'Colour KIV'}` : '';
    const snapshot: SofaConfigSnapshot = {
      kind: 'sofa',
      productId: p.id,
      productName: p.name,
      modelId: (p as { model_id?: string | null }).model_id ?? null,
      bundleId: pickedSofaRow.bundle.id,
      depth: activeDepth,
      // Snapshot the Model's upgrade so the invoice can show an auto-included
      // headrest ("+ N Headrest") on this quick-pick line (F3).
      seatUpgradeLabel: p.seat_upgrade_label ?? null,
      seatUpgradeFootrest: p.seat_upgrade_footrest ?? true,
      // Fabric + colour (spec 2026-05-24) — surcharge folded into total.
      // Optional since 2026-06-11: absent = customer confirms later. Colour
      // KIV (Loo 2026-06-12): fabric set, colour keys omitted until filled.
      fabricId: fabricSel?.fabricId,
      colourId: fabricSel?.colourId ?? undefined,
      fabricLabel: fabricSel?.fabricLabel,
      colourLabel: fabricSel?.colourLabel ?? undefined,
      colourHex: fabricSel?.colourHex ?? undefined,
      fabricTierDelta: sofaFabricDelta,
      ...(sofaSpecialSel.length > 0 ? {
        specialIds: sofaSpecialSel.map((s) => s.id),
        specialLabels: sofaSpecialSel.map((s) => s.label),
        specialChoices: Object.fromEntries(sofaSpecialSel.map((s) => [s.id, s.choices ?? []])),
      } : {}),
      ...(sofaLegValue ? { sofaLegHeight: sofaLegValue } : {}),
      // Per-line remark + extra charge (spec 2026-06-06) — folded into total once.
      ...(lineRemark.trim() ? { remark: lineRemark.trim() } : {}),
      ...(lineExtraNote.trim() ? { extraAddonNote: lineExtraNote.trim() } : {}),
      ...(effectiveExtraRm > 0 ? { extraAddonAmountRM: effectiveExtraRm } : {}),
      total: pickedSofaRow.price + sofaFabricDelta + sofaSpecialDelta + sofaLegSurcharge + effectiveExtraRm,
      summary: lShape
        ? `${pickedSofaRow.bundle.id} · ${pickedSofaRow.bundle.label} · ${quickFlip}-facing · ${activeDepth}"${fabricSuffix}`
        : `${pickedSofaRow.bundle.id} · ${pickedSofaRow.bundle.label} · ${activeDepth}"${fabricSuffix}`,
    };
    if (isSwapMode) { void confirmSwap(snapshot); return; }
    if (isAddToOrderMode) { void confirmAddToOrder(snapshot); return; }
    addConfigured(snapshot, isEditing && editKey ? { editingKey: editKey } : undefined);
    navigate(isEditing ? '/cart' : '/catalog');
  };

  // Quick Pick → Add to Cart. Builds cells from the pick's modules so the order
  // line carries the exact modular arrangement (and the engine reprices it,
  // applying any matched Combo, server-side on submit).
  const handleAddQuickPick = () => {
    if (pickedQP == null || effectiveQPModules == null) return;
    const cells = cellsFromComboModules(effectiveQPModules, activeDepth);
    const label = qpDisplayLabel;
    const fabricSuffix = fabricSel ? ` · ${fabricSel.fabricLabel}/${fabricSel.colourLabel ?? 'Colour KIV'}` : '';
    // PWP (换购) — stamp the line when this layout matches the applied reward
    // combo; total already reflects the PWP price (effectiveSofaPricing). The
    // server re-validates the code + locks the combo PWP price at Confirm.
    const pwpCombo = sofaPwpCode ? (sofaPricing.combos ?? []).find((c) => sofaPwpComboIds.includes(c.id)) : undefined;
    const isPwp = !!pwpCombo && matchComboSubset(cells.map((c) => c.moduleId).filter(Boolean), pwpCombo.modules) != null;
    const snapshot: SofaConfigSnapshot = {
      kind: 'sofa',
      productId: p.id,
      productName: p.name,
      modelId: (p as { model_id?: string | null }).model_id ?? null,
      cells,
      depth: activeDepth,
      seatUpgradeLabel: p.seat_upgrade_label ?? null,
      seatUpgradeFootrest: p.seat_upgrade_footrest ?? true,
      // Optional since 2026-06-11: absent = customer confirms fabric later.
      // Colour KIV (Loo 2026-06-12): fabric set, colour keys omitted until filled.
      fabricId: fabricSel?.fabricId,
      colourId: fabricSel?.colourId ?? undefined,
      fabricLabel: fabricSel?.fabricLabel,
      colourLabel: fabricSel?.colourLabel ?? undefined,
      colourHex: fabricSel?.colourHex ?? undefined,
      fabricTierDelta: sofaFabricDelta,
      ...(isPwp && sofaPwpCode ? { pwp: true, pwpCode: sofaPwpCode } : {}),
      ...(sofaSpecialSel.length > 0 ? {
        specialIds: sofaSpecialSel.map((s) => s.id),
        specialLabels: sofaSpecialSel.map((s) => s.label),
        specialChoices: Object.fromEntries(sofaSpecialSel.map((s) => [s.id, s.choices ?? []])),
      } : {}),
      ...(sofaLegValue ? { sofaLegHeight: sofaLegValue } : {}),
      // Per-line remark + extra charge (spec 2026-06-06) — folded into total once.
      ...(lineRemark.trim() ? { remark: lineRemark.trim() } : {}),
      ...(lineExtraNote.trim() ? { extraAddonNote: lineExtraNote.trim() } : {}),
      ...(effectiveExtraRm > 0 ? { extraAddonAmountRM: effectiveExtraRm } : {}),
      total: qpPickPrice + sofaFabricDelta + sofaSpecialDelta + sofaLegSurcharge + effectiveExtraRm,
      summary: `${label} · ${activeDepth}"${fabricSuffix}`,
    };
    if (isSwapMode) { void confirmSwap(snapshot); return; }
    if (isAddToOrderMode) { void confirmAddToOrder(snapshot); return; }
    addConfigured(snapshot, isEditing && editKey ? { editingKey: editKey } : undefined);
    navigate(isEditing ? '/cart' : '/catalog');
  };

  // Topbar action slot for size_variants: product chip + LIVE TOTAL +
  // Cancel + Add to Cart. Sofa + flat keep the default Quotes/My orders
  // pills (their flows are full-page with a footer button).
  const sizeTopbarSlot = isSize ? (
    <span className={styles.topbarActions}>
      <span className={styles.topbarChip}>
        <span className={styles.topbarChipEyebrow}>
          {(p.name ?? '').toUpperCase()} · {(p.category_id ?? '').toUpperCase()}
        </span>
        <span className={styles.topbarChipName}>
          {p.name}
          {pickedSize ? ` · ${pickedSize.label}` : ''}
        </span>
        {pickedSize && (
          <span className={styles.topbarChipSub}>
            {pickedSize.widthCm}×{pickedSize.lengthCm} cm
            {p.series_id ? ` · ${formatSeries(p.series_id)}` : ''}
          </span>
        )}
      </span>
      <span className={styles.topbarTotal}>
        <span className={styles.topbarTotalLbl}>LIVE TOTAL{qtyEffective > 1 ? ` × ${qtyEffective}` : ''}</span>
        <span className={styles.topbarTotalAmt}>
          <sup>RM</sup>
          {sizeTotal > 0 ? (sizeTotal * qtyEffective).toLocaleString('en-MY') : '—'}
        </span>
        <span className={styles.topbarTotalNote}>Delivery &amp; assembly included</span>
      </span>
      <button
        type="button"
        className={styles.topbarBtnGhost}
        onClick={backToCatalog}
      >
        <X size={14} strokeWidth={1.75} />
        Cancel
      </button>
      <button
        type="button"
        className={styles.topbarBtnPrimary}
        disabled={!canAddSize || addToOrderPending || (isAddToOrderMode && !soHeader?.addEligible)}
        onClick={handleAddSize}
      >
        {isAddToOrderMode
          ? (addToOrderPending ? 'Adding…' : 'Add to this order')
          : isEditing ? 'Save changes' : '+ Add to Cart'}
      </button>
    </span>
  ) : undefined;

  // Bedframe right slot — chip + LIVE TOTAL + Cancel + Add to Cart. Same shape
  // as the size slot; the rail below carries the colour + dimension options.
  const bedframeTopbarSlot = isBedframe ? (
    <span className={styles.topbarActions}>
      <span className={styles.topbarChip}>
        <span className={styles.topbarChipEyebrow}>
          {(p.name ?? '').toUpperCase()} · {(p.category_id ?? '').toUpperCase()}
        </span>
        <span className={styles.topbarChipName}>
          {p.name}
          {pickedSize ? ` · ${pickedSize.label}` : ''}
          {isDivan ? ' · Divan' : ''}
        </span>
        {(fabricSel || bfSel.legLabel) && (
          <span className={styles.topbarChipSub}>
            {[fabricSel?.fabricLabel, fabricSel ? (fabricSel.colourLabel ?? 'Colour KIV') : null, bfSel.legLabel ? `Leg ${bfSel.legLabel}` : null].filter(Boolean).join(' · ')}
          </span>
        )}
      </span>
      <span className={styles.topbarTotal}>
        <span className={styles.topbarTotalLbl}>LIVE TOTAL{qtyEffective > 1 ? ` × ${qtyEffective}` : ''}</span>
        <span className={styles.topbarTotalAmt}>
          <sup>RM</sup>
          {bedframeTotal > 0 ? (bedframeTotal * qtyEffective).toLocaleString('en-MY') : '—'}
        </span>
        <span className={styles.topbarTotalNote}>Delivery &amp; assembly included</span>
      </span>
      <button
        type="button"
        className={styles.topbarBtnGhost}
        onClick={backToCatalog}
      >
        <X size={14} strokeWidth={1.75} />
        Cancel
      </button>
      <button
        type="button"
        className={styles.topbarBtnPrimary}
        disabled={!canAddBedframe || addToOrderPending || (isAddToOrderMode && !soHeader?.addEligible)}
        onClick={handleAddBedframe}
      >
        {isAddToOrderMode
          ? (addToOrderPending ? 'Adding…' : 'Add to this order')
          : isEditing ? 'Save changes' : '+ Add to Cart'}
      </button>
    </span>
  ) : undefined;

  // Sofa right slot — chip + LIVE TOTAL + Cancel + Add to Cart. Depth toggle
  // and mode tabs moved to centerSlot per prototype topbar layout.
  const sofaTopbarSlot = isSofa && mode === 'quick' ? (
    <span className={styles.topbarActions}>
      <span className={styles.topbarChip}>
        <span className={styles.topbarChipEyebrow}>
          {(p.name ?? '').toUpperCase()} · {(p.category_id ?? '').toUpperCase()}
        </span>
        <span className={styles.topbarChipName}>
          {pickedQP
            ? `${qpDisplayLabel} · ${activeDepth}"`
            : pickedSofaRow
              ? `${pickedSofaRow.bundle.label} · ${activeDepth}"`
              : p.name}
        </span>
        {(pickedQP || pickedSofaRow) && (
          <span className={styles.topbarChipSub}>
            {pickedQP
              ? (pickedQP.source === 'personal' ? 'Quick Pick · Yours' : 'Quick Pick')
              : `Quick Pick${isLShapeBundle(pickedSofaRow!.bundle.id) ? ` · ${quickFlip}-facing` : ''}`}
          </span>
        )}
      </span>
      <span className={styles.topbarTotal}>
        <span className={styles.topbarTotalLbl}>LIVE TOTAL</span>
        <span className={styles.topbarTotalAmt}>
          <sup>RM</sup>
          {sofaTotal > 0 ? sofaTotal.toLocaleString('en-MY') : '—'}
        </span>
        <span className={styles.topbarTotalNote}>Delivery &amp; assembly included</span>
      </span>
      <button
        type="button"
        className={styles.topbarBtnGhost}
        onClick={backToCatalog}
      >
        <X size={14} strokeWidth={1.75} />
        Cancel
      </button>
      <button
        type="button"
        className={styles.topbarBtnPrimary}
        disabled={!canAddSofa || swapPending || addToOrderPending || (isAddToOrderMode && !soHeader?.addEligible)}
        onClick={pickedQP ? handleAddQuickPick : handleAddSofa}
      >
        {isSwapMode
          ? (swapPending ? 'Saving…' : 'Confirm Change')
          : isAddToOrderMode
            ? (addToOrderPending ? 'Adding…' : 'Add to this order')
            : isEditing ? 'Save changes' : '+ Add to Cart'}
      </button>
    </span>
  ) : undefined;

  // Sofa center slot — back arrow + 24"/28" depth toggle + Quick/Customize
  // tabs. Renders for both Quick-Pick and Custom build modes. Step pills
  // (CART/CUSTOMER/CONFIRMED) hide when this slot is present.
  const sofaCenterSlot = isSofa ? (
    <>
      <button
        type="button"
        className={styles.topbarBack}
        onClick={backToCatalog}
        aria-label="Back to catalog"
      >
        <ArrowLeft size={20} strokeWidth={1.75} />
      </button>
      <span className={styles.depthTabs} role="tablist" aria-label="Seat depth">
        {depthOptions.map((d) => (
          <button
            key={d}
            type="button"
            role="tab"
            aria-selected={activeDepth === d}
            className={`${styles.depthTab} ${activeDepth === d ? styles.depthTabActive : ''}`}
            onClick={() => setActiveDepth(d)}
          >
            {d}&quot;
          </button>
        ))}
      </span>
      <span className={styles.modeTabs} role="tablist" aria-label="Build mode">
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'quick'}
          className={`${styles.modeTab} ${mode === 'quick' ? styles.modeTabActive : ''}`}
          onClick={() => setMode('quick')}
        >
          Quick Pick
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={mode === 'custom'}
          className={`${styles.modeTab} ${mode === 'custom' ? styles.modeTabActive : ''}`}
          onClick={() => setMode('custom')}
        >
          Customize
        </button>
      </span>
      {/* PWP 换购 voucher — shared across Quick Pick + Customize (Chairman
          2026-06-02: moved here from the Customize footer so BOTH modes can
          redeem). Compact single-line control; mirrors the bed frame
          pwpRailSection (Insert PWP Code + Auto Fill same-cart + Apply). */}
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
        {sofaPwpApplied ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-12)' }}>
            <span style={{ fontWeight: 600 }}>PWP {sofaPwpCode} ✓</span>
            <button
              type="button"
              onClick={() => { setSofaPwpCode(null); setSofaPwpComboIds([]); setSofaPwpInput(''); setSofaPwpErr(null); }}
              style={{ background: 'transparent', border: 'none', textDecoration: 'underline', cursor: 'pointer', color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}
            >
              remove
            </button>
          </span>
        ) : (
          <>
            <input
              type="text"
              value={sofaPwpInput}
              onChange={(e) => { setSofaPwpInput(e.target.value); setSofaPwpErr(null); }}
              placeholder="Insert PWP Code"
              style={{ width: 132, textTransform: 'uppercase', fontSize: 'var(--fs-12)', padding: '5px 8px', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)' }}
            />
            {sameCartSofa && (
              <Button variant="primary" onClick={() => void applySofaPwp(sameCartSofa.code)} disabled={sofaPwpChecking}>
                Auto Fill
              </Button>
            )}
            <Button variant="ghost" onClick={() => void applySofaPwp()} disabled={sofaPwpChecking || !sofaPwpInput.trim()}>
              {sofaPwpChecking ? 'Checking…' : 'Apply'}
            </Button>
            {sofaPwpErr && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--c-danger, #B4321A)' }}>{sofaPwpErr}</span>}
          </>
        )}
      </span>
    </>
  ) : undefined;

  return (
    <>
    <Topbar
      step={isSofa ? undefined : 'cart'}
      centerSlot={sofaCenterSlot}
      rightSlot={sofaTopbarSlot ?? sizeTopbarSlot ?? bedframeTopbarSlot}
    />
    {/* TBC sofa exchange — the only error surface in swap mode (the floor
        rule + server rejects land here, above the canvas). */}
    {isSwapMode && swapError && (
      <div
        role="alert"
        style={{
          position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)',
          zIndex: 60, maxWidth: 620, padding: '10px 16px', borderRadius: 12,
          background: '#fff', border: '1px solid #b3261e', color: '#b3261e',
          fontFamily: 'var(--font-sans)', fontSize: 13, boxShadow: '0 4px 14px rgba(34,31,32,0.12)',
        }}
      >
        {swapError}
      </div>
    )}
    {/* Add-to-placed-SO — eligibility notice (not eligible) + error surface. */}
    {isAddToOrderMode && soHeaderQ.isLoading && (
      <div
        style={{
          position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)',
          zIndex: 60, maxWidth: 620, padding: '10px 16px', borderRadius: 12,
          background: '#fff', border: '1px solid var(--line-strong)',
          fontFamily: 'var(--font-sans)', fontSize: 13, color: 'var(--c-ink)',
          boxShadow: '0 4px 14px rgba(34,31,32,0.12)',
        }}
      >
        Loading order…
      </div>
    )}
    {isAddToOrderMode && soHeader && !soHeader.addEligible && (
      <div
        role="alert"
        style={{
          position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)',
          zIndex: 60, maxWidth: 620, padding: '10px 16px', borderRadius: 12,
          background: '#fff', border: '1px solid #b3261e', color: '#b3261e',
          fontFamily: 'var(--font-sans)', fontSize: 13, boxShadow: '0 4px 14px rgba(34,31,32,0.12)',
        }}
      >
        {soHeader.addBlockedReason
          ? `Cannot add to ${addToOrderDoc}: ${soHeader.addBlockedReason}`
          : `Cannot add to ${addToOrderDoc} — this order is locked or has downstream documents.`}
        {' '}<button
          type="button"
          onClick={() => navigate('/my-orders')}
          style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'inherit', fontSize: 'inherit', padding: 0 }}
        >Back to My orders</button>
      </div>
    )}
    {isAddToOrderMode && addToOrderError && (
      <div
        role="alert"
        style={{
          position: 'fixed', top: 72, left: '50%', transform: 'translateX(-50%)',
          zIndex: 60, maxWidth: 620, padding: '10px 16px', borderRadius: 12,
          background: '#fff', border: '1px solid #b3261e', color: '#b3261e',
          fontFamily: 'var(--font-sans)', fontSize: 13, boxShadow: '0 4px 14px rgba(34,31,32,0.12)',
        }}
      >
        {addToOrderError}
      </div>
    )}
    <main
      className={isSofa && mode === 'quick' ? styles.sofaShell : (isSize || isBedframe) ? styles.shellWide : styles.shell}
      // Custom-build mode runs on a slightly warmer cream (#FAF6EC vs the app
      // default #FFF9EB) so the "build space" feels distinct from Quick Pick's
      // catalogue browse. The palette sits on top as an elevated white panel
      // (see CustomBuilder.module.css) — same white-on-cream hierarchy as
      // Quick Pick's qpRail, just contained as a card rather than a hard
      // left-half color split.
      style={isSofa && mode === 'custom' ? { background: '#FAF6EC' } : undefined}
    >
      {!isSize && !isSofa && !isBedframe && (
        <header className={styles.header}>
          <IconButton
            icon={<ArrowLeft size={20} strokeWidth={1.75} />}
            aria-label="Back"
            onClick={backToCatalog}
          />
          <div className={styles.title}>
            <span className="t-eyebrow">{p.category_id}</span>
            <h1 className={styles.heading}>{p.name}</h1>
            {p.detail && <p className={styles.detail}>{p.detail}</p>}
            <code className={styles.sku}>{p.sku}</code>
          </div>
        </header>
      )}

      {(isSize || isBedframe) && (
        <header className={styles.headerWide}>
          <div>
            <span className="t-eyebrow">{p.category_id}</span>
            <h1 className={styles.heading}>
              {p.name}
              {pickedSize ? ` · ${pickedSize.label}` : ''}
              {isDivan ? ' · Divan' : ''}
            </h1>
          </div>
          <span className={styles.footprintLbl}>
            {pickedSize
              ? `Footprint ${pickedSize.widthCm} × ${pickedSize.lengthCm} cm`
              : 'Pick a size to set footprint'}
          </span>
        </header>
      )}

      {isSofa && (
        mode === 'quick' ? (
          <SofaQuickPick
            isLoading={bundles.isLoading}
            rows={sofaBundleRows}
            picked={picked}
            onPick={(id) => { setPicked(id); setPickedQP(null); }}
            quickFlip={quickFlip}
            onFlipChange={setQuickFlip}
            qpMirror={qpMirror}
            onToggleQpMirror={() => setQpMirror((v) => !v)}
            depth={activeDepth}
            maxDepth={depthOptions[depthOptions.length - 1] ?? activeDepth}
            globalQuickPicks={globalQPItems}
            personalQuickPicks={personalQPItems}
            pickedQuickPickId={pickedQP?.id ?? null}
            priceForLayout={priceForLayout}
            canDeleteGlobal={canCurateQP}
            onQuickPickSelect={(item) => {
              // Select the saved Quick Pick — stay in Quick Pick mode.
              // Topbar shows its computed price + "Add to Cart". Restore the
              // pick's saved seat depth so it prices as it was saved, not at
              // whatever the depth toggle currently sits on (Phase 5 review).
              if (item.depth && depthOptions.includes(item.depth as Depth)) {
                setActiveDepth(item.depth as Depth);
              }
              setPickedQP(item);
              setPicked(null);
              setQpMirror(false);
            }}
            onQuickPickEdit={(item) => {
              // Load into Customize for further adjustment, centered in the room
              // (like tap-to-add) rather than pinned to the top-left corner.
              setSofaCells(centerCellsInRoom(cellsFromComboModules(item.modules, activeDepth), activeDepth));
              setMode('custom');
            }}
            onQuickPickDelete={(item) => {
              if (item.source === 'personal') deletePersonalQP.mutate(item.id);
              else deleteGlobalQP.mutate(item.id);
            }}
            fabricBlock={
              <FabricColourPicker
                productFabrics={derivedFabricRows}
                fabricId={fabricSel?.fabricId ?? null}
                colourId={fabricSel?.colourId ?? null}
                onChange={setFabricSel}
                category="SOFA"
                addonConfig={addonCfgQ.data ?? null}
                modelOverride={modelFabricOverride}
                enabledColourIds={productId?.startsWith('mfg-') ? sofaFabricCodes : null}
                optional
                onClear={() => setFabricSel(null)}
              />
            }
            specialAddonsBlock={
              <SpecialAddonsPicker addons={sofaSpecialAddons} value={sofaSpecialSel} onChange={setSofaSpecialSel} />
            }
            legBlock={sofaLegBlock}
            remarkBlock={remarkExtraRailSection}
          />
        ) : (
          <CustomBuilder
            productId={p.id}
            productName={p.name}
            pricing={effectiveSofaPricing}
            pwpCode={sofaPwpCode}
            pwpComboIds={sofaPwpComboIds}
            depth={activeDepth}
            cells={sofaCells}
            setCells={setSofaCells}
            editingKey={isEditing && editKey ? editKey : undefined}
            initialFabric={isEditing ? fabricSel : null}
            modelCustomizer={modelCustomizerForDepth}
            baseModel={p.base_model ?? undefined}
            modelId={(p as { model_id?: string | null }).model_id ?? null}
            legBlock={sofaLegBlock}
            legHeight={sofaLegValue}
            legSurchargeRm={sofaLegSurcharge}
            remarkBlock={remarkExtraRailSection}
            remark={lineRemark}
            extraAddonNote={lineExtraNote}
            extraAmountRm={effectiveExtraRm}
            onAdded={() => navigate(isEditing ? '/cart' : '/catalog')}
            {...(isSwapMode ? { onSwapConfirm: (snap) => { void confirmSwap(snap); }, swapPending } : {})}
            {...(isAddToOrderMode ? { onAddToOrderConfirm: (snap) => { void confirmAddToOrder(snap); }, addToOrderPending } : {})}
          />
        )
      )}

      {isSize && (
        <div className={styles.twoCol}>
          <div className={styles.previewArea}>
            {pickedSize ? (
              <FootprintPreview
                widthCm={pickedSize.widthCm}
                lengthCm={pickedSize.lengthCm}
                label={pickedSize.label}
              />
            ) : (
              <div className={styles.previewEmpty}>
                <span>Pick a size on the right to preview the footprint.</span>
              </div>
            )}
          </div>
          <aside className={styles.rail}>
            <RailSection title="Size" sub={pickedSize ? `${pickedSize.label} · ${pickedSize.widthCm}×${pickedSize.lengthCm} cm` : undefined}>
              <SizeGrid rows={sizeRows} pickedId={pickedSizeId} onPick={setPickedSizeId} />
            </RailSection>

            {/* Line quantity (Loo 2026-06-12) — shown once a size is picked. */}
            {pickedSize && quantityRailSection}

            {/* Special Add-ons (migration 0134) — mattress add-ons (per-Model). */}
            {mattressSpecialAddons.length > 0 && (
              <RailSection title="Add-ons">
                <SpecialAddonsPicker addons={mattressSpecialAddons} value={mattressSpecialSel} onChange={setMattressSpecialSel} />
              </RailSection>
            )}

            {/* Special add-on (note + extra charge) + item remark — directly below
                the Add-ons chips (Loo 2026-06-13). */}
            {pickedSize && remarkExtraRailSection}

            {/* PWP redeem — shared bed frame + mattress section. Shown once a size
                is picked (it prices off the size's PWP price). */}
            {pickedSize && pwpRailSection}

            <RailSection title={`About this ${p.category_id}`}>
              {p.detail ? (
                <p className={styles.aboutText}>{p.detail}</p>
              ) : (
                <p className={styles.aboutText}>No description set yet — add via SKU Master.</p>
              )}
              {p.series_id && (
                <span className={styles.seriesEyebrow}>{formatSeries(p.series_id)}</span>
              )}
            </RailSection>

            {pillowAddOns.length > 0 && (
              <RailSection title="Add-on · need more pillows?" sub="Add extras at piece price">
                {pillowAddOns.map((addon) => {
                  const qty = pillowExtras[addon.id] ?? 0;
                  return (
                    <div key={addon.id} className={styles.pillowRow}>
                      <span className={styles.pillowIcon}>
                        <Package size={16} strokeWidth={1.75} />
                      </span>
                      <span className={styles.pillowMeta}>
                        <span className={styles.pillowName}>{addon.label}</span>
                        <span className={styles.pillowDesc}>
                          {fmtRM(addon.price)} each
                        </span>
                      </span>
                      <span className={styles.stepper}>
                        <button
                          type="button"
                          className={styles.stepperBtn}
                          onClick={() => bumpExtra(addon.id, -1)}
                          disabled={qty === 0}
                          aria-label={`Decrease ${addon.label}`}
                        >
                          <Minus size={12} strokeWidth={2} />
                        </button>
                        <span className={styles.stepperVal}>{qty}</span>
                        <button
                          type="button"
                          className={styles.stepperBtn}
                          onClick={() => bumpExtra(addon.id, +1)}
                          aria-label={`Increase ${addon.label}`}
                        >
                          <Plus size={12} strokeWidth={2} />
                        </button>
                      </span>
                    </div>
                  );
                })}
              </RailSection>
            )}
          </aside>
        </div>
      )}

      {isBedframe && (
        <div className={styles.twoCol}>
          <div className={styles.previewArea}>
            {pickedSize ? (
              <FootprintPreview
                widthCm={pickedSize.widthCm}
                lengthCm={pickedSize.lengthCm}
                label={pickedSize.label}
              />
            ) : (
              <div className={styles.previewEmpty}>
                <span>Pick a size on the right to preview the footprint.</span>
              </div>
            )}
          </div>
          <aside className={styles.rail}>
            <RailSection title="Size" sub={pickedSize ? `${pickedSize.label} · ${pickedSize.widthCm}×${pickedSize.lengthCm} cm` : undefined}>
              <SizeGrid rows={sizeRows} pickedId={pickedSizeId} onPick={setPickedSizeId} />
            </RailSection>

            {/* Line quantity (Loo 2026-06-12) — shown once a size is picked. */}
            {pickedSize && quantityRailSection}

            {/* PWP redeem — shared bed frame + mattress section (see pwpRailSection). */}
            {isBedframe && pwpRailSection}

            <RailSection title="Build">
              <BedframeOptions
                productId={p.id}
                isDivan={isDivan}
                value={bfSel}
                onChange={setBfSel}
                fabricBlock={
                  <FabricColourPicker
                    productFabrics={bedframeFabricRows}
                    fabricId={fabricSel?.fabricId ?? null}
                    colourId={fabricSel?.colourId ?? null}
                    onChange={setFabricSel}
                    category="BEDFRAME"
                    addonConfig={addonCfgQ.data ?? null}
                    modelOverride={modelFabricOverride}
                    enabledColourIds={bedframeFabricCodes}
                    optional
                    onClear={() => setFabricSel(null)}
                  />
                }
                specialAddons={bedframeSpecialAddons}
              />
            </RailSection>

            {/* Special add-on (note + extra charge) + item remark — directly below
                the Build section's SPECIAL ADD-ON chips (Loo 2026-06-13). */}
            {remarkExtraRailSection}
          </aside>
        </div>
      )}

      {p.pricing_kind === 'flat' && p.flat_price != null && (
        <FlatAddToCart
          productId={p.id}
          productName={p.name}
          flatPrice={p.flat_price}
          category={p.category_id ? p.category_id.toUpperCase() : undefined}
          onAdded={backToCatalog}
          {...(isAddToOrderMode ? {
            onAddToOrder: (snapshot: FlatConfigSnapshot, qty: number) => {
              void confirmAddToOrder(snapshot, qty);
            },
            addToOrderPending,
            addEligible: soHeader?.addEligible ?? true,
          } : {})}
        />
      )}

      {p.pricing_kind === 'tbc' && (
        <p className={styles.tbcCard}>
          <Hourglass size={16} strokeWidth={1.75} />
          Pricing scheme not finalised for this category yet.
        </p>
      )}

      {!(isSofa && mode === 'quick') && (
        <footer className={styles.footer}>
          <span className="t-caption">
            Realtime subscription on this product's pricing. Backend edits land here in ~300ms.
          </span>
        </footer>
      )}
    </main>
    </>
  );
};

// Series id like "white-series" → "WHITE SERIES" eyebrow. Used in the
// configurator About panel + topbar product chip until we join the series
// table for a proper label.
const formatSeries = (seriesId: string): string =>
  seriesId.toUpperCase().replace(/[-_]/g, ' ');

interface FootprintPreviewProps {
  widthCm: number;
  lengthCm: number;
  label: string;
}
// Canvas is locked to King (183×190 cm) so it never resizes between
// selections — switching from Queen to Single shouldn't reflow the whole
// preview. The mattress rectangle scales inside this fixed frame, centered,
// with a faint dashed King outline behind it as a visual reference.
// Dimension lines anchor to the actual mattress edges so the cm labels
// still read the selected size, not the reference.
const KING_WIDTH_CM = 183;
const KING_LENGTH_CM = 190;
const FootprintPreview = ({ widthCm, lengthCm, label }: FootprintPreviewProps) => {
  const maxW = 320;
  const maxH = 360;
  const scale = Math.min(maxW / KING_WIDTH_CM, maxH / KING_LENGTH_CM);
  const refPxW = Math.round(KING_WIDTH_CM * scale);
  const refPxH = Math.round(KING_LENGTH_CM * scale);
  const pxW = Math.round(widthCm * scale);
  const pxH = Math.round(lengthCm * scale);

  // SVG canvas leaves room around the reference rectangle for dimension lines.
  // Top gets 40px (line + label). Right gets 56px. Left/bottom each 16px.
  const padTop = 40;
  const padRight = 56;
  const padLeft = 16;
  const padBottom = 16;
  const svgW = refPxW + padLeft + padRight;
  const svgH = refPxH + padTop + padBottom;

  // Reference (King) rectangle position — fills the inner area.
  const refX = padLeft;
  const refY = padTop;

  // Mattress sits centered horizontally, bottom-aligned vertically (rests on
  // the bottom of the King outline). The dim lines hang off the mattress
  // edges, not the King frame.
  const rectX = refX + Math.round((refPxW - pxW) / 2);
  const rectY = refY + (refPxH - pxH);

  // Top horizontal dimension line — arrows + label centered above the rect.
  // Anchored to the mattress, NOT the reference frame, so the cm label
  // reads the selected size.
  const dimTopY = rectY - 18;
  const dimTopLabelY = dimTopY - 6;

  // Right vertical dimension line — also anchored to the mattress.
  const dimRightX = rectX + pxW + 18;
  const dimRightLabelX = dimRightX + 6;

  return (
    <div className={styles.fpWrap}>
      <svg
        className={styles.fpSvg}
        width={svgW}
        height={svgH}
        viewBox={`0 0 ${svgW} ${svgH}`}
        role="img"
        aria-label={`${label} mattress footprint, ${widthCm} by ${lengthCm} centimetres`}
      >
        {/* ─── King reference outline — faint dashed frame, drawn first so
             it sits behind everything. Keeps the canvas size stable across
             size selections and gives a visual scale anchor. ─── */}
        <rect
          x={refX}
          y={refY}
          width={refPxW}
          height={refPxH}
          rx={6}
          className={styles.fpSvgRefRect}
        />

        {/* ─── Top width dimension ─── */}
        <line
          x1={rectX}
          y1={dimTopY}
          x2={rectX + pxW}
          y2={dimTopY}
          className={styles.fpSvgDim}
        />
        {/* arrowheads */}
        <polygon
          points={`${rectX},${dimTopY} ${rectX + 7},${dimTopY - 4} ${rectX + 7},${dimTopY + 4}`}
          className={styles.fpSvgArrow}
        />
        <polygon
          points={`${rectX + pxW},${dimTopY} ${rectX + pxW - 7},${dimTopY - 4} ${rectX + pxW - 7},${dimTopY + 4}`}
          className={styles.fpSvgArrow}
        />
        {/* extension marks (short verticals at the ends, like architectural drawings) */}
        <line
          x1={rectX}
          y1={dimTopY - 6}
          x2={rectX}
          y2={rectY}
          className={styles.fpSvgExt}
        />
        <line
          x1={rectX + pxW}
          y1={dimTopY - 6}
          x2={rectX + pxW}
          y2={rectY}
          className={styles.fpSvgExt}
        />
        {/* width label */}
        <text
          x={rectX + pxW / 2}
          y={dimTopLabelY}
          textAnchor="middle"
          className={styles.fpSvgLabel}
        >
          {widthCm} cm
        </text>

        {/* ─── Right length dimension ─── */}
        <line
          x1={dimRightX}
          y1={rectY}
          x2={dimRightX}
          y2={rectY + pxH}
          className={styles.fpSvgDim}
        />
        <polygon
          points={`${dimRightX},${rectY} ${dimRightX - 4},${rectY + 7} ${dimRightX + 4},${rectY + 7}`}
          className={styles.fpSvgArrow}
        />
        <polygon
          points={`${dimRightX},${rectY + pxH} ${dimRightX - 4},${rectY + pxH - 7} ${dimRightX + 4},${rectY + pxH - 7}`}
          className={styles.fpSvgArrow}
        />
        <line
          x1={rectX + pxW}
          y1={rectY}
          x2={dimRightX + 6}
          y2={rectY}
          className={styles.fpSvgExt}
        />
        <line
          x1={rectX + pxW}
          y1={rectY + pxH}
          x2={dimRightX + 6}
          y2={rectY + pxH}
          className={styles.fpSvgExt}
        />
        <text
          x={dimRightLabelX}
          y={rectY + pxH / 2}
          dominantBaseline="middle"
          className={styles.fpSvgLabel}
          transform={`rotate(90 ${dimRightLabelX} ${rectY + pxH / 2})`}
        >
          {lengthCm} cm
        </text>

        {/* ─── Mattress rectangle ─── */}
        <rect
          x={rectX}
          y={rectY}
          width={pxW}
          height={pxH}
          rx={6}
          className={styles.fpSvgRect}
        />
      </svg>

      <div className={styles.fpFootprint}>
        <span>{label} Footprint</span>
        <span className={styles.fpFootprintCm}>
          {widthCm} × {lengthCm} CM
        </span>
      </div>
    </div>
  );
};

interface RailSectionProps {
  title: string;
  sub?: string;
  children: React.ReactNode;
}
const RailSection = ({ title, sub, children }: RailSectionProps) => (
  <section className={styles.railSection}>
    <header className={styles.railHead}>
      <span className={styles.railTitle}>{title}</span>
      {sub && <span className={styles.railSub}>{sub}</span>}
    </header>
    {children}
  </section>
);

interface SizeGridProps {
  rows: SizeRow[];
  pickedId: string | null;
  onPick: (id: string) => void;
}
// Standard-size picker grid shared by the mattress (size_variants) and bedframe
// (bedframe_build) rails. Inactive sizes (no variant on this Model) render
// dimmed + disabled, same as SofaQuickPick.
const SizeGrid = ({ rows, pickedId, onPick }: SizeGridProps) => (
  <div className={styles.sizeGrid}>
    {rows.map((r) => {
      const isPicked = pickedId === r.id;
      const inactive = !r.active || r.price == null;
      return (
        <button
          key={r.id}
          type="button"
          className={`${styles.sizeCard} ${isPicked ? styles.sizeCardPicked : ''} ${inactive ? styles.sizeCardInactive : ''}`}
          disabled={inactive}
          onClick={() => onPick(r.id)}
        >
          <span className={styles.sizeCardName}>{r.label}</span>
          <span className={styles.sizeCardDim}>
            {r.widthCm}×{r.lengthCm} cm
          </span>
          <span className={styles.sizeCardPrice}>
            {inactive ? 'Not on this Model' : fmtRM(r.price ?? 0)}
          </span>
        </button>
      );
    })}
  </div>
);

interface FlatAddToCartProps {
  productId: string;
  productName: string;
  flatPrice: number;
  /** UPPERCASE mfg category, stamped onto the cart snapshot for SO bucketing. */
  category?: string;
  onAdded: () => void;
  /** Add-to-placed-SO mode: when set, the button submits to the placed SO
   *  instead of the cart. */
  onAddToOrder?: (snapshot: FlatConfigSnapshot, qty: number) => void;
  addToOrderPending?: boolean;
  /** When in add-to-order mode, true if the target SO is eligible for adds. */
  addEligible?: boolean;
}

const FlatAddToCart = ({ productId, productName, flatPrice, category, onAdded, onAddToOrder, addToOrderPending = false, addEligible = true }: FlatAddToCartProps) => {
  const addConfigured = useCart((s) => s.addConfigured);
  const [qty, setQty] = useState(1);
  const handleAdd = () => {
    const snapshot: FlatConfigSnapshot = {
      kind: 'flat',
      productId,
      productName,
      category,
      total: flatPrice,       // PER-UNIT — the server scales unit × qty.
      summary: 'Flat price',
    };
    if (onAddToOrder) { onAddToOrder(snapshot, qty); return; }
    addConfigured(snapshot, { qty });
    onAdded();
  };
  return (
    <div className={styles.flatCard}>
      <span className="t-eyebrow">Flat price</span>
      <PriceTag amount={flatPrice} size="lg" />
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
        <span className={styles.stepper}>
          <button
            type="button"
            className={styles.stepperBtn}
            onClick={() => setQty((q) => Math.max(1, q - 1))}
            disabled={qty <= 1}
            aria-label="Decrease quantity"
          >
            <Minus size={12} strokeWidth={2} />
          </button>
          <span className={styles.stepperVal}>{qty}</span>
          <button
            type="button"
            className={styles.stepperBtn}
            onClick={() => setQty((q) => q + 1)}
            aria-label="Increase quantity"
          >
            <Plus size={12} strokeWidth={2} />
          </button>
        </span>
        {qty > 1 && flatPrice > 0 && (
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {qty} × RM {flatPrice.toLocaleString('en-MY')} = RM {(qty * flatPrice).toLocaleString('en-MY')}
          </span>
        )}
      </div>
      <Button variant="primary" disabled={addToOrderPending || (onAddToOrder && !addEligible)} onClick={handleAdd}>
        {onAddToOrder ? (addToOrderPending ? 'Adding…' : 'Add to this order') : 'Add to cart'}
      </Button>
    </div>
  );
};

interface SofaQuickPickProps {
  isLoading: boolean;
  rows: { bundle: BundleDef; price: number | null; active: boolean }[];
  picked: string | null;
  onPick: (id: string) => void;
  quickFlip: 'L' | 'R';
  onFlipChange: (flip: 'L' | 'R') => void;
  /** L↔R mirror toggle for the selected saved Quick Pick (2026-06-01). */
  qpMirror?: boolean;
  onToggleQpMirror?: () => void;
  depth: Depth;
  /** Largest seat size offered by this Model (max of depthOptions). The composed
   *  hero anchors its preview height on the layout's aspect at this size so the
   *  seat-size toggle widens the sofa instead of shrinking the whole plan-view. */
  maxDepth: Depth;
  /** Fabric + Colour picker, rendered in the rail below the layout grid. */
  fabricBlock?: React.ReactNode;
  /** Special Add-ons picker (migration 0134), rendered in the rail below fabric. */
  specialAddonsBlock?: React.ReactNode;
  /** Sofa leg-height picker (Loo 2026-06-03), rendered in the rail under fabric. */
  legBlock?: React.ReactNode;
  /** Product-page remark + extra-charge card (spec 2026-06-06), rendered in the
   *  rail under the leg picker. Parent-owned; null when gated off. */
  remarkBlock?: React.ReactNode;
  /** Global Quick Picks (Master-Admin-curated, shared). */
  globalQuickPicks?: QuickPickItem[];
  /** This salesperson's personal Quick Picks ("Yours", per-device). */
  personalQuickPicks?: QuickPickItem[];
  /** Currently selected Quick Pick id (highlights the card + drives hero). */
  pickedQuickPickId?: string | null;
  /** Price a layout via the engine (à-la-carte sum, or a matched Combo's
   *  price). Whole MYR, or null when the layout doesn't price. */
  priceForLayout?: (modules: string[][]) => number | null;
  /** true → this user may delete GLOBAL picks (Master Admin / backend admin). */
  canDeleteGlobal?: boolean;
  /** Select a Quick Pick — stay in Quick Pick mode, topbar shows price + Add. */
  onQuickPickSelect?: (item: QuickPickItem) => void;
  /** Load a Quick Pick into Customize mode for further editing. */
  onQuickPickEdit?: (item: QuickPickItem) => void;
  /** Remove a Quick Pick (personal → own device; global → Master Admin). */
  onQuickPickDelete?: (item: QuickPickItem) => void;
}

// Maps a bundle id (+ flip orientation for L-shape variants) to the public
// plan-view PNG. Files live in apps/pos/public/sofa-modules/ — non-L bundles
// only ship a single composite (1S.png, 2S.png, 3S.png).
const bundleArtSrc = (bundleId: string, flip: 'L' | 'R'): string => {
  if (bundleId === '2+L' || bundleId === '3+L') {
    return `/sofa-modules/${bundleId}-${flip}.png`;
  }
  // 2.5-Seater has no dedicated plan-view art — reuse the 2-Seater PNG,
  // rendered wider via QUICK_PRESET_META.baseW (Loo 2026-05-23).
  if (bundleId === '2.5S') return '/sofa-modules/2S.png';
  // 2PS (power-slide combo, F7) is visually a 2-seater → reuse 2S.png.
  if (bundleId === '2PS') return '/sofa-modules/2S.png';
  // 2WC (console, F6) uses /sofa-modules/2WC.png once Loo provides it; until then
  // the <img onError> below falls back to 2S.png so the hero never breaks.
  return `/sofa-modules/${bundleId}.png`;
};

// Sofa-module PNGs are uniformly 1024×1024 with transparent padding around the
// drawn silhouette. With the 2:1 hero box + object-fit:contain, the silhouette
// ends up smaller than the box, so dim ticks anchored to box edges span empty
// pixels next to the sofa. Scan alpha once per src, cache, expose box-relative
// percentages via CSS vars so the dim lines snap to the silhouette.
type SilhouetteBounds = { left: number; top: number; right: number; bottom: number };
const silhouetteBoundsCache = new Map<string, SilhouetteBounds>();

const useSilhouetteBounds = (src: string): SilhouetteBounds | null => {
  const [bounds, setBounds] = useState<SilhouetteBounds | null>(
    () => silhouetteBoundsCache.get(src) ?? null,
  );
  useEffect(() => {
    const cached = silhouetteBoundsCache.get(src);
    if (cached) {
      setBounds(cached);
      return;
    }
    let cancelled = false;
    const img = new Image();
    img.src = src;
    img.onload = () => {
      if (cancelled) return;
      try {
        const c = document.createElement('canvas');
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext('2d', { willReadFrequently: true });
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        const { data } = ctx.getImageData(0, 0, c.width, c.height);
        const w = c.width;
        const h = c.height;
        let minX = w;
        let maxX = -1;
        let minY = h;
        let maxY = -1;
        for (let y = 0; y < h; y++) {
          const rowBase = y * w * 4;
          for (let x = 0; x < w; x++) {
            if (data[rowBase + x * 4 + 3]! > 10) {
              if (x < minX) minX = x;
              if (x > maxX) maxX = x;
              if (y < minY) minY = y;
              if (y > maxY) maxY = y;
            }
          }
        }
        if (maxX < 0) return;
        const result: SilhouetteBounds = {
          left: minX / w,
          top: minY / h,
          right: 1 - (maxX + 1) / w,
          bottom: 1 - (maxY + 1) / h,
        };
        silhouetteBoundsCache.set(src, result);
        if (!cancelled) setBounds(result);
      } catch {
        // canvas tainted or decode error — leave bounds null, dim lines fall
        // back to box edges via CSS var defaults.
      }
    };
    return () => {
      cancelled = true;
    };
  }, [src]);
  return bounds;
};

// Box is 2:1, PNG is 1:1 with object-fit:contain → the rendered PNG occupies
// a boxH × boxH square centered horizontally inside the box (50% wide, 100%
// tall, 25% left/right padding). When the seat depth toggle stretches the
// image via transform:scaleX(k), the rendered content widens to k * boxH
// while staying centered, so contentLeft/contentWidth scale with k. Translate
// silhouette bounds (fractions of the PNG canvas) into box-relative CSS
// percentages for dim-line anchoring.
const heroAnchorStyle = (
  bounds: SilhouetteBounds | null,
  depthScale: number,
): React.CSSProperties => {
  if (!bounds) return {};
  const contentLeft = 0.5 - depthScale / 4;
  const contentWidth = depthScale / 2;
  const silLeft = contentLeft + bounds.left * contentWidth;
  const silWidth = (1 - bounds.left - bounds.right) * contentWidth;
  const silRight = 1 - silLeft - silWidth;
  return {
    '--sil-left': `${silLeft * 100}%`,
    '--sil-right': `${silRight * 100}%`,
    '--sil-top': `${bounds.top * 100}%`,
    '--sil-bottom': `${bounds.bottom * 100}%`,
  } as React.CSSProperties;
};

// Two-column layout port from prototype: left rail = compact bundle cards,
// right hero = big plan-view of the currently picked bundle with W × D
// dimension lines. Only bundles that are active + priced on this Model show.
const SofaQuickPick = ({ isLoading, rows, picked, onPick, quickFlip, onFlipChange, qpMirror, onToggleQpMirror, depth, maxDepth, fabricBlock, specialAddonsBlock, legBlock, remarkBlock, globalQuickPicks, personalQuickPicks, pickedQuickPickId, priceForLayout, canDeleteGlobal, onQuickPickSelect, onQuickPickEdit, onQuickPickDelete }: SofaQuickPickProps) => {
  // Hide bundles not activated for this Model. The productSchema refine
  // guarantees ≥1 active+priced bundle exists for every sofa SKU.
  const activeRows = useMemo(
    () => rows.filter((r) => r.active && r.price != null),
    [rows],
  );

  // Auto-pick the first active bundle on first paint so the hero always
  // has something to render. Staff can change it after.
  useEffect(() => {
    if (picked == null && pickedQuickPickId == null && activeRows.length > 0) {
      onPick(activeRows[0]!.bundle.id);
    }
  }, [picked, pickedQuickPickId, activeRows, onPick]);

  // Unified Quick Pick list — global first, then personal "Yours".
  const allQuickPicks = useMemo(
    () => [...(globalQuickPicks ?? []), ...(personalQuickPicks ?? [])],
    [globalQuickPicks, personalQuickPicks],
  );

  // Resolve hero pick up front so the silhouette-bounds hook is called on
  // every render path. Hooks must not sit behind the loading/empty early
  // returns — that'd violate the rules-of-hooks (see "rendered more hooks
  // than during the previous render").
  const pickedRow = activeRows.find((r) => r.bundle.id === picked) ?? activeRows[0] ?? null;
  // When a saved Quick Pick is selected, its cells drive the hero; otherwise
  // use the picked bundle's preset cells / PNG.
  const pickedQPRow = allQuickPicks.find((q) => q.id === pickedQuickPickId) ?? null;
  const heroSrc = (!pickedQPRow && pickedRow) ? bundleArtSrc(pickedRow.bundle.id, quickFlip) : '';
  const heroBounds = useSilhouetteBounds(heroSrc);

  if (isLoading) return <p className={styles.empty}>Loading bundles…</p>;
  // Render when EITHER bundles OR Quick Picks exist. Fully-modular Models may
  // carry no whole-unit bundles — the Quick Pick layer is then the surface.
  if (activeRows.length === 0 && allQuickPicks.length === 0) {
    return <p className={styles.empty}>No Quick-Pick layouts yet — switch to Customize to build one.</p>;
  }

  // Bundle-hero geometry only applies when a bundle is the active hero.
  const dims = pickedRow ? quickPresetDims(pickedRow.bundle.id, depth) : { w: 0, d: 0 };
  // 28" seat widens each cushion by 10cm — stretch the silhouette by the
  // same width ratio so the visual matches the cm label.
  const baseW = (pickedRow && QUICK_PRESET_META[pickedRow.bundle.id]?.baseW) ?? dims.w;
  const depthScale = baseW > 0 ? dims.w / baseW : 1;
  const heroCells = pickedRow ? buildPresetCells(pickedRow.bundle.id, depth) : undefined;
  // Hero only — anchor the composed-preview HEIGHT on the layout's aspect at the
  // LARGEST seat size so toggling the seat WIDENS the sofa left-right instead of
  // shrinking the whole plan-view (the single-PNG hero already does this via
  // scaleX). pickedQPRow → saved-layout hero; heroCells → console/corner preset.
  const qpAnchorAspect = pickedQPRow
    ? layoutAnchorAspect(cellsFromComboModules(pickedQPRow.modules, maxDepth), maxDepth)
    : undefined;
  const presetAnchorAspect = pickedRow && heroCells
    ? layoutAnchorAspect(buildPresetCells(pickedRow.bundle.id, maxDepth) ?? [], maxDepth)
    : undefined;

  return (
    <>
      <aside className={styles.qpRail}>
        <header className={styles.qpRailHead}>
          <span className={styles.qpRailEyebrow}>Quick Pick · Basic</span>
          <span className={styles.qpRailDetail}>{depth}″ seat · pricing per layout</span>
        </header>
        <div className={styles.qpGrid}>
          {activeRows.map(({ bundle, price }) => {
            const isPicked = bundle.id === pickedRow?.bundle.id;
            const lShape = isLShapeBundle(bundle.id);
            const meta = QUICK_PRESET_META[bundle.id];
            const presetCells = buildPresetCells(bundle.id, depth);
            return (
              <button
                key={bundle.id}
                type="button"
                className={`${styles.qpCard} ${isPicked ? styles.qpCardPicked : ''}`}
                onClick={() => onPick(bundle.id)}
              >
                <div className={styles.qpCardArt}>
                  {presetCells ? (
                    <SofaCellsPreview cells={presetCells} depth={depth} />
                  ) : (
                    <img
                      src={bundleArtSrc(bundle.id, quickFlip)}
                      alt={`${bundle.label} plan view`}
                      draggable={false}
                      loading="lazy"
                      onError={(e) => { const t = e.currentTarget; if (!t.src.endsWith('/2S.png')) t.src = '/sofa-modules/2S.png'; }}
                    />
                  )}
                </div>
                <div className={styles.qpCardBody}>
                  <span className={styles.qpCardLabel}>{bundle.label}</span>
                  {meta?.sub && <span className={styles.qpCardSub}>{meta.sub}</span>}
                  <span className={styles.qpCardPrice}>RM{(price ?? 0).toLocaleString('en-MY')}</span>
                </div>
                {lShape && isPicked && (
                  <span
                    className={styles.qpFlip}
                    role="group"
                    aria-label="Chaise orientation"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(['L', 'R'] as const).map((side) => (
                      <button
                        key={side}
                        type="button"
                        aria-pressed={quickFlip === side}
                        className={`${styles.qpFlipBtn} ${quickFlip === side ? styles.qpFlipBtnActive : ''}`}
                        onClick={(e) => { e.stopPropagation(); onFlipChange(side); }}
                      >
                        {side}
                      </button>
                    ))}
                  </span>
                )}
              </button>
            );
          })}
        </div>
        {/* Quick Picks (Phase 5, Chairman 2026-05-31) — saved sofa LAYOUTS for
            easy selection. Global layer (Master-Admin-curated, shared) +
            personal "Yours" (per-device). A Quick Pick carries NO price; the
            card computes its price by running the layout through the engine
            (à-la-carte sum, or the matched Combo's price). Combos themselves
            stay invisible — they auto-apply on module match. Tap a card to
            SELECT (stay in Quick Pick); "Edit" loads it into Customize. */}
        {[
          { key: 'global' as const, items: globalQuickPicks ?? [], title: 'Quick Picks', sub: 'tap to select' },
          { key: 'personal' as const, items: personalQuickPicks ?? [], title: 'Yours', sub: 'saved on this tablet' },
        ].map(({ key, items, title, sub }) => items.length > 0 && (
          <Fragment key={key}>
            <header className={styles.qpRailHead} style={{ marginTop: 12 }}>
              <span className={styles.qpRailEyebrow}>{title}</span>
              <span className={styles.qpRailDetail}>{depth}″ seat · {sub}</span>
            </header>
            <div className={styles.qpGrid}>
              {items.map((item) => {
                const priceRm = priceForLayout?.(item.modules) ?? null;
                /* Same label rule as the topbar: curated names survive,
                   code-join labels re-read in walk order — otherwise the card
                   under the topbar would show the rejected slot order. */
                const label = qpLabelIsCodeJoin(item.label, item.modules)
                  ? (qpWalkLabel(item.modules, depth) ?? buildComboLabel(item.modules))
                  : item.label!;
                const isPicked = item.id === pickedQuickPickId;
                const canDelete = item.source === 'personal' || canDeleteGlobal;
                return (
                  <button
                    key={item.id}
                    type="button"
                    className={`${styles.qpCard} ${isPicked ? styles.qpCardPicked : ''}`}
                    onClick={() => onQuickPickSelect?.(item)}
                    title={qpWalkLabel(item.modules, depth) ?? item.modules.map((s) => s[0] ?? '').join(' + ')}
                  >
                    <div className={styles.qpCardArt}>
                      <SofaCellsPreview cells={cellsFromComboModules(item.modules, depth)} depth={depth} />
                    </div>
                    <div className={styles.qpCardBody}>
                      <span className={styles.qpCardLabel}>{label}</span>
                      <span className={styles.qpCardSub}>
                        {item.modules.length} compartment{item.modules.length !== 1 ? 's' : ''}
                      </span>
                      <span className={styles.qpCardPrice}>
                        {priceRm == null ? '— (no price)' : `RM${priceRm.toLocaleString('en-MY')}`}
                      </span>
                    </div>
                    {canDelete && (
                      <span
                        role="button"
                        tabIndex={0}
                        className={styles.qpDeleteQuickPick}
                        onClick={(e) => { e.stopPropagation(); onQuickPickDelete?.(item); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onQuickPickDelete?.(item); } }}
                        title={item.source === 'personal' ? 'Remove from this tablet' : 'Remove shared Quick Pick'}
                        aria-label="Remove Quick Pick"
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </span>
                    )}
                    {isPicked && canMirror(item.modules) && (
                      <button
                        type="button"
                        className={styles.qpMirrorBtn}
                        aria-pressed={qpMirror}
                        onClick={(e) => { e.stopPropagation(); onToggleQpMirror?.(); }}
                        title="Mirror left ↔ right"
                        aria-label="Mirror left to right"
                      >
                        <FlipHorizontal2 size={14} strokeWidth={1.75} />
                      </button>
                    )}
                    {isPicked && (
                      <button
                        type="button"
                        className={styles.qpEditCombo}
                        onClick={(e) => { e.stopPropagation(); onQuickPickEdit?.(item); }}
                        title="Load into Customize to adjust"
                      >
                        Edit in Customize →
                      </button>
                    )}
                  </button>
                );
              })}
            </div>
          </Fragment>
        ))}
        {fabricBlock}
        {specialAddonsBlock}
        {legBlock}
        {remarkBlock}
      </aside>

      <section className={styles.qpHero}>
        <div className={styles.qpHeroFrame}>
          {pickedQPRow ? (
            // Quick Pick selected — show its layout cells in the hero.
            <div className={styles.qpHeroCells}>
              <SofaCellsPreview
                cells={cellsFromComboModules(qpMirror ? mirrorModules(pickedQPRow.modules) : pickedQPRow.modules, depth)}
                depth={depth}
                anchorAspect={qpAnchorAspect}
                showDims
              />
            </div>
          ) : heroCells ? (
            <div className={styles.qpHeroCells}>
              <SofaCellsPreview cells={heroCells} depth={depth} anchorAspect={presetAnchorAspect} showDims />
            </div>
          ) : pickedRow ? (
          <div className={styles.qpHeroBox} style={heroAnchorStyle(heroBounds, depthScale)}>
            <img
              src={heroSrc}
              alt={`${pickedRow.bundle.label} plan view`}
              draggable={false}
              style={{ transform: `scaleX(${depthScale})` }}
              onError={(e) => { const t = e.currentTarget; if (!t.src.endsWith('/2S.png')) t.src = '/sofa-modules/2S.png'; }}
            />
            {/* Top width dim — vertical pins at the ends of a horizontal line,
                with the cm label absolute-positioned over the middle. */}
            <div className={`${styles.qpDim} ${styles.qpDimTop}`} aria-hidden="true">
              <span className={styles.qpDimTickV} />
              <span className={styles.qpDimLine} />
              <span className={styles.qpDimTickV} />
              <span className={styles.qpDimLabel}>
                {dims.w}<span className={styles.qpDimUnit}>cm</span>
              </span>
            </div>
            {/* Right depth dim — horizontal pins at the ends of a vertical
                line, label centered over the middle. */}
            <div className={`${styles.qpDim} ${styles.qpDimRight}`} aria-hidden="true">
              <span className={styles.qpDimTickH} />
              <span className={styles.qpDimLineV} />
              <span className={styles.qpDimTickH} />
              <span className={styles.qpDimLabel}>
                {dims.d}<span className={styles.qpDimUnit}>cm</span>
              </span>
            </div>
          </div>
          ) : (
            <div className={styles.qpHeroCells} />
          )}
          {/* TV reference marker (2026-06-01) — bottom-center of the hero, sofa
              faces it. Hero-only: NOT rendered inside SofaCellsPreview, so the
              small rail card thumbnails stay TV-free. Pure decoration. */}
          <div className={styles.tvBeam} aria-hidden="true" />
          <div className={styles.tv} aria-hidden="true" title="TV — sofas face this way">
            <div className={styles.tvScreen} />
            <div className={styles.tvLabel}>TV</div>
          </div>
        </div>
        <footer className={styles.qpHeroFoot}>
          <span className={styles.qpHeroFootEyebrow}>Plan view</span>
          <span className={styles.qpHeroFootDim}>{depth}″ seat</span>
        </footer>
      </section>
    </>
  );
};
