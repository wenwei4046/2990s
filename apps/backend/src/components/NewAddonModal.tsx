import { useEffect, useMemo, useState } from 'react';
import {
  Recycle,
  ArrowUpFromLine,
  Wrench,
  Package,
  Sparkles,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { AddonRow } from '../lib/queries';
import styles from './NewAddonModal.module.css';

type AddonKind = 'qty' | 'floors_items' | 'flat';

const ICON_OPTIONS: { name: string; Icon: LucideIcon }[] = [
  { name: 'recycle',             Icon: Recycle },
  { name: 'arrow-up-from-line',  Icon: ArrowUpFromLine },
  { name: 'wrench',              Icon: Wrench },
  { name: 'package',             Icon: Package },
  { name: 'sparkles',            Icon: Sparkles },
];

const KIND_OPTIONS: { value: AddonKind; label: string; hint: string }[] = [
  { value: 'qty',          label: 'Per piece',         hint: 'Price × quantity (e.g. pillow, wrap)' },
  { value: 'flat',         label: 'Flat fee',          hint: 'One-shot charge (e.g. premium upgrade)' },
  { value: 'floors_items', label: 'Per floor · item',  hint: 'Lift access — max(floors−2,0) × items × rate' },
];

// Whitelisted unit suggestions per kind. Free-form text — datalist is a hint.
const UNIT_SUGGESTIONS: Record<AddonKind, string[]> = {
  qty:          ['piece', 'set', 'pair'],
  flat:         ['pillow', 'service'],
  floors_items: ['floor·item'],
};

const slugify = (s: string): string =>
  s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 50);

interface Props {
  existing: AddonRow[];
  onClose: () => void;
}

export const NewAddonModal = ({ existing, onClose }: Props) => {
  const qc = useQueryClient();

  // Track whether the user has manually edited the slug; if not, keep it
  // synced with label.
  const [slugTouched, setSlugTouched] = useState(false);

  const [label,        setLabel]        = useState('');
  const [id,           setId]           = useState('');
  const [description,  setDescription]  = useState('');
  const [icon,         setIcon]         = useState<string>('package');
  const [kind,         setKind]         = useState<AddonKind>('qty');
  const [category,     setCategory]     = useState('');
  const [price,        setPrice]        = useState('');
  const [perFloorItem, setPerFloorItem] = useState('');
  const [unit,         setUnit]         = useState('');
  const [stockMode,    setStockMode]    = useState<'unlimited' | 'tracked'>('unlimited');
  const [stockValue,   setStockValue]   = useState('');
  const [enabled,      setEnabled]      = useState(true);

  const [submitError, setSubmitError] = useState<string | null>(null);

  // Auto-sync slug from label until user touches it manually.
  useEffect(() => {
    if (!slugTouched) setId(slugify(label));
  }, [label, slugTouched]);

  const existingIds = useMemo(() => new Set(existing.map((a) => a.id)), [existing]);
  const existingCategories = useMemo(() => {
    const set = new Set<string>();
    for (const a of existing) if (a.category) set.add(a.category);
    return Array.from(set).sort();
  }, [existing]);
  const maxSortOrder = useMemo(
    () => existing.reduce((m, a) => (a.sortOrder > m ? a.sortOrder : m), 0),
    [existing],
  );

  // Validation. Returns null when OK, otherwise first error message.
  const validationError = (): string | null => {
    if (!label.trim()) return 'Label is required';
    if (!id.trim()) return 'ID slug is required';
    if (!/^[a-z0-9-]+$/.test(id)) return 'ID must be lowercase letters, digits, dashes only';
    if (existingIds.has(id)) return `ID "${id}" already exists — pick a different slug`;
    if (kind === 'floors_items') {
      const n = Number(perFloorItem);
      if (!Number.isFinite(n) || n < 0) return 'Per floor·item rate is required (RM, ≥ 0)';
    } else {
      const n = Number(price);
      if (!Number.isFinite(n) || n < 0) return 'Price is required (RM, ≥ 0)';
    }
    if (stockMode === 'tracked') {
      const n = Number(stockValue);
      if (!Number.isFinite(n) || n < 0 || !Number.isInteger(n)) return 'Stock must be a whole number ≥ 0';
    }
    return null;
  };

  const mutation = useMutation({
    mutationFn: async () => {
      const priceInt        = kind === 'floors_items' ? 0 : Math.round(Number(price));
      const perFloorItemInt = kind === 'floors_items' ? Math.round(Number(perFloorItem)) : null;
      const stock           = stockMode === 'unlimited' ? null : Math.round(Number(stockValue));

      const row = {
        id:              id.trim(),
        label:           label.trim(),
        description:     description.trim() || null,
        icon,
        kind,
        category:        category.trim() || null,
        price:           priceInt,
        per_floor_item:  perFloorItemInt,
        unit:            unit.trim() || null,
        stock,
        enabled,
        sort_order:      maxSortOrder + 1,
        // default_qty defaults to 1 in DB; updated_at defaults to now()
      };
      const { error } = await supabase.from('addons').insert(row);
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['addons'] });
      onClose();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Insert failed';
      setSubmitError(msg);
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);
    const err = validationError();
    if (err) {
      setSubmitError(err);
      return;
    }
    mutation.mutate();
  };

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  const showPrice = kind !== 'floors_items';
  const showPerFloor = kind === 'floors_items';

  return (
    <div className={styles.modal} onClick={handleBackdrop}>
      <form className={styles.panel} onSubmit={handleSubmit}>
        <header className={styles.head}>
          <div>
            <span className={styles.eyebrow}>Add-ons</span>
            <h2 className={styles.title}>New add-on</h2>
            <p className={styles.sub}>Disposal, lift access, assembly, accessories — anything sold alongside furniture.</p>
          </div>
          <button type="button" className={styles.closeBtn} onClick={onClose} aria-label="Close">
            <X size={20} strokeWidth={1.75} />
          </button>
        </header>

        <div className={styles.body}>
          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.labelText}>Label *</span>
              <input
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                placeholder="e.g. Dispose old wardrobe"
                autoFocus
                required
              />
            </label>
            <label className={styles.field}>
              <span className={styles.labelText}>ID slug *</span>
              <input
                type="text"
                value={id}
                onChange={(e) => {
                  setSlugTouched(true);
                  setId(e.target.value);
                }}
                placeholder="auto from label"
                required
              />
            </label>
          </div>

          <label className={styles.field}>
            <span className={styles.labelText}>Description</span>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Short customer-facing tagline (optional)"
            />
          </label>

          <fieldset className={styles.fieldset}>
            <legend className={styles.labelText}>Icon *</legend>
            <div className={styles.iconGrid}>
              {ICON_OPTIONS.map(({ name, Icon }) => (
                <button
                  key={name}
                  type="button"
                  className={`${styles.iconChoice} ${icon === name ? styles.iconChoiceActive : ''}`}
                  onClick={() => setIcon(name)}
                  aria-label={name}
                  aria-pressed={icon === name}
                  title={name}
                >
                  <Icon size={20} strokeWidth={1.75} />
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className={styles.fieldset}>
            <legend className={styles.labelText}>Kind *</legend>
            <div className={styles.kindGroup}>
              {KIND_OPTIONS.map((opt) => (
                <label
                  key={opt.value}
                  className={`${styles.kindChoice} ${kind === opt.value ? styles.kindChoiceActive : ''}`}
                >
                  <input
                    type="radio"
                    name="kind"
                    value={opt.value}
                    checked={kind === opt.value}
                    onChange={() => setKind(opt.value)}
                  />
                  <span className={styles.kindLabel}>{opt.label}</span>
                  <span className={styles.kindHint}>{opt.hint}</span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className={styles.row}>
            {showPrice && (
              <label className={styles.field}>
                <span className={styles.labelText}>Price (RM) *</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="0"
                />
              </label>
            )}
            {showPerFloor && (
              <label className={styles.field}>
                <span className={styles.labelText}>Per floor · item (RM) *</span>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  step={1}
                  value={perFloorItem}
                  onChange={(e) => setPerFloorItem(e.target.value)}
                  placeholder="0"
                />
              </label>
            )}
            <label className={styles.field}>
              <span className={styles.labelText}>Unit</span>
              <input
                type="text"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                placeholder="e.g. piece, pillow"
                list="unit-suggestions"
              />
              <datalist id="unit-suggestions">
                {UNIT_SUGGESTIONS[kind].map((u) => <option key={u} value={u} />)}
              </datalist>
            </label>
          </div>

          <div className={styles.row}>
            <label className={styles.field}>
              <span className={styles.labelText}>Category</span>
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="e.g. disposal, pillow"
                list="category-suggestions"
              />
              <datalist id="category-suggestions">
                {existingCategories.map((c) => <option key={c} value={c} />)}
              </datalist>
            </label>
            <fieldset className={styles.fieldset}>
              <legend className={styles.labelText}>Stock</legend>
              <div className={styles.stockGroup}>
                <label className={styles.stockChoice}>
                  <input
                    type="radio"
                    name="stockMode"
                    checked={stockMode === 'unlimited'}
                    onChange={() => setStockMode('unlimited')}
                  />
                  Unlimited
                </label>
                <label className={styles.stockChoice}>
                  <input
                    type="radio"
                    name="stockMode"
                    checked={stockMode === 'tracked'}
                    onChange={() => setStockMode('tracked')}
                  />
                  Tracked
                </label>
                {stockMode === 'tracked' && (
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1}
                    value={stockValue}
                    onChange={(e) => setStockValue(e.target.value)}
                    placeholder="0"
                    className={styles.stockInput}
                  />
                )}
              </div>
            </fieldset>
          </div>

          <label className={styles.toggleField}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span>Enabled — visible in POS handover screen</span>
          </label>

          {submitError && (
            <div className={styles.error}>{submitError}</div>
          )}
        </div>

        <footer className={styles.foot}>
          <button type="button" className={styles.btnSecondary} onClick={onClose} disabled={mutation.isPending}>
            Cancel
          </button>
          <button type="submit" className={styles.btnPrimary} disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating…' : 'Create add-on'}
          </button>
        </footer>
      </form>
    </div>
  );
};
