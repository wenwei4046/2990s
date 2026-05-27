// ----------------------------------------------------------------------------
// POS Sales Order Maintenance — ported from
// apps/backend/src/pages/SalesOrderMaintenance.tsx with a mode-based role
// gate (commander 2026-05-28).
//
// Roles (page-level only; same /venues, /localities, /state-warehouse-mappings,
// /so-dropdown-options API endpoints as Backend — bidirectional sync is
// automatic):
//
//   - admin                                   → 'full'      (identical to Backend)
//   - outlet_manager / sales_director         → 'add-only'  (add affordances visible,
//                                                            no edit, no delete,
//                                                            no status toggle)
//   - sales_executive / sales (default)       → 'view'      (read-only)
//
// Per-section behaviour summary:
//
//   Venues — view: read-only table; add-only: + add-venue row; full: identical
//   Countries L1 — view: read-only; add-only: + Add a Country; full: identical
//   States L2 — view: read-only no drill; add-only: + Add a State; full: identical
//   Cities L3 — view: read-only; add-only: + Add a City; full: identical
//   Postcodes L4 — view: read-only; add-only: + Add a Postcode; full: identical
//   Dropdowns — view: read-only; add-only: + Add option row per category; full: identical
//
// Notes:
//   - State→Warehouse picker hidden in add-only/view (that's an edit, not an add).
//   - Country edit cell hidden in add-only/view (move-state-to-country is edit).
//   - City warehouse override hidden in add-only/view (edit, not add).
//   - Drill double-click works in all modes (just navigation, not mutation).
//   - Status toggle on dropdown rows hidden in add-only (it's editing existing).
//   - No new API endpoints; no new schema; copied query plumbing only.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft, Plus, ChevronDown, ChevronRight, MapPin } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useStaff } from '../lib/staff';
import {
  useVenues, useCreateVenue,
  type VenueRow,
} from '../lib/so-maintenance/venues-queries';
import {
  useStateWarehouseMappings,
} from '../lib/so-maintenance/state-warehouse-queries';
import { useWarehouses } from '../lib/so-maintenance/warehouses-queries';
import {
  useLocalities, distinctStates,
  useCreateLocality,
  type LocalityRow,
} from '../lib/so-maintenance/localities-queries';
import {
  useAllSoDropdownOptions,
  useCreateSoDropdownOption,
  type SoDropdownCategory,
  type SoDropdownOption,
} from '../lib/so-maintenance/so-dropdown-options-queries';
import { Topbar } from '../components/Topbar';
import styles from './SalesOrderMaintenance.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/* ════════════════════════════════════════════════════════════════════════
   Mode derivation. Mode is computed once at the page root, threaded through
   to every section as a prop. Defaults to 'view' so an unknown role can
   still see the data but never mutates anything.
   ════════════════════════════════════════════════════════════════════════ */

export type MaintenanceMode = 'view' | 'add-only' | 'full';

function maintenanceMode(role: string | undefined): MaintenanceMode {
  if (role === 'admin') return 'full';
  if (role === 'sales_director' || role === 'outlet_manager') return 'add-only';
  return 'view'; // sales_executive, sales, anything else
}

const canAdd  = (m: MaintenanceMode) => m !== 'view';
/* canEdit covers field edits + delete + status toggles. add-only mode
   explicitly does NOT permit these (commander 2026-05-28: 不能 edit, 不能
   删除, 只能添加). */
const canEdit = (m: MaintenanceMode) => m === 'full';

export const SalesOrderMaintenance = () => {
  const { data: staff } = useStaff();
  const mode = maintenanceMode(staff?.role);

  /* Chip label next to the page title — makes the gate visible. */
  const chip =
    mode === 'view'     ? { label: 'View only', tone: 'muted' as const } :
    mode === 'add-only' ? { label: 'Add-only · Cannot edit existing', tone: 'warn' as const } :
                          null;

  return (
    <>
      <Topbar />
      <div className={styles.page}>
        <div className={styles.headerRow}>
          <div className={styles.titleBlock}>
            <Link to="/catalog" className={styles.backBtn}>
              <ArrowLeft {...ICON} /> <span>Catalog</span>
            </Link>
            <div>
              <h1 className={styles.title}>
                Sales Order Maintenance
                {chip && (
                  <span
                    style={{
                      display: 'inline-block',
                      marginLeft: 'var(--space-3)',
                      padding: '4px 10px',
                      borderRadius: 999,
                      fontSize: 'var(--fs-12)',
                      fontFamily: 'var(--font-button)',
                      fontWeight: 600,
                      letterSpacing: '0.08em',
                      textTransform: 'uppercase',
                      verticalAlign: 'middle',
                      background:
                        chip.tone === 'warn'
                          ? 'rgba(232, 107, 58, 0.12)'
                          : 'rgba(34, 31, 32, 0.06)',
                      color:
                        chip.tone === 'warn'
                          ? 'var(--c-burnt, #A6471E)'
                          : 'var(--fg-muted)',
                    }}
                  >
                    {chip.label}
                  </span>
                )}
              </h1>
              <p className={styles.subtitle}>
                Venues · countries / states / cities / postcodes · customer /
                building / relationship / payment dropdowns
              </p>
            </div>
          </div>
        </div>

        {mode === 'add-only' && (
          <div className={styles.readOnlyBanner}>
            <strong>Add-only mode.</strong> You can add new venues, locations,
            and dropdown options — editing or deleting existing entries is
            admin-only.
          </div>
        )}
        {mode === 'view' && (
          <div className={styles.readOnlyBanner}>
            <strong>Read-only view.</strong> Changes to Sales Order Maintenance
            are admin / outlet-manager / sales-director only.
          </div>
        )}

        <MaintenanceBody mode={mode} />
      </div>
    </>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
   Maintenance body — Venues, Geo drill (Country/State/City/Postcode), Dropdowns.
   ────────────────────────────────────────────────────────────────────────── */

const MaintenanceBody = ({ mode }: { mode: MaintenanceMode }) => {
  const mappings = useStateWarehouseMappings();
  const warehouses = useWarehouses();
  const localities = useLocalities();
  const createLoc = useCreateLocality();

  const states = useMemo(() => distinctStates(localities.data ?? []), [localities.data]);
  // suppress unused — kept so the read pattern matches Backend in case a
  // future PR wires the state list back into the L2 picker rendering path.
  void states;

  const mappedByState = useMemo(() => {
    const m = new Map<string, { warehouseId: string | null; notes: string | null }>();
    for (const row of mappings.data?.mappings ?? []) {
      m.set(row.state, { warehouseId: row.warehouseId, notes: row.notes });
    }
    return m;
  }, [mappings.data]);

  const [geoView, setGeoView]                 = useState<'country' | 'state' | 'city' | 'postcode'>('country');
  const [selectedCountry, setSelectedCountry] = useState<string>('');
  const [selectedState,   setSelectedState]   = useState<string>('');
  const [selectedCity,    setSelectedCity]    = useState<string>('');
  const [newState,    setNewState]    = useState('');
  const [newStateCode, setNewStateCode] = useState('');
  const [newCity,     setNewCity]     = useState('');
  const [newPostcode, setNewPostcode] = useState('');
  const [newCountry, setNewCountry] = useState('Malaysia');

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

  const stateLocalities: LocalityRow[] = useMemo(() => {
    if (!selectedCountry || !selectedState) return [];
    return (localities.data ?? [])
      .filter((r) => (r.country || 'Malaysia') === selectedCountry && r.state === selectedState);
  }, [localities.data, selectedCountry, selectedState]);

  const citiesInState = useMemo(() => {
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

  const postcodeRows: LocalityRow[] = useMemo(() => {
    if (!selectedCity) return [];
    return stateLocalities
      .filter((r) => r.city === selectedCity)
      .sort((a, b) => a.postcode.localeCompare(b.postcode));
  }, [stateLocalities, selectedCity]);

  const addLocality = () => {
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

  /* Navigation helpers — drill is just navigation; not a mutation. Available
     in every mode. */
  const goToCountry      = () => { setGeoView('country'); setSelectedCountry(''); setSelectedState(''); setSelectedCity(''); };
  const goToState        = () => { setGeoView('state');   setSelectedState(''); setSelectedCity(''); };
  const goToCity         = () => { setGeoView('city');    setSelectedCity(''); };
  const drillIntoCountry = (c: string) => { setSelectedCountry(c); setGeoView('state');    setSelectedState(''); setSelectedCity(''); };
  const drillIntoState   = (s: string) => { setSelectedState(s);   setGeoView('city');     setSelectedCity(''); };
  const drillIntoCity    = (c: string) => { setSelectedCity(c);    setGeoView('postcode'); };

  return (
    <>
      <VenuesSection mode={mode} />

      <div className={styles.banner}>
        <strong>
          {geoView === 'country'  && 'Countries.'}
          {geoView === 'state'    && `States in ${selectedCountry}.`}
          {geoView === 'city'     && `Cities in ${selectedState}, ${selectedCountry}.`}
          {geoView === 'postcode' && `Postcodes in ${selectedCity}, ${selectedState}.`}
        </strong>{' '}
        {geoView === 'country'  && 'Double-click a country to drill into its states.'}
        {geoView === 'state'    && 'Double-click a state to drill into its cities.'}
        {geoView === 'city'     && 'Double-click a city to drill into its postcodes.'}
        {geoView === 'postcode' && 'Leaf level — add new postcodes here.'}
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
            <div className={styles.empty}>No localities yet{canAdd(mode) ? ' — add a country below.' : '.'}</div>
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

      {/* L1 — Add Country form (add-only + full) */}
      {geoView === 'country' && canAdd(mode) && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>Add a country</div>
          <div className={styles.addRowGrid}
            style={{ gridTemplateColumns: '1fr auto' }}>
            <input className={styles.input} placeholder="Country (Singapore)"
              value={newCountry} onChange={(e) => setNewCountry(e.target.value)} />
            <Button
              variant="primary" size="md"
              disabled={createLoc.isPending}
              onClick={async () => {
                const country = newCountry.trim();
                if (!country) { window.alert('Country name is required.'); return; }
                try {
                  await createLoc.mutateAsync({
                    state: '—', stateCode: '—', city: '—', postcode: '—',
                    country,
                  });
                  setNewCountry('');
                  window.alert(`Added ${country}. Drill in to add states.`);
                } catch (err) {
                  window.alert(`Add failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
            >
              <Plus size={14} strokeWidth={1.75} /> Add
            </Button>
          </div>
        </div>
      )}

      {/* L2 — States. Warehouse picker + Country edit + Clear button hidden
          unless mode==='full' (those are edits, not adds). */}
      {geoView === 'state' && (
        <div className={styles.tableCard}>
          {(() => {
            const statesInCountry = Array.from(localityGroups.statesByCountry.values())
              .filter((s) => s.country === selectedCountry)
              .sort((a, b) => a.state.localeCompare(b.state));
            if (statesInCountry.length === 0) {
              return <div className={styles.empty}>No states under {selectedCountry}{canAdd(mode) ? ' — add one below.' : '.'}</div>;
            }
            return (
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>State</th>
                    <th style={{ width: 80 }}>Code</th>
                    <th style={{ width: 140 }}>Country</th>
                    {canEdit(mode) && <th>Warehouse</th>}
                    <th style={{ width: 80, textAlign: 'right' }}>Cities</th>
                    <th style={{ width: 90, textAlign: 'right' }}>Postcodes</th>
                  </tr>
                </thead>
                <tbody>
                  {statesInCountry.map((s) => {
                    const current = mappedByState.get(s.state);
                    const wh = (warehouses.data ?? []).find((w) => w.id === current?.warehouseId);
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
                        <td>{s.country}</td>
                        {canEdit(mode) && (
                          <td>{wh ? `${wh.code} · ${wh.name}` : '—'}</td>
                        )}
                        <td style={{ textAlign: 'right', cursor: 'pointer' }}>{s.cities.size}</td>
                        <td style={{ textAlign: 'right', cursor: 'pointer' }}>{s.postcodeCount}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      )}

      {/* L2 — Add State (add-only + full). Warehouse picker still shown so
          add-only roles can pick a default at create time; this is part of
          ADD, not edit-after-the-fact. We seed a placeholder my_localities
          row so the state appears immediately. */}
      {geoView === 'state' && canAdd(mode) && (
        <div className={styles.addRowCard}>
          <div className={styles.addRowEyebrow}>Add a state in {selectedCountry}</div>
          <div className={styles.addRowGrid}
            style={{ gridTemplateColumns: '1fr 100px 1fr auto' }}>
            <input className={styles.input} placeholder="State (Selangor)"
              value={newState} onChange={(e) => setNewState(e.target.value)} />
            <input className={styles.input} placeholder="Code (SGR)" maxLength={5}
              value={newStateCode} onChange={(e) => setNewStateCode(e.target.value)} />
            <select
              className={styles.input}
              value={newCountry}
              onChange={(e) => setNewCountry(e.target.value)}
              aria-label="Default warehouse for this state"
            >
              <option value="">— No default warehouse —</option>
              {(warehouses.data ?? []).filter((w) => w.is_active).map((w) => (
                <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
              ))}
            </select>
            <Button
              variant="primary"
              size="md"
              disabled={createLoc.isPending}
              onClick={async () => {
                const state = newState.trim();
                const stateCode = newStateCode.trim().toUpperCase();
                if (!state || !stateCode) {
                  window.alert('State name and code are required.');
                  return;
                }
                try {
                  /* Seed placeholder locality so the state surfaces in L2.
                     Add-only mode INTENTIONALLY skips the warehouse upsert —
                     that PUT is an edit on state_warehouse_mappings and the
                     gate forbids edits. Sales_director / outlet_manager who
                     want a default warehouse can ask admin to assign it. */
                  await createLoc.mutateAsync({
                    state, stateCode, city: '—', postcode: '—',
                    country: selectedCountry || 'Malaysia',
                  });
                  setNewState(''); setNewStateCode(''); setNewCountry('');
                  window.alert(`Added ${state}.`);
                } catch (err) {
                  window.alert(`Add failed: ${err instanceof Error ? err.message : String(err)}`);
                }
              }}
            >
              <Plus size={14} strokeWidth={1.75} /> Add
            </Button>
          </div>
        </div>
      )}

      {/* L3 — Cities. Warehouse override column hidden in non-full modes
          (commander 2026-05-28 — override is an edit, not an add). */}
      {geoView === 'city' && (
        <div className={styles.tableCard}>
          {citiesInState.length === 0 ? (
            <div className={styles.empty}>No cities in {selectedState}{canAdd(mode) ? ' — add one below.' : '.'}</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>City</th>
                  {canEdit(mode) && <th>Warehouse override</th>}
                  <th style={{ width: 130, textAlign: 'right' }}>Postcodes</th>
                </tr>
              </thead>
              <tbody>
                {citiesInState.map((c) => {
                  const wh = (warehouses.data ?? []).find((w) => w.id === c.warehouseId);
                  return (
                    <tr
                      key={c.city}
                      onDoubleClick={() => drillIntoCity(c.city)}
                      title="Double-click to drill into postcodes"
                    >
                      <td style={{ cursor: 'pointer' }}><strong>{c.city}</strong></td>
                      {canEdit(mode) && (
                        <td>
                          {c.mixed ? '(mixed)'
                            : wh ? `${wh.code} · ${wh.name}`
                            : '— follows state —'}
                        </td>
                      )}
                      <td style={{ textAlign: 'right', cursor: 'pointer' }}>{c.postcodeCount}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* L3 — Add City form */}
      {geoView === 'city' && canAdd(mode) && (
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

      {/* L4 — Postcodes leaf. Delete column hidden in non-full modes. */}
      {geoView === 'postcode' && (
        <div className={styles.tableCard}>
          {postcodeRows.length === 0 ? (
            <div className={styles.empty}>No postcodes in {selectedCity}{canAdd(mode) ? ' — add one below.' : '.'}</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Postcode</th>
                </tr>
              </thead>
              <tbody>
                {postcodeRows.map((r) => (
                  <tr key={r.id ?? `${r.state}-${r.city}-${r.postcode}`}>
                    <td><code className={styles.code}>{r.postcode}</code></td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* L4 — Add Postcode */}
      {geoView === 'postcode' && canAdd(mode) && (
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

      <DropdownsSection mode={mode} />
    </>
  );
};

/* ──────────────────────────────────────────────────────────────────────────
   Dropdowns — 4-7 collapsible sub-cards (one per category). Add form at the
   bottom of each card is visible in add-only + full; row edits and delete
   are hidden in add-only.
   ────────────────────────────────────────────────────────────────────────── */

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
    help: 'L1 of the 3-step Payments cascade. Merchant / Online / Cash.',
  },
  {
    category: 'payment_merchant',
    title:    'Payment Merchant (Bank)',
    help:     'Shown under Method=Merchant in the Payments table.',
  },
  {
    category: 'online_type',
    title:    'Online Sub-type',
    help:     'Shown under Method=Online in the Payments table.',
  },
  {
    category: 'installment_plan',
    title:    'Installment Plan',
    help:     'Shown alongside Merchant bank when Method=Merchant.',
  },
  {
    category: 'venue',
    title:    'Venue',
    help:     'Shown in the Order Info card on SO Detail / New SO.',
  },
];

const DropdownsSection = ({ mode }: { mode: MaintenanceMode }) => {
  const all = useAllSoDropdownOptions();

  return (
    <>
      <div className={styles.banner} style={{ marginTop: 'var(--space-4)' }}>
        <strong>Dropdowns.</strong> Values used by the Customer Type / Building
        Type / Relationship / Payment Method selects on New SO and Edit SO.
        {mode === 'view' && ' Read-only on this account.'}
        {mode === 'add-only' && ' You can add new options here; editing or removing existing ones is admin-only.'}
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
            mode={mode}
          />
        ))
      )}
    </>
  );
};

const DropdownCategoryCard = ({
  category, title, help, rows, mode,
}: {
  category: SoDropdownCategory;
  title:    string;
  help:     string;
  rows:     SoDropdownOption[];
  mode:     MaintenanceMode;
}) => {
  const [expanded, setExpanded] = useState(true);
  const createOpt = useCreateSoDropdownOption();
  const [newValue, setNewValue] = useState('');
  const [newLabel, setNewLabel] = useState('');

  const addRow = () => {
    const value = newValue.trim();
    const label = newLabel.trim();
    if (!value || !label) {
      window.alert('Both Value and Label are required.');
      return;
    }
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
          fontWeight: 'var(--w-semibold)',
          fontSize: 'var(--fs-12)',
          letterSpacing: 'var(--tk-loud)',
          textTransform: 'uppercase',
          color: 'var(--fg-soft)',
        }}
      >
        {expanded
          ? <ChevronDown  size={14} strokeWidth={1.75} />
          : <ChevronRight size={14} strokeWidth={1.75} />}
        <span>{title}</span>
        <span style={{ color: 'var(--fg-muted)', fontWeight: 400, fontSize: 'var(--fs-12)', textTransform: 'none', letterSpacing: 0 }}>
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
            <div className={styles.empty}>No options yet{canAdd(mode) ? ' — add one below.' : '.'}</div>
          ) : (
            <table className={styles.table}>
              <thead>
                <tr>
                  <th style={{ width: '30%' }}>Value</th>
                  <th style={{ width: '50%' }}>Label</th>
                  {/* Active column only renders for full-mode admins — in
                      add-only / view modes a toggle would be an edit. */}
                  {canEdit(mode) && <th style={{ width: 80 }}>Active</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td><code className={styles.code}>{row.value}</code></td>
                    <td>{row.label}</td>
                    {canEdit(mode) && (
                      <td>{row.active ? 'Yes' : 'No'}</td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {canAdd(mode) && (
            <div style={{
              display: 'grid',
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

/* ════════════════════════════════════════════════════════════════════════
   VenuesSection — read in every mode; add-venue form in add-only + full;
   Edit + Deactivate buttons only in full.
   ════════════════════════════════════════════════════════════════════════ */

const VenuesSection = ({ mode }: { mode: MaintenanceMode }) => {
  const venues = useVenues({ includeInactive: true });
  const create = useCreateVenue();

  const [newName, setNewName] = useState('');
  const [newAddress, setNewAddress] = useState('');

  const addVenue = () => {
    if (!newName.trim()) { window.alert('Name required.'); return; }
    create.mutate(
      { name: newName.trim(), address: newAddress.trim() || null },
      {
        onSuccess: () => { setNewName(''); setNewAddress(''); },
        onError: (e) => window.alert(`Create failed: ${(e as Error).message}`),
      },
    );
  };

  return (
    <section style={{ marginBottom: 'var(--space-6)' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
        <MapPin size={20} strokeWidth={1.75} />
        <h2 style={{ margin: 0, fontFamily: 'var(--font-title)', fontSize: 'var(--fs-20)', fontWeight: 700 }}>
          Venues
        </h2>
        <span style={{ fontFamily: 'var(--font-button)', fontSize: 'var(--fs-12)', letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--fg-muted)' }}>
          ({venues.data?.length ?? 0})
        </span>
      </header>
      <p style={{
        fontSize: 'var(--fs-13)', color: 'var(--fg-muted)',
        marginBottom: 'var(--space-3)',
      }}>
        Where the sales force operates from. Every POS-created SO carries the
        venue for reporting.
      </p>

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Name</th>
              <th>Address</th>
              <th style={{ width: 110 }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {venues.isLoading && (
              <tr><td colSpan={3} className={styles.empty}>Loading…</td></tr>
            )}
            {!venues.isLoading && (venues.data ?? []).length === 0 && (
              <tr><td colSpan={3} className={styles.empty}>
                No venues yet{canAdd(mode) ? ' — add one below.' : '.'}
              </td></tr>
            )}
            {(venues.data ?? []).map((v: VenueRow) => (
              <tr key={v.id}>
                <td><strong>{v.name}</strong></td>
                <td>{v.address ?? '—'}</td>
                <td>
                  <span style={{
                    display: 'inline-block', padding: '3px 10px',
                    borderRadius: 999, fontSize: 'var(--fs-11)', fontWeight: 600,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    background: v.active ? 'rgba(47, 93, 79, 0.12)' : 'rgba(34, 31, 32, 0.06)',
                    color: v.active ? 'var(--c-secondary-a, #2F5D4F)' : 'var(--fg-muted)',
                  }}>
                    {v.active ? 'Active' : 'Inactive'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {canAdd(mode) && (
          <div style={{
            display: 'flex', gap: 'var(--space-3)', alignItems: 'center',
            padding: 'var(--space-3) var(--space-4)',
            borderTop: '1px solid var(--line)', background: 'var(--c-cream)',
          }}>
            <input
              className={styles.input}
              value={newName}
              placeholder="New venue name"
              onChange={(e) => setNewName(e.target.value)}
              style={{ flex: '0 0 220px' }}
            />
            <input
              className={styles.input}
              value={newAddress}
              placeholder="Address (optional)"
              onChange={(e) => setNewAddress(e.target.value)}
              style={{ flex: 1 }}
            />
            <Button variant="primary" size="sm" onClick={addVenue} disabled={create.isPending}>
              <Plus size={14} strokeWidth={1.75} />
              <span>{create.isPending ? 'Adding…' : 'Add venue'}</span>
            </Button>
          </div>
        )}
      </div>
    </section>
  );
};
