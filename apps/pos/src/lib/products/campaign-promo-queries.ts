// ----------------------------------------------------------------------------
// Campaign Promos — fixed-value vouchers (migration 0212).
//
// ⚠️ THIS IS THE ONE PLACE IN THE POS THAT TALKS TO 2990's API, NOT HOUZS.
// It deliberately does NOT use `authedFetch` from ../apiClient. Two reasons:
//
//   1. `authedFetch` resolves to VITE_HOUZS_API_URL under the houzs build, so
//      it would send these to the wrong backend entirely.
//   2. It stamps `X-Company-Id` on every request, and 2990's CORS allowHeaders
//      is ['authorization','content-type','x-client-info'] (apps/api/src/index.ts).
//      An extra header fails the PREFLIGHT — the request never even runs, and
//      the browser reports it as a generic network error, which is a miserable
//      thing to debug.
//
// So: a bare fetch at VITE_API_URL, no auth header, no Houzs headers. The API
// side is Origin-gated instead of authenticated because the POS holds only a
// Houzs token since the cutover and cannot pass 2990's supabaseAuth — see the
// header of apps/api/src/routes/campaign-promos.ts for what that costs.
// ----------------------------------------------------------------------------
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

const API = (import.meta.env.VITE_API_URL ?? '') as string;

export interface CampaignPromo {
  id: string;
  name: string;
  valueCenti: number;
  stockTotal: number;
  stockUsed: number;
  /** Server-derived so callers never do the subtraction themselves. */
  remaining: number;
  minPurchaseQty: number;
  maxPerOrder: number;
  terms: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignPromoInput {
  name: string;
  valueCenti: number;
  stockTotal: number;
  minPurchaseQty: number;
  maxPerOrder: number;
  terms: string;
  active: boolean;
}

export interface CampaignRedemption {
  id: string;
  campaign_id: string;
  status: 'RESERVED' | 'APPLIED' | 'RELEASED';
  applied_centi: number;
  so_doc_no: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  redeemed_by_name: string | null;
  terms_snapshot: string;
  released_at: string | null;
  release_reason: string | null;
  created_at: string;
}

/** Surfaces the API's own `error`/`reason` instead of a bare status code — the
 *  routes return actionable ones (campaign_unavailable, stock_below_used). */
const call = async <T>(path: string, init?: RequestInit): Promise<T> => {
  if (!API) throw new Error('VITE_API_URL is not set');
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const err = String(body.error ?? `http_${res.status}`);
    const reason = body.reason ? ` — ${String(body.reason)}` : '';
    throw new Error(`${err}${reason}`);
  }
  return body as T;
};

const KEY = ['campaign-promos'] as const;

export const useCampaignPromos = (activeOnly = false) =>
  useQuery({
    queryKey: [...KEY, activeOnly ? 'active' : 'all'],
    queryFn: async () => {
      const b = await call<{ campaigns: CampaignPromo[] }>(
        `/campaign-promos${activeOnly ? '?activeOnly=1' : ''}`,
      );
      return b.campaigns ?? [];
    },
    // Stock moves whenever anyone redeems, and there is no realtime on this
    // path (Houzs has none, and this endpoint is a different backend again).
    refetchInterval: 30_000,
  });

export const useCreateCampaignPromo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CampaignPromoInput) =>
      call<{ campaign: CampaignPromo }>('/campaign-promos', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
};

export const useUpdateCampaignPromo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: Partial<CampaignPromoInput> }) =>
      call<{ campaign: CampaignPromo }>(`/campaign-promos/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
};

export const useCampaignRedemptions = (campaignId: string | null) =>
  useQuery({
    queryKey: [...KEY, 'redemptions', campaignId],
    enabled: Boolean(campaignId),
    queryFn: async () => {
      const b = await call<{ redemptions: CampaignRedemption[] }>(
        `/campaign-promos/redemptions?campaignId=${encodeURIComponent(campaignId ?? '')}`,
      );
      return b.redemptions ?? [];
    },
  });

/* ── Cart-side claim/confirm/release ────────────────────────────────────────
   Not hooks — the cart calls these imperatively around the Houzs order submit,
   in this order:
     1. claim   → reserves stock, returns a redemptionId. 409 = refuse, do NOT
                  apply any discount.
     2. submit the order to Houzs with the discount on the lines
     3. confirm on success, or release on failure.
   A row left RESERVED means step 3 never ran — sweep those; do not assume the
   voucher was spent. */
export const claimCampaignPromo = (
  campaignId: string,
  body: { appliedCenti: number; redeemedBy?: string; redeemedByName?: string },
) =>
  call<{ redemptionId: string; appliedCenti: number; termsSnapshot: string }>(
    `/campaign-promos/${campaignId}/claim`,
    { method: 'POST', body: JSON.stringify(body) },
  );

export const confirmCampaignPromo = (
  redemptionId: string,
  body: { soDocNo: string; customerName?: string; customerPhone?: string },
) =>
  call<{ ok: true }>(`/campaign-promos/redemptions/${redemptionId}/confirm`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

export const releaseCampaignPromo = (redemptionId: string, reason: string) =>
  call<{ ok: boolean }>(`/campaign-promos/redemptions/${redemptionId}/release`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });

/* Admin-side release, for the ledger's Release button.
 *
 * WHY THIS EXISTS AS A MANUAL ACTION. A cancelled order does NOT return its
 * voucher to the pool on its own, and it cannot be made to: the cancel runs in
 * HOUZS (mfg-sales-orders.ts's SO-cancel path, where PWP does its own release),
 * and Houzs has no knowledge of this table and no way to reach it — there is no
 * sync in either direction since the 2026-07-21 cutover. So the only correct
 * closing move available to us is a human one, which is also how the team
 * already reconciles vouchers.
 *
 * Invalidates the whole KEY because release moves stock_used, so BOTH the
 * campaign list and the ledger are stale afterwards. */
export const useReleaseCampaignPromo = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ redemptionId, reason }: { redemptionId: string; reason: string }) =>
      releaseCampaignPromo(redemptionId, reason),
    onSuccess: () => void qc.invalidateQueries({ queryKey: KEY }),
  });
};
