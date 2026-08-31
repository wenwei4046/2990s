// ----------------------------------------------------------------------------
// Data layer for the OPEX Commission page — the POS half of Houzs
// `backend/src/scm/routes/hr.ts` (base /api/scm/hr).
//
// WHY THE POS TALKS TO HOUZS HERE. Since the 2026-07-21 cutover every POS Sales
// Order is written into Houzs company 2, and nothing syncs back. So Houzs is
// where the orders are, where the commission tables live, and where the only
// commission engine runs. A 2990-side calculator would be reading a database
// that has not seen a POS order since July. `authedFetch` already resolves to
// the Houzs SCM base and stamps X-Company-Id, so these are ordinary calls.
//
// MONEY IS INTEGER SEN, RATES ARE INTEGER BASIS POINTS, and no arithmetic on
// either happens in this file — see lib/commission-format.ts, which is the one
// place they are converted for the screen.
//
// ── THE TWO SPELLINGS ───────────────────────────────────────────────────────
// Houzs migration 0305 renamed every `*Centi` field to `*Sen` (same unit —
// hundredths of a ringgit — a rename, never a conversion). 2990's own API still
// serves `*Centi` and is the target in local dev. So, exactly as the rest of the
// POS does it:
//   · READ  — normalise `*Centi` up to `*Sen` at this one boundary
//     (`centiKeysToSen`), so components only ever know one spelling.
//   · WRITE — send BOTH spellings. Both schemas are non-strict zod objects, so
//     each server keeps the key it knows and drops the other.
// An absent key is `undefined`, not an error: getting this wrong is how a
// payroll screen quietly reads RM 0 for everyone. See lib/houzs-money-keys.ts
// for the incident this pattern comes from.
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './apiClient';
import { centiKeysToSen, withCentiTwins } from './hr-wire';

export type HrTier = 'sales' | 'manager';
export type HrOverrideMode = 'showroom' | 'chain';

/** What one item-KPI rule targets.
 *  · product  → mfg_products.code (one SKU)
 *  · category → the product category enum (SOFA / BEDFRAME / …) — one rule
 *               covering everything in it. A product rule on the same item
 *               BEATS it and the category rule then pays nothing.
 *  · fabric   → fabric_library.id, i.e. the fabric SERIES, never one colour
 *  · special  → a special-order add-on code on the line */
export type HrFlagType = 'product' | 'category' | 'fabric' | 'special';

export interface HrConfig {
  baseBps: number;
  personalKpiThresholdSen: number;
  personalKpiBonusBps: number;
  showroomKpiThresholdSen: number;
  showroomKpiBonusBps: number;
  overrideBaseBps: number;
  overrideKpiBonusBps: number;
  overrideMode: HrOverrideMode;
  updatedAt?: string;
}

export interface HrProfile {
  id: string;
  staffId: string;
  staffName: string;
  staffCode: string;
  tier: HrTier;
  showroomId: string;
  active: boolean;
}

export interface HrItemKpi {
  id: string;
  flagType: HrFlagType;
  ref: string;
  label: string;
  bonusSen: number;
  active: boolean;
}

export interface HrOverrideLevel {
  id: string;
  level: number;
  rateBps: number;
  label: string;
  active: boolean;
}

export interface HrPickerRef { ref: string; label: string }

export interface HrPickers {
  staff: Array<{ id: string; name: string; staffCode: string; role: string }>;
  showrooms: Array<{ id: string; name: string }>;
  products: HrPickerRef[];
  categories: HrPickerRef[];
  fabrics: HrPickerRef[];
  specials: HrPickerRef[];
}

export interface HrOverrideLevelDetail {
  level: number;
  rateBps: number;
  goodsSen: number;
  commissionSen: number;
}

export interface HrCommissionRow {
  staffId: string;
  staffName: string;
  tier: HrTier;
  /** Commissionable goods: SO goods LESS the item-KPI exclusion. This is the
   *  base the percentage runs on and the figure the RM 100k gate reads — the
   *  page labels it "Product sales", which is what it is. */
  personalGoodsSen: number;
  personalRateBps: number;
  personalCommissionSen: number;
  /** null in chain mode — the override there is a sum over levels of different
   *  rates on different bases, so there is no single rate to print. */
  overrideRateBps: number | null;
  overrideCommissionSen: number;
  overrideDetail?: HrOverrideLevelDetail[];
  itemKpiSen: number;
  kpiDetail: Array<{ label: string; qty: number; bonusSen: number; lineSen: number }>;
  totalSen: number;
}

export interface HrCommissionShowroom {
  showroomId: string;
  showroomName: string;
  showroomGoodsSen: number;
  showroomKpiHit: boolean;
  rows: HrCommissionRow[];
}

export interface HrPayoutPeriod {
  id: string;
  from: string;
  to: string;
  revision: number;
  status: string;
  engineVersion: string;
  totalSen: number;
  rowCount: number;
  closedByName: string | null;
  closedAt: string | null;
  reopenedByName: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
}

export interface HrCommissionReport {
  from: string;
  to: string;
  config: HrConfig;
  overrideMode: HrOverrideMode;
  /** Non-null when this range is CLOSED: the rows are frozen and served from the
   *  snapshot, so a later rate edit cannot move an approved payout. */
  closed: HrPayoutPeriod | null;
  overrideLevels: Array<{ level: number; rateBps: number }>;
  showrooms: HrCommissionShowroom[];
}

const getJson = async <T>(path: string): Promise<T> =>
  centiKeysToSen(await authedFetch<unknown>(path)) as T;

const sendJson = async <T>(
  path: string,
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE',
  body?: Record<string, unknown>,
): Promise<T> => {
  const raw = await authedFetch<unknown>(path, {
    method,
    ...(body ? { body: JSON.stringify(withCentiTwins(body)) } : {}),
  });
  return centiKeysToSen(raw) as T;
};

/* Every rate, profile and flag feeds the report, so ANY write invalidates the
   whole domain rather than one list — a stale rate beside fresh rows is a
   payroll figure nobody can reconcile. */
const HR_ROOT = ['hr'] as const;

/* ── config ─────────────────────────────────────────────────────────────── */

export function useHrConfig() {
  return useQuery({
    queryKey: ['hr', 'config'],
    staleTime: 60_000,
    queryFn: () => getJson<{ config: HrConfig }>('/hr/config').then((r) => r.config),
  });
}

export type HrConfigPatch = Partial<Omit<HrConfig, 'updatedAt'>>;

export function useUpdateHrConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: HrConfigPatch) =>
      sendJson<{ config: HrConfig }>('/hr/config', 'PATCH', body as Record<string, unknown>),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

/* ── salespeople on the scheme ──────────────────────────────────────────── */
/* A person with no active profile is invisible to the report AND contributes
   nothing to their showroom's total. The profile IS the scheme — register
   everyone who should earn before reading a period. */

export function useHrProfiles() {
  return useQuery({
    queryKey: ['hr', 'profiles'],
    staleTime: 60_000,
    queryFn: () => getJson<{ profiles: HrProfile[] }>('/hr/profiles').then((r) => r.profiles),
  });
}

export function useCreateHrProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { staffId: string; tier: HrTier; showroomId: string; active?: boolean }) =>
      sendJson<{ profile: HrProfile }>('/hr/profiles', 'POST', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

export function useUpdateHrProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; tier?: HrTier; showroomId?: string; active?: boolean }) =>
      sendJson<{ profile: HrProfile }>(`/hr/profiles/${id}`, 'PATCH', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

export function useDeleteHrProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<{ ok: true }>(`/hr/profiles/${id}`, 'DELETE'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

/* ── item KPI rules ─────────────────────────────────────────────────────── */

export function useHrItemKpi() {
  return useQuery({
    queryKey: ['hr', 'item-kpi'],
    staleTime: 60_000,
    queryFn: () => getJson<{ items: HrItemKpi[] }>('/hr/item-kpi').then((r) => r.items),
  });
}

export function useCreateHrItemKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { flagType: HrFlagType; ref: string; label?: string; bonusSen: number; active?: boolean }) =>
      sendJson<{ item: HrItemKpi }>('/hr/item-kpi', 'POST', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

export function useUpdateHrItemKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; label?: string; bonusSen?: number; active?: boolean }) =>
      sendJson<{ item: HrItemKpi }>(`/hr/item-kpi/${id}`, 'PATCH', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

export function useDeleteHrItemKpi() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<{ ok: true }>(`/hr/item-kpi/${id}`, 'DELETE'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

/* ── chain-mode override ladder ─────────────────────────────────────────── */
/* One rate per rung of the reporting line: level 1 = a person's DIRECT reports,
   level 2 = their reports' reports. Only read in 'chain' mode; the list is empty
   until configured, and the server refuses to switch INTO chain mode against an
   empty ladder (every manager would silently earn RM 0). */

export function useHrOverrideLevels() {
  return useQuery({
    queryKey: ['hr', 'override-levels'],
    staleTime: 60_000,
    queryFn: () => getJson<{ levels: HrOverrideLevel[] }>('/hr/override-levels').then((r) => r.levels),
  });
}

export function useCreateHrOverrideLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { level: number; rateBps: number; label?: string; active?: boolean }) =>
      sendJson<{ level: HrOverrideLevel }>('/hr/override-levels', 'POST', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

/* `level` is deliberately absent from the patch shape (the server refuses it
   too): renumbering a rung in place silently repoints an existing rate at a
   different set of people. Delete and re-add. */
export function useUpdateHrOverrideLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; rateBps?: number; label?: string; active?: boolean }) =>
      sendJson<{ level: HrOverrideLevel }>(`/hr/override-levels/${id}`, 'PATCH', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

export function useDeleteHrOverrideLevel() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => sendJson<{ ok: true }>(`/hr/override-levels/${id}`, 'DELETE'),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

/* ── pickers ────────────────────────────────────────────────────────────── */

/* Five company-scoped list reads behind one key, cached for five minutes and
   shared by both Setup cards. Needs only scm.hr.read, so every viewer of this
   page can have it — without it a read-only viewer reads raw ids. */
export function useHrPickers() {
  return useQuery({
    queryKey: ['hr', 'pickers'],
    staleTime: 5 * 60_000,
    queryFn: () => getJson<HrPickers>('/hr/pickers'),
  });
}

/* ── the report ─────────────────────────────────────────────────────────── */

/** The commission report for one date range.
 *
 *  The caller passes the APPLIED range (behind the Calculate button), never the
 *  live date-field state: the query key is the gate, and a heavy multi-table
 *  read must not re-run on every keystroke. */
export function useHrCommission(from: string, to: string) {
  return useQuery({
    queryKey: ['hr', 'commission', from, to],
    enabled: Boolean(from) && Boolean(to),
    staleTime: 30_000,
    queryFn: () => {
      const params = new URLSearchParams({ from, to });
      return getJson<HrCommissionReport>(`/hr/commission?${params.toString()}`);
    },
  });
}

/* ── payout periods ─────────────────────────────────────────────────────── */
/* Closing freezes a range's rows so a later rate edit cannot rewrite a payout
   the owner already approved. An open range recomputes live on every load. */

export function useHrPayoutPeriods() {
  return useQuery({
    queryKey: ['hr', 'payout', 'periods'],
    staleTime: 30_000,
    queryFn: () => getJson<{ periods: HrPayoutPeriod[] }>('/hr/payout/periods').then((r) => r.periods),
  });
}

export function useCloseHrPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { from: string; to: string }) =>
      sendJson<{ closed: HrPayoutPeriod }>('/hr/payout/close', 'POST', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}

export function useReopenHrPayout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { from: string; to: string; reason: string }) =>
      sendJson<{ reopened: HrPayoutPeriod }>('/hr/payout/reopen', 'POST', body),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: HR_ROOT }); },
  });
}
