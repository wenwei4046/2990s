import { useEffect, useRef } from 'react';
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
  // Flipped true the instant the user taps Refresh, so the controllerchange
  // listener below can tell *our* requested worker swap apart from the silent
  // clients.claim() that fires on first install (which must NOT reload).
  const userRequestedReload = useRef(false);

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

  // Reload the page ourselves on the worker swap. We can't lean on
  // vite-plugin-pwa's built-in prompt-mode reload: it only fires when its
  // `controlling` event reports `isUpdate === true`, and that flag is just
  // `Boolean(navigator.serviceWorker.controller)` captured at register() time.
  // A desktop tab that first loaded *uncontrolled* — a hard refresh, or the very
  // first visit before clients.claim() took over — keeps isUpdate=false for its
  // whole life, so tapping Refresh skip-waits the new worker but the library
  // swallows the reload and the button looks dead. (The iPad PWA relaunches
  // controlled, so it never hits this.) clients.claim() still fires
  // controllerchange here, so we reload on it — but only when the tap below
  // armed us, never on the first-install claim.
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const onControllerChange = () => {
      if (userRequestedReload.current) window.location.reload();
    };
    sw.addEventListener('controllerchange', onControllerChange);
    return () => sw.removeEventListener('controllerchange', onControllerChange);
  }, []);

  if (!needRefresh) return null;

  const onRefresh = () => {
    userRequestedReload.current = true;
    void updateServiceWorker(true);
    // Safety net: if no waiting worker is left to skip (e.g. another tab already
    // activated the update, so no controllerchange will fire in this tab), force
    // a reload anyway so the tap is never a no-op. The new assets are cached
    // already; the controllerchange path above wins long before this fires on
    // the normal flow.
    setTimeout(() => window.location.reload(), 3000);
  };

  return (
    <div className={styles.banner} role="status" aria-live="polite">
      <RefreshCw size={18} strokeWidth={1.75} className={styles.icon} />
      <span className={styles.text}>A new version is ready.</span>
      <button type="button" className={styles.refresh} onClick={onRefresh}>
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
