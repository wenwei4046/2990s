import { Controller, useFormContext, useWatch } from 'react-hook-form';
import {
  useBundleLibrary,
  useCompartmentLibrary,
  useSizeLibrary,
  type CompartmentLibrary,
} from '../lib/queries';
import styles from './PricingEditor.module.css';

interface SkuFormData {
  pricingKind: 'sofa_build' | 'size_variants' | 'flat' | 'tbc';
  categoryId: string;
  reclinerUpgradePrice?: number;
  compartments?: { compartmentId: string; active: boolean; price: number }[];
  bundles?: { bundleId: string; active: boolean; price: number }[];
  sizes?: { sizeId: string; active: boolean; price: number }[];
  flatPrice?: number;
}

export const PricingEditor = () => {
  const { control } = useFormContext<SkuFormData>();
  const pricingKind = useWatch({ control, name: 'pricingKind' });
  const categoryId = useWatch({ control, name: 'categoryId' });

  if (pricingKind === 'sofa_build') return <SofaEditor />;
  if (pricingKind === 'size_variants') return <SizeEditor catLabel={categoryId === 'mattress' ? 'Mattress' : 'Bedframe'} />;
  if (pricingKind === 'flat') return <FlatEditor />;
  return <TbcPlaceholder categoryId={categoryId} />;
};

/* ─── primitives ───────────────────────────────────────────────────── */

interface ActiveToggleProps {
  value: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}
const ActiveToggle = ({ value, onChange, disabled }: ActiveToggleProps) => (
  <button
    type="button"
    role="switch"
    aria-checked={value}
    aria-label={value ? 'Active' : 'Hidden'}
    disabled={disabled}
    className={`${styles.toggle} ${value ? styles.toggleOn : ''}`}
    onClick={() => onChange(!value)}
  >
    <span className={styles.toggleKnob} />
  </button>
);

interface PriceInputProps {
  value: number;
  onChange: (v: number) => void;
  disabled?: boolean;
}
const PriceInput = ({ value, onChange, disabled }: PriceInputProps) => {
  // value === 0 is treated as "unset" — show empty input so coordinator
  // sees a placeholder, not a misleading "RM 0" (which looks like a free product).
  // Saving without entering a value preserves 0 (current behaviour).
  const displayValue = Number.isFinite(value) && value !== 0 ? String(value) : '';
  return (
    <div className={`${styles.price} ${disabled ? styles.priceDisabled : ''}`}>
      <span className={styles.priceUnit}>RM</span>
      <input
        type="number"
        min={0}
        step={10}
        value={displayValue}
        placeholder="—"
        disabled={disabled}
        onChange={(e) => onChange(e.target.value === '' ? 0 : Math.max(0, parseInt(e.target.value, 10) || 0))}
      />
    </div>
  );
};

/* ─── sofa: compartments grouped + bundles + recliner ──────────────── */

const COMP_GROUPS: CompartmentLibrary['compGroup'][] = [
  '1-seater',
  '2-seater',
  'Corner',
  'L-Shape',
  'Accessory',
];

const SofaEditor = () => {
  const { control, setValue } = useFormContext<SkuFormData>();
  const compartments = useWatch({ control, name: 'compartments' }) ?? [];
  const bundles = useWatch({ control, name: 'bundles' }) ?? [];

  const compLib = useCompartmentLibrary();
  const bundleLib = useBundleLibrary();

  if (compLib.isLoading || bundleLib.isLoading) {
    return <section className={styles.section}><p className="t-body fg-muted">Loading library…</p></section>;
  }
  if (compLib.error || bundleLib.error) {
    return <section className={styles.section}><p className={styles.error}>Failed to load compartment / bundle library.</p></section>;
  }

  const lib = compLib.data ?? [];
  const blib = bundleLib.data ?? [];

  const activeC = compartments.filter((c) => c.active).length;
  const activeB = bundles.filter((b) => b.active).length;

  const setCompField = (i: number, patch: Partial<{ active: boolean; price: number }>) => {
    const next = compartments.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    setValue('compartments', next, { shouldDirty: true });
  };
  const setBundleField = (i: number, patch: Partial<{ active: boolean; price: number }>) => {
    const next = bundles.map((b, idx) => (idx === i ? { ...b, ...patch } : b));
    setValue('bundles', next, { shouldDirty: true });
  };
  const bulkComp = (active: boolean) => {
    setValue(
      'compartments',
      compartments.map((c) => ({ ...c, active })),
      { shouldDirty: true },
    );
  };
  const bulkBundle = (active: boolean) => {
    setValue(
      'bundles',
      bundles.map((b) => ({ ...b, active })),
      { shouldDirty: true },
    );
  };

  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Sofa pricing</h3>
        <span className={styles.stat}>
          {activeC}/{compartments.length} compartments · {activeB}/{bundles.length} bundles
        </span>
      </header>

      {/* Compartments */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.blockTitle}>Compartments</div>
            <div className={styles.blockSub}>
              Each module's à-la-carte price for this Model. Toggle off the ones not offered.
            </div>
          </div>
          <div className={styles.blockActions}>
            <button type="button" className={styles.miniBtn} onClick={() => bulkComp(true)}>All on</button>
            <button type="button" className={styles.miniBtn} onClick={() => bulkComp(false)}>All off</button>
          </div>
        </div>

        {COMP_GROUPS.map((group) => {
          const ids = lib.filter((l) => l.compGroup === group).map((l) => l.id);
          if (ids.length === 0) return null;
          return (
            <div key={group} className={styles.group}>
              <div className={styles.groupLabel}>{group}</div>
              <div className={styles.rows}>
                {compartments.map((c, i) => {
                  if (!ids.includes(c.compartmentId)) return null;
                  const def = lib.find((l) => l.id === c.compartmentId);
                  return (
                    <div key={c.compartmentId} className={`${styles.row} ${c.active ? '' : styles.rowOff}`}>
                      <ActiveToggle value={c.active} onChange={(v) => setCompField(i, { active: v })} />
                      <code className={styles.rowId}>{c.compartmentId}</code>
                      <span className={styles.rowLabel}>{def?.label ?? c.compartmentId}</span>
                      <PriceInput value={c.price} onChange={(v) => setCompField(i, { price: v })} disabled={!c.active} />
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {/* Bundles */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.blockTitle}>Quick-Pick bundles</div>
            <div className={styles.blockSub}>
              Pre-set combinations sold as a single SKU — usually a touch cheaper than à-la-carte.
            </div>
          </div>
          <div className={styles.blockActions}>
            <button type="button" className={styles.miniBtn} onClick={() => bulkBundle(true)}>All on</button>
            <button type="button" className={styles.miniBtn} onClick={() => bulkBundle(false)}>All off</button>
          </div>
        </div>
        <div className={styles.rows}>
          {bundles.map((b, i) => {
            const def = blib.find((l) => l.id === b.bundleId);
            return (
              <div key={b.bundleId} className={`${styles.row} ${b.active ? '' : styles.rowOff}`}>
                <ActiveToggle value={b.active} onChange={(v) => setBundleField(i, { active: v })} />
                <code className={styles.rowId}>{b.bundleId}</code>
                <span className={styles.rowLabel}>
                  {def?.label ?? b.bundleId}
                  {def?.sub && <span className={styles.rowSub}> · {def.sub}</span>}
                </span>
                <PriceInput value={b.price} onChange={(v) => setBundleField(i, { price: v })} disabled={!b.active} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Recliner */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.blockTitle}>Power-recliner upgrade</div>
            <div className={styles.blockSub}>Per-seat add-on for 1A/2A/1NA/2NA modules. RM 0 disables it for this Model.</div>
          </div>
        </div>
        <div className={styles.reclinerRow}>
          <span className={styles.rowLabel}>Add a power recliner to a single seat</span>
          <Controller
            control={control}
            name="reclinerUpgradePrice"
            render={({ field }) => (
              <PriceInput value={field.value ?? 0} onChange={field.onChange} />
            )}
          />
          <span className={styles.rowSub}>per seat</span>
        </div>
      </div>
    </section>
  );
};

/* ─── mattress / bedframe: 4 sizes ─────────────────────────────────── */

const SizeEditor = ({ catLabel }: { catLabel: string }) => {
  const { control, setValue } = useFormContext<SkuFormData>();
  const sizes = useWatch({ control, name: 'sizes' }) ?? [];
  const sizeLib = useSizeLibrary();

  if (sizeLib.isLoading) return <section className={styles.section}><p className="t-body fg-muted">Loading library…</p></section>;
  if (sizeLib.error) return <section className={styles.section}><p className={styles.error}>Failed to load size library.</p></section>;

  const lib = sizeLib.data ?? [];
  const activeCount = sizes.filter((s) => s.active).length;

  const setSizeField = (i: number, patch: Partial<{ active: boolean; price: number }>) => {
    const next = sizes.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    setValue('sizes', next, { shouldDirty: true });
  };
  const bulkSize = (active: boolean) => {
    setValue('sizes', sizes.map((s) => ({ ...s, active })), { shouldDirty: true });
  };

  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>{catLabel} pricing · by size</h3>
        <span className={styles.stat}>{activeCount}/{sizes.length} sizes available</span>
      </header>
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.blockTitle}>Size variants</div>
            <div className={styles.blockSub}>
              Each size sells at its own price. Toggle off any size this {catLabel.toLowerCase()} doesn't ship in.
            </div>
          </div>
          <div className={styles.blockActions}>
            <button type="button" className={styles.miniBtn} onClick={() => bulkSize(true)}>All on</button>
            <button type="button" className={styles.miniBtn} onClick={() => bulkSize(false)}>All off</button>
          </div>
        </div>
        <div className={styles.rows}>
          {sizes.map((s, i) => {
            const def = lib.find((l) => l.id === s.sizeId);
            // Sofa depth sizes are encoded as width === length (e.g. s-24 = 61×61).
            // Showing "61×61 cm" misleads — the label ("24-inch depth") is the
            // truthful render. For mattress/bedframe (w !== l), keep dimension math.
            const isSquareDepth = !!def && def.widthCm === def.lengthCm;
            const dimLabel = def
              ? isSquareDepth
                ? def.label
                : `${def.widthCm}×${def.lengthCm} cm`
              : '';
            return (
              <div key={s.sizeId} className={`${styles.row} ${s.active ? '' : styles.rowOff}`}>
                <ActiveToggle value={s.active} onChange={(v) => setSizeField(i, { active: v })} />
                <code className={styles.rowId}>{def?.label ?? s.sizeId}</code>
                <span className={`${styles.rowLabel} ${styles.rowLabelDim}`}>
                  {dimLabel}
                </span>
                <PriceInput value={s.price} onChange={(v) => setSizeField(i, { price: v })} disabled={!s.active} />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

/* ─── flat: single price ───────────────────────────────────────────── */

const FlatEditor = () => {
  const { control } = useFormContext<SkuFormData>();
  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Flat pricing</h3>
      </header>
      <div className={styles.block}>
        <div className={styles.blockSub} style={{ marginBottom: 'var(--space-3)' }}>
          One fixed price for this SKU. Use for items that don't vary by size or build.
        </div>
        <div className={styles.reclinerRow}>
          <span className={styles.rowLabel}>Unit price</span>
          <Controller
            control={control}
            name="flatPrice"
            render={({ field }) => (
              <PriceInput value={field.value ?? 0} onChange={field.onChange} />
            )}
          />
        </div>
      </div>
    </section>
  );
};

/* ─── tbc: not yet priced ──────────────────────────────────────────── */

const TbcPlaceholder = ({ categoryId }: { categoryId: string }) => (
  <section className={styles.section}>
    <header className={styles.sectionHead}>
      <h3 className={styles.sectionTitle}>Pricing</h3>
    </header>
    <div className={styles.tbc}>
      <strong>Pricing scheme not finalised for {categoryId}.</strong>
      <span>Once the range structure (size? bundle? per-piece?) is locked, we'll wire the editor here.</span>
    </div>
  </section>
);
