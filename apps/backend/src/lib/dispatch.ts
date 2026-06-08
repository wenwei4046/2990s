import { supabase } from './supabase';
import { humanApiError } from './authed-fetch';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return token;
}

/** Build storage path: dos/YYYY/MM/{orderId}-{ts}.{ext} */
export function buildDoPath(orderId: string, contentType: string, now = new Date()): string {
  const ext = ({
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
  } as const)[contentType as 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf'];
  if (!ext) throw new Error(`unsupported MIME: ${contentType}`);
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `dos/${yyyy}/${mm}/${orderId}-${now.getTime()}.${ext}`;
}

export async function uploadDoFile(orderId: string, file: File): Promise<string> {
  const path = buildDoPath(orderId, file.type);
  const { error } = await supabase.storage.from('dos').upload(path, file, {
    contentType: file.type,
    upsert: true,
  });
  if (error) throw error;
  return path;
}

export async function getDoSignedUrl(doKey: string, ttlSeconds = 60 * 5): Promise<string> {
  const { data, error } = await supabase.storage.from('dos').createSignedUrl(doKey, ttlSeconds);
  if (error || !data) throw error ?? new Error('signed url failed');
  return data.signedUrl;
}

export async function patchDispatchPrep(orderId: string, payload: {
  driverId?: string | null;
  confirmedDeliveryDate?: string | null;
  confirmedWith?: string;
}): Promise<void> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const res = await fetch(`${API_URL}/orders/${encodeURIComponent(orderId)}/dispatch-prep`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(humanApiError(res.status, text));
  }
}

export async function patchOrderDo(orderId: string, doKey: string): Promise<void> {
  if (!API_URL) throw new Error('VITE_API_URL is not set');
  const token = await getToken();
  const res = await fetch(`${API_URL}/orders/${encodeURIComponent(orderId)}/do`, {
    method: 'PATCH',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ doKey }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '<no body>');
    throw new Error(humanApiError(res.status, text));
  }
}
