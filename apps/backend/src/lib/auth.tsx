import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type StaffRole = 'sales' | 'showroom_lead' | 'coordinator' | 'finance' | 'admin';

export interface StaffProfile {
  id: string;
  staffCode: string;
  name: string;
  role: StaffRole;
  showroomId: string | null;
  initials: string;
  color: string;
}

interface AuthState {
  loading: boolean;
  user: User | null;
  session: Session | null;
  staff: StaffProfile | null;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<StaffProfile | null>(null);

  // Fetch the staff row matching auth.uid(). Returns null if no matching
  // staff row exists (e.g. the user signed up but the bootstrap trigger
  // didn't fire — owner_email mismatch).
  const fetchStaff = async (userId: string): Promise<StaffProfile | null> => {
    const { data, error } = await supabase
      .from('staff')
      .select('id, staff_code, name, role, showroom_id, initials, color, active')
      .eq('id', userId)
      .eq('active', true)
      .maybeSingle();

    if (error || !data) return null;
    return {
      id: data.id,
      staffCode: data.staff_code,
      name: data.name,
      role: data.role,
      showroomId: data.showroom_id,
      initials: data.initials,
      color: data.color,
    };
  };

  useEffect(() => {
    let mounted = true;

    // Hard ceiling on Loading state. If supabase.auth.getSession() ever hangs
    // (known issue: navigator-locks deadlock under StrictMode + HMR, see
    // supabase/supabase-js#42505), the UI must still recover within 7s by
    // dropping to "no session" — better to show the login form than to wedge
    // forever. onAuthStateChange will still fire later if/when getSession
    // resolves and supersede this fallback.
    const failsafe = setTimeout(() => {
      if (!mounted) return;
      setLoading((prev) => {
        if (prev) {
          console.warn(
            '[auth] getSession() did not resolve within 7s — releasing Loading state. ' +
              'Likely a stuck navigator-locks acquisition.',
          );
        }
        return false;
      });
    }, 7000);

    supabase.auth
      .getSession()
      .then(async ({ data }) => {
        if (!mounted) return;
        if (data.session) {
          const initialStaff = await fetchStaff(data.session.user.id);
          if (!mounted) return;
          setStaff(initialStaff);
        }
        setSession(data.session);
        setLoading(false);
      })
      .catch((err) => {
        // Don't let a getSession() rejection (lock timeout, network hiccup,
        // malformed token) wedge the UI on Loading… forever.
        if (!mounted) return;
        console.error('[auth] getSession() rejected:', err);
        setSession(null);
        setStaff(null);
        setLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange(async (_event, newSession) => {
      if (!mounted) return;
      if (!newSession) {
        setSession(null);
        setStaff(null);
        setLoading(false);
        return;
      }
      // Fetch staff BEFORE setting session so Layout sees user+staff together
      // — otherwise the gap flashes to /no-access during the staff round-trip.
      const newStaff = await fetchStaff(newSession.user.id);
      if (!mounted) return;
      setSession(newSession);
      setStaff(newStaff);
      setLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(failsafe);
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ loading, user: session?.user ?? null, session, staff, signIn, signOut }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = (): AuthState => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
