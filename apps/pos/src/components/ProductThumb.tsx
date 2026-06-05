import { useCatalog, useMfgCatalog } from '../lib/queries';
import styles from './ProductThumb.module.css';

const initialOf = (name: string): string =>
  name?.trim()?.charAt(0)?.toUpperCase() || '?';

/**
 * Product photo thumbnail for cart lines + the order summary. Resolves the
 * live catalog photo by productId (single source of truth — same image the
 * catalog card shows, and it works for items already sitting in the cart).
 * Cart lines store `productId` = an mfg_products.id (`mfg-<hex>`), whose hero
 * photo lives on the Model (product_models.photo_url, surfaced by
 * useMfgCatalog — already resolved against VITE_API_URL). Legacy UUID lines
 * keep the retail-catalog path, preferring the smaller `thumb_key` over the
 * hero `img_key`. Falls back to the product's initial on the warm placeholder
 * while the catalog loads or when a product has no photo — matching
 * CustomerOrderSheet's treatment.
 *
 * Sizing is owned by the caller via `className` (e.g. 40×40 in the summary,
 * 56×56 on the cart page); this component only paints the photo + fallback.
 */
export const ProductThumb = ({ productId, name, className }: {
  productId: string;
  name: string;
  className?: string;
}) => {
  const catalog = useCatalog();
  const mfg = useMfgCatalog();
  let photo: string | null;
  if (productId.startsWith('mfg-')) {
    photo = (mfg.data ?? []).find((r) => r.id === productId)?.photoUrl ?? null;
  } else {
    const product = (catalog.data ?? []).find((p) => p.id === productId);
    photo = product?.thumb_key ?? product?.img_key ?? null;
  }
  return (
    <div
      className={`${styles.thumb}${className ? ` ${className}` : ''}`}
      style={photo ? { backgroundImage: `url(${photo})` } : undefined}
      aria-hidden="true"
    >
      {!photo && <span className={styles.fallback}>{initialOf(name)}</span>}
    </div>
  );
};
