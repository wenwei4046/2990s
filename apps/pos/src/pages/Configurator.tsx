import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Hourglass, X } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM, BUNDLES, type BundleDef, type SofaProductPricing } from '@2990s/shared';
import {
  useProduct,
  useProductBundles,
  useProductCompartments,
  useProductSizes,
  useSizeLibrary,
  useProductPricingRealtime,
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
  const [mode, setMode] = useState<'quick' | 'custom'>('quick');

  const sizes = useProductSizes(productId);
  const sizeLib = useSizeLibrary();
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
  const sizeTotal = pickedSize?.price ?? 0;
  const canAddSize = pickedSize != null && pickedSize.active && pickedSize.price != null;

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
    const snapshot: SizeConfigSnapshot = {
      kind: 'size',
      productId: p.id,
      productName: p.name,
      sizeId: pickedSize.id,
      total: pickedSize.price,
      summary: pickedSize.label,
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

  return (
    <>
    <Topbar step="cart" rightSlot={sizeTopbarSlot} />
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
              productId={p.id}
              productName={p.name}
              bundles={bundles.data ?? []}
              isLoading={bundles.isLoading}
              picked={picked}
              onPick={setPicked}
              onAdded={() => navigate('/catalog')}
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
// vertical (taller dimension on most mattresses).
const FootprintPreview = ({ widthCm, lengthCm, label }: FootprintPreviewProps) => {
  const maxW = 320;
  const maxH = 360;
  const scale = Math.min(maxW / widthCm, maxH / lengthCm);
  const pxW = Math.round(widthCm * scale);
  const pxH = Math.round(lengthCm * scale);

  return (
    <div className={styles.fpWrap}>
      <div className={styles.fpDimTop}>{widthCm} cm</div>
      <div className={styles.fpStage}>
        <div className={styles.fpDimSide}>{lengthCm}<br />cm</div>
        <div className={styles.fpRect} style={{ width: pxW, height: pxH }} />
      </div>
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
  productId: string;
  productName: string;
  bundles: { bundleId: string; active: boolean; price: number }[];
  isLoading: boolean;
  picked: string | null;
  onPick: (id: string) => void;
  onAdded: () => void;
}

const SofaQuickPick = ({ productId, productName, bundles, isLoading, picked, onPick, onAdded }: SofaQuickPickProps) => {
  const addConfigured = useCart((s) => s.addConfigured);
  if (isLoading) return <p className={styles.empty}>Loading bundles…</p>;

  // Render every bundle the catalog defines, but ones inactive for this Model
  // are dimmed + non-clickable (gives staff "this Model doesn't ship that" UX).
  const rows: { bundle: BundleDef; price: number | null; active: boolean }[] = BUNDLES.map((b) => {
    const row = bundles.find((r) => r.bundleId === b.id);
    return {
      bundle: b,
      price: row?.price ?? null,
      active: row?.active ?? false,
    };
  });

  const pickedRow = rows.find((r) => r.bundle.id === picked);
  const canAdd = pickedRow != null && pickedRow.active && pickedRow.price != null;

  const handleAdd = () => {
    if (!canAdd || pickedRow == null || pickedRow.price == null) return;
    const snapshot: SofaConfigSnapshot = {
      kind: 'sofa',
      productId,
      productName,
      bundleId: pickedRow.bundle.id,
      total: pickedRow.price,
      summary: `${pickedRow.bundle.id} · ${pickedRow.bundle.label}`,
    };
    addConfigured(snapshot);
    onAdded();
  };

  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Quick-Pick bundles</h2>
        <p className="t-body fg-muted">
          5 pre-built configurations · price per this Model's rules. Custom build coming Phase 2 step B.
        </p>
      </header>
      <div className={styles.grid}>
        {rows.map(({ bundle, price, active }) => {
          const isPicked = picked === bundle.id;
          const inactive = !active || price == null;
          return (
            <button
              key={bundle.id}
              type="button"
              className={`${styles.card} ${isPicked ? styles.cardPicked : ''} ${inactive ? styles.cardInactive : ''}`}
              disabled={inactive}
              onClick={() => onPick(bundle.id)}
            >
              <div className={styles.cardHead}>
                <code className={styles.cardCode}>{bundle.id}</code>
                <span className={styles.cardLabel}>{bundle.label}</span>
              </div>
              <div className={styles.cardSig}>{bundle.signature}</div>
              <div className={styles.cardPrice}>
                {inactive
                  ? <span className={styles.unavailable}>Not on this Model</span>
                  : <PriceTag amount={price} size="lg" />}
              </div>
            </button>
          );
        })}
      </div>
      <div className={styles.actions}>
        <Button variant="primary" disabled={!canAdd} onClick={handleAdd}>
          {canAdd
            ? `Add ${pickedRow!.bundle.label} to cart`
            : picked
              ? 'Bundle not on this Model'
              : 'Pick a bundle to continue'}
        </Button>
      </div>
    </section>
  );
};
