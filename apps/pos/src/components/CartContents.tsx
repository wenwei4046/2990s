import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Trash2, BookmarkPlus, Check, Pencil, Plus } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import { useCart, cartSubtotal, cartSummary, type CartLine } from '../state/cart';
import { useSaveQuote } from '../lib/quotes';
import { ProductThumb } from './ProductThumb';
import styles from './CartContents.module.css';

export type CartContentsVariant = 'page' | 'rail';

interface Props {
  variant: CartContentsVariant;
  onContinue: () => void;
}

export const CartContents = ({ variant, onContinue }: Props) => {
  const navigate = useNavigate();
  const lines = useCart((s) => s.lines);
  const remove = useCart((s) => s.remove);
  const setQty = useCart((s) => s.setQty);
  const clear = useCart((s) => s.clear);
  const sourceQuoteId = useCart((s) => s.sourceQuoteId);
  const subtotal = cartSubtotal(lines);
  const saveQuote = useSaveQuote();

  const [savingQuote, setSavingQuote] = useState(false);
  const [quoteName, setQuoteName] = useState('');
  const [quotePhone, setQuotePhone] = useState('');
  const [savedConfirm, setSavedConfirm] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const submitSaveQuote = async () => {
    if (!quoteName.trim()) {
      setSaveErr('Customer name is required');
      return;
    }
    setSaveErr(null);
    try {
      await saveQuote.mutateAsync({
        customerName: quoteName.trim(),
        customerPhone: quotePhone.trim() || undefined,
        cart: lines,
        subtotal,
        total: subtotal,
      });
      clear();
      setSavingQuote(false);
      setQuoteName('');
      setQuotePhone('');
      setSavedConfirm(true);
      setTimeout(() => setSavedConfirm(false), 2400);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to save quote');
    }
  };

  if (lines.length === 0) {
    return (
      <div className={styles.empty}>
        <p>Cart is empty.</p>
        {variant === 'page' && (
          <Link to="/catalog"><Button variant="primary">Browse catalog</Button></Link>
        )}
      </div>
    );
  }

  return (
    <div className={`${styles.container} ${variant === 'rail' ? styles.rail : styles.page}`}>
      {savedConfirm && (
        <div className={styles.savedBanner}>
          <Check size={16} strokeWidth={1.75} />
          Quote saved. Open <Link to="/quotes">Saved quotes</Link> to load it later.
        </div>
      )}

      <ul className={styles.list}>
        {lines.map((l) => (
          <Line
            key={l.key}
            line={l}
            variant={variant}
            onRemove={remove}
            onSetQty={setQty}
            onEdit={
              variant === 'page' && l.config.kind !== 'flat'
                ? () => navigate(`/configure/${l.config.productId}?edit=${l.key}`)
                : undefined
            }
          />
        ))}
      </ul>

      {savingQuote && (
        <section className={styles.quotePanel}>
          <h3 className={styles.quotePanelTitle}>
            <BookmarkPlus size={14} strokeWidth={1.75} />
            Save as quote
          </h3>
          <p className={styles.quotePanelHint}>
            Saves the cart so a sales colleague (or you later) can load it back.
          </p>
          <div className={styles.quoteFields}>
            <label className={styles.quoteField}>
              <span>Customer name *</span>
              <input
                type="text"
                value={quoteName}
                onChange={(e) => setQuoteName(e.target.value)}
                autoFocus
              />
            </label>
            <label className={styles.quoteField}>
              <span>Phone (optional)</span>
              <input
                type="tel"
                value={quotePhone}
                onChange={(e) => setQuotePhone(e.target.value)}
              />
            </label>
          </div>
          {saveErr && <p className={styles.quoteErr}>{saveErr}</p>}
          <div className={styles.quoteActions}>
            <Button
              variant="ghost"
              onClick={() => { setSavingQuote(false); setSaveErr(null); }}
              disabled={saveQuote.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={submitSaveQuote}
              disabled={saveQuote.isPending || !quoteName.trim()}
            >
              {saveQuote.isPending ? 'Saving…' : 'Save quote'}
            </Button>
          </div>
        </section>
      )}

      <footer className={styles.footer}>
        <div className={styles.subtotalRow}>
          <span className="t-eyebrow">Subtotal</span>
          <PriceTag amount={subtotal} size={variant === 'rail' ? 'md' : 'lg'} />
        </div>
        <div className={styles.actions}>
          <Button variant="secondary" onClick={clear}>Clear</Button>
          {!savingQuote && variant === 'page' && (
            sourceQuoteId ? (
              // Loaded from a quote: keep the cart and go back to the catalog
              // to add more. (Saving back to the quote lives in the cart sheet.)
              <Button variant="secondary" onClick={() => navigate('/catalog')}>
                <Plus size={14} strokeWidth={1.75} />
                Continue add on
              </Button>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setSavingQuote(true)}
                disabled={lines.length === 0}
              >
                <BookmarkPlus size={14} strokeWidth={1.75} />
                Save quote
              </Button>
            )
          )}
          <Button variant="primary" onClick={onContinue}>
            Continue to handover
          </Button>
        </div>
      </footer>
    </div>
  );
};

const Line = ({ line, variant, onRemove, onSetQty, onEdit }: {
  line: CartLine;
  variant: CartContentsVariant;
  onRemove: (k: string) => void;
  onSetQty: (k: string, q: number) => void;
  onEdit?: () => void;
}) => (
  <li className={`${styles.line} ${variant === 'rail' ? styles.lineRail : ''}`}>
    <ProductThumb
      className={styles.linePhoto}
      productId={line.config.productId}
      name={line.config.productName}
    />
    <div className={styles.lineMain}>
      <div className={styles.lineName}>{line.config.productName}</div>
      <div className={styles.lineSummary}>{cartSummary(line.config)}</div>
      {'pwp' in line.config && line.config.pwp && (
        <div className={styles.lineSummary}>
          PWP price{'pwpTriggerLabel' in line.config && line.config.pwpTriggerLabel ? ` · 换购自 ${line.config.pwpTriggerLabel}` : ''}
        </div>
      )}
    </div>
    <div className={styles.qtyBox}>
      <button
        type="button"
        className={styles.qtyBtn}
        onClick={() => onSetQty(line.key, line.qty - 1)}
        aria-label="Decrease quantity"
      >−</button>
      <span className={styles.qty}>{line.qty}</span>
      <button
        type="button"
        className={styles.qtyBtn}
        onClick={() => onSetQty(line.key, line.qty + 1)}
        aria-label="Increase quantity"
      >+</button>
    </div>
    <div className={styles.lineTotal}>{fmtRM(line.qty * line.config.total)}</div>
    <div className={styles.lineActions}>
      {onEdit && (
        <IconButton
          icon={<Pencil size={16} strokeWidth={1.75} />}
          aria-label="Edit line"
          onClick={onEdit}
        />
      )}
      <IconButton
        icon={<Trash2 size={18} strokeWidth={1.75} />}
        aria-label="Remove line"
        onClick={() => onRemove(line.key)}
      />
    </div>
  </li>
);
