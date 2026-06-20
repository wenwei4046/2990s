// ----------------------------------------------------------------------------
// RuleTargetPicker — the shared, category-aware product targeting control used
// by the Free Item Campaign editor, the Free Gifts condition, and (Wave 2) the
// PWP rule editor. Produces RuleTarget[] for the unified matcher (rule-target.ts):
//
//   MATTRESS / BEDFRAME : check the Model = any variant; tick sizes to narrow.
//   SOFA                : check the Model, then Any build / By combo / By compartment.
//   ACCESSORY           : check the Model (no variants).
//
// Sizes + compartments come straight from product_models.allowed_options (no
// extra query). Combos come from useSofaCombos, scoped by base_model.
// ----------------------------------------------------------------------------

import { buildComboLabel, type RuleTarget, type TargetRefinement, type RuleTargetScope } from '@2990s/shared';
import { useProductModels, type ProductModelRow } from '../../lib/products/product-models-queries';
import { useSofaCombos, type SofaComboRule } from '../../lib/products/sofa-combos-queries';
import { POS_PICKABLE_SIZE_CODES } from '../../lib/queries';

const CATEGORY_ORDER = ['SOFA', 'MATTRESS', 'BEDFRAME', 'ACCESSORY'];
/** mfg size_code → display label. Unknown codes fall through to the raw code. */
const SIZE_LABEL: Record<string, string> = {
  K: 'King', Q: 'Queen', S: 'Single', SS: 'Super Single', SK: 'Super King', SP: 'Special',
};
const FALLBACK_SIZE_CODES = ['Q', 'K', 'S', 'SS'];
const sizeLabel = (code: string): string => SIZE_LABEL[code.toUpperCase()] ?? code;

const modelLabel = (m: ProductModelRow): string =>
  [m.branding, m.name].filter(Boolean).join(' ') || m.model_code;
const comboLabel = (c: SofaComboRule): string => c.label ?? buildComboLabel(c.modules);

/** The size_codes a mattress/bedframe Model offers (allowed_options.sizes), or
 *  the 4 standard codes when the Model is unrestricted (empty pool). Filtered to
 *  POS-pickable codes so we never offer an SK/SP size that a cart line can't
 *  carry (it would be an un-matchable rule). */
const modelSizeCodes = (m: ProductModelRow): string[] => {
  const pool = m.allowed_options?.sizes ?? [];
  if (pool.length === 0) return FALLBACK_SIZE_CODES;
  return pool.map((s) => s.toUpperCase()).filter((c) => POS_PICKABLE_SIZE_CODES.has(c));
};
/** The compartment codes a sofa Model offers (allowed_options.compartments). */
const modelCompartments = (m: ProductModelRow): string[] =>
  (m.allowed_options?.compartments ?? []).map((c) => c.trim()).filter(Boolean);

/** Coerce draft targets to valid, persistable RuleTarget[]: an entry whose
 *  refinement list is empty collapses to scope 'model' (= any variant/build),
 *  so a half-finished "By size/combo/compartment" never ships an empty list
 *  (which the server Zod would reject). */
export function finalizeRuleTargets(targets: RuleTarget[]): RuleTarget[] {
  const out: RuleTarget[] = [];
  for (const t of targets) {
    if (!t.modelId) continue;
    if (t.scope === 'variant' && (t.sizeCodes?.length ?? 0) > 0) {
      out.push({ modelId: t.modelId, scope: 'variant', sizeCodes: t.sizeCodes });
    } else if (t.scope === 'combo' && (t.comboIds?.length ?? 0) > 0) {
      out.push({ modelId: t.modelId, scope: 'combo', comboIds: t.comboIds });
    } else if (t.scope === 'compartment' && (t.compartments?.length ?? 0) > 0) {
      out.push({ modelId: t.modelId, scope: 'compartment', compartments: t.compartments });
    } else {
      out.push({ modelId: t.modelId, scope: 'model' });
    }
  }
  return out;
}

/** Same idea for a single Free-Gifts condition (model fixed by the row). An
 *  empty/none-picked refinement returns null = whole Model (no condition). */
export function finalizeRefinement(ref: TargetRefinement | null | undefined): TargetRefinement | null {
  if (!ref) return null;
  if (ref.scope === 'variant' && (ref.sizeCodes?.length ?? 0) > 0) return { scope: 'variant', sizeCodes: ref.sizeCodes };
  if (ref.scope === 'compartment' && (ref.compartments?.length ?? 0) > 0) return { scope: 'compartment', compartments: ref.compartments };
  if (ref.scope === 'combo' && (ref.comboIds?.length ?? 0) > 0) return { scope: 'combo', comboIds: ref.comboIds };
  return null;
}

const chipStyle = (on: boolean): React.CSSProperties => ({
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  padding: '2px 8px',
  fontSize: 'var(--fs-12)',
  border: `1px solid ${on ? 'var(--c-ink, #221F20)' : 'var(--line-strong)'}`,
  background: on ? 'var(--c-ink, #221F20)' : 'transparent',
  color: on ? 'var(--c-paper, #fff)' : 'var(--fg-muted)',
  borderRadius: 'var(--radius-sm)',
  cursor: 'pointer',
});

// ---------------------------------------------------------------------------
// Single-Model refinement (reused by RuleTargetPicker rows + Free Gifts).
// `category` decides which scopes/lists are offered; `model` provides the
// sizes/compartments; `combos` are the sofa combos already scoped to the Model.
// ---------------------------------------------------------------------------
export function RuleTargetRefinement({
  category,
  model,
  combos,
  value,
  onChange,
}: {
  category: string;
  model: ProductModelRow;
  combos: SofaComboRule[];
  value: TargetRefinement;
  onChange: (next: TargetRefinement) => void;
}) {
  const cat = category.toUpperCase();
  const toggle = (list: string[] | undefined, v: string): string[] => {
    const cur = list ?? [];
    return cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v];
  };

  if (cat === 'MATTRESS' || cat === 'BEDFRAME') {
    const codes = modelSizeCodes(model);
    const picked = value.scope === 'variant' ? (value.sizeCodes ?? []) : [];
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
        <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-soft)' }}>Sizes:</span>
        {codes.map((code) => {
          const on = picked.includes(code);
          return (
            <button
              key={code}
              type="button"
              style={chipStyle(on)}
              onClick={() => {
                const next = toggle(picked, code);
                onChange(next.length ? { scope: 'variant', sizeCodes: next } : { scope: 'model' });
              }}
            >
              {sizeLabel(code)}
            </button>
          );
        })}
        <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-soft)' }}>
          {picked.length === 0 ? '(any variant)' : ''}
        </span>
      </div>
    );
  }

  if (cat === 'SOFA') {
    const compartments = modelCompartments(model);
    const mode: RuleTargetScope =
      value.scope === 'combo' || value.scope === 'compartment' ? value.scope : 'model';
    return (
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <select
          value={mode}
          onChange={(e) => {
            const m = e.target.value as RuleTargetScope;
            onChange(
              m === 'combo' ? { scope: 'combo', comboIds: [] }
                : m === 'compartment' ? { scope: 'compartment', compartments: [] }
                  : { scope: 'model' },
            );
          }}
        >
          <option value="model">Any build</option>
          {combos.length > 0 && <option value="combo">By combo</option>}
          {compartments.length > 0 && <option value="compartment">By compartment</option>}
        </select>
        {mode === 'combo' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {combos.map((cb) => {
              const on = (value.comboIds ?? []).includes(cb.id);
              return (
                <button key={cb.id} type="button" style={chipStyle(on)}
                  onClick={() => onChange({ scope: 'combo', comboIds: toggle(value.comboIds, cb.id) })}>
                  {comboLabel(cb)}
                </button>
              );
            })}
          </div>
        )}
        {mode === 'compartment' && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {compartments.map((code) => {
              const on = (value.compartments ?? []).includes(code);
              return (
                <button key={code} type="button" style={chipStyle(on)}
                  onClick={() => onChange({ scope: 'compartment', compartments: toggle(value.compartments, code) })}>
                  {code}
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ACCESSORY (or unknown) — no variants.
  return null;
}

// ---------------------------------------------------------------------------
// Multi-Model picker → RuleTarget[].
// ---------------------------------------------------------------------------
export function RuleTargetPicker({
  value,
  onChange,
  categories,
}: {
  value: RuleTarget[];
  onChange: (next: RuleTarget[]) => void;
  categories?: string[];
}) {
  const { data: models = [] } = useProductModels();
  const { data: combos = [] } = useSofaCombos();

  const entryFor = (modelId: string): RuleTarget | undefined => value.find((e) => e.modelId === modelId);
  const upsert = (modelId: string, next: RuleTarget | null): void => {
    const rest = value.filter((e) => e.modelId !== modelId);
    onChange(next ? [...rest, next] : rest);
  };

  const byCategory = models.reduce<Record<string, ProductModelRow[]>>((acc, m) => {
    const cat = (m.category ?? 'OTHER').toUpperCase();
    if (categories && !categories.map((c) => c.toUpperCase()).includes(cat)) return acc;
    (acc[cat] ??= []).push(m);
    return acc;
  }, {});
  const sorted = [
    ...CATEGORY_ORDER.filter((c) => byCategory[c]),
    ...Object.keys(byCategory).filter((c) => !CATEGORY_ORDER.includes(c)),
  ];

  return (
    <div
      style={{
        maxHeight: 360, overflow: 'auto',
        border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: 'var(--space-2)',
      }}
    >
      {sorted.map((cat) => (
        <div key={cat}>
          <div style={{
            fontSize: 'var(--fs-11)', fontWeight: 600, color: 'var(--fg-soft)',
            textTransform: 'uppercase', letterSpacing: '0.05em', padding: '4px 2px 2px',
          }}>
            {cat}
          </div>
          {(byCategory[cat] ?? []).map((m) => {
            const entry = entryFor(m.id);
            const modelCombos = cat === 'SOFA'
              ? combos.filter((cb) => cb.baseModel?.toUpperCase() === m.model_code.toUpperCase() && !cb.deletedAt)
              : [];
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '4px 0', flexWrap: 'wrap' }}>
                <label style={{ flex: 1, minWidth: 200 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(entry)}
                    onChange={(e) => upsert(m.id, e.target.checked ? { modelId: m.id, scope: 'model' } : null)}
                  />{' '}
                  {modelLabel(m)}
                </label>
                {entry && (
                  <RuleTargetRefinement
                    category={cat}
                    model={m}
                    combos={modelCombos}
                    value={entry}
                    onChange={(ref) => upsert(m.id, { modelId: m.id, ...ref })}
                  />
                )}
              </div>
            );
          })}
        </div>
      ))}
      {models.length === 0 && (
        <div style={{ color: 'var(--fg-soft)', padding: 'var(--space-2)' }}>No models found.</div>
      )}
    </div>
  );
}
