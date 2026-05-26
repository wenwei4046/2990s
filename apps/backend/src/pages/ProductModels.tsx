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
  useProductModels, useCreateProductModel,
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
export function NewModelDialog({
  onClose, initialCategory, onCreated,
}: {
  onClose: () => void;
  initialCategory?: MfgCategory;
  onCreated?: (modelId: string, category: MfgCategory) => void;
}) {
  const [branding, setBranding] = useState('');
  const [modelCode, setModelCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<MfgCategory>(initialCategory ?? 'SOFA');
  const [description, setDescription] = useState('');
  // PR #77 — Mattress-only thickness collected at New Model time so the
  // (WxLx{thickness}CM) substitution works on first "+ Add Codes" without
  // a detour to the Model detail page. Stored as allowed_options.
  // mattress_thickness_cm; later edits still happen on the detail page.
  const [mattressThicknessCm, setMattressThicknessCm] = useState('');
  // PR #77b — Inline allowed-options picker. Sizes for MATTRESS/BEDFRAME,
  // compartments for SOFA. Pre-empts the trip to the Model detail page —
  // commander can create + immediately "+ Add Codes" without re-opening
  // anything. Stored as Set<string> for cheap toggle, serialised to array
  // on submit. Detail-page Allowed Options keeps working for later edits.
  const [pickedSizes, setPickedSizes] = useState<Set<string>>(new Set());
  const [pickedComps, setPickedComps] = useState<Set<string>>(new Set());
  const maintenance = useMaintenanceConfig('master');
  const createMut = useCreateProductModel();

  // PR #69 — Branding is OPTIONAL across all categories. BEDFRAME / SOFA
  // typically encode the brand inside the Model name (HILTON BEDFRAME,
  // SOFA 5530). MATTRESS commander still uses it as separate metadata.
  // We show the field but never block submit on it.
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelCode.trim() || !name.trim()) return;
    // Build allowedOptions only for fields the user explicitly set. Empty
    // {} = no restriction yet (matches existing convention).
    const allowedOptions: Record<string, unknown> = {};
    if (category === 'MATTRESS') {
      const t = parseInt(mattressThicknessCm.trim(), 10);
      if (Number.isFinite(t) && t > 0) allowedOptions.mattress_thickness_cm = t;
    }
    if (category === 'MATTRESS' || category === 'BEDFRAME') {
      if (pickedSizes.size > 0) allowedOptions.sizes = Array.from(pickedSizes);
    } else if (category === 'SOFA') {
      if (pickedComps.size > 0) allowedOptions.compartments = Array.from(pickedComps);
    }
    createMut.mutate(
      {
        branding: branding.trim() || null,
        modelCode: modelCode.trim(),
        name: name.trim(),
        category,
        description: description.trim() || null,
        ...(Object.keys(allowedOptions).length > 0 ? { allowedOptions } : {}),
      },
      {
        onSuccess: (res) => {
          if (onCreated && res.model?.id) onCreated(res.model.id, category);
          else onClose();
        },
      },
    );
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <form className={styles.modal} onClick={(e) => e.stopPropagation()} onSubmit={submit}>
        <h2 className={styles.modalTitle}>New Model</h2>
        <p className={styles.modalSub}>
          Models are templates. SKU codes are auto-generated from the template
          below — open a Model once, tick the options it offers, then add codes
          in one click.
        </p>

        <label className={styles.field}>
          <span className="t-eyebrow">Branding (optional)</span>
          <input
            type="text"
            value={branding}
            onChange={(e) => setBranding(e.target.value)}
            placeholder={
              category === 'SOFA' ? 'e.g. HOUZS / 2990S'
              : category === 'BEDFRAME' ? 'usually encoded in Name (HILTON BEDFRAME) — leave blank'
              : category === 'MATTRESS' ? 'e.g. 2990S / SEALY'
              : ''
            }
          />
        </label>

        <label className={styles.field}>
          <span className="t-eyebrow">Model code *</span>
          <input
            type="text"
            value={modelCode}
            onChange={(e) => setModelCode(e.target.value)}
            placeholder={
              category === 'SOFA' ? 'e.g. 5530 / 5530B'
              : category === 'BEDFRAME' ? 'e.g. 1003 / 1003A'
              : 'e.g. PURE / FIRMNESS'
            }
            required
          />
        </label>

        <label className={styles.field}>
          <span className="t-eyebrow">Name *</span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={
              category === 'SOFA' ? 'e.g. SOFA 5530'
              : category === 'BEDFRAME' ? 'e.g. HILTON BEDFRAME'
              : 'e.g. SEALY MATTRESS'
            }
            required
          />
        </label>

        <label className={styles.field}>
          <span className="t-eyebrow">Category</span>
          <select value={category} onChange={(e) => setCategory(e.target.value as MfgCategory)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>

        {/* PR #77 — Mattress-only thickness input. Drives the
            (WxLx{thickness}CM) substitution in the auto-generated SKU name
            on first "+ Add Codes". Stored as allowed_options.
            mattress_thickness_cm — same field the detail-page input writes,
            so future edits still work there. */}
        {category === 'MATTRESS' && (
          <label className={styles.field}>
            <span className="t-eyebrow">Mattress thickness (cm) *</span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              step={1}
              value={mattressThicknessCm}
              onChange={(e) => setMattressThicknessCm(e.target.value)}
              placeholder="e.g. 31 / 30 / 20"
            />
          </label>
        )}

        <label className={styles.field}>
          <span className="t-eyebrow">Description (optional)</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        {/* PR #77b — Inline allowed-options picker. MATTRESS/BEDFRAME →
            sizes chips (from maintenance.{mattress,bedframe}Sizes pool).
            SOFA → compartments chips (from maintenance.sofaCompartments).
            Empty selection = "no restriction yet", matches detail-page
            convention (commander can tick more on detail page later). */}
        {(category === 'MATTRESS' || category === 'BEDFRAME') && (
          <InlineAllowedOptions
            label="Sizes"
            hint="Tick the sizes this Model is sold in · pool from Maintenance"
            options={(category === 'MATTRESS'
              ? maintenance.data?.data?.mattressSizes
              : maintenance.data?.data?.bedframeSizes) ?? []}
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
            label="Compartments"
            hint="Tick the compartments this Sofa offers · pool from Maintenance"
            options={maintenance.data?.data?.sofaCompartments ?? []}
            picked={pickedComps}
            onToggle={(v) => setPickedComps((prev) => {
              const n = new Set(prev);
              if (n.has(v)) n.delete(v); else n.add(v);
              return n;
            })}
          />
        )}

        <TemplatePreview
          category={category}
          modelCode={modelCode}
          modelName={name}
          mattressThicknessCm={mattressThicknessCm}
        />

        {createMut.isError && (
          <div className={styles.errorBanner}>
            {createMut.error instanceof Error ? createMut.error.message : 'Create failed'}
          </div>
        )}

        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" type="button" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? 'Creating…' : 'Create Model'}
          </Button>
        </footer>
      </form>
    </div>
  );
}

/* ─────────── Code-generation template preview ────────────────────────────
   Shows commander a worked example of how SKU codes + names get built from
   his current inputs. Updates live as he types. */
function TemplatePreview({
  category, modelCode, modelName, mattressThicknessCm,
}: {
  category: MfgCategory;
  modelCode: string;
  modelName: string;
  /** PR #77 — Mattress only; live preview uses the typed value so commander
      sees the real (183x190x{thickness}CM) before clicking Create. */
  mattressThicknessCm?: string;
}) {
  const mc = modelCode.trim() || '{model_code}';
  const mn = modelName.trim() || '{model_name}';
  let codeFmt = '', nameFmt = '', exampleCode = '', exampleName = '';

  if (category === 'SOFA') {
    codeFmt = '{model_code}-{compartment}';
    nameFmt = '{model_name} {compartment}';
    exampleCode = `${mc}-1A(LHF)`;
    exampleName = `${mn} 1A(LHF)`;
  } else if (category === 'BEDFRAME') {
    codeFmt = '{model_code}-({size})';
    nameFmt = '{model_name} ({size_label}) ({dimensions})';
    exampleCode = `${mc}-(K)`;
    exampleName = `${mn} (6FT) (183X190CM)`;
  } else if (category === 'MATTRESS') {
    codeFmt = '{model_code} MATT ({size})';
    nameFmt = '{model_name} (WxLxTCM)';
    exampleCode = `${mc} MATT (K)`;
    const tn = mattressThicknessCm ? parseInt(mattressThicknessCm.trim(), 10) : NaN;
    const tDisplay = Number.isFinite(tn) && tn > 0 ? String(tn) : '{thickness}';
    exampleName = `${mn} (183x190x${tDisplay}CM)`;
  } else {
    return null;
  }

  return (
    <div className={styles.tplBox}>
      <div className={styles.tplHead}>SKU template — preview</div>
      <div className={styles.tplRow}>
        <span className={styles.tplLabel}>code</span>
        <code className={styles.tplFmt}>{codeFmt}</code>
        <span className={styles.tplArrow}>→</span>
        <code className={styles.tplExample}>{exampleCode}</code>
      </div>
      <div className={styles.tplRow}>
        <span className={styles.tplLabel}>name</span>
        <code className={styles.tplFmt}>{nameFmt}</code>
        <span className={styles.tplArrow}>→</span>
        <code className={styles.tplExample}>{exampleName}</code>
      </div>
    </div>
  );
}

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
