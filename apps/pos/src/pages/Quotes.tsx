import { useNavigate, Link } from 'react-router';
import {
  ArrowLeft,
  Trash2,
  ShoppingCart,
  Calendar,
  Phone,
  Inbox,
} from 'lucide-react';
import { Button, IconButton } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import { useQuotes, useDeleteQuote, type QuoteRow } from '../lib/quotes';
import { useFreePwpCodes } from '../lib/products/pwp-queries';
import { useCart, cartSummary } from '../state/cart';
import { cartLineTitle, useMfgCatalogIndex } from '../lib/cart-display';
import { Topbar } from '../components/Topbar';
import styles from './Quotes.module.css';

const fmtAgo = (iso: string): string => {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
};

export const Quotes = () => {
  const navigate = useNavigate();
  const list = useQuotes();
  const del = useDeleteQuote();
  const freePwp = useFreePwpCodes();
  const restore = useCart((s) => s.restore);
  // One index for every quote card's line previews — same derived title the
  // cart / handover show for the identical CartLine (cart-display.ts).
  const mfgById = useMfgCatalogIndex();

  const loadQuote = (q: QuoteRow) => {
    if (!q.cart || q.cart.length === 0) return;
    // Load into the cart and REMEMBER the source quote — do NOT delete it here.
    // The quote is consumed only when the order is confirmed (Handover submit),
    // so reviewing/loading a draft never destroys it. Explicit Delete still removes it.
    restore(q.cart, q.id);
    navigate('/cart');
  };

  return (
    <>
    <Topbar step="cart" />
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link to="/catalog">
          <IconButton
            icon={<ArrowLeft size={20} strokeWidth={1.75} />}
            aria-label="Back to catalog"
          />
        </Link>
        <div>
          <span className="t-eyebrow">Sales drafts</span>
          <h1 className={styles.heading}>Saved quotes</h1>
        </div>
      </header>

      {list.isLoading ? (
        <p className={styles.empty}>Loading quotes…</p>
      ) : list.error ? (
        <p className={styles.empty}>Failed to load: {String(list.error)}</p>
      ) : (list.data?.length ?? 0) === 0 ? (
        <div className={styles.empty}>
          <Inbox size={32} strokeWidth={1.5} />
          <p>No saved quotes yet.</p>
          <p className={styles.emptyHint}>
            Click <strong>Save quote</strong> in the cart to draft one for later.
          </p>
          <Link to="/catalog">
            <Button variant="primary">Back to catalog</Button>
          </Link>
        </div>
      ) : (
        <>
        <div className={styles.grid}>
          {list.data!.map((q) => (
            <article key={q.id} className={styles.card}>
              <div className={styles.cardHead}>
                <div className={styles.customer}>{q.customer_name}</div>
                <span className={styles.when}>{fmtAgo(q.created_at)}</span>
              </div>
              {q.customer_phone && (
                <div className={styles.phone}>
                  <Phone size={11} strokeWidth={1.75} />
                  {q.customer_phone}
                </div>
              )}

              <ul className={styles.lines}>
                {q.cart.slice(0, 3).map((l, i) => (
                  <li key={`${q.id}-${i}`}>
                    <span className={styles.lineName}>{cartLineTitle(l.config, mfgById.get(l.config.productId))}</span>
                    <span className={styles.lineSummary}>{cartSummary(l.config)}</span>
                    <span className={styles.lineQty}>× {l.qty}</span>
                  </li>
                ))}
                {q.cart.length > 3 && (
                  <li className={styles.linesMore}>
                    + {q.cart.length - 3} more
                  </li>
                )}
              </ul>

              <div className={styles.totalRow}>
                <Calendar size={11} strokeWidth={1.75} />
                <span className={styles.totalLabel}>
                  {q.cart.length} {q.cart.length === 1 ? 'piece' : 'pieces'}
                </span>
                <span className={styles.total}>
                  <span className={styles.totalUnit}>RM</span>{q.total.toLocaleString('en-MY')}
                </span>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionBtnGhost}`}
                  onClick={() => {
                    if (!confirm(`Delete quote for ${q.customer_name}?`)) return;
                    // Free any RESERVED PWP codes this quote's trigger lines held
                    // (§8.5c) — deleting a quote releases the occupied numbers.
                    for (const l of q.cart ?? []) freePwp.mutate(l.key);
                    del.mutate(q.id);
                  }}
                  disabled={del.isPending}
                >
                  <Trash2 size={14} strokeWidth={1.75} />
                  Delete
                </button>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionBtnPrimary}`}
                  onClick={() => loadQuote(q)}
                  disabled={del.isPending}
                >
                  <ShoppingCart size={14} strokeWidth={1.75} />
                  Load to cart
                </button>
              </div>
            </article>
          ))}
        </div>
        <div className={styles.backRow}>
          <Link to="/catalog">
            <Button variant="secondary">
              <ArrowLeft size={16} strokeWidth={1.75} />
              Back to catalog
            </Button>
          </Link>
        </div>
        </>
      )}
    </main>
    </>
  );
};
