import { useState } from 'react';
import {
  fmtCenti, fmtQty,
  type ProductsSection, type BuyerDemographics, type Distribution,
} from '@2990s/shared';
import styles from '../../pages/SalesAnalysis.module.css';

const MIN_SAMPLE = 10;

// Category enum (SOFA/MATTRESS/…) → sentence-case label for chips/titles.
const catLabel = (c: string): string => (c ? c.charAt(0) + c.slice(1).toLowerCase() : c);

const toggle = (set: Set<string>, key: string): Set<string> => {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
};

// Buyer demographics block — race / age band / gender bars. Mirrors the
// Customer Data tab's distRow treatment so the two tabs read identically.
const demoBlock = (d: BuyerDemographics) => {
  if (d.n === 0) return <p className={styles.muted}>No buyer data.</p>;
  const pctOf = (count: number) => (d.n > 0 ? Math.round((count / d.n) * 100) : 0);
  const distRow = (label: string, count: number) => (
    <div key={label} className={styles.trendRow}>
      <span className={styles.cardSub}>{label}</span>
      <span className={styles.barTrack}><span className={styles.bar} style={{ width: `${pctOf(count)}%` }} /></span>
      <span className={styles.cardSub}>{fmtQty(count)} ({pctOf(count)}%)</span>
    </div>
  );
  const group = (title: string, dist: Distribution[]) => (
    <div>
      <p className={styles.cardSub}>{title}</p>
      {dist.map((b) => distRow(b.key, b.count))}
    </div>
  );
  return (
    <>
      {d.n < MIN_SAMPLE && <p className={styles.note}>Small sample · n={d.n} — directional only.</p>}
      {group('Race', d.race)}
      {group('Age band', d.ageBand)}
      {group('Gender', d.gender)}
    </>
  );
};

export const ProductsTab = ({ products }: { products: ProductsSection }) => {
  const categories = Object.keys(products.byCategory);
  const [activeCat, setActiveCat] = useState(categories[0] ?? '');
  const [openModels, setOpenModels] = useState<Set<string>>(new Set());
  const [openVariants, setOpenVariants] = useState<Set<string>>(new Set());

  if (categories.length === 0) {
    return <p className={styles.muted}>No product sales in this view.</p>;
  }

  // Guard against a stale active category after a period/test-filter change.
  const effectiveCat = categories.includes(activeCat) ? activeCat : categories[0]!;
  const models = products.byCategory[effectiveCat] ?? [];
  const maxUnits = Math.max(1, ...models.map((m) => m.units));

  return (
    <>
      <div className={styles.chipRow}>
        {categories.map((c) => (
          <button
            key={c}
            type="button"
            className={`${styles.chip} ${c === effectiveCat ? styles.chipOn : ''}`}
            onClick={() => setActiveCat(c)}
          >{catLabel(c)}</button>
        ))}
      </div>

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>Top models — {catLabel(effectiveCat)}</h2>
        {models.length === 0 && <p className={styles.muted}>No models in this category.</p>}
        {models.map((m) => {
          const key = m.modelId ?? m.modelName;
          const open = openModels.has(key);
          const marginPct = m.revenueCenti > 0
            ? `${((m.marginCenti / m.revenueCenti) * 100).toFixed(1)}%`
            : '—';

          // Sofa class + fabric-upgrade line — omitted when all tallies are zero
          // (e.g. mattress / accessory categories).
          const hasSofaClass = m.comboUnits > 0 || m.customUnits > 0 || m.pwpUnits > 0;
          const hasFabric = m.fabricEligibleUnits > 0;
          const statParts: string[] = [];
          if (hasSofaClass) {
            let s = `Combo · ${fmtQty(m.comboUnits)} · Custom · ${fmtQty(m.customUnits)}`;
            if (m.pwpUnits > 0) s += ` · PWP · ${fmtQty(m.pwpUnits)}`;
            statParts.push(s);
          }
          if (hasFabric) {
            const z = Math.round((m.fabricUpgradeUnits / m.fabricEligibleUnits) * 100);
            statParts.push(`fabric upgrade ${fmtQty(m.fabricUpgradeUnits)} of ${fmtQty(m.fabricEligibleUnits)} · ${z}%`);
          }

          const maxVariantUnits = Math.max(1, ...m.variants.map((v) => v.units));

          return (
            <div key={key}>
              <button
                type="button"
                className={styles.prodRow}
                onClick={() => setOpenModels((s) => toggle(s, key))}
              >
                <span className={styles.prodName}>{m.modelName}</span>
                <span className={styles.barTrack}><span className={styles.bar} style={{ width: `${Math.round((m.units / maxUnits) * 100)}%` }} /></span>
                <span className={styles.cardSub}>{fmtQty(m.units)} units · {fmtCenti(m.revenueCenti)} · {marginPct} margin</span>
              </button>

              {open && (
                <div className={styles.drill}>
                  {statParts.length > 0 && <p className={styles.note}>{statParts.join(' · ')}</p>}

                  <p className={styles.cardSub}>Variants</p>
                  {m.variants.length === 0 && <p className={styles.muted}>No variant detail.</p>}
                  {m.variants.map((v) => {
                    const vkey = `${key}::${v.label}`;
                    const vopen = openVariants.has(vkey);
                    return (
                      <div key={vkey}>
                        <button
                          type="button"
                          className={styles.prodRow}
                          onClick={() => setOpenVariants((s) => toggle(s, vkey))}
                        >
                          <span className={styles.prodName}>{v.label}</span>
                          <span className={styles.barTrack}><span className={styles.bar} style={{ width: `${Math.round((v.units / maxVariantUnits) * 100)}%` }} /></span>
                          <span className={styles.cardSub}>{fmtQty(v.units)} units · {fmtCenti(v.revenueCenti)}</span>
                        </button>
                        {vopen && <div className={styles.drill}>{demoBlock(v.demographics)}</div>}
                      </div>
                    );
                  })}

                  <p className={styles.cardSub}>Buyers</p>
                  {demoBlock(m.demographics)}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
};
