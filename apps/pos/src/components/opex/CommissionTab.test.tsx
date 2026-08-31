import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup, within } from '@testing-library/react';
// Re-import for tsc: the runtime setup (test/setup.ts) loads the matchers, but
// its type augmentation isn't in this tsconfig's program.
import '@testing-library/jest-dom/vitest';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);

import type { HrCommissionReport } from '../../lib/hr-commission-queries';

/* The whole data layer is mocked. This file is about what the SCREEN says given
   a report — the arithmetic that produced the report is the server's, and is
   tested where it lives (Houzs scm/shared/hr-commission.test.ts). What is worth
   pinning here is the part a component can get wrong on its own: totalling the
   rows, telling an open period from a closed one, and explaining an empty
   scheme instead of printing a confident RM 0. */
const useHrCommission = vi.fn();
vi.mock('../../lib/hr-commission-queries', () => ({
  useHrCommission: (...a: unknown[]) => useHrCommission(...a),
  useCloseHrPayout: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useReopenHrPayout: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { CommissionTab } from './CommissionTab';

const report = (over: Partial<HrCommissionReport> = {}): HrCommissionReport => ({
  from: '2026-08-01',
  to: '2026-08-31',
  config: {
    baseBps: 100,
    personalKpiThresholdSen: 10_000_000,
    personalKpiBonusBps: 50,
    showroomKpiThresholdSen: 40_000_000,
    showroomKpiBonusBps: 50,
    overrideBaseBps: 50,
    overrideKpiBonusBps: 50,
    overrideMode: 'showroom',
  },
  overrideMode: 'showroom',
  closed: null,
  overrideLevels: [],
  showrooms: [
    {
      showroomId: 'kl',
      showroomName: 'Showroom KL',
      showroomGoodsSen: 30_000_000,
      showroomKpiHit: false,
      rows: [
        {
          staffId: 's1',
          staffName: 'Scarlett',
          tier: 'sales',
          personalGoodsSen: 20_000_000, // RM 200,000
          personalRateBps: 150,
          personalCommissionSen: 300_000, // RM 3,000
          overrideRateBps: 0,
          overrideCommissionSen: 0,
          itemKpiSen: 15_000, // RM 150
          kpiDetail: [
            { label: 'BF — Bloom fabric', qty: 3, bonusSen: 5_000, lineSen: 15_000 },
          ],
          totalSen: 315_000,
        },
        {
          staffId: 's2',
          staffName: 'Aiman',
          tier: 'manager',
          personalGoodsSen: 10_000_000,
          personalRateBps: 100,
          personalCommissionSen: 100_000,
          overrideRateBps: 50,
          overrideCommissionSen: 150_000,
          itemKpiSen: 0,
          kpiDetail: [],
          totalSen: 250_000,
        },
      ],
    },
  ],
  ...over,
});

const mockReport = (data: HrCommissionReport | undefined, extra: Record<string, unknown> = {}) => {
  useHrCommission.mockReturnValue({
    data, isLoading: false, isFetching: false, error: null, ...extra,
  });
};

describe('CommissionTab', () => {
  it('totals every row across the company, not just the first showroom', () => {
    const two = report({
      showrooms: [
        ...report().showrooms,
        {
          showroomId: 'pj',
          showroomName: 'Showroom PJ',
          showroomGoodsSen: 5_000_000,
          showroomKpiHit: false,
          rows: [{
            staffId: 's3', staffName: 'Wei', tier: 'sales',
            personalGoodsSen: 5_000_000, personalRateBps: 100,
            personalCommissionSen: 50_000, overrideRateBps: 0, overrideCommissionSen: 0,
            itemKpiSen: 5_000, kpiDetail: [], totalSen: 55_000,
          }],
        },
      ],
    });
    mockReport(two);
    render(<CommissionTab canManage />);

    // 200,000 + 100,000 + 50,000 = RM 350,000 of product sales.
    expect(screen.getByText('RM 350,000.00')).toBeInTheDocument();
    // 3,000 + 1,000 + 500 = RM 4,500 revenue commission.
    expect(screen.getByText('RM 4,500.00')).toBeInTheDocument();
    // 315,000 + 250,000 + 55,000 sen = RM 6,200 total payout.
    expect(screen.getByText('RM 6,200.00')).toBeInTheDocument();
    expect(screen.getByText(/3 salespeople/)).toBeInTheDocument();
  });

  it('shows an open period as recalculating live, and offers to close it', () => {
    mockReport(report());
    render(<CommissionTab canManage />);
    expect(screen.getByText(/Open · recalculates live/)).toBeInTheDocument();
    expect(screen.getByText(/editing a rate in Setup will change these figures/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Close period/ })).toBeInTheDocument();
  });

  it('shows a closed period as frozen, and offers to reopen it', () => {
    mockReport(report({
      closed: {
        id: 'p1', from: '2026-08-01', to: '2026-08-31', revision: 2, status: 'CLOSED',
        engineVersion: 'v2', totalSen: 565_000, rowCount: 2,
        closedByName: 'Loo', closedAt: '2026-09-01T02:00:00Z',
        reopenedByName: null, reopenedAt: null, reopenReason: null,
      },
    }));
    render(<CommissionTab canManage />);
    expect(screen.getByText(/Closed · revision 2/)).toBeInTheDocument();
    expect(screen.getByText(/Changing a rate\s+now will not move them/)).toBeInTheDocument();
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
    mockReport(report({ showrooms: [] }));
    render(<CommissionTab canManage />);
    expect(screen.getByText(/No salesperson is on the commission scheme yet/)).toBeInTheDocument();
    expect(screen.getByText(/their orders are also left out of their/i)).toBeInTheDocument();
  });

  it('expands a KPI breakdown whose lines sum to the row figure', () => {
    mockReport(report());
    render(<CommissionTab canManage />);
    // Collapsed to begin with.
    expect(screen.queryByText('BF — Bloom fabric')).not.toBeInTheDocument();

    const row = screen.getByText('Scarlett').closest('tr')!;
    fireEvent.click(within(row).getByRole('button'));

    expect(screen.getByText('BF — Bloom fabric')).toBeInTheDocument();
    // 3 × RM 50 = RM 150, which is the row's KPI column.
    expect(screen.getByText('3 × RM 50.00')).toBeInTheDocument();
  });

  it('refuses to calculate an inverted date range', () => {
    mockReport(report());
    render(<CommissionTab canManage />);
    const from = screen.getByLabelText(/From \(SO date\)/);
    fireEvent.change(from, { target: { value: '2026-12-31' } });

    expect(screen.getByText(/the range is empty/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Calculate/ })).toBeDisabled();
  });

  it('states which revenue the percentage is paid on', () => {
    mockReport(report());
    render(<CommissionTab canManage />);
    // The single most expensive question about a commission report.
    expect(screen.getByText(/excludes the add-on amount of anything that/i)).toBeInTheDocument();
  });
});
