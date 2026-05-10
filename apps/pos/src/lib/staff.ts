import { useQuery } from '@tanstack/react-query';
import { useAuth } from './auth';
import { supabase } from './supabase';

export interface StaffRecord {
  id: string;
  staffCode: string;
  name: string;
  role: string;
  initials: string;
  color: string;
}

export function useStaff() {
  const { user } = useAuth();
  return useQuery<StaffRecord | null>({
    queryKey: ['staff', user?.id],
    enabled: !!user?.id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('staff')
        .select('id, staff_code, name, role, initials, color')
        .eq('id', user!.id)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        id: data.id,
        staffCode: data.staff_code,
        name: data.name,
        role: data.role,
        initials: data.initials,
        color: data.color,
      };
    },
  });
}
