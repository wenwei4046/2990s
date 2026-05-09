import { useEffect, useState } from 'react';
import { uploadSlipFull, type SlipUploadPhase } from '../lib/slip';
import { ALLOWED_SLIP_MIMES, MAX_SLIP_SIZE_BYTES } from '@2990s/shared/schemas';
import styles from './SlipUploadStep.module.css';

type Phase = 'idle' | SlipUploadPhase | 'done' | 'error';

interface Props {
  onConfirmed: (uploadSessionId: string) => void;
  onCleared: () => void;
}

export function SlipUploadStep({ onConfirmed, onCleared }: Props) {
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Revoke object URL on unmount or when previewUrl changes.
  useEffect(() => {
    if (!previewUrl) return;
    return () => URL.revokeObjectURL(previewUrl);
  }, [previewUrl]);

  const reset = () => {
    setFile(null);
    setPreviewUrl(null);
    setPhase('idle');
    setErrorMsg(null);
    onCleared();
  };

  const handleFile = async (f: File | null) => {
    if (!f) {
      reset();
      return;
    }

    if (!ALLOWED_SLIP_MIMES.includes(f.type as any)) {
      setErrorMsg('Only JPG / PNG / WebP / PDF supported.');
      setPhase('error');
      return;
    }
    if (f.size > MAX_SLIP_SIZE_BYTES) {
      setErrorMsg('File too large (max 5 MB).');
      setPhase('error');
      return;
    }

    setFile(f);
    setErrorMsg(null);
    if (f.type.startsWith('image/')) {
      setPreviewUrl(URL.createObjectURL(f));
    } else {
      setPreviewUrl(null);
    }

    try {
      const result = await uploadSlipFull({
        file: f,
        onProgress: (p) => setPhase(p),
      });
      setPhase('done');
      onConfirmed(result.uploadSessionId);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Upload failed.');
      setPhase('error');
      onCleared();
    }
  };

  return (
    <div className={styles.root}>
      <label className={styles.label}>
        Payment slip <span className={styles.required}>required for transfer</span>
      </label>

      {phase === 'idle' && !file && (
        <input
          type="file"
          className={styles.input}
          accept={ALLOWED_SLIP_MIMES.join(',')}
          onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
        />
      )}

      {previewUrl && (
        <img src={previewUrl} alt="Slip preview" className={styles.preview} />
      )}

      {phase === 'init' && <div className={styles.status}>Preparing upload...</div>}
      {phase === 'put' && <div className={styles.status}>Uploading slip...</div>}
      {phase === 'confirm' && <div className={styles.status}>Verifying...</div>}

      {phase === 'done' && (
        <div className={styles.statusDone}>
          <span aria-hidden>✓</span> Slip uploaded · {file?.name}
          <button type="button" className={styles.replace} onClick={reset}>Replace</button>
        </div>
      )}

      {phase === 'error' && (
        <div className={styles.statusError}>
          <div>{errorMsg}</div>
          <button type="button" className={styles.replace} onClick={reset}>Try again</button>
        </div>
      )}
    </div>
  );
}
