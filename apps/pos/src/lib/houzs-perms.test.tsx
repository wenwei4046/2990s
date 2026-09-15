import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

// vitest runs with globals:false, so RTL's automatic cleanup never registers.
afterEach(cleanup);

/* ═══════════════════════════════════════════════════════════════════════════
   The Maintain section went dark for the owner on 2026-09-07 with no change to
   this repo: his Houzs Title moved from "Super Admin" to a newly created
   "Managing Director", whose slug is not in Houzs's POSITION_SLUG_TO_POS_ROLE,
   so derivePosRole fell back to the scm.staff.role that migration 0066 stamps
   'sales' on everyone. isGlobalCurator('sales') is false → no sidebar links, and
   MaintainGate bounced the hand-typed URLs.

   These pin the fix: the answer also comes from `scm_config_writer`, the flag
   Houzs itself resolves and gates the writes on, so a renamed Title cannot turn
   the tooling off again.
   ═══════════════════════════════════════════════════════════════════════════ */

const staffResult: { data?: { role: string } | null; isLoading: boolean } = {
  data: { role: 'sales' },
  isLoading: false,
};

vi.mock('./staff', async (importOriginal) => ({
  // isGlobalCurator is the predicate under test — keep the real one.
  ...(await importOriginal<typeof import('./staff')>()),
  useStaff: () => staffResult,
}));
vi.mock('./auth', () => ({ useAuth: () => ({ user: { id: 'u-loo' } }) }));
vi.mock('./houzsSession', () => ({ getHouzsToken: () => 'tok' }));
vi.mock('./apiClient', () => ({
  IS_HOUZS: true,
  HOUZS_COMPANY_ID: '2',
  houzsApiRoot: () => 'https://erp.houzscentury.test/api',
}));

import { useMaintainAccess, useCanViewAllSales, useCanChangePin } from './houzs-perms';

/** Stub /auth/me with the body Houzs would return for this caller — pass
 *  `permissions`, `scm_config_writer` and/or `capabilities` as Houzs would. */
const stubMe = (user: Record<string, unknown>) => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify({ user }), { status: 200 })),
  );
};

const wrapper = ({ children }: { children: ReactNode }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
};

const render = () => renderHook(() => useMaintainAccess(), { wrapper });

beforeEach(() => {
  staffResult.data = { role: 'sales' };
  staffResult.isLoading = false;
});
afterEach(() => vi.unstubAllGlobals());

describe('useMaintainAccess — a Houzs Title rename must not switch Maintain off', () => {
  it('lets the owner in on scm_config_writer even though his derived role is "sales"', async () => {
    // Exactly the 2026-09-07 state: Title "Managing Director" → role 'sales',
    // Houzs role Super Admin → permissions ['*'] → scm_config_writer true.
    stubMe({ permissions: ['*'], scm_config_writer: true });
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canMaintain).toBe(true);
  });

  it('still lets the POS curator roles in when Houzs says nothing', async () => {
    staffResult.data = { role: 'sales_director' };
    stubMe({ permissions: [], scm_config_writer: false });
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canMaintain).toBe(true);
  });

  it('keeps a plain salesperson out — the section is not opened to everyone', async () => {
    stubMe({ permissions: ['scm.access'], scm_config_writer: false });
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canMaintain).toBe(false);
  });

  it('reads a missing flag as "no", never as a grant (older Houzs build)', async () => {
    stubMe({ permissions: ['scm.access'] }); // no scm_config_writer field at all
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canMaintain).toBe(false);
  });

  it('reports loading until BOTH reads settle — MaintainGate redirects on a false "no"', () => {
    staffResult.isLoading = true;
    stubMe({ permissions: ['*'], scm_config_writer: true });
    const { result } = render();
    expect(result.current.isLoading).toBe(true);
  });

  it('survives an /auth/me blip without throwing the page', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline'); }));
    const { result } = render();
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.canMaintain).toBe(false);
  });
});

/* ═══════════════════════════════════════════════════════════════════════════
   Same root cause, two more symptoms (2026-09-15).

   With the owner's POS role fallen back to 'sales', My Orders self-scoped even
   though Houzs was still returning every order to him, and the Topbar offered
   him "Change PIN" — a PIN he cannot have, because /pos/pin-login refuses any
   member whose position slug does not start with "sales".

   Both now read Houzs's own resolved capability set. Note the two directions:
   view-all WIDENS (OR the role rule), Change PIN NARROWS — and only on a
   definite `false`, never on "not answered".
   ═══════════════════════════════════════════════════════════════════════════ */

const renderViewAll = () => renderHook(() => useCanViewAllSales(), { wrapper });
const renderChangePin = () => renderHook(() => useCanChangePin(), { wrapper });

describe('useCanViewAllSales — the board follows the rows Houzs actually returns', () => {
  it('shows every salesperson to the owner, whose derived role says "sales"', async () => {
    stubMe({ permissions: ['*'], capabilities: { 'scm.sales.viewAll': true } });
    const { result } = renderViewAll();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('never narrows: a POS view-all role keeps the filter when Houzs says no', async () => {
    staffResult.data = { role: 'sales_director' };
    stubMe({ permissions: [], capabilities: { 'scm.sales.viewAll': false } });
    const { result } = renderViewAll();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('keeps a plain salesperson self-scoped', async () => {
    stubMe({ permissions: ['scm.access'], capabilities: { 'scm.sales.viewAll': false } });
    const { result } = renderViewAll();
    await waitFor(() => expect(result.current).toBe(false));
  });
});

describe('useCanChangePin — no PIN to change, no key icon', () => {
  it('hides it from the owner: org.sales.staff false, so Houzs would refuse his PIN login', async () => {
    // Loo: position "Managing Director", department "Management" → isSalesUser false.
    stubMe({ permissions: ['*'], capabilities: { 'org.sales.staff': false } });
    const { result } = renderChangePin();
    await waitFor(() => expect(result.current).toBe(false));
  });

  it('keeps it for a real salesperson', async () => {
    stubMe({ permissions: ['scm.access'], capabilities: { 'org.sales.staff': true } });
    const { result } = renderChangePin();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('does NOT hide on "not answered" — that would strand a salesperson', async () => {
    stubMe({ permissions: ['scm.access'] }); // no capabilities at all
    const { result } = renderChangePin();
    await waitFor(() => expect(result.current).toBe(true));
  });

  it('org.sales.staff true does not by itself hand out the link', async () => {
    // admin is org-Sales in this fixture but is not a passcode-login role, and
    // the role rule still decides once Houzs has not vetoed.
    staffResult.data = { role: 'admin' };
    stubMe({ permissions: ['*'], capabilities: { 'org.sales.staff': true } });
    const { result } = renderChangePin();
    await waitFor(() => expect(result.current).toBe(false));
  });
});
