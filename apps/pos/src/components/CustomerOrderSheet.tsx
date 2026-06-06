import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import {
  X,
  UserRound,
  Plus,
  Minus,
  Trash2,
  BookmarkPlus,
  ArrowRight,
  ShoppingBag,
  Check,
  Pencil,
} from 'lucide-react';
import { useCart, cartItemCount, cartSubtotal, cartSummary, type CartLine } from '../state/cart';
import { useCatalog, type CatalogProduct, type MfgCatalogRow } from '../lib/queries';
import { cartLineTitle, useMfgCatalogIndex } from '../lib/cart-display';
import { useSaveQuote, useUpdateQuote } from '../lib/quotes';
import { useFreePwpCodes } from '../lib/products/pwp-queries';
import { CountryPhoneInput } from './CountryPhoneInput';
import styles from './CustomerOrderSheet.module.css';

interface Props {
  open: boolean;
  onClose: () => void;
}

const productInitial = (name: string): string =>
  name?.trim()?.charAt(0)?.toUpperCase() ?? '?';

const fmtMYR = (n: number): string =>
  n.toLocaleString('en-MY', { maximumFractionDigits: 0 });

export const CustomerOrderSheet = ({ open, onClose }: Props) => {
  const navigate = useNavigate();
  const lines = useCart((s) => s.lines);
  const remove = useCart((s) => s.remove);
  const setQty = useCart((s) => s.setQty);
  const clear = useCart((s) => s.clear);
  const sourceQuoteId = useCart((s) => s.sourceQuoteId);
  const itemCount = cartItemCount(lines);
  const subtotal = cartSubtotal(lines);

  const catalog = useCatalog();
  const productsById = useMemo<Map<string, CatalogProduct>>(() => {
    const m = new Map<string, CatalogProduct>();
    for (const p of catalog.data ?? []) m.set(p.id, p);
    return m;
  }, [catalog.data]);
  const mfgById = useMfgCatalogIndex();

  const saveQuote = useSaveQuote();
  const updateQuote = useUpdateQuote();
  const freePwp = useFreePwpCodes();

  // Abandon — free the cart's RESERVED PWP codes, then clear. Quote-save /
  // order-place KEEP / consume them, so they don't use this path.
  const clearAndFreePwp = () => {
    for (const l of lines) freePwp.mutate(l.key);
    clear();
  };
  const [savingQuote, setSavingQuote] = useState(false);
  const [quoteName, setQuoteName] = useState('');
  const [quotePhone, setQuotePhone] = useState('');
  const [savedConfirm, setSavedConfirm] = useState(false);
  const [savedAsUpdate, setSavedAsUpdate] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  // Esc closes the sheet. Body scroll locks while open so the catalog
  // behind doesn't scroll when the user swipes inside the sheet.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

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
      setSavedAsUpdate(false);
      setSavedConfirm(true);
      setTimeout(() => setSavedConfirm(false), 2400);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to save quote');
    }
  };

  // Save the current cart back into the loaded quote, then clear (the draft is
  // parked). "Continue add on" is the keep-cart-and-shop-more path instead.
  const handleUpdateQuote = async () => {
    if (!sourceQuoteId) return;
    setSaveErr(null);
    try {
      await updateQuote.mutateAsync({ id: sourceQuoteId, cart: lines, subtotal, total: subtotal });
      clear();
      setSavedAsUpdate(true);
      setSavedConfirm(true);
      setTimeout(() => setSavedConfirm(false), 2400);
    } catch (err) {
      setSaveErr(err instanceof Error ? err.message : 'Failed to update quote');
    }
  };

  const goToHandover = () => {
    onClose();
    navigate('/handover');
  };

  return (
    <div
      className={styles.backdrop}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Customer order"
    >
      <aside className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <header className={styles.head}>
          <div className={styles.titleRow}>
            <span className={styles.title}>Customer order</span>
            <span className={styles.count}>
              {itemCount} {itemCount === 1 ? 'piece' : 'pieces'}
            </span>
            <button
              type="button"
              className={styles.close}
              onClick={onClose}
              aria-label="Close"
            >
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
          <div className={styles.customer}>
            <UserRound size={14} strokeWidth={1.75} />
            <span className={styles.customerWalkin}>
              Walk-in customer · details captured at handover
            </span>
          </div>
        </header>

        {savedConfirm && (
          <div className={styles.savedBanner}>
            <Check size={16} strokeWidth={1.75} />
            {savedAsUpdate ? 'Quote updated.' : 'Quote saved.'} Open <Link to="/quotes" onClick={onClose}>Saved quotes</Link> to load it later.
          </div>
        )}

        <div className={styles.body}>
          {lines.length === 0 ? (
            <div className={styles.empty}>
              <ShoppingBag size={36} strokeWidth={1.5} />
              <h5 className={styles.emptyTitle}>Cart is empty</h5>
              <p className={styles.emptyHint}>
                Tap any piece on the catalog to add it. Same price, every time.
              </p>
            </div>
          ) : (
            lines.map((line) => (
              <CartItem
                key={line.key}
                line={line}
                product={productsById.get(line.config.productId)}
                mfgRow={mfgById.get(line.config.productId)}
                onRemove={() => remove(line.key)}
                onDec={() => setQty(line.key, line.qty - 1)}
                onInc={() => setQty(line.key, line.qty + 1)}
                onEdit={
                  line.config.kind !== 'flat'
                    ? () => { onClose(); navigate(`/configure/${line.config.productId}?edit=${line.key}`); }
                    : undefined
                }
              />
            ))
          )}
        </div>

        {savingQuote && (
          <section className={styles.quotePanel}>
            <h3 className={styles.quotePanelTitle}>
              <BookmarkPlus size={14} strokeWidth={1.75} />
              Save as quote
            </h3>
            <p className={styles.quotePanelHint}>
              Saves the cart so a colleague (or you later) can load it back.
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
                <CountryPhoneInput value={quotePhone} onChange={setQuotePhone} />
              </label>
            </div>
            {saveErr && <p className={styles.quoteErr}>{saveErr}</p>}
            <div className={styles.quoteActions}>
              <button
                type="button"
                className={styles.ghost}
                onClick={() => { setSavingQuote(false); setSaveErr(null); }}
                disabled={saveQuote.isPending}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.primary}
                onClick={submitSaveQuote}
                disabled={saveQuote.isPending || !quoteName.trim()}
              >
                {saveQuote.isPending ? 'Saving…' : 'Save quote'}
              </button>
            </div>
          </section>
        )}

        {lines.length > 0 && (
          <div className={styles.foot}>
            <div className={styles.line}>
              <span>Subtotal</span>
              <span>RM{fmtMYR(subtotal)}.00</span>
            </div>
            <div className={styles.line}>
              <span>Delivery</span>
              <span>Set at handover</span>
            </div>
            <div className={`${styles.line} ${styles.lineTotal}`}>
              <span>Total</span>
              <span className={styles.totalNum}>
                <sup>RM</sup>{fmtMYR(subtotal)}
              </span>
            </div>
            {saveErr && !savingQuote && <p className={styles.quoteErr}>{saveErr}</p>}
            <div className={styles.cta}>
              <button type="button" className={styles.ghost} onClick={clearAndFreePwp}>
                <Trash2 size={14} strokeWidth={1.75} />
                Clear
              </button>
              {!savingQuote && (
                sourceQuoteId ? (
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={handleUpdateQuote}
                    disabled={updateQuote.isPending}
                  >
                    <BookmarkPlus size={14} strokeWidth={1.75} />
                    {updateQuote.isPending ? 'Updating…' : 'Update Quote'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className={styles.ghost}
                    onClick={() => setSavingQuote(true)}
                  >
                    <BookmarkPlus size={14} strokeWidth={1.75} />
                    Save Quote
                  </button>
                )
              )}
              <button
                type="button"
                className={styles.primary}
                onClick={goToHandover}
              >
                Convert to Sales Order
                <ArrowRight size={16} strokeWidth={1.75} />
              </button>
            </div>
          </div>
        )}
      </aside>
    </div>
  );
};

interface CartItemProps {
  line: CartLine;
  product: CatalogProduct | undefined;
  /** mfg catalog row for mfg- product ids — Model photo + clean title source. */
  mfgRow: MfgCatalogRow | undefined;
  onRemove: () => void;
  onDec: () => void;
  onInc: () => void;
  /** Re-open the configurator pre-filled to edit this line. Omitted for flat
   *  products (no options to change). */
  onEdit?: () => void;
}

const CartItem = ({ line, product, mfgRow, onRemove, onDec, onInc, onEdit }: CartItemProps) => {
  const photo = mfgRow?.photoUrl ?? product?.thumb_key ?? product?.img_key ?? null;
  const title = cartLineTitle(line.config, mfgRow);
  const lineTotal = line.qty * line.config.total;
  return (
    <div className={styles.item}>
      <div
        className={styles.itemPhoto}
        style={photo ? { backgroundImage: `url(${photo})` } : undefined}
        aria-hidden="true"
      >
        {!photo && productInitial(title)}
      </div>
      <div className={styles.itemMain}>
        <div className={styles.itemNameRow}>
          <span className={styles.itemName}>{title}</span>
        </div>
        <div className={styles.itemDetail}>{cartSummary(line.config)}</div>
        <div className={styles.itemQty}>
          <button type="button" onClick={onDec} aria-label="Decrease">
            <Minus size={12} strokeWidth={2} />
          </button>
          <span>{line.qty}</span>
          <button type="button" onClick={onInc} aria-label="Increase">
            <Plus size={12} strokeWidth={2} />
          </button>
        </div>
      </div>
      <div className={styles.itemRight}>
        <div className={styles.itemActions}>
          {onEdit && (
            <button
              type="button"
              className={styles.itemEdit}
              onClick={onEdit}
              aria-label="Edit"
            >
              <Pencil size={14} strokeWidth={1.75} />
            </button>
          )}
          <button
            type="button"
            className={styles.itemRemove}
            onClick={onRemove}
            aria-label="Remove"
          >
            <X size={14} strokeWidth={1.75} />
          </button>
        </div>
        <span className={styles.itemPrice}>
          <sup>RM</sup>{fmtMYR(lineTotal)}
        </span>
      </div>
    </div>
  );
};
