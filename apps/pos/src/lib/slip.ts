import { API_URL, authedFetchRaw, IS_HOUZS } from './apiClient';
import type {
  SlipInitRequest,
  SlipInitResponse,
  SlipConfirmResponse,
} from '@2990s/shared/schemas';

export async function sha256Hex(file: File | Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

async function initSlipUpload(file: File): Promise<SlipInitResponse> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const hash = await sha256Hex(file);
  const body: SlipInitRequest = {
    fileSize: file.size,
    contentType: file.type as SlipInitRequest['contentType'],
    contentHash: hash,
  };
  const res = await authedFetchRaw('/slips/init', {
    method: 'POST',
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`slip init failed (${res.status}): ${text}`);
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
    throw new Error(`R2 PUT failed (${res.status})`);
  }
}

// Houzs Worker-proxy upload leg. Houzs converted /slips OFF presigned-PUT (its
// R2 S3-API creds were never created, so /slips/init returns NO putUrl); the
// bytes are POSTed to /slips/:session/upload as a raw binary body — the same
// sequence the Houzs frontend uses. authedFetchRaw keeps the caller's
// content-type for a non-string (Blob) body, so the browser sends file.type.
async function uploadBytesProxy(sessionId: string, file: File): Promise<void> {
  const res = await authedFetchRaw(`/slips/${sessionId}/upload`, {
    method: 'POST',
    headers: { 'content-type': file.type },
    body: file,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`slip upload failed (${res.status}): ${text}`);
  }
}

async function confirmUpload(sessionId: string): Promise<SlipConfirmResponse> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const res = await authedFetchRaw(`/slips/${sessionId}/confirm`, {
    method: 'POST',
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(`slip confirm failed (${res.status}): ${text}`);
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
 * Full upload sequence with one retry on transient upload errors.
 * - Step 1: init → upload session (+ a presigned URL on the 2990 target)
 * - Step 2: send the bytes (1 retry, 2s backoff) — Worker-proxy POST on Houzs,
 *   presigned PUT direct to R2 on 2990
 * - Step 3: confirm → server HEADs R2 and validates size
 */
export async function uploadSlipFull(opts: UploadSlipOptions): Promise<UploadSlipResult> {
  opts.onProgress?.('init');
  const init = await initSlipUpload(opts.file);

  opts.onProgress?.('put');
  // Houzs has no presigned-PUT (init returns no putUrl) → proxy the bytes through
  // the Worker; 2990 keeps the direct presigned PUT. Branch on the active target
  // so both backends work through the parallel run (2990 is still live).
  let putErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      if (IS_HOUZS) {
        await uploadBytesProxy(init.uploadSessionId, opts.file);
      } else if (init.putUrl) {
        await putToR2(init.putUrl, opts.file);
      } else {
        throw new Error('slip upload has no transport (no putUrl and not on Houzs target)');
      }
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
