import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Trash2, BookmarkPlus, Check } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM } from '@2990s/shared';
import { useCart, cartSubtotal, type CartLine } from '../state/cart';
import { useSaveQuote } from '../lib/quotes';
import { Topbar } from '../components/Topbar';
import styles from './Cart.module.css';

export const Cart = () => {
  const navigate = useNavigate();
  const lines = useCart((s) => s.lines);
  const remove = useCart((s) => s.remove);
  const setQty = useCart((s) => s.setQty);
  const clear = useCart((s) => s.clear);
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

  return (
    <>
    <Topbar step="cart" />
    <main className={styles.shell}>
      <header className={styles.header}>
        <IconButton
          icon={<ArrowLeft size={20} strokeWidth={1.75} />}
          aria-label="Back"
          onClick={() => navigate('/catalog')}
        />
        <h1 className={styles.heading}>Cart</h1>
      </header>

      {savedConfirm && (
        <div className={styles.savedBanner}>
          <Check size={16} strokeWidth={1.75} />
          Quote saved. Open <Link to="/quotes">Saved quotes</Link> to load it later.
        </div>
      )}

      {lines.length === 0 ? (
        <div className={styles.empty}>
          <p>Cart is empty.</p>
          <Link to="/catalog"><Button variant="primary">Browse catalog</Button></Link>
        </div>
      ) : (
        <>
          <ul className={styles.list}>
            {lines.map((l) => <Line key={l.key} line={l} onRemove={remove} onSetQty={setQty} />)}
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
                  onClick={() => {
                    setSavingQuote(false);
                    setSaveErr(null);
                  }}
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
              <PriceTag amount={subtotal} size="lg" />
            </div>
            <div className={styles.actions}>
              <Button variant="ghost" onClick={clear}>Clear</Button>
              {!savingQuote && (
                <Button
                  variant="ghost"
                  onClick={() => setSavingQuote(true)}
                  disabled={lines.length === 0}
                >
                  <BookmarkPlus size={14} strokeWidth={1.75} />
                  Save quote
                </Button>
              )}
              <Button variant="primary" onClick={() => navigate('/handover')}>
                Continue to handover
              </Button>
            </div>
          </footer>
        </>
      )}
    </main>
    </>
  );
};

const Line = ({ line, onRemove, onSetQty }: {
  line: CartLine;
  onRemove: (k: string) => void;
  onSetQty: (k: string, q: number) => void;
}) => (
  <li className={styles.line}>
    <div className={styles.lineMain}>
      <div className={styles.lineName}>{line.config.productName}</div>
      <div className={styles.lineSummary}>{line.config.summary}</div>
    </div>
    <div className={styles.qtyBox}>
      <button type="button" className={styles.qtyBtn} onClick={() => onSetQty(line.key, line.qty - 1)} aria-label="Decrease quantity">−</button>
      <span className={styles.qty}>{line.qty}</span>
      <button type="button" className={styles.qtyBtn} onClick={() => onSetQty(line.key, line.qty + 1)} aria-label="Increase quantity">+</button>
    </div>
    <div className={styles.lineTotal}>{fmtRM(line.qty * line.config.total)}</div>
    <IconButton
      icon={<Trash2 size={18} strokeWidth={1.75} />}
      aria-label="Remove line"
      onClick={() => onRemove(line.key)}
    />
  </li>
);
