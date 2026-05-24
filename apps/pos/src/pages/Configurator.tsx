import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Hourglass, X, Plus, Minus, Sparkles, Package } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM, BUNDLES, type BundleDef, type Cell, type Depth, type SofaProductPricing } from '@2990s/shared';
import {
  useProduct,
  useProductBundles,
  useProductCompartments,
  useProductSizes,
  useSizeLibrary,
  useProductPricingRealtime,
  useProductFabrics,
  useAddons,
  type AddonRow,
} from '../lib/queries';
import {
  useCart,
  type SofaConfigSnapshot,
  type SizeConfigSnapshot,
  type FlatConfigSnapshot,
} from '../state/cart';
import { CustomBuilder } from './CustomBuilder';
import { FabricColourPicker, type FabricSelection } from '../components/FabricColourPicker';
import { SofaCellsPreview } from '../components/SofaCellsPreview';
import { Topbar } from '../components/Topbar';
import styles from './Configurator.module.css';

interface SizeRow {
  id: string;
  label: string;
  widthCm: number;
  lengthCm: number;
  price: number | null;
  active: boolean;
}

// Quick-Pick preset metadata — sub label + 24" baseline footprint (cm).
// Width grows 10cm per cushion at 28" depth; depth stays constant.
// Mirrors prototype/pos-sofa-config.jsx → QUICK_PRESETS, kept Configurator-local
// because it's purely UI sizing for the hero plan-view canvas.
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
  // F4: corner package (composed preview, no single PNG).
  CORNER: { sub: '1B + corner + 2A',          cushions: 3, baseW: 200, baseD: 253 },
};

// Composed-preview cell templates for presets that have NO single composite PNG
// (F6 console, F4 corner) — rendered via <SofaCellsPreview> from the module art.
// cm coords. CORNER's L-layout is a sensible default; positions/rotations are
// easily tweaked (it's just the preview + the canonical PO module list).
const PRESET_CELLS: Record<string, Cell[]> = {
  '2WC': [
    { id: 'wc-l', moduleId: '1A-LHF', x: 0,   y: 0,  rot: 0 },
    { id: 'wc-c', moduleId: 'WC-45',  x: 95,  y: 0,  rot: 0 },
    { id: 'wc-r', moduleId: '1A-RHF', x: 140, y: 0,  rot: 0 },
  ],
  CORNER: [
    { id: 'cn-1b',  moduleId: '1B-LHF', x: 0,   y: 0,  rot: 0 },
    { id: 'cn-cnr', moduleId: 'CNR',    x: 105, y: 0,  rot: 0 },
    { id: 'cn-2a',  moduleId: '2A-RHF', x: 105, y: 95, rot: 90 },
  ],
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

export const Configurator = () => {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const product = useProduct(productId);
  const bundles = useProductBundles(productId);
  const compartments = useProductCompartments(productId);
  const productFabrics = useProductFabrics(productId);
  useProductPricingRealtime(productId);

  const [picked, setPicked] = useState<string | null>(null);
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
  // Chosen fabric + colour (spec 2026-05-24). Required before Add-to-Cart for
  // sofas; the picker resolves labels/hex/surcharge so the snapshot + LIVE
  // TOTAL render without another lookup.
  const [fabricSel, setFabricSel] = useState<FabricSelection | null>(null);

  const sizes = useProductSizes(productId);
  const sizeLib = useSizeLibrary();
  const addons = useAddons();
  const addConfigured = useCart((s) => s.addConfigured);

  // Build the SofaProductPricing struct that the shared pure functions expect.
  const sofaPricing = useMemo<SofaProductPricing>(() => ({
    compartments: compartments.data ?? [],
    bundles: bundles.data ?? [],
    reclinerUpgradePrice: product.data?.recliner_upgrade_price ?? 0,
    seatUpgradeLabel: product.data?.seat_upgrade_label ?? null,
    seatUpgradeFootrest: product.data?.seat_upgrade_footrest ?? true,
  }), [
    compartments.data, bundles.data,
    product.data?.recliner_upgrade_price,
    product.data?.seat_upgrade_label,
    product.data?.seat_upgrade_footrest,
  ]);

  // F5: per-Model seat depths ('24,30' → ['24','30']). Fallback ['24'] so the
  // toggle always has a value (only rendered for sofas, which always seed it).
  const depthOptions = useMemo<Depth[]>(() => {
    const raw: string = product.data?.depth_options ?? '';
    const parsed = raw.split(',').map((s) => s.trim()).filter(Boolean);
    return parsed.length > 0 ? parsed : ['24'];
  }, [product.data?.depth_options]);

  // Keep activeDepth within the Model's offered depths (default to the first).
  useEffect(() => {
    if (!depthOptions.includes(activeDepth)) setActiveDepth(depthOptions[0] ?? '24');
  }, [depthOptions, activeDepth]);

  // Build size rows once per data refresh (used by isSize render + topbar
  // action slot). Rows are derived from the size library so staff see a
  // stable grid of all four sizes; rows where this Model is inactive land
  // dimmed + non-clickable, same as SofaQuickPick.
  const sizeRows = useMemo<SizeRow[]>(() => {
    const lib = sizeLib.data ?? [];
    const variants = sizes.data ?? [];
    return lib
      .filter((l) => l.sortOrder < 100)
      .map((l) => {
        const variant = variants.find((v) => v.sizeId === l.id);
        return {
          id: l.id,
          label: l.label,
          widthCm: l.widthCm,
          lengthCm: l.lengthCm,
          price: variant?.price ?? null,
          active: variant?.active ?? false,
        };
      });
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

  // Pillows that ship FREE with this Model (configured in Backend SKU Master
  // → products.included_addons jsonb). Lookup full addon details for display.
  const includedPillows = useMemo(() => {
    const arr = (product.data?.included_addons ?? []) as { addonId: string; qty: number }[];
    return arr
      .map((entry) => {
        const addon = addonsById.get(entry.addonId);
        if (!addon) return null;
        return { addon, qty: entry.qty };
      })
      .filter((v): v is { addon: AddonRow; qty: number } => v != null);
  }, [product.data, addonsById]);

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

  const sizeTotal = sizeBase + extrasTotal;

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
      total: sizeTotal,
      summary: `${pickedSize.label}${extraSummary}`,
      addonExtras: extrasArr.length > 0 ? extrasArr : undefined,
    };
    addConfigured(snapshot);
    navigate('/catalog');
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
  // Fabric surcharge folds onto the bundle price (caller-applied; see spec §3.2).
  const sofaTotal = (pickedSofaRow?.price ?? 0) + (pickedSofaRow ? (fabricSel?.surcharge ?? 0) : 0);
  // Sofas require a fabric + colour before Add-to-Cart (G6).
  const canAddSofa = pickedSofaRow != null && pickedSofaRow.active && pickedSofaRow.price != null && fabricSel != null;

  const handleAddSofa = () => {
    if (!canAddSofa || pickedSofaRow == null || pickedSofaRow.price == null) return;
    const lShape = isLShapeBundle(pickedSofaRow.bundle.id);
    const fabricSuffix = fabricSel ? ` · ${fabricSel.fabricLabel}/${fabricSel.colourLabel}` : '';
    const snapshot: SofaConfigSnapshot = {
      kind: 'sofa',
      productId: p.id,
      productName: p.name,
      bundleId: pickedSofaRow.bundle.id,
      depth: activeDepth,
      // Snapshot the Model's upgrade so the invoice can show an auto-included
      // headrest ("+ N Headrest") on this quick-pick line (F3).
      seatUpgradeLabel: p.seat_upgrade_label ?? null,
      seatUpgradeFootrest: p.seat_upgrade_footrest ?? true,
      // Fabric + colour (spec 2026-05-24) — surcharge folded into total.
      fabricId: fabricSel?.fabricId,
      colourId: fabricSel?.colourId,
      fabricLabel: fabricSel?.fabricLabel,
      colourLabel: fabricSel?.colourLabel,
      colourHex: fabricSel?.colourHex ?? undefined,
      total: pickedSofaRow.price + (fabricSel?.surcharge ?? 0),
      summary: lShape
        ? `${pickedSofaRow.bundle.id} · ${pickedSofaRow.bundle.label} · ${quickFlip}-facing · ${activeDepth}"${fabricSuffix}`
        : `${pickedSofaRow.bundle.id} · ${pickedSofaRow.bundle.label} · ${activeDepth}"${fabricSuffix}`,
    };
    addConfigured(snapshot);
    navigate('/catalog');
  };

  // Topbar action slot for size_variants: product chip + LIVE TOTAL +
  // Cancel + Add to Cart. Sofa + flat keep the default Quotes/My orders
  // pills (their flows are full-page with a footer button).
  const sizeTopbarSlot = isSize ? (
    <span className={styles.topbarActions}>
      <span className={styles.topbarChip}>
        <span className={styles.topbarChipEyebrow}>
          {p.name.toUpperCase()} · {p.category_id.toUpperCase()}
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
        <span className={styles.topbarTotalLbl}>LIVE TOTAL</span>
        <span className={styles.topbarTotalAmt}>
          <sup>RM</sup>
          {sizeTotal > 0 ? sizeTotal.toLocaleString('en-MY') : '—'}
        </span>
        <span className={styles.topbarTotalNote}>Delivery &amp; assembly included</span>
      </span>
      <button
        type="button"
        className={styles.topbarBtnGhost}
        onClick={() => navigate('/catalog')}
      >
        <X size={14} strokeWidth={1.75} />
        Cancel
      </button>
      <button
        type="button"
        className={styles.topbarBtnPrimary}
        disabled={!canAddSize}
        onClick={handleAddSize}
      >
        + Add to Cart
      </button>
    </span>
  ) : undefined;

  // Sofa right slot — chip + LIVE TOTAL + Cancel + Add to Cart. Depth toggle
  // and mode tabs moved to centerSlot per prototype topbar layout.
  const sofaTopbarSlot = isSofa && mode === 'quick' ? (
    <span className={styles.topbarActions}>
      <span className={styles.topbarChip}>
        <span className={styles.topbarChipEyebrow}>
          {p.name.toUpperCase()} · {p.category_id.toUpperCase()}
        </span>
        <span className={styles.topbarChipName}>
          {pickedSofaRow
            ? `${pickedSofaRow.bundle.label} · ${activeDepth}"`
            : p.name}
        </span>
        {pickedSofaRow && (
          <span className={styles.topbarChipSub}>
            Quick Pick{isLShapeBundle(pickedSofaRow.bundle.id) ? ` · ${quickFlip}-facing` : ''}
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
        onClick={() => navigate('/catalog')}
      >
        <X size={14} strokeWidth={1.75} />
        Cancel
      </button>
      <button
        type="button"
        className={styles.topbarBtnPrimary}
        disabled={!canAddSofa}
        onClick={handleAddSofa}
      >
        + Add to Cart
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
        onClick={() => navigate('/catalog')}
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
    </>
  ) : undefined;

  return (
    <>
    <Topbar
      step={isSofa ? undefined : 'cart'}
      centerSlot={sofaCenterSlot}
      rightSlot={sofaTopbarSlot ?? sizeTopbarSlot}
    />
    <main
      className={isSofa && mode === 'quick' ? styles.sofaShell : isSize ? styles.shellWide : styles.shell}
      // Custom-build mode runs on a slightly warmer cream (#FAF6EC vs the app
      // default #FFF9EB) so the "build space" feels distinct from Quick Pick's
      // catalogue browse. The palette sits on top as an elevated white panel
      // (see CustomBuilder.module.css) — same white-on-cream hierarchy as
      // Quick Pick's qpRail, just contained as a card rather than a hard
      // left-half color split.
      style={isSofa && mode === 'custom' ? { background: '#FAF6EC' } : undefined}
    >
      {!isSize && !isSofa && (
        <header className={styles.header}>
          <IconButton
            icon={<ArrowLeft size={20} strokeWidth={1.75} />}
            aria-label="Back"
            onClick={() => navigate('/catalog')}
          />
          <div className={styles.title}>
            <span className="t-eyebrow">{p.category_id}</span>
            <h1 className={styles.heading}>{p.name}</h1>
            {p.detail && <p className={styles.detail}>{p.detail}</p>}
            <code className={styles.sku}>{p.sku}</code>
          </div>
        </header>
      )}

      {isSize && (
        <header className={styles.headerWide}>
          <div>
            <span className="t-eyebrow">{p.category_id}</span>
            <h1 className={styles.heading}>
              {p.name}
              {pickedSize ? ` · ${pickedSize.label}` : ''}
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
            onPick={setPicked}
            quickFlip={quickFlip}
            onFlipChange={setQuickFlip}
            depth={activeDepth}
            fabricBlock={
              <FabricColourPicker
                productFabrics={productFabrics.data ?? []}
                fabricId={fabricSel?.fabricId ?? null}
                colourId={fabricSel?.colourId ?? null}
                onChange={setFabricSel}
              />
            }
          />
        ) : (
          <CustomBuilder
            productId={p.id}
            productName={p.name}
            pricing={sofaPricing}
            depth={activeDepth}
            cells={sofaCells}
            setCells={setSofaCells}
            onAdded={() => navigate('/catalog')}
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
              <div className={styles.sizeGrid}>
                {sizeRows.map((r) => {
                  const isPicked = pickedSizeId === r.id;
                  const inactive = !r.active || r.price == null;
                  return (
                    <button
                      key={r.id}
                      type="button"
                      className={`${styles.sizeCard} ${isPicked ? styles.sizeCardPicked : ''} ${inactive ? styles.sizeCardInactive : ''}`}
                      disabled={inactive}
                      onClick={() => setPickedSizeId(r.id)}
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
            </RailSection>

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

            {includedPillows.length > 0 && (
              <RailSection
                title="Pillows · included free"
                sub={`${includedPillows.reduce((s, x) => s + x.qty, 0)} complimentary`}
              >
                <p className={styles.aboutText}>
                  Every {p.category_id} comes with {includedPillows.reduce((s, x) => s + x.qty, 0)}{' '}
                  {includedPillows.length === 1 ? includedPillows[0]!.addon.label.toLowerCase() : ''}
                  {' '}pillow{includedPillows.reduce((s, x) => s + x.qty, 0) > 1 ? 's' : ''}.
                </p>
                {includedPillows.map(({ addon, qty }) => (
                  <div key={addon.id} className={styles.pillowRow}>
                    <span className={styles.pillowIcon}>
                      <Sparkles size={16} strokeWidth={1.75} />
                    </span>
                    <span className={styles.pillowMeta}>
                      <span className={styles.pillowName}>{addon.label}</span>
                      {addon.description && (
                        <span className={styles.pillowDesc}>{addon.description}</span>
                      )}
                    </span>
                    <span className={styles.includedPill}>× {qty} INCLUDED</span>
                  </div>
                ))}
              </RailSection>
            )}

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

      {p.pricing_kind === 'flat' && p.flat_price != null && (
        <FlatAddToCart
          productId={p.id}
          productName={p.name}
          flatPrice={p.flat_price}
          onAdded={() => navigate('/catalog')}
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

interface FlatAddToCartProps {
  productId: string;
  productName: string;
  flatPrice: number;
  onAdded: () => void;
}

const FlatAddToCart = ({ productId, productName, flatPrice, onAdded }: FlatAddToCartProps) => {
  const addConfigured = useCart((s) => s.addConfigured);
  const handleAdd = () => {
    const snapshot: FlatConfigSnapshot = {
      kind: 'flat',
      productId,
      productName,
      total: flatPrice,
      summary: 'Flat price',
    };
    addConfigured(snapshot);
    onAdded();
  };
  return (
    <div className={styles.flatCard}>
      <span className="t-eyebrow">Flat price</span>
      <PriceTag amount={flatPrice} size="lg" />
      <Button variant="primary" onClick={handleAdd}>Add to cart</Button>
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
  depth: Depth;
  /** Fabric + Colour picker, rendered in the rail below the layout grid. */
  fabricBlock?: React.ReactNode;
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
const SofaQuickPick = ({ isLoading, rows, picked, onPick, quickFlip, onFlipChange, depth, fabricBlock }: SofaQuickPickProps) => {
  // Hide bundles not activated for this Model. The productSchema refine
  // guarantees ≥1 active+priced bundle exists for every sofa SKU.
  const activeRows = useMemo(
    () => rows.filter((r) => r.active && r.price != null),
    [rows],
  );

  // Auto-pick the first active bundle on first paint so the hero always
  // has something to render. Staff can change it after.
  useEffect(() => {
    if (picked == null && activeRows.length > 0) {
      onPick(activeRows[0]!.bundle.id);
    }
  }, [picked, activeRows, onPick]);

  // Resolve hero pick up front so the silhouette-bounds hook is called on
  // every render path. Hooks must not sit behind the loading/empty early
  // returns — that'd violate the rules-of-hooks (see "rendered more hooks
  // than during the previous render").
  const pickedRow = activeRows.find((r) => r.bundle.id === picked) ?? activeRows[0] ?? null;
  const heroSrc = pickedRow ? bundleArtSrc(pickedRow.bundle.id, quickFlip) : '';
  const heroBounds = useSilhouetteBounds(heroSrc);

  if (isLoading) return <p className={styles.empty}>Loading bundles…</p>;
  if (activeRows.length === 0 || !pickedRow) {
    return <p className={styles.empty}>No Quick-Pick layouts activated for this Model yet.</p>;
  }

  const dims = quickPresetDims(pickedRow.bundle.id, depth);
  // 28" seat widens each cushion by 10cm — stretch the silhouette by the
  // same width ratio so the visual matches the cm label.
  const baseW = QUICK_PRESET_META[pickedRow.bundle.id]?.baseW ?? dims.w;
  const depthScale = baseW > 0 ? dims.w / baseW : 1;
  const heroCells = PRESET_CELLS[pickedRow.bundle.id];

  return (
    <>
      <aside className={styles.qpRail}>
        <header className={styles.qpRailHead}>
          <span className={styles.qpRailEyebrow}>Quick Pick · Basic</span>
          <span className={styles.qpRailDetail}>{depth}″ seat · pricing per layout</span>
        </header>
        <div className={styles.qpGrid}>
          {activeRows.map(({ bundle, price }) => {
            const isPicked = bundle.id === pickedRow.bundle.id;
            const lShape = isLShapeBundle(bundle.id);
            const meta = QUICK_PRESET_META[bundle.id];
            const presetCells = PRESET_CELLS[bundle.id];
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
        {fabricBlock}
      </aside>

      <section className={styles.qpHero}>
        <div className={styles.qpHeroFrame}>
          {heroCells ? (
            <div className={styles.qpHeroCells}>
              <SofaCellsPreview cells={heroCells} depth={depth} showDims />
            </div>
          ) : (
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
          )}
        </div>
        <footer className={styles.qpHeroFoot}>
          <span className={styles.qpHeroFootEyebrow}>Plan view</span>
          <span className={styles.qpHeroFootDim}>{depth}″ seat</span>
        </footer>
      </section>
    </>
  );
};
