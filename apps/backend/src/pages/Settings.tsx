import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, X, Save, MessageCircle, Mail, CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
import { useDrivers, useSuppliers, type DriverRow, type Supplier } from '../lib/queries';
import {
  useShowrooms,
  useStaff,
  useAppConfig,
  useUpdateSupplier,
  useCreateSupplier,
  useUpdateDriver,
  useCreateDriver,
  useUpdateStaffActive,
  useCreateStaff,
  useDeliveryFeeConfig,
  useUpdateDeliveryFeeConfig,
  type StaffRow,
  type StaffRoleValue,
  type ShowroomRow,
} from '../lib/admin-queries';
import { PinDrawer } from '../components/PinDrawer';
import styles from './Settings.module.css';

type TabId = 'suppliers' | 'drivers' | 'showrooms' | 'staff' | 'delivery' | 'localities' | 'app';

const TABS: { id: TabId; label: string }[] = [
  { id: 'suppliers',  label: 'Suppliers' },
  { id: 'drivers',    label: 'Drivers' },
  { id: 'showrooms',  label: 'Showrooms' },
  { id: 'staff',      label: 'Staff' },
  { id: 'delivery',   label: 'Delivery fees' },
  /* PR #158 — Commander 2026-05-27: "什么 State 对应哪个 Warehouse 也需要
     设置清楚". One row per Malaysian state mapping to a warehouse for
     dispatch routing. States/cities/postcodes themselves come from the
     my_localities reference table (read-only display, no edit yet). */
  { id: 'localities', label: 'Localities' },
  { id: 'app',        label: 'App config' },
];

export const Settings = () => {
  const { staff } = useAuth();
  const [tab, setTab] = useState<TabId>('suppliers');

  const isAdmin = staff?.role === 'admin';
  const isCoordOrAdmin = staff?.role === 'admin' || staff?.role === 'coordinator';

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className="t-eyebrow">Operational data · admin</div>
          <h2 className={styles.title}>Settings</h2>
          <p className={`t-body fg-muted ${styles.lede}`}>
            Suppliers, drivers, showrooms, staff and app config. Filling supplier WhatsApp + email
            unlocks PO share buttons in the order drawer.
          </p>
        </div>
      </header>

      {!isAdmin && !isCoordOrAdmin && (
        <div className={styles.readOnlyBanner}>
          <strong>Read-only view.</strong> Settings is admin/coordinator-only. Sign in as Loo to edit.
        </div>
      )}

      <div className={styles.tabs} role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? `${styles.tab} ${styles.tabActive}` : styles.tab}
            onClick={() => setTab(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'suppliers' && <SuppliersTab canEdit={isAdmin} />}
      {tab === 'drivers' && <DriversTab canEdit={isCoordOrAdmin} />}
      {tab === 'showrooms' && <ShowroomsTab />}
      {tab === 'staff' && <StaffTab canEdit={isAdmin} />}
      {tab === 'delivery' && <DeliveryFeesTab canEdit={isCoordOrAdmin} />}
      {tab === 'localities' && <LocalitiesTab canEdit={isCoordOrAdmin} />}
      {tab === 'app' && <AppConfigTab />}
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
   LocalitiesTab — PR #158
   - Top: State → Warehouse mapping CRUD (state_warehouse_mappings table)
   - Bottom: read-only reference of distinct states from my_localities
   Cities/postcodes can be browsed via the cascading dropdowns in the New
   SO form; full CRUD on those rows is out of scope for this PR. */

import {
  useStateWarehouseMappings,
  useUpsertStateWarehouseMapping,
  useDeleteStateWarehouseMapping,
} from '../lib/state-warehouse-queries';
import { useWarehouses } from '../lib/inventory-queries';
import { useLocalities, distinctStates } from '../lib/localities-queries';

const LocalitiesTab = ({ canEdit }: { canEdit: boolean }) => {
  const mappings = useStateWarehouseMappings();
  const warehouses = useWarehouses();
  const localities = useLocalities();
  const upsert = useUpsertStateWarehouseMapping();
  const remove = useDeleteStateWarehouseMapping();

  const states = useMemo(() => distinctStates(localities.data ?? []), [localities.data]);
  const mappedByState = useMemo(() => {
    const m = new Map<string, { warehouseId: string | null; notes: string | null }>();
    for (const row of mappings.data?.mappings ?? []) {
      m.set(row.state, { warehouseId: row.warehouseId, notes: row.notes });
    }
    return m;
  }, [mappings.data]);

  return (
    <>
      <div className={styles.readOnlyBanner}>
        <strong>State → Warehouse mapping.</strong> Pick the dispatch warehouse
        for each state. When a customer's delivery address is in that state, the
        SO Detail page suggests this warehouse as the Sales Location automatically.
        States, cities, and postcodes themselves are read-only references from
        my_localities — edit those via Supabase Studio for now.
      </div>

      <div className={styles.tableCard}>
        {mappings.isLoading || warehouses.isLoading || localities.isLoading ? (
          <div className={styles.empty}>Loading…</div>
        ) : states.length === 0 ? (
          <div className={styles.empty}>No states found in my_localities.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>State</th>
                <th>Warehouse</th>
                <th>Notes</th>
                {canEdit && <th aria-label="actions" />}
              </tr>
            </thead>
            <tbody>
              {states.map((state) => {
                const current = mappedByState.get(state);
                return (
                  <tr key={state}>
                    <td><strong>{state}</strong></td>
                    <td>
                      <select
                        className={styles.input}
                        value={current?.warehouseId ?? ''}
                        disabled={!canEdit || upsert.isPending}
                        onChange={(e) => {
                          const warehouseId = e.target.value || null;
                          upsert.mutate({ state, warehouseId, notes: current?.notes ?? null });
                        }}
                      >
                        <option value="">— Unassigned —</option>
                        {(warehouses.data ?? []).filter((w) => w.is_active).map((w) => (
                          <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        className={styles.input}
                        value={current?.notes ?? ''}
                        disabled={!canEdit || upsert.isPending}
                        placeholder="Optional"
                        onBlur={(e) => {
                          const notes = e.target.value.trim() || null;
                          if ((current?.notes ?? null) === notes) return;
                          upsert.mutate({ state, warehouseId: current?.warehouseId ?? null, notes });
                        }}
                      />
                    </td>
                    {canEdit && (
                      <td>
                        {current && (
                          <button
                            type="button"
                            className={styles.editBtn}
                            disabled={remove.isPending}
                            onClick={() => remove.mutate({ state })}
                            aria-label={`Clear mapping for ${state}`}
                          >
                            Clear
                          </button>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

/* ─── Suppliers ─── */

type SupplierDrawerState =
  | { open: false }
  | { open: true; mode: 'create' }
  | { open: true; mode: 'edit'; supplier: Supplier };

const SuppliersTab = ({ canEdit }: { canEdit: boolean }) => {
  const suppliers = useSuppliers();
  const [drawer, setDrawer] = useState<SupplierDrawerState>({ open: false });

  const missingContacts =
    (suppliers.data ?? []).filter((s) => !s.whatsappNumber && !s.email).length;

  return (
    <>
      {canEdit && missingContacts > 0 && (
        <div className={styles.banner}>
          <strong>{missingContacts}</strong> supplier{missingContacts === 1 ? '' : 's'} have no
          WhatsApp or email — PO share buttons stay hidden until you fill these in.
        </div>
      )}

      <div className={styles.actionsRow} style={{ marginBottom: 'var(--space-3)' }}>
        {canEdit && (
          <Button variant="primary" size="md" onClick={() => setDrawer({ open: true, mode: 'create' })}>
            <Plus size={16} strokeWidth={1.75} />
            New supplier
          </Button>
        )}
      </div>

      <div className={styles.tableCard}>
        {suppliers.isLoading ? (
          <div className={styles.empty}>Loading suppliers…</div>
        ) : suppliers.error ? (
          <div className={styles.empty}>Failed to load suppliers: {String(suppliers.error)}</div>
        ) : (suppliers.data?.length ?? 0) === 0 ? (
          <div className={styles.empty}>No suppliers yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>WhatsApp</th>
                <th>Email</th>
                {canEdit && <th aria-label="actions" />}
              </tr>
            </thead>
            <tbody>
              {suppliers.data!.map((s) => (
                <tr key={s.id}>
                  <td><code className={styles.code}>{s.code}</code></td>
                  <td>{s.name}</td>
                  <td>
                    {s.whatsappNumber ? (
                      <span><MessageCircle size={14} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginRight: 4 }} />{s.whatsappNumber}</span>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  <td>
                    {s.email ? (
                      <span><Mail size={14} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginRight: 4 }} />{s.email}</span>
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className={styles.editBtn}
                        onClick={() => setDrawer({ open: true, mode: 'edit', supplier: s })}
                        aria-label={`Edit ${s.code}`}
                      >
                        <Pencil size={14} strokeWidth={1.75} />
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drawer.open && (
        <SupplierDrawer
          mode={drawer.mode}
          supplier={drawer.mode === 'edit' ? drawer.supplier : null}
          onClose={() => setDrawer({ open: false })}
        />
      )}
    </>
  );
};

const SupplierDrawer = ({
  mode,
  supplier,
  onClose,
}: {
  mode: 'create' | 'edit';
  supplier: Supplier | null;
  onClose: () => void;
}) => {
  const [code, setCode] = useState(supplier?.code ?? '');
  const [name, setName] = useState(supplier?.name ?? '');
  const [whatsapp, setWhatsapp] = useState(supplier?.whatsappNumber ?? '');
  const [email, setEmail] = useState(supplier?.email ?? '');
  const [error, setError] = useState<string | null>(null);
  const updateSupplier = useUpdateSupplier();
  const createSupplier = useCreateSupplier();
  const saving = updateSupplier.isPending || createSupplier.isPending;

  const onSave = async () => {
    setError(null);
    if (!code.trim() || !name.trim()) {
      setError('Code and name are required.');
      return;
    }
    try {
      if (mode === 'create') {
        await createSupplier.mutateAsync({
          code: code.trim().toUpperCase(),
          name: name.trim(),
          whatsappNumber: whatsapp.trim() || null,
          email: email.trim() || null,
        });
      } else if (supplier) {
        await updateSupplier.mutateAsync({
          id: supplier.id,
          patch: {
            code: code.trim().toUpperCase(),
            name: name.trim(),
            whatsappNumber: whatsapp.trim() || null,
            email: email.trim() || null,
          },
        });
      }
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHead}>
          <div>
            <div className="t-eyebrow">{mode === 'create' ? 'New supplier' : 'Edit supplier'}</div>
            <h3 className={styles.drawerTitle}>{mode === 'create' ? 'Add a supplier' : supplier?.name}</h3>
            <div className={styles.drawerSub}>
              WhatsApp + email unlock PO share buttons in the order drawer.
            </div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        <div className={styles.drawerBody}>
          {error && <div className={styles.errorBanner}>{error}</div>}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Code</span>
            <input
              className={styles.input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. KFA"
              maxLength={8}
            />
            <span className={styles.fieldHint}>Short uppercase identifier used on PO numbers.</span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Kraf Furnitur Asia"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>WhatsApp number</span>
            <input
              className={styles.input}
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="+60 12 345 6789"
            />
            <span className={styles.fieldHint}>
              International format. Leave blank if you don't want to share POs via WhatsApp.
            </span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email</span>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="orders@supplier.com"
            />
          </label>
        </div>

        <footer className={styles.drawerFoot}>
          <div className={styles.grow} />
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSave()} disabled={saving}>
            <Save size={16} strokeWidth={1.75} />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </footer>
      </div>
    </div>
  );
};

/* ─── Drivers ─── */

type DriverDrawerState =
  | { open: false }
  | { open: true; mode: 'create' }
  | { open: true; mode: 'edit'; driver: DriverRow };

const DriversTab = ({ canEdit }: { canEdit: boolean }) => {
  const drivers = useDrivers();
  const [drawer, setDrawer] = useState<DriverDrawerState>({ open: false });

  const placeholderCount =
    (drivers.data ?? []).filter((d) => d.driverCode.startsWith('DRV-') && d.name.startsWith('Driver ')).length;

  return (
    <>
      {canEdit && placeholderCount > 0 && (
        <div className={styles.banner}>
          <strong>{placeholderCount}</strong> placeholder driver{placeholderCount === 1 ? '' : 's'} ({'DRV-01'}/02/03) seeded for testing —
          edit or replace with real driver details.
        </div>
      )}

      <div className={styles.actionsRow} style={{ marginBottom: 'var(--space-3)' }}>
        {canEdit && (
          <Button variant="primary" size="md" onClick={() => setDrawer({ open: true, mode: 'create' })}>
            <Plus size={16} strokeWidth={1.75} />
            New driver
          </Button>
        )}
      </div>

      <div className={styles.tableCard}>
        {drivers.isLoading ? (
          <div className={styles.empty}>Loading drivers…</div>
        ) : drivers.error ? (
          <div className={styles.empty}>Failed to load drivers: {String(drivers.error)}</div>
        ) : (drivers.data?.length ?? 0) === 0 ? (
          <div className={styles.empty}>No drivers yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Phone</th>
                <th>Vehicle</th>
                <th>Status</th>
                {canEdit && <th aria-label="actions" />}
              </tr>
            </thead>
            <tbody>
              {drivers.data!.map((d) => (
                <tr key={d.id}>
                  <td><code className={styles.code}>{d.driverCode}</code></td>
                  <td>{d.name}</td>
                  <td>{d.phone}</td>
                  <td>{d.vehicle ? d.vehicle : <span className={styles.muted}>—</span>}</td>
                  <td>
                    {d.active ? (
                      <span className={styles.statusActive}><CheckCircle2 size={14} strokeWidth={1.75} /> Active</span>
                    ) : (
                      <span className={styles.statusInactive}><Circle size={14} strokeWidth={1.75} /> Inactive</span>
                    )}
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className={styles.editBtn}
                        onClick={() => setDrawer({ open: true, mode: 'edit', driver: d })}
                        aria-label={`Edit ${d.driverCode}`}
                      >
                        <Pencil size={14} strokeWidth={1.75} />
                        Edit
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drawer.open && (
        <DriverDrawer
          mode={drawer.mode}
          driver={drawer.mode === 'edit' ? drawer.driver : null}
          onClose={() => setDrawer({ open: false })}
        />
      )}
    </>
  );
};

const DriverDrawer = ({
  mode,
  driver,
  onClose,
}: {
  mode: 'create' | 'edit';
  driver: DriverRow | null;
  onClose: () => void;
}) => {
  const [code, setCode] = useState(driver?.driverCode ?? '');
  const [name, setName] = useState(driver?.name ?? '');
  const [phone, setPhone] = useState(driver?.phone ?? '');
  const [icNumber, setIcNumber] = useState(driver?.icNumber ?? '');
  const [vehicle, setVehicle] = useState(driver?.vehicle ?? '');
  const [active, setActive] = useState(driver?.active ?? true);
  const [error, setError] = useState<string | null>(null);
  const updateDriver = useUpdateDriver();
  const createDriver = useCreateDriver();
  const saving = updateDriver.isPending || createDriver.isPending;

  const onSave = async () => {
    setError(null);
    if (!code.trim() || !name.trim() || !phone.trim()) {
      setError('Code, name, and phone are required.');
      return;
    }
    try {
      if (mode === 'create') {
        await createDriver.mutateAsync({
          driverCode: code.trim(),
          name: name.trim(),
          phone: phone.trim(),
          icNumber: icNumber.trim() || null,
          vehicle: vehicle.trim() || null,
          active,
        });
      } else if (driver) {
        await updateDriver.mutateAsync({
          id: driver.id,
          patch: {
            driverCode: code.trim(),
            name: name.trim(),
            phone: phone.trim(),
            icNumber: icNumber.trim() || null,
            vehicle: vehicle.trim() || null,
            active,
          },
        });
      }
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHead}>
          <div>
            <div className="t-eyebrow">{mode === 'create' ? 'New driver' : 'Edit driver'}</div>
            <h3 className={styles.drawerTitle}>{mode === 'create' ? 'Add a driver' : driver?.name}</h3>
            <div className={styles.drawerSub}>
              Drivers appear in the dispatch picker once active. Inactive drivers stay in history but can't be assigned.
            </div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        <div className={styles.drawerBody}>
          {error && <div className={styles.errorBanner}>{error}</div>}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Driver code</span>
            <input
              className={styles.input}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="e.g. DRV-04"
            />
            <span className={styles.fieldHint}>Short identifier shown on dispatch cards.</span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Name</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Full name"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Phone</span>
            <input
              className={styles.input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+60 12 345 6789"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>IC number (optional)</span>
            <input
              className={styles.input}
              value={icNumber}
              onChange={(e) => setIcNumber(e.target.value)}
              placeholder="e.g. 880101-14-1234"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Vehicle (optional)</span>
            <input
              className={styles.input}
              value={vehicle}
              onChange={(e) => setVehicle(e.target.value)}
              placeholder="e.g. Lorry 1-tonne · WMK 1234"
            />
          </label>

          <div className={styles.toggleRow}>
            <div className={styles.toggleMain}>
              <span className={styles.toggleTitle}>Active</span>
              <span className={styles.toggleSub}>
                Inactive drivers won't appear in the dispatch picker.
              </span>
            </div>
            <button
              type="button"
              className={active ? `${styles.bigToggle} ${styles.bigToggleOn}` : styles.bigToggle}
              onClick={() => setActive((v) => !v)}
              aria-pressed={active}
              aria-label="Active"
            >
              <span className={styles.bigToggleKnob} />
            </button>
          </div>
        </div>

        <footer className={styles.drawerFoot}>
          <div className={styles.grow} />
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSave()} disabled={saving}>
            <Save size={16} strokeWidth={1.75} />
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </footer>
      </div>
    </div>
  );
};

/* ─── Showrooms (read-only at MVP) ─── */

const ShowroomsTab = () => {
  const showrooms = useShowrooms();

  return (
    <>
      <div className={styles.readOnlyBanner}>
        <strong>Read-only at MVP.</strong> One showroom (KL) for the pilot. Multi-showroom
        editing lands when a 2nd location opens.
      </div>
      <div className={styles.tableCard}>
        {showrooms.isLoading ? (
          <div className={styles.empty}>Loading showrooms…</div>
        ) : (showrooms.data?.length ?? 0) === 0 ? (
          <div className={styles.empty}>No showrooms.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Address</th>
                <th>Phone</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {showrooms.data!.map((s) => (
                <tr key={s.id}>
                  <td><code className={styles.code}>{s.showroomCode}</code></td>
                  <td>{s.name}</td>
                  <td>{s.address ? s.address : <span className={styles.muted}>—</span>}</td>
                  <td>{s.phone ? s.phone : <span className={styles.muted}>—</span>}</td>
                  <td>
                    {s.active ? (
                      <span className={styles.statusActive}><CheckCircle2 size={14} strokeWidth={1.75} /> Active</span>
                    ) : (
                      <span className={styles.statusInactive}><Circle size={14} strokeWidth={1.75} /> Inactive</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};

/* ─── Staff (list + activate/deactivate + invite new) ─── */

const STAFF_AVATAR_COLORS = ['#E86B3A', '#A6471E', '#2F5D4F', '#1F3A8A', '#221F20'];

// Auto-generate the next 2990S-XXX code by scanning existing staff codes.
// Ignores codes that don't match the pattern (e.g. legacy 'OWNER', 'AW').
const STAFF_CODE_PREFIX = '2990S-';
const STAFF_CODE_RE = /^2990S-(\d+)$/;
function nextStaffCode(existing: readonly string[]): string {
  const maxN = existing.reduce((acc, code) => {
    const m = code.match(STAFF_CODE_RE);
    if (!m) return acc;
    const n = parseInt(m[1] ?? '0', 10);
    return Number.isFinite(n) && n > acc ? n : acc;
  }, 0);
  return `${STAFF_CODE_PREFIX}${String(maxN + 1).padStart(3, '0')}`;
}

const STAFF_ROLE_OPTIONS: { value: StaffRoleValue; label: string }[] = [
  { value: 'sales',         label: 'Sales' },
  { value: 'showroom_lead', label: 'Showroom lead' },
  { value: 'coordinator',   label: 'Coordinator' },
  { value: 'finance',       label: 'Finance' },
  { value: 'admin',         label: 'Admin' },
];

type PinDrawerState = { open: false } | { open: true; staff: StaffRow };

const StaffTab = ({ canEdit }: { canEdit: boolean }) => {
  const staffList = useStaff();
  const showrooms = useShowrooms();
  const updateActive = useUpdateStaffActive();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [pinDrawer, setPinDrawer] = useState<PinDrawerState>({ open: false });

  const showroomName = (id: string | null) =>
    id ? showrooms.data?.find((s) => s.id === id)?.name ?? '—' : 'All showrooms';

  return (
    <>
      <div className={styles.readOnlyBanner}>
        <strong>Heads up.</strong> Sales people sign in to POS with their 6-digit PIN — use the Set / Reset PIN button on each row. Other roles get a magic-link invite emailed when you create them.
      </div>

      <div className={styles.actionsRow} style={{ marginBottom: 'var(--space-3)' }}>
        {canEdit && (
          <Button variant="primary" size="md" onClick={() => setDrawerOpen(true)}>
            <Plus size={16} strokeWidth={1.75} />
            New staff
          </Button>
        )}
      </div>

      <div className={styles.tableCard}>
        {staffList.isLoading ? (
          <div className={styles.empty}>Loading staff…</div>
        ) : (staffList.data?.length ?? 0) === 0 ? (
          <div className={styles.empty}>No staff.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Role</th>
                <th>Showroom</th>
                <th>Email</th>
                <th>Status</th>
                {canEdit && <th aria-label="actions" />}
              </tr>
            </thead>
            <tbody>
              {staffList.data!.map((s: StaffRow) => (
                <tr key={s.id}>
                  <td><code className={styles.code}>{s.staffCode}</code></td>
                  <td>{s.name}</td>
                  <td><span className={styles.rolePill}>{s.role.replace('_', ' ')}</span></td>
                  <td>{showroomName(s.showroomId)}</td>
                  <td>{s.email ? s.email : <span className={styles.muted}>—</span>}</td>
                  <td>
                    {s.active ? (
                      <span className={styles.statusActive}><CheckCircle2 size={14} strokeWidth={1.75} /> Active</span>
                    ) : (
                      <span className={styles.statusInactive}><Circle size={14} strokeWidth={1.75} /> Inactive</span>
                    )}
                  </td>
                  {canEdit && (
                    <td style={{ display: 'flex', gap: 'var(--space-2)' }}>
                      {s.role === 'sales' && (
                        <button
                          type="button"
                          className={styles.editBtn}
                          onClick={() => setPinDrawer({ open: true, staff: s })}
                          aria-label={`Set or reset PIN for ${s.staffCode}`}
                        >
                          Set / Reset PIN
                        </button>
                      )}
                      <button
                        type="button"
                        className={styles.editBtn}
                        disabled={updateActive.isPending}
                        onClick={() =>
                          updateActive.mutate({ id: s.id, active: !s.active })
                        }
                        aria-label={s.active ? `Deactivate ${s.staffCode}` : `Activate ${s.staffCode}`}
                      >
                        {s.active ? 'Deactivate' : 'Activate'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {drawerOpen && (
        <StaffDrawer
          showrooms={showrooms.data ?? []}
          existingCodes={(staffList.data ?? []).map((s) => s.staffCode)}
          onClose={() => setDrawerOpen(false)}
        />
      )}

      {pinDrawer.open && (
        <PinDrawer
          staff={pinDrawer.staff}
          onClose={() => setPinDrawer({ open: false })}
        />
      )}
    </>
  );
};

const StaffDrawer = ({
  showrooms,
  existingCodes,
  onClose,
}: {
  showrooms: ShowroomRow[];
  existingCodes: readonly string[];
  onClose: () => void;
}) => {
  const [name, setName] = useState('');
  const [role, setRole] = useState<StaffRoleValue>('sales');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [color, setColor] = useState<string>(STAFF_AVATAR_COLORS[0] ?? '#E86B3A');
  // Default role is 'sales', which requires a showroom — pre-select the first
  // one so the create button works out of the box on a single-showroom MVP.
  const [showroomId, setShowroomId] = useState<string>(showrooms[0]?.id ?? '');
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const createStaff = useCreateStaff();
  const saving = createStaff.isPending;

  const isSales = role === 'sales';

  // staffCode + initials are auto-derived from the existing roster — kept in
  // sync as the staff list refetches behind the scenes.
  const staffCode = useMemo(() => nextStaffCode(existingCodes), [existingCodes]);
  const initials = staffCode.replace(STAFF_CODE_PREFIX, '');

  // Flipping the role to sales while the showroom dropdown is on "All showrooms"
  // would otherwise leave showroomId as "" with no visible option — restore
  // the first real showroom so the select stays in sync with state.
  useEffect(() => {
    if (isSales && !showroomId && showrooms[0]?.id) {
      setShowroomId(showrooms[0].id);
    }
  }, [isSales, showroomId, showrooms]);

  const onSave = async () => {
    setError(null);
    if (!name.trim()) {
      setError('Name is required.');
      return;
    }
    if (!isSales && !email.trim()) {
      setError('Email is required for non-sales roles.');
      return;
    }
    if (isSales) {
      if (!showroomId) {
        setError('Sales staff must be assigned to a showroom.');
        return;
      }
      if (!/^\d{6}$/.test(pin)) {
        setError('PIN must be 6 digits.');
        return;
      }
      if (pin !== confirmPin) {
        setError("PINs don't match.");
        return;
      }
    }
    try {
      await createStaff.mutateAsync({
        staffCode,
        name:       name.trim(),
        role,
        email:      email.trim().toLowerCase() || null,
        initials,
        color,
        showroomId: showroomId || null,
        phone:      phone.trim() || null,
        pin:        isSales ? pin : undefined,
      });
      onClose();
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  return (
    <div className={styles.scrim} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHead}>
          <div>
            <div className="t-eyebrow">New staff</div>
            <h3 className={styles.drawerTitle}>Add a staff member</h3>
            <div className={styles.drawerSub}>
              {isSales
                ? 'Sales people sign in to POS with a 6-digit PIN. Email is optional — leave blank to auto-generate one.'
                : "They'll get a magic-link invite at the email you enter, set their own password, and can sign in once active."}
            </div>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X size={18} strokeWidth={1.75} />
          </button>
        </header>

        <div className={styles.drawerBody}>
          {error && <div className={styles.errorBanner}>{error}</div>}

          <div className={styles.banner}>
            Will be created as <code className={styles.code}>{staffCode}</code> ·
            avatar shows <strong>{initials}</strong>. Auto-generated from the
            roster — next free slot in the 2990S series.
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Full name</span>
            <input
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Aisha Wong"
            />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Role</span>
            <select
              className={styles.input}
              value={role}
              onChange={(e) => setRole(e.target.value as StaffRoleValue)}
            >
              {STAFF_ROLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
            <span className={styles.fieldHint}>Sales sign in to POS via PIN; everyone else uses the backend portal.</span>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Email{isSales ? <span className={styles.muted}> (optional)</span> : null}
            </span>
            <input
              className={styles.input}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder={isSales ? 'leave blank to auto-generate' : 'name@2990s.my'}
            />
            <span className={styles.fieldHint}>
              {isSales
                ? "Sales users don't receive email. Leave blank and we'll synthesize one."
                : 'Magic-link invite is sent here.'}
            </span>
          </label>

          {isSales && (
            <>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>PIN (6 digits)</span>
                <input
                  className={styles.input}
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={pin}
                  onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••••"
                  autoComplete="new-password"
                />
                <span className={styles.fieldHint}>You can change this later. Sales staff can't change their own PIN.</span>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Confirm PIN</span>
                <input
                  className={styles.input}
                  type="password"
                  inputMode="numeric"
                  pattern="\d{6}"
                  maxLength={6}
                  value={confirmPin}
                  onChange={(e) => setConfirmPin(e.target.value.replace(/\D/g, ''))}
                  placeholder="••••••"
                  autoComplete="new-password"
                />
              </label>
            </>
          )}

          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Showroom{isSales ? ' *' : null}
            </span>
            <select
              className={styles.input}
              value={showroomId}
              onChange={(e) => setShowroomId(e.target.value)}
              required={isSales}
            >
              {!isSales && (
                <option value="">All showrooms (oversees every location)</option>
              )}
              {showrooms.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            {isSales && (
              <span className={styles.fieldHint}>
                Sales staff must be assigned to a single showroom — orders they
                place are scoped to it.
              </span>
            )}
          </label>

          <div className={styles.field}>
            <span className={styles.fieldLabel}>Avatar color</span>
            <div className={styles.swatchRow}>
              {STAFF_AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={c === color ? `${styles.swatch} ${styles.swatchOn}` : styles.swatch}
                  style={{ background: c }}
                  onClick={() => setColor(c)}
                  aria-label={`Color ${c}`}
                  aria-pressed={c === color}
                />
              ))}
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Phone (optional)</span>
            <input
              className={styles.input}
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+60 12 345 6789"
            />
          </label>
        </div>

        <footer className={styles.drawerFoot}>
          <div className={styles.grow} />
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void onSave()} disabled={saving}>
            <Save size={16} strokeWidth={1.75} />
            {saving ? (isSales ? 'Creating…' : 'Inviting…') : (isSales ? 'Create POS user' : 'Send invite')}
          </Button>
        </footer>
      </div>
    </div>
  );
};

/* ─── App config (read-only at MVP) ─── */

const AppConfigTab = () => {
  const config = useAppConfig();

  return (
    <>
      <div className={styles.readOnlyBanner}>
        <strong>Read-only at MVP.</strong> These keys gate critical behaviour
        (owner email + price-bump bookkeeping). Edit via Supabase Studio for now.
      </div>
      {config.isLoading ? (
        <div className={styles.appConfigCard}>Loading…</div>
      ) : (config.data?.length ?? 0) === 0 ? (
        <div className={styles.appConfigCard}>No config keys.</div>
      ) : (
        <div className={styles.appConfigCard}>
          {config.data!.map((row) => (
            <div key={row.key} className={styles.appConfigRow}>
              <div>
                <div className={styles.appConfigKey}>{row.key}</div>
                {row.description && <div className={styles.fieldHint}>{row.description}</div>}
              </div>
              <div className={styles.appConfigValue}>{row.value}</div>
            </div>
          ))}
        </div>
      )}
    </>
  );
};

/* ─── Delivery fees (admin/coordinator) ─── */

const DeliveryFeesTab = ({ canEdit }: { canEdit: boolean }) => {
  const cfg = useDeliveryFeeConfig();
  const update = useUpdateDeliveryFeeConfig();

  const [baseFee, setBaseFee]                       = useState<number | ''>('');
  const [crossCategoryFee, setCrossCategoryFee]     = useState<number | ''>('');
  const [mattressDays, setMattressDays]             = useState<number | ''>('');
  const [sofaDays, setSofaDays]                     = useState<number | ''>('');
  const [error, setError]   = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Hydrate inputs once the GET resolves.
  useEffect(() => {
    if (cfg.data) {
      setBaseFee(cfg.data.baseFee);
      setCrossCategoryFee(cfg.data.crossCategoryFee);
      setMattressDays(cfg.data.mattressBedframeLeadDays);
      setSofaDays(cfg.data.sofaLeadDays);
    }
  }, [cfg.data]);

  const onSave = async () => {
    setError(null);
    setSuccess(false);
    if (
      typeof baseFee !== 'number' || typeof crossCategoryFee !== 'number' ||
      typeof mattressDays !== 'number' || typeof sofaDays !== 'number'
    ) {
      setError('All four fields must be whole-number integers.');
      return;
    }
    if (baseFee < 0 || crossCategoryFee < 0 || mattressDays < 0 || sofaDays < 0) {
      setError('Values cannot be negative.');
      return;
    }
    try {
      await update.mutateAsync({
        baseFee,
        crossCategoryFee,
        mattressBedframeLeadDays: mattressDays,
        sofaLeadDays: sofaDays,
      });
      setSuccess(true);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  if (cfg.isLoading) return <div className={styles.appConfigCard}>Loading delivery fees…</div>;
  if (cfg.error)     return <div className={styles.appConfigCard}>Failed to load: {String(cfg.error)}</div>;

  return (
    <>
      <div className={styles.readOnlyBanner}>
        <strong>Delivery fee rules.</strong> Every order is charged the base fee.
        Orders with products from ≥2 categories (e.g. sofa + mattress) also pay
        the cross-category surcharge — flat, once. Changes apply to NEW orders
        only — existing orders keep the fees they were placed with.
      </div>

      <div className={styles.appConfigCard}>
        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="base-fee">Base fee (RM)</label>
          <input
            id="base-fee"
            type="number"
            min={0}
            step={1}
            className={styles.input}
            value={baseFee}
            disabled={!canEdit}
            onChange={(e) => setBaseFee(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
          />
          <span className={styles.fieldHint}>Charged on every order. Whole RM (no sen).</span>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="cross-cat-fee">Cross-category surcharge (RM)</label>
          <input
            id="cross-cat-fee"
            type="number"
            min={0}
            step={1}
            className={styles.input}
            value={crossCategoryFee}
            disabled={!canEdit}
            onChange={(e) => setCrossCategoryFee(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
          />
          <span className={styles.fieldHint}>
            Added once, flat, when the order contains ≥2 distinct product categories.
            Sofa Custom + Sofa Bundle count as one category.
          </span>
        </div>

        <div className={styles.fieldGroupHead}>Delivery lead times</div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="mattress-days">Mattress + bed frame (days)</label>
          <input
            id="mattress-days"
            type="number"
            min={0}
            step={1}
            className={styles.input}
            value={mattressDays}
            disabled={!canEdit}
            onChange={(e) => setMattressDays(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
          />
          <span className={styles.fieldHint}>
            Minimum days from order date before a delivery date can be picked
            when the cart contains a mattress or bed frame.
          </span>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor="sofa-days">Sofa (days)</label>
          <input
            id="sofa-days"
            type="number"
            min={0}
            step={1}
            className={styles.input}
            value={sofaDays}
            disabled={!canEdit}
            onChange={(e) => setSofaDays(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
          />
          <span className={styles.fieldHint}>
            Minimum days from order date when the cart contains a sofa. Mixed
            carts use the larger of the two lead times.
          </span>
        </div>

        {error && <div className={styles.errorBanner} role="alert">{error}</div>}
        {success && <div className={styles.banner}>Saved.</div>}

        {canEdit && (
          <div className={styles.actionsRow}>
            <Button
              variant="primary"
              onClick={() => void onSave()}
              disabled={update.isPending}
            >
              <Save size={16} strokeWidth={1.75} />
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}

        <div className={styles.appConfigRow} style={{ marginTop: 'var(--space-3)' }}>
          <div>
            <div className={styles.appConfigKey}>Last updated</div>
          </div>
          <div className={styles.appConfigValue}>
            {cfg.data?.updatedAt
              ? new Date(cfg.data.updatedAt).toLocaleString('en-MY')
              : '—'}
          </div>
        </div>
      </div>
    </>
  );
};
