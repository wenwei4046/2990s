// ----------------------------------------------------------------------------
// Users — staff management page (migration 0086).
//
// Ported in spirit from HOOKKA's Employee Master tab but compressed to the
// list + invite + edit + deactivate flows commander asked for. Uses the
// admin/staff API which sends magic-link invites via Supabase service role.
//
// Role gating:
//   - admin / sales_director       → full CRUD
//   - coordinator                  → read-only list
//   - everyone else                → 403 banner
// Layout already blocks POS-only roles at the route guard level.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Plus, X, ShieldCheck, RefreshCw } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useAuth, type StaffRole } from '../lib/auth';
import { useToast } from '../components/Toast';
import {
  useUsers, useInviteUser, useUpdateUser, useDeactivateUser,
  type UserRow, type InviteUserBody, type UpdateUserBody,
} from '../lib/users-queries';
import { useVenues, type VenueRow } from '../lib/venues-queries';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/* Roles that need a venue picker on the invite dialog. Sales directors
   are cross-venue so the picker is hidden for them. */
const VENUE_SCOPED_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>([
  'sales', 'sales_executive', 'outlet_manager',
]);

/* Pretty labels for the role pill. Sentence-case per 2990s brand voice. */
const ROLE_LABEL: Record<StaffRole, string> = {
  sales:           'Sales',
  showroom_lead:   'Showroom lead',
  coordinator:     'Order coordinator',
  finance:         'Finance',
  admin:           'Administrator',
  sales_executive: 'Sales executive',
  outlet_manager:  'Outlet manager',
  sales_director:  'Sales director',
};

/* Role options shown in the invite dropdown. We drop showroom_lead from
   the inviter UI — it's a legacy slot still in the enum but commander said
   "keep but not user-facing". Still surfaces on rows for existing users. */
const INVITE_ROLES: StaffRole[] = [
  'sales_executive', 'outlet_manager', 'sales_director',
  'coordinator', 'finance', 'admin',
  'sales',
];

const formatLastSignIn = (iso: string | null): string => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const Users = () => {
  const { staff } = useAuth();
  const toast = useToast();
  const canWrite = staff?.role === 'admin' || staff?.role === 'sales_director';
  const canRead  = canWrite || staff?.role === 'coordinator';

  const users  = useUsers();
  const venues = useVenues({ includeInactive: false });
  const venueById = useMemo(
    () => new Map((venues.data ?? []).map((v) => [v.id, v])),
    [venues.data],
  );

  const [inviting, setInviting] = useState(false);
  const [editing, setEditing]   = useState<UserRow | null>(null);
  const [filterRole,  setFilterRole]  = useState<StaffRole | ''>('');
  const [filterVenue, setFilterVenue] = useState<string>('');
  const [showInactive, setShowInactive] = useState(false);

  const deactivate = useDeactivateUser();
  const update     = useUpdateUser();

  const rows = useMemo(() => {
    const all = users.data ?? [];
    return all.filter((u) => {
      if (!showInactive && !u.active) return false;
      if (filterRole && u.role !== filterRole) return false;
      if (filterVenue && u.venue_id !== filterVenue) return false;
      return true;
    });
  }, [users.data, filterRole, filterVenue, showInactive]);

  if (!canRead) {
    return (
      <div className={styles.page}>
        <div className={styles.bannerWarn}>
          <strong>403 · No access.</strong>
          <span>Users management is admin / sales director / coordinator only.</span>
        </div>
      </div>
    );
  }

  const onToggleActive = (row: UserRow) => {
    if (row.active) {
      if (!confirm(`Deactivate ${row.name}? They will lose Backend access immediately.`)) return;
      deactivate.mutate(row.id, {
        onSuccess: () => toast.success(`${row.name} deactivated`),
        onError: (e) => toast.error(`Deactivate failed: ${(e as Error).message}`),
      });
    } else {
      update.mutate({ id: row.id, active: true }, {
        onSuccess: () => toast.success(`${row.name} reactivated`),
        onError: (e) => toast.error(`Reactivate failed: ${(e as Error).message}`),
      });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Users</h1>
          <p className={styles.subtitle}>
            Staff directory · invite, edit and deactivate Backend + POS users
          </p>
        </div>
        {canWrite && (
          <Button variant="primary" size="md" onClick={() => setInviting(true)}>
            <Plus {...ICON} />
            <span>Invite user</span>
          </Button>
        )}
      </div>

      <div className={styles.headerRow} style={{ gap: 'var(--space-3)', flexWrap: 'wrap' }}>
        <label className={styles.field} style={{ minWidth: 200 }}>
          <span className={styles.fieldLabel}>Filter by role</span>
          <select className={styles.fieldSelect} value={filterRole}
            onChange={(e) => setFilterRole(e.target.value as StaffRole | '')}>
            <option value="">All roles</option>
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>{ROLE_LABEL[r]}</option>
            ))}
          </select>
        </label>
        <label className={styles.field} style={{ minWidth: 200 }}>
          <span className={styles.fieldLabel}>Filter by venue</span>
          <select className={styles.fieldSelect} value={filterVenue}
            onChange={(e) => setFilterVenue(e.target.value)}>
            <option value="">All venues</option>
            {(venues.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>{v.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <input type="checkbox" checked={showInactive}
            onChange={(e) => setShowInactive(e.target.checked)} />
          <span style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>Show inactive</span>
        </label>
        <span style={{ marginLeft: 'auto' }}>
          <Button variant="ghost" size="sm" onClick={() => void users.refetch()}>
            <RefreshCw {...ICON} /> <span>Refresh</span>
          </Button>
        </span>
      </div>

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Venue</th>
              <th>Last sign-in</th>
              <th>Status</th>
              {canWrite && <th />}
            </tr>
          </thead>
          <tbody>
            {users.isLoading && (
              <tr><td colSpan={canWrite ? 7 : 6} className={styles.emptyRow}>Loading…</td></tr>
            )}
            {!users.isLoading && rows.length === 0 && (
              <tr><td colSpan={canWrite ? 7 : 6} className={styles.emptyRow}>
                <ShieldCheck size={28} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>No users match the filters.</div>
              </td></tr>
            )}
            {!users.isLoading && rows.map((u) => (
              <tr key={u.id}>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                      width: 28, height: 28, borderRadius: 999,
                      background: u.color, color: '#fff',
                      fontFamily: 'var(--font-button)', fontSize: 'var(--fs-12)', fontWeight: 700,
                    }}>{u.initials}</span>
                    <div style={{ display: 'flex', flexDirection: 'column' }}>
                      <strong style={{ color: 'var(--c-ink)' }}>{u.name}</strong>
                      <span className={styles.bindingName}>{u.staff_code}</span>
                    </div>
                  </div>
                </td>
                <td>{u.email ?? '—'}</td>
                <td><span className={styles.codeChip}>{ROLE_LABEL[u.role] ?? u.role}</span></td>
                <td>{u.venue_id ? (venueById.get(u.venue_id)?.name ?? '—') : '—'}</td>
                <td>{formatLastSignIn(u.last_sign_in_at)}</td>
                <td>
                  <span className={`${styles.statusPill} ${u.active ? styles.statusActive : styles.statusInactive}`}>
                    {u.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
                {canWrite && (
                  <td style={{ textAlign: 'right' }}>
                    <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>Edit</Button>
                    <Button variant="ghost" size="sm" onClick={() => onToggleActive(u)}>
                      {u.active ? 'Deactivate' : 'Reactivate'}
                    </Button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {inviting && (
        <InviteUserDrawer
          venues={venues.data ?? []}
          onClose={() => setInviting(false)}
        />
      )}
      {editing && (
        <EditUserDrawer
          row={editing}
          venues={venues.data ?? []}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────────────── */

const InviteUserDrawer = ({
  venues, onClose,
}: { venues: VenueRow[]; onClose: () => void }) => {
  const toast = useToast();
  const invite = useInviteUser();
  const [form, setForm] = useState<{
    staffCode: string; name: string; email: string;
    role: StaffRole; venueId: string; initials: string;
    color: string; pin: string;
  }>({
    staffCode: '', name: '', email: '',
    role: 'sales_executive', venueId: '', initials: '',
    color: '#2F5D4F', pin: '',
  });
  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const needsVenue = VENUE_SCOPED_ROLES.has(form.role);
  const needsPin   = form.role === 'sales' || form.role === 'sales_executive' || form.role === 'outlet_manager';

  const submit = () => {
    if (!form.staffCode.trim()) { toast.error('Staff code required.'); return; }
    if (!form.name.trim())      { toast.error('Name required.'); return; }
    if (!form.initials.trim())  { toast.error('Initials required.'); return; }
    if (!needsPin && !form.email.trim()) {
      toast.error('Email required for Backend-side roles (they get a magic link).');
      return;
    }
    if (needsVenue && !form.venueId) {
      toast.error('Pick a venue for this role.');
      return;
    }
    if (needsPin && !/^\d{6}$/.test(form.pin)) {
      toast.error('6-digit PIN required for POS-side roles.');
      return;
    }

    const body: InviteUserBody = {
      staffCode: form.staffCode.trim(),
      name:      form.name.trim(),
      role:      form.role,
      initials:  form.initials.trim().toUpperCase().slice(0, 4),
      color:     form.color,
      ...(form.email.trim() ? { email: form.email.trim().toLowerCase() } : {}),
      ...(needsVenue ? { venueId: form.venueId } : {}),
      ...(needsPin   ? { pin:     form.pin     } : {}),
    };

    invite.mutate(body, {
      onSuccess: (r) => {
        toast.success(needsPin
          ? `${r.staff.name} created (POS user, signs in with PIN).`
          : `Magic-link invite sent to ${r.staff.email}.`);
        onClose();
      },
      onError: (e) => toast.error(`Invite failed: ${(e as Error).message}`),
    });
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>Invite user</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}>
            <X {...ICON} />
          </button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.formGrid}>
            <Field label="Staff code *" value={form.staffCode}
              onChange={(v) => set('staffCode', v.toUpperCase())} placeholder="e.g. SE-04" />
            <Field label="Full name *" value={form.name}
              onChange={(v) => set('name', v)} placeholder="e.g. Lim Wei Siang" />
            <Field label="Email" value={form.email}
              onChange={(v) => set('email', v)} placeholder="invite@example.com" />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Role *</span>
              <select className={styles.fieldSelect} value={form.role}
                onChange={(e) => set('role', e.target.value as StaffRole)}>
                {INVITE_ROLES.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r]}</option>
                ))}
              </select>
            </label>
            {needsVenue && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Venue *</span>
                <select className={styles.fieldSelect} value={form.venueId}
                  onChange={(e) => set('venueId', e.target.value)}>
                  <option value="">Pick a venue…</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
            )}
            <Field label="Initials *" value={form.initials}
              onChange={(v) => set('initials', v.toUpperCase().slice(0, 4))} placeholder="WS" />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Avatar colour</span>
              <input type="color" className={styles.fieldInput} value={form.color}
                onChange={(e) => set('color', e.target.value)}
                style={{ height: 38, padding: 2 }} />
            </label>
            {needsPin && (
              <Field label="6-digit PIN *" value={form.pin}
                onChange={(v) => set('pin', v.replace(/\D/g, '').slice(0, 6))}
                placeholder="POS sign-in PIN" />
            )}
          </div>
          <p style={{
            fontSize: 'var(--fs-12)', color: 'var(--fg-muted)',
            background: 'var(--c-paper)', padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)', border: '1px solid var(--line)',
          }}>
            {needsPin
              ? 'POS-side roles sign in to the POS device with their staff code + PIN. No email magic link is sent.'
              : 'Backend-side roles receive a magic-link invite at the email above. They set their own password on first sign-in.'}
          </p>
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={invite.isPending}>
            {invite.isPending ? 'Sending…' : (needsPin ? 'Create user' : 'Send invite')}
          </Button>
        </footer>
      </aside>
    </>
  );
};

const EditUserDrawer = ({
  row, venues, onClose,
}: { row: UserRow; venues: VenueRow[]; onClose: () => void }) => {
  const toast = useToast();
  const update = useUpdateUser();
  const [form, setForm] = useState({
    name:     row.name,
    role:     row.role,
    venueId:  row.venue_id ?? '',
    initials: row.initials,
    color:    row.color,
    phone:    row.phone ?? '',
  });
  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const needsVenue = VENUE_SCOPED_ROLES.has(form.role);

  const submit = () => {
    const patch: UpdateUserBody = {};
    if (form.name     !== row.name)            patch.name     = form.name.trim();
    if (form.role     !== row.role)            patch.role     = form.role;
    if (form.initials !== row.initials)        patch.initials = form.initials;
    if (form.color    !== row.color)           patch.color    = form.color;
    if ((form.phone || null) !== row.phone)    patch.phone    = form.phone.trim() || null;
    if (needsVenue) {
      if ((form.venueId || null) !== row.venue_id) patch.venueId = form.venueId || null;
    } else if (row.venue_id) {
      patch.venueId = null;
    }
    if (Object.keys(patch).length === 0) { toast.info('Nothing to save.'); return; }
    update.mutate({ id: row.id, ...patch }, {
      onSuccess: () => { toast.success(`${form.name} updated.`); onClose(); },
      onError: (e) => toast.error(`Update failed: ${(e as Error).message}`),
    });
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>Edit user · {row.staff_code}</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}>
            <X {...ICON} />
          </button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.formGrid}>
            <Field label="Full name" value={form.name} onChange={(v) => set('name', v)} />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Role</span>
              <select className={styles.fieldSelect} value={form.role}
                onChange={(e) => set('role', e.target.value as StaffRole)}>
                {INVITE_ROLES.concat(form.role === 'showroom_lead' ? ['showroom_lead'] : [])
                  .map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
                  ))}
              </select>
            </label>
            {needsVenue && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Venue</span>
                <select className={styles.fieldSelect} value={form.venueId}
                  onChange={(e) => set('venueId', e.target.value)}>
                  <option value="">No venue</option>
                  {venues.map((v) => (
                    <option key={v.id} value={v.id}>{v.name}</option>
                  ))}
                </select>
              </label>
            )}
            <Field label="Initials" value={form.initials}
              onChange={(v) => set('initials', v.toUpperCase().slice(0, 4))} />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Avatar colour</span>
              <input type="color" className={styles.fieldInput} value={form.color}
                onChange={(e) => set('color', e.target.value)} style={{ height: 38, padding: 2 }} />
            </label>
            <Field label="Phone" value={form.phone}
              onChange={(v) => set('phone', v)} placeholder="+60 12-345-6789" />
          </div>
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </footer>
      </aside>
    </>
  );
};

const Field = ({
  label, value, onChange, placeholder,
}: {
  label: string; value: string;
  onChange: (v: string) => void; placeholder?: string;
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <input className={styles.fieldInput} value={value} placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)} />
  </label>
);
