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
import type { MfgCategory } from '../lib/mfg-products-queries';
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

function NewModelDialog({ onClose }: { onClose: () => void }) {
  const [branding, setBranding] = useState('');
  const [modelCode, setModelCode] = useState('');
  const [name, setName] = useState('');
  const [category, setCategory] = useState<MfgCategory>('SOFA');
  const [description, setDescription] = useState('');
  const createMut = useCreateProductModel();

  // Branding is required for the 3 product categories that auto-generate SKU
  // names from "{branding} {category} ({size})". Accessory/Service skip the
  // brand because they don't use the generator.
  const needsBranding = category === 'SOFA' || category === 'BEDFRAME' || category === 'MATTRESS';

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!modelCode.trim() || !name.trim()) return;
    if (needsBranding && !branding.trim()) return;
    createMut.mutate(
      {
        branding: branding.trim() || null,
        modelCode: modelCode.trim(),
        name: name.trim(),
        category,
        description: description.trim() || null,
      },
      { onSuccess: () => onClose() },
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

        {needsBranding && (
          <label className={styles.field}>
            <span className="t-eyebrow">Branding *</span>
            <input
              type="text"
              value={branding}
              onChange={(e) => setBranding(e.target.value)}
              placeholder={
                category === 'SOFA' ? 'e.g. HOUZS / 2990S'
                : category === 'BEDFRAME' ? 'e.g. HILTON / FENRIR / CODY'
                : 'e.g. SEALY / KING KOIL'
              }
              required={needsBranding}
              autoFocus
            />
          </label>
        )}

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

        <label className={styles.field}>
          <span className="t-eyebrow">Description (optional)</span>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </label>

        <TemplatePreview
          category={category}
          branding={branding}
          modelCode={modelCode}
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
  category, branding, modelCode,
}: { category: MfgCategory; branding: string; modelCode: string }) {
  const br = branding.trim() || '{branding}';
  const mc = modelCode.trim() || '{code}';
  let codeFmt = '', nameFmt = '', exampleCode = '', exampleName = '';

  if (category === 'SOFA') {
    codeFmt = '{model_code}-{compartment}';
    nameFmt = '{branding} SOFA {compartment}';
    exampleCode = `${mc}-1A(LHF)`;
    exampleName = `${br} SOFA 1A(LHF)`;
  } else if (category === 'BEDFRAME') {
    codeFmt = '{model_code}-({size})';
    nameFmt = '{branding} BEDFRAME ({size_label})';
    exampleCode = `${mc}-(K)`;
    exampleName = `${br} BEDFRAME (6FT)`;
  } else if (category === 'MATTRESS') {
    codeFmt = '{model_code}-({size})';
    nameFmt = '{branding} ({size_label})';
    exampleCode = `${mc}-(K)`;
    exampleName = `${br} (6FT)`;
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
