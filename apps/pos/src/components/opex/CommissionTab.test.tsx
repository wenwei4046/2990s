import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
// Re-import for tsc: the runtime setup (test/setup.ts) loads the matchers, but
// its type augmentation isn't in this tsconfig's program.
import '@testing-library/jest-dom/vitest';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);

import type { CommissionReport } from '../../lib/commission-engine';
import type { PayoutPeriod } from '../../lib/commission-api';
import type { SalespersonRevenue } from '../../lib/commission-revenue';

/* The data layer is mocked; the RULES it feeds (splitForRow) run for real. This
   file is about what the SCREEN says given a report — the arithmetic that
   produced it is @2990s/shared/hr-commission, tested where it lives. What is
   worth pinning here is what a component can get wrong on its own: totalling
   the rows, telling an open period from a closed one, surfacing a warning
   instead of a confident number, and never showing a payout it cannot stand
   behind. */
const useCommissionReport = vi.fn();
vi.mock('../../lib/commission-engine', () => ({
  useCommissionReport: (...a: unknown[]) => useCommissionReport(...a),
}));

const closeMutate = vi.fn();
vi.mock('../../lib/commission-api', () => ({
  useClosePayout: () => ({ mutateAsync: closeMutate, isPending: false }),
  useReopenPayout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const useCommissionRevenue = vi.fn();
vi.mock('../../lib/commission-revenue-queries', () => ({
  useCommissionRevenue: (...a: unknown[]) => useCommissionRevenue(...a),
}));

import { CommissionTab } from './CommissionTab';

const report = (over: Partial<CommissionReport> = {}): CommissionReport => ({
  from: '2026-08-01',
  to: '2026-08-31',
  config: {
    baseBps: 100,
    personalKpiThresholdCenti: 10_000_000,
    personalKpiBonusBps: 50,
    showroomKpiThresholdCenti: 40_000_000,
    showroomKpiBonusBps: 50,
    overrideBaseBps: 50,
    overrideKpiBonusBps: 50,
    overrideMode: 'showroom',
  },
  warnings: [],
  totalCenti: 565_000,
  showrooms: [
    {
      showroomId: 'kl',
      showroomName: 'Showroom KL',
      showroomGoodsCenti: 30_000_000,
      showroomKpiHit: false,
      rows: [
        {
          staffId: 's1', staffName: 'Scarlett', tier: 'sales',
          personalGoodsCenti: 20_000_000,       // RM 200,000
          personalRateBps: 150,
          personalCommissionCenti: 300_000,     // RM 3,000
          overrideRateBps: 0, overrideCommissionCenti: 0,
          itemKpiCenti: 15_000,                 // RM 150
          kpiDetail: [{
            label: 'BF — Bloom fabric', qty: 3, bonusCenti: 5_000, lineCenti: 15_000,
            orders: [
              { docNo: '2990-SO-2608-070', qty: 2, lineCenti: 10_000 },
              { docNo: '2990-SO-2608-068', qty: 1, lineCenti: 5_000 },
            ],
          }],
          totalCenti: 315_000,
        },
        {
          staffId: 's2', staffName: 'Aiman', tier: 'manager',
          personalGoodsCenti: 10_000_000,
          personalRateBps: 100,
          personalCommissionCenti: 100_000,
          overrideRateBps: 50, overrideCommissionCenti: 150_000,
          itemKpiCenti: 0, kpiDetail: [],
          totalCenti: 250_000,
        },
      ],
    },
  ],
  ...over,
});

const mockReport = (
  data: CommissionReport | null,
  extra: { closed?: PayoutPeriod | null; isLoading?: boolean; error?: unknown } = {},
) => {
  useCommissionReport.mockReturnValue({
    report: data, closed: null, isLoading: false, error: null, ...extra,
  });
};

/* Scarlett: RM 200,000 goods (nothing excluded) + RM 500 service.
   Aiman: RM 100,000 goods + RM 100 service. */
const REVENUE: Record<string, SalespersonRevenue> = {
  s1: { totalCenti: 20_050_000, goodsCenti: 20_000_000, goodsKnown: true, orders: 4 },
  s2: { totalCenti: 10_010_000, goodsCenti: 10_000_000, goodsKnown: true, orders: 2 },
};

const mockRevenue = (
  byStaff: Record<string, SalespersonRevenue> | null = REVENUE,
  extra: Record<string, unknown> = {},
) => {
  useCommissionRevenue.mockReturnValue({
    data: byStaff
      ? { byStaff: new Map(Object.entries(byStaff)), orders: [], truncated: false }
      : undefined,
    isLoading: false, isFetching: false, error: null, ...extra,
  });
};

/* The tab defaults its period to the CURRENT Malaysian month (currentMonthRange
   → Date.now()), while every fixture in this file is AUGUST 2026 data. Left on
   the real clock, "freezes the computed rows when a period is closed" passed
   only while it really was August 2026 and failed from 1 September onward — it
   blocked the deploy on 2026-09-01 (Actions run 33483816568) with
   `from: '2026-09-01'` where the fixture says '2026-08-01'. Pin the clock to the
   month the fixtures describe. Date only — RTL needs the real timers. */
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-08-15T00:00:00Z'));
  mockRevenue();
  closeMutate.mockReset();
});
afterEach(() => { vi.useRealTimers(); });

describe('CommissionTab', () => {
  it('totals every row across the company, not just the first showroom', () => {
    const two = report({
      totalCenti: 620_000,
      showrooms: [
        ...report().showrooms,
        {
          showroomId: 'pj', showroomName: 'Showroom PJ',
          showroomGoodsCenti: 5_000_000, showroomKpiHit: false,
          rows: [{
            staffId: 's3', staffName: 'Wei', tier: 'sales',
            personalGoodsCenti: 5_000_000, personalRateBps: 100,
            personalCommissionCenti: 50_000, overrideRateBps: 0, overrideCommissionCenti: 0,
            itemKpiCenti: 5_000, kpiDetail: [], totalCenti: 55_000,
          }],
        },
      ],
    });
    mockReport(two);
    render(<CommissionTab canManage />);

    expect(screen.getByText('RM 350,000.00')).toBeInTheDocument(); // product sales
    expect(screen.getByText('RM 4,500.00')).toBeInTheDocument();   // revenue commission
    expect(screen.getByText('RM 6,200.00')).toBeInTheDocument();   // total payout
    expect(screen.getByText(/3 salespeople/)).toBeInTheDocument();
  });

  it('shows an open period as recalculating live, and offers to close it', () => {
    mockReport(report());
    render(<CommissionTab canManage />);
    expect(screen.getByText(/Open · recalculates live/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close period/ })).toBeInTheDocument();
  });

  it('freezes the computed rows when a period is closed', () => {
    /* Commission is computed in the POS, so a bare range would leave the server
       to recompute from inputs it cannot read. What is stored is a record of
       what the approver was looking at. */
    mockReport(report());
    render(<CommissionTab canManage />);
    fireEvent.click(screen.getByRole('button', { name: /Close period/ }));
    expect(closeMutate).toHaveBeenCalledWith(expect.objectContaining({
      from: '2026-08-01', to: '2026-08-31', totalCenti: 565_000,
    }));
    expect((closeMutate.mock.calls[0]![0] as { rows: unknown[] }).rows).toHaveLength(2);
  });

  it('shows a closed period as frozen, and offers to reopen it', () => {
    mockReport(report(), {
      closed: {
        id: 'p1', from: '2026-08-01', to: '2026-08-31', revision: 2, status: 'CLOSED',
        engineVersion: 'v3', totalCenti: 565_000, rowCount: 2, rows: [],
        closedByName: 'Loo', closedAt: '2026-09-01T02:00:00Z',
        reopenedByName: null, reopenedAt: null, reopenReason: null,
      },
    });
    render(<CommissionTab canManage />);
    expect(screen.getByText(/Closed · revision 2/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Reopen period/ })).toBeInTheDocument();
  });

  it('hides every period control from a read-only viewer', () => {
    mockReport(report());
    render(<CommissionTab canManage={false} />);
    // The figures still render — read-only means read, not blank.
    expect(screen.getByText('Scarlett')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Close period/ })).not.toBeInTheDocument();
  });

  it('explains an empty scheme instead of printing a confident zero', () => {
    mockReport(report({ showrooms: [], totalCenti: 0 }));
    render(<CommissionTab canManage />);
    expect(screen.getByText(/No salesperson is on the commission scheme yet/)).toBeInTheDocument();
  });

  it('surfaces every warning the engine reported', () => {
    /* The engine says WHY a figure may be off rather than shading it — an
       unresolved fabric add-on, a truncated range, a chain mode with no ladder. */
    mockReport(report({ warnings: ['The fabric add-on could not be resolved for 2 item(s)'] }));
    render(<CommissionTab canManage />);
    expect(screen.getByText(/could not be resolved for 2 item/)).toBeInTheDocument();
  });

  it('expands a KPI breakdown whose lines sum to the row figure', () => {
    mockReport(report());
    render(<CommissionTab canManage />);
    expect(screen.queryByText('BF — Bloom fabric')).not.toBeInTheDocument();

    const row = screen.getByText('Scarlett').closest('tr')!;
    fireEvent.click(within(row).getByRole('button'));

    expect(screen.getByText('BF — Bloom fabric')).toBeInTheDocument();
    expect(screen.getByText('3 × RM 50.00')).toBeInTheDocument();
  });

  it('names the sales orders a KPI bonus came from', () => {
    /* Loo 2026-08-31: a line reading "12 × RM 50" is not checkable until you can
       see WHICH twelve. One order can contribute several units, so these are
       per-order subtotals. */
    mockReport(report());
    render(<CommissionTab canManage />);
    const row = screen.getByText('Scarlett').closest('tr')!;
    fireEvent.click(within(row).getByRole('button'));

    /* Scoped to each order's own line: RM 100 and RM 50 both appear elsewhere on
       a busy report, and an unscoped match would pass on the wrong cell. */
    const first = screen.getByText('2990-SO-2608-070').closest('li')!;
    expect(within(first).getByText('2 × RM 50.00')).toBeInTheDocument();
    expect(within(first).getByText('RM 100.00')).toBeInTheDocument();

    const second = screen.getByText('2990-SO-2608-068').closest('li')!;
    expect(within(second).getByText('1 × RM 50.00')).toBeInTheDocument();
    expect(within(second).getByText('RM 50.00')).toBeInTheDocument();

    // The per-order amounts add back to the flag's own line (RM 150).
    expect(screen.getAllByText('RM 150.00').length).toBeGreaterThan(0);
  });

  it('refuses to calculate an inverted date range', () => {
    mockReport(report());
    render(<CommissionTab canManage />);
    fireEvent.change(screen.getByLabelText(/From \(SO date\)/), { target: { value: '2026-12-31' } });
    expect(screen.getByText(/the range is empty/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Calculate/ })).toBeDisabled();
  });
});

describe('CommissionTab — the revenue split', () => {
  it('shows the four revenue lines Loo named', () => {
    mockReport(report());
    render(<CommissionTab canManage />);
    expect(screen.getByText('Products sales revenue')).toBeInTheDocument();
    expect(screen.getByText('Service sales revenue')).toBeInTheDocument();
    expect(screen.getByText('KPI item sales revenue')).toBeInTheDocument();
    /* "Total revenue" also appears in the explanatory note below the tables, so
       this asserts presence rather than uniqueness. */
    expect(screen.getAllByText('Total revenue').length).toBeGreaterThan(0);
  });

  it('derives service and KPI revenue around the engine base', () => {
    mockReport(report());
    render(<CommissionTab canManage />);
    // Service = (20,050,000 − 20,000,000) + (10,010,000 − 10,000,000) = RM 600.
    expect(screen.getByText('RM 600.00')).toBeInTheDocument();
    // Total revenue = 20,050,000 + 10,010,000 centi = RM 300,600.
    expect(screen.getByText('RM 300,600.00')).toBeInTheDocument();
  });

  it('reports KPI item REVENUE separately from the KPI amount EARNED', () => {
    /* Scarlett sold RM 200,175 of goods but the engine paid on RM 200,000 — the
       RM 175 add-on was excluded because it earned a fixed amount instead. That
       RM 175 is the KPI item REVENUE; the RM 150 she was paid for it is a
       different column, and deliberately a different number here. */
    mockRevenue({
      s1: { totalCenti: 20_067_500, goodsCenti: 20_017_500, goodsKnown: true, orders: 4 },
      s2: { totalCenti: 10_012_500, goodsCenti: 10_002_500, goodsKnown: true, orders: 2 },
    });
    mockReport(report());
    render(<CommissionTab canManage />);
    expect(screen.getByText('RM 175.00')).toBeInTheDocument(); // her row
    expect(screen.getByText('RM 200.00')).toBeInTheDocument(); // company tile (hers + RM 25)
    expect(screen.getAllByText('RM 150.00').length).toBeGreaterThan(0); // earned
  });

  it('hides the split rather than showing a wrong number when it cannot reconcile', () => {
    mockRevenue({
      ...REVENUE,
      s1: { totalCenti: 100, goodsCenti: 100, goodsKnown: true, orders: 1 },
    });
    mockReport(report());
    render(<CommissionTab canManage />);

    expect(screen.getByText(/Revenue split unavailable for 1 of 2/)).toBeInTheDocument();
    expect(screen.getByText('revenue n/a')).toBeInTheDocument();
    // The PAYOUT half is untouched — those are the engine's figures.
    expect(screen.getByText('RM 3,000.00')).toBeInTheDocument();
    expect(screen.getByText('RM 5,650.00')).toBeInTheDocument();
  });

  it('keeps Total revenue when only the finance-gated columns are missing', () => {
    // A non-finance viewer loses the per-category buckets but still gets every
    // order's total, so the two halves must fail independently.
    mockRevenue({
      s1: { totalCenti: 20_050_000, goodsCenti: 0, goodsKnown: false, orders: 4 },
      s2: { totalCenti: 10_010_000, goodsCenti: 0, goodsKnown: false, orders: 2 },
    });
    mockReport(report());
    render(<CommissionTab canManage />);

    expect(screen.getByText('RM 300,600.00')).toBeInTheDocument();
    expect(screen.queryByText(/Revenue split unavailable/)).not.toBeInTheDocument();
  });

  it('renders the payout in full when the revenue fold fails outright', () => {
    mockRevenue(null, { error: new Error('500 : {"error":"load_failed"}') });
    mockReport(report());
    render(<CommissionTab canManage />);

    expect(screen.getByText(/The revenue split could not be loaded/)).toBeInTheDocument();
    expect(screen.getByText('RM 5,650.00')).toBeInTheDocument();
  });
});
