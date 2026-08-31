// ----------------------------------------------------------------------------
// OPEX ▸ Setup ▸ the rate ladder.
//
// Edits the ONE commission config the engine reads. Two things to know:
//
// 1. THE SCREEN SPEAKS EFFECTIVE RATES, THE WIRE SPEAKS INCREMENTS. Tier 2 here
//    is the rate a person actually earns above the target ("1%"), not the
//    increment stored underneath ("+0.5% on top of the base"). lib/
//    commission-format.ts is the only place the two meet, and it is tested.
//
// 2. THE DRAFT MUST RESYNC. The form holds a local draft so typing does not fire
//    a PATCH per keystroke — but a draft seeded once from a query that was still
//    loading stays stale forever, showing the old rate over the new one. The
//    original build of this module shipped exactly that bug (RateField /
//    CentiField, caught in review 2026-06-14). Hence the keyed reseed below.
// ----------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Percent, Plus, Save, Trash2, Users } from 'lucide-react';
import {
  useCommissionConfig, useCommissionOverrideLevels, useCreateCommissionOverrideLevel,
  useDeleteCommissionOverrideLevel, useUpdateCommissionConfig,
  type CommissionConfigWire, type HrOverrideMode,
} from '../../lib/commission-api';
import { hrErrorMessage } from '../../lib/hr-wire';
import {
  bpsToPct, configToTiers, effectiveRateBps, fmtBps, fmtSen, pctToBps, rmToSen, senToRm,
  tiersError, tiersToConfigPatch, type CommissionTiers,
} from '../../lib/commission-format';
import styles from './Opex.module.css';

/** The draft the form edits: every field a string, because a half-typed number
 *  ("0.", "") is a legitimate intermediate state that a numeric state would
 *  silently rewrite under the caret. Parsed once, on save. */
type Draft = {
  tier1Pct: string;
  tier2ThresholdRm: string;
  tier2Pct: string;
  showroomThresholdRm: string;
  showroomBonusPct: string;
  overrideBasePct: string;
  overrideBonusPct: string;
  overrideMode: HrOverrideMode;
};

const toDraft = (c: CommissionConfigWire): Draft => {
  const t = configToTiers(c);
  return {
    tier1Pct: String(bpsToPct(t.tier1Bps)),
    tier2ThresholdRm: String(senToRm(t.tier2ThresholdCenti)),
    tier2Pct: String(bpsToPct(t.tier2Bps)),
    showroomThresholdRm: String(senToRm(t.showroomThresholdCenti)),
    showroomBonusPct: String(bpsToPct(t.showroomBonusBps)),
    overrideBasePct: String(bpsToPct(t.overrideBaseBps)),
    overrideBonusPct: String(bpsToPct(t.overrideBonusBps)),
    overrideMode: c.overrideMode,
  };
};

/** A blank or unparseable field reads as 0 rather than NaN — NaN would reach the
 *  server as `null` and come back a bare validation error naming a field the
 *  page does not show. */
const num = (s: string): number => {
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

const toTiers = (d: Draft): CommissionTiers => ({
  tier1Bps: pctToBps(num(d.tier1Pct)),
  tier2ThresholdCenti: rmToSen(num(d.tier2ThresholdRm)),
  tier2Bps: pctToBps(num(d.tier2Pct)),
  showroomThresholdCenti: rmToSen(num(d.showroomThresholdRm)),
  showroomBonusBps: pctToBps(num(d.showroomBonusPct)),
  overrideBaseBps: pctToBps(num(d.overrideBasePct)),
  overrideBonusBps: pctToBps(num(d.overrideBonusPct)),
});

export const SetupRates = ({ canManage }: { canManage: boolean }) => {
  const { data: config, isLoading, error } = useCommissionConfig();
  const update = useUpdateCommissionConfig();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  /* Reseed whenever the SERVER's config changes identity — on first load, and
     after a save returns the canonical row. `updatedAt` is the version marker;
     without a dependency that actually moves, a draft seeded during loading
     would never catch up. */
  const stamp = config ? `${config.updatedAt ?? ''}|${config.baseBps}|${config.personalKpiBonusBps}` : '';
  useEffect(() => {
    if (config) setDraft(toDraft(config));
  }, [stamp]); // eslint-disable-line react-hooks/exhaustive-deps

  if (isLoading) return <p className={styles.muted}>Loading…</p>;
  if (error) return <p className={styles.error}>{hrErrorMessage(error)}</p>;
  if (!config || !draft) return null;

  const tiers = toTiers(draft);
  const invalid = tiersError(tiers);
  const set = (k: keyof Draft) => (v: string) => {
    setSaved(false);
    setDraft((d) => (d ? { ...d, [k]: v } : d));
  };

  const save = async () => {
    setSaveError(null);
    setSaved(false);
    if (invalid) { setSaveError(invalid); return; }
    try {
      await update.mutateAsync({ ...tiersToConfigPatch(tiers), overrideMode: draft.overrideMode });
      setSaved(true);
    } catch (e) {
      setSaveError(hrErrorMessage(e));
    }
  };

  return (
    <div className={styles.stack}>
      {/* ── revenue commission ───────────────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            <Percent size={16} strokeWidth={1.75} /> Revenue commission
          </h2>
        </div>
        <p className={styles.cardHint}>
          A percentage of each salesperson&rsquo;s own product sales. Below the target they earn the
          Tier 1 rate; at or above it, the Tier 2 rate. Enter the rate they actually earn at each
          tier, not the difference between them.
        </p>

        <div className={styles.fieldGrid}>
          <PctField
            label="Tier 1 rate (below target)"
            value={draft.tier1Pct} onChange={set('tier1Pct')} disabled={!canManage}
          />
          <RmField
            label="Tier 2 target (own product sales)"
            value={draft.tier2ThresholdRm} onChange={set('tier2ThresholdRm')} disabled={!canManage}
          />
          <PctField
            label="Tier 2 rate (at or above target)"
            value={draft.tier2Pct} onChange={set('tier2Pct')} disabled={!canManage}
          />
        </div>

        <div className={styles.fieldGrid}>
          <RmField
            label="Showroom target (whole showroom)"
            value={draft.showroomThresholdRm} onChange={set('showroomThresholdRm')} disabled={!canManage}
          />
          <PctField
            label="Showroom bonus (added on top)"
            value={draft.showroomBonusPct} onChange={set('showroomBonusPct')} disabled={!canManage}
          />
        </div>

        {/* Derived from the very ladder that will be saved, so the explanation
            cannot go stale the way a hand-written sentence would. */}
        <p className={styles.notice}>
          <span className={styles.noticeTitle}>What this pays</span><br />
          Below {fmtSen(tiers.tier2ThresholdCenti)} own sales:{' '}
          <strong>{fmtBps(effectiveRateBps(tiers, { personalHit: false, showroomHit: false }))}</strong>
          {' '}· at or above it:{' '}
          <strong>{fmtBps(effectiveRateBps(tiers, { personalHit: true, showroomHit: false }))}</strong>.
          {tiers.showroomBonusBps > 0 && (
            <>
              {' '}When the showroom passes {fmtSen(tiers.showroomThresholdCenti)}, everyone in it gets
              {' '}{fmtBps(tiers.showroomBonusBps)} more — so{' '}
              <strong>{fmtBps(effectiveRateBps(tiers, { personalHit: false, showroomHit: true }))}</strong>
              {' '}and{' '}
              <strong>{fmtBps(effectiveRateBps(tiers, { personalHit: true, showroomHit: true }))}</strong>.
            </>
          )}
        </p>

        {invalid && <p className={styles.error}>{invalid}</p>}
        {saveError && <p className={styles.error}>{saveError}</p>}
        {saved && <p className={styles.ok}>Saved.</p>}

        {canManage && (
          <div className={styles.actions}>
            <button
              type="button"
              className={`${styles.btn} ${styles.btnPrimary}`}
              disabled={update.isPending || !!invalid}
              onClick={() => void save()}
            >
              <Save size={16} strokeWidth={1.75} />
              {update.isPending ? 'Saving…' : 'Save rates'}
            </button>
            <span className={styles.tileHint}>
              Changing a rate moves every OPEN period&rsquo;s figures. Closed periods stay frozen.
            </span>
          </div>
        )}
      </div>

      {/* ── manager override ─────────────────────────────────────────────── */}
      <div className={styles.card}>
        <div className={styles.cardHead}>
          <h2 className={styles.cardTitle}>
            <Users size={16} strokeWidth={1.75} /> Manager override
          </h2>
        </div>
        <p className={styles.cardHint}>
          What a manager earns on other people&rsquo;s sales, on top of their own commission.
          <strong> Showroom</strong> pays a manager on their whole showroom&rsquo;s sales.
          <strong> Reporting chain</strong> pays each person on their downline instead, one rate per
          level. Only one mode runs at a time — running both would pay a manager twice on the same
          sale.
        </p>

        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className={styles.label}>Mode</span>
            <select
              value={draft.overrideMode}
              disabled={!canManage}
              onChange={(e) => set('overrideMode')(e.target.value)}
            >
              <option value="showroom">Showroom</option>
              <option value="chain">Reporting chain</option>
            </select>
          </label>
          {draft.overrideMode === 'showroom' && (
            <>
              <PctField
                label="Override rate"
                value={draft.overrideBasePct} onChange={set('overrideBasePct')} disabled={!canManage}
              />
              <PctField
                label="Extra once showroom target is met"
                value={draft.overrideBonusPct} onChange={set('overrideBonusPct')} disabled={!canManage}
              />
            </>
          )}
        </div>

        {draft.overrideMode === 'chain' && <OverrideLevels canManage={canManage} />}
      </div>
    </div>
  );
};

/* ── field primitives ─────────────────────────────────────────────────────── */

const PctField = ({
  label, value, onChange, disabled,
}: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) => (
  <label className={styles.field}>
    <span className={styles.label}>{label}</span>
    <span className={styles.suffixField}>
      <input
        type="number" min={0} step={0.01} inputMode="decimal"
        value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className={styles.suffix}>%</span>
    </span>
  </label>
);

const RmField = ({
  label, value, onChange, disabled,
}: { label: string; value: string; onChange: (v: string) => void; disabled: boolean }) => (
  <label className={styles.field}>
    <span className={styles.label}>{label}</span>
    <span className={styles.suffixField}>
      <span className={styles.suffix}>RM</span>
      <input
        type="number" min={0} step={100} inputMode="decimal"
        value={value} disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      />
    </span>
  </label>
);

/* ── chain-mode ladder ────────────────────────────────────────────────────── */
/* One rate per rung: level 1 = a person's DIRECT reports, level 2 = their
   reports' reports. A level with no rate configured earns nothing — that is the
   "add the levels yourself" rule, not a missing-data guess. The level NUMBER is
   deliberately not editable after creation: renumbering a rung in place
   silently repoints an existing rate at a different set of people. */

const OverrideLevels = ({ canManage }: { canManage: boolean }) => {
  const { data: levels, isLoading, error } = useCommissionOverrideLevels();
  const create = useCreateCommissionOverrideLevel();
  const remove = useDeleteCommissionOverrideLevel();
  const [level, setLevel] = useState('1');
  const [ratePct, setRatePct] = useState('0.5');
  const [addError, setAddError] = useState<string | null>(null);

  if (isLoading) return <p className={styles.muted}>Loading levels…</p>;
  if (error) return <p className={styles.error}>{hrErrorMessage(error)}</p>;

  const add = async () => {
    setAddError(null);
    try {
      await create.mutateAsync({ level: Math.round(num(level)), rateBps: pctToBps(num(ratePct)) });
    } catch (e) {
      setAddError(hrErrorMessage(e));
    }
  };

  return (
    <>
      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Level</th>
              <th>Who it pays on</th>
              <th className={styles.num}>Rate</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {(levels ?? []).map((l) => (
              <tr key={l.id}>
                <td>{l.level}</td>
                <td className={styles.muted}>
                  {l.level === 1 ? 'Direct reports' : `${l.level} levels below`}
                  {l.label ? ` · ${l.label}` : ''}
                </td>
                <td className={styles.num}>{fmtBps(l.rateBps)}</td>
                {canManage && (
                  <td className={styles.num}>
                    <button
                      type="button" className={styles.iconBtn}
                      aria-label={`Remove level ${l.level}`}
                      disabled={remove.isPending}
                      onClick={() => void remove.mutateAsync(l.id)}
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {(levels ?? []).length === 0 && (
              <tr className={styles.rowMuted}>
                <td colSpan={canManage ? 4 : 3}>
                  — No levels yet. Reporting-chain mode cannot be saved until at least one exists,
                  otherwise every manager would earn RM 0.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <>
          {addError && <p className={styles.error}>{addError}</p>}
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.label}>Level</span>
              <input
                type="number" min={1} step={1} value={level}
                onChange={(e) => setLevel(e.target.value)}
              />
            </label>
            <PctField label="Rate" value={ratePct} onChange={setRatePct} disabled={false} />
            <div className={styles.field}>
              <span className={styles.label}>&nbsp;</span>
              <div className={styles.actions}>
                <button
                  type="button" className={styles.btn}
                  disabled={create.isPending} onClick={() => void add()}
                >
                  <Plus size={16} strokeWidth={1.75} /> Add level
                </button>
              </div>
            </div>
          </div>
        </>
      )}
    </>
  );
};
