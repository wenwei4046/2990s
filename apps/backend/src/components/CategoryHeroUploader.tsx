import { useRef, useState } from 'react';
import { Upload, Trash2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import styles from './CategoryHeroUploader.module.css';

const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const R2_PUBLIC = import.meta.env.VITE_R2_PUBLIC_URL as string | undefined;

async function getToken(): Promise<string> {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error('not_authenticated');
  return token;
}

export const CategoryHeroUploader = ({
  categoryId,
  currentKey,
  onChange,
}: {
  categoryId: string;
  currentKey: string | null;
  onChange: (newKey: string | null) => void;
}) => {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const fetchAdmin = async (path: string, init: RequestInit) => {
    if (!API_URL) throw new Error('VITE_API_URL is not set');
    const token = await getToken();
    return fetch(`${API_URL}${path}`, {
      ...init,
      headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}` },
    });
  };

  const upload = async (file: File) => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchAdmin(`/admin/categories/${categoryId}/hero-image`, {
        method: 'POST',
        headers: { 'content-type': file.type },
        body: file,
      });
      const body = (await res.json().catch(() => ({}))) as { ok?: boolean; key?: string; error?: string };
      if (!res.ok || !body.key) throw new Error(body.error ?? 'upload_failed');
      onChange(body.key);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'upload_failed');
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setErr(null);
    try {
      const res = await fetchAdmin(`/admin/categories/${categoryId}/hero-image`, { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? 'delete_failed');
      }
      onChange(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'delete_failed');
    } finally {
      setBusy(false);
    }
  };

  const previewUrl = currentKey && R2_PUBLIC ? `${R2_PUBLIC}/${currentKey}` : null;

  return (
    <div className={styles.uploader}>
      {previewUrl ? (
        <div
          className={styles.preview}
          style={{ backgroundImage: `url(${previewUrl})` }}
          aria-label="Hero preview"
        />
      ) : (
        <div className={`${styles.preview} ${styles.previewEmpty}`}>
          {currentKey ? 'Image set (VITE_R2_PUBLIC_URL missing)' : 'No image'}
        </div>
      )}
      <div className={styles.actions}>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}>
          <Upload size={14} strokeWidth={1.75} /> Upload
        </button>
        {currentKey && (
          <button type="button" disabled={busy} onClick={remove} className={styles.removeBtn}>
            <Trash2 size={14} strokeWidth={1.75} /> Remove
          </button>
        )}
      </div>
      {err && <div className={styles.err}>{err}</div>}
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void upload(f);
          // Reset so re-uploading the same file fires onChange again.
          e.target.value = '';
        }}
      />
    </div>
  );
};
