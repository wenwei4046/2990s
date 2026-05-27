// ----------------------------------------------------------------------------
// SalesOrderMaintenance — single-purpose page that owns the State → Warehouse
// mapping CRUD + the States/Cities/Postcodes CRUD that drives the SO module's
// cascading customer-address dropdowns.
//
// History: this content lived inside Settings → "Localities" tab (added in
// PR #158 + PR #160). Commander 2026-05-27 moved it out — "我觉得 localities
// 搬过去 salesorder 那边开一个 button 好像 salesorder maintenance" — because
// the data is only consumed by the Sales Order module (Customer Card cascading
// dropdowns + auto-suggest of Sales Location from dispatch warehouse) and
// doesn't belong in the generic Settings tab.
//
// Entry points:
//   - Toolbar button on /mfg-sales-orders (Maintenance button)
//   - Sidebar B2B Sales → SO Maintenance
//   - Direct URL /mfg-sales-orders/maintenance
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
import {
  useStateWarehouseMappings,
  useUpsertStateWarehouseMapping,
  useDeleteStateWarehouseMapping,
} from '../lib/state-warehouse-queries';
import {
  useWarehouses,
  useCreateWarehouse,
  useUpdateWarehouse,
  useDeleteWarehouse,
} from '../lib/inventory-queries';
import {
  useLocalities, distinctStates,
  useCreateLocality, useDeleteLocality,
  type LocalityRow,
} from '../lib/localities-queries';
import styles from './SalesOrderMaintenance.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export const SalesOrderMaintenance = () => {
  const { staff } = useAuth();
  const canEdit = staff?.role === 'admin' || staff?.role === 'coordinator';

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/mfg-sales-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Sales Orders</span>
          </Link>
          <div>
            <h1 className={styles.title}>Sales Order Maintenance</h1>
            <p className={styles.subtitle}>
              State → warehouse mapping · cascading dropdowns for customer addresses
            </p>
          </div>
        </div>
      </div>

      {!canEdit && (
        <div className={styles.readOnlyBanner}>
          <strong>Read-only view.</strong> Maintenance changes are admin/coordinator-only.
        </div>
      )}

      <MaintenanceBody canEdit={canEdit} />
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
   Maintenance body — formerly LocalitiesTab in Settings.tsx.
   - Top: State → Warehouse mapping CRUD (state_warehouse_mappings table)
   - Bottom: States / Cities / Postcodes CRUD on my_localities */

const MaintenanceBody = ({ canEdit }: { canEdit: boolean }) => {
  const mappings = useStateWarehouseMappings();
  const warehouses = useWarehouses();
  const localities = useLocalities();
  const upsert = useUpsertStateWarehouseMapping();
  const remove = useDeleteStateWarehouseMapping();
  const createLoc = useCreateLocality();
  const deleteLoc = useDeleteLocality();

  const states = useMemo(() => distinctStates(localities.data ?? []), [localities.data]);
  const mappedByState = useMemo(() => {
    const m = new Map<string, { warehouseId: string | null; notes: string | null }>();
    for (const row of mappings.data?.mappings ?? []) {
      m.set(row.state, { warehouseId: row.warehouseId, notes: row.notes });
    }
    return m;
  }, [mappings.data]);

  // Localities table state — filter + add-row form
  const [filterState, setFilterState] = useState<string>('');
  const [newState, setNewState] = useState('');
  const [newStateCode, setNewStateCode] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newPostcode, setNewPostcode] = useState('');
  const filteredLocalities: LocalityRow[] = (localities.data ?? []).filter(
    (r) => !filterState || r.state === filterState,
  );

  const addLocality = () => {
    const payload = {
      state:     newState.trim(),
      stateCode: newStateCode.trim().toUpperCase(),
      city:      newCity.trim(),
      postcode:  newPostcode.trim(),
    };
    if (!payload.state || !payload.stateCode || !payload.city || !payload.postcode) {
      window.alert('All four fields are required.');
      return;
    }
    createLoc.mutate(payload, {
      onSuccess: () => {
        setNewState(''); setNewStateCode(''); setNewCity(''); setNewPostcode('');
      },
      onError: (err) => window.alert(String((err as Error).message ?? err)),
    });
  };

  return (
    <>
      <div className={styles.banner}>
        <strong>State → Warehouse mapping.</strong> Pick the dispatch warehouse
        for each state. When a customer's delivery address is in that state, the
        SO Detail page suggests this warehouse as the Sales Location automatically.
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

      {/* ── Warehouses inline CRUD (Task #121) ─────────────────────────
          Commander 2026-05-27: coordinator on SO Maintenance needs to
          create a new warehouse without bouncing to /warehouses. Order
          on the page is intentional — warehouses come BEFORE the State →
          Warehouse mapping so a freshly typed warehouse is immediately
          pickable in the dropdown above. */}
      <WarehouseCrudSection canEdit={canEdit} />

      {/* ── States / Cities / Postcodes CRUD (formerly Settings tab) ───── */}
      <div className={styles.banner} style={{ marginTop: 'var(--space-4)' }}>
        <strong>States / Cities / Postcodes.</strong> Editable list of rows in
        my_localities — every (state, city, postcode) the SO + POS dropdowns
        offer comes from here. Add new rows below; delete with the whole-row
        trash icon to drop one.
      </div>

      {canEdit && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>Add a row</div>
          <div className={styles.addRowGrid}>
            <input
              className={styles.input}
              placeholder="State (e.g. Selangor)"
              value={newState}
              onChange={(e) => setNewState(e.target.value)}
            />
            <input
              className={styles.input}
              placeholder="Code (SGR)"
              value={newStateCode}
              onChange={(e) => setNewStateCode(e.target.value)}
              maxLength={5}
            />
            <input
              className={styles.input}
              placeholder="City (Petaling Jaya)"
              value={newCity}
              onChange={(e) => setNewCity(e.target.value)}
            />
            <input
              className={styles.input}
              placeholder="Postcode (47301)"
              value={newPostcode}
              onChange={(e) => setNewPostcode(e.target.value)}
              maxLength={10}
            />
            <Button
              variant="primary"
              size="md"
              onClick={addLocality}
              disabled={createLoc.isPending}
            >
              <Plus size={14} strokeWidth={1.75} />
              Add
            </Button>
          </div>
        </div>
      )}

      <div className={styles.tableCard}>
        <div className={styles.filterBar}>
          <label className={styles.filterLabel}>
            <span className={styles.muted}>Filter by state:</span>
            <select
              className={`${styles.input} ${styles.filterSelect}`}
              value={filterState}
              onChange={(e) => setFilterState(e.target.value)}
            >
              <option value="">All states ({(localities.data ?? []).length} rows)</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
        </div>
        {localities.isLoading ? (
          <div className={styles.empty}>Loading…</div>
        ) : filteredLocalities.length === 0 ? (
          <div className={styles.empty}>No rows.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>State</th>
                <th>Code</th>
                <th>City</th>
                <th>Postcode</th>
                {canEdit && <th aria-label="actions" />}
              </tr>
            </thead>
            <tbody>
              {filteredLocalities.slice(0, 500).map((r) => (
                <tr key={r.id ?? `${r.state}-${r.city}-${r.postcode}`}>
                  <td>{r.state}</td>
                  <td><code className={styles.code}>{r.stateCode}</code></td>
                  <td>{r.city}</td>
                  <td><code className={styles.code}>{r.postcode}</code></td>
                  {canEdit && (
                    <td>
                      {r.id && (
                        <button
                          type="button"
                          className={styles.editBtn}
                          disabled={deleteLoc.isPending}
                          onClick={() => {
                            if (confirm(`Delete ${r.state} / ${r.city} / ${r.postcode}?`)) {
                              deleteLoc.mutate(r.id!);
                            }
                          }}
                          aria-label="Delete locality row"
                        >
                          <Trash2 size={14} strokeWidth={1.75} />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {filteredLocalities.length > 500 && (
          <div className={styles.empty} style={{ fontSize: 'var(--fs-12)' }}>
            Showing first 500 of {filteredLocalities.length} — use the filter above to narrow down.
          </div>
        )}
      </div>
    </>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
   Warehouse CRUD section — inline mini-table + add-row.

   Task #121 / Commander 2026-05-27: "也不能在 sales order maintenance 这边
   create warehouse". The full /warehouses page (which lives under Inventory)
   stays untouched — this is just a parallel quick-edit affordance for the
   coordinator while they're already on SO Maintenance.

   Maps to the warehouses table:
     - Code     → warehouses.code   (uppercase, unique)
     - Name     → warehouses.name
     - Address  → warehouses.location  (free-text, single line on this page;
                                        /warehouses uses the same column)
     - Active   → warehouses.is_active toggle
     - Delete   → DELETE /inventory/warehouses/:id (409 in_use when there
                  are FK refs from movements/lots, in which case the UI
                  asks the coordinator to deactivate instead).
   ────────────────────────────────────────────────────────────────────────── */

const WarehouseCrudSection = ({ canEdit }: { canEdit: boolean }) => {
  /* Show inactive too — the inline table doubles as the only place a
     coordinator on SO Maintenance can reactivate a deactivated warehouse
     without navigating to /warehouses. */
  const warehouses    = useWarehouses({ includeInactive: true });
  const createWh      = useCreateWarehouse();
  const updateWh      = useUpdateWarehouse();
  const deleteWh      = useDeleteWarehouse();

  const [newCode, setNewCode]       = useState('');
  const [newName, setNewName]       = useState('');
  const [newAddress, setNewAddress] = useState('');

  const submitNew = () => {
    const code = newCode.trim().toUpperCase();
    const name = newName.trim();
    if (!code || !name) {
      window.alert('Code and Name are required.');
      return;
    }
    createWh.mutate(
      { code, name, location: newAddress.trim() || undefined },
      {
        onSuccess: () => { setNewCode(''); setNewName(''); setNewAddress(''); },
        onError: (err) => window.alert(String((err as Error).message ?? err)),
      },
    );
  };

  const removeWh = (id: string, code: string) => {
    if (!confirm(`Delete warehouse ${code}? This cannot be undone — toggle Active off instead if the warehouse has any history.`)) return;
    deleteWh.mutate(id, {
      onError: (err) => {
        const msg = String((err as Error).message ?? err);
        if (msg.includes('409')) {
          window.alert(
            `Can't delete ${code} — it's referenced by existing inventory movements / lots. ` +
            `Toggle the Active checkbox off instead to retire it without losing history.`,
          );
        } else {
          window.alert(msg);
        }
      },
    });
  };

  return (
    <>
      <div className={styles.banner} style={{ marginTop: 'var(--space-4)' }}>
        <strong>Warehouses.</strong> Quick CRUD for the warehouses available
        to the State → Warehouse mapping above. Full management
        (default warehouse, deeper edits) still lives at <code className={styles.code}>/warehouses</code>.
      </div>

      {canEdit && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>Add a warehouse</div>
          <div
            className={styles.addRowGrid}
            style={{ gridTemplateColumns: '120px 1fr 1fr auto' }}
          >
            <input
              className={styles.input}
              placeholder="Code (KL / PJ)"
              value={newCode}
              onChange={(e) => setNewCode(e.target.value.toUpperCase())}
              maxLength={10}
            />
            <input
              className={styles.input}
              placeholder="Name (e.g. KL Warehouse)"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
            />
            <input
              className={styles.input}
              placeholder="Address (optional)"
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value)}
            />
            <Button
              variant="primary"
              size="md"
              onClick={submitNew}
              disabled={createWh.isPending}
            >
              <Plus size={14} strokeWidth={1.75} />
              Add
            </Button>
          </div>
        </div>
      )}

      <div className={styles.tableCard}>
        {warehouses.isLoading ? (
          <div className={styles.empty}>Loading…</div>
        ) : (warehouses.data ?? []).length === 0 ? (
          <div className={styles.empty}>No warehouses yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 110 }}>Code</th>
                <th>Name</th>
                <th>Address</th>
                <th style={{ width: 90 }}>Active</th>
                {canEdit && <th aria-label="actions" style={{ width: 70 }} />}
              </tr>
            </thead>
            <tbody>
              {(warehouses.data ?? []).map((w) => (
                <tr key={w.id}>
                  <td><code className={styles.code}>{w.code}</code></td>
                  <td>{w.name}</td>
                  <td>{w.location ?? '—'}</td>
                  <td>
                    <input
                      type="checkbox"
                      checked={w.is_active}
                      disabled={!canEdit || updateWh.isPending}
                      onChange={(e) =>
                        updateWh.mutate({ id: w.id, isActive: e.target.checked })
                      }
                      aria-label={`Toggle ${w.code} active`}
                    />
                  </td>
                  {canEdit && (
                    <td>
                      <button
                        type="button"
                        className={styles.editBtn}
                        disabled={deleteWh.isPending}
                        onClick={() => removeWh(w.id, w.code)}
                        aria-label={`Delete warehouse ${w.code}`}
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
};
