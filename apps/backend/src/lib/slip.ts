import { supabase } from './supabase';
import { humanApiError } from './authed-fetch';
import type {
  SlipInitRequest,
  SlipInitResponse,
  SlipConfirmResponse,
  SlipUrlResponse,
} from '@2990s/shared/schemas';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return token;
}

export async function fetchSlipUrl(orderId: string): Promise<SlipUrlResponse> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const res = await fetch(`${API_URL}/orders/${encodeURIComponent(orderId)}/slip-url`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(humanApiError(res.status, text));
  }
  return res.json() as Promise<SlipUrlResponse>;
}

/** Presigned GET URL for a manufacturing Sales Order's payment slip (P1,
 *  migration 0143). Mirrors fetchSlipUrl but hits the SO route keyed by docNo. */
export async function fetchSoSlipUrl(docNo: string): Promise<SlipUrlResponse> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const res = await fetch(`${API_URL}/mfg-sales-orders/${encodeURIComponent(docNo)}/slip-url`, {
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(humanApiError(res.status, text));
  }
  return res.json() as Promise<SlipUrlResponse>;
}

/** Presigned GET URL for a single SO payment row's slip (Spec D4, migration
 *  0159). 400 no_slip_attached for legacy rows that predate per-payment
 *  slips — the caller falls back to the order-level slip in that case. */
export async function fetchPaymentSlipUrl(
  docNo: string,
  paymentId: string,
): Promise<SlipUrlResponse> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const res = await fetch(
    `${API_URL}/mfg-sales-orders/${encodeURIComponent(docNo)}/payments/${encodeURIComponent(paymentId)}/slip-url`,
    { headers: { authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(humanApiError(res.status, text));
  }
  return res.json() as Promise<SlipUrlResponse>;
}

/* ════════════════════════════════════════════════════════════════════════
   Slip UPLOAD (Spec D4, 2026-06-06) — backend twin of apps/pos/src/lib/slip.ts.
   Lets the Backend PaymentsTable attach a per-payment slip the same way the
   POS handover does: init → PUT direct to R2 → confirm. The committed
   uploadSessionId is then handed to POST /mfg-sales-orders/:docNo/payments.
   ════════════════════════════════════════════════════════════════════════ */

export async function sha256Hex(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function initSlipUpload(file: File): Promise<SlipInitResponse> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const hash = await sha256Hex(file);
  const body: SlipInitRequest = {
    fileSize: file.size,
    contentType: file.type as SlipInitRequest['contentType'],
    contentHash: hash,
  };
  const res = await fetch(`${API_URL}/slips/init`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(humanApiError(res.status, text));
  }
  return res.json() as Promise<SlipInitResponse>;
}

async function putToR2(putUrl: string, file: File): Promise<void> {
  const res = await fetch(putUrl, {
    method: 'PUT',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!res.ok) {
    throw new Error(humanApiError(res.status, ''));
  }
}

async function confirmUpload(sessionId: string): Promise<SlipConfirmResponse> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const res = await fetch(`${API_URL}/slips/${sessionId}/confirm`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(humanApiError(res.status, text));
  }
  return res.json() as Promise<SlipConfirmResponse>;
}

export type SlipUploadPhase = 'init' | 'put' | 'confirm';

export interface UploadSlipOptions {
  file: File;
  onProgress?: (phase: SlipUploadPhase) => void;
}

export interface UploadSlipResult {
  uploadSessionId: string;
  r2Key: string;
}

/**
 * Full upload sequence with one retry on transient PUT errors.
 * - Step 1: init → get presigned URL
 * - Step 2: PUT directly to R2 (with 1 retry, 2s backoff)
 * - Step 3: confirm → server HEADs R2 and validates size
 */
export async function uploadSlipFull(opts: UploadSlipOptions): Promise<UploadSlipResult> {
  opts.onProgress?.('init');
  const init = await initSlipUpload(opts.file);

  opts.onProgress?.('put');
  let putErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await putToR2(init.putUrl, opts.file);
      putErr = undefined;
      break;
    } catch (err) {
      putErr = err;
      if (attempt === 0) await new Promise((r) => setTimeout(r, 2000));
    }
  }
  if (putErr) throw putErr;

  opts.onProgress?.('confirm');
  await confirmUpload(init.uploadSessionId);
  return { uploadSessionId: init.uploadSessionId, r2Key: init.r2Key };
}

export async function patchOrderLane(orderId: string, lane: string): Promise<void> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const res = await fetch(`${API_URL}/orders/${encodeURIComponent(orderId)}/lane`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ lane }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(humanApiError(res.status, text));
  }
}
