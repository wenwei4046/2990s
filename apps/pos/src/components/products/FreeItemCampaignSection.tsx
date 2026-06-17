// ----------------------------------------------------------------------------
// FreeItemCampaignSection — admin list + create/edit modal for Free Item
// Campaigns. Mounted in PwpRulesTab right after FreeGiftSection.
//
// A campaign lets the salesperson mark an eligible cart line RM 0.
// Eligibility is per-Model; for SOFA Models the admin can scope to a specific
// Combo (By-Combo) instead of any build (By-Model = "Any build").
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import type { FreeItemEligibility } from '@2990s/shared';
import {
  useFreeItemCampaigns,
  useCreateFreeItemCampaign,
  useUpdateFreeItemCampaign,
  useDeleteFreeItemCampaign,
} from '../../lib/queries';
import { useProductModels, type ProductModelRow } from '../../lib/products/product-models-queries';
import { useSofaCombos, type SofaComboRule } from '../../lib/products/sofa-combos-queries';
import { buildComboLabel } from '@2990s/shared';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

interface Draft {
  id?: string;
  name: string;
  active: boolean;
  maxFreeQty: number;
  eligible: FreeItemEligibility[];
}

const emptyDraft = (): Draft => ({ name: '', active: false, maxFreeQty: 1, eligible: [] });

const modelLabel = (m: ProductModelRow): string =>
  [m.branding, m.name].filter(Boolean).join(' ') || m.model_code;

const comboDisplayLabel = (c: SofaComboRule): string =>
  c.label ?? buildComboLabel(c.modules);

export function FreeItemCampaignSection({ canEdit }: { canEdit: boolean }) {
  const { data: campaigns = [] } = useFreeItemCampaigns();
  // Load all models in one call (no category filter) so we can group by category.
  const { data: models = [] } = useProductModels();
  const { data: combos = [] } = useSofaCombos();
  const create = useCreateFreeItemCampaign();
  const update = useUpdateFreeItemCampaign();
  const remove = useDeleteFreeItemCampaign();
  const [draft, setDraft] = useState<Draft | null>(null);

  const toggleModel = (modelId: string, on: boolean) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            eligible: on
              ? [...d.eligible, { modelId, scope: 'model', comboId: null }]
              : d.eligible.filter((e) => e.modelId !== modelId),
          }
        : null,
    );

  const setScope = (
    modelId: string,
    scope: 'model' | 'combo',
    comboId: string | null,
  ) =>
    setDraft((d) =>
      d
        ? {
            ...d,
            eligible: d.eligible.map((e) =>
              e.modelId === modelId ? { ...e, scope, comboId } : e,
            ),
          }
        : null,
    );

  const onSave = async () => {
    if (!draft) return;
    const clean = {
      name: draft.name.trim(),
      active: draft.active,
      maxFreeQty: Math.max(1, Math.floor(draft.maxFreeQty)),
      eligible: draft.eligible.filter(
        (e) => e.modelId && (e.scope === 'model' || e.comboId),
      ),
    };
    if (!clean.name) return;
    if (draft.id) await update.mutateAsync({ id: draft.id, ...clean });
    else await create.mutateAsync(clean);
    setDraft(null);
  };

  // Group models by category for the eligible picker.
  const modelsByCategory = models.reduce<Record<string, ProductModelRow[]>>(
    (acc, m) => {
      const cat = m.category ?? 'OTHER';
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(m);
      return acc;
    },
    {},
  );
  const categoryOrder = ['SOFA', 'MATTRESS', 'BEDFRAME', 'ACCESSORY'];
  const sortedCategories = [
    ...categoryOrder.filter((c) => modelsByCategory[c]),
    ...Object.keys(modelsByCategory).filter((c) => !categoryOrder.includes(c)),
  ];

  return (
    <section style={{ marginBottom: 'var(--space-6)' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 'var(--space-3)',
        }}
      >
        <h3
          style={{
            fontSize: 'var(--fs-13)',
            fontWeight: 600,
            color: 'var(--fg-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
            margin: 0,
          }}
        >
          Free Item Campaigns
        </h3>
        {canEdit && (
          <Button variant="secondary" onClick={() => setDraft(emptyDraft())}>
            <Plus {...ICON} /> New Free Item
          </Button>
        )}
      </div>
      <p
        style={{
          fontSize: 'var(--fs-12)',
          color: 'var(--fg-soft)',
          marginTop: 0,
          marginBottom: 'var(--space-3)',
        }}
      >
        While a campaign is active, the salesperson can make an eligible item free (RM 0) in the
        cart — no purchase needed. Changes apply to new orders only.
      </p>

      {campaigns.length === 0 ? (
        <div
          style={{
            padding: 'var(--space-5)',
            textAlign: 'center',
            color: 'var(--fg-muted)',
            border: '1px dashed var(--line-strong)',
            borderRadius: 'var(--radius-md)',
          }}
        >
          No free item campaigns yet.{canEdit ? ' Click "New Free Item" to create one.' : ''}
        </div>
      ) : (
        campaigns.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              padding: 'var(--space-3)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-2)',
              opacity: c.active ? 1 : 0.55,
            }}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                {c.name}
                {c.active ? '' : ' · inactive'}
              </div>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                {c.eligible.length} model(s) · free up to {c.maxFreeQty}/line
              </div>
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                <button
                  type="button"
                  aria-label="Edit"
                  onClick={() =>
                    setDraft({
                      id: c.id,
                      name: c.name,
                      active: c.active,
                      maxFreeQty: c.maxFreeQty,
                      eligible: c.eligible,
                    })
                  }
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--line-strong)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 8px',
                    cursor: 'pointer',
                  }}
                >
                  <Pencil {...ICON} />
                </button>
                <button
                  type="button"
                  aria-label="Delete"
                  onClick={() => void remove.mutateAsync(c.id)}
                  style={{
                    background: 'transparent',
                    border: '1px solid var(--line-strong)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '6px 8px',
                    cursor: 'pointer',
                    color: 'var(--c-burnt, #A6471E)',
                  }}
                >
                  <Trash2 {...ICON} />
                </button>
              </div>
            )}
          </div>
        ))
      )}

      {draft && (
        <div
          role="dialog"
          aria-label="Free item campaign"
          style={{
            marginTop: 'var(--space-3)',
            padding: 'var(--space-4)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-md)',
            background: 'var(--c-paper)',
          }}
        >
          <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Campaign name
            </span>
            <input
              type="text"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              style={{ display: 'block', width: '100%' }}
            />
          </label>
          <label
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              alignItems: 'center',
              marginBottom: 'var(--space-3)',
            }}
          >
            <input
              type="checkbox"
              checked={draft.active}
              onChange={(e) => setDraft({ ...draft, active: e.target.checked })}
            />{' '}
            Active
          </label>
          <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              Max free per line
            </span>
            <input
              type="number"
              min={1}
              value={draft.maxFreeQty}
              onChange={(e) => setDraft({ ...draft, maxFreeQty: Number(e.target.value) })}
            />
          </label>

          <div
            style={{
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-muted)',
              marginBottom: 'var(--space-2)',
            }}
          >
            Eligible models
          </div>
          <div
            style={{
              maxHeight: 320,
              overflow: 'auto',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: 'var(--space-2)',
            }}
          >
            {sortedCategories.map((cat) => (
              <div key={cat}>
                <div
                  style={{
                    fontSize: 'var(--fs-11)',
                    fontWeight: 600,
                    color: 'var(--fg-soft)',
                    textTransform: 'uppercase',
                    letterSpacing: '0.05em',
                    padding: '4px 2px 2px',
                  }}
                >
                  {cat}
                </div>
                {(modelsByCategory[cat] ?? []).map((m) => {
                  const entry = draft.eligible.find((e) => e.modelId === m.id);
                  // For SOFA models: filter combos by baseModel === model_code (case-insensitive)
                  // and exclude soft-deleted (deletedAt non-null).
                  const modelCombos: SofaComboRule[] =
                    cat === 'SOFA'
                      ? combos.filter(
                          (cb) =>
                            cb.baseModel?.toUpperCase() === m.model_code.toUpperCase() &&
                            !cb.deletedAt,
                        )
                      : [];
                  return (
                    <div
                      key={m.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 'var(--space-2)',
                        padding: '4px 0',
                        flexWrap: 'wrap',
                      }}
                    >
                      <label style={{ flex: 1, minWidth: 200 }}>
                        <input
                          type="checkbox"
                          checked={Boolean(entry)}
                          onChange={(e) => toggleModel(m.id, e.target.checked)}
                        />{' '}
                        {modelLabel(m)}
                      </label>
                      {entry && cat === 'SOFA' && (
                        <select
                          value={
                            entry.scope === 'combo' ? (entry.comboId ?? '') : 'model'
                          }
                          onChange={(e) =>
                            e.target.value === 'model'
                              ? setScope(m.id, 'model', null)
                              : setScope(m.id, 'combo', e.target.value)
                          }
                        >
                          <option value="model">Any build</option>
                          {modelCombos.map((cb) => (
                            <option key={cb.id} value={cb.id}>
                              {comboDisplayLabel(cb)}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  );
                })}
              </div>
            ))}
            {models.length === 0 && (
              <div style={{ color: 'var(--fg-soft)', padding: 'var(--space-2)' }}>
                No models found.
              </div>
            )}
          </div>

          <div
            style={{
              display: 'flex',
              gap: 'var(--space-2)',
              justifyContent: 'flex-end',
              marginTop: 'var(--space-3)',
            }}
          >
            <Button variant="ghost" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              onClick={() => void onSave()}
              disabled={!draft.name.trim()}
            >
              Save
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
