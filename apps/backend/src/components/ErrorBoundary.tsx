import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react';
import { Link, useRouteError, isRouteErrorResponse } from 'react-router';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import styles from './ErrorBoundary.module.css';
import { isStaleChunkError, tryRecoverStaleChunk } from '../lib/use-version-check';

// ---------------------------------------------------------------------------
// Class component — catches render errors anywhere in its subtree. Pair with
// the router-level <ErrorBoundaryRoot> for loader/transition errors which
// class boundaries can't see.
// ---------------------------------------------------------------------------

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  /** A1 — a deploy swapped chunk files out; we're hard-reloading to self-heal. */
  recovering: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null, recovering: false };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  override componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // A1 — if a lazy route's JS chunk 404'd because a new build deployed while
    // this tab was open, self-heal with a reload instead of showing a crash.
    if (tryRecoverStaleChunk(error)) {
      this.setState({ recovering: true });
      return;
    }
    this.setState({ errorInfo });
    // In production wire to Sentry here.
    // eslint-disable-next-line no-console
    console.error('[ErrorBoundary] caught:', error, errorInfo);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  override render() {
    if (this.state.recovering) return <UpdatingScreen />;
    if (this.state.hasError) {
      if (this.props.fallback) return this.props.fallback;
      return (
        <ErrorFallback
          error={this.state.error}
          errorInfo={this.state.errorInfo}
          onReset={this.handleReset}
        />
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// Router-level error element. Renders inside the router context so it can use
// useRouteError(). React Router calls this when a loader throws or when a
// child route segment fails to render before mounting. Wire it via the route
// config's `errorElement` (see router.tsx).
// ---------------------------------------------------------------------------

export const ErrorBoundaryRoot = () => {
  const err = useRouteError();
  let error: Error | null = null;
  if (err instanceof Error) {
    error = err;
  } else if (isRouteErrorResponse(err)) {
    error = new Error(`${err.status} ${err.statusText}${err.data ? ` — ${String(err.data)}` : ''}`);
  } else if (err) {
    error = new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  // A1 — a lazy route loader that failed because its chunk vanished on a new
  // deploy surfaces here; self-heal with a reload instead of the crash card.
  const stale = isStaleChunkError(err) || isStaleChunkError(error);
  useEffect(() => { if (stale) tryRecoverStaleChunk(err ?? error); }, [stale]); // eslint-disable-line react-hooks/exhaustive-deps
  if (stale) return <UpdatingScreen />;
  // Router boundary has no per-component "reset" — going Home is the way out.
  return <ErrorFallback error={error} errorInfo={null} onReset={undefined} />;
};

// Neutral "we're reloading to the new version" screen — shown instead of the
// scary error card while a stale-chunk recovery reload is in flight.
const UpdatingScreen = () => (
  <div className={styles.wrap}>
    <div className={styles.card}>
      <div className={styles.iconRow}>
        <div className={styles.iconChip}>
          <RefreshCw size={32} strokeWidth={1.75} />
        </div>
      </div>
      <div className={styles.heading}>
        <h1 className={styles.title}>Updating…</h1>
        <p className={styles.message}>
          Getting the latest version. This page will refresh in a moment.
        </p>
      </div>
    </div>
  </div>
);

// ---------------------------------------------------------------------------
// Shared fallback UI
// ---------------------------------------------------------------------------

interface ErrorFallbackProps {
  error: Error | null;
  errorInfo?: ErrorInfo | null;
  onReset?: () => void;
}

export const ErrorFallback = ({ error, errorInfo, onReset }: ErrorFallbackProps) => {
  const isDev = import.meta.env?.DEV ?? false;
  // Operators must never see raw code/crash text (Wei Siang 2026-06-08). In
  // production always show a single plain sentence; in dev show the real error
  // message so developers can still diagnose.
  const msg = isDev
    ? (error?.message ?? 'An unexpected error occurred.')
    : 'Something went wrong on this page. Please go back and try again — if it keeps happening, let IT know.';

  return (
    <div className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.iconRow}>
          <div className={styles.iconChip}>
            <AlertTriangle size={32} strokeWidth={1.75} />
          </div>
        </div>

        <div className={styles.heading}>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.message}>{msg}</p>
        </div>

        <div className={styles.actions}>
          {onReset && (
            <button type="button" onClick={onReset} className={`${styles.btn} ${styles.btnPrimary}`}>
              <RefreshCw size={16} strokeWidth={1.75} />
              <span>Try Again</span>
            </button>
          )}
          <Link to="/dashboard" className={`${styles.btn} ${styles.btnSecondary}`}>
            <Home size={16} strokeWidth={1.75} />
            <span>Go Home</span>
          </Link>
        </div>

        {isDev && error && (
          <details className={styles.details}>
            <summary>Stack trace (dev only)</summary>
            <div className={styles.detailsBody}>
              <div>
                <p className={styles.label}>Message</p>
                <pre className={styles.errMsg}>{error.message}</pre>
              </div>
              {error.stack && (
                <div>
                  <p className={styles.label}>Stack</p>
                  <pre className={styles.stack}>{error.stack}</pre>
                </div>
              )}
              {errorInfo?.componentStack && (
                <div>
                  <p className={styles.label}>Component stack</p>
                  <pre className={styles.stack}>{errorInfo.componentStack}</pre>
                </div>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
};
