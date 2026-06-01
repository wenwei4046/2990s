// ----------------------------------------------------------------------------
// PwpRulesTab — Purchase-with-purchase (换购优惠) rules manager.
//
// Chairman 2026-06-02. MULTIPLE rules (like Combo Pricing), each: a TRIGGER
// (category + specific models) → a REWARD (category + specific models) at a
// RATIO (1 trigger unlocks N rewards). Buying an eligible trigger unlocks
// redeeming eligible reward models at their PWP price (set per SKU in SKU Master).
//
// e.g. "2990 AKKA → Aria, 1:1" and "2990 KETTA → Orient, 1:2" are two rules.
//
// Trigger/Reward categories are Mattress + Bed Frame (both can sit in one cart
// and have PWP pricing wired). SOFA is reserved — a sofa is its own cart
// (sofa-exclusivity) so it can't co-trigger a bed frame, and sofa PWP pricing
// isn't wired yet. Writes gated to Master Admin (mode === 'full').
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, ArrowRight } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useProductModels, type ProductModelRow } from '../../lib/products/product-models-queries';
import {
  usePwpRules,
  useCreatePwpRule,
  useUpdatePwpRule,
  useDeletePwpRule,
  type PwpRuleRow,
} from '../../lib/products/pwp-queries';

type Mode = 'view' | 'add-only' | 'full';
type Cat = 'MATTRESS' | 'BEDFRAME';

const CATEGORIES: { value: Cat; label: string }[] = [
  { value: 'MATTRESS', label: 'Mattress' },
  { value: 'BEDFRAME', label: 'Bed Frame' },
];

const modelLabel = (m: ProductModelRow): string =>
  [m.branding, m.name].filter(Boolean).join(' ') || m.model_code;

interface Draft {
  id?: string;
  triggerCategory: Cat;
  triggerModelIds: string[];
  rewardCategory: Cat;
  rewardModelIds: string[];
  qty: number;
  active: boolean;
}

const emptyDraft = (): Draft => ({
  triggerCategory: 'MATTRESS',
  triggerModelIds: [],
  rewardCategory: 'BEDFRAME',
  rewardModelIds: [],
  qty: 1,
  active: true,
});

const ICON = { size: 14, strokeWidth: 1.75 } as const;

const chipStyle = (on: boolean, disabled: boolean): React.CSSProperties => ({
  padding: '6px 12px',
  borderRadius: 999,
  fontSize: 'var(--fs-13)',
  fontFamily: 'var(--font-button)',
  cursor: disabled ? 'default' : 'pointer',
  border: on ? '1px solid var(--c-orange)' : '1px solid var(--line-strong)',
  background: on ? 'rgba(232, 107, 58, 0.12)' : 'var(--c-cream)',
  color: on ? 'var(--c-burnt, #A6471E)' : 'var(--c-ink)',
  opacity: disabled && !on ? 0.6 : 1,
});

export const PwpRulesTab = ({ mode }: { mode: Mode }) => {
  const canEdit = mode === 'full';

  const rulesQ = usePwpRules();
  const mattressQ = useProductModels({ category: 'MATTRESS' });
  const bedframeQ = useProductModels({ category: 'BEDFRAME' });
  const create = useCreatePwpRule();
  const update = useUpdatePwpRule();
  const del = useDeletePwpRule();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  const modelsFor = (cat: Cat): ProductModelRow[] =>
    (cat === 'MATTRESS' ? mattressQ.data : bedframeQ.data) ?? [];
  const loadingFor = (cat: Cat): boolean =>
    cat === 'MATTRESS' ? mattressQ.isLoading : bedframeQ.isLoading;

  // id → label across both categories, for the rule cards.
  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of [...(mattressQ.data ?? []), ...(bedframeQ.data ?? [])]) m.set(row.id, modelLabel(row));
    return m;
  }, [mattressQ.data, bedframeQ.data]);

  const catLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c;
  const modelsSummary = (ids: string[], cat: string) =>
    ids.length === 0 ? `Any ${catLabel(cat)}` : ids.map((id) => labelById.get(id) ?? id).join(', ');

  const busy = create.isPending || update.isPending || del.isPending;

  const openNew = () => { setError(null); setDraft(emptyDraft()); };
  const openEdit = (r: PwpRuleRow) => {
    setError(null);
    setDraft({
      id: r.id,
      triggerCategory: (r.triggerCategory as Cat) ?? 'MATTRESS',
      triggerModelIds: r.triggerEligibleModelIds,
      rewardCategory: (r.rewardCategory as Cat) ?? 'BEDFRAME',
      rewardModelIds: r.eligibleRewardModelIds,
      qty: r.qtyPerTrigger,
      active: r.active,
    });
  };

  const onSave = async () => {
    if (!draft) return;
    setError(null);
    if (!Number.isInteger(draft.qty) || draft.qty < 1) {
      setError('Ratio must unlock at least 1 reward (1 : N, N ≥ 1).');
      return;
    }
    const body = {
      triggerCategory: draft.triggerCategory,
      triggerEligibleModelIds: draft.triggerModelIds,
      rewardCategory: draft.rewardCategory,
      eligibleRewardModelIds: draft.rewardModelIds,
      qtyPerTrigger: draft.qty,
      active: draft.active,
    };
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, ...body });
      else await create.mutateAsync(body);
      setDraft(null);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    }
  };

  const onDelete = async (id: string) => {
    setError(null);
    try { await del.mutateAsync(id); } catch (e) { setError(String((e as Error).message ?? e)); }
  };

  if (rulesQ.isLoading) {
    return <div style={{ padding: 'var(--space-5)', color: 'var(--fg-muted)' }}>Loading PWP rules…</div>;
  }
  if (rulesQ.error) {
    return <div style={{ padding: 'var(--space-5)', color: 'var(--fg-muted)' }}>Failed to load: {String(rulesQ.error)}</div>;
  }

  const rules = rulesQ.data ?? [];

  // ── Editor (create / edit one rule) ───────────────────────────────────────
  if (draft) {
    const ChipRow = ({ cat, selected, onToggle }: { cat: Cat; selected: string[]; onToggle: (id: string) => void }) => {
      const models = modelsFor(cat);
      if (loadingFor(cat)) return <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>Loading models…</div>;
      if (models.length === 0) return <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>No {catLabel(cat)} models yet.</div>;
      return (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {models.map((m) => (
              <button key={m.id} type="button" disabled={!canEdit} onClick={() => onToggle(m.id)} style={chipStyle(selected.includes(m.id), !canEdit)}>
                {modelLabel(m)}
              </button>
            ))}
          </div>
          {selected.length === 0 && (
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 'var(--space-2)' }}>
              Nothing selected → every {catLabel(cat)} qualifies.
            </div>
          )}
        </>
      );
    };

    const CatPicker = ({ value, onChange }: { value: Cat; onChange: (c: Cat) => void }) => (
      <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
        {CATEGORIES.map((c) => (
          <button key={c.value} type="button" disabled={!canEdit} onClick={() => onChange(c.value)} style={chipStyle(value === c.value, !canEdit)}>
            {c.label}
          </button>
        ))}
        <span title="A sofa is its own order (can't share a cart) and sofa PWP pricing isn't wired yet." style={{ ...chipStyle(false, true), cursor: 'help', opacity: 0.5 }}>
          Sofa (reserved)
        </span>
      </div>
    );

    return (
      <div style={{ padding: 'var(--space-5)', maxWidth: 760 }}>
        <h2 style={{ fontSize: 'var(--fs-18)', marginBottom: 'var(--space-1)' }}>{draft.id ? 'Edit PWP rule' : 'New PWP rule'}</h2>
        <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginBottom: 'var(--space-5)' }}>
          Choose what the customer must buy (Trigger), what they can then redeem at PWP price (Reward),
          and the ratio. Set each reward’s PWP price in the SKU Master “PWP Price” column.
        </p>

        <div style={{ marginBottom: 'var(--space-5)' }}>
          <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>1 · Trigger — what unlocks the offer</span>
          <CatPicker value={draft.triggerCategory} onChange={(c) => setDraft({ ...draft, triggerCategory: c, triggerModelIds: [] })} />
          <ChipRow cat={draft.triggerCategory} selected={draft.triggerModelIds} onToggle={(id) => setDraft({ ...draft, triggerModelIds: draft.triggerModelIds.includes(id) ? draft.triggerModelIds.filter((x) => x !== id) : [...draft.triggerModelIds, id] })} />
        </div>

        <div style={{ marginBottom: 'var(--space-5)' }}>
          <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>2 · Reward — redeemable at PWP price</span>
          <CatPicker value={draft.rewardCategory} onChange={(c) => setDraft({ ...draft, rewardCategory: c, rewardModelIds: [] })} />
          <ChipRow cat={draft.rewardCategory} selected={draft.rewardModelIds} onToggle={(id) => setDraft({ ...draft, rewardModelIds: draft.rewardModelIds.includes(id) ? draft.rewardModelIds.filter((x) => x !== id) : [...draft.rewardModelIds, id] })} />
        </div>

        <div style={{ marginBottom: 'var(--space-5)', maxWidth: 420 }}>
          <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>3 · Ratio — rewards unlocked per trigger</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            <span style={{ fontSize: 'var(--fs-15)', fontWeight: 600 }}>1 {catLabel(draft.triggerCategory)}</span>
            <ArrowRight {...ICON} />
            <input
              type="number"
              min={1}
              step={1}
              value={draft.qty}
              disabled={!canEdit}
              onChange={(e) => setDraft({ ...draft, qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })}
              style={{ width: 80, padding: '8px 10px', fontSize: 'var(--fs-15)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)', background: canEdit ? 'var(--c-cream)' : 'rgba(34,31,32,0.04)', textAlign: 'center' }}
            />
            <span style={{ fontSize: 'var(--fs-15)', fontWeight: 600 }}>{catLabel(draft.rewardCategory)}{draft.qty > 1 ? 's' : ''}</span>
          </div>
          <span style={{ display: 'block', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>
            Buy 2 qualifying triggers → {draft.qty * 2} rewards at PWP price.
          </span>
        </div>

        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 'var(--space-4)', cursor: canEdit ? 'pointer' : 'default' }}>
          <input type="checkbox" checked={draft.active} disabled={!canEdit} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} />
          Active — offer is live in the POS
        </label>

        {error && <div style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginBottom: 'var(--space-3)' }} role="alert">{error}</div>}

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {canEdit && (
            <Button variant="primary" onClick={() => void onSave()} disabled={busy}>
              {busy ? 'Saving…' : draft.id ? 'Save changes' : 'Create rule'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => { setDraft(null); setError(null); }} disabled={busy}>
            {canEdit ? 'Cancel' : 'Back'}
          </Button>
        </div>
      </div>
    );
  }

  // ── List view ─────────────────────────────────────────────────────────────
  return (
    <div style={{ padding: 'var(--space-5)', maxWidth: 880 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', marginBottom: 'var(--space-4)' }}>
        <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', margin: 0, maxWidth: 620 }}>
          Each rule lets a customer who buys a qualifying <b>Trigger</b> redeem a <b>Reward</b> at its PWP
          price (set in the SKU Master “PWP Price” column), at the chosen ratio. Add as many rules as you
          need — e.g. one mattress unlocks one bed frame, another unlocks a different one. Changes apply to
          new orders only.
        </p>
        {canEdit && (
          <Button variant="primary" onClick={openNew}>
            <Plus {...ICON} /> New rule
          </Button>
        )}
      </div>

      {rules.length === 0 ? (
        <div style={{ padding: 'var(--space-7)', textAlign: 'center', color: 'var(--fg-muted)', border: '1px dashed var(--line-strong)', borderRadius: 'var(--radius-md)' }}>
          No PWP rules yet.{canEdit ? ' Click “New rule” to create one.' : ''}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {rules.map((r) => (
            <div key={r.id} style={{ border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-4)', opacity: r.active ? 1 : 0.55 }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap', fontSize: 'var(--fs-14)' }}>
                <span style={{ fontWeight: 600 }}>{modelsSummary(r.triggerEligibleModelIds, r.triggerCategory)}</span>
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>({catLabel(r.triggerCategory)})</span>
                <ArrowRight {...ICON} />
                <span style={{ fontWeight: 600 }}>{modelsSummary(r.eligibleRewardModelIds, r.rewardCategory)}</span>
                <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>({catLabel(r.rewardCategory)})</span>
              </div>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>
                Ratio 1 : {r.qtyPerTrigger}{r.active ? '' : ' · inactive'}
              </div>
            </div>
            {canEdit && (
              <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                <button type="button" aria-label="Edit rule" title="Edit" onClick={() => openEdit(r)} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer', color: 'var(--c-ink)' }}>
                  <Pencil {...ICON} />
                </button>
                <button type="button" aria-label="Delete rule" title="Delete" disabled={busy} onClick={() => void onDelete(r.id)} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer', color: 'var(--c-burnt, #A6471E)' }}>
                  <Trash2 {...ICON} />
                </button>
              </div>
            )}
            </div>
          ))}
        </div>
      )}

      {error && <div style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginTop: 'var(--space-3)' }} role="alert">{error}</div>}
      {!canEdit && <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginTop: 'var(--space-4)' }}>Read-only — only Master Admin can change PWP rules.</div>}
    </div>
  );
};
