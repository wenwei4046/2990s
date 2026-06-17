import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { detectRecoveryInUrl } from './recovery';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;

export interface PinLoginResult {
  error: string | null;
  remainingAttempts?: number;
  retryAfter?: number;
}

interface AuthState {
  loading: boolean;
  user: User | null;
  session: Session | null;
  recovery: boolean;
  clearRecovery: () => void;
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  pinLogin: (staffId: string, pin: string) => Promise<PinLoginResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  // Password-recovery session: snapshot the URL hash synchronously before
  // supabase-js (detectSessionInUrl) strips it; the PASSWORD_RECOVERY event
  // below is the backup signal. Guards route any recovery session to
  // /set-password regardless of where Supabase drops the redirect.
  const [recovery, setRecovery] = useState(() => detectRecoveryInUrl());

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setSession(newSession);
    });

    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  const signIn = async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error: error ? error.message : null };
  };

  const pinLogin = async (staffId: string, pin: string): Promise<PinLoginResult> => {
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
    await supabase.auth.signOut();
  };

  const clearRecovery = () => setRecovery(false);

  return (
    <AuthContext.Provider
      value={{ loading, user: session?.user ?? null, session, recovery, clearRecovery, signIn, pinLogin, signOut }}
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
