// ----------------------------------------------------------------------------
// Drawer — UI-KIT §1.5, the ONE drawer skeleton every module shares.
//
// The region order is fixed by this component, not by the caller:
//
//     Header          (sticky — never scrolls)
//     Identity        (sticky — who/what this record is)
//     Current Action  (sticky — always visible, even when everything else is
//                      collapsed or the panel is short)
//     Content         (the ONLY scrollable region)
//     Footer          (sticky — primary + secondary action)
//
// Regions are SLOTS, not children, precisely so a module cannot re-order them.
// A slot that is left undefined renders nothing at all (no empty strip, no
// "None" placeholder) — same rule the information hierarchy uses for sections
// with no content.
//
// Desktop / tablet / mobile all render the SAME DOM in the SAME order. The
// mobile breakpoint changes the panel's size and corner radius only; it never
// re-orders, hides, or collapses a region.
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useId, useRef, type ReactNode } from 'react';
import clsx from 'clsx';
import styles from './Drawer.module.css';

/** Panel widths. Tablet uses the desktop value; the mobile query overrides. */
export type DrawerWidth = 'sm' | 'md' | 'lg' | 'xl' | 'page';

export interface DrawerProps {
  // -- Region 1 · Header -----------------------------------------------------
  /** Primary identifier — the order/document number for record drawers. */
  title: ReactNode;
  /** Secondary identifier — the customer name for record drawers. */
  subtitle?: ReactNode;
  /** Small uppercase kicker above the title. */
  eyebrow?: ReactNode;
  /** Extra header controls, placed left of the close button. */
  headerAside?: ReactNode;
  /** Close button handler. Also drives Escape + scrim click. */
  onClose: () => void;
  closeLabel?: string;

  // -- Region 2 · Identity ---------------------------------------------------
  /** Sticky identity strip (status, dates, totals). Omit → not rendered. */
  identity?: ReactNode;

  // -- Region 3 · Current Action ---------------------------------------------
  /** Sticky "what do I do next" block. Stays visible no matter how far the
      content scrolls. Omit → not rendered. */
  currentAction?: ReactNode;

  // -- Region 4 · Content ----------------------------------------------------
  /** Everything else — information, items, delivery, payment, history, files. */
  children: ReactNode;

  // -- Region 5 · Footer -----------------------------------------------------
  /** Sticky action bar. Omit → not rendered. */
  footer?: ReactNode;

  // -- Chrome ----------------------------------------------------------------
  width?: DrawerWidth;
  /** Whether scrim click / Escape close the drawer. Set false while a mutation
      is in flight so a stray click can't discard work. Default true. */
  dismissible?: boolean;
  /** Extra class on the panel. Never use it to change the region order. */
  className?: string;
  /** Extra class on the scroll region (padding/layout of the content only). */
  contentClassName?: string;
}

/* Nested drawers must not fight over `body.overflow`, so the lock is
   reference-counted at module scope. */
let scrollLocks = 0;
let restoreOverflow = '';

export const Drawer = ({
  title,
  subtitle,
  eyebrow,
  headerAside,
  onClose,
  closeLabel = 'Close',
  identity,
  currentAction,
  children,
  footer,
  width = 'md',
  dismissible = true,
  className,
  contentClassName,
}: DrawerProps) => {
  const titleId = useId();
  const panelRef = useRef<HTMLElement>(null);

  const requestClose = useCallback(() => {
    if (dismissible) onClose();
  }, [dismissible, onClose]);

  /* Escape closes, same as the scrim. Guarded by `dismissible` so a saving
     drawer stays put. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        requestClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [requestClose]);

  /* Requirement: the content region is the only thing that scrolls. Locking the
     page behind the drawer is the other half of that — without it the wheel
     chains through to the list underneath once the content hits its end. */
  useEffect(() => {
    if (scrollLocks === 0) {
      restoreOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    scrollLocks += 1;
    return () => {
      scrollLocks -= 1;
      if (scrollLocks === 0) document.body.style.overflow = restoreOverflow;
    };
  }, []);

  /* Move focus into the panel so Tab starts inside the drawer, not back on the
     list behind it. */
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  return (
    <div className={styles.scrim} onClick={requestClose} data-drawer-scrim="">
      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className={clsx(styles.panel, styles[`width-${width}`], className)}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ---- Region 1 · Header (sticky) ---- */}
        <header className={styles.header} data-drawer-region="header">
          <div className={styles.headerText}>
            {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
            <h2 id={titleId} className={styles.title}>{title}</h2>
            {subtitle ? <div className={styles.subtitle}>{subtitle}</div> : null}
          </div>
          {headerAside ? <div className={styles.headerAside}>{headerAside}</div> : null}
          <button
            type="button"
            className={styles.close}
            onClick={onClose}
            aria-label={closeLabel}
          >
            {/* Lucide X, inlined so the design-system package keeps a single
                icon dependency surface (stroke 1.75 per the brand spec). */}
            <svg
              width={18}
              height={18}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.75}
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </header>

        {/* ---- Region 2 · Identity (sticky) ---- */}
        {identity ? (
          <div className={styles.identity} data-drawer-region="identity">
            {identity}
          </div>
        ) : null}

        {/* ---- Region 3 · Current Action (sticky) ---- */}
        {currentAction ? (
          <div className={styles.currentAction} data-drawer-region="current-action">
            {currentAction}
          </div>
        ) : null}

        {/* ---- Region 4 · Content (the only scroller) ---- */}
        <div
          className={clsx(styles.content, contentClassName)}
          data-drawer-region="content"
        >
          {children}
        </div>

        {/* ---- Region 5 · Footer (sticky) ---- */}
        {footer ? (
          <footer className={styles.footer} data-drawer-region="footer">
            {footer}
          </footer>
        ) : null}
      </aside>
    </div>
  );
};
