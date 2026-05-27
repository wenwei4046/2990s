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
/* useCreateWarehouse / useUpdateWarehouse / useDeleteWarehouse dropped —
   warehouse master CRUD belongs at Inventory → Warehouses. The L2 view
   only READS the warehouse list. */
import { useWarehouses } from '../lib/inventory-queries';
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
    /* Per-city aggregate: postcode count + the single warehouseId that
       all postcodes under the city share. If postcodes diverge (mixed),
       the city's warehouseId is null and the UI shows a "(mixed)"
       indicator — commander's bulk-stamp edit normalises them. */
    const byCity = new Map<string, {
      city: string;
      postcodeCount: number;
      warehouseId: string | null;
      mixed: boolean;
    }>();
    for (const r of stateLocalities) {
      const wh = r.warehouseId ?? null;
      const ex = byCity.get(r.city);
      if (!ex) {
        byCity.set(r.city, { city: r.city, postcodeCount: 1, warehouseId: wh, mixed: false });
        continue;
      }
      ex.postcodeCount += 1;
      if (ex.warehouseId !== wh) {
        ex.mixed = true;
        ex.warehouseId = null;
      }
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

  /* Bulk-stamp every locality under (state, city) with the same
     warehouse_id. Commander 2026-05-27: "manually 换那个 cities 是要 under
     什么 warehouse 可是全部 postcode 都是跟着一起换 因为上级已经混改了". */
  const setCityWarehouse = async (state: string, city: string, warehouseId: string | null) => {
    const rows = stateLocalities.filter((r) => r.city === city && r.id);
    if (rows.length === 0) return;
    try {
      await Promise.all(rows.map((r) =>
        updateLoc.mutateAsync({
          id: r.id!,
          warehouseId: warehouseId ?? '',
        }),
      ));
    } catch (err) {
      window.alert(`Save failed partway: ${String((err as Error).message ?? err)}`);
    }
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
      {/* ── Unified Geo + Warehouse drill-down (Commander 2026-05-27) ──
          Commander folded the separate State→Warehouse table and the Geo
          registry into ONE table: "添加多一个 column 给我选择 country 然后
          可以 assign 这个 state under 什么 warehouse 然后双击点进去可以
          看到全部 cities 再双击点进去可以看到全部 postcode 同时这每个
          layer 都有 create 的功能".

          L1 default — Country list (with state/city/postcode counts)
                 double-click → drill
          L2  — States in country, columns: State / Country / Warehouse /
                 Notes / Cities / Postcodes
                 double-click row → drill into cities
          L3  — Cities in state, columns: City / Postcodes count
                 double-click row → drill into postcodes
          L4  — Postcodes in city, columns: Postcode / delete

          Each level also has its own Add form at the bottom. */}
      <div className={styles.banner}>
        <strong>
          {geoView === 'country'  && 'Countries.'}
          {geoView === 'state'    && `States in ${selectedCountry}.`}
          {geoView === 'city'     && `Cities in ${selectedState}, ${selectedCountry}.`}
          {geoView === 'postcode' && `Postcodes in ${selectedCity}, ${selectedState}.`}
        </strong>{' '}
        {geoView === 'country'  && 'Double-click a country to drill into its states + warehouse mapping.'}
        {geoView === 'state'    && 'Assign a warehouse + notes per state. Double-click a state to drill into its cities.'}
        {geoView === 'city'     && 'Double-click a city to drill into its postcodes.'}
        {geoView === 'postcode' && 'Leaf level — edit / delete + add new postcodes here.'}
      </div>

      {/* Breadcrumb */}
      {geoView !== 'country' && (
        <div className={styles.filterBar} style={{ marginBottom: 'var(--space-2)' }}>
          <button type="button" className={styles.editBtn} onClick={goToCountry}>
            ← All countries
          </button>
          {(geoView === 'city' || geoView === 'postcode') && (
            <button type="button" className={styles.editBtn} onClick={goToState}
              style={{ marginLeft: 'var(--space-2)' }}>
              ← {selectedCountry} (states)
            </button>
          )}
          {geoView === 'postcode' && (
            <button type="button" className={styles.editBtn} onClick={goToCity}
              style={{ marginLeft: 'var(--space-2)' }}>
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

      {/* L1 — Country list */}
      {geoView === 'country' && (
        <div className={styles.tableCard}>
          {localities.isLoading ? (
            <div className={styles.empty}>Loading…</div>
          ) : localityGroups.countries.length === 0 ? (
            <div className={styles.empty}>No localities yet — add a country below.</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Country</th>
                  <th style={{ width: 110, textAlign: 'right' }}>States</th>
                  <th style={{ width: 110, textAlign: 'right' }}>Cities</th>
                  <th style={{ width: 130, textAlign: 'right' }}>Postcodes</th>
                </tr>
              </thead>
              <tbody>
                {localityGroups.countries.map((c) => (
                  <tr
                    key={c.country}
                    onDoubleClick={() => drillIntoCountry(c.country)}
                    title="Double-click to drill into states"
                    style={{ cursor: 'pointer' }}
                  >
                    <td><strong>{c.country}</strong></td>
                    <td style={{ textAlign: 'right' }}>{c.states.size}</td>
                    <td style={{ textAlign: 'right' }}>{c.cities.size}</td>
                    <td style={{ textAlign: 'right' }}>{c.postcodeCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* L1 — Add Country form */}
      {geoView === 'country' && canEdit && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>Add a country (also seeds first state · city · postcode)</div>
          <div className={styles.addRowGrid}
            style={{ gridTemplateColumns: '1fr 1fr 100px 1fr 110px auto' }}>
            <input className={styles.input} placeholder="Country (Singapore)"
              value={newCountry} onChange={(e) => setNewCountry(e.target.value)} />
            <input className={styles.input} placeholder="State (Central)"
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

      {/* L2 — States in selected country, integrated with warehouse + notes */}
      {geoView === 'state' && (
        <div className={styles.tableCard}>
          {(() => {
            const statesInCountry = Array.from(localityGroups.statesByCountry.values())
              .filter((s) => s.country === selectedCountry)
              .sort((a, b) => a.state.localeCompare(b.state));
            if (statesInCountry.length === 0) {
              return <div className={styles.empty}>No states under {selectedCountry} — add one below.</div>;
            }
            return (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>State</th>
                    <th style={{ width: 80 }}>Code</th>
                    <th style={{ width: 140 }}>Country</th>
                    <th>Warehouse</th>
                    <th>Notes</th>
                    <th style={{ width: 80, textAlign: 'right' }}>Cities</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Postcodes</th>
                    {canEdit && <th aria-label="actions" style={{ width: 70 }} />}
                  </tr>
                </thead>
                <tbody>
                  {statesInCountry.map((s) => {
                    const current = mappedByState.get(s.state);
                    const displayWarehouseId = pendingByState.has(s.state)
                      ? pendingByState.get(s.state) ?? ''
                      : current?.warehouseId ?? '';
                    return (
                      <tr
                        key={s.state}
                        onDoubleClick={() => drillIntoState(s.state)}
                        title="Double-click to drill into cities"
                      >
                        <td style={{ cursor: 'pointer' }}><strong>{s.state}</strong></td>
                        <td style={{ cursor: 'pointer' }}>
                          <code className={styles.code}>{s.stateCode}</code>
                        </td>
                        <td onDoubleClick={(e) => e.stopPropagation()}>
                          {canEdit ? (
                            <input
                              className={styles.input}
                              defaultValue={s.country}
                              disabled={updateLoc.isPending}
                              onBlur={(e) => moveStateToCountry(s.state, s.country, e.target.value)}
                              aria-label={`Country for ${s.state}`}
                            />
                          ) : s.country}
                        </td>
                        <td onDoubleClick={(e) => e.stopPropagation()}>
                          <select
                            className={styles.input}
                            value={displayWarehouseId}
                            disabled={!canEdit}
                            onChange={(e) => {
                              const warehouseId = e.target.value || null;
                              setPendingByState((m) => {
                                const next = new Map(m);
                                next.set(s.state, warehouseId);
                                return next;
                              });
                              const wh = (warehouses.data ?? []).find((w) => w.id === warehouseId);
                              const wlabel = wh ? `${wh.code} · ${wh.name}` : 'Unassigned';
                              upsert.mutate(
                                { state: s.state, warehouseId, notes: current?.notes ?? null },
                                {
                                  onSuccess: () => toast.success(`${s.state} → ${wlabel}`),
                                  onError: (err) => {
                                    setPendingByState((m) => {
                                      const next = new Map(m);
                                      next.delete(s.state);
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
                        </td>
                        <td onDoubleClick={(e) => e.stopPropagation()}>
                          <input
                            className={styles.input}
                            defaultValue={current?.notes ?? ''}
                            key={`${s.state}-${current?.notes ?? ''}`}
                            disabled={!canEdit}
                            placeholder="Optional"
                            onBlur={(e) => {
                              const notes = e.target.value.trim() || null;
                              if ((current?.notes ?? null) === notes) return;
                              upsert.mutate(
                                { state: s.state, warehouseId: current?.warehouseId ?? null, notes },
                                {
                                  onSuccess: () => toast.success(`Notes saved for ${s.state}`),
                                  onError: (err) => toast.error(`Notes save failed: ${err instanceof Error ? err.message : String(err)}`),
                                },
                              );
                            }}
                          />
                        </td>
                        <td style={{ textAlign: 'right', cursor: 'pointer' }}>{s.cities.size}</td>
                        <td style={{ textAlign: 'right', cursor: 'pointer' }}>{s.postcodeCount}</td>
                        {canEdit && (
                          <td onDoubleClick={(e) => e.stopPropagation()}>
                            {current && (
                              <button
                                type="button"
                                className={styles.editBtn}
                                disabled={remove.isPending}
                                onClick={() => remove.mutate(
                                  { state: s.state },
                                  {
                                    onSuccess: () => {
                                      toast.success(`Cleared mapping for ${s.state}`);
                                      setPendingByState((m) => {
                                        const next = new Map(m);
                                        next.delete(s.state);
                                        return next;
                                      });
                                    },
                                    onError: (err) => toast.error(`Clear failed: ${err instanceof Error ? err.message : String(err)}`),
                                  },
                                )}
                                aria-label={`Clear warehouse for ${s.state}`}
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
            );
          })()}
        </div>
      )}

      {/* L2 — Add State form. Commander 2026-05-27: "add state is to choose
          under which country and under which warehouse no more cities and
          postcode". Only inputs the user provides are State name, Code,
          Warehouse. We seed a placeholder my_localities row with city
          '—' / postcode '—' so the state appears in L2's localityGroups
          aggregation; commander drills in via L3 to add real cities. */}
      {geoView === 'state' && canEdit && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>Add a state in {selectedCountry} — pick its default warehouse</div>
          <div className={styles.addRowGrid}
            style={{ gridTemplateColumns: '1fr 100px 1fr auto' }}>
            <input className={styles.input} placeholder="State (Selangor)"
              value={newState} onChange={(e) => setNewState(e.target.value)} />
            <input className={styles.input} placeholder="Code (SGR)" maxLength={5}
              value={newStateCode} onChange={(e) => setNewStateCode(e.target.value)} />
            <select
              className={styles.input}
              value={newCountry /* repurposed as the new-state warehouseId picker */}
              onChange={(e) => setNewCountry(e.target.value)}
              aria-label="Default warehouse for this state"
            >
              <option value="">— Default warehouse (optional) —</option>
              {(warehouses.data ?? []).filter((w) => w.is_active).map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </select>
            <Button
              variant="primary"
              size="md"
              disabled={createLoc.isPending || upsert.isPending}
              onClick={async () => {
                const state = newState.trim();
                const stateCode = newStateCode.trim().toUpperCase();
                const whId = newCountry.trim();  // repurposed; '' = no default
                if (!state || !stateCode) {
                  window.alert('State name and code are required.');
                  return;
                }
                try {
                  /* Seed placeholder locality so L2 picks up the new state.
                     Commander adds real cities/postcodes by drilling into L3. */
                  await createLoc.mutateAsync({
                    state, stateCode, city: '—', postcode: '—',
                    country: selectedCountry || 'Malaysia',
                  });
                  if (whId) {
                    await new Promise<void>((resolve, reject) => {
                      upsert.mutate(
                        { state, warehouseId: whId, notes: null },
                        { onSuccess: () => resolve(), onError: reject },
                      );
                    });
                  }
                  setNewState(''); setNewStateCode(''); setNewCountry('');
                  toast.success(`Added ${state}${whId ? ' with default warehouse' : ''}`);
                } catch (err) {
                  toast.error(`Add failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
            >
              <Plus size={14} strokeWidth={1.75} /> Add
            </Button>
          </div>
        </div>
      )}

      {/* L3 — Cities. Warehouse column lets commander override the state-
          level default per city. Bulk-stamps all postcodes under the city
          when changed. Empty value means "follow state". */}
      {geoView === 'city' && (
        <div className={styles.tableCard}>
          {citiesInState.length === 0 ? (
            <div className={styles.empty}>No cities in {selectedState} yet — add one below.</div>
          ) : (() => {
            const stateMappingId = mappedByState.get(selectedState)?.warehouseId ?? null;
            const stateWh = (warehouses.data ?? []).find((w) => w.id === stateMappingId);
            const stateWhLabel = stateWh ? `${stateWh.code} · ${stateWh.name}` : '— state default unset —';
            return (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>City</th>
                    <th>Warehouse (override · blank = follow state)</th>
                    <th style={{ width: 130, textAlign: 'right' }}>Postcodes</th>
                  </tr>
                </thead>
                <tbody>
                  {citiesInState.map((c) => {
                    const followingState = c.warehouseId === null && !c.mixed;
                    return (
                      <tr
                        key={c.city}
                        onDoubleClick={() => drillIntoCity(c.city)}
                        title="Double-click an empty cell to drill into postcodes"
                      >
                        <td style={{ cursor: 'pointer' }}><strong>{c.city}</strong></td>
                        <td onDoubleClick={(e) => e.stopPropagation()}>
                          {canEdit ? (
                            <>
                              <select
                                className={styles.input}
                                value={c.mixed ? '__mixed__' : (c.warehouseId ?? '')}
                                disabled={updateLoc.isPending}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  if (v === '__mixed__') return; // sentinel
                                  setCityWarehouse(selectedState, c.city, v || null);
                                }}
                              >
                                {c.mixed && <option value="__mixed__">— mixed (pick to normalise) —</option>}
                                <option value="">— follow state ({stateWhLabel}) —</option>
                                {(warehouses.data ?? []).filter((w) => w.is_active).map((w) => (
                                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                                ))}
                              </select>
                              {followingState && (
                                <div className={styles.muted} style={{ fontSize: 'var(--fs-11)', marginTop: 2 }}>
                                  Inherits: {stateWhLabel}
                                </div>
                              )}
                            </>
                          ) : (
                            c.mixed ? '(mixed)' : (
                              c.warehouseId
                                ? ((warehouses.data ?? []).find((w) => w.id === c.warehouseId)?.code ?? c.warehouseId)
                                : `(follows state: ${stateWhLabel})`
                            )
                          )}
                        </td>
                        <td style={{ textAlign: 'right', cursor: 'pointer' }}>{c.postcodeCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}

      {/* L3 — Add City form */}
      {geoView === 'city' && canEdit && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>Add a city in {selectedState}, {selectedCountry} (seeds first postcode)</div>
          <div className={styles.addRowGrid}
            style={{ gridTemplateColumns: '1fr 130px auto' }}>
            <input className={styles.input} placeholder="City (Subang Jaya)"
              value={newCity} onChange={(e) => setNewCity(e.target.value)} />
            <input className={styles.input} placeholder="Postcode (47600)" maxLength={10}
              value={newPostcode} onChange={(e) => setNewPostcode(e.target.value)} />
            <Button variant="primary" size="md" onClick={addLocality} disabled={createLoc.isPending}>
              <Plus size={14} strokeWidth={1.75} /> Add
            </Button>
          </div>
        </div>
      )}

      {/* L4 — Postcodes leaf */}
      {geoView === 'postcode' && (
        <div className={styles.tableCard}>
          {postcodeRows.length === 0 ? (
            <div className={styles.empty}>No postcodes in {selectedCity} yet — add one below.</div>
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
      )}

      {/* L4 — Add Postcode */}
      {geoView === 'postcode' && canEdit && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>
            Add a postcode in {selectedCity}, {selectedState}, {selectedCountry}
          </div>
          <div className={styles.addRowGrid} style={{ gridTemplateColumns: '180px auto' }}>
            <input className={styles.input} placeholder="Postcode (47301)" maxLength={10}
              value={newPostcode} onChange={(e) => setNewPostcode(e.target.value)} />
            <Button variant="primary" size="md" onClick={addLocality} disabled={createLoc.isPending}>
              <Plus size={14} strokeWidth={1.75} /> Add
            </Button>
          </div>
        </div>
      )}

      {/* Warehouse master CRUD lives at Inventory → Warehouses, not here.
          Commander 2026-05-27: "这个 warehouse 是 inventory 那边 create 的
          这边 create 不到的 inventory 开了直接 sync 过来". The L2 state row
          above reads the live warehouse list via useWarehouses() so any
          add/edit done in Inventory shows up here automatically. */}

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
    help: 'L1 of the 3-step Payments cascade. Tight scope: Merchant / Online / ' +
          'Cash. Each label maps to the internal payment_method enum via the ' +
          'PaymentsTable labelToApi() mapper (Merchant → merchant, Online → ' +
          'transfer, Cash → cash); adding a new label here without updating ' +
          'that mapper defaults to "cash".',
  },
  /* Task #122 (cascade) — three L2 buckets that show up under Merchant
     and Online, edited the same way as the L1 list above. */
  {
    category: 'payment_merchant',
    title:    'Payment Merchant (Bank)',
    help:     'Shown under Method=Merchant in the Payments table. The bank ' +
              'the card was charged on (MBB / CIMB / Public / HLB / RHB / ' +
              'Bank Islam / BSN / Alliance / AmBank).',
  },
  {
    category: 'online_type',
    title:    'Online Sub-type',
    help:     'Shown under Method=Online in the Payments table. Bank Transfer / ' +
              'TNG / Cheque / DuitNow.',
  },
  {
    category: 'installment_plan',
    title:    'Installment Plan',
    help:     'Shown alongside Merchant bank when Method=Merchant. One-off (no ' +
              'installment) / 3 / 6 / 12 / 24 / 36 months. Stored as the term ' +
              'in months on the payment row.',
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

