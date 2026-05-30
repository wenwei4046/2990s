import { useMemo } from 'react';
import { ChevronDown } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useBedframeColours, useBedframeOptions, type BedframeOptionRow } from '../lib/queries';
import styles from './BedframeOptions.module.css';

// Resolved bedframe selection — carries labels + surcharges so the Configurator
// can render the LIVE TOTAL + summary + Add-to-Cart gate without another DB
// lookup (mirrors FabricSelection). gap/divan/specials stay empty for DIVAN
// ONLY Models (only colour + leg are shown). Surcharges are 0 for pilot but
// threaded through so a future Backend price edit flows to the total.
export interface BedframeSelection {
  colourId: string | null;
  colourLabel: string | null;
  colourHex: string | null;
  colourSurcharge: number;
  gapId: string | null;     gapLabel: string | null;     gapSurcharge: number;
  legId: string | null;     legLabel: string | null;     legSurcharge: number;
  divanId: string | null;   divanLabel: string | null;   divanSurcharge: number;
  specials: { id: string; label: string; surcharge: number }[];
}

export const emptyBedframeSelection: BedframeSelection = {
  colourId: null, colourLabel: null, colourHex: null, colourSurcharge: 0,
  gapId: null, gapLabel: null, gapSurcharge: 0,
  legId: null, legLabel: null, legSurcharge: 0,
  divanId: null, divanLabel: null, divanSurcharge: 0,
  specials: [],
};

// Sum of every selected surcharge (colour + the three dimension options + each
// special). Added onto the size-variant base price for the line total.
export const bedframeSurcharge = (s: BedframeSelection): number =>
  s.colourSurcharge + s.gapSurcharge + s.legSurcharge + s.divanSurcharge +
  s.specials.reduce((acc, sp) => acc + sp.surcharge, 0);

export interface BedframeOptionsProps {
  productId: string;
  /** DIVAN ONLY models render only colour + leg (no gap/divan/specials). */
  isDivan: boolean;
  value: BedframeSelection;
  onChange: (next: BedframeSelection) => void;
}

// Colour + dimension option dropdowns for a bedframe_build Model. Controlled —
// the Configurator owns the selection so the topbar LIVE TOTAL + Add-to-Cart
// gate can read it. Colours come from the Model's ticked
// product_bedframe_colours; gap/leg/divan/special from the global
// bedframe_options grouped by kind. The single-select options are dropdowns so
// the rail stays compact on the tablet (no long chip rows to scroll past);
// specials remain a multi-select chip row.
export const BedframeOptions = ({ productId, isDivan, value, onChange }: BedframeOptionsProps) => {
  const colours = useBedframeColours(productId);
  const options = useBedframeOptions();

  const byKind = useMemo(() => {
    const m: Record<string, BedframeOptionRow[]> = {
      gap: [], leg_height: [], divan_height: [], special: [],
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

  const colourRows = colours.data ?? [];

  return (
    <div className={styles.rows}>
      {/* Colour — dropdown with a swatch dot in the trigger so the chosen
          colour stays recognisable without the full swatch grid. */}
      <div className={styles.row}>
        <span className={styles.rowLabel}>
          Colour <span className={styles.req}>Required</span>
        </span>
        {colourRows.length === 0 ? (
          <span className={styles.muted}>No colours enabled.</span>
        ) : (
          <div className={styles.selectWrap}>
            <span
              className={styles.swatchDot}
              style={{ background: value.colourHex ?? 'var(--c-paper)' }}
              aria-hidden
            />
            <select
              className={`${styles.select} ${styles.selectSwatch}`}
              value={value.colourId ?? ''}
              onChange={(e) => pickColour(e.target.value)}
              aria-label="Colour"
            >
              <option value="" disabled>Choose colour</option>
              {colourRows.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}{c.surcharge > 0 ? ` · +${fmtRM(c.surcharge)}` : ''}
                </option>
              ))}
            </select>
            <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden />
          </div>
        )}
      </div>

      {!isDivan && (
        <OptionSelect label="Mattress gap" required opts={byKind.gap ?? []} selectedId={value.gapId} onPick={pickGap} />
      )}

      <OptionSelect label="Leg height" required opts={byKind.leg_height ?? []} selectedId={value.legId} onPick={pickLeg} />

      {!isDivan && (
        <>
          <OptionSelect label="Divan height" required opts={byKind.divan_height ?? []} selectedId={value.divanId} onPick={pickDivan} />

          <section className={styles.specialsBlock}>
            <header className={styles.head}>
              <span className={styles.eyebrow}>Specials</span>
              <span className={styles.opt}>Optional</span>
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
    </div>
  );
};

interface OptionSelectProps {
  label: string;
  required?: boolean;
  opts: BedframeOptionRow[];
  selectedId: string | null;
  onPick: (o: BedframeOptionRow) => void;
}

// Single-select dropdown for one dimension option kind (gap / leg / divan).
const OptionSelect = ({ label, required, opts, selectedId, onPick }: OptionSelectProps) => (
  <div className={styles.row}>
    <span className={styles.rowLabel}>
      {label} {required && <span className={styles.req}>Required</span>}
    </span>
    <div className={styles.selectWrap}>
      <select
        className={styles.select}
        value={selectedId ?? ''}
        onChange={(e) => {
          const o = opts.find((x) => x.id === e.target.value);
          if (o) onPick(o);
        }}
        aria-label={label}
      >
        <option value="" disabled>Choose</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.value}{o.surcharge > 0 ? ` · +${fmtRM(o.surcharge)}` : ''}
          </option>
        ))}
      </select>
      <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden />
    </div>
  </div>
);
