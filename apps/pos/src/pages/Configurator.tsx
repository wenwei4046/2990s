import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Hourglass, X, Plus, Minus, Sparkles, Package } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM, BUNDLES, type BundleDef, type Depth, type SofaProductPricing } from '@2990s/shared';
import {
  useProduct,
  useProductBundles,
  useProductCompartments,
  useProductSizes,
  useSizeLibrary,
  useProductPricingRealtime,
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

export const Configurator = () => {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const product = useProduct(productId);
  const bundles = useProductBundles(productId);
  const compartments = useProductCompartments(productId);
  useProductPricingRealtime(productId);

  const [picked, setPicked] = useState<string | null>(null);
  const [pickedSizeId, setPickedSizeId] = useState<string | null>(null);
  const [pillowExtras, setPillowExtras] = useState<Record<string, number>>({});
  const [mode, setMode] = useState<'quick' | 'custom'>('quick');
  // Sofa Quick-Pick toolbar state. quickFlip controls the L/R orientation of
  // L-shape bundles (2+L, 3+L); activeDepth toggles 24"/28" seat depth which
  // affects per-cushion footprint (~10cm wider per cushion at 28"). Both
  // surface in the topbar action slot per UI_REFERENCE.md.
  const [quickFlip, setQuickFlip] = useState<'L' | 'R'>('R');
  const [activeDepth, setActiveDepth] = useState<Depth>('24');

  const sizes = useProductSizes(productId);
  const sizeLib = useSizeLibrary();
  const addons = useAddons();
  const addConfigured = useCart((s) => s.addConfigured);

  // Build the SofaProductPricing struct that the shared pure functions expect.
  const sofaPricing = useMemo<SofaProductPricing>(() => ({
    compartments: compartments.data ?? [],
    bundles: bundles.data ?? [],
    reclinerUpgradePrice: product.data?.recliner_upgrade_price ?? 0,
  }), [compartments.data, bundles.data, product.data?.recliner_upgrade_price]);

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
  const sofaTotal = pickedSofaRow?.price ?? 0;
  const canAddSofa = pickedSofaRow != null && pickedSofaRow.active && pickedSofaRow.price != null;
  const isLShape = (id: string | null) => id === '2+L' || id === '3+L';

  const handleAddSofa = () => {
    if (!canAddSofa || pickedSofaRow == null || pickedSofaRow.price == null) return;
    const lShape = isLShape(pickedSofaRow.bundle.id);
    const snapshot: SofaConfigSnapshot = {
      kind: 'sofa',
      productId: p.id,
      productName: p.name,
      bundleId: pickedSofaRow.bundle.id,
      depth: activeDepth,
      total: pickedSofaRow.price,
      summary: lShape
        ? `${pickedSofaRow.bundle.id} · ${pickedSofaRow.bundle.label} · ${quickFlip}-facing · ${activeDepth}"`
        : `${pickedSofaRow.bundle.id} · ${pickedSofaRow.bundle.label} · ${activeDepth}"`,
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

  // Topbar action slot for sofa Quick-Pick: depth toggle (24"/28") +
  // Model+bundle chip + LIVE TOTAL + Cancel + Add to Cart. Mirrors the
  // size_variants treatment so both flows feel uniform.
  const sofaTopbarSlot = isSofa && mode === 'quick' ? (
    <span className={styles.topbarActions}>
      <span className={styles.depthTabs} role="tablist" aria-label="Seat depth">
        {(['24', '28'] as const).map((d) => (
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
            Quick Pick{isLShape(pickedSofaRow.bundle.id) ? ` · ${quickFlip}-facing` : ''}
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

  return (
    <>
    <Topbar step="cart" rightSlot={sofaTopbarSlot ?? sizeTopbarSlot} />
    <main className={isSize ? styles.shellWide : styles.shell}>
      {!isSize && (
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
        <>
          <div className={styles.tabs} role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'quick'}
              className={`${styles.tab} ${mode === 'quick' ? styles.tabActive : ''}`}
              onClick={() => setMode('quick')}
            >
              Quick-Pick
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'custom'}
              className={`${styles.tab} ${mode === 'custom' ? styles.tabActive : ''}`}
              onClick={() => setMode('custom')}
            >
              Custom build
            </button>
          </div>

          {mode === 'quick' ? (
            <SofaQuickPick
              isLoading={bundles.isLoading}
              rows={sofaBundleRows}
              picked={picked}
              onPick={setPicked}
              quickFlip={quickFlip}
              onFlipChange={setQuickFlip}
            />
          ) : (
            <CustomBuilder
              productId={p.id}
              productName={p.name}
              pricing={sofaPricing}
              onAdded={() => navigate('/catalog')}
            />
          )}
        </>
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

      <footer className={styles.footer}>
        <span className="t-caption">
          Realtime subscription on this product's pricing. Backend edits land here in ~300ms.
        </span>
      </footer>
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
// Scales (widthCm × lengthCm) into a preview box at most maxW × maxH px,
// preserving aspect ratio. Width is the horizontal dimension, length the
// vertical (taller dimension on most mattresses). Renders architectural-style
// dimension lines (with arrows) above and to the right of the rectangle, so
// the staff sees an actual "we are measuring this dimension" diagram instead
// of a blank cream rectangle with floating numbers.
const FootprintPreview = ({ widthCm, lengthCm, label }: FootprintPreviewProps) => {
  const maxW = 320;
  const maxH = 360;
  const scale = Math.min(maxW / widthCm, maxH / lengthCm);
  const pxW = Math.round(widthCm * scale);
  const pxH = Math.round(lengthCm * scale);

  // SVG canvas leaves room around the rectangle for dimension lines.
  // Top gets 40px (line + label). Right gets 56px. Left/bottom each 16px.
  const padTop = 40;
  const padRight = 56;
  const padLeft = 16;
  const padBottom = 16;
  const svgW = pxW + padLeft + padRight;
  const svgH = pxH + padTop + padBottom;
  const rectX = padLeft;
  const rectY = padTop;

  // Top horizontal dimension line — arrows + label centered above the rect.
  const dimTopY = padTop - 18;        // 18 px above the rect
  const dimTopLabelY = dimTopY - 6;   // text sits 6 px above the line

  // Right vertical dimension line.
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
}

// Maps a bundle id (+ flip orientation for L-shape variants) to the public
// plan-view PNG. Files live in apps/pos/public/sofa-modules/ — non-L bundles
// only ship a single composite (1S.png, 2S.png, 3S.png).
const bundleArtSrc = (bundleId: string, flip: 'L' | 'R'): string => {
  if (bundleId === '2+L' || bundleId === '3+L') {
    return `/sofa-modules/${bundleId}-${flip}.png`;
  }
  return `/sofa-modules/${bundleId}.png`;
};

const SofaQuickPick = ({ isLoading, rows, picked, onPick, quickFlip, onFlipChange }: SofaQuickPickProps) => {
  if (isLoading) return <p className={styles.empty}>Loading bundles…</p>;

  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <span className={styles.sectionEyebrow}>Quick Pick · Basic</span>
        <h2 className={styles.sectionTitle}>Pre-built configurations</h2>
        <p className="t-body fg-muted">
          5 layouts · price per this Model's rules. Pick one, see the LIVE TOTAL, add to cart.
        </p>
      </header>
      <div className={styles.bundleGrid}>
        {rows.map(({ bundle, price, active }) => {
          const isPicked = picked === bundle.id;
          const inactive = !active || price == null;
          const lShape = bundle.id === '2+L' || bundle.id === '3+L';
          return (
            <button
              key={bundle.id}
              type="button"
              className={`${styles.bundleCard} ${isPicked ? styles.bundleCardPicked : ''} ${inactive ? styles.bundleCardInactive : ''}`}
              disabled={inactive}
              onClick={() => onPick(bundle.id)}
            >
              <div className={styles.bundleHead}>
                <code className={styles.bundleCode}>{bundle.id}</code>
                <span className={styles.bundleLabel}>{bundle.label}</span>
                {lShape && isPicked && (
                  <span
                    className={styles.bundleFlip}
                    role="group"
                    aria-label="Chaise orientation"
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(['L', 'R'] as const).map((side) => (
                      <span
                        key={side}
                        role="button"
                        tabIndex={0}
                        aria-pressed={quickFlip === side}
                        className={`${styles.bundleFlipBtn} ${quickFlip === side ? styles.bundleFlipBtnActive : ''}`}
                        onClick={(e) => { e.stopPropagation(); onFlipChange(side); }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            onFlipChange(side);
                          }
                        }}
                      >
                        {side}
                      </span>
                    ))}
                  </span>
                )}
              </div>
              <div className={styles.bundleArt}>
                <img
                  src={bundleArtSrc(bundle.id, quickFlip)}
                  alt={`${bundle.label} plan view`}
                  loading="lazy"
                />
              </div>
              <div className={styles.bundleSig}>{bundle.signature}</div>
              <div className={styles.bundlePrice}>
                {inactive
                  ? <span className={styles.unavailable}>Not on this Model</span>
                  : <PriceTag amount={price} size="md" />}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
};
