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

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
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
  useCreateLocality, useUpdateLocality, useDeleteLocality,
  type LocalityRow,
} from '../lib/localities-queries';
import {
  useAllSoDropdownOptions,
  useCreateSoDropdownOption,
  useUpdateSoDropdownOption,
  useDeleteSoDropdownOption,
  type SoDropdownCategory,
  type SoDropdownOption,
} from '../lib/so-dropdown-options-queries';
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
              State → warehouse mapping · cascading address dropdowns ·
              customer / building / relationship / payment dropdowns
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
  const updateLoc = useUpdateLocality();
  const deleteLoc = useDeleteLocality();
  const toast = useToast();

  const states = useMemo(() => distinctStates(localities.data ?? []), [localities.data]);
  const mappedByState = useMemo(() => {
    const m = new Map<string, { warehouseId: string | null; notes: string | null }>();
    for (const row of mappings.data?.mappings ?? []) {
      m.set(row.state, { warehouseId: row.warehouseId, notes: row.notes });
    }
    return m;
  }, [mappings.data]);

  /* Task #120 — Optimistic mirror of the warehouse-per-state selection.
     Root cause of the "我选了 warehouse 可是没有反应" bug: the <select> was
     fully controlled by mappings.data, which only refreshes after the
     mutation's onSuccess invalidates the query. During the in-flight
     window the select snapped back to the prior value, so commander
     perceived no reaction. The local override below applies the new
     value immediately on change, then falls back to the persisted value
     once the query refetches. The pendingState set guards each state
     row so notes saves don't reset other rows' visible selections. */
  const [pendingByState, setPendingByState] = useState<Map<string, string | null>>(new Map());
  useEffect(() => {
    // Once the persisted mapping matches our optimistic value, drop the override.
    if (pendingByState.size === 0) return;
    const next = new Map(pendingByState);
    let changed = false;
    for (const [state, optimistic] of pendingByState) {
      const persisted = mappedByState.get(state)?.warehouseId ?? null;
      if (persisted === optimistic) {
        next.delete(state);
        changed = true;
      }
    }
    if (changed) setPendingByState(next);
  }, [mappedByState, pendingByState]);

  // Localities table state — filter + add-row form
  const [filterState, setFilterState] = useState<string>('');
  const [newState, setNewState] = useState('');
  const [newStateCode, setNewStateCode] = useState('');
  const [newCity, setNewCity] = useState('');
  const [newPostcode, setNewPostcode] = useState('');
  /* Task #121 — defaulted to Malaysia to match the column default; new
     foreign-state rows (Singapore, Thailand, ...) override before saving. */
  const [newCountry, setNewCountry] = useState('Malaysia');
  const filteredLocalities: LocalityRow[] = (localities.data ?? []).filter(
    (r) => !filterState || r.state === filterState,
  );

  const addLocality = () => {
    const payload = {
      state:     newState.trim(),
      stateCode: newStateCode.trim().toUpperCase(),
      city:      newCity.trim(),
      postcode:  newPostcode.trim(),
      country:   newCountry.trim() || 'Malaysia',
    };
    if (!payload.state || !payload.stateCode || !payload.city || !payload.postcode) {
      window.alert('All four fields are required.');
      return;
    }
    createLoc.mutate(payload, {
      onSuccess: () => {
        setNewState(''); setNewStateCode(''); setNewCity(''); setNewPostcode('');
        setNewCountry('Malaysia');
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
                /* Task #120 — Display the optimistic value when a mutation is
                   in flight for THIS state; otherwise fall back to the
                   persisted mapping. This eliminates the "snapped back to
                   old value" perception bug. */
                const displayWarehouseId = pendingByState.has(state)
                  ? pendingByState.get(state) ?? ''
                  : current?.warehouseId ?? '';
                return (
                  <tr key={state}>
                    <td><strong>{state}</strong></td>
                    <td>
                      <select
                        className={styles.input}
                        value={displayWarehouseId}
                        disabled={!canEdit}
                        onChange={(e) => {
                          const warehouseId = e.target.value || null;
                          // Optimistic UI flip so commander sees the change immediately.
                          setPendingByState((m) => {
                            const next = new Map(m);
                            next.set(state, warehouseId);
                            return next;
                          });
                          const wh = (warehouses.data ?? []).find((w) => w.id === warehouseId);
                          const wlabel = wh ? `${wh.code} · ${wh.name}` : 'Unassigned';
                          upsert.mutate(
                            { state, warehouseId, notes: current?.notes ?? null },
                            {
                              onSuccess: () => toast.success(`${state} → ${wlabel}`),
                              onError: (err) => {
                                // Roll back optimistic value if save failed.
                                setPendingByState((m) => {
                                  const next = new Map(m);
                                  next.delete(state);
                                  return next;
                                });
                                toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
                              },
                            },
                          );
                        }}
                      >
                        <option value="">— Unassigned —</option>
                        {(warehouses.data ?? []).filter((w) => w.is_active).map((w) => (
                          <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                        ))}
                      </select>
                      {warehouses.data && warehouses.data.filter((w) => w.is_active).length === 0 && (
                        <div className={styles.muted} style={{ fontSize: 'var(--fs-11)', marginTop: 4 }}>
                          No active warehouses — add one in <Link to="/warehouses">Warehouses</Link>.
                        </div>
                      )}
                    </td>
                    <td>
                      <input
                        className={styles.input}
                        defaultValue={current?.notes ?? ''}
                        key={`${state}-${current?.notes ?? ''}`}
                        disabled={!canEdit}
                        placeholder="Optional"
                        onBlur={(e) => {
                          const notes = e.target.value.trim() || null;
                          if ((current?.notes ?? null) === notes) return;
                          upsert.mutate(
                            { state, warehouseId: current?.warehouseId ?? null, notes },
                            {
                              onSuccess: () => toast.success(`Notes saved for ${state}`),
                              onError: (err) => toast.error(`Notes save failed: ${err instanceof Error ? err.message : String(err)}`),
                            },
                          );
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
                            onClick={() => remove.mutate(
                              { state },
                              {
                                onSuccess: () => {
                                  toast.success(`Cleared mapping for ${state}`);
                                  setPendingByState((m) => {
                                    const next = new Map(m);
                                    next.delete(state);
                                    return next;
                                  });
                                },
                                onError: (err) => toast.error(`Clear failed: ${err instanceof Error ? err.message : String(err)}`),
                              },
                            )}
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
          {/* Task #121 — explicit grid template so the new Country column
              has room without the surrounding columns collapsing. */}
          <div
            className={styles.addRowGrid}
            style={{ gridTemplateColumns: '1fr 100px 1fr 110px 120px auto' }}
          >
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
            <input
              className={styles.input}
              placeholder="Country (Malaysia)"
              value={newCountry}
              onChange={(e) => setNewCountry(e.target.value)}
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
                {/* Task #121 — editable Country column (default 'Malaysia'). */}
                <th>Country</th>
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
                  <td>
                    {canEdit && r.id ? (
                      /* onBlur persistence mirrors the State → Warehouse
                         "Notes" cell above — keeps the UX consistent and
                         avoids a per-row Save button. Skips the PATCH
                         when the value is unchanged. */
                      <input
                        className={styles.input}
                        defaultValue={r.country}
                        disabled={updateLoc.isPending}
                        onBlur={(e) => {
                          const next = e.target.value.trim();
                          if (!next || next === r.country) return;
                          updateLoc.mutate(
                            { id: r.id!, country: next },
                            { onError: (err) => window.alert(String((err as Error).message ?? err)) },
                          );
                        }}
                      />
                    ) : (
                      r.country
                    )}
                  </td>
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

      {/* ── Dropdowns CRUD (Task #118) ─────────────────────────────────
          One mini-table per category. Backed by so_dropdown_options
          (migration 0081) — replaces the four hardcoded TS consts that
          used to drive customer type / building type / relationship /
          payment method dropdowns. */}
      <DropdownsSection canEdit={canEdit} />
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

/* ──────────────────────────────────────────────────────────────────────────
   Dropdowns section — 4 collapsible sub-cards (one per category) backed
   by so_dropdown_options. Each card renders a mini-table with edit-in-
   place rows + an "+ Add option" affordance inline at the bottom.
   ────────────────────────────────────────────────────────────────────── */

const DROPDOWN_CARDS: Array<{ category: SoDropdownCategory; title: string; help: string }> = [
  {
    category: 'customer_type',
    title:    'Customer Type',
    help:     'Shown in the Customer card of SO Detail + New SO (NEW / EXISTING).',
  },
  {
    category: 'building_type',
    title:    'Building Type',
    help:     'Shown in the Order Info card. Condo / Landed / Apartment etc.',
  },
  {
    category: 'relationship',
    title:    'Relationship',
    help:     'Shown in the Emergency Contact card on New SO.',
  },
  {
    category: 'payment_method',
    title:    'Payment Method',
    help: 'Shown in the Payments table dropdown. Note: each label still maps to ' +
          'the internal payment_method enum (merchant / transfer / cash) via the ' +
          'PaymentsTable labelToApi() mapper — adding a brand new value here ' +
          'without updating that mapper will default to "cash".',
  },
];

const DropdownsSection = ({ canEdit }: { canEdit: boolean }) => {
  const all = useAllSoDropdownOptions();

  return (
    <>
      <div className={styles.banner} style={{ marginTop: 'var(--space-4)' }}>
        <strong>Dropdowns.</strong> Edit the values commander sees in the
        Customer Type / Building Type / Relationship / Payment Method
        selects on New SO and Edit SO. Used to be hardcoded in code — now
        editable here. Toggle <em>Active</em> off to hide a value from new
        SOs while keeping existing rows that reference it valid.
      </div>

      {all.isLoading ? (
        <div className={styles.tableCard}>
          <div className={styles.empty}>Loading dropdowns…</div>
        </div>
      ) : (
        DROPDOWN_CARDS.map((card) => (
          <DropdownCategoryCard
            key={card.category}
            category={card.category}
            title={card.title}
            help={card.help}
            rows={all.data?.[card.category] ?? []}
            canEdit={canEdit}
          />
        ))
      )}
    </>
  );
};

const DropdownCategoryCard = ({
  category, title, help, rows, canEdit,
}: {
  category: SoDropdownCategory;
  title:    string;
  help:     string;
  rows:     SoDropdownOption[];
  canEdit:  boolean;
}) => {
  const [expanded, setExpanded] = useState(true);

  const createOpt = useCreateSoDropdownOption();
  const updateOpt = useUpdateSoDropdownOption();
  const deleteOpt = useDeleteSoDropdownOption();

  // Add-row state
  const [newValue, setNewValue]    = useState('');
  const [newLabel, setNewLabel]    = useState('');
  const [newSort,  setNewSort]     = useState('');

  // Per-row edit buffers (uncommitted edits) — keyed by id.
  const [edits, setEdits] = useState<Record<string, Partial<{ value: string; label: string; sortOrder: number }>>>({});

  const commitRow = (row: SoDropdownOption) => {
    const buf = edits[row.id];
    if (!buf) return;
    const patch: Parameters<typeof updateOpt.mutate>[0] = { id: row.id };
    if (buf.value     !== undefined && buf.value     !== row.value)     patch.value     = buf.value;
    if (buf.label     !== undefined && buf.label     !== row.label)     patch.label     = buf.label;
    if (buf.sortOrder !== undefined && buf.sortOrder !== row.sortOrder) patch.sortOrder = buf.sortOrder;
    if (Object.keys(patch).length === 1) {
      // no real change — just clear the buffer
      setEdits((e) => { const next = { ...e }; delete next[row.id]; return next; });
      return;
    }
    updateOpt.mutate(patch, {
      onSuccess: () => {
        setEdits((e) => { const next = { ...e }; delete next[row.id]; return next; });
      },
      onError: (err) => window.alert(`Update failed: ${(err as Error).message ?? err}`),
    });
  };

  const toggleActive = (row: SoDropdownOption) => {
    updateOpt.mutate(
      { id: row.id, active: !row.active },
      { onError: (err) => window.alert(`Update failed: ${(err as Error).message ?? err}`) },
    );
  };

  const removeRow = (row: SoDropdownOption) => {
    if (!confirm(`Delete "${row.label}" from ${title}? Historical SOs that reference "${row.value}" stay valid; this just removes the option from new dropdowns.`)) return;
    deleteOpt.mutate(row.id, {
      onError: (err) => window.alert(`Delete failed: ${(err as Error).message ?? err}`),
    });
  };

  const addRow = () => {
    const value = newValue.trim();
    const label = newLabel.trim();
    if (!value || !label) {
      window.alert('Both Value and Label are required.');
      return;
    }
    const sortOrder = newSort.trim() ? Number(newSort.trim()) : (rows.length + 1);
    if (Number.isNaN(sortOrder)) {
      window.alert('Sort must be a number.');
      return;
    }
    createOpt.mutate(
      { category, value, label, sortOrder },
      {
        onSuccess: () => { setNewValue(''); setNewLabel(''); setNewSort(''); },
        onError:   (err) => window.alert(`Add failed: ${(err as Error).message ?? err}`),
      },
    );
  };

  return (
    <div className={styles.tableCard} style={{ marginBottom: 'var(--space-3)' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          width: '100%',
          background: 'var(--bg-alt)',
          border: 'none',
          borderBottom: '1px solid var(--line)',
          padding: 'var(--space-3) var(--space-4)',
          cursor: 'pointer',
          textAlign: 'left',
          fontFamily: 'var(--font-button)',
          fontWeight: 600,
          fontSize: 'var(--fs-13)',
          color: 'var(--fg)',
        }}
      >
        {expanded
          ? <ChevronDown  size={14} strokeWidth={1.75} />
          : <ChevronRight size={14} strokeWidth={1.75} />}
        <span>{title}</span>
        <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 'var(--fs-12)' }}>
          · {rows.length} {rows.length === 1 ? 'option' : 'options'}
        </span>
      </button>

      {expanded && (
        <>
          <div style={{
            padding: 'var(--space-2) var(--space-4)',
            fontSize: 'var(--fs-12)',
            color: 'var(--fg-muted)',
            background: 'var(--c-cream)',
            borderBottom: '1px solid var(--line)',
          }}>
            {help}
          </div>

          {rows.length === 0 ? (
            <div className={styles.empty}>No options yet — add one below.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: '25%' }}>Value</th>
                  <th style={{ width: '40%' }}>Label</th>
                  <th style={{ width: 80 }}>Sort</th>
                  <th style={{ width: 80 }}>Active</th>
                  {canEdit && <th style={{ width: 60 }} aria-label="actions" />}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const buf = edits[row.id] ?? {};
                  const curValue     = buf.value     ?? row.value;
                  const curLabel     = buf.label     ?? row.label;
                  const curSortOrder = buf.sortOrder ?? row.sortOrder;
                  const dirty =
                    curValue     !== row.value ||
                    curLabel     !== row.label ||
                    curSortOrder !== row.sortOrder;
                  return (
                    <tr key={row.id}>
                      <td>
                        <input
                          className={styles.input}
                          value={curValue}
                          disabled={!canEdit || updateOpt.isPending}
                          onChange={(e) => setEdits((s) => ({
                            ...s, [row.id]: { ...s[row.id], value: e.target.value },
                          }))}
                          onBlur={() => commitRow(row)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRow(row); }}
                        />
                      </td>
                      <td>
                        <input
                          className={styles.input}
                          value={curLabel}
                          disabled={!canEdit || updateOpt.isPending}
                          onChange={(e) => setEdits((s) => ({
                            ...s, [row.id]: { ...s[row.id], label: e.target.value },
                          }))}
                          onBlur={() => commitRow(row)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRow(row); }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className={styles.input}
                          value={curSortOrder}
                          disabled={!canEdit || updateOpt.isPending}
                          onChange={(e) => setEdits((s) => ({
                            ...s, [row.id]: { ...s[row.id], sortOrder: Number(e.target.value) || 0 },
                          }))}
                          onBlur={() => commitRow(row)}
                          onKeyDown={(e) => { if (e.key === 'Enter') commitRow(row); }}
                        />
                      </td>
                      <td>
                        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <input
                            type="checkbox"
                            checked={row.active}
                            disabled={!canEdit || updateOpt.isPending}
                            onChange={() => toggleActive(row)}
                          />
                          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                            {row.active ? 'Yes' : 'No'}
                          </span>
                        </label>
                      </td>
                      {canEdit && (
                        <td>
                          {dirty && (
                            <button
                              type="button"
                              className={styles.editBtn}
                              disabled={updateOpt.isPending}
                              onClick={() => commitRow(row)}
                              style={{ marginRight: 4 }}
                            >
                              Save
                            </button>
                          )}
                          <button
                            type="button"
                            className={styles.editBtn}
                            disabled={deleteOpt.isPending}
                            onClick={() => removeRow(row)}
                            aria-label="Delete option"
                          >
                            <Trash2 size={14} strokeWidth={1.75} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {canEdit && (
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1.5fr 80px auto',
              gap: 'var(--space-2)',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--bg-alt)',
              borderTop: rows.length > 0 ? '1px solid var(--line)' : undefined,
            }}>
              <input
                className={styles.input}
                placeholder="Value (e.g. NEW)"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
              />
              <input
                className={styles.input}
                placeholder="Label (e.g. New customer)"
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <input
                type="number"
                className={styles.input}
                placeholder="Sort"
                value={newSort}
                onChange={(e) => setNewSort(e.target.value)}
              />
              <Button
                variant="primary"
                size="md"
                onClick={addRow}
                disabled={createOpt.isPending}
              >
                <Plus size={14} strokeWidth={1.75} />
                Add
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
};

