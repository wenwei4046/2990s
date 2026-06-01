// ----------------------------------------------------------------------------
// PwpRulesTab — Purchase-with-purchase (换购优惠) rules editor.
//
// Chairman 2026-06-02. A global rule: buying an eligible Mattress model unlocks
// redeeming an eligible Bed Frame model at its PWP price (set per SKU in the SKU
// Master "PWP Price" column). allowance = qty × (qualifying mattresses bought).
//
// v1 exposes the one enabled pair (Mattress → Bed Frame); the data model + server
// are generic (any Category → Category), so more pairs can be surfaced later
// without a schema change. Writes gated to Master Admin (mode === 'full').
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Button } from '@2990s/design-system';
import { useProductModels, type ProductModelRow } from '../../lib/products/product-models-queries';
import {
  usePwpRules,
  useCreatePwpRule,
  useUpdatePwpRule,
  useDeletePwpRule,
} from '../../lib/products/pwp-queries';

type Mode = 'view' | 'add-only' | 'full';

const TRIGGER_CATEGORY = 'MATTRESS' as const;
const REWARD_CATEGORY = 'BEDFRAME' as const;

const modelLabel = (m: ProductModelRow): string =>
  [m.branding, m.name].filter(Boolean).join(' ') || m.model_code;

const ModelChips = ({
  models,
  selectedIds,
  onToggle,
  disabled,
  loading,
  emptyHint,
}: {
  models: ProductModelRow[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled: boolean;
  loading: boolean;
  emptyHint: string;
}) => {
  if (loading) return <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>Loading models…</div>;
  if (models.length === 0) return <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>No models in this category yet.</div>;
  return (
    <>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
        {models.map((m) => {
          const on = selectedIds.includes(m.id);
          return (
            <button
              key={m.id}
              type="button"
              disabled={disabled}
              onClick={() => onToggle(m.id)}
              data-active={on}
              style={{
                padding: '6px 12px',
                borderRadius: 999,
                fontSize: 'var(--fs-13)',
                fontFamily: 'var(--font-button)',
                cursor: disabled ? 'default' : 'pointer',
                border: on ? '1px solid var(--c-orange)' : '1px solid var(--line-strong)',
                background: on ? 'rgba(232, 107, 58, 0.12)' : 'var(--c-cream)',
                color: on ? 'var(--c-burnt, #A6471E)' : 'var(--c-ink)',
                opacity: disabled && !on ? 0.6 : 1,
              }}
            >
              {modelLabel(m)}
            </button>
          );
        })}
      </div>
      {selectedIds.length === 0 && (
        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 'var(--space-2)' }}>{emptyHint}</div>
      )}
    </>
  );
};

const sectionStyle: React.CSSProperties = { marginBottom: 'var(--space-5)' };
const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: 'var(--fs-13)',
  fontWeight: 600,
  marginBottom: 'var(--space-2)',
};

export const PwpRulesTab = ({ mode }: { mode: Mode }) => {
  const canEdit = mode === 'full';

  const rulesQ = usePwpRules();
  const mattressQ = useProductModels({ category: TRIGGER_CATEGORY });
  const bedframeQ = useProductModels({ category: REWARD_CATEGORY });
  const create = useCreatePwpRule();
  const update = useUpdatePwpRule();
  const del = useDeletePwpRule();

  // The single Mattress → Bed Frame rule (v1 exposes this one pair).
  const rule = useMemo(
    () =>
      (rulesQ.data ?? []).find(
        (r) => r.triggerCategory === TRIGGER_CATEGORY && r.rewardCategory === REWARD_CATEGORY,
      ) ?? null,
    [rulesQ.data],
  );

  const [triggerIds, setTriggerIds] = useState<string[]>([]);
  const [rewardIds, setRewardIds] = useState<string[]>([]);
  const [qty, setQty] = useState<number>(1);
  const [active, setActive] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Hydrate the form from the loaded rule (or defaults when none exists yet).
  useEffect(() => {
    if (rule) {
      setTriggerIds(rule.triggerEligibleModelIds);
      setRewardIds(rule.eligibleRewardModelIds);
      setQty(rule.qtyPerTrigger);
      setActive(rule.active);
    }
  }, [rule]);

  const toggleTrigger = (id: string) =>
    setTriggerIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleReward = (id: string) =>
    setRewardIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const busy = create.isPending || update.isPending || del.isPending;

  const onSave = async () => {
    setError(null);
    setSaved(false);
    if (!Number.isInteger(qty) || qty < 1) {
      setError('Bed frames per mattress must be a whole number ≥ 1.');
      return;
    }
    const body = {
      triggerCategory: TRIGGER_CATEGORY,
      triggerEligibleModelIds: triggerIds,
      rewardCategory: REWARD_CATEGORY,
      eligibleRewardModelIds: rewardIds,
      qtyPerTrigger: qty,
      active,
    };
    try {
      if (rule) await update.mutateAsync({ id: rule.id, ...body });
      else await create.mutateAsync(body);
      setSaved(true);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };

  const onDelete = async () => {
    if (!rule) return;
    setError(null);
    setSaved(false);
    try {
      await del.mutateAsync(rule.id);
      setTriggerIds([]);
      setRewardIds([]);
      setQty(1);
      setActive(true);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };

  if (rulesQ.isLoading) {
    return <div style={{ padding: 'var(--space-5)', color: 'var(--fg-muted)' }}>Loading PWP rules…</div>;
  }
  if (rulesQ.error) {
    return <div style={{ padding: 'var(--space-5)', color: 'var(--fg-muted)' }}>Failed to load: {String(rulesQ.error)}</div>;
  }

  return (
    <div style={{ padding: 'var(--space-5)', maxWidth: 720 }}>
      <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginBottom: 'var(--space-5)' }}>
        Purchase-with-purchase lets a customer who buys a qualifying mattress redeem
        a bed frame at its PWP price. Set each bed frame’s PWP price in the SKU Master
        “PWP Price” column. Here you choose which mattresses unlock the offer, which
        bed frames can be redeemed, and how many bed frames each mattress unlocks.
        Changes apply to new orders only.
      </p>

      <div style={sectionStyle}>
        <span style={labelStyle}>1 · Trigger — mattresses that unlock the offer</span>
        <ModelChips
          models={mattressQ.data ?? []}
          selectedIds={triggerIds}
          onToggle={toggleTrigger}
          disabled={!canEdit}
          loading={mattressQ.isLoading}
          emptyHint="Nothing selected — every mattress will unlock the offer."
        />
      </div>

      <div style={sectionStyle}>
        <span style={labelStyle}>2 · Reward — bed frames that can be redeemed at PWP price</span>
        <ModelChips
          models={bedframeQ.data ?? []}
          selectedIds={rewardIds}
          onToggle={toggleReward}
          disabled={!canEdit}
          loading={bedframeQ.isLoading}
          emptyHint="Nothing selected — any bed frame can be redeemed."
        />
      </div>

      <div style={{ ...sectionStyle, maxWidth: 360 }}>
        <label htmlFor="pwp-qty" style={labelStyle}>3 · Bed frames unlocked per qualifying mattress</label>
        <input
          id="pwp-qty"
          type="number"
          min={1}
          step={1}
          value={qty}
          disabled={!canEdit}
          onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))}
          style={{
            width: '100%',
            padding: '8px 10px',
            fontSize: 'var(--fs-14)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-md)',
            background: canEdit ? 'var(--c-cream)' : 'rgba(34, 31, 32, 0.04)',
          }}
        />
        <span style={{ display: 'block', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>
          Buy 2 qualifying mattresses with this set to 1 → 2 bed frames at PWP price.
        </span>
      </div>

      <div style={sectionStyle}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-13)', fontWeight: 600, cursor: canEdit ? 'pointer' : 'default' }}>
          <input
            type="checkbox"
            checked={active}
            disabled={!canEdit}
            onChange={(e) => setActive(e.target.checked)}
          />
          Active — offer is live in the POS
        </label>
      </div>

      {error && <div style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginBottom: 'var(--space-3)' }} role="alert">{error}</div>}
      {saved && <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)', marginBottom: 'var(--space-3)' }}>Saved.</div>}

      {canEdit ? (
        <div style={{ display: 'flex', gap: 'var(--space-3)', alignItems: 'center' }}>
          <Button variant="primary" onClick={() => void onSave()} disabled={busy}>
            {busy ? 'Saving…' : rule ? 'Save changes' : 'Create rule'}
          </Button>
          {rule && (
            <Button variant="ghost" onClick={() => void onDelete()} disabled={busy}>
              Delete rule
            </Button>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
          Read-only — only Master Admin can change PWP rules.
        </div>
      )}
    </div>
  );
};
