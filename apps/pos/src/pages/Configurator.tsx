import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Hourglass } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { BUNDLES, type BundleDef, type SofaProductPricing } from '@2990s/shared';
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
import styles from './Configurator.module.css';

export const Configurator = () => {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const product = useProduct(productId);
  const bundles = useProductBundles(productId);
  const compartments = useProductCompartments(productId);
  useProductPricingRealtime(productId);

  const [picked, setPicked] = useState<string | null>(null);
  const [mode, setMode] = useState<'quick' | 'custom'>('quick');

  // Build the SofaProductPricing struct that the shared pure functions expect.
  const sofaPricing = useMemo<SofaProductPricing>(() => ({
    compartments: compartments.data ?? [],
    bundles: bundles.data ?? [],
    reclinerUpgradePrice: product.data?.recliner_upgrade_price ?? 0,
  }), [compartments.data, bundles.data, product.data?.recliner_upgrade_price]);

  if (product.isLoading) return <p className={styles.empty}>Loading product…</p>;
  if (product.error || !product.data) {
    return (
      <main className={styles.shell}>
        <p className={styles.empty}>
          Product not found. <Link to="/catalog">← Back to catalog</Link>
        </p>
      </main>
    );
  }

  const p = product.data;
  const isSofa = p.pricing_kind === 'sofa_build';
  const isSize = p.pricing_kind === 'size_variants';

  return (
    <main className={styles.shell}>
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
        <SizeConfigurator
          productId={p.id}
          productName={p.name}
          onAdded={() => navigate('/catalog')}
        />
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
  );
};

interface SizeConfiguratorProps {
  productId: string;
  productName: string;
  onAdded: () => void;
}

const SizeConfigurator = ({ productId, productName, onAdded }: SizeConfiguratorProps) => {
  const sizes = useProductSizes(productId);
  const library = useSizeLibrary();
  const addConfigured = useCart((s) => s.addConfigured);
  const [pickedSizeId, setPickedSizeId] = useState<string | null>(null);

  // Render every size from the library so staff see a stable grid (4 mattress
  // sizes today). Inactive sizes for this Model are dimmed + non-clickable —
  // same UX pattern as SofaQuickPick.
  const rows = useMemo(() => {
    const lib = library.data ?? [];
    const variants = sizes.data ?? [];
    // Mattress/bedframe sizes only (sort_order < 100). The s-24/28/30 rows
    // are sofa-depth pseudo-sizes that don't belong on a size variant grid.
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
  }, [library.data, sizes.data]);

  const pickedRow = rows.find((r) => r.id === pickedSizeId);
  const canAdd = pickedRow != null && pickedRow.active && pickedRow.price != null;

  const handleAdd = () => {
    if (!canAdd || pickedRow == null || pickedRow.price == null) return;
    const snapshot: SizeConfigSnapshot = {
      kind: 'size',
      productId,
      productName,
      sizeId: pickedRow.id,
      total: pickedRow.price,
      summary: pickedRow.label,
    };
    addConfigured(snapshot);
    onAdded();
  };

  if (sizes.isLoading || library.isLoading) {
    return <p className={styles.empty}>Loading sizes…</p>;
  }

  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h2 className={styles.sectionTitle}>Pick a size</h2>
        <p className="t-body fg-muted">
          Per-Model pricing · pillows + addons land later.
        </p>
      </header>
      <div className={styles.grid}>
        {rows.map(({ id, label, widthCm, lengthCm, price, active }) => {
          const isPicked = pickedSizeId === id;
          const inactive = !active || price == null;
          return (
            <button
              key={id}
              type="button"
              className={`${styles.card} ${isPicked ? styles.cardPicked : ''} ${inactive ? styles.cardInactive : ''}`}
              disabled={inactive}
              onClick={() => setPickedSizeId(id)}
            >
              <div className={styles.cardHead}>
                <code className={styles.cardCode}>{id}</code>
                <span className={styles.cardLabel}>{label}</span>
              </div>
              <div className={styles.cardSig}>{widthCm}×{lengthCm} cm</div>
              <div className={styles.cardPrice}>
                {inactive
                  ? <span className={styles.unavailable}>Not on this Model</span>
                  : <PriceTag amount={price!} size="lg" />}
              </div>
            </button>
          );
        })}
      </div>
      <div className={styles.actions}>
        <Button variant="primary" disabled={!canAdd} onClick={handleAdd}>
          {canAdd
            ? `Add ${pickedRow!.label} to cart`
            : pickedSizeId
              ? 'Size not on this Model'
              : 'Pick a size to continue'}
        </Button>
      </div>
    </section>
  );
};

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
