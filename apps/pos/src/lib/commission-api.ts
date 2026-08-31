// ----------------------------------------------------------------------------
// The commission SCHEME, read and written against 2990's own API.
//
// Loo 2026-08-31: "我要直接废除掉 Houzs 那边的 commission 机制，所有的
// commission 机制只会在 POS 这边去算". Config, salespeople, KPI rules, the
// override ladder and the payout record all live in 2990's Supabase and are
// reached through `apps/api/src/routes/commission.ts`. ORDERS still come from
// Houzs — that is where they are written — so this page reads two backends, and
// this module is the 2990 half.
//
// ── WHY A BARE fetch AND NOT authedFetch ────────────────────────────────────
// `authedFetch` resolves to the HOUZS base, and on that target it stamps
// `X-Company-Id`. 2990's CORS allowHeaders is
// `['authorization', 'content-type', 'x-client-info']` — the header is not on
// it, so the PREFLIGHT fails and the browser reports a generic "Failed to
// fetch" that looks like the API being down. campaign-promo-queries.ts hit this
// exact wall and documents it. So: bare fetch at VITE_API_URL, bearer only.
//
// ── AUTH ────────────────────────────────────────────────────────────────────
// The bearer is the caller's HOUZS session token. 2990's route verifies it by
// replaying it to Houzs `/auth/me` and gating on `scm.hr.read` /
// `scm.hr.manage` (apps/api/src/lib/houzs-identity.ts). So the same token opens
// both backends without either one holding a secret about the other.
//
// MONEY IS INTEGER CENTI, RATES ARE INTEGER BPS. No arithmetic here.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bearerToken } from './apiClient';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export type HrTier = 'sales' | 'manager';
export type HrOverrideMode = 'showroom' | 'chain';
export type HrFlagType = 'product' | 'category' | 'fabric' | 'special';

export interface CommissionConfigWire {
  baseBps: number;
  personalKpiThresholdCenti: number;
  personalKpiBonusBps: number;
  showroomKpiThresholdCenti: number;
  showroomKpiBonusBps: number;
  overrideBaseBps: number;
  overrideKpiBonusBps: number;
  overrideMode: HrOverrideMode;
  updatedAt?: string;
}

export interface CommissionProfile {
  id: string;
  staffId: string;
  staffName: string;
  staffCode: string;
  tier: HrTier;
  showroomId: string;
  showroomName: string;
  active: boolean;
}

export interface CommissionKpiItem {
  id: string;
  flagType: HrFlagType;
  ref: string;
  label: string;
  bonusCenti: number;
  /** THE OPTION (Loo 2026-08-31). False = earn the fixed amount INSTEAD of the
   *  percentage on the flagged portion. True = earn both, and the amount also
   *  still counts toward the RM 100k / RM 400k gates. */
  countsAsRevenue: boolean;
  active: boolean;
}

export interface CommissionOverrideLevel {
  id: string;
  level: number;
  rateBps: number;
  label: string;
  active: boolean;
}

export interface PayoutPeriod {
  id: string;
  from: string;
  to: string;
  revision: number;
  status: string;
  engineVersion: string;
  totalCenti: number;
  rowCount: number;
  rows: unknown[];
  closedByName: string | null;
  closedAt: string | null;
  reopenedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await bearerToken();
  if (!token) throw new Error('not_authenticated');
  const res = await fetch(`${API_URL}/commission${path}`, {
    // TanStack Query is the cache layer; never let a stale browser copy answer a
    // rate read that a save just invalidated.
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      ...(typeof init?.body === 'string' ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    /* Read the body ONCE — a Response body cannot be consumed twice, so the
       text fallback has to come from the same read. hrErrorMessage pulls the
       server's `reason` sentence back out of this. */
    const detail = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${detail}`);
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

const send = (path: string, method: string, body?: unknown) =>
  call<unknown>(path, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/* Every rate, person and rule feeds the report, so ANY write invalidates the
   whole domain — a stale rate beside fresh rows is a figure nobody can
   reconcile. */
const ROOT = ['commission'] as const;
const invalidate = (qc: ReturnType<typeof useQueryClient>) => () => {
  void qc.invalidateQueries({ queryKey: ROOT });
};

/* ── config ───────────────────────────────────────────────────────────────── */

export function useCommissionConfig() {
  return useQuery({
    queryKey: ['commission', 'config'],
    staleTime: 60_000,
    queryFn: () => call<{ config: CommissionConfigWire }>('/config').then((r) => r.config),
  });
}

export type CommissionConfigPatch = Partial<Omit<CommissionConfigWire, 'updatedAt'>>;

export function useUpdateCommissionConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: CommissionConfigPatch) => send('/config', 'PATCH', body),
    onSuccess: invalidate(qc),
  });
}

/* ── salespeople ──────────────────────────────────────────────────────────── */

export function useCommissionProfiles() {
  return useQuery({
    queryKey: ['commission', 'profiles'],
    staleTime: 60_000,
    queryFn: () => call<{ profiles: CommissionProfile[] }>('/profiles').then((r) => r.profiles),
  });
}

export function useCreateCommissionProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      staffId: string; staffName: string; staffCode: string;
      tier: HrTier; showroomId: string; showroomName: string;
    }) => send('/profiles', 'POST', body),
    onSuccess: invalidate(qc),
  });
}

export function useUpdateCommissionProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; tier?: HrTier; showroomId?: string; showroomName?: string; active?: boolean;
    }) => send(`/profiles/${id}`, 'PATCH', body),
    onSuccess: invalidate(qc),
  });
}

export function useDeleteCommissionProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send(`/profiles/${id}`, 'DELETE'),
    onSuccess: invalidate(qc),
  });
}

/* ── KPI rules ────────────────────────────────────────────────────────────── */

export function useCommissionKpiItems() {
  return useQuery({
    queryKey: ['commission', 'item-kpi'],
    staleTime: 60_000,
    queryFn: () => call<{ items: CommissionKpiItem[] }>('/item-kpi').then((r) => r.items),
  });
}

export function useCreateCommissionKpiItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      flagType: HrFlagType; ref: string; label: string;
      bonusCenti: number; countsAsRevenue: boolean;
    }) => send('/item-kpi', 'POST', body),
    onSuccess: invalidate(qc),
  });
}

export function useUpdateCommissionKpiItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: {
      id: string; label?: string; bonusCenti?: number; countsAsRevenue?: boolean; active?: boolean;
    }) => send(`/item-kpi/${id}`, 'PATCH', body),
    onSuccess: invalidate(qc),
  });
}

export function useDeleteCommissionKpiItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send(`/item-kpi/${id}`, 'DELETE'),
    onSuccess: invalidate(qc),
  });
}

/* ── override ladder ──────────────────────────────────────────────────────── */

export function useCommissionOverrideLevels() {
  return useQuery({
    queryKey: ['commission', 'override-levels'],
    staleTime: 60_000,
    queryFn: () => call<{ levels: CommissionOverrideLevel[] }>('/override-levels').then((r) => r.levels),
  });
}

export function useCreateCommissionOverrideLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { level: number; rateBps: number; label?: string }) =>
      send('/override-levels', 'POST', body),
    onSuccess: invalidate(qc),
  });
}

export function useDeleteCommissionOverrideLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => send(`/override-levels/${id}`, 'DELETE'),
    onSuccess: invalidate(qc),
  });
}

/* ── payout periods ───────────────────────────────────────────────────────── */

/** The closure record for ONE range, or null when it has never been closed.
 *  Queried per range rather than as a list: the report only ever asks about the
 *  range on screen, and a list would go stale the moment one is closed. */
export function usePayoutPeriod(from: string, to: string) {
  return useQuery({
    queryKey: ['commission', 'payout', from, to],
    enabled: Boolean(from) && Boolean(to),
    staleTime: 30_000,
    queryFn: async () => {
      const params = new URLSearchParams({ from, to });
      const { periods } = await call<{ periods: PayoutPeriod[] }>(`/payout/periods?${params}`);
      // Only a CLOSED row freezes a range; a REOPENED one is history.
      return periods.find((p) => p.status === 'CLOSED') ?? null;
    },
  });
}

export function useClosePayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { from: string; to: string; totalCenti: number; rows: unknown[] }) =>
      send('/payout/close', 'POST', body),
    onSuccess: invalidate(qc),
  });
}

export function useReopenPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { from: string; to: string; reason: string }) =>
      send('/payout/reopen', 'POST', body),
    onSuccess: invalidate(qc),
  });
}
