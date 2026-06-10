// ----------------------------------------------------------------------------
// Sso — TEMPORARY (Loo 2026-06-10, Backend SO emergency hatch).
//
// Landing page for the POS "Create Sales Order" handoff. The POS calls
// POST /pos/backend-sso (mints a one-time magic-link token for the signed-in
// salesperson) and opens `/sso#token_hash=…` here. verifyOtp exchanges the
// token for a fresh session on THIS origin — its own refresh-token family, so
// the POS tablet's session is untouched — then lands on the SO create form.
//
// The token rides in the URL FRAGMENT (never sent to the server) and is
// single-use with a short expiry. Remove with the hatch (lib/auth.tsx
// posOnlyAllowedPath + the POS Catalog "Backend" section).
// ----------------------------------------------------------------------------

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useNavigate } from 'react-router';
import { supabase } from '../lib/supabase';

export const Sso = () => {
  const navigate = useNavigate();
  const [failed, setFailed] = useState(false);
  // verifyOtp consumes the token — guard against React StrictMode's dev-mode
  // double effect so the second invocation doesn't burn an already-used token
  // into a spurious failure screen.
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;

    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
    const tokenHash = hash.get('token_hash');
    // Drop the token from the address bar immediately — it shouldn't sit in
    // the URL (or get re-consumed on a manual reload).
    window.history.replaceState(null, '', '/sso');

    if (!tokenHash) {
      navigate('/login', { replace: true });
      return;
    }

    void supabase.auth
      .verifyOtp({ token_hash: tokenHash, type: 'magiclink' })
      .then(({ error }) => {
        if (error) {
          setFailed(true);
          return;
        }
        navigate('/mfg-sales-orders/new', { replace: true });
      });
  }, [navigate]);

  return (
    <main style={pageStyle}>
      <div style={cardStyle}>
        {failed ? (
          <>
            <h1 className="t-h2">Sign-in link expired</h1>
            <p className="t-body fg-muted">
              Go back to the POS and tap Create Sales Order again — each tap
              issues a fresh link.
            </p>
          </>
        ) : (
          <p className="t-body fg-muted">Signing you in…</p>
        )}
      </div>
    </main>
  );
};

const pageStyle: CSSProperties = {
  minHeight: '100vh',
  display: 'grid',
  placeItems: 'center',
  background: 'var(--c-cream)',
};

const cardStyle: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 8,
  textAlign: 'center',
  padding: 32,
};
