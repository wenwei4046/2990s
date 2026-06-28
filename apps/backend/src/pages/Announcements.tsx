// ----------------------------------------------------------------------------
// /announcements — office page: composer at top, posted list below. Mirrors
// the Hookka office page (admin posts → every authed user sees a banner with
// "Got it"). Targeting model adapted for 2990: ALL | ROLES | SHOWROOMS | STAFF.
//
// Patterns:
//   • Composer is a card (no modal). Submit → POST /announcements → reset →
//     refetch list → flash.
//   • List uses lightweight cards (NOT the heavy DataGrid) — count is tiny and
//     each row owns its own collapse + read-receipt panel.
//   • All destructive / re-pop actions go through useConfirm + useNotify.
//     Toasts (via useToast) for the green-success flashes.
//   • CSS Modules + design tokens (var(--c-…)). No Tailwind / no inline-style
//     overrides except the small flash.
// ----------------------------------------------------------------------------

import { useMemo, useRef, useState } from 'react';
import {
  Megaphone,
  AlertTriangle,
  ShieldCheck,
  BookOpen,
  Globe2,
  Users,
  ChevronDown,
  ChevronUp,
  Paperclip,
  X,
  CheckCircle2,
  Trash2,
  EyeOff,
  Eye,
  Send,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useToast } from '../components/Toast';
import { useConfirm } from '../components/ConfirmDialog';
import { useShowrooms, useStaff, type ShowroomRow, type StaffRow } from '../lib/admin-queries';
import {
  useAnnouncements,
  useCreateAnnouncement,
  usePatchAnnouncement,
  useDeleteAnnouncement,
  useAnnouncementAcks,
  useRemindAnnouncement,
  uploadAnnouncementAttachment,
  type Announcement,
  type AnnouncementAttachment,
  type AnnouncementCategory,
} from '../lib/announcements-queries';
import type { StaffRole } from '../lib/auth';
import styles from './Announcements.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

// Roles that may receive announcements. Mirrors the Backend-portal roles from
// auth.tsx (the POS-only roles can still be targeted because every authed
// staff member with a /banner request will be matched against this list,
// regardless of which portal they're using).
const TARGETABLE_ROLES: ReadonlyArray<{ value: StaffRole; label: string }> = [
  { value: 'admin', label: 'Admin' },
  { value: 'super_admin', label: 'Super Admin' },
  { value: 'coordinator', label: 'Coordinator' },
  { value: 'finance', label: 'Finance' },
  { value: 'showroom_lead', label: 'Showroom Lead' },
  { value: 'sales_director', label: 'Sales Director' },
  { value: 'outlet_manager', label: 'Outlet Manager' },
  { value: 'sales_executive', label: 'Sales Executive' },
  { value: 'sales', label: 'Sales' },
  { value: 'master_account', label: 'Master Account' },
];

type CategoryMeta = {
  label: string;
  icon: typeof Megaphone;
  cls: string;
};

const CATEGORY_META: Record<AnnouncementCategory, CategoryMeta> = {
  GENERAL:  { label: 'General Memo', icon: Megaphone,     cls: styles.catGeneral ?? '' },
  WARNING:  { label: 'Warning',      icon: AlertTriangle, cls: styles.catWarning ?? '' },
  SOP:      { label: 'SOP',          icon: ShieldCheck,   cls: styles.catSop ?? '' },
  LEARNING: { label: 'Learning',     icon: BookOpen,      cls: styles.catLearning ?? '' },
};

const CATEGORY_ORDER: AnnouncementCategory[] = ['GENERAL', 'WARNING', 'SOP', 'LEARNING'];

type RecipientKind = 'ALL' | 'ROLES' | 'SHOWROOMS' | 'STAFF';

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return false;
  return t <= Date.now();
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-MY', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ----------------------------------------------------------------------------

export const Announcements = () => {
  const list = useAnnouncements();
  const toast = useToast();
  const confirm = useConfirm();

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Announcements</h1>
          <p className={styles.subtitle}>
            Post office-wide notices. Every staff member sees a banner until they tap Got It.
          </p>
        </div>
      </div>

      <Composer />

      <div className={styles.section}>
        <h2 className={styles.sectionTitle}>
          <Megaphone size={16} strokeWidth={1.75} />
          Posted announcements ({list.data?.length ?? 0})
        </h2>
        {list.isLoading ? (
          <p className={styles.subtitle}>Loading…</p>
        ) : (list.data ?? []).length === 0 ? (
          <p className={styles.subtitle}>Nothing posted yet — the first announcement will appear here.</p>
        ) : (
          (list.data ?? []).map((a) => (
            <Row key={a.id} a={a} onFlash={(m) => toast.success(m)} confirm={confirm} />
          ))
        )}
      </div>
    </div>
  );
};

// ----------------------------------------------------------------------------
// Composer (top card)
// ----------------------------------------------------------------------------

function Composer() {
  const create = useCreateAnnouncement();
  const showrooms = useShowrooms();
  const staffQuery = useStaff();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [category, setCategory] = useState<AnnouncementCategory>('GENERAL');
  const [recipientKind, setRecipientKind] = useState<RecipientKind>('ALL');
  const [selectedRoles, setSelectedRoles] = useState<Set<StaffRole>>(new Set());
  const [selectedShowrooms, setSelectedShowrooms] = useState<Set<string>>(new Set());
  const [selectedStaff, setSelectedStaff] = useState<Set<string>>(new Set());
  const [staffSearch, setStaffSearch] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [attachments, setAttachments] = useState<AnnouncementAttachment[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const activeStaff = useMemo(
    () => (staffQuery.data ?? []).filter((s: StaffRow) => s.active),
    [staffQuery.data],
  );
  const filteredStaff = useMemo(() => {
    const q = staffSearch.trim().toLowerCase();
    if (!q) return activeStaff;
    return activeStaff.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        s.staffCode.toLowerCase().includes(q),
    );
  }, [activeStaff, staffSearch]);

  const resetForm = () => {
    setTitle('');
    setBody('');
    setCategory('GENERAL');
    setRecipientKind('ALL');
    setSelectedRoles(new Set());
    setSelectedShowrooms(new Set());
    setSelectedStaff(new Set());
    setStaffSearch('');
    setExpiresAt('');
    setAttachments([]);
    setError(null);
  };

  const switchKind = (k: RecipientKind) => {
    setRecipientKind(k);
    if (k === 'ALL') {
      setSelectedRoles(new Set());
      setSelectedShowrooms(new Set());
      setSelectedStaff(new Set());
    } else if (k === 'ROLES') {
      setSelectedShowrooms(new Set());
      setSelectedStaff(new Set());
    } else if (k === 'SHOWROOMS') {
      setSelectedRoles(new Set());
      setSelectedStaff(new Set());
    } else {
      setSelectedRoles(new Set());
      setSelectedShowrooms(new Set());
    }
  };

  const onPickFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setError(null);
    setUploading(true);
    try {
      const next: AnnouncementAttachment[] = [];
      for (const f of Array.from(files)) {
        const att = await uploadAnnouncementAttachment(f);
        next.push(att);
      }
      setAttachments((prev) => [...prev, ...next]);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const onSubmit = async () => {
    setError(null);
    const t = title.trim();
    if (!t) {
      setError('Title is required.');
      return;
    }
    if (t.length > 200) {
      setError('Title is too long (max 200 characters).');
      return;
    }
    let expiresIso: string | null = null;
    if (expiresAt.trim()) {
      const parsed = Date.parse(expiresAt);
      if (Number.isNaN(parsed)) {
        setError('Invalid expiry date.');
        return;
      }
      expiresIso = new Date(parsed).toISOString();
    }
    try {
      await create.mutateAsync({
        title: t,
        body: body.trim(),
        category,
        expiresAt: expiresIso,
        attachments,
        targetRoles: recipientKind === 'ROLES' ? Array.from(selectedRoles) : [],
        targetShowroomIds: recipientKind === 'SHOWROOMS' ? Array.from(selectedShowrooms) : [],
        targetStaffIds: recipientKind === 'STAFF' ? Array.from(selectedStaff) : [],
      });
      resetForm();
      toast.success('Announcement posted');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Post failed');
    }
  };

  return (
    <div className={styles.card}>
      <div className={styles.cardHeader}>
        <Send size={14} strokeWidth={1.75} />
        New announcement
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="ann-title">Title</label>
        <input
          id="ann-title"
          className={styles.input}
          maxLength={200}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="e.g. New SOP for sofa packing"
        />
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="ann-body">Message</label>
        <textarea
          id="ann-body"
          className={styles.textarea}
          rows={6}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Details, instructions, links…"
        />
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Category</span>
        <div className={styles.segmented}>
          {CATEGORY_ORDER.map((cat) => {
            const meta = CATEGORY_META[cat];
            const Icon = meta.icon;
            const active = category === cat;
            return (
              <button
                key={cat}
                type="button"
                className={`${styles.segmentBtn} ${active ? styles.segmentBtnActive : ''}`}
                onClick={() => setCategory(cat)}
              >
                <Icon size={12} strokeWidth={1.75} />
                {meta.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Recipients</span>
        <div className={styles.segmented}>
          {(['ALL', 'ROLES', 'SHOWROOMS', 'STAFF'] as RecipientKind[]).map((kind) => {
            const label = kind === 'ALL'
              ? 'All staff'
              : kind === 'ROLES'
                ? 'By role'
                : kind === 'SHOWROOMS'
                  ? 'By showroom'
                  : 'Specific people';
            const active = recipientKind === kind;
            return (
              <button
                key={kind}
                type="button"
                className={`${styles.segmentBtn} ${active ? styles.segmentBtnActive : ''}`}
                onClick={() => switchKind(kind)}
              >
                {label}
              </button>
            );
          })}
        </div>

        {recipientKind === 'ROLES' && (
          <div className={styles.audiencePanel}>
            <div className={styles.audienceList}>
              {TARGETABLE_ROLES.map((r) => {
                const active = selectedRoles.has(r.value);
                return (
                  <button
                    key={r.value}
                    type="button"
                    className={`${styles.audienceChip} ${active ? styles.audienceChipActive : ''}`}
                    onClick={() =>
                      setSelectedRoles((prev) => {
                        const next = new Set(prev);
                        if (next.has(r.value)) next.delete(r.value);
                        else next.add(r.value);
                        return next;
                      })
                    }
                  >
                    {r.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {recipientKind === 'SHOWROOMS' && (
          <div className={styles.audiencePanel}>
            <div className={styles.audienceList}>
              {(showrooms.data ?? []).filter((s: ShowroomRow) => s.active).map((s) => {
                const active = selectedShowrooms.has(s.id);
                return (
                  <button
                    key={s.id}
                    type="button"
                    className={`${styles.audienceChip} ${active ? styles.audienceChipActive : ''}`}
                    onClick={() =>
                      setSelectedShowrooms((prev) => {
                        const next = new Set(prev);
                        if (next.has(s.id)) next.delete(s.id);
                        else next.add(s.id);
                        return next;
                      })
                    }
                  >
                    {s.name}
                  </button>
                );
              })}
              {(showrooms.data ?? []).length === 0 && (
                <p className={styles.subtitle}>No showrooms configured.</p>
              )}
            </div>
          </div>
        )}

        {recipientKind === 'STAFF' && (
          <div className={styles.audiencePanel}>
            <input
              type="text"
              className={styles.input}
              placeholder="Search by name or code…"
              value={staffSearch}
              onChange={(e) => setStaffSearch(e.target.value)}
            />
            <div className={styles.staffList}>
              {filteredStaff.length === 0 ? (
                <p className={styles.subtitle}>No matches.</p>
              ) : (
                filteredStaff.map((s) => (
                  <label key={s.id} className={styles.staffRow}>
                    <input
                      type="checkbox"
                      checked={selectedStaff.has(s.id)}
                      onChange={() =>
                        setSelectedStaff((prev) => {
                          const next = new Set(prev);
                          if (next.has(s.id)) next.delete(s.id);
                          else next.add(s.id);
                          return next;
                        })
                      }
                    />
                    <span>{s.name}</span>
                    <span style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-11)' }}>
                      {s.staffCode}
                    </span>
                  </label>
                ))
              )}
            </div>
            <p className={styles.subtitle}>{selectedStaff.size} selected</p>
          </div>
        )}
      </div>

      <div className={styles.field}>
        <span className={styles.label}>Attachments</span>
        <div className={styles.attachRow}>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*,application/pdf"
            multiple
            style={{ display: 'none' }}
            onChange={(e) => void onPickFiles(e.target.files)}
          />
          <div>
            <Button
              variant="ghost"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              <Paperclip {...ICON} />
              {uploading ? 'Uploading…' : 'Attach files'}
            </Button>
          </div>
          {attachments.length > 0 && (
            <div className={styles.attachChips}>
              {attachments.map((a, i) => (
                <span key={a.r2Key} className={styles.attachChip}>
                  {a.name || a.r2Key.split('/').pop()}
                  <button
                    type="button"
                    className={styles.attachChipRemove}
                    onClick={() => removeAttachment(i)}
                    aria-label="Remove attachment"
                  >
                    <X size={12} strokeWidth={1.75} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className={styles.field}>
        <label className={styles.label} htmlFor="ann-exp">Hide automatically after (optional)</label>
        <input
          id="ann-exp"
          type="datetime-local"
          className={styles.dateInput}
          value={expiresAt}
          onChange={(e) => setExpiresAt(e.target.value)}
        />
      </div>

      <div className={styles.actionsRow}>
        <Button onClick={() => void onSubmit()} disabled={create.isPending}>
          {create.isPending ? 'Posting…' : 'Post announcement'}
        </Button>
        {error && <span className={styles.error}>{error}</span>}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// One posted-row card
// ----------------------------------------------------------------------------

type ConfirmFn = ReturnType<typeof useConfirm>;

function Row({
  a, onFlash, confirm,
}: { a: Announcement; onFlash: (m: string) => void; confirm: ConfirmFn }) {
  const patch = usePatchAnnouncement();
  const del = useDeleteAnnouncement();
  const showrooms = useShowrooms();
  const staffQuery = useStaff();
  const [showReceipt, setShowReceipt] = useState(false);

  const meta = CATEGORY_META[a.category];
  const Icon = meta.icon;
  const expired = isExpired(a.expiresAt);
  const statusPill = !a.isActive
    ? { cls: styles.statusInactive, label: 'Hidden' }
    : expired
      ? { cls: styles.statusExpired, label: 'Expired' }
      : { cls: styles.statusLive, label: 'Live' };

  const audienceText = (() => {
    switch (a.targetType) {
      case 'ALL':
        return { icon: <Globe2 {...ICON} />, text: 'All staff' };
      case 'ROLES': {
        const labels = a.targetRoles.map(
          (r) => TARGETABLE_ROLES.find((tr) => tr.value === r)?.label ?? r,
        );
        return { icon: <Users {...ICON} />, text: `Roles: ${labels.join(', ')}` };
      }
      case 'SHOWROOMS': {
        const names = a.targetShowroomIds
          .map((id) => (showrooms.data ?? []).find((s: ShowroomRow) => s.id === id)?.name ?? id)
          .join(', ');
        return { icon: <Users {...ICON} />, text: `Showrooms: ${names}` };
      }
      case 'STAFF': {
        const names = a.targetStaffIds
          .map((id) => (staffQuery.data ?? []).find((s: StaffRow) => s.id === id)?.name ?? id)
          .join(', ');
        return { icon: <Users {...ICON} />, text: `Staff: ${names}` };
      }
      case 'MIXED':
        return { icon: <Users {...ICON} />, text: 'Mixed audience' };
    }
  })();

  const onToggleActive = async () => {
    await patch.mutateAsync({ id: a.id, isActive: !a.isActive });
    onFlash(a.isActive ? 'Announcement hidden' : 'Announcement shown');
  };

  const onDelete = async () => {
    const ok = await confirm({
      title: 'Delete this announcement?',
      body: `"${a.title}" will be removed permanently along with its read receipts.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return;
    await del.mutateAsync(a.id);
    onFlash('Announcement deleted');
  };

  return (
    <div className={styles.listRow}>
      <div className={styles.listRowMain}>
        <div className={styles.listTitle}>
          <span className={`${styles.categoryBadge} ${meta.cls}`}>
            <Icon size={12} strokeWidth={1.75} />
            {meta.label}
          </span>
          <h3 className={styles.listTitleText}>{a.title}</h3>
          <span className={`${styles.statusPill} ${statusPill.cls}`}>{statusPill.label}</span>
        </div>
        {a.body && <p className={styles.listBody}>{a.body}</p>}

        {a.attachments.length > 0 && (
          <div className={styles.attachmentLinkRow}>
            {a.attachments.map((att) => (
              <a
                key={att.r2Key}
                href={`/api/announcements/${a.id}/attachments/${encodeURIComponent(att.r2Key)}`}
                className={styles.attachmentLink}
                target="_blank"
                rel="noreferrer"
              >
                <Paperclip {...ICON} />
                {att.name || att.r2Key.split('/').pop()}
              </a>
            ))}
          </div>
        )}

        <div className={styles.metaRow}>
          <span className={styles.audiencePill}>
            {audienceText.icon}
            {audienceText.text}
          </span>
          <span>·</span>
          <span>Posted {formatDate(a.createdAt)}</span>
          {a.expiresAt && (
            <>
              <span>·</span>
              <span>{expired ? 'expired' : 'hides'} {formatDate(a.expiresAt)}</span>
            </>
          )}
        </div>

        <ReceiptPanel
          id={a.id}
          open={showReceipt}
          onToggle={() => setShowReceipt((v) => !v)}
          onFlash={onFlash}
          confirm={confirm}
        />
      </div>

      <div className={styles.listRowSide}>
        <Button variant="ghost" onClick={() => void onToggleActive()} disabled={patch.isPending}>
          {a.isActive ? (<><EyeOff {...ICON} />Hide</>) : (<><Eye {...ICON} />Show</>)}
        </Button>
        <Button variant="ghost" onClick={() => void onDelete()} disabled={del.isPending}>
          <Trash2 {...ICON} />
          Delete
        </Button>
      </div>
    </div>
  );
}

// ----------------------------------------------------------------------------
// Read-receipt + Remind panel (lazy-loaded on each expand)
// ----------------------------------------------------------------------------

function ReceiptPanel({
  id, open, onToggle, onFlash, confirm,
}: {
  id: string;
  open: boolean;
  onToggle: () => void;
  onFlash: (m: string) => void;
  confirm: ConfirmFn;
}) {
  const acks = useAnnouncementAcks(open ? id : null);
  const remind = useRemindAnnouncement();

  const label = acks.data
    ? `Read ${acks.data.ackedCount} of ${acks.data.total}`
    : 'Read receipts';

  const onRemindUnacked = async () => {
    const pending = acks.data?.pending.length ?? 0;
    if (pending === 0) return;
    const ok = await confirm({
      title: `Remind ${pending} staff?`,
      body: 'They will see the banner again until they tap Got It.',
      confirmLabel: 'Remind',
    });
    if (!ok) return;
    const r = await remind.mutateAsync({ id, scope: 'unacked' });
    onFlash(`Reminder set — banner will re-pop for ${r.pendingCount} staff.`);
  };

  const onRemindAll = async () => {
    const total = acks.data?.total ?? 0;
    if (total === 0) return;
    const ok = await confirm({
      title: `Reset all ${total} read receipts?`,
      body: 'Everyone — including those who already tapped Got It — will see the banner again. This resets receipts to 0 of N.',
      confirmLabel: 'Reset and remind',
      danger: true,
    });
    if (!ok) return;
    const r = await remind.mutateAsync({ id, scope: 'all' });
    onFlash(`Reminder reset — banner will re-pop for ${r.pendingCount} staff.`);
  };

  return (
    <div className={styles.receipt}>
      <button type="button" className={styles.receiptToggle} onClick={onToggle}>
        {open ? <ChevronUp size={14} strokeWidth={2} /> : <ChevronDown size={14} strokeWidth={2} />}
        <Users size={12} strokeWidth={1.75} />
        {label}
      </button>
      {open && (
        <>
          {acks.isLoading || !acks.data ? (
            <p className={styles.receiptEmpty}>Loading…</p>
          ) : (
            <>
              <div className={styles.receiptCols}>
                <div className={styles.receiptCol}>
                  <span className={styles.receiptColHeader}>
                    Acknowledged ({acks.data.ackedCount})
                  </span>
                  {acks.data.acked.length === 0 ? (
                    <span className={styles.receiptEmpty}>No-one yet.</span>
                  ) : (
                    acks.data.acked.map((u) => (
                      <div key={u.id} className={styles.receiptRow}>
                        <span>
                          <CheckCircle2 size={12} strokeWidth={1.75} style={{ color: 'var(--c-secondary-a, #2f5d4f)', marginRight: 4 }} />
                          {u.name}
                        </span>
                        <span style={{ color: 'var(--fg-muted)' }}>{formatDate(u.ackedAt)}</span>
                      </div>
                    ))
                  )}
                </div>
                <div className={styles.receiptCol}>
                  <span className={styles.receiptColHeader}>
                    Not yet ({acks.data.pending.length})
                  </span>
                  {acks.data.pending.length === 0 ? (
                    <span className={styles.receiptEmpty}>Everyone has seen it.</span>
                  ) : (
                    acks.data.pending.map((u) => (
                      <div key={u.id} className={styles.receiptRow}>
                        <span>{u.name}</span>
                        <span style={{ color: 'var(--fg-muted)', fontFamily: 'var(--font-mono)' }}>{u.staffCode}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className={styles.remindRow}>
                {acks.data.pending.length > 0 && (
                  <Button variant="ghost" onClick={() => void onRemindUnacked()} disabled={remind.isPending}>
                    Remind un-acknowledged ({acks.data.pending.length})
                  </Button>
                )}
                {acks.data.total > 0 && (
                  <Button variant="ghost" onClick={() => void onRemindAll()} disabled={remind.isPending}>
                    Reset receipts ({acks.data.total})
                  </Button>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
