import { useState, useRef, useEffect } from 'react';
import { ChevronDown, FilePlus2, LifeBuoy, ClipboardList } from 'lucide-react';
import { authedFetch, IS_HOUZS, houzsApiRoot, posApiBase } from '../lib/apiClient';
import styles from './HouzsSsoMenu.module.css';

// POS → Houzs SSO menu. Renders a small "+ New" pill in the topbar; clicking
// opens a dropdown with 3 actions that each SSO into the corresponding Houzs
// backend page in a new tab (no email+password prompt for the salesperson):
//   - Manual Sales Order create   → /scm/sales-orders/new
//   - Service Case (raise a case) → /assr
//   - My Service Cases (progress) → /my-cases
// Hidden on the 2990-target build; only shows when the POS is pointing at
// Houzs (IS_HOUZS). Handoff = POST /api/pos/exchange-web-session on Houzs
// mints a fresh desktop session for the current user; we open
// `${houzsWebBase}/#sso=<token>&next=<path>` — main.tsx there consumes the
// fragment, stores the token session-only, and routes to <next>.

const MENU_ITEMS: Array<{ path: string; label: string; icon: typeof FilePlus2 }> = [
  { path: '/scm/sales-orders/new', label: 'Manual Sales Order', icon: FilePlus2 },
  { path: '/assr',                 label: 'Service Case',       icon: LifeBuoy },
  { path: '/my-cases',             label: 'My Service Cases',   icon: ClipboardList },
];

// Derive the Houzs web app origin from the API URL (drop the /api/scm suffix).
function houzsWebOrigin(): string | undefined {
  const api = houzsApiRoot(); // e.g. https://erp.houzscentury.com/api/scm
  if (!api) return undefined;
  try {
    const u = new URL(api);
    return u.origin;
  } catch {
    return undefined;
  }
}

export function HouzsSsoMenu() {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  if (!IS_HOUZS) return null;
  const origin = houzsWebOrigin();
  if (!origin) return null;

  async function launch(path: string) {
    setBusy(path);
    setError(null);
    try {
      const { token } = await authedFetch<{ token: string }>(
        '/pos/exchange-web-session',
        { method: 'POST' },
        posApiBase(),
      );
      const url = `${origin}/#sso=${encodeURIComponent(token)}&next=${encodeURIComponent(path)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
      setOpen(false);
    } catch (e) {
      setError((e as Error)?.message ?? 'exchange_failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
      >
        <span>Houzs</span>
        <ChevronDown size={13} strokeWidth={1.75} />
      </button>
      {open && (
        <div className={styles.menu} role="menu">
          {MENU_ITEMS.map((it) => {
            const Icon = it.icon;
            return (
              <button
                key={it.path}
                type="button"
                className={styles.item}
                role="menuitem"
                disabled={busy != null}
                onClick={() => void launch(it.path)}
              >
                <Icon size={16} strokeWidth={1.75} />
                <span>{busy === it.path ? 'Opening…' : it.label}</span>
              </button>
            );
          })}
          {error && <div className={styles.error}>{error}</div>}
        </div>
      )}
    </div>
  );
}
