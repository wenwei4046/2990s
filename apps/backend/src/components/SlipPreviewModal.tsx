import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import { fetchSlipUrl } from '../lib/slip';
import styles from './SlipPreviewModal.module.css';

interface Props {
  orderId: string;
  slipKey: string;
  onClose: () => void;
}

export function SlipPreviewModal({ orderId, slipKey, onClose }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string>('image/jpeg');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await fetchSlipUrl(orderId);
        if (cancelled) return;
        setUrl(r.url);
        setContentType(r.contentType);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load slip');
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, slipKey]);

  useEffect(() => {
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onEsc);
    return () => window.removeEventListener('keydown', onEsc);
  }, [onClose]);

  return (
    <div className={styles.backdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.header}>
          <h3 className={styles.title}>Payment slip — {orderId}</h3>
          <button type="button" onClick={onClose} className={styles.closeBtn} aria-label="Close">
            <X size={20} strokeWidth={1.75} />
          </button>
        </header>
        <div className={styles.body}>
          {error && <p className={styles.error}>{error}</p>}
          {!error && !url && <p className={styles.loading}>Loading slip…</p>}
          {url && contentType.startsWith('image/') && (
            <img src={url} alt={`Slip for ${orderId}`} className={styles.image} />
          )}
          {url && contentType === 'application/pdf' && (
            <iframe src={url} title={`Slip PDF ${orderId}`} className={styles.pdf} />
          )}
        </div>
      </div>
    </div>
  );
}
