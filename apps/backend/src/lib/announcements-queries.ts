// ---------------------------------------------------------------------------
// Announcements — TanStack query hooks for the office page + the banner.
// Backed by /announcements in the API Worker (apps/api/src/routes/announcements.ts).
//
// Targeting model (2990 flavor): ALL | ROLES | SHOWROOMS | STAFF | MIXED.
// Lists hold staff_role enum strings / showrooms.id (uuid) / staff.id (uuid).
// ---------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { authedFetch } from './authed-fetch';
import type { StaffRole } from './auth';

export type AnnouncementCategory = 'GENERAL' | 'WARNING' | 'SOP' | 'LEARNING';
export type TargetType = 'ALL' | 'ROLES' | 'SHOWROOMS' | 'STAFF' | 'MIXED';

export type AnnouncementAttachment = {
  r2Key: string;
  name: string;
  mime: string;
  size?: number;
};

export type TranslationPair = { title: string; body: string };
export type AnnouncementTranslations = Record<'en' | 'ms' | 'zh' | 'my', TranslationPair>;

export type Announcement = {
  id: string;
  title: string;
  body: string;
  isActive: boolean;
  expiresAt: string | null;
  createdAt: string | null;
  createdBy: string | null;
  remindedAt: string | null;
  updatedAt: string | null;
  translations: AnnouncementTranslations | null;
  attachments: AnnouncementAttachment[];
  targetType: TargetType;
  targetRoles: string[];
  targetShowroomIds: string[];
  targetStaffIds: string[];
  category: AnnouncementCategory;
};

export type AnnouncementAckPanel = {
  total: number;
  ackedCount: number;
  acked: Array<{ id: string; name: string; staffCode: string; ackedAt: string | null }>;
  pending: Array<{ id: string; name: string; staffCode: string }>;
};

// ── List / Create / Patch / Delete ─────────────────────────────────────────

export const useAnnouncements = () =>
  useQuery({
    queryKey: ['announcements'],
    queryFn: () =>
      authedFetch<{ success: boolean; data: Announcement[] }>('/announcements')
        .then((r) => r.data ?? []),
    staleTime: 30_000,
  });

export type NewAnnouncementBody = {
  title: string;
  body?: string;
  expiresAt?: string | null;
  attachments?: AnnouncementAttachment[];
  targetRoles?: StaffRole[];
  targetShowroomIds?: string[];
  targetStaffIds?: string[];
  category?: AnnouncementCategory;
};

export const useCreateAnnouncement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: NewAnnouncementBody) =>
      authedFetch<{ success: boolean; data: Announcement }>('/announcements', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  });
};

export type PatchAnnouncementBody = Partial<NewAnnouncementBody> & {
  isActive?: boolean;
};

export const usePatchAnnouncement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: { id: string } & PatchAnnouncementBody) =>
      authedFetch<{ success: boolean; data: Announcement }>(`/announcements/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  });
};

export const useDeleteAnnouncement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      authedFetch<{ success: boolean }>(`/announcements/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  });
};

// ── Read-receipts + Remind ─────────────────────────────────────────────────

export const useAnnouncementAcks = (id: string | null) =>
  useQuery({
    queryKey: ['announcement-acks', id],
    enabled: !!id,
    queryFn: () =>
      authedFetch<{ success: boolean; data: AnnouncementAckPanel }>(
        `/announcements/${id}/acks`,
      ).then((r) => r.data),
    staleTime: 0,
  });

export type RemindResponse = { success: boolean; pendingCount: number; scope: 'unacked' | 'all' };

export const useRemindAnnouncement = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, scope }: { id: string; scope: 'unacked' | 'all' }) =>
      authedFetch<RemindResponse>(`/announcements/${id}/remind`, {
        method: 'POST',
        body: JSON.stringify({ scope }),
      }),
    onSuccess: (_data, vars) => {
      void qc.invalidateQueries({ queryKey: ['announcement-acks', vars.id] });
      void qc.invalidateQueries({ queryKey: ['announcements'] });
    },
  });
};

// ── Attachment upload (compose-time) ───────────────────────────────────────
// Bytes go straight to /announcements/compose/attachments/upload?ext=... ; the
// returned manifest entry is merged into the create body. The 'compose' id
// path is intentional — we don't have an announcement id yet at compose time.

export async function uploadAnnouncementAttachment(
  file: File,
): Promise<AnnouncementAttachment> {
  const dot = file.name.lastIndexOf('.');
  const ext = (dot > -1 ? file.name.slice(dot + 1) : '').toLowerCase() || 'jpg';
  const r = await authedFetch<{
    success: boolean;
    r2Key: string;
    mime: string;
    size: number;
  }>(`/announcements/compose/attachments/upload?ext=${encodeURIComponent(ext)}`, {
    method: 'PUT',
    body: file,
    headers: { 'content-type': file.type || 'application/octet-stream' },
  });
  return { r2Key: r.r2Key, name: file.name, mime: r.mime, size: r.size };
}

// ── Banner (the polled feed) ───────────────────────────────────────────────

export type BannerResponse = {
  success: boolean;
  data: Announcement[];
  ackedIds: string[];
};

export const useAnnouncementBanner = (pollMs = 60_000) =>
  useQuery({
    queryKey: ['announcement-banner'],
    queryFn: () => authedFetch<BannerResponse>('/announcements/banner'),
    staleTime: pollMs,
    refetchInterval: pollMs,
    refetchOnWindowFocus: true,
  });

export async function ackAnnouncement(id: string): Promise<void> {
  await authedFetch<{ success: boolean; acked: boolean }>(`/announcements/${id}/ack`, {
    method: 'POST',
  });
}
