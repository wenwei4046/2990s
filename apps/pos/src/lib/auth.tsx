import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

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
  signIn: (email: string, password: string) => Promise<{ error: string | null }>;
  pinLogin: (staffId: string, pin: string) => Promise<PinLoginResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    let cancelled = false;

    void supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      setSession(data.session);
      setLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
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
    const { error: otpErr } = await supabase.auth.verifyOtp({
      email: body.email,
      token: body.tokenHash,
      type: 'magiclink',
    });
    return { error: otpErr?.message ?? null };
  };

  const signOut = async () => {
    await supabase.auth.signOut();
  };

  return (
    <AuthContext.Provider
      value={{ loading, user: session?.user ?? null, session, signIn, pinLogin, signOut }}
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
