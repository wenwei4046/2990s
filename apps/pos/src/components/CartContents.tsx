import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Trash2, BookmarkPlus, Check, Pencil, Plus, Gift, Undo2 } from 'lucide-react';
import { Button, IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM, campaignsCoveringLine } from '@2990s/shared';
import { useCart, cartSubtotal, cartSummary, type CartLine } from '../state/cart';
import { cartLineTitle, useMfgCatalogIndex } from '../lib/cart-display';
import { useSaveQuote } from '../lib/quotes';
import { useFreePwpCodes } from '../lib/products/pwp-queries';
import { useActiveFreeItemCampaigns, useSofaCombos, sizeIdToMfgCode, type FreeItemCampaignRow } from '../lib/queries';
import { ProductThumb } from './ProductThumb';
import { CountryPhoneInput } from './CountryPhoneInput';
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
  const makeFree = useCart((s) => s.makeFree);
  const revertFreeItem = useCart((s) => s.revertFreeItem);
  const subtotal = cartSubtotal(lines);
  const saveQuote = useSaveQuote();
  const freePwp = useFreePwpCodes();
  const { data: activeCampaigns = [] } = useActiveFreeItemCampaigns();
  const { data: sofaCombos = [] } = useSofaCombos();
  const comboModulesById = useMemo(
    () => new Map(sofaCombos.map((cb) => [cb.id, cb.modules])),
    [sofaCombos],
  );

  // Abandon — free any RESERVED PWP codes the cart's trigger lines hold, then
  // clear. (A quote-save / order-place KEEPS / consumes them, so those paths
  // do NOT call this.) Freeing a key with no codes is a harmless no-op.
  const clearAndFreePwp = () => {
    for (const l of lines) freePwp.mutate(l.key);
    clear();
  };

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
            activeCampaigns={activeCampaigns}
            comboModulesById={comboModulesById}
            onMakeFree={makeFree}
            onRevertFree={revertFreeItem}
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
              <CountryPhoneInput value={quotePhone} onChange={setQuotePhone} />
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
          <Button variant="secondary" onClick={clearAndFreePwp}>Clear</Button>
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

const Line = ({ line, variant, onRemove, onSetQty, onEdit, activeCampaigns, comboModulesById, onMakeFree, onRevertFree }: {
  line: CartLine;
  variant: CartContentsVariant;
  onRemove: (k: string) => void;
  onSetQty: (k: string, q: number) => void;
  onEdit?: () => void;
  activeCampaigns: FreeItemCampaignRow[];
  comboModulesById: Map<string, string[][]>;
  onMakeFree: (key: string, campaign: { id: string; name: string; maxFreeQty: number }) => void;
  onRevertFree: (key: string) => void;
}) => {
  const mfgById = useMfgCatalogIndex();
  const title = cartLineTitle(line.config, mfgById.get(line.config.productId));

  // Resolve free-item eligibility for this line.
  const mfgRow = mfgById.get(line.config.productId);
  const cfgAny = line.config as {
    freeItemCampaignId?: string | null;
    freeItemCampaign?: string | null;
    pwp?: boolean;
    isFreeGift?: boolean;
    sizeId?: string;
    cells?: Array<{ moduleId?: string }>;
  };
  const alreadyFree = Boolean(cfgAny.freeItemCampaignId);
  const blocked = Boolean(cfgAny.pwp) || Boolean(cfgAny.isFreeGift);
  // MfgCatalogRow uses camelCase: modelId + category (uppercase enum e.g. 'SOFA').
  const covering = (blocked || alreadyFree) ? [] : campaignsCoveringLine(
    {
      category: String(mfgRow?.category ?? ''),
      modelId: mfgRow?.modelId ?? null,
      sizeCode: sizeIdToMfgCode(cfgAny.sizeId),
      builtModuleIds: (cfgAny.cells ?? []).map((c) => String(c?.moduleId ?? '')).filter(Boolean),
    },
    activeCampaigns,
    comboModulesById,
  );
  // Single covering campaign → one button. (TS doesn't narrow covering[0] from a
  // length check, so bind it here instead of asserting inside the JSX.)
  const singleCampaign = covering.length === 1 ? covering[0]! : null;

  return (
  <li className={`${styles.line} ${variant === 'rail' ? styles.lineRail : ''}`}>
    <ProductThumb
      className={styles.linePhoto}
      productId={line.config.productId}
      name={title}
    />
    <div className={styles.lineMain}>
      <div className={styles.lineName}>{title}</div>
      <div className={styles.lineSummary}>{cartSummary(line.config)}</div>
      {'pwp' in line.config && line.config.pwp && (
        <div className={styles.lineSummary}>
          PWP price{'pwpTriggerLabel' in line.config && line.config.pwpTriggerLabel ? ` · from ${line.config.pwpTriggerLabel}` : ''}
        </div>
      )}
      {'isFreeGift' in line.config && line.config.isFreeGift && (
        <div className={styles.lineSummary}>
          {('freeGiftCampaign' in line.config && line.config.freeGiftCampaign) ? line.config.freeGiftCampaign : 'Free gift'}
        </div>
      )}
      {alreadyFree && (
        <div className={styles.lineSummary}>
          FREE{cfgAny.freeItemCampaign ? ` · ${cfgAny.freeItemCampaign}` : ''}
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
        // One code = one redemption = one unit — the store clamps too; this
        // disable is the affordance (Loo 2026-06-12).
        disabled={('pwp' in line.config && line.config.pwp === true) || ('isFreeGift' in line.config && line.config.isFreeGift === true)}
        title={('isFreeGift' in line.config && line.config.isFreeGift === true) ? 'Free gift — quantity follows the qualifying item' : ('pwp' in line.config && line.config.pwp === true ? 'PWP — one unit per code' : undefined)}
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
      {alreadyFree ? (
        <IconButton
          icon={<Undo2 size={16} strokeWidth={1.75} />}
          aria-label="Remove free gift"
          title="Revert to normal price"
          onClick={() => onRevertFree(line.key)}
        />
      ) : singleCampaign ? (
        <IconButton
          icon={<Gift size={16} strokeWidth={1.75} />}
          aria-label="Make free gift"
          title={`Make free · ${singleCampaign.name}`}
          onClick={() => onMakeFree(line.key, { id: singleCampaign.id, name: singleCampaign.name, maxFreeQty: singleCampaign.maxFreeQty })}
        />
      ) : covering.length > 1 ? (
        <select
          aria-label="Make free under campaign"
          defaultValue=""
          onChange={(e) => {
            const c = covering.find((x) => x.id === e.target.value);
            if (c) onMakeFree(line.key, { id: c.id, name: c.name, maxFreeQty: c.maxFreeQty });
          }}
          className={styles.makeFreeSelect}
        >
          <option value="" disabled>Make free…</option>
          {covering.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      ) : null}
      <IconButton
        icon={<Trash2 size={18} strokeWidth={1.75} />}
        aria-label="Remove line"
        onClick={() => onRemove(line.key)}
      />
    </div>
  </li>
  );
};
