// ----------------------------------------------------------------------------
// ProductModels — list page at /product-models (PR #49).
//
// "Group by Model" landing screen. Lists every product_models row grouped by
// category, with SKU count + active/inactive status. Click a Model → detail
// page where allowed-options + name + description are managed.
//
// Replaces the old SKU-only flat list when commander wants to manage at the
// Model layer. The plain SKU list lives on /products (SkuMasterTab).
// ----------------------------------------------------------------------------

import { Fragment, useEffect, useMemo, useState } from 'react';
import { ProductModelDetail } from './ProductModelDetail';
import { Layers, Search, Plus, Trash2, Truck, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useProductModels, useCreateProductModel, useGenerateModelSkus, useDeleteProductModel,
  type ProductModelRow,
} from '../lib/product-models-queries';
import { useMaintenanceConfig, useMfgProducts, type MfgCategory, type MfgProductRow } from '../lib/mfg-products-queries';
import {
  useSuppliers, useCreateBindingsBatch,
  type Currency, type MaterialKind, type NewBinding,
} from '../lib/suppliers-queries';
import { resolveSizeInfo } from '../lib/size-info';
import { SkuPreviewStrip } from './SupplierDetail';
import { composeSupplierSku } from '../lib/supplier-sku-helpers';
import styles from './ProductModels.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

const CATEGORIES: MfgCategory[] = ['SOFA', 'BEDFRAME', 'MATTRESS', 'ACCESSORY', 'SERVICE'];

export const ProductModels = () => {
  const [filter, setFilter] = useState<MfgCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  // PR #119 — Commander 2026-05-26: clicking a Model in Modular tab opens
  // a right-side drawer with the detail content (photo / allowed options /
  // SKU variants) instead of navigating away to /product-models/{id}. The
  // dedicated route still exists for deep-links; this is just the Modular
  // entrypoint.
  const [openModelId, setOpenModelId] = useState<string | null>(null);
  // PR #106 — Commander 2026-05-26: showed Modular list with rows he didn't
  // recognize ("这些都没在我的 SKU 里面啊"). Multi-select + bulk delete so he
  // can sweep orphan Models (test entries, migration-0062 backfill leftovers)
  // without clicking into each one.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting]       = useState(false);
  // PR — Commander 2026-05-27: tick N Models → "Assign to supplier · N
  // selected" CTA opens a Modular-tab parallel of SupplierDetail's
  // ModelSkuPickerDialog. Picks a supplier, types ONE supplier code +
  // description per Model, fans the binding out across every active SKU
  // under each Model in a single /bindings/batch POST.
  const [assigningSupplier, setAssigningSupplier] = useState(false);
  const deleteMut = useDeleteProductModel();

  const { data: models = [], isLoading, error } = useProductModels(
    filter === 'all' ? undefined : { category: filter },
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return models;
    return models.filter(
      (m) => m.model_code.toLowerCase().includes(q) || m.name.toLowerCase().includes(q),
    );
  }, [models, search]);

  // Group by category for the section headers.
  const grouped = useMemo(() => {
    const map = new Map<MfgCategory, ProductModelRow[]>();
    for (const m of filtered) {
      const arr = map.get(m.category) ?? [];
      arr.push(m);
      map.set(m.category, arr);
    }
    return map;
  }, [filtered]);

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.titleRow}>
          <Layers size={22} strokeWidth={1.75} />
          <h1 className="t-h2">Product Models</h1>
          <span className={styles.count}>{filtered.length} models</span>
        </div>
        <div className={styles.actions}>
          <div className={styles.searchBox}>
            <Search {...ICON} />
            <input
              type="search"
              placeholder="Model code / name…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <Button variant="primary" size="md" onClick={() => setCreating(true)}>
            <Plus {...ICON} /> New Model
          </Button>
        </div>
      </header>

      {/* Category filter chips */}
      <div className={styles.chipRow}>
        <FilterChip on={filter === 'all'} onClick={() => setFilter('all')}>All</FilterChip>
        {CATEGORIES.map((c) => (
          <FilterChip key={c} on={filter === c} onClick={() => setFilter(c)}>
            {c}
          </FilterChip>
        ))}
      </div>

      {error && (
        <div className={styles.errorBanner}>
          Failed to load: {error instanceof Error ? error.message : String(error)}
        </div>
      )}
      {isLoading && <div className={styles.loading}>Loading models…</div>}

      {/* PR #106 — Bulk-select toolbar. Sticky-ish strip that surfaces only
          when at least one Model is ticked; mirrors the SKU Master pattern
          (PR #82). */}
      {selectedIds.size > 0 && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          background: 'rgba(232, 107, 58, 0.08)',
          border: '1px solid var(--c-orange)',
          borderRadius: 'var(--radius-md)',
          gap: 'var(--space-3)',
        }}>
          <span style={{ fontWeight: 600, color: 'var(--c-burnt)' }}>
            {selectedIds.size} model{selectedIds.size === 1 ? '' : 's'} selected
          </span>
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())}>Clear</Button>
            {/* PR — Commander 2026-05-27: primary CTA pivots the bulk-select
                toolbar from "manage Models" into the supplier-mapping flow.
                Promotes the "Assign to supplier" action over the destructive
                Delete (Delete is demoted to a ghost button on its right). */}
            <Button
              variant="primary"
              size="sm"
              onClick={() => setAssigningSupplier(true)}
            >
              <Truck {...ICON} /> Assign to supplier · {selectedIds.size} selected
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={deleting}
              onClick={async () => {
                // eslint-disable-next-line no-alert
                if (!confirm(
                  `Delete ${selectedIds.size} Model${selectedIds.size === 1 ? '' : 's'}? ` +
                  `Any SKUs underneath stay in mfg_products but lose their model_id link.`,
                )) return;
                setDeleting(true);
                const ids = Array.from(selectedIds);
                const results = await Promise.all(ids.map((id) =>
                  deleteMut.mutateAsync(id).then(() => ({ id, ok: true as const }))
                    .catch((e) => ({ id, ok: false as const, err: e instanceof Error ? e.message : String(e) })),
                ));
                setDeleting(false);
                setSelectedIds(new Set());
                const failed = results.filter((r) => !r.ok);
                if (failed.length > 0) {
                  const sample = failed.slice(0, 3).map((f) => `· ${'err' in f ? f.err.slice(0, 160) : ''}`).join('\n');
                  // eslint-disable-next-line no-alert
                  alert(`Deleted ${results.length - failed.length} / ${results.length}. ${failed.length} failed:\n${sample}`);
                }
              }}
            >
              <Trash2 {...ICON} /> {deleting ? 'Deleting…' : `Delete ${selectedIds.size}`}
            </Button>
          </span>
        </div>
      )}

      {/* Grouped tables */}
      {Array.from(grouped.entries()).map(([cat, rows]) => {
        const allTicked = rows.every((m) => selectedIds.has(m.id));
        const someTicked = rows.some((m) => selectedIds.has(m.id));
        return (
        <section key={cat} className={styles.section}>
          <h2 className={styles.sectionTitle}>
            {cat} <span className={styles.sectionCount}>· {rows.length}</span>
          </h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    aria-label={`Select all ${cat}`}
                    checked={allTicked}
                    ref={(el) => { if (el) el.indeterminate = !allTicked && someTicked; }}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setSelectedIds((prev) => {
                        const n = new Set(prev);
                        rows.forEach((m) => {
                          if (checked) n.add(m.id); else n.delete(m.id);
                        });
                        return n;
                      });
                    }}
                  />
                </th>
                <th>Code</th>
                <th>Name</th>
                <th>Active</th>
                <th style={{ textAlign: 'right' }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                // PR #137 — Commander 2026-05-26: "我希望指向那个 row，就可以
                // 通过双击点进去". Single-click was reverted in PR #110 because
                // it fired on incidental scroll hovers; double-click is
                // deliberate enough to read as intent. Row hover gets a
                // pointer cursor + cream highlight so the affordance is
                // visible.
                <tr
                  key={m.id}
                  className={styles.modelRow}
                  onDoubleClick={() => setOpenModelId(m.id)}
                >
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Select ${m.model_code}`}
                      checked={selectedIds.has(m.id)}
                      onChange={() => setSelectedIds((prev) => {
                        const n = new Set(prev);
                        if (n.has(m.id)) n.delete(m.id); else n.add(m.id);
                        return n;
                      })}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={styles.codeChipLink}
                      onClick={() => setOpenModelId(m.id)}
                      style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}
                    >
                      <code className={styles.codeChip}>{m.model_code}</code>
                    </button>
                  </td>
                  <td className={styles.nameText}>
                    {m.name}
                  </td>
                  <td>
                    <span className={`${styles.statusPill} ${m.active ? styles.active : styles.inactive}`}>
                      {m.active ? 'ACTIVE' : 'INACTIVE'}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right', color: 'var(--fg-muted)' }}>
                    {m.description ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        );
      })}

      {!isLoading && filtered.length === 0 && (
        <div className={styles.empty}>
          No models match. Try clearing filters, or click "+ New Model" to create one.
        </div>
      )}

      {creating && <NewModelDialog onClose={() => setCreating(false)} />}

      {/* PR — Commander 2026-05-27: bulk Assign-to-Supplier dialog. */}
      {assigningSupplier && (
        <ModularAssignSupplierDialog
          modelIds={Array.from(selectedIds)}
          onClose={() => setAssigningSupplier(false)}
          onSaved={() => {
            setAssigningSupplier(false);
            setSelectedIds(new Set());
          }}
        />
      )}

      {/* PR #119 — embedded Model detail drawer */}
      {openModelId && (
        <div
          onClick={() => setOpenModelId(null)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.35)',
            zIndex: 90,
            display: 'flex',
            justifyContent: 'flex-end',
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(1100px, 92vw)',
              height: '100%',
              background: 'var(--bg)',
              boxShadow: 'var(--shadow-3)',
              overflowY: 'auto',
              animation: 'none',
            }}
          >
            <ProductModelDetail modelId={openModelId} onClose={() => setOpenModelId(null)} />
          </div>
        </div>
      )}
    </div>
  );
};

function FilterChip({
  children, on, onClick,
}: { children: React.ReactNode; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={`${styles.filterChip} ${on ? styles.filterChipOn : ''}`}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/* ────────────────────────── + New Model dialog ─────────────────────────── */

// Exported so SKU Master's "+ New SKU" button can drive the same dialog.
// `initialCategory` pre-selects the dropdown — used when the SKU Master is
// already filtered to a category, so the user doesn't have to pick again.
// `onCreated` fires after the Model row is saved — used by SKU Master to
// trigger the auto-generate flow without showing the Model Detail page.
// PR #78b — Bulk row shape. Each Model in the batch has its own branding /
// code / name / thickness / description; sizes (or compartments for SOFA)
// are shared below all rows and apply to every Model in the batch.
type ModelRow = {
  // Stable React key — not sent to the API.
  rid:         string;
  branding:    string;
  modelCode:   string;
  name:        string;
  thicknessCm: string;  // MATTRESS only; ignored for other categories
  description: string;
};

const emptyRow = (): ModelRow => ({
  rid:         `r${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  branding:    '',
  modelCode:   '',
  name:        '',
  thicknessCm: '',
  description: '',
});

export function NewModelDialog({
  onClose, initialCategory, onCreated,
}: {
  onClose: () => void;
  initialCategory?: MfgCategory;
  /** Only fires in single-row mode (rows.length === 1). Used by SKU Master's
      "+ New SKU" entry-point to chain into the existing auto-generate flow. */
  onCreated?: (modelId: string, category: MfgCategory) => void;
}) {
  const [category, setCategory]   = useState<MfgCategory>(initialCategory ?? 'SOFA');
  const [rows, setRows]           = useState<ModelRow[]>(() => [emptyRow()]);
  const [pickedSizes, setPickedSizes] = useState<Set<string>>(new Set());
  const [pickedComps, setPickedComps] = useState<Set<string>>(new Set());
  const [batchError, setBatchError]   = useState<string | null>(null);
  const [submitting,  setSubmitting]  = useState(false);

  const maintenance = useMaintenanceConfig('master');
  const createMut   = useCreateProductModel();
  const generateMut = useGenerateModelSkus();

  // PR #87 — Commander 2026-05-26: bulk pickers should default to all-on so a
  // new Model is born offering every variant from the global pool; commander
  // toggles off what doesn't apply. Re-runs on pool change so a Maintenance
  // edit (e.g. adding SP to bedframe sizes) doesn't leave the dialog stale.
  const _sizesPool = (category === 'MATTRESS'
    ? maintenance.data?.data?.mattressSizes
    : maintenance.data?.data?.bedframeSizes) ?? [];
  const _compsPool = maintenance.data?.data?.sofaCompartments ?? [];
  useEffect(() => {
    if ((category === 'MATTRESS' || category === 'BEDFRAME') && _sizesPool.length > 0) {
      setPickedSizes(new Set(_sizesPool));
    } else {
      setPickedSizes(new Set());
    }
    if (category === 'SOFA' && _compsPool.length > 0) {
      setPickedComps(new Set(_compsPool));
    } else {
      setPickedComps(new Set());
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, _sizesPool.length, _compsPool.length]);

  const sharedCount = (category === 'SOFA') ? pickedComps.size : pickedSizes.size;
  const totalSkus   = rows.length * sharedCount;

  const updateRow = (rid: string, patch: Partial<ModelRow>) => {
    setRows((prev) => prev.map((r) => (r.rid === rid ? { ...r, ...patch } : r)));
  };
  const addRow    = () => setRows((prev) => [...prev, emptyRow()]);
  const removeRow = (rid: string) =>
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.rid !== rid) : prev));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBatchError(null);

    // Validate every row up front so a half-batch failure isn't possible.
    for (const r of rows) {
      if (!r.modelCode.trim() || !r.name.trim()) {
        setBatchError(`Every row needs a model code + name. Row ${rows.indexOf(r) + 1} is incomplete.`);
        return;
      }
      if (category === 'MATTRESS') {
        const t = parseInt(r.thicknessCm.trim(), 10);
        if (!Number.isFinite(t) || t <= 0) {
          setBatchError(`Mattress thickness required. Row ${rows.indexOf(r) + 1} is missing it.`);
          return;
        }
      }
    }
    // Duplicate-code check inside the batch (server would reject the second
    // one, leaving a confusing half-success — easier to catch here first).
    const codes = rows.map((r) => r.modelCode.trim());
    const dup   = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dup) {
      setBatchError(`Model code "${dup}" appears more than once in this batch.`);
      return;
    }

    setSubmitting(true);
    try {
      // Build allowedOptions shared across the batch (sizes or compartments
      // — same selection applies to every row). Each row layers its own
      // thickness onto the shared blob for MATTRESS.
      const sharedSizes = (category === 'MATTRESS' || category === 'BEDFRAME') && pickedSizes.size > 0
        ? Array.from(pickedSizes) : null;
      const sharedComps = category === 'SOFA' && pickedComps.size > 0
        ? Array.from(pickedComps) : null;

      // Create Models in parallel — server protects against duplicate codes
      // across batches via the existing 23505 path.
      const createdModels = await Promise.all(rows.map(async (r) => {
        const allowedOptions: Record<string, unknown> = {};
        if (sharedSizes) allowedOptions.sizes = sharedSizes;
        if (sharedComps) allowedOptions.compartments = sharedComps;
        if (category === 'MATTRESS') {
          const t = parseInt(r.thicknessCm.trim(), 10);
          if (Number.isFinite(t) && t > 0) allowedOptions.mattress_thickness_cm = t;
        }
        const res = await createMut.mutateAsync({
          branding:    r.branding.trim() || null,
          modelCode:   r.modelCode.trim(),
          name:        r.name.trim(),
          category,
          description: r.description.trim() || null,
          ...(Object.keys(allowedOptions).length > 0 ? { allowedOptions } : {}),
        });
        return res.model;
      }));

      // Auto-generate SKU variants for every Model whose batch had sizes /
      // compartments selected. Models with neither selected get created but
      // skip generation (matches the existing "empty allowed_options = no
      // restriction" semantics — commander can pick later from detail page).
      let totalGenerated = 0;
      if (sharedSizes || sharedComps) {
        const results = await Promise.all(createdModels.map((m) =>
          generateMut.mutateAsync({ id: m.id }).catch((err) => ({ generated: 0, _err: err })),
        ));
        totalGenerated = results.reduce((sum, r) => sum + (r.generated ?? 0), 0);
      }

      // Single-row + onCreated → chain into the caller's auto-generate flow
      // (preserved for SKU Master "+ New SKU" entry).
      if (rows.length === 1 && createdModels[0] && onCreated) {
        onCreated(createdModels[0].id, category);
      } else {
        // eslint-disable-next-line no-alert
        alert(`Created ${createdModels.length} Model${createdModels.length === 1 ? '' : 's'}` +
          (totalGenerated > 0 ? ` · auto-generated ${totalGenerated} SKU${totalGenerated === 1 ? '' : 's'}.` : '.'));
        onClose();
      }
    } catch (e2) {
      setBatchError(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setSubmitting(false);
    }
  };

  // Aliased to the same pools the auto-fill effect already computed so the
  // InlineAllowedOptions below + the All / None buttons inside it work off a
  // single source.
  const sizesPool = _sizesPool;
  const compsPool = _compsPool;

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <form
        className={`${styles.modal} ${styles.modalCompact}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
      >
        {/* PR — Commander 2026-05-26: "做成长方形、大一点". Title + category
            side-by-side so the header doesn't burn three rows before the
            first Model card. Sub line is shrunk into a single sentence. */}
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-4)', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <h2 className={styles.modalTitle}>New Models (bulk)</h2>
            <p className={styles.modalSub} style={{ margin: 0 }}>
              One row per Model. Pick sizes / compartments below — applied to every row.
            </p>
          </div>
          <label className={styles.compactField} style={{ width: 200 }}>
            <span>Category</span>
            <select value={category} onChange={(e) => setCategory(e.target.value as MfgCategory)}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
        </div>

        {rows.map((row, i) => (
          <ModelRowCard
            key={row.rid}
            row={row}
            index={i}
            category={category}
            canRemove={rows.length > 1}
            onChange={(patch) => updateRow(row.rid, patch)}
            onRemove={() => removeRow(row.rid)}
          />
        ))}

        {/* PR #91 — Commander 2026-05-26: "为什么我不能添加 Line 2、Line 3
            这样子的？" The Add-row button existed but was an unstyled ghost
            tucked under the last card. Promoted to a dashed full-width tile
            so it reads as "add another row" the way a spreadsheet does. */}
        <button
          type="button"
          onClick={addRow}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            width: '100%',
            padding: '10px 12px',
            marginTop: 4,
            border: '1px dashed var(--c-orange)',
            borderRadius: 'var(--radius-md)',
            background: 'transparent',
            color: 'var(--c-orange)',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--fs-13)',
            fontWeight: 600,
            cursor: 'pointer',
            transition: 'background 120ms ease',
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = 'rgba(213,90,40,0.06)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; }}
        >
          <Plus {...ICON} />
          <span>Add Model {rows.length + 1}</span>
        </button>

        {/* Shared sizes / compartments — applied to every row in the batch. */}
        {(category === 'MATTRESS' || category === 'BEDFRAME') && (
          <InlineAllowedOptions
            label={`Sizes (apply to all ${rows.length} row${rows.length === 1 ? '' : 's'})`}
            hint="Defaults to every size — untick what this batch doesn't sell · pool from Maintenance"
            options={sizesPool}
            picked={pickedSizes}
            onToggle={(v) => setPickedSizes((prev) => {
              const n = new Set(prev);
              if (n.has(v)) n.delete(v); else n.add(v);
              return n;
            })}
            onSetAll={(vs) => setPickedSizes(new Set(vs))}
            formatChip={(code) => {
              // PR #92 — consult Maintenance override so commander relabel
              // (K → "Super K") rides through the chip preview live.
              const info = resolveSizeInfo(code, maintenance.data?.data);
              return info.label && info.label !== code ? `${code} · ${info.label}` : code;
            }}
          />
        )}
        {category === 'SOFA' && (
          <InlineAllowedOptions
            label={`Compartments (apply to all ${rows.length} row${rows.length === 1 ? '' : 's'})`}
            hint="Defaults to every compartment — untick what this batch doesn't offer · pool from Maintenance"
            options={compsPool}
            picked={pickedComps}
            onToggle={(v) => setPickedComps((prev) => {
              const n = new Set(prev);
              if (n.has(v)) n.delete(v); else n.add(v);
              return n;
            })}
            onSetAll={(vs) => setPickedComps(new Set(vs))}
          />
        )}

        {batchError && (
          <div className={styles.errorBanner}>{batchError}</div>
        )}

        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" type="submit" disabled={submitting}>
            {submitting
              ? 'Creating…'
              : sharedCount > 0
                ? `Create ${rows.length} × ${sharedCount} = ${totalSkus} SKUs`
                : `Create ${rows.length} Model${rows.length === 1 ? '' : 's'}`}
          </Button>
        </footer>
      </form>
    </div>
  );
}

/* ─────────── Per-row card (bulk mode) ────────────────────────────────────
   Branding / Model code / Name / (Mattress thickness) / Description plus a
   little × in the corner so commander can prune the row. Inline preview at
   the bottom of the card shows the SKU shape this row + the shared sizes
   below will materialise. */
function ModelRowCard({
  row, index, category, canRemove, onChange, onRemove,
}: {
  row:       ModelRow;
  index:     number;
  category:  MfgCategory;
  canRemove: boolean;
  onChange:  (patch: Partial<ModelRow>) => void;
  onRemove:  () => void;
}) {
  // PR — Commander 2026-05-26: "才两个就占满屏幕了". Switched the per-row
  // card from stacked grid (3 visual rows: Branding+Code, Name, Description)
  // to a single landscape line — # · Branding · Model code · Name · [Thickness]
  // · Description · ×. At 1200px modal width this fits comfortably, and the
  // grid-template-columns shifts only to add Thickness for Mattress.
  // Each row card now collapses from ~180px tall to ~50px tall, so 6+ rows
  // fit on screen instead of 2.
  const gridCols =
    category === 'MATTRESS'
      ? '28px 110px 150px minmax(160px, 1.4fr) 80px minmax(160px, 1.4fr) 24px'
      : '28px 110px 150px minmax(160px, 1.4fr) minmax(160px, 1.4fr) 24px';

  return (
    <div className={styles.compactRowCard}>
      <div className={styles.compactRowFields} style={{ gridTemplateColumns: gridCols }}>
        <div className={styles.compactRowBadge}>#{index + 1}</div>

        <label className={styles.compactField}>
          <span>Branding</span>
          <input type="text" value={row.branding} onChange={(e) => onChange({ branding: e.target.value })}
            placeholder={category === 'MATTRESS' ? '2990S' : ''} />
        </label>

        <label className={styles.compactField}>
          <span>Model code *</span>
          <input type="text" value={row.modelCode} onChange={(e) => onChange({ modelCode: e.target.value })}
            placeholder={
              category === 'SOFA'     ? '5530' :
              category === 'BEDFRAME' ? '1003' :
              'AKKA-FIRM MATT'
            }
            required />
        </label>

        <label className={styles.compactField}>
          <span>Name *</span>
          <input type="text" value={row.name} onChange={(e) => onChange({ name: e.target.value })}
            placeholder={
              category === 'SOFA'     ? 'SOFA 5530' :
              category === 'BEDFRAME' ? 'HILTON BEDFRAME' :
              '2990 AKKA-FIRM MATTRESS'
            }
            required />
        </label>

        {category === 'MATTRESS' && (
          <label className={styles.compactField}>
            <span>Thick (cm) *</span>
            <input type="number" inputMode="numeric" min={1} step={1}
              value={row.thicknessCm} onChange={(e) => onChange({ thicknessCm: e.target.value })}
              placeholder="31" required />
          </label>
        )}

        <label className={styles.compactField}>
          <span>Description</span>
          <input type="text" value={row.description} onChange={(e) => onChange({ description: e.target.value })}
            placeholder="optional" />
        </label>

        {canRemove ? (
          <button type="button" onClick={onRemove} title="Remove this row" className={styles.compactRowClose}>
            ✕
          </button>
        ) : (
          <span />
        )}
      </div>
    </div>
  );
}

// PR #78b — TemplatePreview removed (was single-row, lived above the Cancel /
// Create buttons). Bulk mode shows the SKU shape implicitly via the row
// inputs + the shared sizes/compartments picker — repeating the preview N
// times for N rows would be noisy. The hardcoded API templates in
// apps/api/src/routes/product-models.ts still produce the same shapes.

/* ─────────── Inline allowed-options chip toggle ──────────────────────────
   Used in NewModelDialog so commander can pick sizes/compartments without
   navigating to the Model detail page after create. PR #87 — Defaults to
   all-on (the parent useEffect pre-fills picked with the full pool); All /
   None mini-buttons live inline with the label so commander can flip every
   chip in one tap. Untick = excluded from the batch's auto-generated SKUs. */
function InlineAllowedOptions({
  label, hint, options, picked, onToggle, onSetAll, formatChip,
}: {
  label:       string;
  hint:        string;
  options:     string[];
  picked:      Set<string>;
  onToggle:    (value: string) => void;
  /** PR #87 — Bulk setter. Receives the full pool (for All) or [] (for None). */
  onSetAll?:   (values: string[]) => void;
  /** Optional pretty-formatter (e.g. SIZE_INFO enrichment). Defaults to raw. */
  formatChip?: (value: string) => string;
}) {
  if (options.length === 0) {
    return (
      <div className={styles.field}>
        <span className="t-eyebrow">{label}</span>
        <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', margin: 0 }}>
          Maintenance pool is empty — add entries in Maintenance first.
        </p>
      </div>
    );
  }
  const allOn  = picked.size === options.length;
  const allOff = picked.size === 0;
  // PR #91 — Commander 2026-05-26: "Size apply to all 那个地方可以做小一
  // 点啊". Collapsed label + hint + All/None onto a single line so the
  // "Sizes (apply to all 1 row)" header doesn't eat three rows of vertical
  // space above the chip pills.
  return (
    <div className={styles.field} style={{ gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        <span className="t-eyebrow" style={{ marginRight: 4 }}>{label}</span>
        <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>· {hint}</span>
        {onSetAll && (
          <span style={{ marginLeft: 'auto', display: 'inline-flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => onSetAll(options)}
              disabled={allOn}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-11)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                padding: '1px 7px',
                borderRadius: 999,
                border: '1px solid var(--line)',
                background: 'var(--c-paper)',
                color: allOn ? 'var(--fg-muted)' : 'var(--fg)',
                cursor: allOn ? 'default' : 'pointer',
                opacity: allOn ? 0.5 : 1,
              }}
              title="Tick every option"
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onSetAll([])}
              disabled={allOff}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-11)',
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                padding: '1px 7px',
                borderRadius: 999,
                border: '1px solid var(--line)',
                background: 'var(--c-paper)',
                color: allOff ? 'var(--fg-muted)' : 'var(--fg)',
                cursor: allOff ? 'default' : 'pointer',
                opacity: allOff ? 0.5 : 1,
              }}
              title="Untick every option"
            >
              None
            </button>
          </span>
        )}
      </div>
      {/* PR #91 — Reverted to compact pills (Commander 2026-05-26: "为什么会
          变成正方形？这是什么鬼"). 22 sofa compartments × 92px tiles wrapped
          to 6 rows on a 720px modal; pills wrap to 2-3 rows with the same
          info. formatChip splits "K · 6FT" onto an inline secondary span so
          the label still rides alongside the code without forcing a tile. */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {options.map((opt) => {
          const isOn = picked.has(opt);
          const display = formatChip ? formatChip(opt) : opt;
          const parts = display.split(' · ');
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '4px 12px',
                borderRadius: 999,
                border: '1px solid ' + (isOn ? 'var(--c-orange)' : 'var(--line-strong)'),
                background: isOn ? 'var(--c-orange)' : 'var(--c-paper)',
                color: isOn ? 'var(--c-cream)' : 'var(--c-ink)',
                cursor: 'pointer',
                transition: 'all 120ms ease-out',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-12)',
                lineHeight: 1.4,
              }}
              title={display}
            >
              <span style={{ fontWeight: 700 }}>{parts[0]}</span>
              {parts[1] && (
                <span style={{ opacity: isOn ? 0.85 : 0.55, fontWeight: 500 }}>
                  · {parts.slice(1).join(' · ')}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ════════════════════════════════════════════════════════════════════════
   ModularAssignSupplierDialog — Modular-tab parallel of SupplierDetail's
   ModelSkuPickerDialog (PR #206). Reached from the multi-select toolbar:
   tick N Models → "Assign to supplier · N selected" CTA → this dialog.

   Flow:
     1. Pick a supplier (dropdown of ACTIVE suppliers).
     2. One row per Model — supplier_code · description · unit price · lead
        · MOQ · main toggle. Description fans out into the bindings.notes
        column shared with the rest of the supplier-mapping flow.
     3. Each Model row has a "▸ N SKUs" expander so commander can preview
        the OUR-SKU codes about to be bulk-mapped before pressing Save.
     4. Save → expand each Model into its ACTIVE SKUs and POST one binding
        per SKU into /bindings/batch. Uses the same useCreateBindingsBatch
        mutation as SupplierDetail (server de-dupes against existing rows).

   Reuses SkuPreviewStrip from SupplierDetail so the chip-strip stays in
   sync across both entry points.
   ════════════════════════════════════════════════════════════════════════ */

type AssignDraft = {
  modelId:        string;
  modelCode:      string;
  modelName:      string;
  /** Full SKU rows so the preview / save path can derive a per-SKU
      supplier_sku suffix (compartment for sofa, size_code for bedframe /
      mattress) via composeSupplierSku(). PR — Commander 2026-05-27. */
  skus:           MfgProductRow[];
  // Per-supplier already-bound subset (computed in supplier-select effect).
  alreadyBound:   string[];
  supplierCode:   string;
  description:    string;
  unitPriceCenti: number;
  leadTimeDays:   number;
  moq:            number;
  isMainSupplier: boolean;
};

function ModularAssignSupplierDialog({
  modelIds, onClose, onSaved,
}: {
  modelIds: string[];
  onClose:  () => void;
  onSaved:  () => void;
}) {
  const suppliersQ = useSuppliers({ status: 'ACTIVE' });
  const modelsQ    = useProductModels();
  // PR — pull every active SKU once and group by model_id client-side; same
  // pattern as ModelSkuPickerDialog. 2990s' catalogue is small enough that
  // the alternative (one query per Model) is wasteful.
  const productsQ  = useMfgProducts();
  const batchMut   = useCreateBindingsBatch();

  const [supplierId,  setSupplierId]  = useState<string>('');
  const [drafts,      setDrafts]      = useState<Record<string, AssignDraft>>({});
  const [expanded,    setExpanded]    = useState<Set<string>>(new Set());
  const [error,       setError]       = useState<string | null>(null);

  const toggleExpanded = (id: string) => setExpanded((s) => {
    const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n;
  });

  // Seed one draft per picked Model. SKU list is the ACTIVE SKUs under that
  // model_id; price defaults to the average base_price of those SKUs.
  useEffect(() => {
    if (!modelsQ.data || !productsQ.data) return;
    const skusByModel = new Map<string, MfgProductRow[]>();
    for (const p of productsQ.data) {
      if (!p.model_id) continue;
      const arr = skusByModel.get(p.model_id) ?? [];
      arr.push(p);
      skusByModel.set(p.model_id, arr);
    }
    const seeded: Record<string, AssignDraft> = {};
    for (const id of modelIds) {
      const model = modelsQ.data.find((m) => m.id === id);
      if (!model) continue;
      const skus = skusByModel.get(id) ?? [];
      const prices = skus.map((s) => s.base_price_sen ?? 0).filter((v) => v > 0);
      const avg = prices.length
        ? Math.round(prices.reduce((a, b) => a + b, 0) / prices.length)
        : 0;
      seeded[id] = {
        modelId:        model.id,
        modelCode:      model.model_code,
        modelName:      model.name,
        skus,
        alreadyBound:   [],
        supplierCode:   '',
        description:    '',
        unitPriceCenti: avg,
        leadTimeDays:   7,
        moq:            1,
        isMainSupplier: false,
      };
    }
    setDrafts(seeded);
  // Re-seed only when the input Model set changes or upstream data first
  // arrives — supplier choice does NOT reset the user's typed code/desc.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelIds.join('|'), modelsQ.data?.length, productsQ.data?.length]);

  const setDraft = (id: string, patch: Partial<AssignDraft>) => {
    setDrafts((s) => ({ ...s, [id]: { ...s[id]!, ...patch } }));
  };

  const loading = suppliersQ.isLoading || modelsQ.isLoading || productsQ.isLoading;

  const submit = () => {
    setError(null);
    if (!supplierId) { setError('Pick a supplier first.'); return; }
    const list: NewBinding[] = [];
    for (const d of Object.values(drafts)) {
      const code = d.supplierCode.trim();
      // Skip Models with no supplier code typed — commander left this Model
      // empty on purpose. Same convention as ModelSkuPickerDialog so the
      // toast counts match expectations.
      if (!code) continue;
      for (const sku of d.skus) {
        // PR — Commander 2026-05-27: per-SKU supplier_sku auto-suffix.
        // composeSupplierSku("5539", sofaSku) → "5539-1A(LHF)" etc.
        // Previously wrote the literal model-level code into every binding,
        // producing 16 BOOQIT rows all reading "5539".
        const supplierSku = composeSupplierSku(code, sku);
        list.push({
          materialKind:   'mfg_product' as MaterialKind,
          materialCode:   sku.code,
          materialName:   sku.name ?? sku.code,
          supplierSku,
          unitPriceCenti: d.unitPriceCenti,
          currency:       'MYR' as Currency,
          leadTimeDays:   d.leadTimeDays,
          moq:            d.moq,
          isMainSupplier: d.isMainSupplier,
          notes:          d.description.trim() || undefined,
        });
      }
    }
    if (list.length === 0) {
      setError('Type at least one supplier code so we know which Model to map.');
      return;
    }
    batchMut.mutate({ supplierId, bindings: list }, {
      onSuccess: (res) => {
        if (res.skipped > 0) {
          // eslint-disable-next-line no-alert
          alert(
            `Inserted ${res.inserted} SKU mapping${res.inserted === 1 ? '' : 's'}; ` +
            `skipped ${res.skipped} already bound for this supplier.`,
          );
        }
        onSaved();
      },
      onError: (e) => setError(e instanceof Error ? e.message : String(e)),
    });
  };

  const supplierOptions = suppliersQ.data ?? [];
  const draftRows       = Object.values(drafts);
  const totalSkus       = draftRows.reduce(
    (sum, d) => sum + (d.supplierCode.trim() ? d.skus.length : 0), 0,
  );

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <form
        className={`${styles.modal} ${styles.modalCompact}`}
        onClick={(e) => e.stopPropagation()}
        onSubmit={(e) => { e.preventDefault(); submit(); }}
        style={{ maxHeight: '90vh', overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
            <h2 className={styles.modalTitle}>
              Assign {draftRows.length} Model{draftRows.length === 1 ? '' : 's'} to supplier
            </h2>
            <p className={styles.modalSub} style={{ margin: 0 }}>
              One supplier code + description per Model. Save fans the binding
              out across every active SKU under each Model.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              padding: 4,
              lineHeight: 0,
            }}
          >
            <X size={18} strokeWidth={1.75} />
          </button>
        </div>

        <label className={styles.compactField} style={{ maxWidth: 360 }}>
          <span>Supplier *</span>
          <select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            disabled={loading}
            required
          >
            <option value="">{loading ? 'Loading suppliers…' : '— Pick supplier —'}</option>
            {supplierOptions.map((s) => (
              <option key={s.id} value={s.id}>
                {s.code} · {s.name}
              </option>
            ))}
          </select>
        </label>

        <div style={{
          border: '1px solid var(--line)',
          borderRadius: 'var(--radius-md)',
          background: 'var(--c-paper)',
          overflow: 'hidden',
        }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'var(--font-sans)' }}>
            <thead>
              <tr style={{ background: 'var(--c-cream)', borderBottom: '1px solid var(--line)' }}>
                <th style={thStyle}>Model · #SKUs</th>
                <th style={thStyle}>Supplier Code</th>
                <th style={thStyle}>Description</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Unit Price (RM)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>Lead (d)</th>
                <th style={{ ...thStyle, textAlign: 'right' }}>MOQ</th>
                <th style={thStyle}>Main</th>
              </tr>
            </thead>
            <tbody>
              {draftRows.length === 0 && (
                <tr><td colSpan={7} style={{ ...tdStyle, color: 'var(--fg-muted)', textAlign: 'center' }}>
                  {loading ? 'Loading…' : 'No Models in the selection have any SKUs to map.'}
                </td></tr>
              )}
              {draftRows.map((d) => {
                const isOpen = expanded.has(d.modelId);
                return (
                  <Fragment key={d.modelId}>
                    <tr style={{ borderBottom: '1px solid var(--line)' }}>
                      <td style={tdStyle}>
                        <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>{d.modelCode}</div>
                        <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>{d.modelName}</div>
                        <button
                          type="button"
                          onClick={() => toggleExpanded(d.modelId)}
                          disabled={d.skus.length === 0}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            padding: 0,
                            marginTop: 2,
                            fontSize: 'var(--fs-12)',
                            cursor: d.skus.length === 0 ? 'default' : 'pointer',
                            color: isOpen ? 'var(--c-burnt)' : 'var(--fg-muted)',
                            textDecoration: 'underline',
                            textUnderlineOffset: 2,
                          }}
                          title={isOpen ? 'Hide SKU list' : 'Show SKU list'}
                        >
                          {isOpen ? '▾' : '▸'} {d.skus.length} SKU{d.skus.length === 1 ? '' : 's'} will be mapped
                        </button>
                      </td>
                      <td style={tdStyle}>
                        <input
                          value={d.supplierCode}
                          onChange={(e) => setDraft(d.modelId, { supplierCode: e.target.value })}
                          placeholder="Their code for the whole Model"
                          style={inputStyle}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          value={d.description}
                          onChange={(e) => setDraft(d.modelId, { description: e.target.value })}
                          placeholder='e.g. "Foam B grade, 6-week lead"'
                          style={{ ...inputStyle, minWidth: 180 }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <input
                          type="number"
                          step="0.01"
                          value={(d.unitPriceCenti / 100).toFixed(2)}
                          onChange={(e) => setDraft(d.modelId, {
                            unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0,
                          })}
                          style={{ ...inputStyle, width: 100, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <input
                          type="number"
                          value={d.leadTimeDays}
                          onChange={(e) => setDraft(d.modelId, { leadTimeDays: Number(e.target.value) || 0 })}
                          style={{ ...inputStyle, width: 60, textAlign: 'right' }}
                        />
                      </td>
                      <td style={{ ...tdStyle, textAlign: 'right' }}>
                        <input
                          type="number"
                          value={d.moq}
                          onChange={(e) => setDraft(d.modelId, { moq: Number(e.target.value) || 0 })}
                          style={{ ...inputStyle, width: 60, textAlign: 'right' }}
                        />
                      </td>
                      <td style={tdStyle}>
                        <input
                          type="checkbox"
                          checked={d.isMainSupplier}
                          onChange={(e) => setDraft(d.modelId, { isMainSupplier: e.target.checked })}
                        />
                      </td>
                    </tr>
                    {isOpen && d.skus.length > 0 && (
                      <tr style={{ background: 'var(--c-cream)' }}>
                        <td colSpan={7} style={{
                          padding: 'var(--space-2) var(--space-3)',
                          borderBottom: '1px solid var(--line)',
                          borderTop: '1px dashed var(--line)',
                        }}>
                          {/* PR — Commander 2026-05-27: preview shows COMPUTED
                              supplier_sku next to each our-SKU so commander sees
                              "BOOQIT-1A(LHF) → 5539-1A(LHF)" before Save. */}
                          <SkuPreviewStrip
                            toMap={d.skus.map((s) => s.code)}
                            alreadyBound={[]}
                            previewMap={
                              d.supplierCode.trim()
                                ? Object.fromEntries(
                                    d.skus.map((s) => [s.code, composeSupplierSku(d.supplierCode, s)]),
                                  )
                                : undefined
                            }
                          />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>

        {error && (
          <div className={styles.errorBanner}>{error}</div>
        )}

        <footer className={styles.modalFooter} style={{ justifyContent: 'space-between' }}>
          <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>
            {totalSkus > 0
              ? `Will POST ${totalSkus} binding${totalSkus === 1 ? '' : 's'} (server skips ones already bound).`
              : 'Type a supplier code on at least one Model to enable Save.'}
          </span>
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="md" type="button" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="md"
              type="submit"
              disabled={batchMut.isPending || totalSkus === 0 || !supplierId}
            >
              {batchMut.isPending ? 'Saving…' : `Save ${totalSkus} binding${totalSkus === 1 ? '' : 's'}`}
            </Button>
          </span>
        </footer>
      </form>
    </div>
  );
}

const thStyle: React.CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-12)',
  fontWeight: 600,
  textAlign: 'left',
  padding: '8px 12px',
  color: 'var(--fg-muted)',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
};
const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 'var(--fs-13)',
  verticalAlign: 'top',
};
const inputStyle: React.CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-13)',
  background: 'var(--c-cream)',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 8px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};
