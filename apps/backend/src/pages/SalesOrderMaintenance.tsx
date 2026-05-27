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
   - Bottom: Geo registry — Country L1 → State L2 → City L3 drill-down
     (replaces the old flat 2933-row States/Cities/Postcodes table). */

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

  /* Commander 2026-05-27: 4-level drill-down — Country L1 → State L2 →
     City L3 → Postcode L4. State L2 also exposes an inline Country edit
     cell so a state can be moved to a different country in one shot
     (bulk PATCH on every locality under that state). */
  const [geoView, setGeoView]                 = useState<'country' | 'state' | 'city' | 'postcode'>('country');
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [selectedState,   setSelectedState]   = useState<string>('');
  const [selectedCity,    setSelectedCity]    = useState<string>('');
  const [newState,    setNewState]    = useState('');
  const [newStateCode, setNewStateCode] = useState('');
  const [newCity,     setNewCity]     = useState('');
  const [newPostcode, setNewPostcode] = useState('');
  const [newCountry, setNewCountry] = useState('Malaysia');

  /* Group localities by (country) → (country, state) for the L1 + L2 stat
     tiles, computed once per data refresh. */
  const localityGroups = useMemo(() => {
    const rows = localities.data ?? [];
    const byCountry = new Map<string, {
      country: string;
      states: Set<string>;
      cities: Set<string>;
      postcodeCount: number;
    }>();
    const byCountryState = new Map<string, {
      country: string;
      state: string;
      stateCode: string;
      cities: Set<string>;
      postcodeCount: number;
    }>();
    for (const r of rows) {
      const c = r.country || 'Malaysia';
      const cKey = c;
      const csKey = `${c}|${r.state}`;
      if (!byCountry.has(cKey)) {
        byCountry.set(cKey, { country: c, states: new Set(), cities: new Set(), postcodeCount: 0 });
      }
      const cAgg = byCountry.get(cKey)!;
      cAgg.states.add(r.state);
      cAgg.cities.add(`${r.state}|${r.city}`);
      cAgg.postcodeCount += 1;
      if (!byCountryState.has(csKey)) {
        byCountryState.set(csKey, { country: c, state: r.state, stateCode: r.stateCode, cities: new Set(), postcodeCount: 0 });
      }
      const csAgg = byCountryState.get(csKey)!;
      csAgg.cities.add(r.city);
      csAgg.postcodeCount += 1;
    }
    return {
      countries: Array.from(byCountry.values()).sort((a, b) => a.country.localeCompare(b.country)),
      statesByCountry: byCountryState,
    };
  }, [localities.data]);

  /* All localities matching (selectedCountry, selectedState). */
  const stateLocalities: LocalityRow[] = useMemo(() => {
    if (!selectedCountry || !selectedState) return [];
    return (localities.data ?? [])
      .filter((r) => (r.country || 'Malaysia') === selectedCountry && r.state === selectedState);
  }, [localities.data, selectedCountry, selectedState]);

  /* L3 = distinct cities under selectedState, with postcode count badge. */
  const citiesInState = useMemo(() => {
    const byCity = new Map<string, { city: string; postcodeCount: number }>();
    for (const r of stateLocalities) {
      if (!byCity.has(r.city)) byCity.set(r.city, { city: r.city, postcodeCount: 0 });
      byCity.get(r.city)!.postcodeCount += 1;
    }
    return Array.from(byCity.values()).sort((a, b) => a.city.localeCompare(b.city));
  }, [stateLocalities]);

  /* L4 = postcodes under (selectedState, selectedCity) — the actual leaf rows. */
  const postcodeRows: LocalityRow[] = useMemo(() => {
    if (!selectedCity) return [];
    return stateLocalities
      .filter((r) => r.city === selectedCity)
      .sort((a, b) => a.postcode.localeCompare(b.postcode));
  }, [stateLocalities, selectedCity]);

  const addLocality = () => {
    /* L4 (postcode view) locks country + state + city; only Postcode
       input is shown. L3 (city view) locks country + state; user enters
       City + Postcode. Lower levels currently can't add (commander adds
       a new state by opening a new state row at L2 — out of scope for
       this PR; for now Malaysia's 16 states are seeded). */
    const lockedCountry   = geoView !== 'country' && selectedCountry ? selectedCountry : '';
    const lockedState     = (geoView === 'city' || geoView === 'postcode') && selectedState ? selectedState : '';
    const lockedCity      = geoView === 'postcode' && selectedCity ? selectedCity : '';
    const lockedStateCode = lockedState
      ? (localityGroups.statesByCountry.get(`${lockedCountry}|${lockedState}`)?.stateCode ?? '')
      : '';
    const payload = {
      state:     (lockedState || newState).trim(),
      stateCode: (lockedStateCode || newStateCode).trim().toUpperCase(),
      city:      (lockedCity || newCity).trim(),
      postcode:  newPostcode.trim(),
      country:   (lockedCountry || newCountry).trim() || 'Malaysia',
    };
    if (!payload.state || !payload.stateCode || !payload.city || !payload.postcode) {
      window.alert('State, State Code, City and Postcode are all required.');
      return;
    }
    createLoc.mutate(payload, {
      onSuccess: () => {
        setNewState(''); setNewStateCode(''); setNewCity(''); setNewPostcode('');
        if (!lockedCountry) setNewCountry('Malaysia');
      },
      onError: (err) => window.alert(String((err as Error).message ?? err)),
    });
  };

  /* Move every locality under a state to a new country in one shot.
     Commander 2026-05-27: "然后我这些 state 要怎样换 country？包过 state".
     Done client-side via parallel PATCHes — for a typical state (~150
     postcodes) this is a few-hundred-ms hit, acceptable for an admin
     action. If perf becomes an issue, add a bulk endpoint later. */
  const moveStateToCountry = async (state: string, fromCountry: string, toCountry: string) => {
    const trimmed = toCountry.trim();
    if (!trimmed || trimmed === fromCountry) return;
    const rows = (localities.data ?? []).filter(
      (r) => (r.country || 'Malaysia') === fromCountry && r.state === state && r.id,
    );
    if (rows.length === 0) return;
    if (!confirm(
      `Move all ${rows.length} localities under ${state} from "${fromCountry}" to "${trimmed}"?`,
    )) return;
    try {
      await Promise.all(rows.map((r) =>
        updateLoc.mutateAsync({ id: r.id!, country: trimmed }),
      ));
    } catch (err) {
      window.alert(`Move failed partway: ${String((err as Error).message ?? err)}`);
    }
  };

  /* Navigation helpers — keep view state self-consistent. */
  const goToCountry      = () => { setGeoView('country'); setSelectedCountry(''); setSelectedState(''); setSelectedCity(''); };
  const goToState        = () => { setGeoView('state');   setSelectedState(''); setSelectedCity(''); };
  const goToCity         = () => { setGeoView('city');    setSelectedCity(''); };
  const drillIntoCountry = (c: string) => { setSelectedCountry(c); setGeoView('state');    setSelectedState(''); setSelectedCity(''); };
  const drillIntoState   = (s: string) => { setSelectedState(s);   setGeoView('city');     setSelectedCity(''); };
  const drillIntoCity    = (c: string) => { setSelectedCity(c);    setGeoView('postcode'); };

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

      {/* ── Geo registry: Country L1 → State L2 → City L3 → Postcode L4 ──
          Commander 2026-05-27: 4-level drill-down so each level lists its
          own concept only — Malaysia isn't repeated 2933 times, cities
          don't appear once per postcode, etc. State rows expose an
          inline Country edit cell that bulk-moves every locality under
          that state to the new country. */}
      <div className={styles.banner} style={{ marginTop: 'var(--space-4)' }}>
        <strong>Geo registry.</strong>{' '}
        {geoView === 'country'  && <>L1 · Countries. Click a country to drill into its states.</>}
        {geoView === 'state'    && <>L2 · States in {selectedCountry}. Edit Country inline to move a state. Click a state for its cities.</>}
        {geoView === 'city'     && <>L3 · Cities in {selectedState}, {selectedCountry}. Click a city for its postcodes.</>}
        {geoView === 'postcode' && <>L4 · Postcodes in {selectedCity}, {selectedState}. Edit / delete leaf rows here.</>}
      </div>

      {/* Breadcrumb — visible at L2 + L3 + L4 so the user can step back up. */}
      {geoView !== 'country' && (
        <div className={styles.filterBar} style={{ marginBottom: 'var(--space-2)' }}>
          <button type="button" className={styles.editBtn} onClick={goToCountry}>
            ← All countries
          </button>
          {(geoView === 'city' || geoView === 'postcode') && (
            <button
              type="button"
              className={styles.editBtn}
              onClick={goToState}
              style={{ marginLeft: 'var(--space-2)' }}
            >
              ← {selectedCountry} (states)
            </button>
          )}
          {geoView === 'postcode' && (
            <button
              type="button"
              className={styles.editBtn}
              onClick={goToCity}
              style={{ marginLeft: 'var(--space-2)' }}
            >
              ← {selectedState} (cities)
            </button>
          )}
          <span className={styles.muted} style={{ marginLeft: 'var(--space-3)' }}>
            {geoView === 'state'    && selectedCountry}
            {geoView === 'city'     && `${selectedCountry} / ${selectedState}`}
            {geoView === 'postcode' && `${selectedCountry} / ${selectedState} / ${selectedCity}`}
          </span>
        </div>
      )}

      {/* L1 — Country listing. Add Country form requires seeding one
          (state, stateCode, city, postcode) row because my_localities is
          the atomic table — there's no Country row independent of its
          first state. Commander 2026-05-27: "我需要可以添加 country then
          in country can add on state then in state i can add on cities
          then in cities can add on postcode". */}
      {geoView === 'country' && canEdit && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>Add a country (seeds one state + city + postcode)</div>
          <div
            className={styles.addRowGrid}
            style={{ gridTemplateColumns: '1fr 1fr 100px 1fr 110px auto' }}
          >
            <input className={styles.input} placeholder="Country (e.g. Singapore)"
              value={newCountry} onChange={(e) => setNewCountry(e.target.value)} />
            <input className={styles.input} placeholder="State (e.g. Central)"
              value={newState} onChange={(e) => setNewState(e.target.value)} />
            <input className={styles.input} placeholder="Code (SGC)" maxLength={5}
              value={newStateCode} onChange={(e) => setNewStateCode(e.target.value)} />
            <input className={styles.input} placeholder="City (Bugis)"
              value={newCity} onChange={(e) => setNewCity(e.target.value)} />
            <input className={styles.input} placeholder="Postcode (188022)" maxLength={10}
              value={newPostcode} onChange={(e) => setNewPostcode(e.target.value)} />
            <Button variant="primary" size="md" onClick={addLocality} disabled={createLoc.isPending}>
              <Plus size={14} strokeWidth={1.75} /> Add
            </Button>
          </div>
        </div>
      )}
      {geoView === 'country' && (
        <div className={styles.tableCard}>
          {localities.isLoading ? (
            <div className={styles.empty}>Loading…</div>
          ) : localityGroups.countries.length === 0 ? (
            <div className={styles.empty}>No localities yet.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Country</th>
                  <th style={{ width: 110, textAlign: 'right' }}>States</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Cities</th>
                  <th style={{ width: 130, textAlign: 'right' }}>Postcodes</th>
                  <th style={{ width: 90 }} aria-label="drill" />
                </tr>
              </thead>
              <tbody>
                {localityGroups.countries.map((c) => (
                  <tr
                    key={c.country}
                    onClick={() => drillIntoCountry(c.country)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td><strong>{c.country}</strong></td>
                    <td style={{ textAlign: 'right' }}>{c.states.size}</td>
                    <td style={{ textAlign: 'right' }}>{c.cities.size}</td>
                    <td style={{ textAlign: 'right' }}>{c.postcodeCount}</td>
                    <td>
                      <button type="button" className={styles.editBtn}>
                        Open →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* L2 — Add State form: requires first (city, postcode) too. */}
      {geoView === 'state' && canEdit && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>Add a state in {selectedCountry} (seeds first city + postcode)</div>
          <div
            className={styles.addRowGrid}
            style={{ gridTemplateColumns: '1fr 100px 1fr 130px auto' }}
          >
            <input className={styles.input} placeholder="State (e.g. Selangor)"
              value={newState} onChange={(e) => setNewState(e.target.value)} />
            <input className={styles.input} placeholder="Code (SGR)" maxLength={5}
              value={newStateCode} onChange={(e) => setNewStateCode(e.target.value)} />
            <input className={styles.input} placeholder="City (Petaling Jaya)"
              value={newCity} onChange={(e) => setNewCity(e.target.value)} />
            <input className={styles.input} placeholder="Postcode (47301)" maxLength={10}
              value={newPostcode} onChange={(e) => setNewPostcode(e.target.value)} />
            <Button variant="primary" size="md" onClick={addLocality} disabled={createLoc.isPending}>
              <Plus size={14} strokeWidth={1.75} /> Add
            </Button>
          </div>
        </div>
      )}

      {/* L2 — State listing within selectedCountry. Country cell is
          editable so a state can be moved to a different country (bulk
          PATCH on every locality under that state). */}
      {geoView === 'state' && (
        <div className={styles.tableCard}>
          {(() => {
            const statesInCountry = Array.from(localityGroups.statesByCountry.values())
              .filter((s) => s.country === selectedCountry)
              .sort((a, b) => a.state.localeCompare(b.state));
            if (statesInCountry.length === 0) {
              return <div className={styles.empty}>No states under {selectedCountry}.</div>;
            }
            return (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>State</th>
                    <th style={{ width: 100 }}>Code</th>
                    <th style={{ width: 140 }}>Country</th>
                    <th style={{ width: 110, textAlign: 'right' }}>Cities</th>
                    <th style={{ width: 130, textAlign: 'right' }}>Postcodes</th>
                    <th style={{ width: 90 }} aria-label="drill" />
                  </tr>
                </thead>
                <tbody>
                  {statesInCountry.map((s) => (
                    <tr key={s.state}>
                      <td
                        onClick={() => drillIntoState(s.state)}
                        style={{ cursor: 'pointer' }}
                      >
                        <strong>{s.state}</strong>
                      </td>
                      <td
                        onClick={() => drillIntoState(s.state)}
                        style={{ cursor: 'pointer' }}
                      >
                        <code className={styles.code}>{s.stateCode}</code>
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        {canEdit ? (
                          <input
                            className={styles.input}
                            defaultValue={s.country}
                            disabled={updateLoc.isPending}
                            onBlur={(e) => moveStateToCountry(s.state, s.country, e.target.value)}
                            aria-label={`Country for ${s.state}`}
                          />
                        ) : (
                          s.country
                        )}
                      </td>
                      <td
                        style={{ textAlign: 'right', cursor: 'pointer' }}
                        onClick={() => drillIntoState(s.state)}
                      >
                        {s.cities.size}
                      </td>
                      <td
                        style={{ textAlign: 'right', cursor: 'pointer' }}
                        onClick={() => drillIntoState(s.state)}
                      >
                        {s.postcodeCount}
                      </td>
                      <td>
                        <button
                          type="button"
                          className={styles.editBtn}
                          onClick={() => drillIntoState(s.state)}
                        >
                          Open →
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}

      {/* L3 — Add City form (within selectedState). */}
      {geoView === 'city' && canEdit && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>Add a city in {selectedState}, {selectedCountry} (seeds first postcode)</div>
          <div
            className={styles.addRowGrid}
            style={{ gridTemplateColumns: '1fr 130px auto' }}
          >
            <input className={styles.input} placeholder="City (e.g. Subang Jaya)"
              value={newCity} onChange={(e) => setNewCity(e.target.value)} />
            <input className={styles.input} placeholder="Postcode (47600)" maxLength={10}
              value={newPostcode} onChange={(e) => setNewPostcode(e.target.value)} />
            <Button variant="primary" size="md" onClick={addLocality} disabled={createLoc.isPending}>
              <Plus size={14} strokeWidth={1.75} /> Add
            </Button>
          </div>
        </div>
      )}

      {/* L3 — Distinct cities under selectedState. */}
      {geoView === 'city' && (
        <div className={styles.tableCard}>
          {citiesInState.length === 0 ? (
            <div className={styles.empty}>No cities in {selectedState} yet.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>City</th>
                  <th style={{ width: 130, textAlign: 'right' }}>Postcodes</th>
                  <th style={{ width: 90 }} aria-label="drill" />
                </tr>
              </thead>
              <tbody>
                {citiesInState.map((c) => (
                  <tr
                    key={c.city}
                    onClick={() => drillIntoCity(c.city)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td><strong>{c.city}</strong></td>
                    <td style={{ textAlign: 'right' }}>{c.postcodeCount}</td>
                    <td>
                      <button type="button" className={styles.editBtn}>
                        Open →
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* L4 — Postcodes under (selectedState, selectedCity). Leaf level —
          this is where rows are actually added + deleted. */}
      {geoView === 'postcode' && (
        <>
          {canEdit && (
            <div className={styles.addRowCard}>
              <div className={styles.addRowEyebrow}>
                Add a postcode in {selectedCity}, {selectedState}, {selectedCountry}
              </div>
              <div
                className={styles.addRowGrid}
                style={{ gridTemplateColumns: '180px auto' }}
              >
                <input
                  className={styles.input}
                  placeholder="Postcode (e.g. 47301)"
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
            {postcodeRows.length === 0 ? (
              <div className={styles.empty}>No postcodes in {selectedCity} yet — add one above.</div>
            ) : (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>Postcode</th>
                    {canEdit && <th aria-label="actions" style={{ width: 70 }} />}
                  </tr>
                </thead>
                <tbody>
                  {postcodeRows.map((r) => (
                    <tr key={r.id ?? `${r.state}-${r.city}-${r.postcode}`}>
                      <td><code className={styles.code}>{r.postcode}</code></td>
                      {canEdit && (
                        <td>
                          {r.id && (
                            <button
                              type="button"
                              className={styles.editBtn}
                              disabled={deleteLoc.isPending}
                              onClick={() => {
                                if (confirm(`Delete ${selectedCity} / ${r.postcode}?`)) {
                                  deleteLoc.mutate(r.id!);
                                }
                              }}
                              aria-label="Delete postcode"
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
          </div>
        </>
      )}

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

  // Add-row state (sort_order is auto-appended to end — no input field)
  const [newValue, setNewValue]    = useState('');
  const [newLabel, setNewLabel]    = useState('');

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
    /* Auto-append: new row gets sort_order = max(existing) + 1 so it
       lands at the bottom. Commander hid the Sort field — order is
       managed by add sequence, not by manual numbers. */
    const maxSort = rows.reduce((m, r) => Math.max(m, r.sortOrder), 0);
    const sortOrder = maxSort + 1;
    createOpt.mutate(
      { category, value, label, sortOrder },
      {
        onSuccess: () => { setNewValue(''); setNewLabel(''); },
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
                  <th style={{ width: '30%' }}>Value</th>
                  <th style={{ width: '50%' }}>Label</th>
                  {/* Sort column hidden — commander 2026-05-27 "sort 1/2
                      meaning? 不需要把？". Display order still follows
                      sort_order ASC, but new rows auto-append (handled in
                      addRow below) so users never type sort numbers. */}
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
              /* Sort input removed — commander 2026-05-27. New rows auto-
                 append to the end (sort_order = rows.length + 1). */
              gridTemplateColumns: '1fr 1.5fr auto',
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

