// ============================================================================
// /announcements — office posts every authed Backend user sees as a top-of-app
// banner with a "Got it" acknowledgement. Ported from Hookka
// (src/api/routes/announcements.ts) via the Houzs port; adapted to 2990:
//
//   - Single-tenant (no org_id).
//   - No worker portal — every authed Backend user is "the audience". The ack
//     table keys on staff.id (UUID); resolveWorkerToken / x-worker-token are
//     gone. Banner GET is gated by supabaseAuth (any authed user passes).
//   - Targeting reframed: ALL | ROLES | SHOWROOMS | STAFF | MIXED. Lists hold
//     staff_role enum strings / showrooms.id (uuid) / staff.id (uuid) — 2990
//     has no departments / positions / per-worker dept_codes.
//   - Writes are gated to admin / super_admin / coordinator (matches the SO
//     write rules elsewhere). Reads + the ack POST are open to every authed
//     active staff member — they need to render their own banner.
//   - Auto-translate: ported as-is. translateAnnouncement returns null when
//     ANTHROPIC_API_KEY is unset (already optional in env.ts for scan-so).
//   - Web push: not wired (2990 has no push_subscriptions infrastructure).
//     A TODO marks the call-site so we can fan-out via the same channel as
//     the eventual notifications work.
//   - Attachments: re-uses the existing SO_ITEM_PHOTOS R2 bucket under the
//     announcements/<id>/ prefix; no new bucket needed.
//   - Service-role used for the actual writes (so RLS doesn't bite when the
//     server-side ACL has already passed) — matches the admin.ts pattern.
// ============================================================================

import { Hono } from 'hono';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseAuth } from '../middleware/auth';
import type { Env, Variables } from '../env';
import {
  translateAnnouncement,
  type AnnouncementTranslations,
} from '../lib/translate-announcement';

export const announcements = new Hono<{ Bindings: Env; Variables: Variables }>();

// Every endpoint is authed — the banner has to know who's asking for audience
// filtering, and writes are role-gated below.
announcements.use('*', supabaseAuth);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const WRITE_ROLES = new Set(['admin', 'super_admin', 'coordinator']);

type StaffShape = {
  id: string;
  role: string;
  showroom_id: string | null;
  active: boolean;
};

/** Load the current authed user's staff row (RLS-friendly select). Returns
 *  null for users who have a Supabase session but no matching active staff
 *  row — that's a /no-access situation; the route 401s. */
async function loadStaff(sb: SupabaseClient, userId: string): Promise<StaffShape | null> {
  const { data, error } = await sb
    .from('staff')
    .select('id, role, showroom_id, active')
    .eq('id', userId)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as StaffShape;
  return row.active ? row : null;
}

/** Service-role client for the actual writes (bypasses RLS). The route has
 *  ALREADY gated on role above; using service-role lets the INSERT/UPDATE
 *  succeed without needing to author six more RLS policies for every
 *  "coordinator can update reminded_at" sub-case. */
function serviceClient(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type AnnouncementCategory = 'GENERAL' | 'WARNING' | 'SOP' | 'LEARNING';
type TargetType = 'ALL' | 'ROLES' | 'SHOWROOMS' | 'STAFF' | 'MIXED';

type AnnouncementAttachment = {
  r2Key: string;
  name: string;
  mime: string;
  size?: number;
};

// Raw row shape from the DB. The pg driver (PostgREST → JSON) returns the
// columns as snake_case already, but the Hookka rule still applies: dual-key
// every read so a future Drizzle/raw migration doesn't break consumers.
type AnnouncementRow = {
  id: string;
  title: string;
  body: string | null;
  is_active?: boolean | null;
  isActive?: boolean | null;
  expires_at?: string | null;
  expiresAt?: string | null;
  reminded_at?: string | null;
  remindedAt?: string | null;
  created_by?: string | null;
  createdBy?: string | null;
  created_at?: string | null;
  createdAt?: string | null;
  updated_at?: string | null;
  updatedAt?: string | null;
  translations?: AnnouncementTranslations | string | null;
  attachments?: string | unknown[] | null;
  target_type?: string | null;
  targetType?: string | null;
  target_roles?: string | string[] | null;
  targetRoles?: string | string[] | null;
  target_showroom_ids?: string | string[] | null;
  targetShowroomIds?: string | string[] | null;
  target_staff_ids?: string | string[] | null;
  targetStaffIds?: string | string[] | null;
  category?: string | null;
};

function readCategory(v: unknown): AnnouncementCategory {
  const s = String(v ?? '').trim().toUpperCase();
  if (s === 'WARNING' || s === 'SOP' || s === 'LEARNING') return s;
  return 'GENERAL';
}

function notExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return true;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return true;
  return t > Date.now();
}

function isRemindedSince(remindedAt: string | null, ackedAt: string | null): boolean {
  if (!remindedAt || !ackedAt) return false;
  const r = Date.parse(remindedAt);
  const a = Date.parse(ackedAt);
  if (Number.isNaN(r) || Number.isNaN(a)) return false;
  return r > a;
}

function readTranslations(r: AnnouncementRow): AnnouncementTranslations | null {
  const raw = r.translations ?? null;
  if (raw == null) return null;
  if (typeof raw === 'string') {
    if (!raw.trim()) return null;
    try { return JSON.parse(raw) as AnnouncementTranslations; } catch { return null; }
  }
  return raw;
}

/** Parse a stored JSON array of strings (uuids / role names). Tolerates a JSON
 *  string OR a parsed array (jsonb columns come back parsed via PostgREST).
 *  Drops non-strings and dedupes. */
function readStringArray(v: string | string[] | null | undefined): string[] {
  if (v == null) return [];
  let arr: unknown = v;
  if (typeof v === 'string') {
    if (!v.trim()) return [];
    try { arr = JSON.parse(v); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const x of arr) {
    if (typeof x !== 'string') continue;
    const s = x.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function normalizeAttachments(raw: unknown): AnnouncementAttachment[] {
  let arr: unknown = raw;
  if (typeof arr === 'string') {
    const s = arr.trim();
    if (!s) return [];
    try { arr = JSON.parse(s); } catch { return []; }
  }
  if (!Array.isArray(arr)) return [];
  const out: AnnouncementAttachment[] = [];
  for (const item of arr) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const r2Key = String(o.r2Key ?? o.r2_key ?? '').trim();
    if (!r2Key) continue;
    const att: AnnouncementAttachment = {
      r2Key,
      name: String(o.name ?? '').trim(),
      mime: String(o.mime ?? o.contentType ?? '').trim(),
    };
    const size = Number(o.size);
    if (Number.isFinite(size) && size > 0) att.size = size;
    out.push(att);
  }
  return out;
}

function readTargetType(r: AnnouncementRow): TargetType {
  const t = String(r.targetType ?? r.target_type ?? 'ALL').toUpperCase();
  if (t === 'ROLES' || t === 'SHOWROOMS' || t === 'STAFF' || t === 'MIXED') return t;
  return 'ALL';
}

/** Derive the canonical target_type from which target lists are non-empty.
 *  Empty all → ALL; one bucket → that bucket; multiple → MIXED. */
function deriveTargetType(roles: string[], showroomIds: string[], staffIds: string[]): TargetType {
  const buckets = (roles.length > 0 ? 1 : 0) + (showroomIds.length > 0 ? 1 : 0) + (staffIds.length > 0 ? 1 : 0);
  if (buckets === 0) return 'ALL';
  if (buckets > 1) return 'MIXED';
  if (roles.length > 0) return 'ROLES';
  if (showroomIds.length > 0) return 'SHOWROOMS';
  return 'STAFF';
}

function toPublic(r: AnnouncementRow) {
  return {
    id: r.id,
    title: r.title,
    body: r.body ?? '',
    isActive: (r.isActive ?? r.is_active) === true,
    expiresAt: r.expiresAt ?? r.expires_at ?? null,
    createdAt: r.createdAt ?? r.created_at ?? null,
    createdBy: r.createdBy ?? r.created_by ?? null,
    remindedAt: r.remindedAt ?? r.reminded_at ?? null,
    updatedAt: r.updatedAt ?? r.updated_at ?? null,
    translations: readTranslations(r),
    attachments: normalizeAttachments(r.attachments ?? null),
    targetType: readTargetType(r),
    targetRoles: readStringArray(r.targetRoles ?? r.target_roles ?? null),
    targetShowroomIds: readStringArray(r.targetShowroomIds ?? r.target_showroom_ids ?? null),
    targetStaffIds: readStringArray(r.targetStaffIds ?? r.target_staff_ids ?? null),
    category: readCategory(r.category),
  };
}

function genId(): string {
  return `ann-${crypto.randomUUID().slice(0, 12).replace(/-/g, '')}`;
}

/** True when a staff member with (id, role, showroomId) is in the
 *  announcement's audience. Used by the banner GET so we never surface a
 *  notice the user shouldn't see. */
function staffCanSee(r: AnnouncementRow, staff: StaffShape): boolean {
  const type = readTargetType(r);
  if (type === 'ALL') return true;
  const roles = readStringArray(r.targetRoles ?? r.target_roles ?? null);
  if (roles.includes(staff.role)) return true;
  const showroomIds = readStringArray(r.targetShowroomIds ?? r.target_showroom_ids ?? null);
  if (staff.showroom_id && showroomIds.includes(staff.showroom_id)) return true;
  const staffIds = readStringArray(r.targetStaffIds ?? r.target_staff_ids ?? null);
  if (staffIds.includes(staff.id)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// LIST (admin) — every active + inactive + expired row, newest first.
// Same role gate as the writes: only admin / super_admin / coordinator see the
// office page. Everyone else uses /banner.
// ---------------------------------------------------------------------------
announcements.get('/', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;
  const staff = await loadStaff(sb, userId);
  if (!staff) return c.json({ success: false, error: 'forbidden' }, 403);
  if (!WRITE_ROLES.has(staff.role)) return c.json({ success: false, error: 'forbidden' }, 403);

  const svc = serviceClient(c.env);
  const { data, error } = await svc
    .from('announcements')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) return c.json({ success: false, error: 'load_failed', reason: error.message }, 500);
  return c.json({ success: true, data: (data as AnnouncementRow[] | null ?? []).map(toPublic) });
});

// ---------------------------------------------------------------------------
// BANNER (every authed active staff member) — newest ACTIVE + not-expired +
// audience-matching row + this staff member's acked ids (for the popup gate).
// ---------------------------------------------------------------------------
announcements.get('/banner', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;
  const staff = await loadStaff(sb, userId);
  if (!staff) return c.json({ success: false, error: 'forbidden' }, 403);

  const svc = serviceClient(c.env);
  const { data, error } = await svc
    .from('announcements')
    .select('*')
    .eq('is_active', true)
    .order('created_at', { ascending: false });
  if (error) return c.json({ success: false, error: 'load_failed', reason: error.message }, 500);
  const rows = (data as AnnouncementRow[] | null ?? []).filter(
    (r) => notExpired(r.expiresAt ?? r.expires_at ?? null) && staffCanSee(r, staff),
  );

  // This user's ack rows (id + when they acked). The popup gate re-pops a
  // notice the user has NOT acked, OR has acked but was reminded AFTER that
  // ack.
  const { data: ackRows, error: ackErr } = await svc
    .from('announcement_acks')
    .select('announcement_id, acked_at')
    .eq('staff_id', userId);
  if (ackErr) return c.json({ success: false, error: 'load_failed', reason: ackErr.message }, 500);

  const ackedAtById = new Map<string, string | null>();
  for (const a of (ackRows as Array<{ announcement_id: string; acked_at: string | null }> | null) ?? []) {
    ackedAtById.set(a.announcement_id, a.acked_at);
  }
  const ackedIds: string[] = [];
  for (const r of rows) {
    if (!ackedAtById.has(r.id)) continue;
    if (isRemindedSince(r.remindedAt ?? r.reminded_at ?? null, ackedAtById.get(r.id) ?? null)) continue;
    ackedIds.push(r.id);
  }

  return c.json({ success: true, data: rows.map(toPublic), ackedIds });
});

// ---------------------------------------------------------------------------
// GET /:id/acks — read-receipt for one notice. Splits the active staff roster
// into who has acked it and who hasn't. Office-page only.
// ---------------------------------------------------------------------------
announcements.get('/:id/acks', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;
  const staff = await loadStaff(sb, userId);
  if (!staff || !WRITE_ROLES.has(staff.role)) return c.json({ success: false, error: 'forbidden' }, 403);

  const id = c.req.param('id');
  const svc = serviceClient(c.env);
  const { data: annRow, error: annErr } = await svc
    .from('announcements')
    .select('id')
    .eq('id', id)
    .maybeSingle();
  if (annErr) return c.json({ success: false, error: 'load_failed', reason: annErr.message }, 500);
  if (!annRow) return c.json({ success: false, error: 'not_found' }, 404);

  const { data: roster, error: rosterErr } = await svc
    .from('staff')
    .select('id, staff_code, name')
    .eq('active', true)
    .order('name', { ascending: true });
  if (rosterErr) return c.json({ success: false, error: 'load_failed', reason: rosterErr.message }, 500);

  const { data: ackRows, error: ackErr } = await svc
    .from('announcement_acks')
    .select('staff_id, acked_at')
    .eq('announcement_id', id);
  if (ackErr) return c.json({ success: false, error: 'load_failed', reason: ackErr.message }, 500);

  const ackedAtByStaff = new Map<string, string | null>();
  for (const a of (ackRows as Array<{ staff_id: string; acked_at: string | null }> | null) ?? []) {
    ackedAtByStaff.set(a.staff_id, a.acked_at);
  }

  const acked: Array<{ id: string; name: string; staffCode: string; ackedAt: string | null }> = [];
  const pending: Array<{ id: string; name: string; staffCode: string }> = [];
  for (const u of (roster as Array<{ id: string; staff_code: string; name: string }> | null) ?? []) {
    if (ackedAtByStaff.has(u.id)) {
      acked.push({ id: u.id, name: u.name, staffCode: u.staff_code, ackedAt: ackedAtByStaff.get(u.id) ?? null });
    } else {
      pending.push({ id: u.id, name: u.name, staffCode: u.staff_code });
    }
  }
  acked.sort((x, y) => {
    const tx = x.ackedAt ? Date.parse(x.ackedAt) : 0;
    const ty = y.ackedAt ? Date.parse(y.ackedAt) : 0;
    return (Number.isNaN(ty) ? 0 : ty) - (Number.isNaN(tx) ? 0 : tx);
  });

  return c.json({
    success: true,
    data: { total: (roster ?? []).length, ackedCount: acked.length, acked, pending },
  });
});

// ---------------------------------------------------------------------------
// POST / — create.
// ---------------------------------------------------------------------------
announcements.post('/', async (c) => {
  const sb = c.get('supabase');
  const user = c.get('user');
  const staff = await loadStaff(sb, user.id);
  if (!staff || !WRITE_ROLES.has(staff.role)) return c.json({ success: false, error: 'forbidden' }, 403);

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ success: false, error: 'invalid_json' }, 400); }

  const title = String(body.title ?? '').trim();
  const text = String(body.body ?? '').trim();
  if (!title) return c.json({ success: false, error: 'title_required' }, 400);
  if (title.length > 200) return c.json({ success: false, error: 'title_too_long', max: 200 }, 400);

  let expiresAt: string | null = null;
  if (body.expiresAt != null && String(body.expiresAt).trim() !== '') {
    const t = Date.parse(String(body.expiresAt));
    if (Number.isNaN(t)) return c.json({ success: false, error: 'invalid_expiry' }, 400);
    expiresAt = new Date(t).toISOString();
  }

  const attachments = normalizeAttachments(body.attachments);
  const reqRoles = readStringArray(body.targetRoles as string | string[] | null | undefined);
  const reqShowroomIds = readStringArray(body.targetShowroomIds as string | string[] | null | undefined);
  const reqStaffIds = readStringArray(body.targetStaffIds as string | string[] | null | undefined);
  const targetType = deriveTargetType(reqRoles, reqShowroomIds, reqStaffIds);
  const category = readCategory(body.category);

  const id = genId();
  const nowIso = new Date().toISOString();
  // Best-effort translate. Missing key → null → FE falls back to original text.
  const translations = await translateAnnouncement({ title, body: text, apiKey: c.env.ANTHROPIC_API_KEY });

  const svc = serviceClient(c.env);
  const insertRow: Record<string, unknown> = {
    id,
    title,
    body: text,
    is_active: true,
    expires_at: expiresAt,
    created_by: user.id,
    created_at: nowIso,
    translations: translations ?? null,
    attachments: attachments.length ? attachments : null,
    target_type: targetType,
    target_roles: reqRoles.length ? reqRoles : null,
    target_showroom_ids: reqShowroomIds.length ? reqShowroomIds : null,
    target_staff_ids: reqStaffIds.length ? reqStaffIds : null,
    category,
  };
  const { error: insErr } = await svc.from('announcements').insert(insertRow);
  if (insErr) return c.json({ success: false, error: 'insert_failed', reason: insErr.message }, 500);

  const { data: stored, error: selErr } = await svc.from('announcements').select('*').eq('id', id).maybeSingle();
  if (selErr || !stored) return c.json({ success: false, error: 'select_failed', reason: selErr?.message ?? 'missing' }, 500);

  // TODO: web push fan-out — 2990 has no push_subscriptions table or sendPush
  // helper yet. When notifications land, mirror the Hookka call here
  // (filter by audience and tag = `ann-${id}`).

  return c.json({ success: true, data: toPublic(stored as AnnouncementRow) }, 201);
});

// ---------------------------------------------------------------------------
// PATCH /:id — edit fields, toggle isActive, retarget, re-translate.
// ---------------------------------------------------------------------------
announcements.patch('/:id', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;
  const staff = await loadStaff(sb, userId);
  if (!staff || !WRITE_ROLES.has(staff.role)) return c.json({ success: false, error: 'forbidden' }, 403);

  const id = c.req.param('id');
  const svc = serviceClient(c.env);
  const { data: existing, error: selErr } = await svc.from('announcements').select('*').eq('id', id).maybeSingle();
  if (selErr) return c.json({ success: false, error: 'load_failed', reason: selErr.message }, 500);
  if (!existing) return c.json({ success: false, error: 'not_found' }, 404);
  const ex = existing as AnnouncementRow;

  let body: Record<string, unknown>;
  try { body = (await c.req.json()) as Record<string, unknown>; }
  catch { return c.json({ success: false, error: 'invalid_json' }, 400); }

  const updates: Record<string, unknown> = {};
  let textChanged = false;
  let nextTitle = ex.title;
  let nextText = ex.body ?? '';

  if ('isActive' in body) updates.is_active = body.isActive === true;
  if (typeof body.title === 'string') {
    const title = body.title.trim();
    if (!title) return c.json({ success: false, error: 'title_required' }, 400);
    if (title.length > 200) return c.json({ success: false, error: 'title_too_long', max: 200 }, 400);
    updates.title = title;
    nextTitle = title;
    textChanged = true;
  }
  if (typeof body.body === 'string') {
    const text = body.body.trim();
    updates.body = text;
    nextText = text;
    textChanged = true;
  }
  if ('attachments' in body) {
    const next = normalizeAttachments(body.attachments);
    updates.attachments = next.length ? next : null;
  }
  // Retarget when ANY targeting list is present. We rewrite all four columns
  // together so target_type stays in sync; missing buckets fall back to the
  // existing row's value so a "roles-only" edit doesn't wipe a showroom list.
  if ('targetRoles' in body || 'targetShowroomIds' in body || 'targetStaffIds' in body) {
    const nextRoles = 'targetRoles' in body
      ? readStringArray(body.targetRoles as string | string[] | null | undefined)
      : readStringArray(ex.targetRoles ?? ex.target_roles ?? null);
    const nextShowrooms = 'targetShowroomIds' in body
      ? readStringArray(body.targetShowroomIds as string | string[] | null | undefined)
      : readStringArray(ex.targetShowroomIds ?? ex.target_showroom_ids ?? null);
    const nextStaff = 'targetStaffIds' in body
      ? readStringArray(body.targetStaffIds as string | string[] | null | undefined)
      : readStringArray(ex.targetStaffIds ?? ex.target_staff_ids ?? null);
    updates.target_type = deriveTargetType(nextRoles, nextShowrooms, nextStaff);
    updates.target_roles = nextRoles.length ? nextRoles : null;
    updates.target_showroom_ids = nextShowrooms.length ? nextShowrooms : null;
    updates.target_staff_ids = nextStaff.length ? nextStaff : null;
  }
  if ('category' in body) updates.category = readCategory(body.category);
  if ('expiresAt' in body) {
    const raw = body.expiresAt;
    if (raw == null || String(raw).trim() === '') {
      updates.expires_at = null;
    } else {
      const t = Date.parse(String(raw));
      if (Number.isNaN(t)) return c.json({ success: false, error: 'invalid_expiry' }, 400);
      updates.expires_at = new Date(t).toISOString();
    }
  }

  if (Object.keys(updates).length === 0) {
    return c.json({ success: true, data: toPublic(ex) });
  }
  if (textChanged) {
    const retranslated = await translateAnnouncement({
      title: nextTitle, body: nextText, apiKey: c.env.ANTHROPIC_API_KEY,
    });
    updates.translations = retranslated ?? null;
  }
  updates.updated_at = new Date().toISOString();

  const { error: updErr } = await svc.from('announcements').update(updates).eq('id', id);
  if (updErr) return c.json({ success: false, error: 'update_failed', reason: updErr.message }, 500);

  const { data: row } = await svc.from('announcements').select('*').eq('id', id).maybeSingle();
  return c.json({ success: true, data: row ? toPublic(row as AnnouncementRow) : null });
});

// ---------------------------------------------------------------------------
// POST /:id/remind — re-pop the banner for un-acked staff.
// scope=unacked (default): leaves acked rows intact; stamps reminded_at.
// scope=all: wipes acks so the WHOLE roster re-pops from 0-of-N.
// ---------------------------------------------------------------------------
announcements.post('/:id/remind', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;
  const staff = await loadStaff(sb, userId);
  if (!staff || !WRITE_ROLES.has(staff.role)) return c.json({ success: false, error: 'forbidden' }, 403);

  const id = c.req.param('id');
  const svc = serviceClient(c.env);
  const { data: ann, error: annErr } = await svc.from('announcements').select('id').eq('id', id).maybeSingle();
  if (annErr) return c.json({ success: false, error: 'load_failed', reason: annErr.message }, 500);
  if (!ann) return c.json({ success: false, error: 'not_found' }, 404);

  let scope: 'all' | 'unacked' = 'unacked';
  try {
    const body = (await c.req.json().catch(() => null)) as { scope?: unknown } | null;
    if (body && body.scope === 'all') scope = 'all';
  } catch { /* default */ }

  const { data: roster, error: rosterErr } = await svc
    .from('staff').select('id').eq('active', true);
  if (rosterErr) return c.json({ success: false, error: 'load_failed', reason: rosterErr.message }, 500);
  const rosterIds = (roster as Array<{ id: string }> | null ?? []).map((s) => s.id);

  const { data: ackRows, error: ackErr } = await svc
    .from('announcement_acks').select('staff_id').eq('announcement_id', id);
  if (ackErr) return c.json({ success: false, error: 'load_failed', reason: ackErr.message }, 500);
  const ackedSet = new Set((ackRows as Array<{ staff_id: string }> | null ?? []).map((a) => a.staff_id));
  const unackedCount = rosterIds.filter((sid) => !ackedSet.has(sid)).length;

  if (scope === 'all') {
    const { error: delErr } = await svc.from('announcement_acks').delete().eq('announcement_id', id);
    if (delErr) return c.json({ success: false, error: 'delete_failed', reason: delErr.message }, 500);
  }
  const { error: updErr } = await svc
    .from('announcements').update({ reminded_at: new Date().toISOString() }).eq('id', id);
  if (updErr) return c.json({ success: false, error: 'update_failed', reason: updErr.message }, 500);

  const pendingCount = scope === 'all' ? rosterIds.length : unackedCount;
  return c.json({ success: true, pendingCount, scope });
});

// ---------------------------------------------------------------------------
// DELETE /:id — hard delete + cascade-clean ack rows (the FK does the cascade,
// but we run an explicit DELETE first so a misconfigured cascade doesn't
// strand orphan ack rows).
// ---------------------------------------------------------------------------
announcements.delete('/:id', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;
  const staff = await loadStaff(sb, userId);
  if (!staff || !WRITE_ROLES.has(staff.role)) return c.json({ success: false, error: 'forbidden' }, 403);

  const id = c.req.param('id');
  const svc = serviceClient(c.env);
  await svc.from('announcement_acks').delete().eq('announcement_id', id);
  const { error: delErr } = await svc.from('announcements').delete().eq('id', id);
  if (delErr) return c.json({ success: false, error: 'delete_failed', reason: delErr.message }, 500);
  return c.json({ success: true });
});

// ---------------------------------------------------------------------------
// POST /:id/ack — record THIS staff member's ack of one active notice.
// Idempotent (ON CONFLICT DO NOTHING via upsert). Available to every authed
// active staff member — no role gate.
// ---------------------------------------------------------------------------
announcements.post('/:id/ack', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;
  const staff = await loadStaff(sb, userId);
  if (!staff) return c.json({ success: false, error: 'forbidden' }, 403);

  const id = c.req.param('id');
  const svc = serviceClient(c.env);
  const { data: row, error: selErr } = await svc.from('announcements').select('*').eq('id', id).maybeSingle();
  if (selErr) return c.json({ success: false, error: 'load_failed', reason: selErr.message }, 500);
  if (!row) return c.json({ success: true, acked: false });
  const r = row as AnnouncementRow;
  if ((r.isActive ?? r.is_active) !== true) return c.json({ success: true, acked: false });
  if (!notExpired(r.expiresAt ?? r.expires_at ?? null)) return c.json({ success: true, acked: false });

  // Upsert handles the idempotency contract (a flaky double-tap is a no-op).
  const { error: upsErr } = await svc
    .from('announcement_acks')
    .upsert(
      { announcement_id: id, staff_id: userId, acked_at: new Date().toISOString() },
      { onConflict: 'announcement_id,staff_id', ignoreDuplicates: true },
    );
  if (upsErr) return c.json({ success: false, error: 'ack_failed', reason: upsErr.message }, 500);

  return c.json({ success: true, acked: true });
});

// ---------------------------------------------------------------------------
// PUT /:id/attachments/upload?ext=... — two-step upload. Returns { r2Key,
// mime, size }. The FE merges this manifest entry into the create/patch body
// (matches the Houzs port's contract).
//
// Re-uses the existing SO_ITEM_PHOTOS R2 bucket under the announcements/<id>/
// prefix; no new bucket needed.
// ---------------------------------------------------------------------------
const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  heic: 'image/heic', heif: 'image/heif', gif: 'image/gif',
  pdf: 'application/pdf',
  mp4: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm', m4v: 'video/x-m4v',
};
const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

announcements.put('/:id/attachments/upload', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;
  const staff = await loadStaff(sb, userId);
  if (!staff || !WRITE_ROLES.has(staff.role)) return c.json({ success: false, error: 'forbidden' }, 403);
  if (!c.env.SO_ITEM_PHOTOS) return c.json({ success: false, error: 'r2_not_configured' }, 500);

  const id = c.req.param('id'); // 'compose' before save; real id on edit
  const ext = (c.req.query('ext') ?? 'jpg').toLowerCase();
  const mime = MIME_BY_EXT[ext];
  if (!mime) return c.json({ success: false, error: 'unsupported_type', got: ext }, 400);

  const body = await c.req.arrayBuffer();
  if (body.byteLength > MAX_ATTACHMENT_BYTES) {
    return c.json({ success: false, error: 'file_too_large', maxBytes: MAX_ATTACHMENT_BYTES, got: body.byteLength }, 400);
  }
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '_') || 'compose';
  const key = `announcements/${safeId}/${Date.now()}-${crypto.randomUUID().slice(0, 8)}.${ext}`;
  try {
    await c.env.SO_ITEM_PHOTOS.put(key, body, {
      httpMetadata: { contentType: mime },
      customMetadata: { announcementId: safeId, uploadedBy: userId },
    });
  } catch (e) {
    return c.json({ success: false, error: 'r2_put_failed', reason: e instanceof Error ? e.message : String(e) }, 500);
  }
  return c.json({ success: true, r2Key: key, mime, size: body.byteLength });
});

// ---------------------------------------------------------------------------
// GET /:id/attachments/:key{.+} — stream the attachment. Every authed staff
// member can read (they need it to render their banner attachments). The key
// includes slashes, so the {.+} matcher is required; the prefix guard stops
// the route being used to enumerate other buckets' keys.
// ---------------------------------------------------------------------------
announcements.get('/:id/attachments/:key{.+}', async (c) => {
  const sb = c.get('supabase');
  const userId = c.get('user').id;
  const staff = await loadStaff(sb, userId);
  if (!staff) return c.json({ success: false, error: 'forbidden' }, 403);
  if (!c.env.SO_ITEM_PHOTOS) return c.json({ success: false, error: 'r2_not_configured' }, 500);

  const key = c.req.param('key');
  if (!key.startsWith('announcements/')) return c.json({ success: false, error: 'forbidden_key' }, 403);
  const obj = await c.env.SO_ITEM_PHOTOS.get(key);
  if (!obj) return c.json({ success: false, error: 'not_found' }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set('Cache-Control', 'private, max-age=300');
  return new Response(obj.body, { headers });
});
