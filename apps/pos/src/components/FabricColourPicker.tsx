import { useMemo } from 'react';
import { fmtRM, fabricTierAddon, type FabricTier, type FabricTierAddonConfig } from '@2990s/shared';
import { useFabricLibrary, useFabricColours, type ProductFabricRow } from '../lib/queries';
import styles from './FabricColourPicker.module.css';

export interface FabricSelection {
  fabricId: string;
  colourId: string;
  fabricLabel: string;
  colourLabel: string;
  colourHex: string | null;
  surcharge: number;
  // SELLING tiers (migration 0124) — drive the per-item fabric-tier add-on.
  sofaTier: string | null;
  bedframeTier: string | null;
}

export interface FabricColourPickerProps {
  /** From useProductFabrics(productId).data — the Model's per-fabric rows. */
  productFabrics: ProductFabricRow[];
  fabricId: string | null;
  colourId: string | null;
  onChange: (next: FabricSelection) => void;
  /** Pricing context for the fabric-tier add-on (migration 0124). */
  category?: 'SOFA' | 'BEDFRAME';
  /** The 4 Δ amounts; when present each chip shows its tier add-on. */
  addonConfig?: FabricTierAddonConfig | null;
}

// Fabric + Colour selection for a sofa. Fabric chips show a transparent
// "+RM" surcharge (or "Included"); colour swatches belong to the chosen
// fabric (spec 2026-05-24, G3). Controlled — the Configurator owns the state
// so the topbar LIVE TOTAL + Add-to-Cart gate can read it.
export const FabricColourPicker = ({ productFabrics, fabricId, colourId, onChange, category = 'SOFA', addonConfig = null }: FabricColourPickerProps) => {
  const lib = useFabricLibrary();
  const colours = useFabricColours();

  // Active fabrics offered on this Model, joined to the library for label/tier.
  const fabrics = useMemo(() => {
    const byId = new Map((lib.data ?? []).map((f) => [f.id, f]));
    return productFabrics
      .filter((pf) => pf.active && byId.has(pf.fabricId))
      .map((pf) => ({ ...byId.get(pf.fabricId)!, surcharge: pf.surcharge }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [productFabrics, lib.data]);

  const coloursForFabric = useMemo(
    () => (colours.data ?? []).filter((c) => c.fabricId === fabricId).sort((a, b) => a.sortOrder - b.sortOrder),
    [colours.data, fabricId],
  );

  const pick = (fId: string, cId: string) => {
    const f = fabrics.find((x) => x.id === fId);
    const c = (colours.data ?? []).find((x) => x.fabricId === fId && x.colourId === cId);
    if (!f || !c) return;
    onChange({
      fabricId: fId, colourId: cId, fabricLabel: f.label, colourLabel: c.label,
      colourHex: c.swatchHex, surcharge: f.surcharge,
      sofaTier: f.sofaTier ?? null, bedframeTier: f.bedframeTier ?? null,
    });
  };

  if (lib.isLoading || colours.isLoading) return <p className={styles.muted}>Loading fabrics…</p>;
  if (fabrics.length === 0) return <p className={styles.muted}>No fabrics enabled for this Model.</p>;

  return (
    <>
      <section className={styles.block}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>Fabric</span>
        </header>
        <div className={styles.fabricRow}>
          {fabrics.map((f) => {
            const on = f.id === fabricId;
            const tierForCtx = (category === 'BEDFRAME' ? f.bedframeTier : f.sofaTier) as FabricTier | null;
            const tierDelta = addonConfig ? fabricTierAddon(category, tierForCtx, addonConfig) : 0;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                className={`${styles.fabricChip} ${on ? styles.fabricChipOn : ''}`}
                onClick={() => {
                  // Selecting a fabric snaps colour to that fabric's first colour.
                  const first = (colours.data ?? [])
                    .filter((c) => c.fabricId === f.id)
                    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
                  if (first) pick(f.id, first.colourId);
                }}
              >
                <span className={styles.fabricName}>{f.label}</span>
                <span className={styles.fabricMeta}>{tierDelta > 0 ? `+${fmtRM(tierDelta)}` : 'Included'}</span>
              </button>
            );
          })}
        </div>
      </section>

      <section className={styles.block}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>Colour</span>
        </header>
        <div className={styles.colourRow}>
          {coloursForFabric.map((c) => {
            const on = c.colourId === colourId;
            return (
              <button
                key={c.colourId}
                type="button"
                aria-pressed={on}
                aria-label={c.label}
                title={c.label}
                className={`${styles.swatch} ${on ? styles.swatchOn : ''}`}
                style={{ background: c.swatchHex ?? '#ccc' }}
                onClick={() => fabricId && pick(fabricId, c.colourId)}
              />
            );
          })}
        </div>
      </section>
    </>
  );
};
