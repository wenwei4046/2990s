import { useMemo } from 'react';
import { fmtRM } from '@2990s/shared';
import { useBedframeColours, useBedframeOptions, type BedframeOptionRow } from '../lib/queries';
import styles from './BedframeOptions.module.css';

// Resolved bedframe selection — carries labels + surcharges so the Configurator
// can render the LIVE TOTAL + summary + Add-to-Cart gate without another DB
// lookup (mirrors FabricSelection). gap/divan/total/specials stay empty for
// DIVAN ONLY Models (only colour + leg are shown). Surcharges are 0 for pilot
// but threaded through so a future Backend price edit flows to the total.
export interface BedframeSelection {
  colourId: string | null;
  colourLabel: string | null;
  colourHex: string | null;
  colourSurcharge: number;
  gapId: string | null;     gapLabel: string | null;     gapSurcharge: number;
  legId: string | null;     legLabel: string | null;     legSurcharge: number;
  divanId: string | null;   divanLabel: string | null;   divanSurcharge: number;
  totalId: string | null;   totalLabel: string | null;   totalSurcharge: number;
  specials: { id: string; label: string; surcharge: number }[];
}

export const emptyBedframeSelection: BedframeSelection = {
  colourId: null, colourLabel: null, colourHex: null, colourSurcharge: 0,
  gapId: null, gapLabel: null, gapSurcharge: 0,
  legId: null, legLabel: null, legSurcharge: 0,
  divanId: null, divanLabel: null, divanSurcharge: 0,
  totalId: null, totalLabel: null, totalSurcharge: 0,
  specials: [],
};

// Sum of every selected surcharge (colour + the four dimension options + each
// special). Added onto the size-variant base price for the line total.
export const bedframeSurcharge = (s: BedframeSelection): number =>
  s.colourSurcharge + s.gapSurcharge + s.legSurcharge + s.divanSurcharge + s.totalSurcharge +
  s.specials.reduce((acc, sp) => acc + sp.surcharge, 0);

export interface BedframeOptionsProps {
  productId: string;
  /** DIVAN ONLY models render only colour + leg (no gap/divan/total/specials). */
  isDivan: boolean;
  value: BedframeSelection;
  onChange: (next: BedframeSelection) => void;
}

// Colour swatch picker + dimension option chips for a bedframe_build Model.
// Controlled — the Configurator owns the selection so the topbar LIVE TOTAL +
// Add-to-Cart gate can read it. Colours come from the Model's ticked
// product_bedframe_colours; gap/leg/divan/total/specials from the global
// bedframe_options grouped by kind.
export const BedframeOptions = ({ productId, isDivan, value, onChange }: BedframeOptionsProps) => {
  const colours = useBedframeColours(productId);
  const options = useBedframeOptions();

  const byKind = useMemo(() => {
    const m: Record<string, BedframeOptionRow[]> = {
      gap: [], leg_height: [], divan_height: [], total_height: [], special: [],
    };
    for (const o of options.data ?? []) (m[o.kind] ??= []).push(o);
    return m;
  }, [options.data]);

  const pickColour = (id: string) => {
    const c = (colours.data ?? []).find((x) => x.id === id);
    onChange({
      ...value,
      colourId: id, colourLabel: c?.label ?? null,
      colourHex: c?.swatchHex ?? null, colourSurcharge: c?.surcharge ?? 0,
    });
  };
  const pickGap = (o: BedframeOptionRow) =>
    onChange({ ...value, gapId: o.id, gapLabel: o.value, gapSurcharge: o.surcharge });
  const pickLeg = (o: BedframeOptionRow) =>
    onChange({ ...value, legId: o.id, legLabel: o.value, legSurcharge: o.surcharge });
  const pickDivan = (o: BedframeOptionRow) =>
    onChange({ ...value, divanId: o.id, divanLabel: o.value, divanSurcharge: o.surcharge });
  const pickTotal = (o: BedframeOptionRow) =>
    onChange({ ...value, totalId: o.id, totalLabel: o.value, totalSurcharge: o.surcharge });
  const toggleSpecial = (o: BedframeOptionRow) => {
    const has = value.specials.some((s) => s.id === o.id);
    onChange({
      ...value,
      specials: has
        ? value.specials.filter((s) => s.id !== o.id)
        : [...value.specials, { id: o.id, label: o.value, surcharge: o.surcharge }],
    });
  };

  if (colours.isLoading || options.isLoading) return <p className={styles.muted}>Loading options…</p>;

  return (
    <>
      <section className={styles.block}>
        <header className={styles.head}>
          <span className={styles.eyebrow}>Colour</span>
          <span className={styles.req}>Required</span>
        </header>
        {(colours.data ?? []).length === 0 ? (
          <p className={styles.muted}>No colours enabled for this Model.</p>
        ) : (
          <div className={styles.colourRow}>
            {(colours.data ?? []).map((c) => {
              const on = c.id === value.colourId;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  aria-label={c.label}
                  title={c.surcharge > 0 ? `${c.label} · +${fmtRM(c.surcharge)}` : c.label}
                  className={`${styles.swatch} ${on ? styles.swatchOn : ''}`}
                  style={{ background: c.swatchHex ?? '#ccc' }}
                  onClick={() => pickColour(c.id)}
                />
              );
            })}
          </div>
        )}
      </section>

      {!isDivan && (
        <OptionGroup label="Mattress gap" required opts={byKind.gap ?? []} selectedId={value.gapId} onPick={pickGap} />
      )}

      <OptionGroup label="Leg height" required opts={byKind.leg_height ?? []} selectedId={value.legId} onPick={pickLeg} />

      {!isDivan && (
        <>
          <OptionGroup label="Divan height" required opts={byKind.divan_height ?? []} selectedId={value.divanId} onPick={pickDivan} />
          <OptionGroup label="Total height" required opts={byKind.total_height ?? []} selectedId={value.totalId} onPick={pickTotal} />

          <section className={styles.block}>
            <header className={styles.head}>
              <span className={styles.eyebrow}>Specials</span>
              <span className={styles.req}>Optional</span>
            </header>
            <div className={styles.chipRow}>
              {(byKind.special ?? []).map((o) => {
                const on = value.specials.some((s) => s.id === o.id);
                return (
                  <button
                    key={o.id}
                    type="button"
                    aria-pressed={on}
                    className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                    onClick={() => toggleSpecial(o)}
                  >
                    <span className={styles.chipVal}>{o.value}</span>
                    {o.surcharge > 0 && <span className={styles.chipMeta}>+{fmtRM(o.surcharge)}</span>}
                  </button>
                );
              })}
            </div>
          </section>
        </>
      )}
    </>
  );
};

interface OptionGroupProps {
  label: string;
  required?: boolean;
  opts: BedframeOptionRow[];
  selectedId: string | null;
  onPick: (o: BedframeOptionRow) => void;
}

// Single-select chip row for one dimension option kind.
const OptionGroup = ({ label, required, opts, selectedId, onPick }: OptionGroupProps) => (
  <section className={styles.block}>
    <header className={styles.head}>
      <span className={styles.eyebrow}>{label}</span>
      {required && <span className={styles.req}>Required</span>}
    </header>
    <div className={styles.chipRow}>
      {opts.map((o) => {
        const on = o.id === selectedId;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={on}
            className={`${styles.chip} ${on ? styles.chipOn : ''}`}
            onClick={() => onPick(o)}
          >
            <span className={styles.chipVal}>{o.value}</span>
            {o.surcharge > 0 && <span className={styles.chipMeta}>+{fmtRM(o.surcharge)}</span>}
          </button>
        );
      })}
    </div>
  </section>
);
