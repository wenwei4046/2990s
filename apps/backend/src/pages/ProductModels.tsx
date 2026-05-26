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

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Layers, Search, Plus, Trash2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useProductModels, useCreateProductModel, useGenerateModelSkus, useDeleteProductModel,
  type ProductModelRow,
} from '../lib/product-models-queries';
import { useMaintenanceConfig, type MfgCategory } from '../lib/mfg-products-queries';
import { resolveSizeInfo } from '../lib/size-info';
import styles from './ProductModels.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

const CATEGORIES: MfgCategory[] = ['SOFA', 'BEDFRAME', 'MATTRESS', 'ACCESSORY', 'SERVICE'];

export const ProductModels = () => {
  const [filter, setFilter] = useState<MfgCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  // PR #106 — Commander 2026-05-26: showed Modular list with rows he didn't
  // recognize ("这些都没在我的 SKU 里面啊"). Multi-select + bulk delete so he
  // can sweep orphan Models (test entries, migration-0062 backfill leftovers)
  // without clicking into each one.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting]       = useState(false);
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
            <Button
              variant="primary"
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
                // PR #110 — Commander 2026-05-26: PR #108's whole-row click
                // was triggering accidental jumps when commander scrolled
                // past or hovered near a row. Reverted to "code chip is
                // the only click target". Row stays non-interactive; the
                // chip is a Link (gets proper cursor + middle-click /
                // cmd-click open in new tab).
                <tr key={m.id}>
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
                    <Link to={`/product-models/${m.id}`} className={styles.codeChipLink}>
                      <code className={styles.codeChip}>{m.model_code}</code>
                    </Link>
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
