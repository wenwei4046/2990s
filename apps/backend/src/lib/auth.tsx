import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

// Migration 0086 (2026-05-27) — 3 new sales-side roles.
export type StaffRole =
  | 'sales' | 'showroom_lead' | 'coordinator' | 'finance' | 'admin'
  | 'sales_executive' | 'outlet_manager' | 'sales_director'
  // Migration 0092 — owner role, FULL access to BOTH portals.
  | 'super_admin'
  // Migration 0110 — POS-only selling-price editor (cost/sell split Phase 2).
  | 'master_account';

/* Roles that may NOT access the Backend portal. They land on POS only.
   Layout.tsx redirects them to /no-access. super_admin is NOT here — it
   accesses both portals. */
export const POS_ONLY_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>([
  'sales', 'sales_executive', 'outlet_manager', 'master_account',
]);

/* TEMPORARY (Loo 2026-06-10) — emergency hatch while the new POS order flow
   stabilises: POS-only roles may use the Sales Order module (raw SO creation
   at /mfg-sales-orders/new, plus the list/detail the create flow lands on).
   The maintenance vocabulary editor stays blocked, as does every other module.
   Remove this allow-list (and the POS Catalog sidebar link that points here)
   when the hatch is retired. */
export const posOnlyAllowedPath = (pathname: string): boolean =>
  pathname.startsWith('/mfg-sales-orders') &&
  !pathname.startsWith('/mfg-sales-orders/maintenance');

/* Admin-level roles — anywhere the UI gated on role === 'admin', it should
   ALSO accept super_admin. Use isAdminLevel() so the widening is in one
   place. (super_admin is a strict superset of admin.) */
export const isAdminLevel = (role: StaffRole | null | undefined): boolean =>
  role === 'admin' || role === 'super_admin';

export interface StaffProfile {
  id: string;
  staffCode: string;
  name: string;
  role: StaffRole;
  showroomId: string | null;
  venueId: string | null;
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

// Module-scope so the reference is stable — keeps the staff-fetch effect from
// re-running on every render of AuthProvider.
const fetchStaff = async (userId: string): Promise<StaffProfile | null> => {
  const { data, error } = await supabase
    .from('staff')
    .select('id, staff_code, name, role, showroom_id, venue_id, initials, color, active')
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
    venueId: data.venue_id,
    initials: data.initials,
    color: data.color,
  };
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  // Bug #5: split loading into session + staff phases so Layout can wait for
  // BOTH to resolve before deciding whether to redirect. The previous flat
  // `loading` flag flipped false as soon as the session was known, opening a
  // window where Layout saw user + null-staff and bounced to /no-access (or
  // /login on a re-mount) before the staff round-trip landed.
  const [sessionLoading, setSessionLoading] = useState(true);
  const [staffLoading, setStaffLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [staff, setStaff] = useState<StaffProfile | null>(null);
  const userId = session?.user?.id ?? null;

  // Effect 1: own session — initial fetch + auth-change subscription.
  // Token refreshes fire onAuthStateChange with the same user.id — Effect 2's
  // dep array means we won't re-query the staff row in that case.
  useEffect(() => {
    let mounted = true;

    // Hard ceiling on session-loading. If supabase.auth.getSession() ever
    // hangs (navigator-locks deadlock under StrictMode + HMR), drop to
    // "no session" within 7s rather than wedging the UI forever.
    const failsafe = setTimeout(() => {
      if (!mounted) return;
      setSessionLoading((prev) => {
        if (prev) {
          console.warn(
            '[auth] getSession() did not resolve within 7s — releasing sessionLoading. ' +
              'Likely a stuck navigator-locks acquisition.',
          );
        }
        return false;
      });
    }, 7000);

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setSessionLoading(false);
      })
      .catch((err) => {
        if (!mounted) return;
        console.error('[auth] getSession() rejected:', err);
        setSession(null);
        setSessionLoading(false);
      });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      if (!mounted) return;
      setSession(newSession);
      setSessionLoading(false);
    });

    return () => {
      mounted = false;
      clearTimeout(failsafe);
      sub.subscription.unsubscribe();
    };
  }, []);

  // Effect 2: own staff — fires only after session has resolved and only
  // when the authenticated user identity changes (login, logout, account
  // switch). Gating on sessionLoading avoids a render gap where userId
  // flips null→real but staffLoading is still false from the not-yet-logged-in
  // branch — Layout would otherwise see (user, staff=null, loading=false)
  // for one frame and bounce to /no-access. Crucially does NOT re-fire on
  // token refresh, which previously could overwrite a valid staff with null
  // if the refresh-fetch hit a transient RLS hiccup.
  useEffect(() => {
    if (sessionLoading) return;

    if (userId === null) {
      setStaff(null);
      setStaffLoading(false);
      return;
    }

    let cancelled = false;
    setStaffLoading(true);

    fetchStaff(userId)
      .then((profile) => {
        if (cancelled) return;
        setStaff(profile);
        setStaffLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.error('[auth] fetchStaff() rejected:', err);
        // Transient failure: keep prior staff value rather than wiping it.
        // The user identity hasn't changed, so the prior value is still
        // semantically valid and beats a spurious /no-access bounce.
        setStaffLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [userId, sessionLoading]);

  const loading = sessionLoading || staffLoading;

  const signIn = async (email: string, password: string) => {
    // Bug #4: race against a 10s timeout so the UI never wedges on a stuck
    // navigator-locks acquisition. The signin promise itself isn't aborted
    // (Supabase has no AbortSignal hook), so it may still resolve later in
    // the background — that's OK, onAuthStateChange will pick it up.
    const TIMEOUT_MS = 10_000;
    type SignInResult = Awaited<ReturnType<typeof supabase.auth.signInWithPassword>>;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<SignInResult>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error('Sign-in timed out — clear browser data and retry')),
        TIMEOUT_MS,
      );
    });
    try {
      const { error } = await Promise.race([
        supabase.auth.signInWithPassword({ email, password }),
        timeout,
      ]);
      return { error: error ? error.message : null };
    } catch (err) {
      return { error: err instanceof Error ? err.message : 'sign-in failed' };
    } finally {
      if (timer) clearTimeout(timer);
    }
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
