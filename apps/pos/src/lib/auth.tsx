import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { detectRecoveryInUrl } from './recovery';
import {
  setHouzsToken,
  clearHouzsToken,
  getHouzsToken,
  getHouzsStaffId,
  setHouzsStaffId,
} from './houzsSession';

const ENV = import.meta.env as Record<string, string | undefined>;

/** 'houzs' once the auth cutover flips; '2990' (the original Supabase auth) until
 *  then. Mirrors apiClient.ts so the login path and the data path agree. */
const TARGET: '2990' | 'houzs' = ENV.VITE_BACKEND_TARGET === 'houzs' ? 'houzs' : '2990';

/** 2990 pin-login base (unchanged). Houzs derives its own base below. */
const API_URL = ENV.VITE_API_URL;

/** The 2990-mirrored company on Houzs (mirrors apiClient's HOUZS_COMPANY_ID).
 *  Sent as X-Company-Id on the login calls so pin-login / email-login resolve
 *  the staff in the RIGHT company instead of falling back to the login hostname
 *  (which on the Houzs host resolves to company 1 = HOUZS — the wrong roster). */
const HOUZS_COMPANY_ID = ENV.VITE_HOUZS_COMPANY_ID ?? '2';

// Base-URL derivation (Houzs): pin-login is at /api/pos and email login at
// /api/auth — NOT under /api/scm where VITE_HOUZS_API_URL points. So derive the
// shared /api root by stripping a trailing /scm from VITE_HOUZS_API_URL.
// VITE_HOUZS_POS_URL (the /api root) overrides the derivation when set.
function houzsApiRoot(): string | undefined {
  const explicit = ENV.VITE_HOUZS_POS_URL;
  if (explicit) return explicit.replace(/\/+$/, '');
  const scm = ENV.VITE_HOUZS_API_URL;
  if (!scm) return undefined;
  return scm.replace(/\/+$/, '').replace(/\/scm$/, '');
}

/** The minimal user shape BOTH backends populate. On 2990 it is projected from
 *  the Supabase User; on Houzs it is `{ id: staffId }` from the pin-login /
 *  email-login response. Consumers must only read `.id` / `.email`. */
export interface AuthUser {
  id: string;
  email?: string;
}

const toAuthUser = (u: User | null | undefined): AuthUser | null =>
  u ? { id: u.id, email: u.email ?? undefined } : null;

export interface PinLoginResult {
  error: string | null;
  remainingAttempts?: number;
  retryAfter?: number;
}

interface AuthState {
  loading: boolean;
  user: AuthUser | null;
  /** Supabase session — 2990 path only; always null on the Houzs path. */
  session: Session | null;
  recovery: boolean;
  /** True when the signed-in user must set a password before using the app
   *  (Supabase invite onboarding, 2990 only). Always false on Houzs — POS is
   *  PIN-primary there and there is no Supabase-metadata onboarding. */
  needsPasswordSetup: boolean;
  clearRecovery: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  pinLogin: (staffId: string, pin: string) => Promise<PinLoginResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  // Password-recovery is a Supabase-only flow. On Houzs it is disabled (POS is
  // PIN-primary) so the flag is hard-forced false there and no recovery hash is
  // ever honoured. On 2990: snapshot the URL hash synchronously before
  // supabase-js (detectSessionInUrl) strips it; the PASSWORD_RECOVERY event
  // below is the backup signal. Guards route any recovery session to
  // /set-password regardless of where Supabase drops the redirect.
  const [recovery, setRecovery] = useState(() =>
    TARGET === 'houzs' ? false : detectRecoveryInUrl(),
  );

  useEffect(() => {
    // ── Houzs path ─────────────────────────────────────────────────────────
    // No Supabase involved: rehydrate the in-memory user from the persisted
    // {token, staffId} record (houzsSession.ts). No auth-state listener — the
    // token store is the single source and only login/logout mutate it.
    if (TARGET === 'houzs') {
      const token = getHouzsToken();
      const staffId = getHouzsStaffId();
      if (token && staffId) setUser({ id: staffId });
      setLoading(false);
      return;
    }

    // ── 2990 path (unchanged Supabase auth) ────────────────────────────────
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setUser(toAuthUser(data.session?.user));
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(newSession);
      setUser(toAuthUser(newSession?.user));
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    if (TARGET === 'houzs') {
      const root = houzsApiRoot();
      if (!root) return { error: 'VITE_HOUZS_API_URL is not set' };
      let res: Response;
      try {
        res = await fetch(`${root}/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Company-Id': HOUZS_COMPANY_ID },
          body: JSON.stringify({ email, password }),
        });
      } catch {
        return { error: 'network_error' };
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string; token?: string; staffId?: string; userId?: string; id?: string;
      };
      if (!res.ok) return { error: body.error ?? `login_failed_${res.status}` };
      if (!body.token) return { error: 'login_failed' };
      // Identity: the POS keys everything (staff lookup, cart-sync) on user.id =
      // scm.staff.id. Prefer staffId; fall back to userId/id if the email-login
      // response omits it. See FLAG in the PR notes — this field is unverified.
      const id = body.staffId ?? body.userId ?? body.id ?? '';
      setHouzsToken(body.token);
      setHouzsStaffId(id);
      setUser({ id, email });
      return { error: null };
    }
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  };

  const pinLogin = async (staffId: string, pin: string): Promise<PinLoginResult> => {
    if (TARGET === 'houzs') {
      const root = houzsApiRoot();
      if (!root) return { error: 'VITE_HOUZS_API_URL is not set' };
      let res: Response;
      try {
        res = await fetch(`${root}/pos/pin-login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'X-Company-Id': HOUZS_COMPANY_ID },
          body: JSON.stringify({ staffId, pin }),
        });
      } catch {
        return { error: 'network_error' };
      }
      const body = (await res.json().catch(() => ({}))) as {
        error?: string; remainingAttempts?: number; retryAfter?: number;
        token?: string; userId?: string; staffId?: string;
      };
      if (!res.ok) {
        return {
          error: body.error ?? `pin_login_failed_${res.status}`,
          remainingAttempts: body.remainingAttempts,
          retryAfter: body.retryAfter,
        };
      }
      if (!body.token) return { error: 'session_issue_failed' };
      // staffId echoed by the server is authoritative; fall back to the one we
      // sent (they are the same scm.staff.id space).
      const id = body.staffId ?? staffId;
      setHouzsToken(body.token);
      setHouzsStaffId(id);
      setUser({ id });
      return { error: null };
    }

    // ── 2990 path (unchanged) ───────────────────────────────────────────────
    if (!API_URL) return { error: 'VITE_API_URL is not set' };
    const res = await fetch(`${API_URL}/pos/pin-login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ staffId, pin }),
    });
    const body = await res.json().catch(() => ({})) as {
      error?: string; remainingAttempts?: number; retryAfter?: number;
      tokenHash?: string; email?: string;
    };
    if (!res.ok) {
      return {
        error: body.error ?? `pin_login_failed_${res.status}`,
        remainingAttempts: body.remainingAttempts,
        retryAfter: body.retryAfter,
      };
    }
    if (!body.tokenHash || !body.email) {
      return { error: 'session_issue_failed' };
    }
    // Use token_hash flow — body.tokenHash is the hashed_token from
    // admin.generateLink. The plain `token` field expects a 6-digit OTP code,
    // not the hash, which is why the previous version returned
    // "Token has expired or is invalid".
    const { error: otpErr } = await supabase.auth.verifyOtp({
      token_hash: body.tokenHash,
      type: 'magiclink',
    });
    return { error: otpErr?.message ?? null };
  };

  const signOut = async () => {
    if (TARGET === 'houzs') {
      clearHouzsToken();
      setUser(null);
      return;
    }
    await supabase.auth.signOut();
  };

  const clearRecovery = () => setRecovery(false);

  // 2990: the Supabase invite metadata flag drives the first-time SetPassword
  // redirect. Houzs has no such metadata → never pending.
  const needsPasswordSetup =
    TARGET === 'houzs'
      ? false
      : session?.user?.user_metadata?.password_set === false;

  return (
    <AuthContext.Provider
      value={{
        loading,
        user,
        session,
        recovery,
        needsPasswordSetup,
        clearRecovery,
        signIn,
        pinLogin,
        signOut,
      }}
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
