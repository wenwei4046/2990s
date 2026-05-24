import { Controller, useFormContext, useWatch } from 'react-hook-form';
import {
  useBundleLibrary,
  useCompartmentLibrary,
  useFabricLibrary,
  useSizeLibrary,
  type CompartmentLibrary,
} from '../lib/queries';
import styles from './PricingEditor.module.css';

interface SkuFormData {
  pricingKind: 'sofa_build' | 'size_variants' | 'flat' | 'tbc';
  categoryId: string;
  reclinerUpgradePrice?: number;
  seatUpgradeLabel?: string | null;
  seatUpgradeFootrest?: boolean;
  depthOptions?: string | null;
  compartments?: { compartmentId: string; active: boolean; price: number }[];
  bundles?: { bundleId: string; active: boolean; price: number }[];
  fabrics?: { fabricId: string; active: boolean; surcharge: number }[];
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

// F5: depths a sofa Model can offer (inches). The editor stores the chosen
// subset as a CSV in products.depth_options; the POS depth toggle reads it.
const DEPTH_CHOICES = [24, 26, 28, 30, 32] as const;

const SofaEditor = () => {
  const { control, setValue, formState: { errors } } = useFormContext<SkuFormData>();
  const compartments = useWatch({ control, name: 'compartments' }) ?? [];
  const bundles = useWatch({ control, name: 'bundles' }) ?? [];
  const fabrics = useWatch({ control, name: 'fabrics' }) ?? [];
  // Surfaces the superRefine() errors from productSchema when admin tries to
  // save with 0 active bundles / fabrics. Cleared automatically on next submit.
  const bundlesErr = (errors as { bundles?: { message?: string } }).bundles?.message;
  const fabricsErr = (errors as { fabrics?: { message?: string } }).fabrics?.message;

  const compLib = useCompartmentLibrary();
  const bundleLib = useBundleLibrary();
  const fabricLib = useFabricLibrary();

  if (compLib.isLoading || bundleLib.isLoading || fabricLib.isLoading) {
    return <section className={styles.section}><p className="t-body fg-muted">Loading library…</p></section>;
  }
  if (compLib.error || bundleLib.error || fabricLib.error) {
    return <section className={styles.section}><p className={styles.error}>Failed to load compartment / bundle / fabric library.</p></section>;
  }

  const lib = compLib.data ?? [];
  const blib = bundleLib.data ?? [];
  const flib = fabricLib.data ?? [];

  const activeC = compartments.filter((c) => c.active).length;
  const activeB = bundles.filter((b) => b.active).length;
  const activeF = fabrics.filter((f) => f.active).length;

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
  const setFabricField = (i: number, patch: Partial<{ active: boolean; surcharge: number }>) => {
    const next = fabrics.map((f, idx) => (idx === i ? { ...f, ...patch } : f));
    setValue('fabrics', next, { shouldDirty: true });
  };
  const bulkFabric = (active: boolean) => {
    setValue('fabrics', fabrics.map((f) => ({ ...f, active })), { shouldDirty: true });
  };

  return (
    <section className={styles.section}>
      <header className={styles.sectionHead}>
        <h3 className={styles.sectionTitle}>Sofa pricing</h3>
        <span className={styles.stat}>
          {activeC}/{compartments.length} compartments · {activeB}/{bundles.length} bundles · {activeF}/{fabrics.length} fabrics
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
            {bundlesErr && <div className={styles.error} style={{ marginTop: 6 }}>{bundlesErr}</div>}
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

      {/* Fabrics — per-Model availability + surcharge (spec 2026-05-24) */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.blockTitle}>Fabrics</div>
            <div className={styles.blockSub}>
              Which fabrics this Model offers + the surcharge for each (RM 0 = included).
              Colour is free and comes with each fabric. At least one must be active.
            </div>
            {fabricsErr && <div className={styles.error} style={{ marginTop: 6 }}>{fabricsErr}</div>}
          </div>
          <div className={styles.blockActions}>
            <button type="button" className={styles.miniBtn} onClick={() => bulkFabric(true)}>All on</button>
            <button type="button" className={styles.miniBtn} onClick={() => bulkFabric(false)}>All off</button>
          </div>
        </div>
        <div className={styles.rows}>
          {fabrics.map((f, i) => {
            const def = flib.find((l) => l.id === f.fabricId);
            return (
              <div key={f.fabricId} className={`${styles.row} ${f.active ? '' : styles.rowOff}`}>
                <ActiveToggle value={f.active} onChange={(v) => setFabricField(i, { active: v })} />
                <code className={styles.rowId}>{f.fabricId}</code>
                <span className={styles.rowLabel}>
                  {def?.label ?? f.fabricId}
                  {def?.tier && <span className={styles.rowSub}> · {def.tier}</span>}
                </span>
                <PriceInput value={f.surcharge} onChange={(v) => setFabricField(i, { surcharge: v })} disabled={!f.active} />
              </div>
            );
          })}
        </div>
      </div>

      {/* Per-seat upgrade (F3) — one named upgrade per Model */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.blockTitle}>Per-seat upgrade</div>
            <div className={styles.blockSub}>
              One named upgrade staff can add per seat in Custom Build (1A/2A/1NA/2NA modules).
              Leave the name blank to offer none. Order lines read &ldquo;+ N {'{name}'}&rdquo;.
            </div>
          </div>
        </div>
        <div className={styles.reclinerRow}>
          <span className={styles.rowLabel}>Upgrade name</span>
          <Controller
            control={control}
            name="seatUpgradeLabel"
            render={({ field }) => (
              <input
                type="text"
                maxLength={40}
                placeholder="e.g. Power slide — blank = none"
                value={field.value ?? ''}
                onChange={(e) => field.onChange(e.target.value)}
                style={{
                  flex: 1, minWidth: 0, padding: '8px 10px',
                  border: '1px solid rgba(34,31,32,0.15)', borderRadius: 8,
                  font: 'inherit', color: 'var(--c-ink)', background: '#fff',
                }}
              />
            )}
          />
        </div>
        <div className={styles.reclinerRow}>
          <span className={styles.rowLabel}>Price per seat</span>
          <Controller
            control={control}
            name="reclinerUpgradePrice"
            render={({ field }) => (
              <PriceInput value={field.value ?? 0} onChange={field.onChange} />
            )}
          />
          <span className={styles.rowSub}>RM 0 = free (e.g. headrest)</span>
        </div>
        <div className={styles.reclinerRow}>
          <span className={styles.rowLabel}>Opens a footrest</span>
          <Controller
            control={control}
            name="seatUpgradeFootrest"
            render={({ field }) => (
              <ActiveToggle value={field.value ?? true} onChange={field.onChange} />
            )}
          />
          <span className={styles.rowSub}>power = yes · headrest = no</span>
        </div>
      </div>

      {/* Seat depths (F5) — per-Model selectable depths */}
      <div className={styles.block}>
        <div className={styles.blockHead}>
          <div>
            <div className={styles.blockTitle}>Seat depths</div>
            <div className={styles.blockSub}>
              Which depths this Model offers (inches). Staff pick one in the configurator;
              it&rsquo;s recorded on the order + invoice. Same price across depths.
            </div>
          </div>
        </div>
        <Controller
          control={control}
          name="depthOptions"
          render={({ field }) => {
            const selected = (field.value ?? '').split(',').map((s) => s.trim()).filter(Boolean);
            const toggle = (d: string) => {
              const set = new Set(selected);
              if (set.has(d)) set.delete(d); else set.add(d);
              // Keep canonical ascending order; empty → null (no depth choice).
              const next = DEPTH_CHOICES.filter((c) => set.has(String(c))).join(',');
              field.onChange(next || null);
            };
            return (
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', padding: '4px 0' }}>
                {DEPTH_CHOICES.map((d) => {
                  const on = selected.includes(String(d));
                  return (
                    <button
                      key={d}
                      type="button"
                      aria-pressed={on}
                      onClick={() => toggle(String(d))}
                      style={{
                        padding: '8px 14px', borderRadius: 8, font: 'inherit',
                        fontWeight: on ? 600 : 400, cursor: 'pointer',
                        border: on ? '1.5px solid var(--c-burnt)' : '1px solid rgba(34,31,32,0.15)',
                        background: on ? 'var(--c-burnt)' : '#fff',
                        color: on ? '#fff' : 'var(--c-ink)',
                      }}
                    >
                      {d}&Prime;
                    </button>
                  );
                })}
              </div>
            );
          }}
        />
      </div>
    </section>
  );
};

/* ─── mattress / bedframe: 4 sizes ─────────────────────────────────── */

const SizeEditor = ({ catLabel }: { catLabel: string }) => {
  const { control, setValue, formState: { errors } } = useFormContext<SkuFormData>();
  const sizes = useWatch({ control, name: 'sizes' }) ?? [];
  const sizeLib = useSizeLibrary();
  // Surfaces the superRefine() error from productSchema when admin tries to
  // save with 0 active+priced sizes. Cleared automatically on next submit.
  const sizesErr = (errors as { sizes?: { message?: string } }).sizes?.message;

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
            {sizesErr && <div className={styles.error} style={{ marginTop: 6 }}>{sizesErr}</div>}
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
