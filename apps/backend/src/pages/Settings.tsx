import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, X, Save, MessageCircle, Mail, CheckCircle2, Circle } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useAuth, isAdminLevel } from '../lib/auth';
import { useDrivers, useSuppliers, type DriverRow, type Supplier } from '../lib/queries';
import {
  useShowrooms,
  useAppConfig,
  useUpdateSupplier,
  useCreateSupplier,
  useUpdateDriver,
  useCreateDriver,
} from '../lib/admin-queries';
import { PhoneInput } from '../components/PhoneInput';
import { formatPhone, normalizePhone } from '@2990s/shared/phone';
import styles from './Settings.module.css';

type TabId = 'suppliers' | 'drivers' | 'showrooms' | 'app';

const TABS: { id: TabId; label: string }[] = [
  { id: 'suppliers',  label: 'Suppliers' },
  { id: 'drivers',    label: 'Drivers' },
  { id: 'showrooms',  label: 'Showrooms' },
  /* Task #110 — Localities tab moved to /mfg-sales-orders/maintenance
     (Commander 2026-05-27). It only powers the SO module's cascading
     customer-address dropdowns + the state→warehouse mapping that
     auto-suggests Sales Location, so it lives next to the SO list now. */
  { id: 'app',        label: 'App config' },
];

export const Settings = () => {
  const { staff } = useAuth();
  const [tab, setTab] = useState<TabId>('suppliers');

  const isAdmin = isAdminLevel(staff?.role);
  const isCoordOrAdmin = isAdminLevel(staff?.role) || staff?.role === 'coordinator';

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
      {tab === 'app' && <AppConfigTab />}
    </div>
  );
};

/* Task #110 — LocalitiesTab (State → Warehouse mapping + my_localities CRUD)
   moved to apps/backend/src/pages/SalesOrderMaintenance.tsx
   (Commander 2026-05-27). Reachable from the SO list toolbar + the
   sidebar's B2B Sales group. Don't reintroduce it here — keep the
   maintenance data next to the module that actually consumes it. */

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
                  <td>{formatPhone(d.phone)}</td>
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
    /* Task #91 — defensively re-normalize before submit. PhoneInput already
       does this on blur, but a user can click Save while the input is still
       focused, skipping blur. */
    const normalizedPhone = normalizePhone(phone) ?? phone.trim();
    try {
      if (mode === 'create') {
        await createDriver.mutateAsync({
          driverCode: code.trim(),
          name: name.trim(),
          phone: normalizedPhone,
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
            phone: normalizedPhone,
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
            {/* Task #91 — driver phones stored as E.164 via PhoneInput. */}
            <PhoneInput
              className={styles.input}
              value={phone}
              onChange={setPhone}
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
                  <td>{s.phone ? formatPhone(s.phone) : <span className={styles.muted}>—</span>}</td>
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
