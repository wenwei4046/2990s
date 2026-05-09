import { useEffect, useState } from 'react';
import { fmtTime } from '@2990s/shared';
import { uploadDoFile, patchOrderDo, getDoSignedUrl } from '../lib/dispatch';
import { useDrivers } from '../lib/queries';
import styles from './DispatchSection.module.css';

const ALLOWED_MIMES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
const MAX_BYTES = 5 * 1024 * 1024;

interface Props {
  orderId: string;
  lane: 'dispatched' | 'delivered';
  driverId: string | null;
  confirmedWith: string | null;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  doKey: string | null;
  onUpdated: () => void;
}

export function DispatchSection({
  orderId, lane, driverId, confirmedWith, dispatchedAt, deliveredAt, doKey, onUpdated,
}: Props) {
  const drivers = useDrivers();
  const driver = drivers.data?.find((d) => d.id === driverId) ?? null;

  const [doUrl, setDoUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  useEffect(() => {
    if (!doKey) {
      setDoUrl(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const url = await getDoSignedUrl(doKey);
        if (!cancelled) setDoUrl(url);
      } catch (err) {
        if (!cancelled) setUploadError(err instanceof Error ? err.message : 'Failed to load DO');
      }
    })();
    return () => { cancelled = true; };
  }, [doKey]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    if (!ALLOWED_MIMES.includes(file.type)) {
      setUploadError('Only JPG / PNG / WebP / PDF supported.');
      return;
    }
    if (file.size > MAX_BYTES) {
      setUploadError('File too large (max 5 MB).');
      return;
    }
    setUploading(true);
    try {
      const path = await uploadDoFile(orderId, file);
      await patchOrderDo(orderId, path);
      onUpdated();
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  };

  return (
    <section className={styles.root}>
      <h3 className={styles.heading}>
        {lane === 'dispatched' ? 'Dispatch & DO sign-off' : 'Delivered'}
      </h3>

      <div className={styles.info}>
        <div><b>Driver</b><span>{driver ? `${driver.name} · ${driver.vehicle ?? driver.phone}` : (driverId ?? '—')}</span></div>
        <div><b>Customer slot</b><span>{confirmedWith ?? '—'}</span></div>
        {dispatchedAt && (
          <div><b>Dispatched at</b><span>{fmtTime(dispatchedAt)}</span></div>
        )}
        {deliveredAt && (
          <div><b>Delivered at</b><span>{fmtTime(deliveredAt)}</span></div>
        )}
      </div>

      {lane === 'dispatched' && (
        <div className={styles.doBlock}>
          <h4 className={styles.subheading}>Delivery Order (DO)</h4>
          {!doKey && (
            <label className={styles.dropZone}>
              <input
                type="file"
                accept={ALLOWED_MIMES.join(',')}
                onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
                style={{ display: 'none' }}
                disabled={uploading}
              />
              <div className={styles.dropContent}>
                {uploading ? 'Uploading…' : 'Click to upload signed DO (image or PDF)'}
              </div>
            </label>
          )}
          {doKey && (
            <div className={styles.uploaded}>
              <div className={styles.uploadedHead}>
                <span className={styles.uploadedName}>✓ DO uploaded</span>
                <button
                  type="button"
                  className={styles.replace}
                  disabled={uploading}
                  onClick={() => {
                    const input = document.createElement('input');
                    input.type = 'file';
                    input.accept = ALLOWED_MIMES.join(',');
                    input.onchange = (e) => handleFile((e.target as HTMLInputElement).files?.[0] ?? null);
                    input.click();
                  }}
                >
                  Replace
                </button>
              </div>
              {doUrl && doKey.endsWith('.pdf') ? (
                <iframe src={doUrl} title="DO" className={styles.preview} />
              ) : doUrl ? (
                <img src={doUrl} alt="DO" className={styles.preview} />
              ) : (
                <div className={styles.muted}>Loading preview…</div>
              )}
            </div>
          )}
          {uploadError && <p className={styles.error}>{uploadError}</p>}
        </div>
      )}

      {lane === 'delivered' && doKey && doUrl && (
        <div className={styles.uploaded}>
          <div className={styles.uploadedHead}>
            <span className={styles.uploadedName}>DO file</span>
            <a className={styles.replace} href={doUrl} target="_blank" rel="noreferrer">Open in new tab</a>
          </div>
          {doKey.endsWith('.pdf') ? (
            <iframe src={doUrl} title="DO" className={styles.preview} />
          ) : (
            <img src={doUrl} alt="DO" className={styles.preview} />
          )}
        </div>
      )}
    </section>
  );
}
