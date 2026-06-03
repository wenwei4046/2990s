import { useMemo, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useBedframeColours, useBedframeOptions, type BedframeOptionRow, type SpecialAddonRow } from '../lib/queries';
import styles from './BedframeOptions.module.css';

// Special Add-ons price in SEN; bedframe surcharges are RM. base + Σ chosen
// option-group extras, ÷100. selling_price_sen is always a multiple of 100
// (Master Admin enters whole RM), so RM round-trips exactly → no drift.
const senToRm = (sen: number): number => Math.round(sen) / 100;
export const addonSurchargeRM = (addon: SpecialAddonRow, choices: string[]): number => {
  let sen = addon.sellingPriceSen;
  addon.optionGroups.forEach((g, i) => {
    const label = choices[i];
    const hit = label ? g.choices.find((c) => c.label === label) : undefined;
    if (hit) sen += hit.extraSen;
  });
  return senToRm(sen);
};
// When an add-on is ticked, default each REQUIRED group to its first choice.
const defaultChoices = (addon: SpecialAddonRow): string[] =>
  addon.optionGroups.map((g) => (g.required && g.choices[0] ? g.choices[0].label : ''));

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
  // Special Add-ons (migration 0134): id = special_addons.code; choices[i] = the
  // chosen option-group label for optionGroups[i] ('' when none / not required);
  // surcharge (RM) = base + Σ chosen choice extras, so bedframeSurcharge picks it up.
  specials: { id: string; label: string; surcharge: number; choices?: string[] }[];
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
  /** Fabric+colour picker (migration 0124) — bedframe picks a fabric, then the
   *  fabric's colour (replaces the standalone colour dropdown). */
  fabricBlock?: ReactNode;
  /** Special Add-ons (migration 0134) — already filtered to this Model's
   *  allowed_options.specials ∩ BEDFRAME ∩ active by the parent. Replaces the
   *  legacy bedframe_options 'special' chips. */
  specialAddons?: SpecialAddonRow[];
}

// Colour + dimension option dropdowns for a bedframe_build Model. Controlled —
// the Configurator owns the selection so the topbar LIVE TOTAL + Add-to-Cart
// gate can read it. Colours come from the Model's ticked
// product_bedframe_colours; gap/leg/divan/special from the global
// bedframe_options grouped by kind. The single-select options are dropdowns so
// the rail stays compact on the tablet (no long chip rows to scroll past);
// specials remain a multi-select chip row.
export const BedframeOptions = ({ productId, isDivan, value, onChange, fabricBlock, specialAddons = [] }: BedframeOptionsProps) => {
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
  // Special Add-ons (migration 0134): source from special_addons (passed in,
  // already allowed-filtered) — NOT the legacy bedframe_options 'special' chips.
  // id = code; ticking defaults required groups; surcharge = base + chosen extras.
  const toggleSpecial = (addon: SpecialAddonRow) => {
    const has = value.specials.some((s) => s.id === addon.code);
    if (has) {
      onChange({ ...value, specials: value.specials.filter((s) => s.id !== addon.code) });
      return;
    }
    const choices = defaultChoices(addon);
    onChange({
      ...value,
      specials: [...value.specials, { id: addon.code, label: addon.label, choices, surcharge: addonSurchargeRM(addon, choices) }],
    });
  };
  const changeChoice = (addon: SpecialAddonRow, groupIdx: number, label: string) => {
    onChange({
      ...value,
      specials: value.specials.map((s) => {
        if (s.id !== addon.code) return s;
        const choices = [...(s.choices ?? [])];
        choices[groupIdx] = label;
        return { ...s, choices, surcharge: addonSurchargeRM(addon, choices) };
      }),
    });
  };

  if (colours.isLoading || options.isLoading) return <p className={styles.muted}>Loading options…</p>;

  const colourRows = colours.data ?? [];

  return (
    <div className={styles.rows}>
      {/* Fabric+colour (migration 0124): pick a fabric, then its colour — the
          fabricBlock replaces the legacy standalone colour dropdown (fallback). */}
      {fabricBlock ?? (
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
      )}

      {!isDivan && (
        <OptionSelect label="Mattress gap" required opts={byKind.gap ?? []} selectedId={value.gapId} onPick={pickGap} />
      )}

      <OptionSelect label="Leg height" required opts={byKind.leg_height ?? []} selectedId={value.legId} onPick={pickLeg} />

      {!isDivan && (
        <>
          <OptionSelect label="Divan height" required opts={byKind.divan_height ?? []} selectedId={value.divanId} onPick={pickDivan} />

          {specialAddons.length > 0 && (
            <section className={styles.specialsBlock}>
              <header className={styles.head}>
                <span className={styles.eyebrow}>Special Add-ons</span>
                <span className={styles.opt}>Optional</span>
              </header>
              <div className={styles.chipRow}>
                {specialAddons.map((addon) => {
                  const on = value.specials.some((s) => s.id === addon.code);
                  const baseRm = senToRm(addon.sellingPriceSen);
                  return (
                    <button
                      key={addon.code}
                      type="button"
                      aria-pressed={on}
                      className={`${styles.chip} ${on ? styles.chipOn : ''}`}
                      onClick={() => toggleSpecial(addon)}
                    >
                      <span className={styles.chipVal}>{addon.label}</span>
                      {baseRm !== 0 && <span className={styles.chipMeta}>{baseRm > 0 ? '+' : '−'}{fmtRM(Math.abs(baseRm))}</span>}
                    </button>
                  );
                })}
              </div>
              {/* Follow-up choice pickers for ticked add-ons that have option_groups. */}
              {value.specials.map((sel) => {
                const addon = specialAddons.find((a) => a.code === sel.id);
                if (!addon || addon.optionGroups.length === 0) return null;
                return addon.optionGroups.map((g, gi) => (
                  <div className={`${styles.row} ${styles.specialChoiceRow}`} key={`${sel.id}-${gi}`} style={{ marginTop: 'var(--space-2)' }}>
                    <span className={styles.rowLabel}>
                      {addon.label} · {g.label} {g.required && <span className={styles.req}>Required</span>}
                    </span>
                    <div className={styles.selectWrap}>
                      <select
                        className={styles.select}
                        value={(sel.choices ?? [])[gi] ?? ''}
                        onChange={(e) => changeChoice(addon, gi, e.target.value)}
                        aria-label={`${addon.label} ${g.label}`}
                      >
                        {!g.required && <option value="">None</option>}
                        {g.choices.map((c) => (
                          <option key={c.label} value={c.label}>
                            {c.label}{c.extraSen !== 0 ? ` · ${c.extraSen > 0 ? '+' : '−'}${fmtRM(Math.abs(senToRm(c.extraSen)))}` : ''}
                          </option>
                        ))}
                      </select>
                      <ChevronDown className={styles.chevron} size={16} strokeWidth={1.75} aria-hidden />
                    </div>
                  </div>
                ));
              })}
            </section>
          )}
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
