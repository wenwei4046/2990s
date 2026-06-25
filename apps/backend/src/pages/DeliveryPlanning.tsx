// ----------------------------------------------------------------------------
// Delivery Planning — STAGE 4 (the core) of the Delivery / TMS module.
//
// The planning board: which live Sales Orders still need delivering, organised
// by a top row of 4 DELIVERY-STATE tabs (Pending Delivery / Pending Schedule /
// Overdue / Delivered, each with a live count) and a region chip row (All ·
// PJ·KL · Penang · Sabah · Sarawak · Singapore). Both the active state tab and
// the active region live in the URL (useSearchParams) so a link / refresh keeps
// the view. The HC-sheet columns render in the shared DataGrid; the delivery
// state shows as an inline pill, and a legged order (one with delivery_legs)
// surfaces under each of its leg regions with that leg's date.
//
// Backend-derived: delivery_state, region grouping, readiness, crew, legs, and
// days_left all come from GET /delivery-planning — this page only filters by
// the active state/region and renders. Schedule + leg editing call the
// PATCH/POST endpoints via the queries hook.
//
// Style: 2990 cream brand (CSS modules + design-system). Singapore region is
// visually distinct (dashed teal chip + a teal row accent).
// ----------------------------------------------------------------------------

import { useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { Split } from 'lucide-react';
import { fmtCenti, fmtDateOrDash } from '@2990s/shared';
import { formatPhone } from '@2990s/shared/phone';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import {
  useDeliveryPlanning,
  DELIVERY_STATES,
  DELIVERY_STATE_LABEL,
  type DeliveryState,
  type PlanningOrder,
} from '../lib/delivery-planning-queries';
import styles from './DeliveryPlanning.module.css';

/* Region tabs — ONE per delivery warehouse. 'ALL' + the 5 region keys. The
   region key is sent verbatim to the API (which also accepts a warehouseId).
   CHINA WAREHOUSE (transit) + CONSIGN-OUT are NOT delivery regions → absent. */
const REGION_TABS: Array<{ key: string; label: string; sg?: boolean }> = [
  { key: 'ALL', label: 'All' },
  { key: 'PJKL', label: 'PJ·KL' },
  { key: 'PENANG', label: 'Penang' },
  { key: 'SABAH', label: 'Sabah' },
  { key: 'SARAWAK', label: 'Sarawak' },
  { key: 'SINGAPORE', label: 'Singapore', sg: true },
];

/* The 4 state tabs (the top row). */
const STATE_TABS = DELIVERY_STATES;

const DSTATE_PILL_CLASS: Record<DeliveryState, string> = {
  PENDING_DELIVERY: styles.dstatePendingDelivery!,
  PENDING_SCHEDULE: styles.dstatePendingSchedule!,
  OVERDUE: styles.dstateOverdue!,
  DELIVERED: styles.dstateDelivered!,
};

function DeliveryStatePill({ state }: { state: DeliveryState }) {
  return (
    <span className={`${styles.dstatePill} ${DSTATE_PILL_CLASS[state]}`}>
      {DELIVERY_STATE_LABEL[state]}
    </span>
  );
}

/* days_left cell — overdue (<0) red, due-soon (0..3) burnt, else plain. */
function DaysLeftCell({ days }: { days: number | null }) {
  if (days == null) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
  const cls = days < 0 ? styles.daysOverdue : days <= 3 ? styles.daysSoon : styles.daysOk;
  const label = days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'today' : `${days}d`;
  return <span className={cls}>{label}</span>;
}

export const DeliveryPlanning = () => {
  const [params, setParams] = useSearchParams();
  const activeState = (params.get('state') ?? 'ALL').toUpperCase();
  const activeRegion = params.get('region') ?? 'ALL';

  const setState = (s: string) => {
    const next = new URLSearchParams(params);
    if (s === 'ALL') next.delete('state'); else next.set('state', s);
    setParams(next, { replace: true });
  };
  const setRegion = (r: string) => {
    const next = new URLSearchParams(params);
    if (r === 'ALL') next.delete('region'); else next.set('region', r);
    setParams(next, { replace: true });
  };

  /* Fetch scoped to the active REGION; counts come back region-scoped so the
     state-tab badges are stable as the operator flips state tabs. We pass the
     state to the server too (it filters), but render-time we already have the
     region-filtered orders so switching states is instant via the cache key. */
  const { data, isLoading, error } = useDeliveryPlanning({ region: activeRegion, state: 'ALL' });

  const allOrders = useMemo<PlanningOrder[]>(() => data?.orders ?? [], [data]);
  const counts = data?.counts ?? { ALL: 0, PENDING_DELIVERY: 0, PENDING_SCHEDULE: 0, OVERDUE: 0, DELIVERED: 0 };

  /* Apply the active state tab in the client (the fetch already region-scoped). */
  const rows = useMemo<PlanningOrder[]>(
    () => (activeState === 'ALL' ? allOrders : allOrders.filter((o) => o.delivery_state === activeState)),
    [allOrders, activeState],
  );

  /* For a legged order under a specific region tab, surface THAT leg's date as
     the row's planned date. Helper: pick the leg matching the active region (if
     any) so the same order shows its transit date in KL and its final date in
     Penang/SG. */
  const legDateForRegion = (o: PlanningOrder): string | null => {
    if (activeRegion === 'ALL' || o.legs.length === 0) return null;
    const wantSg = activeRegion === 'SG' || activeRegion === 'SINGAPORE';
    const leg = o.legs.find((l) => (wantSg ? l.region === 'SINGAPORE' : l.region === activeRegion));
    return leg?.leg_date ?? null;
  };

  const columns = useMemo<DataGridColumn<PlanningOrder>[]>(() => [
    {
      key: 'so_doc_no', label: 'SO No.', width: 150, sortable: true,
      accessor: (o) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', fontWeight: 700, color: 'var(--c-burnt)', fontVariantNumeric: 'tabular-nums' }}>
          {o.so_doc_no}
          {o.legs.length > 0 && (
            <span className={styles.legBadge} title={`${o.legs.length} delivery legs (multi-region trip)`}>
              <Split size={9} strokeWidth={2} />{o.legs.length}
            </span>
          )}
        </span>
      ),
      searchValue: (o) => o.so_doc_no,
      exportValue: (o) => o.so_doc_no,
      sortFn: (a, b) => a.so_doc_no.localeCompare(b.so_doc_no),
    },
    {
      key: 'debtor_name', label: 'Customer', width: 200, sortable: true, groupable: true,
      accessor: (o) => o.debtor_name ?? o.debtor_code ?? '—',
      searchValue: (o) => `${o.debtor_name ?? ''} ${o.debtor_code ?? ''}`.trim(),
      groupValue: (o) => o.debtor_name ?? o.debtor_code ?? '(none)',
      sortFn: (a, b) => (a.debtor_name ?? '').localeCompare(b.debtor_name ?? ''),
    },
    {
      key: 'phone', label: 'Phone', width: 150,
      accessor: (o) => formatPhone(o.phone) || '—',
      searchValue: (o) => o.phone ?? '',
    },
    {
      key: 'branding', label: 'Branding', width: 130, groupable: true,
      accessor: (o) => o.branding ?? '—',
      searchValue: (o) => o.branding ?? '',
      groupValue: (o) => o.branding ?? '(none)',
    },
    {
      key: 'warehouse', label: 'Warehouse', width: 150, sortable: true, groupable: true,
      accessor: (o) => o.warehouse_code ?? (o.regions.includes('SINGAPORE') ? 'SINGAPORE (SG)' : '—'),
      searchValue: (o) => `${o.warehouse_code ?? ''} ${o.warehouse_name ?? ''}`.trim(),
      groupValue: (o) => o.warehouse_code ?? (o.regions.includes('SINGAPORE') ? 'SINGAPORE' : '(none)'),
    },
    {
      key: 'region', label: 'Region', width: 130, groupable: true,
      accessor: (o) => o.regions.join(' · ') || '—',
      searchValue: (o) => o.regions.join(' '),
      groupValue: (o) => o.regions[0] ?? '(none)',
    },
    {
      key: 'customer_delivery_date', label: 'Delivery Date', width: 130, sortable: true,
      accessor: (o) => {
        const legDate = legDateForRegion(o);
        return (
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            {fmtDateOrDash(legDate ?? o.customer_delivery_date)}
            {legDate && legDate !== o.customer_delivery_date && (
              <span style={{ marginLeft: 4, fontSize: 'var(--fs-10)', color: 'var(--c-secondary-a)' }}>(leg)</span>
            )}
          </span>
        );
      },
      searchValue: (o) => o.customer_delivery_date ?? '',
      sortFn: (a, b) => String(a.customer_delivery_date ?? '').localeCompare(String(b.customer_delivery_date ?? '')),
      filterType: 'date', dateValue: (o) => o.customer_delivery_date,
    },
    {
      key: 'internal_expected_dd', label: 'Est. (New)', width: 120, sortable: true, defaultHidden: true,
      accessor: (o) => fmtDateOrDash(o.internal_expected_dd),
      searchValue: (o) => o.internal_expected_dd ?? '',
      sortFn: (a, b) => String(a.internal_expected_dd ?? '').localeCompare(String(b.internal_expected_dd ?? '')),
      filterType: 'date', dateValue: (o) => o.internal_expected_dd,
    },
    {
      key: 'days_left', label: 'Days Left', width: 110, align: 'right', sortable: true,
      accessor: (o) => <DaysLeftCell days={o.days_left} />,
      searchValue: (o) => (o.days_left == null ? '' : String(o.days_left)),
      sortFn: (a, b) => (a.days_left ?? 99999) - (b.days_left ?? 99999),
      numberValue: (o) => o.days_left,
    },
    {
      key: 'stock_remark', label: 'Stock', width: 150, groupable: true,
      accessor: (o) => (
        <span style={{ fontSize: 'var(--fs-12)', color: o.stock_status === 'PENDING' ? 'var(--fg-muted)' : 'var(--c-secondary-a)' }}>
          {o.stock_remark || o.stock_status}
        </span>
      ),
      searchValue: (o) => `${o.stock_remark} ${o.stock_status}`.trim(),
      groupValue: (o) => o.stock_status,
    },
    {
      key: 'delivery_state', label: 'State', width: 150, sortable: true, groupable: true,
      accessor: (o) => <DeliveryStatePill state={o.delivery_state} />,
      searchValue: (o) => DELIVERY_STATE_LABEL[o.delivery_state],
      groupValue: (o) => DELIVERY_STATE_LABEL[o.delivery_state],
      exportValue: (o) => DELIVERY_STATE_LABEL[o.delivery_state],
      sortFn: (a, b) => a.delivery_state.localeCompare(b.delivery_state),
    },
    {
      key: 'crew', label: 'Driver / Lorry', width: 180,
      accessor: (o) => {
        if (!o.crew) return <span style={{ color: 'var(--fg-muted)' }}>—</span>;
        const parts = [o.crew.driver, o.crew.lorry].filter(Boolean);
        return parts.length > 0 ? parts.join(' · ') : <span style={{ color: 'var(--fg-muted)' }}>—</span>;
      },
      searchValue: (o) => [o.crew?.driver, o.crew?.helper, o.crew?.lorry].filter(Boolean).join(' '),
    },
    {
      key: 'balance_centi', label: 'Outstanding', width: 130, align: 'right', sortable: true,
      accessor: (o) => (
        <span style={{ fontFamily: 'var(--font-mark)', fontWeight: 700, color: o.balance_centi > 0 ? 'var(--c-burnt)' : 'var(--fg-muted)' }}>
          {fmtCenti(o.balance_centi)}
        </span>
      ),
      searchValue: (o) => String(o.balance_centi),
      exportValue: (o) => o.balance_centi / 100,
      sortFn: (a, b) => a.balance_centi - b.balance_centi,
      numberValue: (o) => o.balance_centi / 100,
    },
    {
      key: 'do', label: 'DO', width: 130, groupable: true,
      accessor: (o) => (o.delivery_orders.length > 0 ? o.delivery_orders.map((d) => d.do_number).join(', ') : '—'),
      searchValue: (o) => o.delivery_orders.map((d) => d.do_number).join(' '),
    },
  // legDateForRegion depends on activeRegion → recompute the date column on region change.
  ], [activeRegion]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className={styles.page ?? ''} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)', padding: 'var(--space-3) var(--space-4) var(--space-4)', background: 'var(--c-cream)', minHeight: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--fs-15, 15px)', fontWeight: 600, color: 'var(--c-ink)', margin: 0 }}>
            Delivery Planning
          </h1>
          <p style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-11)', color: 'var(--fg-muted)', margin: '2px 0 0' }}>
            Orders that need delivering · grouped by region · {counts.ALL} in {REGION_TABS.find((r) => r.key === activeRegion)?.label ?? 'All'}
          </p>
        </div>
      </div>

      {/* 4 STATE TABS (top row) — Pending Delivery / Pending Schedule / Overdue / Delivered, with counts. */}
      <div className={styles.stateTabs}>
        <button
          type="button"
          className={`${styles.stateTab} ${activeState === 'ALL' ? styles.stateTabActive : ''}`}
          onClick={() => setState('ALL')}
        >
          All <span className={styles.tabCount}>{counts.ALL}</span>
        </button>
        {STATE_TABS.map((s) => (
          <button
            key={s}
            type="button"
            className={[
              styles.stateTab,
              s === 'OVERDUE' ? styles.stateTabOverdue : '',
              activeState === s ? styles.stateTabActive : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setState(s)}
          >
            {DELIVERY_STATE_LABEL[s]} <span className={styles.tabCount}>{counts[s]}</span>
          </button>
        ))}
      </div>

      {/* REGION chip row — All · PJ·KL · Penang · Sabah · Sarawak · Singapore. */}
      <div className={styles.regionChips}>
        {REGION_TABS.map((r) => (
          <button
            key={r.key}
            type="button"
            className={[
              styles.regionChip,
              r.sg ? styles.regionChipSg : '',
              activeRegion === r.key ? styles.regionChipActive : '',
            ].filter(Boolean).join(' ')}
            onClick={() => setRegion(r.key)}
          >
            {r.label}
          </button>
        ))}
      </div>

      {error && !isLoading && (
        <div className={styles.bannerWarn ?? ''} style={{ background: 'rgba(232, 107, 58, 0.08)', border: '1px solid var(--c-orange)', color: 'var(--c-burnt)', padding: 'var(--space-3) var(--space-4)', borderRadius: 'var(--radius-md)', fontSize: 'var(--fs-12)' }}>
          <strong>Failed to load delivery planning.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <DataGrid
        rows={rows}
        columns={columns}
        storageKey="dg-delivery-planning"
        exportName="DeliveryPlanning"
        rowKey={(o) => o.so_doc_no}
        searchPlaceholder="Search SO / customer / phone…"
        groupBanner={false}
        isLoading={isLoading}
        emptyMessage="No orders need delivering in this view."
        rowStyle={(o) => (o.regions.includes('SINGAPORE') ? { boxShadow: 'inset 3px 0 0 var(--c-secondary-a)' } : undefined)}
      />
    </div>
  );
};
