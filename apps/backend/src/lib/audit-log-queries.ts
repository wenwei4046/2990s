import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export interface AuditLogFilters {
  from?: string;
  to?: string;
  salespersonIds?: string[];
  paymentMethods?: string[];
  amountMin?: number;
  amountMax?: number;
}

export interface AuditLogRow {
  id: string;
  placedAt: string;
  customerName: string;
  customerPhone: string | null;
  total: number;
  paid: number;
  paymentMethod: string;
  installmentMonths: number | null;
  approvalCode: string | null;
  slipKey: string | null;
  slipUploaded: boolean;
  showroomId: string;
  salespersonId: string | null;
  staffId: string;
}

interface AuditLogResponse {
  rows: AuditLogRow[];
  count: number;
}

function buildQueryString(f: AuditLogFilters): string {
  const params = new URLSearchParams();
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  for (const id of f.salespersonIds ?? []) params.append('salespersonId', id);
  for (const m of f.paymentMethods ?? []) params.append('paymentMethod', m);
  if (f.amountMin !== undefined) params.set('amountMin', String(f.amountMin));
  if (f.amountMax !== undefined) params.set('amountMax', String(f.amountMax));
  const s = params.toString();
  return s ? `?${s}` : '';
}

export const useAuditLog = (filters: AuditLogFilters) =>
  useQuery({
    queryKey: ['audit-log', filters],
    queryFn: async (): Promise<AuditLogResponse> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const res = await fetch(`${API_URL}/admin/audit-log${buildQueryString(filters)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '<no body>');
        throw new Error(`audit-log failed (${res.status}): ${text}`);
      }
      return res.json() as Promise<AuditLogResponse>;
    },
    staleTime: 30_000,
  });

export const useAuditLogRealtime = () => {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('audit-log-orders')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'orders' },
        () => void qc.invalidateQueries({ queryKey: ['audit-log'] }),
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
};
