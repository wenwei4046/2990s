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
import { ArrowLeft, Plus, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
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
