// ----------------------------------------------------------------------------
// dialog-service — a module-level bridge so NON-React code can raise the same
// in-app dialogs as components. The data layer has callers that live outside the
// React tree and so can't use the useConfirm / useNotify hooks:
//   • authedFetch (lib/authed-fetch.ts) — the 409 short-stock "ship anyway?" gate
//   • TanStack Query onError handlers in lib/*-queries.ts — failure toasts
// Those used naked window.confirm / window.alert. Here they call serviceConfirm /
// serviceNotify, which delegate to the live React dialogs registered by
// <DialogServiceBridge> at app mount. Before mount (or if the bridge is gone),
// we fall back to window.* so a prompt is NEVER silently dropped.
// ----------------------------------------------------------------------------

import type { ConfirmOpts } from '../components/ConfirmDialog';
import type { NotifyOpts } from '../components/NotifyDialog';

type ConfirmFn = (opts: ConfirmOpts) => Promise<boolean>;
type NotifyFn = (opts: NotifyOpts) => Promise<void>;

let liveConfirm: ConfirmFn | null = null;
let liveNotify: NotifyFn | null = null;

/** Called once by <DialogServiceBridge> (inside the providers) at app mount. */
export function registerDialogService(fns: { confirm: ConfirmFn; notify: NotifyFn }): void {
  liveConfirm = fns.confirm;
  liveNotify = fns.notify;
}

/** Flatten an opts pair into the single string the browser fallbacks accept. */
function flatten(title: string, body?: unknown): string {
  return [title, typeof body === 'string' ? body : ''].filter(Boolean).join('\n\n');
}

/** In-app confirm from non-React code. Falls back to window.confirm pre-mount. */
export function serviceConfirm(opts: ConfirmOpts): Promise<boolean> {
  if (liveConfirm) return liveConfirm(opts);
  return Promise.resolve(window.confirm(flatten(opts.title, opts.body)));
}

/** In-app alert from non-React code. Falls back to window.alert pre-mount. */
export function serviceNotify(opts: NotifyOpts): Promise<void> {
  if (liveNotify) return liveNotify(opts);
  window.alert(flatten(opts.title, opts.body));
  return Promise.resolve();
}
