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

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { ArrowLeft, Layers, Save, Trash2, Wand2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useProductModel, useUpdateProductModel, useDeleteProductModel, useGenerateModelSkus,
  type AllowedOptions, type AllowedOptions as AOpts,
} from '../lib/product-models-queries';
import { useMaintenanceConfig } from '../lib/mfg-products-queries';
import styles from './ProductModelDetail.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

// Fallback pools used only when the global Maintenance config doesn't have the
// pool keys yet (older deployments). Commander manages the real lists from
// the Maintenance page → Bedframe Sizes / Sofa Compartments / Mattress Sizes
// sub-tabs (PR #50). These constants exist so the UI never renders blank.
const FALLBACK_SOFA_COMPARTMENTS = [
  '1A-LHF', '1A-RHF', '1B-LHF', '1B-RHF', '1NA',
  '2A-LHF', '2A-RHF', '2B-LHF', '2B-RHF', '2NA', '2S',
  '3S', 'CNR', 'L-LHF', 'L-RHF',
];

const FALLBACK_BEDFRAME_SIZES = ['K', 'Q', 'S', 'SS', 'SK', 'SP'];
const FALLBACK_MATTRESS_SIZES = ['K', 'Q', 'S', 'SS'];

export const ProductModelDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { data, isLoading, error } = useProductModel(id);
  const updateMut = useUpdateProductModel();
  const deleteMut = useDeleteProductModel();
  const generateMut = useGenerateModelSkus();
  const maintenance = useMaintenanceConfig('master');

  const [branding, setBranding] = useState('');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [allowed, setAllowed] = useState<AllowedOptions>({});
  const [addCodesOpen, setAddCodesOpen] = useState(false);

  // Sync local form when server row arrives or refetches.
  useEffect(() => {
    if (!data?.model) return;
    setBranding(data.model.branding ?? '');
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
      branding: branding.trim() || null,
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
    deleteMut.mutate(id, { onSuccess: () => navigate('/products') });
  };

  return (
    <div className={styles.page}>
      {/* Header --------------------------------------------------------- */}
      <header className={styles.header}>
        <Link to="/products" className={styles.back}>
          <ArrowLeft {...ICON} /> Products & Maintenance
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
          <label className={styles.field}>
            <span className="t-eyebrow">Branding (optional)</span>
            <input
              type="text"
              value={branding}
              onChange={(e) => setBranding(e.target.value)}
              placeholder={
                model.category === 'SOFA' ? 'e.g. HOUZS'
                : model.category === 'BEDFRAME' ? 'usually encoded in Name; leave blank'
                : model.category === 'MATTRESS' ? 'e.g. 2990S / SEALY'
                : '—'
              }
            />
          </label>
          <label className={styles.field}>
            <span className="t-eyebrow">Name</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={
                model.category === 'SOFA' ? 'e.g. SOFA 5530'
                : model.category === 'BEDFRAME' ? 'e.g. HILTON BEDFRAME'
                : 'e.g. SEALY MATTRESS'
              }
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
            sofaCompartments={maintenance.data?.data?.sofaCompartments ?? FALLBACK_SOFA_COMPARTMENTS}
            sofaSizes={maintenance.data?.data?.sofaSizes ?? ['24', '26', '28', '30', '32', '35']}
            sofaLegHeights={(maintenance.data?.data?.sofaLegHeights ?? []).map((o) => o.value)}
            sofaSpecials={(maintenance.data?.data?.sofaSpecials ?? []).map((o) => o.value)}
          />
        )}

        {model.category === 'BEDFRAME' && (
          <BedframeAllowedOptions
            allowed={allowed}
            onChange={setAllowed}
            sizes={maintenance.data?.data?.bedframeSizes ?? FALLBACK_BEDFRAME_SIZES}
            divanHeights={(maintenance.data?.data?.divanHeights ?? []).map((o) => o.value)}
            totalHeights={(maintenance.data?.data?.totalHeights ?? []).map((o) => o.value)}
            gaps={maintenance.data?.data?.gaps ?? []}
            legHeights={(maintenance.data?.data?.legHeights ?? []).map((o) => o.value)}
            specials={(maintenance.data?.data?.specials ?? []).map((o) => o.value)}
          />
        )}

        {model.category === 'MATTRESS' && (
          <MattressAllowedOptions
            allowed={allowed}
            onChange={setAllowed}
            sizes={maintenance.data?.data?.mattressSizes ?? FALLBACK_MATTRESS_SIZES}
          />
        )}

        {/* PR #66 — Mattress-only thickness input. Feeds the (HxWx{thickness}CM)
            dimensions in the SKU name template. Stored on allowed_options. */}
        {model.category === 'MATTRESS' && (
          <div className={styles.optGroup}>
            <div className={styles.optHead}>
              <span className="t-eyebrow">Mattress thickness (cm)</span>
              <span className={styles.optHint}>
                Drives the {'{width}'}x{'{length}'}x<strong>{'{thickness}'}</strong>CM dimensions in the SKU name
              </span>
            </div>
            <input
              type="number"
              min={0}
              max={99}
              step={1}
              value={
                typeof (allowed as { mattress_thickness_cm?: number }).mattress_thickness_cm === 'number'
                  ? (allowed as { mattress_thickness_cm: number }).mattress_thickness_cm
                  : ''
              }
              onChange={(e) => {
                const v = e.target.value === '' ? null : Number(e.target.value);
                const next: AllowedOptions = { ...allowed };
                if (v == null || Number.isNaN(v)) {
                  delete (next as { mattress_thickness_cm?: number }).mattress_thickness_cm;
                } else {
                  (next as { mattress_thickness_cm: number }).mattress_thickness_cm = v;
                }
                setAllowed(next);
              }}
              placeholder="e.g. 31 (for AKKA-FIRM)"
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-14)',
                padding: 'var(--space-2) var(--space-3)',
                border: '1px solid var(--line-strong)',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--c-paper)',
                width: '160px',
              }}
            />
          </div>
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
            onClick={() => setAddCodesOpen(true)}
          >
            <Wand2 {...ICON} /> Add codes…
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
            then click "Add codes…" to materialise the variants you want.
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
      {/* + Add codes picker modal ------------------------------------- */}
      {addCodesOpen && id && (
        <AddCodesModal
          modelId={id}
          modelCode={model.model_code}
          modelName={model.name}
          category={model.category}
          allowed={allowed}
          mattressThicknessCm={
            typeof (allowed as { mattress_thickness_cm?: number }).mattress_thickness_cm === 'number'
              ? (allowed as { mattress_thickness_cm: number }).mattress_thickness_cm
              : null
          }
          existingCodes={data.skus.map((s) => s.code)}
          onClose={() => setAddCodesOpen(false)}
        />
      )}
    </div>
  );
};

/* ────────────────────────── + Add codes picker modal ───────────────────────
   Lists every combination that comes out of the Model's allowed_options as
   a checkbox row. Codes that already exist on mfg_products are pre-disabled
   so commander can see what's there and can't double-insert.
   ────────────────────────────────────────────────────────────────────────── */

// Mirrors apps/api/src/routes/product-models.ts SIZE_INFO map. Kept in sync
// so the picker preview matches what the server actually writes.
const SIZE_INFO: Record<string, { label: string; dim: string; w: number; l: number }> = {
  K:  { label: '6FT',       dim: '183X190CM', w: 183, l: 190 },
  Q:  { label: '5FT',       dim: '152X190CM', w: 152, l: 190 },
  S:  { label: '3FT',       dim: '90X190CM',  w: 90,  l: 190 },
  SS: { label: '3.5FT',     dim: '107X190CM', w: 107, l: 190 },
  SK: { label: '200X200CM', dim: '',          w: 200, l: 200 },
  SP: { label: '220X220CM', dim: '',          w: 220, l: 220 },
};

/** Candidate row carries the same fields the API's `rows` payload accepts so
    the modal can send them straight through without re-deriving server-side. */
type Candidate = { code: string; name: string; size_code: string | null; size_label: string | null };

function computeCandidates(
  category: string,
  modelCode: string,
  modelName: string,
  allowed: AOpts,
  mattressThicknessCm: number | null,
): Candidate[] {
  if (category === 'SOFA') {
    return (allowed.compartments ?? []).map((comp) => ({
      code:       `${modelCode}-${comp}`,
      name:       `${modelName} ${comp}`.trim(),
      size_code:  null,
      size_label: null,
    }));
  }
  if (category === 'BEDFRAME') {
    return (allowed.sizes ?? []).map((sz) => {
      const info  = SIZE_INFO[sz];
      const label = info?.label ?? sz;
      const namePart = info?.dim ? `${modelName} (${label}) (${info.dim})` : `${modelName} (${label})`;
      return {
        code:       `${modelCode}-(${sz})`,
        name:       namePart.trim(),
        size_code:  sz,
        size_label: label,
      };
    });
  }
  if (category === 'MATTRESS') {
    return (allowed.sizes ?? []).map((sz) => {
      const info  = SIZE_INFO[sz];
      const label = info?.label ?? sz;
      let dimPart: string;
      if (info && mattressThicknessCm != null) {
        dimPart = `${info.w}x${info.l}x${mattressThicknessCm}CM`;
      } else if (info?.dim) {
        dimPart = info.dim.toLowerCase();
      } else {
        dimPart = label;
      }
      return {
        code:       `${modelCode} MATT (${sz})`,
        name:       `${modelName} (${dimPart})`.trim(),
        size_code:  sz,
        size_label: label,
      };
    });
  }
  return [];
}

function AddCodesModal({
  modelId, modelCode, modelName, category, allowed, mattressThicknessCm, existingCodes, onClose,
}: {
  modelId: string;
  modelCode: string;
  modelName: string;
  category: string;
  allowed: AOpts;
  mattressThicknessCm: number | null;
  existingCodes: string[];
  onClose: () => void;
}) {
  const generateMut = useGenerateModelSkus();
  const existingSet = useMemo(() => new Set(existingCodes), [existingCodes]);
  const candidates = useMemo(
    () => computeCandidates(category, modelCode, modelName, allowed, mattressThicknessCm),
    [category, modelCode, modelName, allowed, mattressThicknessCm],
  );
  // Default: tick every NEW code (existing ones can't be ticked anyway).
  const [picked, setPicked] = useState<Set<string>>(
    () => new Set(candidates.filter((c) => !existingSet.has(c.code)).map((c) => c.code)),
  );

  const togglePick = (code: string) => {
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  };

  const newCount = candidates.filter((c) => !existingSet.has(c.code)).length;
  const existingCount = candidates.length - newCount;

  const submit = () => {
    if (picked.size === 0) {
      window.alert('Pick at least one code to add.');
      return;
    }
    // PR #69 — send the FULL rows the modal computed locally so the API
    // doesn't need the saved allowed_options. Commander used to hit
    // `no_sizes` when she ticked sizes but didn't click Save Changes
    // before clicking Add codes.
    const rows = candidates
      .filter((c) => picked.has(c.code) && !existingSet.has(c.code))
      .map((c) => ({
        code:       c.code,
        name:       c.name,
        size_code:  c.size_code,
        size_label: c.size_label,
      }));
    generateMut.mutate(
      { id: modelId, rows },
      {
        onSuccess: (res) => {
          window.alert(
            `Added ${res.generated} code${res.generated === 1 ? '' : 's'}.`
            + (res.skipped > 0 ? ` Skipped ${res.skipped} (already existed).` : ''),
          );
          onClose();
        },
        onError: (err) => {
          window.alert(`Add failed: ${err instanceof Error ? err.message : err}`);
        },
      },
    );
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHead}>
          <h2 className={styles.modalTitle}>Add codes to {modelCode}</h2>
          <button type="button" className={styles.modalClose} onClick={onClose} aria-label="Close">
            <X {...ICON} />
          </button>
        </header>
        <p className={styles.modalSub}>
          Tick which variants to materialise. Existing codes are greyed out — they
          stay as-is. Each new code becomes a separate SKU row with its own stock,
          cost, and pricing.
        </p>

        {candidates.length === 0 ? (
          <div className={styles.modalEmpty}>
            No allowed options set yet. Toggle some Compartments / Sizes above,
            click Save changes, then come back here.
          </div>
        ) : (
          <div className={styles.modalList}>
            {candidates.map((cand) => {
              const exists = existingSet.has(cand.code);
              const ticked = picked.has(cand.code);
              return (
                <label
                  key={cand.code}
                  className={`${styles.modalRow} ${exists ? styles.modalRowExisting : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={exists || ticked}
                    disabled={exists}
                    onChange={() => togglePick(cand.code)}
                  />
                  <code className={styles.modalCode}>{cand.code}</code>
                  <span className={styles.modalName}>{cand.name}</span>
                  {exists && <span className={styles.modalExistsPill}>EXISTS</span>}
                </label>
              );
            })}
          </div>
        )}

        <footer className={styles.modalFoot}>
          <span className={styles.modalCount}>
            {existingCount} existing · {newCount} new · {picked.size} ticked
          </span>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
            <Button
              variant="primary"
              size="sm"
              onClick={submit}
              disabled={generateMut.isPending || picked.size === 0}
            >
              {generateMut.isPending ? 'Adding…' : `Add ${picked.size} code${picked.size === 1 ? '' : 's'}`}
            </Button>
          </div>
        </footer>
      </div>
    </div>
  );
}

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
  allowed, onChange, sofaCompartments, sofaSizes, sofaLegHeights, sofaSpecials,
}: {
  allowed: AllowedOptions; onChange: (next: AllowedOptions) => void;
  sofaCompartments: string[]; sofaSizes: string[];
  sofaLegHeights: string[]; sofaSpecials: string[];
}) {
  return (
    <>
      <OptionGroup
        label="Compartments"
        hint="Which seat/corner shapes this Model offers · pool managed in Maintenance"
      >
        <ChipToggle
          options={sofaCompartments}
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
  allowed, onChange, sizes, divanHeights, totalHeights, gaps, legHeights, specials,
}: {
  allowed: AllowedOptions; onChange: (next: AllowedOptions) => void;
  sizes: string[]; divanHeights: string[]; totalHeights: string[]; gaps: string[];
  legHeights: string[]; specials: string[];
}) {
  return (
    <>
      <OptionGroup
        label="Sizes"
        hint="Bed sizes this Model is offered in · pool managed in Maintenance"
      >
        <ChipToggle
          options={sizes}
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
  allowed, onChange, sizes,
}: { allowed: AllowedOptions; onChange: (next: AllowedOptions) => void; sizes: string[] }) {
  return (
    <OptionGroup
      label="Sizes"
      hint="Mattress sizes this Model is sold in · pool managed in Maintenance"
    >
      <ChipToggle
        options={sizes}
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
