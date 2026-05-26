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

import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { Layers, Search, Plus } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useProductModels, useCreateProductModel, useGenerateModelSkus,
  type ProductModelRow,
} from '../lib/product-models-queries';
import { useMaintenanceConfig, type MfgCategory } from '../lib/mfg-products-queries';
import { SIZE_INFO } from '../lib/size-info';
import styles from './ProductModels.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

const CATEGORIES: MfgCategory[] = ['SOFA', 'BEDFRAME', 'MATTRESS', 'ACCESSORY', 'SERVICE'];

export const ProductModels = () => {
  const [filter, setFilter] = useState<MfgCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);

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

      {/* Grouped tables */}
      {Array.from(grouped.entries()).map(([cat, rows]) => (
        <section key={cat} className={styles.section}>
          <h2 className={styles.sectionTitle}>
            {cat} <span className={styles.sectionCount}>· {rows.length}</span>
          </h2>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Active</th>
                <th style={{ textAlign: 'right' }}>Description</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link to={`/product-models/${m.id}`} className={styles.codeLink}>
                      <code>{m.model_code}</code>
                    </Link>
                  </td>
                  <td>
                    <Link to={`/product-models/${m.id}`} className={styles.nameLink}>
                      {m.name}
                    </Link>
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
      ))}

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

  const sizesPool = (category === 'MATTRESS'
    ? maintenance.data?.data?.mattressSizes
    : maintenance.data?.data?.bedframeSizes) ?? [];
  const compsPool = maintenance.data?.data?.sofaCompartments ?? [];

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <form
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        onSubmit={submit}
        style={{ maxWidth: 760, maxHeight: '90vh', overflowY: 'auto' }}
      >
        <h2 className={styles.modalTitle}>New Models (bulk)</h2>
        <p className={styles.modalSub}>
          Add one row per Model. Pick the sizes / compartments once below — they
          apply to every row. Submit creates all Models and auto-generates the
          SKU variants in one shot.
        </p>

        <label className={styles.field}>
          <span className="t-eyebrow">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as MfgCategory)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

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

        <div style={{ display: 'flex', justifyContent: 'flex-start', marginTop: -4 }}>
          <Button variant="ghost" size="sm" type="button" onClick={addRow}>
            <Plus {...ICON} />
            <span>Add another Model</span>
          </Button>
        </div>

        {/* Shared sizes / compartments — applied to every row in the batch. */}
        {(category === 'MATTRESS' || category === 'BEDFRAME') && (
          <InlineAllowedOptions
            label={`Sizes (apply to all ${rows.length} row${rows.length === 1 ? '' : 's'})`}
            hint="Tick the sizes every Model in this batch is sold in · pool from Maintenance"
            options={sizesPool}
            picked={pickedSizes}
            onToggle={(v) => setPickedSizes((prev) => {
              const n = new Set(prev);
              if (n.has(v)) n.delete(v); else n.add(v);
              return n;
            })}
            formatChip={(code) => {
              const info = SIZE_INFO[code];
              return info ? `${code} · ${info.label}` : code;
            }}
          />
        )}
        {category === 'SOFA' && (
          <InlineAllowedOptions
            label={`Compartments (apply to all ${rows.length} row${rows.length === 1 ? '' : 's'})`}
            hint="Tick the compartments every Sofa in this batch offers · pool from Maintenance"
            options={compsPool}
            picked={pickedComps}
            onToggle={(v) => setPickedComps((prev) => {
              const n = new Set(prev);
              if (n.has(v)) n.delete(v); else n.add(v);
              return n;
            })}
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
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        marginTop: 'var(--space-3)',
        background: 'var(--c-paper)',
        position: 'relative',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <span className="t-eyebrow" style={{ color: 'var(--c-orange)' }}>Model {index + 1}</span>
        {canRemove && (
          <button
            type="button"
            onClick={onRemove}
            title="Remove this row"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--fg-muted)',
              cursor: 'pointer',
              fontSize: 'var(--fs-14)',
              padding: '2px 6px',
            }}
          >
            ✕
          </button>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: category === 'MATTRESS' ? '1fr 2fr 2fr 1fr' : '1fr 2fr 2fr', gap: 8, marginBottom: 8 }}>
        <label className={styles.field} style={{ margin: 0 }}>
          <span className="t-eyebrow">Branding</span>
          <input type="text" value={row.branding} onChange={(e) => onChange({ branding: e.target.value })}
            placeholder={category === 'MATTRESS' ? '2990S' : ''} />
        </label>
        <label className={styles.field} style={{ margin: 0 }}>
          <span className="t-eyebrow">Model code *</span>
          <input type="text" value={row.modelCode} onChange={(e) => onChange({ modelCode: e.target.value })}
            placeholder={
              category === 'SOFA'     ? '5530' :
              category === 'BEDFRAME' ? '1003' :
              '2990-NF AKKA-FIRM MATT'
            }
            required />
        </label>
        <label className={styles.field} style={{ margin: 0 }}>
          <span className="t-eyebrow">Name *</span>
          <input type="text" value={row.name} onChange={(e) => onChange({ name: e.target.value })}
            placeholder={
              category === 'SOFA'     ? 'SOFA 5530' :
              category === 'BEDFRAME' ? 'HILTON BEDFRAME' :
              '2990 AKKA-FIRM MATTRESS'
            }
            required />
        </label>
        {category === 'MATTRESS' && (
          <label className={styles.field} style={{ margin: 0 }}>
            <span className="t-eyebrow">Thickness (cm) *</span>
            <input type="number" inputMode="numeric" min={1} step={1}
              value={row.thicknessCm} onChange={(e) => onChange({ thicknessCm: e.target.value })}
              placeholder="31" required />
          </label>
        )}
      </div>

      <label className={styles.field} style={{ margin: 0 }}>
        <span className="t-eyebrow">Description (optional)</span>
        <input type="text" value={row.description} onChange={(e) => onChange({ description: e.target.value })} />
      </label>
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
   navigating to the Model detail page after create. Empty selection is
   valid — same convention as detail-page Allowed Options (allowed_options
   key just doesn't get set, falls back to global Maintenance pool). */
function InlineAllowedOptions({
  label, hint, options, picked, onToggle, formatChip,
}: {
  label:       string;
  hint:        string;
  options:     string[];
  picked:      Set<string>;
  onToggle:    (value: string) => void;
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
  return (
    <div className={styles.field}>
      <span className="t-eyebrow">{label}</span>
      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 6, display: 'block' }}>
        {hint}
      </span>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        {options.map((opt) => {
          const isOn = picked.has(opt);
          return (
            <button
              key={opt}
              type="button"
              onClick={() => onToggle(opt)}
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-13)',
                fontWeight: 600,
                padding: '6px 12px',
                borderRadius: 'var(--radius-pill)',
                border: isOn ? '1px solid var(--c-orange)' : '1px solid var(--line)',
                background: isOn ? 'var(--c-orange)' : 'var(--c-paper)',
                color: isOn ? 'var(--c-cream)' : 'var(--c-ink)',
                cursor: 'pointer',
                transition: 'all 150ms ease',
              }}
            >
              {formatChip ? formatChip(opt) : opt}
            </button>
          );
        })}
      </div>
    </div>
  );
}
