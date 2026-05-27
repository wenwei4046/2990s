import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';
import styles from './Toast.module.css';

// ---------------------------------------------------------------------------
// Variant API ported from HOOKKA. The existing 2990s API was `toast(msg)`
// (a bare function returned from useToast()). To stay backward-compatible
// we return a *callable* whose direct call defaults to the info variant —
// `toast('hi')` still works — and which also exposes `.success/.error/...`
// methods. Bundle impact: ~3 KB gz including lucide icons.
// ---------------------------------------------------------------------------

export type ToastVariant = 'success' | 'error' | 'warning' | 'info';

export interface ToastOptions {
  /** Auto-dismiss in ms. Default 5000. */
  duration?: number;
}

interface ToastItem {
  id: string;
  variant: ToastVariant;
  message: string;
  duration: number;
}

type PushFn = (message: string, opts?: ToastOptions) => void;

/**
 * Callable + namespaced. `toast('msg')` works (info), and so does
 * `toast.success('msg')`, `.error`, `.warning`, `.info`, `.push`.
 */
export interface ToastApi extends PushFn {
  success: PushFn;
  error: PushFn;
  warning: PushFn;
  info: PushFn;
  /** @deprecated Use one of the variant methods. Aliases to info. */
  push: PushFn;
}

interface ToastCtx {
  api: ToastApi;
}

const Ctx = createContext<ToastCtx | null>(null);

const MAX_TOASTS = 5;
const DEFAULT_DURATION = 5000;

const ICONS: Record<ToastVariant, ReactNode> = {
  success: <CheckCircle2 size={18} strokeWidth={1.75} />,
  error: <XCircle size={18} strokeWidth={1.75} />,
  warning: <AlertTriangle size={18} strokeWidth={1.75} />,
  info: <Info size={18} strokeWidth={1.75} />,
};

const variantClass = (v: ToastVariant): string => {
  switch (v) {
    case 'success': return styles.success ?? '';
    case 'error':   return styles.error ?? '';
    case 'warning': return styles.warning ?? '';
    case 'info':    return styles.info ?? '';
  }
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const dismiss = useCallback((id: string) => {
    setToasts((cur) => cur.filter((t) => t.id !== id));
  }, []);

  const add = useCallback((variant: ToastVariant, message: string, opts?: ToastOptions) => {
    const id = `t-${++seq.current}`;
    const duration = opts?.duration ?? DEFAULT_DURATION;
    setToasts((cur) => {
      const next = [...cur, { id, variant, message, duration }];
      // Drop oldest when over cap.
      return next.length > MAX_TOASTS ? next.slice(next.length - MAX_TOASTS) : next;
    });
  }, []);

  // Stable callable: function + variant methods. Memoised so consumers can
  // safely put `toast` in effect deps without churning.
  const api = useMemo<ToastApi>(() => {
    const fn = ((message: string, opts?: ToastOptions) => add('info', message, opts)) as ToastApi;
    fn.success = (m, o) => add('success', m, o);
    fn.error = (m, o) => add('error', m, o);
    fn.warning = (m, o) => add('warning', m, o);
    fn.info = (m, o) => add('info', m, o);
    fn.push = (m, o) => add('info', m, o);
    return fn;
  }, [add]);

  return (
    <Ctx.Provider value={{ api }}>
      {children}
      <div className={styles.tray} aria-label="Notifications">
        {toasts.map((t) => (
          <ToastBubble key={t.id} item={t} onDismiss={dismiss} />
        ))}
      </div>
    </Ctx.Provider>
  );
};

interface BubbleProps {
  item: ToastItem;
  onDismiss: (id: string) => void;
}

const ToastBubble = ({ item, onDismiss }: BubbleProps) => {
  const [progress, setProgress] = useState(100);

  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const remaining = Math.max(0, 100 - (elapsed / item.duration) * 100);
      setProgress(remaining);
      if (remaining <= 0) onDismiss(item.id);
    }, 60);
    return () => clearInterval(tick);
  }, [item.duration, item.id, onDismiss]);

  const isError = item.variant === 'error';

  return (
    <div
      className={`${styles.toast} ${variantClass(item.variant)}`}
      role="alert"
      aria-live={isError ? 'assertive' : 'polite'}
    >
      <span className={styles.icon}>{ICONS[item.variant]}</span>
      <span className={styles.message}>{item.message}</span>
      <button
        type="button"
        className={styles.close}
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss notification"
      >
        <X size={14} strokeWidth={2} />
      </button>
      <span className={styles.progress} style={{ width: `${progress}%` }} />
    </div>
  );
};

/**
 * Returns a callable that doubles as a variant namespace.
 *
 *   const toast = useToast();
 *   toast('hello');           // info (legacy API)
 *   toast.success('saved');
 *   toast.error('failed');
 *   toast.warning('careful');
 */
export const useToast = (): ToastApi => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx.api;
};
