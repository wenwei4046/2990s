import { useMemo } from 'react';
import { fmtRM, fabricTierAddon, type FabricTier, type FabricTierAddonConfig, type FabricTierModelOverride } from '@2990s/shared';
import { useFabricLibrary, useFabricColours, type ProductFabricRow } from '../lib/queries';
import { colourText, groupFabricSeries } from '../lib/fabric-series-groups';
import { useFabricSeriesNames } from '../lib/fabric-series-queries';
import styles from './FabricColourPicker.module.css';

// Chips show code + colour name, e.g. "CG-015 Mint" (Chairman 2026-06-03).

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
  /** Saved display series disambiguates a colour-KIV selection when one
   *  canonical fabric is split across several named series. */
  fabricLabel?: string | null;
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
export const FabricColourPicker = ({ productFabrics, fabricId, fabricLabel, colourId, onChange, category = 'SOFA', addonConfig = null, modelOverride = null, enabledColourIds = null, optional = false, onClear }: FabricColourPickerProps) => {
  const lib = useFabricLibrary();
  const colours = useFabricColours();
  const savedNames = useFabricSeriesNames();

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
      .filter((pf) => pf.active && byId.get(pf.fabricId)?.active)
      .map((pf) => ({ ...byId.get(pf.fabricId)!, surcharge: pf.surcharge }))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [productFabrics, lib.data]);

  // Use the same saved series as Modular. A display series can merge several
  // pricing IDs (KN01/KN13 -> EMBRACE), or split one pricing ID by colour.
  const availableColours = useMemo(() => {
    const offered = new Set(fabrics.map((f) => f.id));
    return (colours.data ?? [])
      .filter((c) => c.active && offered.has(c.fabricId) && (!enabledSet || enabledSet.has(c.colourId)))
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [colours.data, fabrics, enabledSet]);
  const grouped = useMemo(
    () => groupFabricSeries(fabrics, availableColours, savedNames.data ?? []),
    [fabrics, availableColours, savedNames.data],
  );
  const series = grouped.series.filter((s) => (grouped.coloursBySeries.get(s.id)?.length ?? 0) > 0);
  const matchingSeries = series.filter((s) => grouped.coloursBySeries.get(s.id)!.some(
    (c) => c.fabricId === fabricId && (colourId == null || c.colourId === colourId),
  ));
  const selectedSeries = matchingSeries.find((s) => s.label === fabricLabel) ?? matchingSeries[0];
  const coloursForSeries = (grouped.coloursBySeries.get(selectedSeries?.id ?? '') ?? [])
    .flatMap((chip) => {
      const colour = availableColours.find((c) => c.fabricId === chip.fabricId && c.colourId === chip.colourId);
      return colour ? [colour] : [];
    });
  const tierDelta = (fId: string) => {
    const f = fabrics.find((row) => row.id === fId);
    const tier = (category === 'BEDFRAME' ? f?.bedframeTier : f?.sofaTier) as FabricTier | null;
    return addonConfig ? fabricTierAddon(category, tier, addonConfig, modelOverride) : 0;
  };
  const deltaLabel = (delta: number) => delta > 0 ? `+${fmtRM(delta)}` : 'Included';
  const mixedColourPrices = new Set(coloursForSeries.map((c) => tierDelta(c.fabricId))).size > 1;

  const pick = (fId: string, cId: string, seriesLabel: string) => {
    const f = fabrics.find((x) => x.id === fId);
    const c = availableColours.find((x) => x.fabricId === fId && x.colourId === cId);
    if (!f || !c) return;
    onChange({
      fabricId: fId, colourId: cId, fabricLabel: seriesLabel, colourLabel: colourText(c),
      colourHex: c.swatchHex, surcharge: f.surcharge,
      sofaTier: f.sofaTier ?? null, bedframeTier: f.bedframeTier ?? null,
    });
  };

  // Colour KIV (Loo 2026-06-12): keep the chosen fabric — its tier add-on is
  // already in the price — but leave the colour to a later My-orders fill-in.
  const pickColourKiv = () => {
    const f = fabrics.find((x) => x.id === fabricId);
    if (!f || !selectedSeries) return;
    onChange({
      fabricId: f.id, colourId: null, fabricLabel: selectedSeries.label, colourLabel: null,
      colourHex: null, surcharge: f.surcharge,
      sofaTier: f.sofaTier ?? null, bedframeTier: f.bedframeTier ?? null,
    });
  };

  if (lib.isLoading || colours.isLoading || savedNames.isLoading) return <p className={styles.muted}>Loading fabrics…</p>;
  if (savedNames.isError && !savedNames.data) return <p role="alert" className={styles.muted}>Could not load fabric series.</p>;
  if (series.length === 0) return <p className={styles.muted}>No fabrics enabled for this Model.</p>;

  return (
    <>
      <section className={styles.block}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>Fabric</span>
          {optional && <span className={styles.optionalHint}>Optional — can be confirmed later</span>}
        </header>
        <div className={styles.fabricRow}>
          {series.map((s) => {
            const on = s.id === selectedSeries?.id;
            const members = grouped.coloursBySeries.get(s.id)!;
            const deltas = members.map((c) => tierDelta(c.fabricId));
            const min = Math.min(...deltas);
            const max = Math.max(...deltas);
            const priceLabel = on && fabricId ? deltaLabel(tierDelta(fabricId))
              : min === max ? deltaLabel(min) : `${deltaLabel(min)} – ${deltaLabel(max)}`;
            return (
              <button
                key={s.id}
                type="button"
                aria-pressed={on}
                className={`${styles.fabricChip} ${on ? styles.fabricChipOn : ''}`}
                onClick={() => {
                  // Selecting a series snaps colour to its first ENABLED colour.
                  const first = members[0];
                  if (first) pick(first.fabricId, first.colourId, s.label);
                }}
              >
                <span className={styles.fabricName}>{s.label}</span>
                <span className={styles.fabricMeta}>{priceLabel}</span>
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
          {optional && selectedSeries && <span className={styles.optionalHint}>Can be KIV — confirmed later</span>}
        </header>
        {/* KIV chip (Loo 2026-06-12) — the customer commits to the fabric
            SERIES (tier add-on charged now) but confirms the colour later.
            The order waits in My orders until the colour is filled in. */}
        {optional && selectedSeries && (
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
          {coloursForSeries.map((c) => {
            const on = c.fabricId === fabricId && c.colourId === colourId;
            // Swatch + visible name. Fabrics synced from the Fabric Converter
            // have no swatch hex yet, so the name is what the customer reads
            // (Chairman 2026-06-01 "先纯色块 + 名字"). Photos land later.
            return (
              <span
                key={`${c.fabricId}:${c.colourId}`}
                style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, width: 80 }}
              >
                <button
                  type="button"
                  aria-pressed={on}
                  aria-label={colourText(c)}
                  title={colourText(c)}
                  className={`${styles.swatch} ${on ? styles.swatchOn : ''}`}
                  style={{ background: c.swatchHex ?? '#ccc' }}
                  onClick={() => selectedSeries && pick(c.fabricId, c.colourId, selectedSeries.label)}
                />
                <span style={{ fontSize: 'var(--fs-12)', lineHeight: 1.15, textAlign: 'center', color: on ? 'var(--c-ink)' : 'var(--fg-muted)' }}>
                  {colourText(c)}
                </span>
                {mixedColourPrices && <span className={styles.fabricMeta}>{deltaLabel(tierDelta(c.fabricId))}</span>}
              </span>
            );
          })}
        </div>
      </section>
    </>
  );
};
