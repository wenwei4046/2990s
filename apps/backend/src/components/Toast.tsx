import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import styles from './Toast.module.css';

interface ToastItem {
  id: string;
  message: string;
}

interface ToastCtx {
  push: (message: string) => void;
}

const Ctx = createContext<ToastCtx | null>(null);

export const ToastProvider = ({ children }: { children: ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const seq = useRef(0);

  const push = useCallback((message: string) => {
    const id = `t-${++seq.current}`;
    setToasts((cur) => [...cur, { id, message }]);
  }, []);

  // Auto-dismiss the head after 4s
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts((cur) => cur.slice(1)), 4000);
    return () => clearTimeout(t);
  }, [toasts]);

  return (
    <Ctx.Provider value={{ push }}>
      {children}
      <div className={styles.tray} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={styles.toast}>{t.message}</div>
        ))}
      </div>
    </Ctx.Provider>
  );
};

export const useToast = (): ((message: string) => void) => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useToast must be used inside ToastProvider');
  return ctx.push;
};
