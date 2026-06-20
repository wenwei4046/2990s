// ----------------------------------------------------------------------------
// FreeItemCampaignSection — admin list + create/edit modal for Free Item
// Campaigns. Mounted in PwpRulesTab right after FreeGiftSection.
//
// A campaign lets the salesperson mark an eligible cart line RM 0. Eligibility
// is a RuleTarget[]: per-Model, optionally narrowed to specific sizes
// (mattress/bedframe), a combo, or compartment(s) (sofa) via RuleTargetPicker.
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import type { RuleTarget } from '@2990s/shared';
import {
  useFreeItemCampaigns,
  useCreateFreeItemCampaign,
  useUpdateFreeItemCampaign,
  useDeleteFreeItemCampaign,
} from '../../lib/queries';
import { RuleTargetPicker, finalizeRuleTargets } from './RuleTargetPicker';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

interface Draft {
  id?: string;
  name: string;
  active: boolean;
  maxFreeQty: number;
  eligible: RuleTarget[];
}

const emptyDraft = (): Draft => ({ name: '', active: false, maxFreeQty: 1, eligible: [] });

export function FreeItemCampaignSection({ canEdit }: { canEdit: boolean }) {
  const { data: campaigns = [] } = useFreeItemCampaigns();
  const create = useCreateFreeItemCampaign();
  const update = useUpdateFreeItemCampaign();
  const remove = useDeleteFreeItemCampaign();
  const [draft, setDraft] = useState<Draft | null>(null);

  const onSave = async () => {
    if (!draft) return;
    const clean = {
      name: draft.name.trim(),
      active: draft.active,
      maxFreeQty: Math.max(1, Math.floor(draft.maxFreeQty)),
      eligible: finalizeRuleTargets(draft.eligible),
    };
    if (!clean.name) return;
    if (draft.id) await update.mutateAsync({ id: draft.id, ...clean });
    else await create.mutateAsync(clean);
    setDraft(null);
  };

  const onDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete campaign "${name}"?`)) return;
    await remove.mutateAsync(id);
  };

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
                {new Set(c.eligible.map((e) => e.modelId)).size} model(s) · free up to {c.maxFreeQty}/line
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
                  onClick={() => void onDelete(c.id, c.name)}
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
            Eligible models — tick a Model, then narrow by size (mattress / bed frame) or
            combo / compartment (sofa).
          </div>
          <RuleTargetPicker
            value={draft.eligible}
            onChange={(eligible) => setDraft((d) => (d ? { ...d, eligible } : null))}
          />

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
