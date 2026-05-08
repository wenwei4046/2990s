import { useState } from 'react';
import { Plus, Pencil, Eye, EyeOff, Hourglass } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
import { useCategories, useProducts, type ProductRow } from '../lib/queries';
import { SkuDrawer } from '../components/SkuDrawer';
import styles from './SkuMaster.module.css';

type DrawerState =
  | { open: false }
  | { open: true; mode: 'create'; product: null }
  | { open: true; mode: 'edit'; product: ProductRow };

const fmtMoney = (n: number | null) => (n == null ? '—' : `RM ${n.toLocaleString('en-MY')}`);

export const SkuMaster = () => {
  const { staff } = useAuth();
  const products = useProducts();
  const cats = useCategories();
  const [drawer, setDrawer] = useState<DrawerState>({ open: false });

  const isAdmin = staff?.role === 'admin';
  const catLabel = (id: string) => cats.data?.find((c) => c.id === id)?.label ?? id;

  const priceRangeLabel = (p: ProductRow): string => {
    if (p.pricingKind === 'flat' && p.flatPrice != null) return fmtMoney(p.flatPrice);
    if (p.pricingKind === 'tbc') return 'TBC';
    if (p.pricingKind === 'sofa_build') return 'per build';
    if (p.pricingKind === 'size_variants') return 'by size';
    return '—';
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className="t-eyebrow">Pricing rules · per SKU</div>
          <h2 className={styles.title}>SKU Master</h2>
          <p className={`t-body fg-muted ${styles.lede}`}>
            Mattress &amp; bedframe priced by size · Sofa priced by build (compartments + bundles, per Model).
            Toggle off any variant that doesn't apply to a specific Model.
          </p>
        </div>
        {isAdmin && (
          <Button
            variant="primary"
            size="lg"
            onClick={() => setDrawer({ open: true, mode: 'create', product: null })}
          >
            <Plus size={16} strokeWidth={1.75} />
            New SKU
          </Button>
        )}
      </header>

      {!isAdmin && (
        <div className={styles.readOnlyBanner}>
          <strong>Read-only view.</strong> Catalogue editing is admin-only. Ask Loo for access if you need to add or change a SKU.
        </div>
      )}

      <div className={styles.tableCard}>
        {products.isLoading ? (
          <div className={styles.empty}>Loading products…</div>
        ) : products.error ? (
          <div className={styles.empty}>Failed to load products: {String(products.error)}</div>
        ) : (products.data?.length ?? 0) === 0 ? (
          <EmptyState isAdmin={isAdmin} onNew={() => setDrawer({ open: true, mode: 'create', product: null })} />
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Product</th>
                <th>SKU</th>
                <th>Category</th>
                <th>Stock</th>
                <th>Pricing</th>
                <th>Visible</th>
                {isAdmin && <th aria-label="actions" />}
              </tr>
            </thead>
            <tbody>
              {products.data!.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className={styles.productCell}>
                      <span className={styles.productName}>{p.name}</span>
                      {p.detail && <span className={styles.productDetail}>{p.detail}</span>}
                    </div>
                  </td>
                  <td><code className={styles.sku}>{p.sku}</code></td>
                  <td>{catLabel(p.categoryId)}</td>
                  <td>
                    <span className={p.stock <= p.lowAt ? styles.stockLow : ''}>{p.stock}</span>
                    <span className={styles.stockUnit}> / {p.lowAt} alert</span>
                  </td>
                  <td>
                    {p.pricingKind === 'tbc' ? (
                      <span className={styles.tbcPill}><Hourglass size={11} strokeWidth={1.75} /> TBC</span>
                    ) : (
                      <span className={styles.priceLabel}>{priceRangeLabel(p)}</span>
                    )}
                  </td>
                  <td>
                    {p.visible
                      ? <span className={styles.visYes}><Eye size={14} strokeWidth={1.75} /> Live</span>
                      : <span className={styles.visNo}><EyeOff size={14} strokeWidth={1.75} /> Hidden</span>}
                  </td>
                  {isAdmin && (
                    <td>
                      <button
                        type="button"
                        className={styles.editBtn}
                        onClick={() => setDrawer({ open: true, mode: 'edit', product: p })}
                        aria-label={`Edit ${p.sku}`}
                      >
                        <Pencil size={16} strokeWidth={1.75} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drawer.open && (
        <SkuDrawer
          mode={drawer.mode}
          product={drawer.mode === 'edit' ? drawer.product : null}
          onClose={() => setDrawer({ open: false })}
        />
      )}
    </div>
  );
};

const EmptyState = ({ isAdmin, onNew }: { isAdmin: boolean; onNew: () => void }) => (
  <div className={styles.empty}>
    <h3 className={styles.emptyTitle}>No SKUs yet</h3>
    <p className="t-body fg-muted">
      Production starts with an empty catalogue (per PORT_DESIGN.md §10 Decision 10).
      {isAdmin
        ? ' Click New SKU to seed the first product.'
        : ' An admin needs to seed the catalogue before sales can sell.'}
    </p>
    {isAdmin && (
      <Button variant="primary" onClick={onNew}>
        <Plus size={16} strokeWidth={1.75} />
        New SKU
      </Button>
    )}
  </div>
);
