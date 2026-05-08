import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Hourglass, Package } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { BUNDLES, type BundleDef } from '@2990s/shared';
import {
  useProduct,
  useProductBundles,
  useProductPricingRealtime,
} from '../lib/queries';
import styles from './Configurator.module.css';

export const Configurator = () => {
  const { productId } = useParams<{ productId: string }>();
  const navigate = useNavigate();
  const product = useProduct(productId);
  const bundles = useProductBundles(productId);
  useProductPricingRealtime(productId);

  const [picked, setPicked] = useState<string | null>(null);

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
        <SofaQuickPick
          productId={p.id}
          bundles={bundles.data ?? []}
          isLoading={bundles.isLoading}
          picked={picked}
          onPick={setPicked}
        />
      )}

      {isSize && (
        <p className={styles.tbcCard}>
          <Hourglass size={16} strokeWidth={1.75} />
          Size-variant configurator lands in Phase 2 step C — pick a size + pillows + addons.
        </p>
      )}

      {p.pricing_kind === 'flat' && p.flat_price != null && (
        <div className={styles.flatCard}>
          <span className="t-eyebrow">Flat price</span>
          <PriceTag amount={p.flat_price} size="lg" />
          <Button variant="primary" disabled>
            Add to cart (Phase 2 step C)
          </Button>
        </div>
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

interface SofaQuickPickProps {
  productId: string;
  bundles: { bundleId: string; active: boolean; price: number }[];
  isLoading: boolean;
  picked: string | null;
  onPick: (id: string) => void;
}

const SofaQuickPick = ({ bundles, isLoading, picked, onPick }: SofaQuickPickProps) => {
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
        <Button variant="primary" disabled={!picked}>
          {picked
            ? `Add ${picked} to cart (Phase 2 step C)`
            : 'Pick a bundle to continue'}
        </Button>
      </div>
    </section>
  );
};
