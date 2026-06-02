import { useEffect, useState } from 'react';
import { fetchSlipUrl } from '../lib/slip';
import type { SlipUrlResponse } from '@2990s/shared/schemas';
import styles from './SlipSection.module.css';

export type SlipState = 'none' | 'pending' | 'verified' | 'flagged';

interface Props {
  orderId: string;
  slipKey: string | null;
  /** How to fetch the presigned slip URL for `orderId`. Defaults to the legacy
   *  /orders route; the Sales Order detail page passes fetchSoSlipUrl so the
   *  same viewer works for an SO docNo (P1, migration 0143). */
  fetcher?: (id: string) => Promise<SlipUrlResponse>;
  // Other slip-* props kept on the type for backwards-compat with OrderDrawer's
  // call site, but no longer rendered. Drop after we cleanup the call site.
  slipState?: SlipState;
  slipVerifiedBy?: string | null;
  slipVerifiedAt?: string | null;
  slipFlagReason?: string | null;
  onUpdated?: () => void;
}

export function SlipSection({ orderId, slipKey, fetcher = fetchSlipUrl }: Props) {
  const [slipUrl, setSlipUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string>('image/jpeg');
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!slipKey) return;
    let cancelled = false;
    setLoadError(null);
    setSlipUrl(null);
    (async () => {
      try {
        const r = await fetcher(orderId);
        if (cancelled) return;
        setSlipUrl(r.url);
        setContentType(r.contentType);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load slip');
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, slipKey, fetcher]);

  if (!slipKey) {
    return (
      <section className={styles.root}>
        <h3 className={styles.heading}>Payment slip</h3>
        <p className={styles.empty}>No slip uploaded.</p>
      </section>
    );
  }

  return (
    <section className={styles.root}>
      <h3 className={styles.heading}>Payment slip</h3>
      {loadError && <p className={styles.error}>{loadError}</p>}
      {slipUrl && contentType.startsWith('image/') && (
        <img src={slipUrl} alt="Slip" className={styles.preview} />
      )}
      {slipUrl && contentType === 'application/pdf' && (
        <iframe src={slipUrl} title="Slip PDF" className={styles.previewPdf} />
      )}
    </section>
  );
}
