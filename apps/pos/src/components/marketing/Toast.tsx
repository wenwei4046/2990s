import { useCallback, useEffect, useRef, useState } from 'react';
import s from './marketing.module.css';

/** The design's toast: one line, bottom centre, gone after 3.2 s. */
export function useToast() {
  const [toast, setToast] = useState('');
  const timer = useRef<number | undefined>(undefined);
  const show = useCallback((text: string) => {
    setToast(text);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(''), 3200);
  }, []);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  return { toast, show };
}

export const Toast = ({ message }: { message: string }) =>
  message ? <div className={s.toast} role="status">{message}</div> : null;
