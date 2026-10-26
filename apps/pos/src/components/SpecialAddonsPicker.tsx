import { ChevronDown } from 'lucide-react';
import { fmtRM, normalizeCompartmentCode, specialAddonBaseSellingSen } from '@2990s/shared';
import type { SpecialAddonRow } from '../lib/queries';
import styles from './BedframeOptions.module.css';

// Reusable Special Add-ons picker (migration 0134) — chips + per-group choice
// pickers — shared by the sofa + mattress configurators. (BedframeOptions keeps
// its own inline copy of this logic since it's already live; same shapes.)
// Selection item: id = special_addons.code; choices[i] = chosen option-group
// label for optionGroups[i] (''=none); surcharge (RM) = base + Σ chosen extras.
export type SpecialSel = { id: string; label: string; surcharge: number; choices?: string[] };

const senToRm = (sen: number): number => Math.round(sen) / 100;

/** A sofa build's compartment codes (canonical) — what Houzs reads off the
 *  line's cells to price an add-on by compartment. */
export const sofaBuildCompartments = (cells: ReadonlyArray<{ moduleId?: string | null }> | null | undefined): string[] =>
  (cells ?? []).map((c) => normalizeCompartmentCode(String(c.moduleId ?? ''))).filter(Boolean);

/** RM surcharge for one add-on given its chosen per-group choice labels. On a
 *  sofa, `buildCompartments` (canonical codes) picks a compartment price the
 *  way the server does (specialAddonBaseSellingSen); null = no build. */
export const specialSelSurchargeRM = (
  addon: SpecialAddonRow,
  choices: string[],
  buildCompartments: readonly string[] | null,
): number => {
  let sen = specialAddonBaseSellingSen(addon, buildCompartments);
  addon.optionGroups.forEach((g, i) => {
    const label = choices[i];
    const hit = label ? g.choices.find((c) => c.label === label) : undefined;
    if (hit) sen += hit.extraSen;
  });
  return senToRm(sen);
};

const defaultChoices = (addon: SpecialAddonRow): string[] =>
  addon.optionGroups.map((g) => (g.required && g.choices[0] ? g.choices[0].label : ''));

/** Sum of every selected add-on's RM surcharge — add onto the line total. */
export const specialSelsSurcharge = (sels: SpecialSel[]): number =>
  sels.reduce((acc, s) => acc + s.surcharge, 0);

/** The same sum re-priced for the sofa's CURRENT compartments. A selection's
 *  stored surcharge is a snapshot from when it was ticked, so a sofa whose
 *  layout changed since must re-read it; an add-on no longer on offer keeps it. */
export const specialSelsSurchargeFor = (
  sels: SpecialSel[],
  addons: SpecialAddonRow[],
  buildCompartments: readonly string[] | null,
): number =>
  sels.reduce((acc, s) => {
    const addon = addons.find((a) => a.code === s.id);
    return acc + (addon ? specialSelSurchargeRM(addon, s.choices ?? [], buildCompartments) : s.surcharge);
  }, 0);

export interface SpecialAddonsPickerProps {
  /** Already filtered to the Model's allowed_options.specials ∩ category ∩ active. */
  addons: SpecialAddonRow[];
  value: SpecialSel[];
  onChange: (next: SpecialSel[]) => void;
  title?: string;
  /** The sofa's compartment codes, so an add-on priced by compartment shows
   *  this sofa's price. Omit off a sofa. */
  buildCompartments?: readonly string[] | null;
}

export const SpecialAddonsPicker = ({ addons, value, onChange, title = 'Special Add-ons', buildCompartments = null }: SpecialAddonsPickerProps) => {
  if (addons.length === 0) return null;

  const toggle = (addon: SpecialAddonRow) => {
    const has = value.some((s) => s.id === addon.code);
    if (has) {
      onChange(value.filter((s) => s.id !== addon.code));
      return;
    }
    const choices = defaultChoices(addon);
    onChange([...value, { id: addon.code, label: addon.label, choices, surcharge: specialSelSurchargeRM(addon, choices, buildCompartments) }]);
  };
  const changeChoice = (addon: SpecialAddonRow, groupIdx: number, label: string) => {
    onChange(value.map((s) => {
      if (s.id !== addon.code) return s;
      const choices = [...(s.choices ?? [])];
      choices[groupIdx] = label;
      return { ...s, choices, surcharge: specialSelSurchargeRM(addon, choices, buildCompartments) };
    }));
  };

  return (
    <section className={styles.specialsBlock}>
      <header className={styles.head}>
        <span className={styles.eyebrow}>{title}</span>
        <span className={styles.opt}>Optional</span>
      </header>
      <div className={styles.chipRow}>
        {addons.map((addon) => {
          const on = value.some((s) => s.id === addon.code);
          const baseRm = senToRm(specialAddonBaseSellingSen(addon, buildCompartments));
          return (
            <button
              key={addon.code}
              type="button"
              aria-pressed={on}
              className={`${styles.chip} ${on ? styles.chipOn : ''}`}
              onClick={() => toggle(addon)}
            >
              <span className={styles.chipVal}>{addon.label}</span>
              {baseRm !== 0 && <span className={styles.chipMeta}>{baseRm > 0 ? '+' : '−'}{fmtRM(Math.abs(baseRm))}</span>}
            </button>
          );
        })}
      </div>
      {/* Follow-up choice pickers for ticked add-ons that have option_groups. */}
      {value.map((sel) => {
        const addon = addons.find((a) => a.code === sel.id);
        if (!addon || addon.optionGroups.length === 0) return null;
        return addon.optionGroups.map((g, gi) => (
          <div className={styles.row} key={`${sel.id}-${gi}`} style={{ marginTop: 'var(--space-2)' }}>
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
  );
};
