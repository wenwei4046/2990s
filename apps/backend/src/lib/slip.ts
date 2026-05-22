import { supabase } from './supabase';
import type { SlipUrlResponse } from '@2990s/shared/schemas';

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
    throw new Error(`slip-url failed (${res.status}): ${text}`);
  }
  return res.json() as Promise<SlipUrlResponse>;
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
    throw new Error(`lane update failed (${res.status}): ${text}`);
  }
}
