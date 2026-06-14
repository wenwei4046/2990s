import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';

// ── types mirrored from the /hr API ────────────────────────────────────────
export interface HrConfig {
  baseBps: number;
  personalKpiThresholdCenti: number;
  personalKpiBonusBps: number;
  showroomKpiThresholdCenti: number;
  showroomKpiBonusBps: number;
  overrideBaseBps: number;
  overrideKpiBonusBps: number;
  updatedAt?: string;
}
export interface HrProfile {
  id: string;
  staffId: string;
  staffName: string;
  staffCode: string;
  tier: 'sales' | 'manager';
  showroomId: string;
  active: boolean;
}
export interface HrItemKpi {
  id: string;
  flagType: 'product' | 'fabric' | 'special';
  ref: string;
  label: string;
  bonusCenti: number;
  active: boolean;
}
export interface HrPickerRef { ref: string; label: string }
export interface HrPickers {
  staff: Array<{ id: string; name: string; staffCode: string; role: string }>;
  showrooms: Array<{ id: string; name: string }>;
  products: HrPickerRef[];
  fabrics: HrPickerRef[];
  specials: HrPickerRef[];
}
export interface HrKpiDetail { label: string; qty: number; bonusCenti: number; lineCenti: number }
export interface HrCommissionRow {
  staffId: string;
  staffName: string;
  tier: 'sales' | 'manager';
  personalGoodsCenti: number;
  personalRateBps: number;
  personalCommissionCenti: number;
  overrideRateBps: number;
  overrideCommissionCenti: number;
  itemKpiCenti: number;
  totalCenti: number;
  kpiDetail: HrKpiDetail[];
}
export interface HrCommissionShowroom {
  showroomId: string;
  showroomName: string;
  showroomGoodsCenti: number;
  showroomKpiHit: boolean;
  rows: HrCommissionRow[];
}
export interface HrCommissionResponse {
  from: string;
  to: string;
  config: HrConfig;
  showrooms: HrCommissionShowroom[];
}

// ── commission ─────────────────────────────────────────────────────────────
export const useHrCommission = (from: string, to: string, enabled: boolean) =>
  useQuery({
    queryKey: ['hr', 'commission', from, to],
    queryFn: () => authedFetch<HrCommissionResponse>(`/hr/commission?from=${from}&to=${to}`),
    enabled,
  });

// ── config ─────────────────────────────────────────────────────────────────
export const useHrConfig = () =>
  useQuery({ queryKey: ['hr', 'config'], queryFn: () => authedFetch<{ config: HrConfig }>('/hr/config') });

export const useUpdateHrConfig = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<HrConfig>) =>
      authedFetch<{ config: HrConfig }>('/hr/config', { method: 'PATCH', body: JSON.stringify(patch) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'config'] });
      qc.invalidateQueries({ queryKey: ['hr', 'commission'] });
    },
  });
};

// ── profiles ───────────────────────────────────────────────────────────────
export const useHrProfiles = () =>
  useQuery({ queryKey: ['hr', 'profiles'], queryFn: () => authedFetch<{ profiles: HrProfile[] }>('/hr/profiles') });

export const useCreateHrProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { staffId: string; tier: string; showroomId: string }) =>
      authedFetch('/hr/profiles', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'profiles'] });
      qc.invalidateQueries({ queryKey: ['hr', 'commission'] });
    },
  });
};

export const useUpdateHrProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; tier?: string; showroomId?: string; active?: boolean }) =>
      authedFetch(`/hr/profiles/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'profiles'] });
      qc.invalidateQueries({ queryKey: ['hr', 'commission'] });
    },
  });
};

export const useDeleteHrProfile = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/hr/profiles/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'profiles'] });
      qc.invalidateQueries({ queryKey: ['hr', 'commission'] });
    },
  });
};

// ── item KPIs ──────────────────────────────────────────────────────────────
export const useHrItemKpi = () =>
  useQuery({ queryKey: ['hr', 'item-kpi'], queryFn: () => authedFetch<{ items: HrItemKpi[] }>('/hr/item-kpi') });

export const useCreateHrItemKpi = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { flagType: string; ref: string; label: string; bonusCenti: number }) =>
      authedFetch('/hr/item-kpi', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'item-kpi'] });
      qc.invalidateQueries({ queryKey: ['hr', 'commission'] });
    },
  });
};

export const useUpdateHrItemKpi = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string; label?: string; bonusCenti?: number; active?: boolean }) =>
      authedFetch(`/hr/item-kpi/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'item-kpi'] });
      qc.invalidateQueries({ queryKey: ['hr', 'commission'] });
    },
  });
};

export const useDeleteHrItemKpi = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => authedFetch(`/hr/item-kpi/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hr', 'item-kpi'] });
      qc.invalidateQueries({ queryKey: ['hr', 'commission'] });
    },
  });
};

// ── pickers ────────────────────────────────────────────────────────────────
export const useHrPickers = () =>
  useQuery({ queryKey: ['hr', 'pickers'], queryFn: () => authedFetch<HrPickers>('/hr/pickers') });
