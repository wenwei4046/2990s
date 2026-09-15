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

import { useMaintainAccess } from './houzs-perms';

/** Stub /auth/me with the body Houzs would return for this caller. */
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
