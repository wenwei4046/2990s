import { useRegisterSW } from 'virtual:pwa-register/react';
import { RefreshCw, X } from 'lucide-react';
import styles from './UpdatePrompt.module.css';

// Re-check for a new deploy hourly. A showroom tablet often stays open all day
// without a relaunch, so without this poll it would only notice an update on
// the next cold start. registration.update() is cheap (a conditional request
// for the service worker) and only surfaces the toast when something changed.
const UPDATE_CHECK_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Bottom-centre toast that appears when a newer build has been deployed (the
 * service worker registered in 'prompt' mode, see vite.config.ts). Tapping
 * Refresh activates the waiting worker and reloads onto the new version — no
 * swipe-kill / relaunch needed. Dismiss keeps the current version until the
 * next prompt. Mounted once in main.tsx so it survives navigation.
 */
export function UpdatePrompt() {
  const {
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisteredSW(_swUrl, registration) {
      if (registration) {
        setInterval(() => void registration.update(), UPDATE_CHECK_INTERVAL_MS);
      }
    },
  });

  if (!needRefresh) return null;

  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <RefreshCw size={18} strokeWidth={1.75} className={styles.icon} />
      <span className={styles.text}>A new version is ready.</span>
      <button
        type="button"
        className={styles.refresh}
        onClick={() => void updateServiceWorker(true)}
      >
        Refresh
      </button>
      <button
        type="button"
        className={styles.dismiss}
        aria-label="Dismiss"
        onClick={() => setNeedRefresh(false)}
      >
        <X size={16} strokeWidth={1.75} />
      </button>
    </div>
  );
}
