import { useEffect, useState } from 'react';
import { fetchSlipUrl, verifySlip, flagSlip } from '../lib/slip';
import styles from './SlipSection.module.css';

export type SlipState = 'none' | 'pending' | 'verified' | 'flagged';

interface Props {
  orderId: string;
  slipKey: string | null;
  slipState: SlipState;
  slipVerifiedBy: string | null;
  slipVerifiedAt: string | null;
  slipFlagReason: string | null;
  onUpdated: () => void;
}

export function SlipSection({
  orderId, slipKey, slipState, slipVerifiedBy, slipVerifiedAt, slipFlagReason, onUpdated,
}: Props) {
  const [slipUrl, setSlipUrl] = useState<string | null>(null);
  const [contentType, setContentType] = useState<string>('image/jpeg');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showFlagForm, setShowFlagForm] = useState(false);
  const [flagReason, setFlagReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!slipKey) return;
    let cancelled = false;
    setLoadError(null);
    setSlipUrl(null);
    (async () => {
      try {
        const r = await fetchSlipUrl(orderId);
        if (cancelled) return;
        setSlipUrl(r.url);
        setContentType(r.contentType);
      } catch (err) {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : 'Failed to load slip');
      }
    })();
    return () => { cancelled = true; };
  }, [orderId, slipKey]);

  if (!slipKey) {
    return (
      <section className={styles.root}>
        <h3 className={styles.heading}>Payment slip</h3>
        <p className={styles.empty}>No slip (card payment).</p>
      </section>
    );
  }

  // R2 down → disable verify (per spec §7.5)
  const verifyDisabled = !slipUrl || submitting;

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

      {slipState === 'pending' && !showFlagForm && (
        <div className={styles.actions}>
          <button
            type="button"
            disabled={verifyDisabled}
            className={styles.verify}
            onClick={async () => {
              setSubmitting(true);
              try { await verifySlip(orderId); onUpdated(); }
              catch (err) { setLoadError(err instanceof Error ? err.message : 'Verify failed'); }
              finally { setSubmitting(false); }
            }}
          >
            Verify
          </button>
          <button
            type="button"
            disabled={verifyDisabled}
            className={styles.flag}
            onClick={() => setShowFlagForm(true)}
          >
            Flag
          </button>
        </div>
      )}

      {showFlagForm && (
        <div className={styles.flagForm}>
          <textarea
            value={flagReason}
            onChange={(e) => setFlagReason(e.target.value)}
            placeholder="Reason for flagging (required)"
            rows={3}
            maxLength={500}
            className={styles.flagInput}
          />
          <div className={styles.flagButtons}>
            <button
              type="button"
              disabled={!flagReason.trim() || submitting}
              className={styles.flag}
              onClick={async () => {
                setSubmitting(true);
                try {
                  await flagSlip(orderId, flagReason.trim());
                  setShowFlagForm(false);
                  setFlagReason('');
                  onUpdated();
                } catch (err) {
                  setLoadError(err instanceof Error ? err.message : 'Flag failed');
                } finally {
                  setSubmitting(false);
                }
              }}
            >
              Confirm flag
            </button>
            <button type="button" onClick={() => { setShowFlagForm(false); setFlagReason(''); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {slipState === 'verified' && (
        <div className={styles.statusVerified}>
          ✓ Verified by {slipVerifiedBy ?? 'unknown'}
          {slipVerifiedAt ? ' · ' + new Date(slipVerifiedAt).toLocaleString() : ''}
        </div>
      )}

      {slipState === 'flagged' && (
        <div className={styles.statusFlagged}>
          ⚠ Flagged · {slipFlagReason}
        </div>
      )}
    </section>
  );
}
