// ---------------------------------------------------------------------------
// NewVersionBanner (A1) — a non-blocking "a newer version is ready" prompt.
//
// Mounted ONCE near the app root. When useVersionCheck detects that a newer
// build is live (the deployed index.html now references a different entry
// chunk), it shows a small bottom-centre banner with a "Reload now" button.
// We never reload from under the operator — they click when they're ready, so
// a deploy mid-data-entry can't wipe their work. Styled with design tokens
// only (no Tailwind).
// ---------------------------------------------------------------------------

import type { CSSProperties } from 'react';
import { RefreshCw } from 'lucide-react';
import { useVersionCheck } from '../lib/use-version-check';

export function NewVersionBanner() {
  const { updateReady } = useVersionCheck();
  if (!updateReady) return null;

  return (
    <div style={wrapStyle} role="status" aria-live="polite">
      <span style={textStyle}>A newer version of the system is ready.</span>
      <button type="button" onClick={() => window.location.reload()} style={btnStyle}>
        <RefreshCw size={14} strokeWidth={2} />
        Reload now
      </button>
    </div>
  );
}

const wrapStyle: CSSProperties = {
  position: 'fixed',
  bottom: 16,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 4000,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '10px 14px',
  background: 'var(--c-ink, #221F20)',
  color: 'var(--c-paper, #fff)',
  borderRadius: 'var(--radius-pill, 999px)',
  boxShadow: '0 6px 24px rgba(0,0,0,0.28)',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-13)',
  maxWidth: 'calc(100vw - 32px)',
};

const textStyle: CSSProperties = {
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
};

const btnStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  flexShrink: 0,
  background: 'var(--c-orange, #c47b2f)',
  color: 'var(--c-paper, #fff)',
  border: 'none',
  borderRadius: 'var(--radius-pill, 999px)',
  padding: '6px 12px',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-12)',
  fontWeight: 600,
  cursor: 'pointer',
};
