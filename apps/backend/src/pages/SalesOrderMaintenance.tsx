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
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import {
  useStateWarehouseMappings,
  useUpsertStateWarehouseMapping,
  useDeleteStateWarehouseMapping,
} from '../lib/state-warehouse-queries';
import { useWarehouses } from '../lib/inventory-queries';
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
