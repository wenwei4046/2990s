// Sales analysis (design screens 10–12): "Monthly overview" — who the
// customers are — and "By product" — how each model sells and to whom. Plus
// "Customers", which the design did not have: the old page's customer list and
// spend by segment (owner 2026-10-09 — the marketing account may see it). The
// date range comes from the picker in the page header; every number here is
// computed by sales-model.ts. Margin appears only when the feed carries it
// (Houzs's finance tier — see sales-lines-queries.ts).

import { useMemo, useState } from 'react';
import { LayoutDashboard, PackageSearch, SlidersHorizontal, Users } from 'lucide-react';
import {
  customersView, NO_CRITERIA, overviewView, productView, SA_AGES, SA_GENDERS, SA_RACES,
  type Criteria, type CustomerSort, type SaCat, type SalesDataset, type SegDim,
} from './sales-model';
import { SAMPLE_PHOTOS } from './sample-sales';
import { useMarketingOptions } from './marketing-options';
import { SofaBlueprint } from './SofaBlueprint';
import s from './marketing.module.css';

type View = 'profile' | 'product' | 'customers';
type HeatDim = 'race' | 'age' | 'gender' | 'state';
const DIMS: ReadonlyArray<readonly [HeatDim, string]> = [['race', 'Race'], ['age', 'Age'], ['gender', 'Gender'], ['state', 'State']];

export const SalesAnalysisTab = ({ dataset, range }: { dataset: SalesDataset; range: { d0: number; d1: number } }) => {
  const [view, setView] = useState<View>('profile');
  const [showroom, setShowroom] = useState('all');
  const [saCat, setSaCat] = useState<SaCat>('Sofa');
  const [saModel, setSaModel] = useState<string | null>(null);
  const [crit, setCrit] = useState<Criteria>(NO_CRITERIA);
  const [heatDim, setHeatDim] = useState<HeatDim>('race');
  const [segDim, setSegDim] = useState<SegDim>('race');
  const [custSort, setCustSort] = useState<CustomerSort>('recent');
  const [showAll, setShowAll] = useState(false);
  const opts = useMarketingOptions();

  const filter = { d0: range.d0, d1: range.d1, showroom };
  const ov = useMemo(() => (view === 'profile' ? overviewView(dataset, filter, crit, heatDim) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- filter is rebuilt from these three every render
    [dataset, range.d0, range.d1, showroom, crit, heatDim, view]);
  const pv = useMemo(() => (view === 'product' ? productView(dataset, filter, saCat, saModel) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    [dataset, range.d0, range.d1, showroom, saCat, saModel, view]);
  const cv = useMemo(() => (view === 'customers' ? customersView(dataset, filter, crit, segDim, custSort, showAll) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- as above
    [dataset, range.d0, range.d1, showroom, crit, segDim, custSort, showAll, view]);

  const photoFor = (name: string): string | null => {
    if (dataset.sample) return SAMPLE_PHOTOS[name] ?? null;
    const all = [...opts.models.mattress, ...opts.models.bedframe, ...opts.models.accessory];
    return all.find((m) => m.name.toLowerCase() === name.toLowerCase())?.photoUrl ?? null;
  };

  const facets: Array<[string, keyof Criteria, readonly string[]]> = [
    ['Age', 'age', SA_AGES], ['Race', 'race', SA_RACES], ['Location', 'state', dataset.states], ['Gender', 'gender', SA_GENDERS],
  ];

  return (
    <div className={s.saWrap}>
      <div className={s.saTop}>
        <div className={s.viewSeg}>
          {([['profile', 'Monthly overview', LayoutDashboard], ['product', 'By product', PackageSearch], ['customers', 'Customers', Users]] as const).map(([id, label, Icon]) => (
            <button key={id} type="button" className={`${s.viewSegBtn} ${view === id ? s.viewSegBtnOn : ''}`} onClick={() => setView(id)}>
              <Icon size={15} strokeWidth={1.75} className={s.icon} />{label}
            </button>
          ))}
        </div>
        <div className={s.saFilters}>
          <select className={s.saSelect} value={showroom} onChange={(e) => setShowroom(e.target.value)} aria-label="Showroom">
            <option value="all">All showrooms</option>
            {dataset.showrooms.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
          {dataset.sample && <span className={s.sampleNote}>Sample data</span>}
        </div>
      </div>

      {pv && (
        <>
          <div className={s.chipRow}>
            {pv.catChips.map((c) => (
              <button
                key={c.label}
                type="button"
                className={`${s.saCatChip} ${saCat === c.label ? s.chipToggleOn : ''}`}
                onClick={() => { setSaCat(c.label); setSaModel(null); }}
              >
                <span className={s.saCatDot} style={{ background: c.dot }} />{c.label}<span className={s.saCatCount}>{c.count}</span>
              </button>
            ))}
          </div>
          <div className={s.byProductGrid}>
            <aside className={s.modelRail}>
              <div className={s.modelRailHead}><span className={s.modelRailTitle}>Models</span><span className={s.modelRailMeta}>Units sold</span></div>
              {pv.models.map((m) => (
                <button key={m.name} type="button" className={`${s.modelRow} ${m.name === pv.selName ? s.modelRowOn : ''}`} onClick={() => setSaModel(m.name)}>
                  <span className={s.modelRank}>{m.rank}</span>
                  <span className={s.modelMid}>
                    <span className={s.modelName}>{m.name}</span>
                    <span className={s.barTrack}><span className={s.barFill} style={{ width: m.pct, background: m.color }} /></span>
                  </span>
                  <span className={s.modelRight}><span className={s.modelUnits}>{m.units}</span><span className={s.modelRev}>{m.rev}</span></span>
                </button>
              ))}
            </aside>

            <section className={s.saSection}>
              <div className={`${s.card20} ${s.summaryCard}`}>
                <div className={s.summaryPic} style={!pv.pm.isSofa && photoFor(pv.pm.name) ? { backgroundImage: `url("${photoFor(pv.pm.name)}")` } : undefined}>
                  {pv.pm.isSofa && <SofaBlueprint modules={pv.pm.mods} maxW={130} maxH={80} />}
                </div>
                <div className={s.summaryText}>
                  <span className={s.summaryEyebrow} style={{ color: pv.pm.color }}>{pv.pm.cat} · #{pv.pm.rank} in category</span>
                  <span className={s.summaryName}>{pv.pm.name}</span>
                  <span className={s.summaryLine}>{pv.pm.line}</span>
                </div>
                <div className={s.facts}>
                  {pv.pm.facts.map((f) => (
                    <div key={f.label} className={s.fact}><span className={s.factValue}>{f.value}</span><span className={s.factLabel}>{f.label}</span></div>
                  ))}
                </div>
              </div>

              <div className={s.autoGrid300}>
                <div className={`${s.card20} ${s.gap10}`}>
                  <div className={s.cardHead}><span className={s.cardTitle15}>{pv.pm.variantTitle}</span><span className={s.cardMeta12}>Units</span></div>
                  {pv.pm.variants.map((v) => (
                    <div key={v.label} className={s.variantRow}>
                      <div className={s.variantThumb}>
                        {pv.pm.isSofa ? <SofaBlueprint modules={v.mods} maxW={62} maxH={34} /> : <span className={s.variantShort}>{v.short}</span>}
                      </div>
                      <div className={s.variantMid}>
                        <span className={s.variantTop}><span className={s.variantLabel}>{v.label}</span><span className={s.variantShare}>{v.share}</span></span>
                        <span className={`${s.barTrack} ${s.barTrack6}`}><span className={s.barFill} style={{ width: v.pct, background: pv.pm.color }} /></span>
                      </div>
                      <span className={s.variantUnits}>{v.units}</span>
                    </div>
                  ))}
                </div>
                <div className={`${s.card20} ${s.gap12}`}>
                  <div className={s.cardHead}><span className={s.cardTitle15}>{pv.pm.trendTitle}</span><span className={s.cardMeta12}>{pv.rangeLabel}</span></div>
                  <div className={s.trendBars} style={{ gridTemplateColumns: `repeat(${pv.pm.trendN}, minmax(0,1fr))` }}>
                    {pv.pm.trend.map((t, i) => (
                      <div key={i} className={s.trendCol} title={t.tip}>
                        <span className={s.trendValue}>{t.v}</span>
                        <span className={s.trendBar} style={{ height: t.h, background: pv.pm.color }} />
                      </div>
                    ))}
                  </div>
                  <div className={s.trendLabels} style={{ gridTemplateColumns: `repeat(${pv.pm.trendN}, minmax(0,1fr))` }}>
                    {pv.pm.trend.map((t, i) => <span key={i} className={s.trendLabel}>{t.label}</span>)}
                  </div>
                  <div className={s.byShowroom}>
                    <span className={s.byShowroomTitle}>By showroom</span>
                    {pv.pm.showrooms.map((r) => (
                      <div key={r.label} className={s.byShowroomRow}>
                        <span>{r.label}</span>
                        <span className={`${s.barTrack} ${s.barTrack6}`}><span className={s.barFill} style={{ width: r.pct, background: 'var(--c-ink)' }} /></span>
                        <span className={s.byShowroomUnits}>{r.units}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className={s.whoHead}>
                <span className={s.whoEyebrow}>Who buys {pv.pm.name}</span>
                <span className={s.whoLine}>{pv.pm.whoLine}</span>
              </div>
              <div className={s.autoGrid220}>
                {pv.pm.profile.map((d) => (
                  <div key={d.title} className={s.profileCard18}>
                    <span className={s.profileTitle14}>{d.title}</span>
                    <div className={s.stackBar}>{d.rows.map((r) => <span key={r.label} style={{ width: r.pct, background: r.color }} />)}</div>
                    <div className={`${s.buyersGrid} ${s.buyersHeader}`}><span /><span /><span className={s.right}>Buyers</span><span className={s.right}>Share</span><span /></div>
                    {d.rows.map((r) => (
                      <div key={r.label} className={`${s.buyersGrid} ${s.buyersRow}`}>
                        <span className={s.dot8} style={{ background: r.color }} />
                        <span className={s.ellipsis}>{r.label}</span>
                        <span className={s.buyersN}>{r.n}</span>
                        <span className={s.buyersShare}>{r.share}</span>
                        <span className={s.buyersVs} style={{ color: r.vsFg }}>{r.vs}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
              <span className={s.saFootnote}>Buyers = number of orders from that group. Green / orange = points above / below all buyers in the same period.</span>
            </section>
          </div>
        </>
      )}

      {ov && (
        <>
          <CriteriaCard line={ov.cfLine} count={ov.cfCount} crit={crit} setCrit={setCrit} facets={facets} />

          <div className={s.kpiBlock}>
            <div className={s.kpiGrid}>
              {ov.kpis.map((k) => (
                <div key={k.label} className={s.kpiCard}>
                  <span className={s.kpiLabel}>{k.label}</span>
                  <span className={s.kpiValue}>{k.value}</span>
                  <span className={s.kpiSub} style={{ color: k.subFg }}>{k.sub}</span>
                </div>
              ))}
            </div>
            {ov.marginNote && <span className={s.saFootnote}>{ov.marginNote}</span>}
          </div>

          <div className={s.autoGrid300}>
            {ov.profile.map((d) => (
              <div key={d.title} className={`${s.card20} ${s.gap12}`}>
                <div className={s.cardHead}><span className={s.cardTitle15}>{d.title}</span><span className={s.cardMeta12}>{d.note}</span></div>
                <div className={`${s.stackBar} ${s.stackBar12}`}>{d.rows.map((r) => <span key={r.label} style={{ width: r.pct, background: r.color }} />)}</div>
                <div className={`${s.profGrid} ${s.buyersHeader}`}><span /><span /><span className={s.right}>{d.countLabel}</span><span className={s.right}>Share</span><span className={s.right}>vs prev</span></div>
                {d.rows.map((r) => (
                  <div key={r.label} className={`${s.profGrid} ${s.profRow}`}>
                    <span className={s.dot10} style={{ background: r.color }} />
                    <span>{r.label}</span>
                    <span className={s.profN}>{r.n}</span>
                    <span className={s.profShare}>{r.share}</span>
                    <span className={s.profD} style={{ color: r.dFg }}>{r.d}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>

          <div className={`${s.card20} ${s.gap4}`}>
            <div className={s.prodHead}><span className={s.cardTitle15}>Products these customers buy</span><span className={s.cardMeta12}>By revenue</span></div>
            <div className={`${s.prodGrid} ${ov.margins ? s.prodGridMargin : ''} ${s.prodHeader}`}>
              <span>#</span><span>Model</span><span className={s.right}>Units</span><span className={s.right}>Revenue</span>
              {ov.margins && <span className={s.right}>Margin</span>}
              <span className={s.right}>Share</span><span className={s.right}>Index</span>
            </div>
            {ov.products.map((m) => (
              <div key={m.name} className={`${s.prodGrid} ${ov.margins ? s.prodGridMargin : ''} ${s.prodRow}`}>
                <span className={s.prodRank}>{m.rank}</span>
                <span className={s.prodModel}>
                  <span className={s.prodModelTop}>
                    <span className={s.prodName}>{m.name}</span>
                    <span className={s.prodCat} style={{ color: m.color }}>{m.cat}</span>
                  </span>
                  <span className={`${s.barTrack} ${s.barTrack6}`}><span className={s.barFill} style={{ width: m.pct, background: m.color }} /></span>
                </span>
                <span className={s.prodMuted}>{m.units}</span>
                <span className={s.prodRev}>{m.rev}</span>
                {ov.margins && <span className={s.prodMuted}>{m.margin}</span>}
                <span className={s.prodMuted}>{m.share}</span>
                <span className={s.right}>
                  {ov.cfCount > 0 && <span className={s.idxPill} style={{ background: m.idxBg, color: m.idxFg }}>{m.idx}</span>}
                </span>
              </div>
            ))}
            {ov.productsEmpty && <div className={s.prodEmpty}>No customers match these criteria.</div>}
            {ov.cfCount > 0 && <span className={s.prodNote}>Index 1.5× = these customers buy the model 1.5 times as often as all customers.</span>}
          </div>

          <div className={`${s.card20} ${s.gap14}`}>
            <div className={s.heatHead}>
              <div className={s.heatHeadText}>
                <span className={s.cardTitle15}>Who buys what</span>
                <span className={s.heatSub}>Share of each category's buyers · darker = larger share</span>
              </div>
              <div className={s.miniSeg}>
                {DIMS.map(([id, label]) => (
                  <button key={id} type="button" className={`${s.miniSegBtn} ${heatDim === id ? s.miniSegBtnOn : ''}`} onClick={() => setHeatDim(id)}>{label}</button>
                ))}
              </div>
            </div>
            <div className={s.heatGrid} style={{ gridTemplateColumns: `110px repeat(${ov.heatCols.length}, minmax(0,1fr))` }}>
              <span />
              {ov.heatCols.map((c) => <span key={c} className={s.heatCol}>{c}</span>)}
              {ov.heat.map((row) => (
                <HeatRow key={row.label} row={row} />
              ))}
            </div>
          </div>
        </>
      )}

      {cv && (
        <>
          <CriteriaCard line={cv.cfLine} count={cv.cfCount} crit={crit} setCrit={setCrit} facets={facets} />

          <div className={`${s.card20} ${s.gap4}`}>
            <div className={s.heatHead}>
              <div className={s.heatHeadText}>
                <span className={s.cardTitle15}>Spend by segment</span>
                <span className={s.heatSub}>Customers, revenue and average order in each group</span>
              </div>
              <div className={s.miniSeg}>
                {DIMS.map(([id, label]) => (
                  <button key={id} type="button" className={`${s.miniSegBtn} ${segDim === id ? s.miniSegBtnOn : ''}`} onClick={() => setSegDim(id)}>{label}</button>
                ))}
              </div>
            </div>
            <div className={`${s.segGrid} ${cv.margins ? s.segGridMargin : ''} ${s.prodHeader} ${s.segHeader}`}>
              <span /><span>Segment</span><span className={s.right}>Customers</span><span className={s.right}>Revenue</span>
              <span className={s.right}>AOV</span>{cv.margins && <span className={s.right}>Margin</span>}
            </div>
            {cv.segments.map((r) => (
              <div key={r.label} className={`${s.segGrid} ${cv.margins ? s.segGridMargin : ''} ${s.prodRow}`}>
                <span className={s.dot10} style={{ background: r.color }} />
                <span className={s.prodModel}>
                  <span className={s.ellipsis}>{r.label}</span>
                  <span className={`${s.barTrack} ${s.barTrack6}`}><span className={s.barFill} style={{ width: r.pct, background: r.color }} /></span>
                </span>
                <span className={s.prodMuted}>{r.customers}</span>
                <span className={s.prodRev}>{r.rev}</span>
                <span className={s.prodMuted}>{r.aov}</span>
                {cv.margins && <span className={s.prodMuted}>{r.margin}</span>}
              </div>
            ))}
            <div className={`${s.segGrid} ${cv.margins ? s.segGridMargin : ''} ${s.segTotalRow}`}>
              <span /><span>All customers</span>
              <span className={s.right}>{cv.segTotal.customers}</span>
              <span className={s.right}>{cv.segTotal.rev}</span>
              <span className={s.right}>{cv.segTotal.aov}</span>
              {cv.margins && <span className={s.right}>{cv.segTotal.margin}</span>}
            </div>
          </div>

          <div className={`${s.card20} ${s.gap4}`}>
            <div className={s.prodHead}>
              <span className={s.cardTitle15}>Customers <span className={s.cardMeta12}>· {cv.total}</span></span>
              <div className={s.miniSeg}>
                {([['recent', 'Most recent'], ['spend', 'Top spend']] as const).map(([id, label]) => (
                  <button key={id} type="button" className={`${s.miniSegBtn} ${custSort === id ? s.miniSegBtnOn : ''}`} onClick={() => setCustSort(id)}>{label}</button>
                ))}
              </div>
            </div>
            <div className={`${s.rosterGrid} ${s.prodHeader}`}>
              <span>Name</span><span>Race</span><span>Age</span><span>Gender</span><span>Location</span>
              <span className={s.right}>Orders</span><span className={s.right}>Spent</span><span className={s.right}>Last order</span>
            </div>
            {cv.rows.map((r) => (
              <div key={r.key} className={`${s.rosterGrid} ${s.prodRow}`}>
                <span className={s.rosterName}>
                  <span className={s.ellipsis} title={r.name}>{r.name}</span>
                  {r.returning && <span className={s.returningPill}>Returning</span>}
                </span>
                <span className={s.rosterCell}>{r.race}</span>
                <span className={s.rosterCell}>{r.age}</span>
                <span className={s.rosterCell}>{r.gender}</span>
                <span className={s.rosterCell} title={r.place}>{r.place}</span>
                <span className={s.prodMuted}>{r.orders}</span>
                <span className={s.prodRev}>{r.spent}</span>
                <span className={s.prodMuted}>{r.last}</span>
              </div>
            ))}
            {cv.total === 0 && (
              <div className={s.prodEmpty}>{cv.cfCount ? 'No customers match these criteria.' : 'No customers in this period.'}</div>
            )}
            {cv.total > cv.rows.length && (
              <div className={s.rosterMore}>
                <button type="button" className={s.ghostBtn} onClick={() => setShowAll(true)}>Show all {cv.total} customers</button>
              </div>
            )}
            <span className={s.prodNote}>Returning = bought before this period, or more than once in it.</span>
          </div>
        </>
      )}
    </div>
  );
};

/** The Customer criteria card — the Monthly overview's, shared with Customers. */
const CriteriaCard = ({ line, count, crit, setCrit, facets }: {
  line: string;
  count: number;
  crit: Criteria;
  setCrit: (f: (c: Criteria) => Criteria) => void;
  facets: Array<[string, keyof Criteria, readonly string[]]>;
}) => (
  <div className={s.criteriaCard}>
    <div className={s.criteriaHead}>
      <div className={s.criteriaLeft}>
        <span className={s.criteriaIcon}><SlidersHorizontal size={16} strokeWidth={1.75} className={s.icon} /></span>
        <div className={s.criteriaText}>
          <span className={s.criteriaTitle}>Customer criteria</span>
          <span className={s.criteriaLine}>{line}</span>
        </div>
      </div>
      {count > 0 && <button type="button" className={s.clearCrit} onClick={() => setCrit(() => NO_CRITERIA)}>Clear {count}</button>}
    </div>
    <div className={s.facetGrid}>
      {facets.map(([label, key, keys]) => (
        <div key={key} className={s.facet}>
          <span className={s.facetLabel}>{label}</span>
          <div className={s.facetOpts}>
            {['all', ...keys].map((k) => (
              <button
                key={k}
                type="button"
                className={`${s.facetOpt} ${crit[key] === k ? s.facetOptOn : ''}`}
                onClick={() => setCrit((c) => ({ ...c, [key]: k }))}
              >
                {k === 'all' ? 'All' : k}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  </div>
);

const HeatRow = ({ row }: { row: { label: string; color: string; cells: Array<{ v: string; bg: string; fg: string }> } }) => (
  <>
    <span className={s.heatRowLabel}><span className={s.dot8} style={{ background: row.color }} />{row.label}</span>
    {row.cells.map((c, i) => <span key={i} className={s.heatCell} style={{ background: c.bg, color: c.fg }}>{c.v}</span>)}
  </>
);
