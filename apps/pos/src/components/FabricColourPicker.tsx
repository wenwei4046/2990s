import { useMemo } from 'react';
import { fmtRM, fabricTierAddon, type FabricTier, type FabricTierAddonConfig, type FabricTierModelOverride } from '@2990s/shared';
import { useFabricLibrary, useFabricColours, type ProductFabricRow } from '../lib/queries';
import styles from './FabricColourPicker.module.css';

export interface FabricSelection {
  fabricId: string;
  /** null = colour KIV (Loo 2026-06-12): the customer confirmed the fabric
   *  SERIES — so its tier add-on is charged now — but picks the colour later
   *  from My orders. The SO lands with fabricId but no colourId/fabricCode,
   *  so so-variant-rule keeps the Fabrics axis open until it's filled. */
  colourId: string | null;
  fabricLabel: string;
  colourLabel: string | null;
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
  /** Per-Model Δ override (migration 0172) for THIS Model, resolved by the
   *  parent from useModelFabricTierOverrides() by the configured model_id. When
   *  set, each chip's "+RM" reflects the Model's special. null = global. */
  modelOverride?: FabricTierModelOverride | null;
  /** Per-Model enabled colour codes (allowed_options.fabrics). When provided,
   *  only these colours render under each series. null/undefined = no filter. */
  enabledColourIds?: string[] | null;
  /** Sofa + bedframe (Loo 2026-06-11): the customer may confirm fabric later,
   *  so the pick is optional at Add-to-Cart — renders the "Optional" hint + a
   *  "Confirm later" chip that clears the selection via onClear. The SO still
   *  demands a fabricCode before a Processing date / Proceed (shared
   *  so-variant-rule), so the order can't reach production unconfirmed. */
  optional?: boolean;
  onClear?: () => void;
}

// Fabric + Colour selection for a sofa. Fabric chips show a transparent
// "+RM" surcharge (or "Included"); colour swatches belong to the chosen
// fabric (spec 2026-05-24, G3). Controlled — the Configurator owns the state
// so the topbar LIVE TOTAL + Add-to-Cart gate can read it.
export const FabricColourPicker = ({ productFabrics, fabricId, colourId, onChange, category = 'SOFA', addonConfig = null, modelOverride = null, enabledColourIds = null, optional = false, onClear }: FabricColourPickerProps) => {
  const lib = useFabricLibrary();
  const colours = useFabricColours();

  // Per-Model colour gate (allowed_options.fabrics). null = no restriction.
  const enabledSet = useMemo(
    () => (enabledColourIds ? new Set(enabledColourIds) : null),
    [enabledColourIds],
  );

  // Active fabrics (series) offered on this Model, joined to the library for
  // label/tier. The parent only passes series that have ≥1 enabled colour.
  const fabrics = useMemo(() => {
    const byId = new Map((lib.data ?? []).map((f) => [f.id, f]));
    return productFabrics
      .filter((pf) => pf.active && byId.has(pf.fabricId))
      .map((pf) => ({ ...byId.get(pf.fabricId)!, surcharge: pf.surcharge }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [productFabrics, lib.data]);

  // Colours of the chosen series, gated to the Model's enabled set.
  const coloursForFabric = useMemo(
    () => (colours.data ?? [])
      .filter((c) => c.fabricId === fabricId && (!enabledSet || enabledSet.has(c.colourId)))
      .sort((a, b) => a.sortOrder - b.sortOrder),
    [colours.data, fabricId, enabledSet],
  );

  // Show the fabric CODE + colour name, e.g. "CG-015 Mint" (Chairman 2026-06-03).
  // BF colours carry no name (label === code) → just the code "BF-01", no double-up.
  const colourText = (c: { colourId: string; label: string }) =>
    c.label && c.label !== c.colourId ? `${c.colourId} ${c.label}` : c.colourId;

  const pick = (fId: string, cId: string) => {
    const f = fabrics.find((x) => x.id === fId);
    const c = (colours.data ?? []).find((x) => x.fabricId === fId && x.colourId === cId);
    if (!f || !c) return;
    onChange({
      fabricId: fId, colourId: cId, fabricLabel: f.label, colourLabel: colourText(c),
      colourHex: c.swatchHex, surcharge: f.surcharge,
      sofaTier: f.sofaTier ?? null, bedframeTier: f.bedframeTier ?? null,
    });
  };

  // Colour KIV (Loo 2026-06-12): keep the chosen fabric — its tier add-on is
  // already in the price — but leave the colour to a later My-orders fill-in.
  const pickColourKiv = () => {
    const f = fabrics.find((x) => x.id === fabricId);
    if (!f) return;
    onChange({
      fabricId: f.id, colourId: null, fabricLabel: f.label, colourLabel: null,
      colourHex: null, surcharge: f.surcharge,
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
          {optional && <span className={styles.optionalHint}>Optional — can be confirmed later</span>}
        </header>
        <div className={styles.fabricRow}>
          {fabrics.map((f) => {
            const on = f.id === fabricId;
            const tierForCtx = (category === 'BEDFRAME' ? f.bedframeTier : f.sofaTier) as FabricTier | null;
            const tierDelta = addonConfig ? fabricTierAddon(category, tierForCtx, addonConfig, modelOverride) : 0;
            return (
              <button
                key={f.id}
                type="button"
                aria-pressed={on}
                className={`${styles.fabricChip} ${on ? styles.fabricChipOn : ''}`}
                onClick={() => {
                  // Selecting a series snaps colour to its first ENABLED colour.
                  const first = (colours.data ?? [])
                    .filter((c) => c.fabricId === f.id && (!enabledSet || enabledSet.has(c.colourId)))
                    .sort((a, b) => a.sortOrder - b.sortOrder)[0];
                  if (first) pick(f.id, first.colourId);
                }}
              >
                <span className={styles.fabricName}>{f.label}</span>
                <span className={styles.fabricMeta}>{tierDelta > 0 ? `+${fmtRM(tierDelta)}` : 'Included'}</span>
              </button>
            );
          })}
          {optional && (
            <button
              type="button"
              aria-pressed={fabricId == null}
              className={`${styles.fabricChip} ${fabricId == null ? styles.fabricChipOn : ''}`}
              onClick={() => onClear?.()}
            >
              <span className={styles.fabricName}>Confirm later</span>
              <span className={styles.fabricMeta}>Customer to confirm</span>
            </button>
          )}
        </div>
      </section>

      <section className={styles.block}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>Colour</span>
          {optional && fabricId != null && <span className={styles.optionalHint}>Can be KIV — confirmed later</span>}
        </header>
        {/* KIV chip (Loo 2026-06-12) — the customer commits to the fabric
            SERIES (tier add-on charged now) but confirms the colour later.
            The order waits in My orders until the colour is filled in. */}
        {optional && fabricId != null && (
          <div className={styles.fabricRow} style={{ marginBottom: 10 }}>
            <button
              type="button"
              aria-pressed={colourId == null}
              className={`${styles.fabricChip} ${colourId == null ? styles.fabricChipOn : ''}`}
              onClick={() => pickColourKiv()}
            >
              <span className={styles.fabricName}>KIV</span>
              <span className={styles.fabricMeta}>Colour to confirm later</span>
            </button>
          </div>
        )}
        <div className={styles.colourRow}>
          {coloursForFabric.map((c) => {
            const on = c.colourId === colourId;
            // Swatch + visible name. Fabrics synced from the Fabric Converter
            // have no swatch hex yet, so the name is what the customer reads
            // (Chairman 2026-06-01 "先纯色块 + 名字"). Photos land later.
            return (
              <span
                key={c.colourId}
                style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 80 }}
              >
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={colourText(c)}
                  title={colourText(c)}
                  className={`${styles.swatch} ${on ? styles.swatchOn : ''}`}
                  style={{ background: c.swatchHex ?? '#ccc' }}
                  onClick={() => fabricId && pick(fabricId, c.colourId)}
                />
                <span style={{ fontSize: 'var(--fs-12)', lineHeight: 1.15, textAlign: 'center', color: on ? 'var(--c-ink)' : 'var(--fg-muted)' }}>
                  {colourText(c)}
                </span>
              </span>
            );
          })}
        </div>
      </section>
    </>
  );
};
