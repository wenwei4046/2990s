// ProductsTab — master-detail: ranked model table on the left, keyed detail
// panel on the right.
//
// ── 2026-08-31 ───────────────────────────────────────────────────────────────
// CRASH FIX. This tab read `m.demographics.n` and `v.demographics` as though
// they were always present. Houzs strips both from every model and variant it
// returns (see the wire types in sales-analysis-queries.ts), so the whole page
// died on "Cannot read properties of undefined (reading 'n')" the moment the
// Products tab was opened. Demographics are now optional everywhere below, and
// their absence is stated once rather than drawn as three empty charts.
//
// Also restructured: the category chips and the summary sentence used to float
// bare on the page background with no title, so the tab opened with no visible
// statement of what it was showing. Both now sit in a labelled card, and the
// master-detail pair below it carries its own eyebrow.

import { useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import { AGE_BANDS, fmtCenti, fmtQty } from '@2990s/shared';
import type { BuyerDemographics, Distribution } from '@2990s/shared';
import type { WireModelRank, WireProductsSection } from '../../lib/sales-analysis-queries';
import { MIN_SAMPLE, catLabel, categoryMix, marginPct } from '../../lib/sales-analysis-derive';
import { entityColor, orderBuckets } from './primitives/entity-colors';
import { Panel } from './primitives/Panel';
import { SegmentBar } from './primitives/SegmentBar';
import { MiniColumns } from './primitives/MiniColumns';
import { Meter } from './primitives/Meter';
import { Disclosure } from './primitives/Disclosure';
import { ThinSampleChip } from './primitives/ThinSampleChip';
import shared from './SaShared.module.css';
import s from './ProductsTab.module.css';

const TOP_MODELS = 20;

const pct = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}%`);

const modelKey = (m: WireModelRank): string => m.modelId ?? m.modelName;

/** Re-sort buyer age-band buckets (payload arrives count-desc) into AGE_BANDS
 *  chronological label order; 'Unknown' is always last. */
const orderAgeBands = (buckets: ReadonlyArray<Distribution>): Distribution[] => {
  const order = new Map<string, number>(AGE_BANDS.map((b, i) => [b.label as string, i] as const));
  return [...buckets].sort((a, b) => {
    const ai = a.key === 'Unknown' ? Number.MAX_SAFE_INTEGER : (order.get(a.key) ?? order.size);
    const bi = b.key === 'Unknown' ? Number.MAX_SAFE_INTEGER : (order.get(b.key) ?? order.size);
    return ai - bi || a.key.localeCompare(b.key);
  });
};

/** Race / age-band / gender sub-blocks for one demographics sample.
 *  Rendered only when the server sent a sample — see BuyersSection. */
const BuyersBlock = ({ d }: { d: BuyerDemographics }) => (
  <>
    <div className={s.buyersHead}>
      <span>Buyers (n = {fmtQty(d.n)})</span>
      {d.n > 0 && d.n < MIN_SAMPLE && <ThinSampleChip n={d.n} />}
    </div>
    {d.n === 0 ? (
      <p className={shared.muted}>No buyer data.</p>
    ) : (
      <div className={s.buyersGrid}>
        <div>
          <p className={s.buyerBlockLabel}>Race</p>
          <SegmentBar
            buckets={orderBuckets('race', d.race)}
            colorOf={(k) => entityColor('race', k)}
            legend="rows"
            ariaLabel="Race"
          />
        </div>
        <div>
          <p className={s.buyerBlockLabel}>Age band</p>
          <MiniColumns
            data={orderAgeBands(d.ageBand).map((b) => ({ label: b.key, value: b.count }))}
            height={90}
            slotWidth={40}
            valueFormatter={fmtQty}
            colorOf={(label) => (label === 'Unknown' ? 'var(--sa-unknown)' : 'var(--sa-c1)')}
          />
        </div>
        <div>
          <p className={s.buyerBlockLabel}>Gender</p>
          <SegmentBar
            buckets={orderBuckets('gender', d.gender)}
            colorOf={(k) => entityColor('gender', k)}
            legend="rows"
            ariaLabel="Gender"
          />
        </div>
      </div>
    )}
  </>
);

/** The buyers block, or one sentence explaining why there isn't one. Absence is
 *  a property of the BACKEND, not of this model — so it is said once, quietly,
 *  and never dressed up as three charts reading 100% Unknown. */
const BuyersSection = ({ d }: { d: BuyerDemographics | undefined }) =>
  d === undefined ? (
    <p className={`${shared.notice} ${s.buyersNotice}`}>
      <span className={shared.noticeTitle}>
        <Info size={14} strokeWidth={1.75} /> Buyer demographics unavailable
      </span>{' '}
      This report does not return race, age or gender per model. Everything above
      — units, revenue, variants — is complete.
    </p>
  ) : (
    <BuyersBlock d={d} />
  );

interface VariantRowProps {
  label: string;
  units: number;
  revenueCenti: number;
  meterMax: number;
  selected: boolean;
  onSelect: () => void;
}

const VariantRow = ({ label, units, revenueCenti, meterMax, selected, onSelect }: VariantRowProps) => (
  <button
    type="button"
    className={`${shared.tRow} ${shared.tRowTap} ${s.variantGrid}${selected ? ` ${shared.tRowSelected}` : ''}`}
    aria-pressed={selected}
    onClick={onSelect}
  >
    <span className={s.cellClip}>{label}</span>
    <span className={shared.tNum}>{fmtQty(units)}</span>
    <span><Meter value={units} max={meterMax} /></span>
    <span className={shared.tNum}>{fmtCenti(revenueCenti)}</span>
  </button>
);

/** Detail panel for one model. Keyed by the model key from the parent, so the
 *  variant selection resets whenever the selected model changes. */
const ModelDetail = ({ m }: { m: WireModelRank }) => {
  const [selectedVariantLabel, setSelectedVariantLabel] = useState<string | null>(null);

  // Stale guard (same pattern as category/model): the model can survive a
  // period / include-test change while its variant list changes — fall back to
  // "All variants" so the radio selection and the buyers sample agree.
  const effectiveVariantLabel =
    selectedVariantLabel !== null && m.variants.some((v) => v.label === selectedVariantLabel)
      ? selectedVariantLabel
      : null;
  const selectedVariant =
    effectiveVariantLabel === null
      ? null
      : (m.variants.find((v) => v.label === effectiveVariantLabel) ?? null);
  // `??` on BOTH sides deliberately: either can be absent, and falling back
  // from a missing variant sample to the model's own is the right behaviour.
  const demographics = selectedVariant?.demographics ?? m.demographics;
  const thin =
    m.demographics !== undefined && m.demographics.n > 0 && m.demographics.n < MIN_SAMPLE;

  const hasClassChips = m.comboUnits + m.customUnits + m.pwpUnits > 0;
  const hasFabric = m.fabricEligibleUnits > 0;
  const fabricPct = hasFabric ? Math.round((m.fabricUpgradeUnits / m.fabricEligibleUnits) * 100) : 0;
  const maxVariantUnits = Math.max(1, ...m.variants.map((v) => v.units));

  return (
    <Panel title="Model detail">
      <div className={s.detailHead}>
        <span className={s.detailName}>{m.modelName}</span>
        <span className={s.detailStats}>
          {fmtQty(m.units)} units · {fmtCenti(m.revenueCenti)} · {pct(marginPct(m.marginCenti, m.revenueCenti))} margin
        </span>
        {thin && <ThinSampleChip n={m.demographics!.n} />}
      </div>

      {(hasClassChips || hasFabric) && (
        <div className={s.detailFacts}>
          {hasClassChips && (
            <div className={s.classChips}>
              {m.comboUnits > 0 && <span className={s.classChip}>combo {fmtQty(m.comboUnits)}</span>}
              {m.customUnits > 0 && <span className={s.classChip}>custom {fmtQty(m.customUnits)}</span>}
              {m.pwpUnits > 0 && <span className={s.classChip}>PWP {fmtQty(m.pwpUnits)}</span>}
            </div>
          )}
          {hasFabric && (
            <div className={s.fabricLine}>
              <span>Fabric upgrade</span>
              <Meter value={m.fabricUpgradeUnits} max={m.fabricEligibleUnits} width={160} />
              <span className={s.fabricVal}>
                {fmtQty(m.fabricUpgradeUnits)} of {fmtQty(m.fabricEligibleUnits)} · {fabricPct}%
              </span>
            </div>
          )}
        </div>
      )}

      {m.variants.length === 0 ? (
        <p className={shared.muted}>No variant detail.</p>
      ) : (
        <div className={s.block}>
          <p className={s.variantCaption}>
            Variants{demographics !== undefined ? ' — tap one to focus buyer demographics below' : ''}
          </p>
          <div className={s.tableBox}>
            <div className={`${shared.tHead} ${s.variantGrid}`}>
              <span>Variant</span>
              <span className={shared.tNum}>Units</span>
              <span />
              <span className={shared.tNum}>Revenue</span>
            </div>
            <VariantRow
              label="All variants"
              units={m.units}
              revenueCenti={m.revenueCenti}
              meterMax={maxVariantUnits}
              selected={effectiveVariantLabel === null}
              onSelect={() => setSelectedVariantLabel(null)}
            />
            {m.variants.map((v) => (
              <VariantRow
                key={v.label}
                label={v.label}
                units={v.units}
                revenueCenti={v.revenueCenti}
                meterMax={maxVariantUnits}
                selected={effectiveVariantLabel === v.label}
                onSelect={() => setSelectedVariantLabel(v.label)}
              />
            ))}
          </div>
        </div>
      )}

      <BuyersSection d={demographics} />
    </Panel>
  );
};

interface RankRowProps {
  m: WireModelRank;
  rank: number;
  maxUnits: number;
  selected: boolean;
  onSelect: () => void;
}

const RankRow = ({ m, rank, maxUnits, selected, onSelect }: RankRowProps) => (
  <button
    type="button"
    className={`${shared.tRow} ${shared.tRowTap} ${s.rankGrid}${selected ? ` ${shared.tRowSelected}` : ''}`}
    aria-pressed={selected}
    onClick={onSelect}
  >
    <span className={s.rank}>{rank}</span>
    <span className={s.cellClip}>{m.modelName}</span>
    <span className={shared.tNum}>{fmtQty(m.units)}</span>
    <span><Meter value={m.units} max={maxUnits} /></span>
    <span className={shared.tNum}>{fmtCenti(m.revenueCenti)}</span>
    <span className={shared.tNum}>{pct(marginPct(m.marginCenti, m.revenueCenti))}</span>
  </button>
);

export const ProductsTab = ({ products }: { products: WireProductsSection }) => {
  // Categories ordered by revenue desc (stable chip order across selections).
  const mix = useMemo(() => categoryMix(products), [products]);
  const categories = useMemo(() => mix.map((x) => x.category), [mix]);

  const [activeCat, setActiveCat] = useState<string>(categories[0] ?? '');
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);

  if (categories.length === 0) {
    return <p className={shared.muted}>No product sales in this view.</p>;
  }

  // Stale guards: both the category and the model selection can be invalidated
  // by a period / include-test change — fall back without crashing.
  const effectiveCat = categories.includes(activeCat) ? activeCat : categories[0]!;
  const activeMix = mix.find((x) => x.category === effectiveCat)!;
  const models = products.byCategory[effectiveCat] ?? [];
  const effectiveModelKey = models.some((m) => modelKey(m) === selectedModelKey)
    ? selectedModelKey!
    : (models[0] ? modelKey(models[0]) : null);
  const selectedModel = models.find((m) => modelKey(m) === effectiveModelKey) ?? null;

  const maxUnits = Math.max(1, ...models.map((m) => m.units));
  const topModels = models.slice(0, TOP_MODELS);
  const restModels = models.slice(TOP_MODELS);
  const totalUnits = mix.reduce((sum, x) => sum + x.units, 0);

  const rankRow = (m: WireModelRank, rank: number) => {
    const key = modelKey(m);
    return (
      <RankRow
        key={key}
        m={m}
        rank={rank}
        maxUnits={maxUnits}
        selected={key === effectiveModelKey}
        onSelect={() => setSelectedModelKey(key)}
      />
    );
  };

  return (
    <>
      <p className={shared.eyebrow}>What sold</p>
      <section className={`${shared.panel} ${s.catCard}`}>
        <div className={s.chipRow} role="group" aria-label="Category">
          {mix.map((x) => (
            <button
              key={x.category}
              type="button"
              className={`${s.chip} ${x.category === effectiveCat ? s.chipOn : ''}`}
              aria-pressed={x.category === effectiveCat}
              onClick={() => setActiveCat(x.category)}
            >
              <span className={s.chipName}>{catLabel(x.category)}</span>
              <span className={s.chipCount}>{fmtQty(x.units)}</span>
            </button>
          ))}
        </div>
        <dl className={s.catFacts}>
          <div className={s.catFact}>
            <dt>Units</dt>
            <dd>{fmtQty(activeMix.units)}</dd>
          </div>
          <div className={s.catFact}>
            <dt>Revenue</dt>
            <dd>{fmtCenti(activeMix.revenueCenti)}</dd>
          </div>
          <div className={s.catFact}>
            <dt>Margin</dt>
            <dd>{pct(marginPct(activeMix.marginCenti, activeMix.revenueCenti))}</dd>
          </div>
          <div className={s.catFact}>
            <dt>Share of units</dt>
            <dd>{totalUnits > 0 ? `${Math.round((activeMix.units / totalUnits) * 100)}%` : '—'}</dd>
          </div>
        </dl>
      </section>

      <p className={shared.eyebrow}>{catLabel(effectiveCat)} models</p>
      <div className={s.grid}>
        <Panel title="Top models" className={s.rankPanel}>
          {models.length === 0 ? (
            <p className={shared.muted}>No models in this category.</p>
          ) : (
            <div className={s.tableBox}>
              <div className={`${shared.tHead} ${s.rankGrid}`}>
                <span>#</span>
                <span>Model</span>
                <span className={shared.tNum}>Units</span>
                <span />
                <span className={shared.tNum}>Revenue</span>
                <span className={shared.tNum}>Margin %</span>
              </div>
              {topModels.map((m, i) => rankRow(m, i + 1))}
              <div className={`${shared.tRow} ${shared.tTotals} ${s.rankGrid}`}>
                <span />
                <span>All models</span>
                <span className={shared.tNum}>{fmtQty(activeMix.units)}</span>
                <span />
                <span className={shared.tNum}>{fmtCenti(activeMix.revenueCenti)}</span>
                <span className={shared.tNum}>{pct(marginPct(activeMix.marginCenti, activeMix.revenueCenti))}</span>
              </div>
              {restModels.length > 0 && (
                <Disclosure label={`Show all ${fmtQty(models.length)} models`}>
                  {restModels.map((m, i) => rankRow(m, TOP_MODELS + i + 1))}
                </Disclosure>
              )}
            </div>
          )}
        </Panel>

        <div className={s.detailCol}>
          {models.length > 0 && effectiveModelKey != null && (
            <select
              className={s.modelSelect}
              aria-label="Model"
              value={effectiveModelKey}
              onChange={(e) => setSelectedModelKey(e.target.value)}
            >
              {models.map((m) => (
                <option key={modelKey(m)} value={modelKey(m)}>{m.modelName}</option>
              ))}
            </select>
          )}
          {selectedModel ? (
            <ModelDetail key={effectiveModelKey} m={selectedModel} />
          ) : (
            <p className={shared.muted}>No models in this category.</p>
          )}
        </div>
      </div>
    </>
  );
};
