// ----------------------------------------------------------------------------
// AnnouncementBanner — top-of-app strip that surfaces the latest active
// announcement targeted at the current user, with a "Got it" ack button.
// Ported from the Houzs banner; uses the polled /banner endpoint and an
// additive local-ack memo so the dismissal survives reloads + flaky ack POSTs.
//
// Mounted ONCE inside Layout, between the Topbar and the routed <Outlet />.
// Renders nothing when there's no active notice (or when this device has
// already acked the current one).
// ----------------------------------------------------------------------------

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Megaphone, AlertTriangle, ShieldCheck, BookOpen, Check } from 'lucide-react';
import {
  useAnnouncementBanner,
  ackAnnouncement,
  type Announcement,
  type AnnouncementCategory,
} from '../lib/announcements-queries';
import styles from './AnnouncementBanner.module.css';

const LOCAL_ACKS_KEY = 'announcements:localAcks';

function readLocalAcks(): Record<string, number> {
  try {
    const raw = localStorage.getItem(LOCAL_ACKS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, number>;
  } catch {
    return {};
  }
}

function writeLocalAcks(next: Record<string, number>) {
  try { localStorage.setItem(LOCAL_ACKS_KEY, JSON.stringify(next)); } catch { /* non-fatal */ }
}

function isRemindedSince(remindedAt: string | null | undefined, ackedAtMs: number | undefined): boolean {
  if (!remindedAt || !ackedAtMs) return false;
  const r = Date.parse(remindedAt);
  if (Number.isNaN(r)) return false;
  return r > ackedAtMs;
}

const CATEGORY_META: Record<
  AnnouncementCategory,
  { Icon: typeof Megaphone; bandCls: string; iconCls: string }
> = {
  GENERAL:  { Icon: Megaphone,     bandCls: styles.bandGeneral ?? '',  iconCls: styles.iconWellGeneral ?? '' },
  WARNING:  { Icon: AlertTriangle, bandCls: styles.bandWarning ?? '',  iconCls: styles.iconWellWarning ?? '' },
  SOP:      { Icon: ShieldCheck,   bandCls: styles.bandSop ?? '',      iconCls: styles.iconWellSop ?? '' },
  LEARNING: { Icon: BookOpen,      bandCls: styles.bandLearning ?? '', iconCls: styles.iconWellLearning ?? '' },
};

export const AnnouncementBanner = () => {
  const banner = useAnnouncementBanner();
  const [localAcks, setLocalAcks] = useState<Record<string, number>>(() => readLocalAcks());
  const [dismissedThisSession, setDismissedThisSession] = useState<Set<string>>(() => new Set());

  const data: Announcement[] = banner.data?.data ?? [];
  const serverAcked = useMemo(() => new Set(banner.data?.ackedIds ?? []), [banner.data]);

  // Reconcile server ackedIds INTO the local map (additive). NEVER delete a
  // local entry — the server is the lagging side (ack POSTs are
  // fire-and-forget); a flaky one must not cause an endless re-pop loop.
  useEffect(() => {
    if (serverAcked.size === 0) return;
    setLocalAcks((prev) => {
      let changed = false;
      const next = { ...prev };
      const now = Date.now();
      for (const id of serverAcked) {
        if (next[id] == null) { next[id] = now; changed = true; }
      }
      if (changed) writeLocalAcks(next);
      return changed ? next : prev;
    });
  }, [serverAcked]);

  const current = useMemo(() => {
    for (const a of data) {
      if (dismissedThisSession.has(a.id)) continue;
      const localAt = localAcks[a.id];
      if (localAt == null) return a;                            // never acked here
      if (isRemindedSince(a.remindedAt, localAt)) return a;     // re-pop
      // else: already acked — skip
    }
    return null;
  }, [data, dismissedThisSession, localAcks]);

  const ack = useCallback(async (a: Announcement) => {
    const now = Date.now();
    setLocalAcks((prev) => {
      const next = { ...prev, [a.id]: now };
      writeLocalAcks(next);
      return next;
    });
    setDismissedThisSession((prev) => {
      const next = new Set(prev);
      next.add(a.id);
      return next;
    });
    try {
      await ackAnnouncement(a.id);
    } catch {
      // Best-effort: the local stamp keeps the banner dismissed even if the
      // POST didn't land. The next poll will reconcile.
    }
  }, []);

  if (!current) return null;

  const meta = CATEGORY_META[current.category];
  const Icon = meta.Icon;

  return (
    <div className={`${styles.banner} ${meta.bandCls}`} role="status" aria-live="polite">
      <div className={`${styles.iconWell} ${meta.iconCls}`}>
        <Icon size={14} strokeWidth={1.75} />
      </div>
      <div className={styles.body}>
        <p className={styles.title}>{current.title}</p>
        {current.body && <p className={styles.text}>{current.body}</p>}
      </div>
      <button type="button" className={styles.ack} onClick={() => void ack(current)}>
        <Check size={12} strokeWidth={2} />
        Got it
      </button>
    </div>
  );
};
