// TargetEditorSheet — spec §2.1: the target profile editor demoted to a right
// slide-over. Draft state is seeded from the saved targets on mount (the sheet
// is mounted only while open, so seeding is fresh each open). The live preview
// scores the DRAFT against all period customers; the dashboard strip keeps
// scoring the SAVED profile — type-and-see feedback lives here, next to the
// typing, without destabilizing the strip.

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import {
  computeTargetMatch, GENDER_OPTIONS, RACE_OPTIONS,
  type SaCustomerRow, type TargetProfile,
} from '@2990s/shared';
import { useSaveTargets } from '../../lib/sales-analysis-queries';
import { Meter } from './primitives/Meter';
import sa from './SaShared.module.css';
import shell from '../../pages/SalesAnalysis.module.css';
import styles from './CustomerDataTab.module.css';

const pctStr = (v: number): string => `${Math.round(v)}%`;

interface TargetEditorSheetProps {
  customers: SaCustomerRow[];
  targets: TargetProfile;
  onClose: () => void;
}

export const TargetEditorSheet = ({ customers, targets, onClose }: TargetEditorSheetProps) => {
  // ---- editable target profile (local draft; Save persists) ----
  const [draft, setDraft] = useState<TargetProfile>(targets);
  const save = useSaveTargets();
  const closeRef = useRef<HTMLButtonElement>(null);

  // Focus the close button on open; Escape closes; lock body scroll while open.
  useEffect(() => {
    closeRef.current?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const setRace = (k: string, v: string) =>
    setDraft((d) => ({ ...d, raceTargets: { ...(d.raceTargets ?? {}), [k]: Number(v) || 0 } }));
  const setGender = (k: string, v: string) =>
    setDraft((d) => ({ ...d, genderTargets: { ...(d.genderTargets ?? {}), [k]: Number(v) || 0 } }));
  const raceSum = RACE_OPTIONS.reduce((s, k) => s + (draft.raceTargets?.[k] ?? 0), 0);
  const genderSum = GENDER_OPTIONS.reduce((s, k) => s + (draft.genderTargets?.[k] ?? 0), 0);

  const stateOpts = useMemo(
    () => [...new Set(customers.map((c) => c.state).filter((s): s is string => !!s && s.trim() !== ''))].sort(),
    [customers],
  );
  const cityOpts = useMemo(
    () => [...new Set(customers.map((c) => c.city).filter((s): s is string => !!s && s.trim() !== ''))].sort(),
    [customers],
  );
  const toggle = (arr: string[], v: string): string[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  // ---- live draft preview: the DRAFT against all period customers ----
  const draftMatch = useMemo(() => computeTargetMatch(customers, draft), [customers, draft]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(targets);

  const raceRowByKey = new Map(draftMatch.race.rows.map((r) => [r.key, r]));
  const genderRowByKey = new Map(draftMatch.gender.rows.map((r) => [r.key, r]));

  const previewDims = [
    { label: 'Age', configured: draftMatch.age.configured, score: draftMatch.age.score },
    { label: 'Race', configured: draftMatch.race.configured, score: draftMatch.race.score },
    { label: 'Gender', configured: draftMatch.gender.configured, score: draftMatch.gender.score },
    { label: 'Area', configured: draftMatch.area.configured, score: draftMatch.area.score },
  ];

  return createPortal(
    // .saRoot on the portal wrapper puts the --sa-* palette back in scope —
    // the portal renders outside the tab's .saRoot subtree.
    <div className={sa.saRoot}>
      <div className={styles.scrim} onClick={onClose} />
      <aside className={styles.sheet} role="dialog" aria-modal="true" aria-label="Target profile">
        <div className={styles.sheetHead}>
          <h2 className={styles.sheetTitle}>Target profile</h2>
          <button ref={closeRef} type="button" className={styles.sheetClose} aria-label="Close" onClick={onClose}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>

        <div className={styles.sheetBody}>
          <p className={styles.formCaption}>Age range (customers whose age falls between, inclusive)</p>
          <div className={styles.targetGrid}>
            <label className={styles.optLabel}>Min age
              <input className={shell.ageInput} type="number" min={0} max={120}
                value={draft.ageRangeMin ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, ageRangeMin: e.target.value === '' ? null : Number(e.target.value) }))} />
            </label>
            <label className={styles.optLabel}>Max age
              <input className={shell.ageInput} type="number" min={0} max={120}
                value={draft.ageRangeMax ?? ''}
                onChange={(e) => setDraft((d) => ({ ...d, ageRangeMax: e.target.value === '' ? null : Number(e.target.value) }))} />
            </label>
          </div>

          <p className={styles.formCaption}>Race targets (sum {Math.round(raceSum)}% — aim for 100%)</p>
          <div className={styles.targetGrid}>
            {RACE_OPTIONS.map((k) => {
              const row = raceRowByKey.get(k);
              return (
                <div key={k} className={styles.optCell}>
                  <label className={styles.optLabel}>{k}
                    <input className={shell.ageInput} type="number" min={0} max={100}
                      value={draft.raceTargets?.[k] ?? 0} onChange={(e) => setRace(k, e.target.value)} />
                  </label>
                  {row && (
                    <span className={styles.optHint}>
                      target {Math.round(row.target)}% · actual {Math.round(row.actual)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <p className={styles.formCaption}>Gender targets (sum {Math.round(genderSum)}% — aim for 100%)</p>
          <div className={styles.targetGrid}>
            {GENDER_OPTIONS.map((k) => {
              const row = genderRowByKey.get(k);
              return (
                <div key={k} className={styles.optCell}>
                  <label className={styles.optLabel}>{k}
                    <input className={shell.ageInput} type="number" min={0} max={100}
                      value={draft.genderTargets?.[k] ?? 0} onChange={(e) => setGender(k, e.target.value)} />
                  </label>
                  {row && (
                    <span className={styles.optHint}>
                      target {Math.round(row.target)}% · actual {Math.round(row.actual)}%
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          <p className={styles.formCaption}>Area — states</p>
          <div className={styles.chipRow}>
            {stateOpts.map((s) => (
              <button key={s} type="button"
                className={`${styles.chip} ${draft.areaStates.includes(s) ? styles.chipOn : ''}`}
                onClick={() => setDraft((d) => ({ ...d, areaStates: toggle(d.areaStates, s) }))}>{s}</button>
            ))}
          </div>
          <p className={styles.formCaption}>Area — cities</p>
          <div className={styles.chipRow}>
            {cityOpts.map((s) => (
              <button key={s} type="button"
                className={`${styles.chip} ${draft.areaCities.includes(s) ? styles.chipOn : ''}`}
                onClick={() => setDraft((d) => ({ ...d, areaCities: toggle(d.areaCities, s) }))}>{s}</button>
            ))}
          </div>
        </div>

        <div className={styles.preview}>
          <div className={styles.previewRow}>
            <span className={styles.previewOverall}>
              {draftMatch.overall === null ? '—' : pctStr(draftMatch.overall)}
            </span>
            {previewDims.map((d) => (
              <span key={d.label} className={styles.previewDim}>
                {d.label}
                <Meter value={d.configured ? d.score : 0} max={100} width={56} />
                <span className={styles.previewPct}>{d.configured ? pctStr(d.score) : '—'}</span>
              </span>
            ))}
          </div>
          <p className={styles.previewNote}>
            {dirty
              ? 'Previewing unsaved targets — scores use all customers this period.'
              : 'Scores use all customers this period.'}
          </p>
        </div>

        <div className={styles.sheetFoot}>
          <button type="button" className={styles.saveBtn} disabled={save.isPending}
            onClick={() => save.mutate(draft, { onSuccess: () => onClose() })}>
            {save.isPending ? 'Saving…' : 'Save targets'}
          </button>
          <button type="button" className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          {save.isError && <span className={styles.saveErr}>Save failed.</span>}
        </div>
      </aside>
    </div>,
    document.body,
  );
};
