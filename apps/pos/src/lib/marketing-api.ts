// ----------------------------------------------------------------------------
// The Marketing section's data, read and written against 2990's own API
// (apps/api/src/routes/marketing.ts, tables in migrations 0217 + 0218) —
// including the showroom list itself, which the section keeps (owner
// 2026-10-09: a record, not Houzs's venue master).
//
// ── WHY A BARE fetch AND NOT authedFetch ────────────────────────────────────
// Same wall commission-api.ts documents: `authedFetch` resolves to the HOUZS
// base and stamps `X-Company-Id`, which is not on 2990's CORS allowHeaders —
// the preflight fails and the browser reports a generic "Failed to fetch". So:
// bare fetch at VITE_API_URL, bearer only. The bearer is the caller's HOUZS
// session; 2990's route checks it with Houzs /auth/me (lib/houzs-identity.ts).
// ----------------------------------------------------------------------------

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { bearerToken } from './apiClient';
import type {
  ComboRow, DisplayItem, DisplayType, LaunchRequest, RequestAction, RequestStatus, RequestType,
} from '../components/marketing/marketing-model';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await bearerToken();
  if (!token) throw new Error('not_authenticated');
  const res = await fetch(`${API_URL}/marketing${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      authorization: `Bearer ${token}`,
      ...(typeof init?.body === 'string' ? { 'content-type': 'application/json' } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    let reason = text;
    try {
      const j = JSON.parse(text) as { reason?: string; error?: string };
      reason = j.reason ?? j.error ?? text;
    } catch { /* not JSON */ }
    throw new Error(reason || `${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

/* ── wire shapes ──────────────────────────────────────────────────────────── */

/** A showroom on the Marketing list. `area` is free text ('Petaling Jaya,
 *  Selangor'), printed under the name; '' when not given. */
export interface ShowroomOption { id: string; name: string; area: string }

interface WireDisplay {
  id: string; venueId: string; type: string; modelId: string | null; name: string; code: string;
  photoUrl: string | null; isNew: boolean; fabric: string; colour: string; leg: string; seat: string;
  modules: string[]; size: string; height: string; divan: string; gap: string; qty: number;
}

interface WireRequest {
  id: string; type: string; status: string; supplierCode: string; model: string; fabric: string;
  colour: string; leg: string; seat: string; size: string; height: string; divan: string; gap: string;
  modules: string[]; rows: Array<{ modules: string[]; price: number | null }>; venueId: string;
  action: string; replaceId: string | null; by: string; byRole: string; createdAt: string;
}

export interface FloorplanMeta { venueId: string; updatedAt: string; fileName: string }

export interface MarketingState {
  /** Sorted by name, as the rail and the request form list them. */
  showrooms: ShowroomOption[];
  displays: DisplayItem[];
  requests: LaunchRequest[];
  floorplans: FloorplanMeta[];
}

const toDisplay = (w: WireDisplay): DisplayItem => ({
  id: w.id, venueId: w.venueId, type: w.type as DisplayType, modelId: w.modelId, name: w.name, code: w.code,
  photoUrl: w.photoUrl, isNew: w.isNew, fabric: w.fabric, colour: w.colour, leg: w.leg, seat: w.seat,
  modules: w.modules ?? [], size: w.size, height: w.height, divan: w.divan, gap: w.gap, qty: w.qty || 1,
});

const toRequest = (w: WireRequest): LaunchRequest => ({
  id: w.id, type: w.type as RequestType, status: w.status as RequestStatus, supplierCode: w.supplierCode,
  model: w.model, fabric: w.fabric, colour: w.colour, leg: w.leg, seat: w.seat, size: w.size, height: w.height,
  divan: w.divan, gap: w.gap, modules: w.modules ?? [],
  rows: (w.rows ?? []).map((r) => ({ modules: r.modules ?? [], price: r.price == null ? '' : String(r.price) })),
  showroomId: w.venueId, action: w.action as RequestAction, replaceId: w.replaceId, by: w.by, byRole: w.byRole,
  created: w.createdAt,
});

/** The typed price as the wire wants it: a number, or null while blank. */
const priceOut = (r: ComboRow): number | null => {
  const t = r.price.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

const requestBody = (d: LaunchRequest, status: RequestStatus) => ({
  type: d.type, status, supplierCode: d.supplierCode, model: d.model, fabric: d.fabric, colour: d.colour,
  leg: d.leg, seat: d.seat, size: d.size, height: d.height, divan: d.divan, gap: d.gap, modules: d.modules,
  rows: d.rows.map((r) => ({ modules: r.modules, price: priceOut(r) })),
  venueId: d.showroomId, action: d.action, replaceId: d.action === 'replace' ? d.replaceId : null,
});

/* ── hooks ────────────────────────────────────────────────────────────────── */

const KEY = ['marketing', 'state'] as const;

export function useMarketingState(enabled = true) {
  return useQuery<MarketingState>({
    queryKey: KEY,
    enabled,
    staleTime: 15_000,
    // No realtime anywhere in this app (CLAUDE.md); Management and Marketing
    // see each other's edits on the next poll.
    refetchInterval: 30_000,
    queryFn: async () => {
      const body = await call<{
        showrooms: ShowroomOption[]; displays: WireDisplay[]; requests: WireRequest[]; floorplans: FloorplanMeta[];
      }>('/state');
      return {
        showrooms: (body.showrooms ?? [])
          .map((x) => ({ id: String(x.id), name: String(x.name ?? ''), area: String(x.area ?? '') }))
          .sort((a, b) => a.name.localeCompare(b.name)),
        displays: (body.displays ?? []).map(toDisplay),
        requests: (body.requests ?? []).map(toRequest),
        floorplans: body.floorplans ?? [],
      };
    },
  });
}

/** One showroom's floor plan image, as a data: URL. Only fetched when the
 *  showroom has one (per /state). */
export function useFloorplan(venueId: string | null, version: string | null) {
  return useQuery<string | null>({
    queryKey: ['marketing', 'floorplan', venueId, version],
    enabled: !!venueId && !!version,
    staleTime: Infinity,
    queryFn: async () => {
      const body = await call<{ floorplan: { dataUrl: string } }>(`/floorplans/${encodeURIComponent(venueId!)}`);
      return body.floorplan?.dataUrl ?? null;
    },
  });
}

function useInvalidate() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['marketing'] });
}

/** Add a showroom (no `id`) or rename one. Resolves to the saved row. */
export function useSaveShowroom() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: ({ id, name, area }: { id?: string; name: string; area: string }) =>
      (id
        ? call<{ showroom: ShowroomOption }>(`/showrooms/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ name, area }) })
        : call<{ showroom: ShowroomOption }>('/showrooms', { method: 'POST', body: JSON.stringify({ name, area }) })
      ).then((r) => r.showroom),
    onSuccess: done,
  });
}

/** Take a showroom off the list. The server refuses while it still has a
 *  piece on display or an open launch request. */
export function useRemoveShowroom() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => call<{ ok: true }>(`/showrooms/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: done,
  });
}

export interface NewDisplay {
  venueId: string; type: DisplayType; modelId: string | null; name: string; code: string; photoUrl: string | null;
  fabric?: string; colour?: string; leg?: string; seat?: string; modules?: string[];
  size?: string; height?: string; divan?: string; gap?: string; qty?: number;
}

export function useAddDisplay() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (d: NewDisplay) => call<{ display: WireDisplay }>('/displays', { method: 'POST', body: JSON.stringify(d) })
      .then((r) => toDisplay(r.display)),
    onSuccess: done,
  });
}

export function useRemoveDisplay() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => call<{ ok: true }>(`/displays/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: done,
  });
}

export function usePutFloorplan() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (p: { venueId: string; contentType: string; dataB64: string; fileName: string }) =>
      call<{ floorplan: FloorplanMeta }>(`/floorplans/${encodeURIComponent(p.venueId)}`, {
        method: 'PUT',
        body: JSON.stringify({ contentType: p.contentType, dataB64: p.dataB64, fileName: p.fileName }),
      }),
    onSuccess: done,
  });
}

export function useDeleteFloorplan() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (venueId: string) => call<{ ok: true }>(`/floorplans/${encodeURIComponent(venueId)}`, { method: 'DELETE' }),
    onSuccess: done,
  });
}

export function useSaveRequest() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: ({ draft, status }: { draft: LaunchRequest; status: RequestStatus }) =>
      (draft.id
        ? call<{ request: WireRequest }>(`/requests/${encodeURIComponent(draft.id)}`, { method: 'PUT', body: JSON.stringify(requestBody(draft, status)) })
        : call<{ request: WireRequest }>('/requests', { method: 'POST', body: JSON.stringify(requestBody(draft, status)) })
      ).then((r) => toRequest(r.request)),
    onSuccess: done,
  });
}

export function useDeleteRequest() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (id: string) => call<{ ok: true }>(`/requests/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    onSuccess: done,
  });
}

export function useArriveRequest() {
  const done = useInvalidate();
  return useMutation({
    mutationFn: (id: string) =>
      call<{ displayId: string | null; removedName: string | null }>(`/requests/${encodeURIComponent(id)}/arrive`, { method: 'POST' }),
    onSuccess: done,
  });
}

/* ── floor plan upload prep ───────────────────────────────────────────────── */

/** Longest edge of a stored floor plan. A design-team layout is read on a
 *  tablet in a 360px-high frame; 2000px keeps room labels legible zoomed in
 *  while keeping the stored image well under the 3 MB server cap. */
const PLAN_MAX_EDGE = 2000;

/** Downscale (never upscale) an image file and encode it for upload. PNG stays
 *  PNG (line drawings compress badly as JPEG); anything else becomes JPEG. */
export async function prepareFloorplan(file: File): Promise<{ contentType: string; dataB64: string; fileName: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('This file is not an image the browser can open.'));
      i.src = url;
    });
    const scale = Math.min(1, PLAN_MAX_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not prepare the image.');
    const contentType = file.type === 'image/png' ? 'image/png' : 'image/jpeg';
    if (contentType === 'image/jpeg') {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL(contentType, 0.86);
    return { contentType, dataB64: dataUrl.slice(dataUrl.indexOf(',') + 1), fileName: file.name };
  } finally {
    URL.revokeObjectURL(url);
  }
}
