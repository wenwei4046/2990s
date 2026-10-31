import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import styles from '../../pages/Products.module.css';

/** Minimal drawer-shell wrapper. Right-slide panel with backdrop. Modular's
 *  drawers — one Model's Allowed Options, and ⋯ › Edit several models. */
export const DrawerShell = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => (
  <div
    role="dialog"
    aria-label={title}
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.32)',
      zIndex: 80,
      display: 'flex',
      justifyContent: 'flex-end',
    }}
    onClick={onClose}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 'min(520px, 100vw)',
        height: '100%',
        background: 'var(--c-paper)',
        boxShadow: '-12px 0 32px rgba(0, 0, 0, 0.18)',
        padding: 'var(--space-5)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <h2 style={{
          margin: 0,
          fontFamily: 'var(--font-title)',
          fontSize: 'var(--fs-20)',
          fontWeight: 700,
          color: 'var(--c-ink)',
        }}>{title}</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={styles.maintRowIcon}
          style={{ color: 'var(--fg-muted)' }}
        >
          <X size={16} strokeWidth={1.75} />
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  </div>
);
