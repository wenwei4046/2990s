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
//
// 2026-05-27 — Unified invite flow: every role gets a magic-link email and
// sets their own password on first sign-in. The legacy 6-digit-PIN path for
// sales / sales_executive / outlet_manager was dropped per commander
// ("不需要给 6digit pin 让他们自己 set"). When the POS app ships (Phase 2)
// it'll use Supabase Auth like the Backend — email + password per person,
// not a shared device PIN.
// ----------------------------------------------------------------------------

import { useCallback, useMemo, useState } from 'react';
import { Plus, X, RefreshCw } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useAuth, type StaffRole } from '../lib/auth';
import { useToast } from '../components/Toast';
import {
  useUsers, useInviteUser, useUpdateUser, useDeactivateUser,
  type UserRow, type InviteUserBody, type UpdateUserBody,
} from '../lib/users-queries';
import { useVenues, type VenueRow } from '../lib/venues-queries';
import { useShowrooms } from '../lib/admin-queries';
import { PinDrawer } from '../components/PinDrawer';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import { useConfirm } from '../components/ConfirmDialog';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/* Roles that need a venue picker on the invite dialog. Only the on-floor POS
   selling roles are venue-scoped; everyone else is cross-venue. */
const VENUE_SCOPED_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>([
  'sales_executive', 'outlet_manager',
]);

/* Roles that log in by a 6-digit passcode (POS counter). Their credential is
   sent to the API as `pin`. Kept in lock-step with the API's
   PASSCODE_LOGIN_ROLES set. */
const PASSCODE_LOGIN_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>([
  'sales', 'sales_executive', 'outlet_manager',
]);

/* Roles that log in by email + password (Backend). Their credential is sent
   to the API as `password`. Kept in lock-step with the API's
   PASSWORD_LOGIN_ROLES set. */
const PASSWORD_LOGIN_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>([
  'super_admin', 'admin', 'sales_director', 'coordinator', 'finance', 'showroom_lead',
]);

/* Roles that SELL through the POS and therefore must belong to a showroom
   server-side. The invite form has no showroom picker, so for any of these we
   stamp `showroomId` from the primary showroom (see DEFAULT_SHOWROOM_ID). */
const SHOWROOM_SCOPED_ROLES: ReadonlySet<StaffRole> = new Set<StaffRole>([
  'sales', 'sales_executive', 'outlet_manager', 'sales_director',
]);

/* Fallback when the showrooms query hasn't loaded — the primary "Showroom KL"
   UUID (CLAUDE.md §Showroom). The form prefers the first active showroom from
   useShowrooms() and only falls back to this. */
const DEFAULT_SHOWROOM_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/* Brand-aligned avatar swatches. Default 2990s green (#2F5D4F) first. */
const COLOR_PALETTE: readonly string[] = [
  '#2F5D4F', // 2990s green (default)
  '#E86B3A', // burnt orange
  '#B5482E', // terracotta
  '#C7973F', // ochre
  '#7A8450', // olive
  '#3C6E71', // teal
  '#284B63', // deep blue
  '#6D597A', // muted plum
  '#9B5DE5', // violet
  '#5A6470', // slate
];

/* Default avatar colour — the first (and brand-primary) swatch. */
const DEFAULT_COLOR = '#2F5D4F';

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
  super_admin:     'Super admin',
  master_account:  'Master account',
};

/* Role options shown in the invite dropdown. master_account is retired from
   the inviter UI (kept in ROLE_LABEL so existing rows still render). */
const INVITE_ROLES: StaffRole[] = [
  'super_admin', 'admin', 'sales_director', 'outlet_manager', 'sales_executive',
];

const formatLastSignIn = (iso: string | null): string => {
  if (!iso) return 'Never';
  const d = new Date(iso);
  return d.toLocaleDateString('en-GB', { year: 'numeric', month: '2-digit', day: '2-digit' });
};

export const Users = () => {
  const { staff } = useAuth();
  const toast = useToast();
  const canWrite = staff?.role === 'admin' || staff?.role === 'super_admin';
  // sales_director has NO staff management (it is a Sales-Order-desk role); the
  // Layout guard also keeps it off /users. Only admin/super_admin write, with
  // coordinator read-only (mirrors the API STAFF_WRITE_ROLES / STAFF_LIST_ROLES).
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
  const askConfirm = useConfirm();

  const rows = useMemo(() => {
    const all = users.data ?? [];
    return all.filter((u) => {
      if (!showInactive && !u.active) return false;
      if (filterRole && u.role !== filterRole) return false;
      if (filterVenue && u.venue_id !== filterVenue) return false;
      return true;
    });
  }, [users.data, filterRole, filterVenue, showInactive]);

  const onToggleActive = useCallback(async (row: UserRow) => {
    if (row.active) {
      if (!(await askConfirm({
        title: `Deactivate ${row.name}?`,
        body: 'They will lose Backend access immediately.',
        confirmLabel: 'Deactivate',
        danger: true,
      }))) return;
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
    // mutate fns are stable; toast comes from context and is stable too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deactivate.mutate, update.mutate, toast, askConfirm]);

  /* Shared DataGrid conversion (2026-06-12). Role / venue / show-inactive
     filters above keep driving `rows`; the grid adds sort, per-column
     filters, column show-hide / reorder / pin + a free-text search. Action
     buttons stopPropagation so they never read as a row click. */
  const columns = useMemo<DataGridColumn<UserRow>[]>(() => {
    const cols: DataGridColumn<UserRow>[] = [
      {
        key: 'name',
        label: 'Name',
        width: 220,
        accessor: (u) => (
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
        ),
        searchValue: (u) => `${u.name} ${u.staff_code}`,
        filterValue: (u) => u.name,
        sortFn: (a, b) => a.name.localeCompare(b.name),
      },
      {
        key: 'email',
        label: 'Email',
        width: 220,
        accessor: (u) => u.email ?? '—',
      },
      {
        key: 'role',
        label: 'Role',
        width: 150,
        accessor: (u) => <span className={styles.codeChip}>{ROLE_LABEL[u.role] ?? u.role}</span>,
        searchValue: (u) => ROLE_LABEL[u.role] ?? u.role,
        filterValue: (u) => ROLE_LABEL[u.role] ?? u.role,
      },
      {
        key: 'venue',
        label: 'Venue',
        width: 140,
        accessor: (u) => (u.venue_id ? (venueById.get(u.venue_id)?.name ?? '—') : '—'),
        filterValue: (u) => (u.venue_id ? (venueById.get(u.venue_id)?.name ?? '—') : '—'),
      },
      {
        key: 'lastSignIn',
        label: 'Last sign-in',
        width: 120,
        accessor: (u) => formatLastSignIn(u.last_sign_in_at),
        filterValue: (u) => formatLastSignIn(u.last_sign_in_at),
        sortFn: (a, b) => (a.last_sign_in_at ?? '').localeCompare(b.last_sign_in_at ?? ''),
      },
      {
        key: 'status',
        label: 'Status',
        width: 100,
        accessor: (u) => (
          <span className={`${styles.statusPill} ${u.active ? styles.statusActive : styles.statusInactive}`}>
            {u.active ? 'Active' : 'Inactive'}
          </span>
        ),
        searchValue: (u) => (u.active ? 'Active' : 'Inactive'),
        filterValue: (u) => (u.active ? 'Active' : 'Inactive'),
        sortFn: (a, b) => Number(a.active) - Number(b.active),
      },
    ];
    if (canWrite) {
      cols.push({
        key: 'actions',
        label: '',
        width: 180,
        align: 'right',
        sortable: false,
        groupable: false,
        accessor: (u) => (
          <span onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
            <Button variant="ghost" size="sm" onClick={() => setEditing(u)}>Edit</Button>
            <Button variant="ghost" size="sm" onClick={() => onToggleActive(u)}>
              {u.active ? 'Deactivate' : 'Reactivate'}
            </Button>
          </span>
        ),
        searchValue: () => '',
      });
    }
    return cols;
  }, [canWrite, venueById, onToggleActive]);

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

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Users</h1>
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

      <DataGrid
        rows={rows}
        columns={columns}
        storageKey="dg-users"
        rowKey={(u) => u.id}
        searchPlaceholder="Search users…"
        groupBanner={false}
        isLoading={users.isLoading}
        emptyMessage="No users match the filters."
      />

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
  const showrooms = useShowrooms();
  const [form, setForm] = useState<{
    name: string; email: string;
    role: StaffRole; venueId: string;
    color: string; passcode: string; confirmPasscode: string; password: string;
  }>({
    name: '', email: '',
    role: 'sales_executive', venueId: '',
    color: DEFAULT_COLOR, passcode: '', confirmPasscode: '', password: '',
  });
  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const needsVenue   = VENUE_SCOPED_ROLES.has(form.role);
  const usesPasscode = PASSCODE_LOGIN_ROLES.has(form.role);
  const usesPassword = PASSWORD_LOGIN_ROLES.has(form.role);

  /* Showroom-scoped roles must carry a showroom server-side, but the form has
     no showroom picker. Default to the first active showroom, falling back to
     the primary "Showroom KL" UUID if the query hasn't loaded. */
  const primaryShowroomId =
    (showrooms.data ?? []).find((s) => s.active)?.id ?? DEFAULT_SHOWROOM_ID;

  const submit = () => {
    if (!form.name.trim())  { toast.error('Name required.'); return; }
    if (!form.email.trim()) { toast.error('Email required.'); return; }
    if (needsVenue && !form.venueId) {
      toast.error('Pick a venue for this role.');
      return;
    }
    // Email-login roles need a password (sign-in); passcode-login roles don't.
    if (usesPassword && form.password.length < 8) {
      toast.error('Set a password (at least 8 characters).');
      return;
    }
    // Both groups need a 6-digit code: passcode roles → POS sign-in passcode;
    // password roles → "My orders" passcode (opens the My-orders gate).
    if (usesPasscode || usesPassword) {
      const what = usesPasscode ? 'passcode' : 'My orders passcode';
      if (!/^\d{6}$/.test(form.passcode))         { toast.error(`Set a 6-digit ${what}.`); return; }
      if (form.passcode !== form.confirmPasscode) { toast.error(`${usesPasscode ? 'Passcodes' : 'My orders passcodes'} do not match.`); return; }
    }

    const body: InviteUserBody = {
      name:   form.name.trim(),
      role:   form.role,
      email:  form.email.trim().toLowerCase(),
      color:  form.color,
      ...(needsVenue ? { venueId: form.venueId } : {}),
      ...(SHOWROOM_SCOPED_ROLES.has(form.role) ? { showroomId: primaryShowroomId } : {}),
      // Password roles send BOTH: an email password (sign-in) and a 6-digit
      // "My orders" passcode (pin). Passcode roles send only the passcode (pin).
      ...(usesPassword ? { password: form.password } : {}),
      ...(usesPasscode || usesPassword ? { pin: form.passcode } : {}),
    };

    invite.mutate(body, {
      onSuccess: (r) => {
        toast.success(usesPasscode
          ? `${r.staff.name} created — they log in with their passcode.`
          : `${r.staff.name} created — email + password login, with a My orders passcode set.`);
        onClose();
      },
      onError: (e) => toast.error(`Create failed: ${(e as Error).message}`),
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
            <Field label="Full name *" value={form.name}
              onChange={(v) => set('name', v)} placeholder="e.g. Lim Wei Siang" />
            <Field label="Email *" value={form.email}
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
            <div className={styles.formGridFull}>
              <ColourSwatchField value={form.color} onChange={(c) => set('color', c)} />
            </div>
            {/* Credential fields. Passcode roles: a POS sign-in passcode only.
                Password (email-login) roles: an email password for sign-in PLUS
                a 6-digit "My orders" passcode that opens the My-orders gate. */}
            {usesPassword && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Password *</span>
                <input className={styles.fieldInput} type="password" value={form.password}
                  onChange={(e) => set('password', e.target.value)}
                  placeholder="At least 8 characters" />
              </label>
            )}
            {(usesPasscode || usesPassword) && (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    {usesPasscode ? 'Passcode * (6 digits)' : 'My orders passcode * (6 digits)'}
                  </span>
                  <input className={styles.fieldInput} inputMode="numeric" maxLength={6}
                    value={form.passcode}
                    onChange={(e) => set('passcode', e.target.value.replace(/\D/g, ''))}
                    placeholder="6-digit passcode" />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>
                    {usesPasscode ? 'Confirm passcode *' : 'Confirm My orders passcode *'}
                  </span>
                  <input className={styles.fieldInput} inputMode="numeric" maxLength={6}
                    value={form.confirmPasscode}
                    onChange={(e) => set('confirmPasscode', e.target.value.replace(/\D/g, ''))}
                    placeholder="Re-enter passcode" />
                </label>
              </>
            )}
          </div>
          <p style={{
            fontSize: 'var(--fs-12)', color: 'var(--fg-muted)',
            background: 'var(--c-paper)', padding: 'var(--space-3)',
            borderRadius: 'var(--radius-md)', border: '1px solid var(--line)',
            marginTop: 'var(--space-3)',
          }}>
            {usesPasscode
              ? 'This person logs in with their 6-digit passcode on the POS. Set their starting passcode above — they can change it themselves later. Staff code and initials are generated automatically.'
              : 'This person logs in with their email + the password above on the Backend. The 6-digit My orders passcode lets them open My orders on a shared tablet (it does not change their sign-in). Staff code and initials are generated automatically.'}
          </p>
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={invite.isPending}>
            {invite.isPending ? 'Creating…' : 'Create user'}
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
  const [pinOpen, setPinOpen] = useState(false);
  const [form, setForm] = useState({
    name:     row.name,
    role:     row.role,
    venueId:  row.venue_id ?? '',
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
                {/* Union the row's current role in so a legacy-role user
                    (e.g. sales / coordinator / master_account) stays editable
                    even though it's no longer in the inviter list. */}
                {INVITE_ROLES.concat(INVITE_ROLES.includes(row.role) ? [] : [row.role])
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
            <div className={styles.formGridFull}>
              <ColourSwatchField value={form.color} onChange={(c) => set('color', c)} />
            </div>
            <Field label="Phone" value={form.phone}
              onChange={(v) => set('phone', v)} placeholder="+60 12-345-6789" />
          </div>
          {(PASSCODE_LOGIN_ROLES.has(row.role) || PASSWORD_LOGIN_ROLES.has(row.role)) && (
            <div style={{ marginTop: 'var(--space-4)' }}>
              <Button variant="ghost" size="sm" onClick={() => setPinOpen(true)}>
                <RefreshCw {...ICON} />
                {PASSCODE_LOGIN_ROLES.has(row.role)
                  ? ' Reset passcode'
                  : ' Set / reset My orders passcode'}
              </Button>
            </div>
          )}
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={update.isPending}>
            {update.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </footer>
      </aside>
      {pinOpen && (
        <PinDrawer
          staff={{ id: row.id, name: row.name, staffCode: row.staff_code }}
          loginMethod={PASSCODE_LOGIN_ROLES.has(row.role) ? 'passcode' : 'password'}
          onClose={() => setPinOpen(false)}
        />
      )}
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

/* Avatar-colour picker: a row of clickable brand swatches. The selected swatch
   gets a ring; a legacy colour outside the palette still surfaces as a chip so
   it stays selectable. */
const ColourSwatchField = ({
  value, onChange,
}: { value: string; onChange: (v: string) => void }) => {
  const normalized = value.toLowerCase();
  const inPalette = COLOR_PALETTE.some((c) => c.toLowerCase() === normalized);
  const swatches = inPalette ? COLOR_PALETTE : [...COLOR_PALETTE, value];
  return (
    <div className={styles.field}>
      <span className={styles.fieldLabel}>Avatar colour</span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)', paddingTop: 2 }}>
        {swatches.map((c) => {
          const selected = c.toLowerCase() === normalized;
          return (
            <button
              key={c}
              type="button"
              aria-label={`Avatar colour ${c}`}
              aria-pressed={selected}
              title={c}
              onClick={() => onChange(c)}
              style={{
                width: 40, height: 40,
                borderRadius: 'var(--radius-md)',
                background: c,
                cursor: 'pointer',
                padding: 0,
                border: selected ? '2px solid var(--c-ink)' : '1px solid var(--line)',
                boxShadow: selected ? '0 0 0 2px var(--c-paper), 0 0 0 4px var(--c-ink)' : 'none',
              }}
            />
          );
        })}
      </div>
    </div>
  );
};
