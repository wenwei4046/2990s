// ----------------------------------------------------------------------------
// Fetching the SO headers the OPEX Commission report's revenue split folds.
//
// The RULES are in commission-revenue.ts (pure, tested). This file is the walk.
// ----------------------------------------------------------------------------

import { useQuery } from '@tanstack/react-query';
import { authedFetch } from './apiClient';
import { foldSoRevenue, type SalespersonRevenue } from './commission-revenue';

/** One SO header row, as either backend spells it. */
type SoHeader = Record<string, unknown>;

/* The so_date window is honoured ONLY on the paginated path — the legacy branch
   ignores from/to and hands back the newest 500 orders whatever the range. So
   `page` is always sent, and the pages are walked. pageSize is capped at 100
   server-side. */
const PAGE_SIZE = 100;
/* 40 pages = 4,000 orders. A commission period is a month (66 company-wide in
   August 2026), so this is ~5 years of headroom; it exists so a mis-typed range
   cannot turn one screen into a hundred requests. Hitting it reports a mismatch
   rather than a short total. */
const MAX_PAGES = 40;

export interface CommissionRevenue {
  byStaff: Map<string, SalespersonRevenue>;
  /** True when the walk stopped at MAX_PAGES — the fold is incomplete. */
  truncated: boolean;
}

export function useCommissionRevenue(from: string, to: string) {
  return useQuery<CommissionRevenue>({
    queryKey: ['hr', 'commission-revenue', from, to],
    enabled: Boolean(from) && Boolean(to),
    staleTime: 30_000,
    queryFn: async () => {
      const rows: SoHeader[] = [];
      let truncated = false;
      for (let page = 0; page < MAX_PAGES; page += 1) {
        const params = new URLSearchParams({
          page: String(page),
          pageSize: String(PAGE_SIZE),
          from,
          to,
          /* NO status param. The commission filter runs in foldSoRevenue; asking
             the server for one tab would silently drop the others, and `all` is
             a spelling only Houzs normalises away (2990's older list applied it
             literally and matched zero rows). Omitting it means "every status"
             on both. */
        });
        const body = await authedFetch<{ salesOrders?: SoHeader[]; total?: number }>(
          `/mfg-sales-orders?${params.toString()}`,
        );
        const batch = body.salesOrders ?? [];
        rows.push(...batch);
        const total = typeof body.total === 'number' ? body.total : rows.length;
        if (batch.length === 0 || rows.length >= total) break;
        if (page === MAX_PAGES - 1) truncated = true;
      }
      return { byStaff: foldSoRevenue(rows), truncated };
    },
  });
}
