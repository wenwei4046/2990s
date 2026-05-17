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
import { useCart, cartSummary } from '../state/cart';
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
  const restore = useCart((s) => s.restore);

  const loadQuote = (q: QuoteRow) => {
    if (!q.cart || q.cart.length === 0) return;
    restore(q.cart);
    // Mark the quote as deleted (simple "consumed" flow). Coordinators still
    // see it via audit if we add a 'converted' status flow later.
    del.mutate(q.id);
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
                    <span className={styles.lineName}>{l.config.productName}</span>
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
                  <sup>RM</sup>{q.total.toLocaleString('en-MY')}
                </span>
              </div>

              <div className={styles.actions}>
                <button
                  type="button"
                  className={`${styles.actionBtn} ${styles.actionBtnGhost}`}
                  onClick={() => {
                    if (!confirm(`Delete quote for ${q.customer_name}?`)) return;
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
      )}
    </main>
    </>
  );
};
