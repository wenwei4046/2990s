import { Link } from 'react-router';
import { LogOut, Hourglass, ShoppingCart } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import { useAuth } from '../lib/auth';
import { useCatalog, useCatalogRealtime, type CatalogProduct } from '../lib/queries';
import { useCart, cartItemCount, cartSubtotal } from '../state/cart';
import styles from './Catalog.module.css';

export const Catalog = () => {
  const { user, signOut } = useAuth();
  const catalog = useCatalog();
  useCatalogRealtime();
  const lines = useCart((s) => s.lines);
  const count = cartItemCount(lines);
  const subtotal = cartSubtotal(lines);

  return (
    <main className={styles.app}>
      <header className={styles.header}>
        <div>
          <span className="t-eyebrow">POS · Showroom KL</span>
          <h1 className={styles.heading}>Catalog</h1>
        </div>
        <div className={styles.headerRight}>
          <Link to="/cart" className={styles.cartBadge} aria-label="Cart">
            <ShoppingCart size={18} strokeWidth={1.75} />
            <span>{count > 0 ? `${count} · ${fmtRM(subtotal)}` : 'Cart empty'}</span>
          </Link>
          <span className={styles.email}>{user?.email}</span>
          <IconButton
            icon={<LogOut size={20} strokeWidth={1.75} />}
            aria-label="Sign out"
            onClick={() => void signOut()}
          />
        </div>
      </header>

      {catalog.isLoading ? (
        <p className={styles.empty}>Loading catalog…</p>
      ) : catalog.error ? (
        <p className={styles.empty}>Failed to load: {String(catalog.error)}</p>
      ) : (catalog.data?.length ?? 0) === 0 ? (
        <p className={styles.empty}>
          No products yet. Ask your admin to seed the catalogue via the Backend SKU Master.
        </p>
      ) : (
        <div className={styles.grid}>
          {catalog.data!.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      )}

      <footer className={styles.footer}>
        <span className="t-caption">
          Phase 1 acceptance gate · Realtime subscription on <code>products</code> table.
          Edits in Backend SKU Master appear here within ~300ms.
        </span>
      </footer>
    </main>
  );
};

const ProductCard = ({ p }: { p: CatalogProduct }) => {
  const headlinePrice = (() => {
    if (p.pricing_kind === 'flat' && p.flat_price != null) return p.flat_price;
    return null; // sofa_build / size_variants need configurator; tbc has no price
  })();

  return (
    <article className={styles.card}>
      <div className={styles.cat}>{p.category?.label ?? p.pricing_kind}</div>
      <h2 className={styles.name}>{p.name}</h2>
      {p.detail && <p className={styles.detail}>{p.detail}</p>}
      <div className={styles.meta}>
        <code className={styles.sku}>{p.sku}</code>
        {p.size_display && <span className={styles.size}> · {p.size_display}</span>}
      </div>
      <div className={styles.priceRow}>
        {headlinePrice != null ? (
          <PriceTag amount={headlinePrice} size="md" />
        ) : p.pricing_kind === 'tbc' ? (
          <span className={styles.tbc}><Hourglass size={14} strokeWidth={1.75} /> Pricing TBC</span>
        ) : (
          <span className={styles.fromLabel}>
            {p.pricing_kind === 'sofa_build' ? 'Configurable · per build' : 'Configurable · by size'}
          </span>
        )}
        {p.pricing_kind === 'tbc' ? (
          <Button variant="ghost" size="sm" disabled>Configure</Button>
        ) : (
          <Link to={`/configure/${p.id}`} className={styles.configLink}>
            <Button variant="ghost" size="sm">Configure →</Button>
          </Link>
        )}
      </div>
      <div className={styles.stock}>
        Stock: <strong>{p.stock}</strong>{p.stock <= p.low_at && p.stock > 0 && <span className={styles.stockLow}> · low</span>}
        {p.stock === 0 && <span className={styles.stockOut}> · out</span>}
      </div>
    </article>
  );
};
