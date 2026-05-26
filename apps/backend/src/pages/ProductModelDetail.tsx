// ----------------------------------------------------------------------------
// ProductModelDetail — full-page route at /product-models/:id (PR #49).
//
// Second-layer template entity. Each Model groups many SKU rows on
// mfg_products (folded under base_model + the new model_id FK). Stock,
// cost, pricing all stay per-SKU — Model only owns the allowed-options
// pool + photo + name template.
//
// Sections:
//   1. Header — back link, Layers icon, model code · name · category pill ·
//      active toggle, action buttons (Save / Deactivate / Delete)
//   2. Model info card — editable name + description (model_code + category
//      read-only after creation)
//   3. Allowed options panel — per-category chip toggles persisted as JSONB
//   4. SKU variants list — read-only, links to per-SKU page for pricing edits
//
// PR #50 will add the "Generate SKU variants" button that uses
// allowed_options to bulk-INSERT mfg_products rows.
// ----------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Layers, Save, Trash2, Wand2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useProductModel, useUpdateProductModel, useDeleteProductModel, useGenerateModelSkus,
  type AllowedOptions,
} from '../lib/product-models-queries';
import { useMaintenanceConfig } from '../lib/mfg-products-queries';
import styles from './ProductModelDetail.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

// Hard-coded sofa compartments mirror the SKU Master Compartments modal
// (image 2 in the commander's brief). Promote to a /compartments lookup
// API later if commander wants to add new shapes.
const SOFA_COMPARTMENTS = [
  '1A-LHF', '1A-RHF', '1B-LHF', '1B-RHF', '1NA',
  '2A-LHF', '2A-RHF', '2B-LHF', '2B-RHF', '2NA', '2S',
  '3S', 'CNR', 'L-LHF', 'L-RHF',
] as const;

const BEDFRAME_SIZES = ['K', 'Q', 'S', 'SS', 'SK', 'SP'] as const;
const MATTRESS_SIZES = ['K', 'Q', 'S', 'SS'] as const;

export const ProductModelDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useProductModel(id);
  const updateMut = useUpdateProductModel();
  const deleteMut = useDeleteProductModel();
  const generateMut = useGenerateModelSkus();
  const maintenance = useMaintenanceConfig('master');

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [allowed, setAllowed] = useState<AllowedOptions>({});

  // Sync local form when server row arrives or refetches.
  useEffect(() => {
    if (!data?.model) return;
    setName(data.model.name);
    setDescription(data.model.description ?? '');
    setAllowed(data.model.allowed_options ?? {});
  }, [data?.model?.id, data?.model?.updated_at]);

  if (isLoading) return <div className={styles.loading}>Loading model…</div>;
  if (error) {
    return (
      <div className={styles.errorBanner}>
        Failed to load model. {error instanceof Error ? error.message : String(error)}
      </div>
    );
  }
  if (!data?.model) return <div className={styles.loading}>Model not found.</div>;

  const model = data.model;

  const onSave = () => {
    if (!id) return;
    updateMut.mutate({
      id,
      name,
      description: description.trim() || null,
      allowedOptions: allowed,
    });
  };

  const onToggleActive = () => {
    if (!id) return;
    updateMut.mutate({ id, active: !model.active });
  };

  const onDelete = () => {
    if (!id) return;
    const skuCount = data.skus.length;
    if (!window.confirm(
      `Delete Model "${model.model_code} · ${model.name}"? ${skuCount} SKU(s) will keep their rows but lose the Model link.`,
    )) return;
    deleteMut.mutate(id, { onSuccess: () => navigate('/product-models') });
  };

  return (
    <div className={styles.page}>
      {/* Header --------------------------------------------------------- */}
      <header className={styles.header}>
        <Link to="/product-models" className={styles.back}>
          <ArrowLeft {...ICON} /> Models
        </Link>
        <div className={styles.titleRow}>
          <Layers size={20} strokeWidth={1.75} />
          <h1 className="t-h2">{model.model_code}</h1>
          <span className={styles.titleName}>· {model.name}</span>
          <span className={styles.catPill}>{model.category}</span>
          <span className={`${styles.statusPill} ${model.active ? styles.active : styles.inactive}`}>
            {model.active ? 'ACTIVE' : 'INACTIVE'}
          </span>
        </div>
        <div className={styles.headerActions}>
          <Button variant="ghost" size="sm" onClick={onToggleActive}>
            {model.active ? 'Deactivate' : 'Activate'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete}>
            <Trash2 {...ICON} /> Delete
          </Button>
          <Button variant="primary" size="sm" onClick={onSave} disabled={updateMut.isPending}>
            <Save {...ICON} /> {updateMut.isPending ? 'Saving…' : 'Save changes'}
          </Button>
        </div>
      </header>

      {updateMut.isError && (
        <div className={styles.errorBanner}>
          Save failed: {updateMut.error instanceof Error ? updateMut.error.message : 'unknown'}
        </div>
      )}

      {/* Info card ------------------------------------------------------ */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Model info</h2>
        <div className={styles.fieldGrid}>
          <label className={styles.field}>
            <span className="t-eyebrow">Model code</span>
            <input type="text" value={model.model_code} readOnly className={styles.readonly} />
          </label>
          <label className={styles.field}>
            <span className="t-eyebrow">Category</span>
            <input type="text" value={model.category} readOnly className={styles.readonly} />
          </label>
          <label className={`${styles.field} ${styles.fieldSpan2}`}>
            <span className="t-eyebrow">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. HILTON BEDFRAME"
            />
          </label>
          <label className={`${styles.field} ${styles.fieldSpan2}`}>
            <span className="t-eyebrow">Description</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Optional notes shown on quotations / catalogue printouts"
            />
          </label>
        </div>
      </section>

      {/* Allowed options ------------------------------------------------ */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Allowed options</h2>
        <p className={styles.cardSub}>
          Toggle on only the variants this Model actually offers. SO/PO line
          picker (and PR #50's auto-SKU-generator) reads from these. Empty =
          no restriction (falls back to global Maintenance pool).
        </p>

        {model.category === 'SOFA' && (
          <SofaAllowedOptions
            allowed={allowed}
            onChange={setAllowed}
            sofaSizes={maintenance.data?.data?.sofaSizes ?? ['24', '26', '28', '30', '32', '35']}
            sofaLegHeights={(maintenance.data?.data?.sofaLegHeights ?? []).map((o) => o.value)}
            sofaSpecials={(maintenance.data?.data?.sofaSpecials ?? []).map((o) => o.value)}
          />
        )}

        {model.category === 'BEDFRAME' && (
          <BedframeAllowedOptions
            allowed={allowed}
            onChange={setAllowed}
            divanHeights={(maintenance.data?.data?.divanHeights ?? []).map((o) => o.value)}
            totalHeights={(maintenance.data?.data?.totalHeights ?? []).map((o) => o.value)}
            gaps={maintenance.data?.data?.gaps ?? []}
            legHeights={(maintenance.data?.data?.legHeights ?? []).map((o) => o.value)}
            specials={(maintenance.data?.data?.specials ?? []).map((o) => o.value)}
          />
        )}

        {model.category === 'MATTRESS' && (
          <MattressAllowedOptions allowed={allowed} onChange={setAllowed} />
        )}

        {(model.category === 'ACCESSORY' || model.category === 'SERVICE') && (
          <p className={styles.cardSub}>
            No configurable options for {model.category.toLowerCase()} models —
            SKU rows track everything directly.
          </p>
        )}
      </section>

      {/* SKU variants list --------------------------------------------- */}
      <section className={styles.card}>
        <div className={styles.cardHeadRow}>
          <h2 className={styles.cardTitle}>SKU variants ({data.skus.length})</h2>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              if (!id) return;
              if (!window.confirm(
                'Bulk-generate SKU variants from the allowed options above? '
                + 'Existing codes are skipped — no duplicates created.',
              )) return;
              generateMut.mutate(id, {
                onSuccess: (res) => {
                  window.alert(
                    `Generated ${res.generated} new variant${res.generated === 1 ? '' : 's'}. `
                    + `Skipped ${res.skipped} (already existed).`,
                  );
                },
                onError: (err) => {
                  window.alert(`Generate failed: ${err instanceof Error ? err.message : err}`);
                },
              });
            }}
            disabled={generateMut.isPending}
          >
            <Wand2 {...ICON} /> {generateMut.isPending ? 'Generating…' : 'Generate variants'}
          </Button>
        </div>
        <p className={styles.cardSub}>
          Each row is a separate SKU with its own code, stock, cost, and pricing.
          Open code once at the Model layer; "Generate variants" stamps out one
          SKU row per allowed-option combination so you don't open codes 20 times.
        </p>
        {data.skus.length === 0 ? (
          <p className={styles.cardSub}>
            No SKUs under this Model yet. Toggle some allowed options above, save,
            then click "Generate variants".
          </p>
        ) : (
          <table className={styles.skuTable}>
            <thead>
              <tr>
                <th>Code</th>
                <th>Name</th>
                <th>Size</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Cost</th>
                <th style={{ textAlign: 'right' }}>Price 2</th>
              </tr>
            </thead>
            <tbody>
              {data.skus.map((sku) => (
                <tr key={sku.id}>
                  <td><code>{sku.code}</code></td>
                  <td>{sku.name}</td>
                  <td>{sku.size_label ?? sku.size_code ?? '—'}</td>
                  <td>
                    <span className={`${styles.statusPill} ${sku.status === 'ACTIVE' ? styles.active : styles.inactive}`}>
                      {sku.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>{formatRM(sku.cost_price_sen)}</td>
                  <td style={{ textAlign: 'right' }}>{formatRM(sku.base_price_sen ?? 0)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};

/* ────────────────────────── Per-category allowed-option panels ────── */

function ChipToggle({
  options, selected, onChange,
}: { options: string[]; selected: string[]; onChange: (next: string[]) => void }) {
  const has = (v: string) => selected.includes(v);
  const toggle = (v: string) => {
    onChange(has(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  };
  return (
    <div className={styles.chipRow}>
      {options.map((opt) => (
        <button
          key={opt}
          type="button"
          className={`${styles.chip} ${has(opt) ? styles.chipOn : ''}`}
          onClick={() => toggle(opt)}
        >
          {opt}
        </button>
      ))}
    </div>
  );
}

function SofaAllowedOptions({
  allowed, onChange, sofaSizes, sofaLegHeights, sofaSpecials,
}: {
  allowed: AllowedOptions; onChange: (next: AllowedOptions) => void;
  sofaSizes: string[]; sofaLegHeights: string[]; sofaSpecials: string[];
}) {
  return (
    <>
      <OptionGroup label="Compartments" hint="Which seat/corner shapes this Model offers">
        <ChipToggle
          options={[...SOFA_COMPARTMENTS]}
          selected={allowed.compartments ?? []}
          onChange={(next) => onChange({ ...allowed, compartments: next })}
        />
      </OptionGroup>
      <OptionGroup label="Seat sizes (inches)" hint="Depth-of-seat variants this Model is built in">
        <ChipToggle
          options={sofaSizes}
          selected={allowed.sizes ?? []}
          onChange={(next) => onChange({ ...allowed, sizes: next })}
        />
      </OptionGroup>
      {sofaLegHeights.length > 0 && (
        <OptionGroup label="Leg heights" hint="Subset of the global sofa leg pool">
          <ChipToggle
            options={sofaLegHeights}
            selected={allowed.leg_heights ?? []}
            onChange={(next) => onChange({ ...allowed, leg_heights: next })}
          />
        </OptionGroup>
      )}
      {sofaSpecials.length > 0 && (
        <OptionGroup label="Specials" hint="Recliner / storage upgrades this Model supports">
          <ChipToggle
            options={sofaSpecials}
            selected={allowed.specials ?? []}
            onChange={(next) => onChange({ ...allowed, specials: next })}
          />
        </OptionGroup>
      )}
    </>
  );
}

function BedframeAllowedOptions({
  allowed, onChange, divanHeights, totalHeights, gaps, legHeights, specials,
}: {
  allowed: AllowedOptions; onChange: (next: AllowedOptions) => void;
  divanHeights: string[]; totalHeights: string[]; gaps: string[];
  legHeights: string[]; specials: string[];
}) {
  return (
    <>
      <OptionGroup label="Sizes" hint="Bed sizes this Model is offered in">
        <ChipToggle
          options={[...BEDFRAME_SIZES]}
          selected={allowed.sizes ?? []}
          onChange={(next) => onChange({ ...allowed, sizes: next })}
        />
      </OptionGroup>
      {divanHeights.length > 0 && (
        <OptionGroup label="Divan heights">
          <ChipToggle
            options={divanHeights}
            selected={allowed.divan_heights ?? []}
            onChange={(next) => onChange({ ...allowed, divan_heights: next })}
          />
        </OptionGroup>
      )}
      {totalHeights.length > 0 && (
        <OptionGroup label="Total heights">
          <ChipToggle
            options={totalHeights}
            selected={allowed.total_heights ?? []}
            onChange={(next) => onChange({ ...allowed, total_heights: next })}
          />
        </OptionGroup>
      )}
      {gaps.length > 0 && (
        <OptionGroup label="Gaps">
          <ChipToggle
            options={gaps}
            selected={allowed.gaps ?? []}
            onChange={(next) => onChange({ ...allowed, gaps: next })}
          />
        </OptionGroup>
      )}
      {legHeights.length > 0 && (
        <OptionGroup label="Leg heights">
          <ChipToggle
            options={legHeights}
            selected={allowed.leg_heights ?? []}
            onChange={(next) => onChange({ ...allowed, leg_heights: next })}
          />
        </OptionGroup>
      )}
      {specials.length > 0 && (
        <OptionGroup label="Specials">
          <ChipToggle
            options={specials}
            selected={allowed.specials ?? []}
            onChange={(next) => onChange({ ...allowed, specials: next })}
          />
        </OptionGroup>
      )}
    </>
  );
}

function MattressAllowedOptions({
  allowed, onChange,
}: { allowed: AllowedOptions; onChange: (next: AllowedOptions) => void }) {
  return (
    <OptionGroup label="Sizes" hint="Mattress sizes this Model is sold in">
      <ChipToggle
        options={[...MATTRESS_SIZES]}
        selected={allowed.sizes ?? []}
        onChange={(next) => onChange({ ...allowed, sizes: next })}
      />
    </OptionGroup>
  );
}

function OptionGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={styles.optGroup}>
      <div className={styles.optHead}>
        <span className="t-eyebrow">{label}</span>
        {hint && <span className={styles.optHint}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

function formatRM(sen: number | null | undefined): string {
  if (sen == null) return '—';
  const ringgit = sen / 100;
  return `RM ${ringgit.toFixed(2)}`;
}
