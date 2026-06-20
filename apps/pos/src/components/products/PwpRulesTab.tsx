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
// Trigger/Reward categories: Mattress, Bed Frame, and Sofa. Mattress/bedframe are
// matched by Model. SOFA is matched by Combo, and a SOFA *trigger* may also be
// matched By Model — any build of the chosen sofa Model(s) qualifies (owner
// 2026-06-20); the mode is derived from which array the rule stores (combo ids vs
// model ids). The sofa *reward* stays by Combo. Writes gated to Master Admin
// (mode === 'full').
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, ArrowRight, ArrowDown, Gift, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildComboLabel, type DefaultFreeGift } from '@2990s/shared';
import { useProductModels, type ProductModelRow } from '../../lib/products/product-models-queries';
import { useSofaCombos, type SofaComboRule } from '../../lib/products/sofa-combos-queries';
import {
  usePwpRules,
  useCreatePwpRule,
  useUpdatePwpRule,
  useDeletePwpRule,
  type PwpRuleRow,
} from '../../lib/products/pwp-queries';
import { useMfgProducts } from '../../lib/products/mfg-products-queries';
import {
  useModelDefaultGifts,
  useUpsertModelDefaultGifts,
  useDeleteModelDefaultGifts,
} from '../../lib/queries';
import { FreeItemCampaignSection } from './FreeItemCampaignSection';
import { RuleTargetRefinement, finalizeRefinement } from './RuleTargetPicker';

type Mode = 'view' | 'add-only' | 'full';
// SOFA is matched by Combo (Phase 2); Mattress/Bedframe by Model.
type Cat = 'MATTRESS' | 'BEDFRAME' | 'SOFA';

const CATEGORIES: { value: Cat; label: string }[] = [
  { value: 'MATTRESS', label: 'Mattress' },
  { value: 'BEDFRAME', label: 'Bed Frame' },
  { value: 'SOFA', label: 'Sofa' },
];

// SOFA trigger match mode. Reward sofa is always 'combo' (by-Model sofa reward is
// out of scope — owner 2026-06-20); only the TRIGGER side exposes this toggle.
type SofaMode = 'combo' | 'model';

const modelLabel = (m: ProductModelRow): string =>
  [m.branding, m.name].filter(Boolean).join(' ') || m.model_code;

const comboLabel = (c: SofaComboRule): string =>
  [c.baseModel, c.label || buildComboLabel(c.modules)].filter(Boolean).join(' · ');

// A SOFA trigger is "by Model" when it carries Model ids but no combo ids — the
// derived discriminator (no match_mode column; mirrors the server's reserve +
// /pwp-rules logic). Non-sofa triggers are always by Model.
const sofaTriggerByModel = (r: { triggerCategory: string; triggerComboIds: string[]; triggerEligibleModelIds: string[] }): boolean =>
  r.triggerCategory === 'SOFA' && (r.triggerComboIds?.length ?? 0) === 0 && (r.triggerEligibleModelIds?.length ?? 0) > 0;

// ── Free-gift section ─────────────────────────────────────────────────────────

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

const GIFT_CATEGORIES = ['MATTRESS', 'BEDFRAME', 'SOFA'] as const;

const FreeGiftSection = ({ canEdit, gwpOpen, onCloseGwp }: { canEdit: boolean; gwpOpen: boolean; onCloseGwp: () => void }) => {
  const mattress = useProductModels({ category: 'MATTRESS' });
  const bedframe = useProductModels({ category: 'BEDFRAME' });
  const sofa     = useProductModels({ category: 'SOFA' });
  const accessoriesQ = useMfgProducts({ category: 'ACCESSORY' });
  const combosQ  = useSofaCombos();
  const giftsQ   = useModelDefaultGifts();
  const upsert   = useUpsertModelDefaultGifts();
  const remove   = useDeleteModelDefaultGifts();

  // Per-Model edit (tweak / clear one Model's existing gift set).
  const [editModelId, setEditModelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<DefaultFreeGift[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Bulk add — pick many Models, define gift(s), append to all of them.
  const [bulkSelected, setBulkSelected] = useState<string[]>([]);
  const [bulkDraft, setBulkDraft] = useState<DefaultFreeGift[]>([{ giftProductId: '', qty: 1, campaignName: null }]);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);

  useEffect(() => {
    if (!editModelId) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditModelId(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editModelId]);

  useEffect(() => {
    if (!gwpOpen) return;
    setBulkSelected([]);
    setBulkDraft([{ giftProductId: '', qty: 1, campaignName: null }]);
    setBulkError(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCloseGwp(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [gwpOpen, onCloseGwp]);

  const models = useMemo(
    () => [...(mattress.data ?? []), ...(bedframe.data ?? []), ...(sofa.data ?? [])],
    [mattress.data, bedframe.data, sofa.data],
  );
  const giftsByModel = useMemo(
    () => new Map((giftsQ.data ?? []).map((r) => [r.modelId, r.gifts])),
    [giftsQ.data],
  );
  const accessories = accessoriesQ.data ?? [];
  const accName = (id: string) => {
    const a = accessories.find((x) => x.id === id);
    return a ? `${a.code} - ${a.name}` : id;
  };
  const giftModelLabel = (m: { branding?: string | null; name: string; model_code: string }) =>
    [m.branding, m.name].filter(Boolean).join(' ') || m.model_code;

  // Clean draft rows → storable entries (drop empty, floor qty, trim campaign,
  // finalize the optional size/compartment condition — an empty refinement
  // collapses to no condition = whole Model).
  const cleanGifts = (rows: DefaultFreeGift[]): DefaultFreeGift[] =>
    rows
      .filter((g) => g.giftProductId)
      .map((g) => {
        const cond = finalizeRefinement(g.condition);
        return {
          giftProductId: g.giftProductId,
          qty: Math.max(1, Math.floor(g.qty)),
          campaignName: g.campaignName?.trim() || null,
          ...(cond ? { condition: cond } : {}),
        };
      });

  // Append `additions` to `existing`, keyed by (giftProductId, campaignName): a
  // matching key updates its qty, a new key is appended — so one Model can carry
  // several distinct gifts (e.g. 2 pillows + 1 protector) built up over time.
  const mergeGifts = (existing: DefaultFreeGift[], additions: DefaultFreeGift[]): DefaultFreeGift[] => {
    const keyOf = (g: DefaultFreeGift) => `${g.giftProductId} ${g.campaignName ?? ''}`;
    const out = existing.map((g) => ({ ...g }));
    const at = new Map(out.map((g, i) => [keyOf(g), i] as const));
    for (const a of additions) {
      const k = keyOf(a);
      const i = at.get(k);
      if (i != null) out[i] = { ...a };
      else { at.set(k, out.length); out.push({ ...a }); }
    }
    return out;
  };

  // ── Per-Model edit modal ──
  const open = (mid: string) => {
    setError(null);
    setEditModelId(mid);
    setDraft((giftsByModel.get(mid) ?? []).map((g) => ({ ...g })));
  };
  const setRow = (i: number, patch: Partial<DefaultFreeGift>) =>
    setDraft((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setDraft((prev) => [...prev, { giftProductId: '', qty: 1, campaignName: null }]);
  const removeRow = (i: number) => setDraft((prev) => prev.filter((_, idx) => idx !== i));
  const save = async () => {
    if (!editModelId) return;
    setError(null);
    const gifts = cleanGifts(draft);
    try {
      if (gifts.length === 0) await remove.mutateAsync(editModelId);
      else await upsert.mutateAsync({ modelId: editModelId, gifts });
      setEditModelId(null);
    } catch (e) { setError(String((e as Error).message ?? e)); }
  };
  // Delete a Model's whole free-gift config straight from the list row.
  const deleteModelGift = async (m: ProductModelRow) => {
    if (!window.confirm(`Remove the free gift for ${giftModelLabel(m)}?`)) return;
    try { await remove.mutateAsync(m.id); } catch (e) { window.alert(`Delete failed: ${String((e as Error).message ?? e)}`); }
  };

  // ── Bulk add ──
  const toggleBulkModel = (mid: string) =>
    setBulkSelected((prev) => (prev.includes(mid) ? prev.filter((x) => x !== mid) : [...prev, mid]));
  const toggleBulkCategory = (cat: string) => {
    const ids = models.filter((m) => m.category === cat).map((m) => m.id);
    const allOn = ids.length > 0 && ids.every((id) => bulkSelected.includes(id));
    setBulkSelected((prev) => (allOn ? prev.filter((id) => !ids.includes(id)) : [...new Set([...prev, ...ids])]));
  };
  const bulkSetRow = (i: number, patch: Partial<DefaultFreeGift>) =>
    setBulkDraft((prev) => prev.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const bulkAddRow = () => setBulkDraft((prev) => [...prev, { giftProductId: '', qty: 1, campaignName: null }]);
  const bulkRemoveRow = (i: number) => setBulkDraft((prev) => (prev.length <= 1 ? prev : prev.filter((_, idx) => idx !== i)));
  const applyBulk = async () => {
    setBulkError(null);
    const additions = cleanGifts(bulkDraft);
    if (bulkSelected.length === 0) { setBulkError('Pick at least one Model.'); return; }
    if (additions.length === 0) { setBulkError('Choose at least one gift accessory.'); return; }
    setBulkBusy(true);
    try {
      for (const mid of bulkSelected) {
        await upsert.mutateAsync({ modelId: mid, gifts: mergeGifts(giftsByModel.get(mid) ?? [], additions) });
      }
      setBulkSelected([]);
      setBulkDraft([{ giftProductId: '', qty: 1, campaignName: null }]);
      onCloseGwp();
    } catch (e) { setBulkError(String((e as Error).message ?? e)); }
    finally { setBulkBusy(false); }
  };

  const inputStyle = { padding: '8px 10px', fontSize: 'var(--fs-14)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)', background: 'var(--c-cream)' } as const;
  const withGifts = models.filter((m) => (giftsByModel.get(m.id)?.length ?? 0) > 0);
  // The Model being edited + its combos (for a sofa size/compartment condition).
  const editModel = models.find((m) => m.id === editModelId) ?? null;
  const editModelCombos: SofaComboRule[] = editModel
    ? (combosQ.data ?? []).filter(
        (cb) => cb.baseModel?.toUpperCase() === editModel.model_code.toUpperCase() && !cb.deletedAt,
      )
    : [];
  const groups = GIFT_CATEGORIES
    .map((cat) => ({ cat, list: models.filter((m) => m.category === cat) }))
    .filter((g) => g.list.length > 0);

  return (
    <div style={{ marginBottom: 'var(--space-6)', borderBottom: '1px solid var(--line)', paddingBottom: 'var(--space-5)' }}>
      <h3 style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-2)' }}>
        <Gift size={14} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginRight: 6 }} />
        Free gifts — per Model
      </h3>
      <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 'var(--space-3)', maxWidth: 620 }}>
        An accessory auto-added at RM 0 when this Model is placed on an order. Applies to every SKU of the Model;
        a complete sofa of the Model grants its gift once. Changes apply to new orders only.
      </p>

      {giftsQ.isLoading ? (
        <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>Loading…</div>
      ) : (
        <>
          {withGifts.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
              {withGifts.map((m) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)', padding: '8px 12px', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', background: 'var(--c-paper)' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600, fontSize: 'var(--fs-14)' }}>{giftModelLabel(m)} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>· {m.category}</span></div>
                    <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-soft)' }}>
                      {(giftsByModel.get(m.id) ?? []).map((g) => `${g.qty}× ${accName(g.giftProductId)}`).join(', ')}
                    </div>
                  </div>
                  {canEdit && (
                    <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
                      <Button variant="ghost" size="sm" onClick={() => open(m.id)}>Edit</Button>
                      <button type="button" aria-label="Delete free gift" title="Delete free gift" disabled={remove.isPending} onClick={() => void deleteModelGift(m)} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 10px', cursor: 'pointer', color: 'var(--c-burnt, #A6471E)' }}><Trash2 size={14} strokeWidth={1.75} /></button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

        </>
      )}

      {gwpOpen && (
        <div onClick={onCloseGwp} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--c-cream)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-3)', width: 'min(820px, 95vw)', maxHeight: '88vh', display: 'flex', flexDirection: 'column' }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '1px solid var(--line)' }}>
              <h2 style={{ fontSize: 'var(--fs-16)', margin: 0 }}>
                <Gift size={18} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                New GWP — add a free gift to Models
              </h2>
              <button type="button" aria-label="Close" onClick={onCloseGwp} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} strokeWidth={1.75} /></button>
            </header>
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
              <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 'var(--space-3)' }}>
                Pick the Models, choose the gift, then Add. The gift is appended — a Model can hold several (e.g. 2 pillows + a protector). A <Gift size={11} strokeWidth={1.75} style={{ verticalAlign: 'middle' }} /> marks Models that already have a gift.
              </p>

              {groups.map(({ cat, list }) => {
                const ids = list.map((m) => m.id);
                const allOn = ids.length > 0 && ids.every((id) => bulkSelected.includes(id));
                return (
                  <div key={cat} style={{ marginBottom: 'var(--space-3)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 4 }}>
                      <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>{cat}</span>
                      <button type="button" onClick={() => toggleBulkCategory(cat)} style={{ background: 'transparent', border: 'none', color: 'var(--c-orange)', fontSize: 'var(--fs-11)', cursor: 'pointer', padding: 0 }}>
                        {allOn ? 'clear' : 'select all'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
                      {list.map((m) => {
                        const has = (giftsByModel.get(m.id)?.length ?? 0) > 0;
                        return (
                          <button key={m.id} type="button" onClick={() => toggleBulkModel(m.id)} style={chipStyle(bulkSelected.includes(m.id), false)}>
                            {giftModelLabel(m)}{has && <Gift size={11} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginLeft: 4 }} />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                );
              })}

              <div style={{ marginTop: 'var(--space-2)' }}>
                {bulkDraft.map((g, i) => (
                  <div key={i} style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr auto', gap: 8, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--line)' }}>
                    <select value={g.giftProductId} onChange={(e) => bulkSetRow(i, { giftProductId: e.target.value })} style={inputStyle} aria-label="Gift accessory">
                      <option value="">Choose accessory…</option>
                      {accessories.map((a) => (<option key={a.id} value={a.id}>{a.code} - {a.name}</option>))}
                    </select>
                    <input type="number" min={1} value={g.qty} onChange={(e) => bulkSetRow(i, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} style={{ ...inputStyle, textAlign: 'center' }} aria-label="Quantity" />
                    <input type="text" value={g.campaignName ?? ''} onChange={(e) => bulkSetRow(i, { campaignName: e.target.value })} placeholder="Campaign name (optional)" style={inputStyle} aria-label="Campaign name" />
                    <button type="button" aria-label="Remove gift row" onClick={() => bulkRemoveRow(i)} disabled={bulkDraft.length <= 1} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: bulkDraft.length <= 1 ? 'default' : 'pointer', opacity: bulkDraft.length <= 1 ? 0.4 : 1 }}><X size={14} strokeWidth={1.75} /></button>
                  </div>
                ))}
                <div style={{ marginTop: 'var(--space-2)' }}>
                  <Button variant="ghost" size="md" onClick={bulkAddRow}><Plus size={14} strokeWidth={1.75} style={{ marginRight: 4 }} />Add gift</Button>
                </div>
              </div>

              {bulkError && <div role="alert" style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginTop: 'var(--space-2)' }}>{bulkError}</div>}
            </div>
            <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: 'var(--space-4)', borderTop: '1px solid var(--line)', alignItems: 'center' }}>
              {bulkSelected.length > 0 && <Button variant="ghost" size="md" onClick={() => setBulkSelected([])}>Clear selection</Button>}
              <Button variant="ghost" size="md" onClick={onCloseGwp}>Cancel</Button>
              <Button variant="primary" size="md" disabled={bulkBusy || bulkSelected.length === 0} onClick={() => void applyBulk()}>
                {bulkBusy ? 'Adding…' : `Add to ${bulkSelected.length} Model${bulkSelected.length === 1 ? '' : 's'}`}
              </Button>
            </footer>
          </div>
        </div>
      )}

      {editModelId && (
        <div onClick={() => setEditModelId(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: 'var(--c-cream)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-3)', width: 'min(560px, 95vw)', maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--space-4)', borderBottom: '1px solid var(--line)' }}>
              <h2 style={{ fontSize: 'var(--fs-16)', margin: 0 }}>
                <Gift size={18} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginRight: 6 }} />
                Free gift · {giftModelLabel(models.find((m) => m.id === editModelId) ?? { name: '', model_code: editModelId })}
              </h2>
              <button type="button" aria-label="Close" onClick={() => setEditModelId(null)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={18} strokeWidth={1.75} /></button>
            </header>
            <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
              {draft.length === 0 && <div style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: 'var(--space-5)' }}>No gift configured. Add one below — or save empty to clear.</div>}
              {draft.map((g, i) => (
                <div key={i} style={{ padding: '10px 0', borderBottom: '1px solid var(--line-strong)' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 64px 1fr auto', gap: 8, alignItems: 'center' }}>
                    <select value={g.giftProductId} onChange={(e) => setRow(i, { giftProductId: e.target.value })} style={inputStyle} aria-label="Gift accessory">
                      <option value="">Choose accessory…</option>
                      {accessories.map((a) => (<option key={a.id} value={a.id}>{a.code} - {a.name}</option>))}
                    </select>
                    <input type="number" min={1} value={g.qty} onChange={(e) => setRow(i, { qty: Math.max(1, Math.floor(Number(e.target.value) || 1)) })} style={{ ...inputStyle, textAlign: 'center' }} aria-label="Quantity" />
                    <input type="text" value={g.campaignName ?? ''} onChange={(e) => setRow(i, { campaignName: e.target.value })} placeholder="Campaign name (optional)" style={inputStyle} aria-label="Campaign name" />
                    <button type="button" aria-label="Remove gift row" onClick={() => removeRow(i)} style={{ background: 'transparent', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '6px 8px', cursor: 'pointer' }}><X size={14} strokeWidth={1.75} /></button>
                  </div>
                  {/* Optional size/compartment gate (2026-06-20) — none picked = whole Model. */}
                  {editModel && g.giftProductId && (editModel.category === 'MATTRESS' || editModel.category === 'BEDFRAME' || editModel.category === 'SOFA') && (
                    <div style={{ marginTop: 8, paddingLeft: 2 }}>
                      <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-soft)', marginBottom: 4 }}>Only for (optional):</div>
                      <RuleTargetRefinement
                        category={editModel.category}
                        model={editModel}
                        combos={editModelCombos}
                        value={g.condition ?? { scope: 'model' }}
                        onChange={(ref) => setRow(i, { condition: ref })}
                      />
                    </div>
                  )}
                </div>
              ))}
              <div style={{ marginTop: 'var(--space-4)' }}>
                <Button variant="ghost" size="md" onClick={addRow}><Plus size={14} strokeWidth={1.75} style={{ marginRight: 4 }} />Add gift</Button>
              </div>
              {error && <div role="alert" style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginTop: 'var(--space-3)' }}>{error}</div>}
            </div>
            <footer style={{ display: 'flex', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: 'var(--space-4)', borderTop: '1px solid var(--line)' }}>
              <Button variant="ghost" size="md" onClick={() => setEditModelId(null)}>Cancel</Button>
              <Button variant="primary" size="md" onClick={() => void save()} disabled={upsert.isPending || remove.isPending}>{upsert.isPending || remove.isPending ? 'Saving…' : 'Save'}</Button>
            </footer>
          </div>
        </div>
      )}
    </div>
  );
};

// ─────────────────────────────────────────────────────────────────────────────

type RuleType = 'pwp' | 'promo';

interface Draft {
  id?: string;
  type: RuleType;
  triggerCategory: Cat;
  /** Trigger selection — for a SOFA trigger these are combo ids (mode 'combo') OR
   *  sofa Model ids (mode 'model'); for mattress/bedframe these are Model ids. */
  triggerModelIds: string[];
  /** SOFA trigger match mode. Ignored for non-sofa triggers (always by Model). */
  triggerSofaMode: SofaMode;
  rewardCategory: Cat;
  rewardModelIds: string[];   // models (mattress/bedframe) OR combo ids (sofa reward)
  qty: number;
  active: boolean;
}

const emptyDraft = (type: RuleType = 'pwp'): Draft => ({
  type,
  triggerCategory: 'MATTRESS',
  triggerModelIds: [],
  triggerSofaMode: 'combo',
  rewardCategory: type === 'promo' ? 'MATTRESS' : 'BEDFRAME',
  rewardModelIds: [],
  qty: 1,
  active: true,
});

const ICON = { size: 14, strokeWidth: 1.75 } as const;

export const PwpRulesTab = ({ mode }: { mode: Mode }) => {
  const canEdit = mode === 'full';

  const rulesQ = usePwpRules();
  const mattressQ = useProductModels({ category: 'MATTRESS' });
  const bedframeQ = useProductModels({ category: 'BEDFRAME' });
  const sofaQ = useProductModels({ category: 'SOFA' });   // by-Model sofa trigger
  const combosQ = useSofaCombos({ customerId: null });
  const create = useCreatePwpRule();
  const update = useUpdatePwpRule();
  const del = useDeletePwpRule();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [gwpOpen, setGwpOpen] = useState(false);

  // Selectable items for a category: {id,label}. SOFA → combos, or sofa Models
  // when the trigger is in 'model' mode; mattress/bedframe → models.
  const itemsFor = (cat: Cat, sofaMode: SofaMode = 'combo'): { id: string; label: string }[] => {
    if (cat === 'SOFA') {
      if (sofaMode === 'model') return (sofaQ.data ?? []).map((m) => ({ id: m.id, label: modelLabel(m) }));
      return (combosQ.data ?? []).map((c) => ({ id: c.id, label: comboLabel(c) }));
    }
    const rows = (cat === 'MATTRESS' ? mattressQ.data : bedframeQ.data) ?? [];
    return rows.map((m) => ({ id: m.id, label: modelLabel(m) }));
  };
  const loadingFor = (cat: Cat, sofaMode: SofaMode = 'combo'): boolean =>
    cat === 'SOFA'
      ? (sofaMode === 'model' ? sofaQ.isLoading : combosQ.isLoading)
      : cat === 'MATTRESS' ? mattressQ.isLoading : bedframeQ.isLoading;

  // id → label across models + combos, for the rule cards. Sofa Models included
  // so a by-Model sofa trigger renders its Model names (not raw ids).
  const labelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const row of [...(mattressQ.data ?? []), ...(bedframeQ.data ?? []), ...(sofaQ.data ?? [])]) m.set(row.id, modelLabel(row));
    for (const c of combosQ.data ?? []) m.set(c.id, comboLabel(c));
    return m;
  }, [mattressQ.data, bedframeQ.data, sofaQ.data, combosQ.data]);

  const catLabel = (c: string) => CATEGORIES.find((x) => x.value === c)?.label ?? c;
  const itemSummary = (ids: string[], cat: string) =>
    ids.length === 0 ? `Any ${catLabel(cat)}` : ids.map((id) => labelById.get(id) ?? id).join(', ');

  const busy = create.isPending || update.isPending || del.isPending;

  const openNew = (type: RuleType = 'pwp') => { setError(null); setDraft(emptyDraft(type)); };
  const openEdit = (r: PwpRuleRow) => {
    setError(null);
    const tCat = (r.triggerCategory as Cat) ?? 'MATTRESS';
    const rCat = (r.rewardCategory as Cat) ?? 'BEDFRAME';
    const tSofaMode: SofaMode = sofaTriggerByModel(r) ? 'model' : 'combo';
    setDraft({
      id: r.id,
      type: (r.type as RuleType) ?? 'pwp',
      triggerCategory: tCat,
      // SOFA stores combo ids (by Combo) OR sofa Model ids (by Model); other
      // categories store model ids.
      triggerModelIds: tCat === 'SOFA' ? (tSofaMode === 'model' ? r.triggerEligibleModelIds : r.triggerComboIds) : r.triggerEligibleModelIds,
      triggerSofaMode: tSofaMode,
      rewardCategory: rCat,
      rewardModelIds: rCat === 'SOFA' ? r.rewardComboIds : r.eligibleRewardModelIds,
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
    // A sofa trigger needs an explicit selection — "any sofa" has no meaning
    // (by Combo needs combos; by Model needs Models — empty ≠ "every sofa").
    if (draft.triggerCategory === 'SOFA' && draft.triggerModelIds.length === 0) {
      setError(draft.triggerSofaMode === 'model'
        ? 'Pick at least one trigger Model — any build of it will qualify.'
        : 'Pick at least one trigger combo for a sofa trigger.');
      return;
    }
    // Reward sofa is by Combo only (by-Model sofa reward is out of scope).
    if (draft.rewardCategory === 'SOFA' && draft.rewardModelIds.length === 0) {
      setError('Pick at least one reward combo for a sofa reward.');
      return;
    }
    // Route the selected ids to the right columns. SOFA trigger: by Combo →
    // triggerComboIds; by Model → triggerEligibleModelIds (mutually exclusive, the
    // server's reserve/recompute derive the mode from which array is populated).
    // SOFA reward: always combos. Mattress/bedframe: model ids.
    const trigByModel = draft.triggerCategory === 'SOFA' && draft.triggerSofaMode === 'model';
    const trigByCombo = draft.triggerCategory === 'SOFA' && draft.triggerSofaMode === 'combo';
    const body = {
      triggerCategory: draft.triggerCategory,
      triggerEligibleModelIds: draft.triggerCategory !== 'SOFA' || trigByModel ? draft.triggerModelIds : [],
      triggerComboIds: trigByCombo ? draft.triggerModelIds : [],
      rewardCategory: draft.rewardCategory,
      eligibleRewardModelIds: draft.rewardCategory === 'SOFA' ? [] : draft.rewardModelIds,
      rewardComboIds: draft.rewardCategory === 'SOFA' ? draft.rewardModelIds : [],
      qtyPerTrigger: draft.qty,
      type: draft.type,
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
    const ChipRow = ({ cat, sofaMode = 'combo', selected, onToggle }: { cat: Cat; sofaMode?: SofaMode; selected: string[]; onToggle: (id: string) => void }) => {
      const items = itemsFor(cat, sofaMode);
      const noun = cat === 'SOFA' ? (sofaMode === 'model' ? 'sofa models' : 'combos') : 'models';
      if (loadingFor(cat, sofaMode)) return <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>Loading {noun}…</div>;
      if (items.length === 0) return <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>No {catLabel(cat)} {noun} yet.</div>;
      return (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {items.map((it) => (
              <button key={it.id} type="button" disabled={!canEdit} onClick={() => onToggle(it.id)} style={chipStyle(selected.includes(it.id), !canEdit)}>
                {it.label}
              </button>
            ))}
          </div>
          {selected.length === 0 && (
            <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 'var(--space-2)' }}>
              {cat === 'SOFA'
                ? (sofaMode === 'model'
                    ? 'Pick at least one sofa Model — any build of it will trigger the offer.'
                    : 'Pick at least one combo — a by-Combo sofa rule needs explicit combos.')
                : `Nothing selected → every ${catLabel(cat)} qualifies.`}
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
      </div>
    );

    return (
      <div style={{ padding: 'var(--space-5)', maxWidth: 760 }}>
        <h2 style={{ fontSize: 'var(--fs-18)', marginBottom: 'var(--space-1)' }}>
          {draft.id ? 'Edit' : 'New'} {draft.type === 'promo' ? 'Promo' : 'PWP'} rule
        </h2>
        <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginBottom: 'var(--space-5)' }}>
          Choose what the customer must buy (Trigger), what they can then redeem (Reward), and the ratio.
          Set each reward’s price in the SKU Master “PWP Price” column.{draft.type === 'promo'
            ? ' For a Promo, leaving that price at RM 0 redeems the reward free.'
            : ' A PWP reward needs a price greater than 0.'}
        </p>

        <div style={{ marginBottom: 'var(--space-5)' }}>
          <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>Kind</span>
          <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
            {([['pwp', 'PWP — redeem at a set price'], ['promo', 'Promo — may redeem free (RM 0)']] as [RuleType, string][]).map(([v, lbl]) => (
              <button key={v} type="button" disabled={!canEdit} onClick={() => setDraft({ ...draft, type: v })} style={chipStyle(draft.type === v, !canEdit)}>
                {lbl}
              </button>
            ))}
          </div>
        </div>

        <div style={{ marginBottom: 'var(--space-5)' }}>
          <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 'var(--space-2)' }}>1 · Trigger — what unlocks the offer</span>
          <CatPicker value={draft.triggerCategory} onChange={(c) => setDraft({ ...draft, triggerCategory: c, triggerModelIds: [], triggerSofaMode: 'combo' })} />
          {draft.triggerCategory === 'SOFA' && (
            <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-3)' }}>
              {([['combo', 'By Combo'], ['model', 'By Model — any build']] as [SofaMode, string][]).map(([v, lbl]) => (
                <button key={v} type="button" disabled={!canEdit} onClick={() => setDraft({ ...draft, triggerSofaMode: v, triggerModelIds: [] })} style={chipStyle(draft.triggerSofaMode === v, !canEdit)}>
                  {lbl}
                </button>
              ))}
            </div>
          )}
          <ChipRow cat={draft.triggerCategory} sofaMode={draft.triggerSofaMode} selected={draft.triggerModelIds} onToggle={(id) => setDraft({ ...draft, triggerModelIds: draft.triggerModelIds.includes(id) ? draft.triggerModelIds.filter((x) => x !== id) : [...draft.triggerModelIds, id] })} />
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
          Each rule lets a customer who buys a qualifying <b>Trigger</b> redeem a <b>Reward</b>, at the chosen
          ratio. A <b>PWP</b> redeems at the reward’s PWP price (set in the SKU Master “PWP Price” column); a
          <b> Promo</b> works the same but may redeem free (RM 0). Changes apply to new orders only.
        </p>
        {canEdit && (
          <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>
            <Button variant="primary" onClick={() => openNew('pwp')}><Plus {...ICON} /> New PWP</Button>
            <Button variant="secondary" onClick={() => openNew('promo')}><Plus {...ICON} /> New Promo</Button>
            <Button variant="secondary" onClick={() => setGwpOpen(true)}><Plus {...ICON} /> New GWP</Button>
          </div>
        )}
      </div>

      <FreeGiftSection canEdit={canEdit} gwpOpen={gwpOpen} onCloseGwp={() => setGwpOpen(false)} />
      <FreeItemCampaignSection canEdit={canEdit} />

      {rules.length === 0 ? (
        <div style={{ padding: 'var(--space-7)', textAlign: 'center', color: 'var(--fg-muted)', border: '1px dashed var(--line-strong)', borderRadius: 'var(--radius-md)' }}>
          No PWP or Promo rules yet.{canEdit ? ' Click “New PWP” or “New Promo” to create one.' : ''}
        </div>
      ) : (
        <>
          {(['pwp', 'promo'] as RuleType[]).map((kind) => {
            const group = rules.filter((r) => ((r.type as RuleType) ?? 'pwp') === kind);
            if (group.length === 0) return null;
            return (
              <div key={kind} style={{ marginBottom: 'var(--space-5)' }}>
                <h3 style={{ fontSize: 'var(--fs-13)', fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-3)' }}>
                  {kind === 'promo' ? 'Promo — may redeem free' : 'PWP — redeem at a set price'}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
                  {group.map((r) => (
                    <div key={r.id} style={{ background: 'var(--c-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-2)', padding: 'var(--space-4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 'var(--space-4)', opacity: r.active ? 1 : 0.55 }}>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 'var(--fs-12)', fontWeight: 600, color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 'var(--space-2)' }}>
                          {kind === 'promo' ? 'Promo · redeem free' : 'PWP · redeem at a set price'}
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
                          <div style={{ fontSize: 'var(--fs-13)' }}>
                            <span style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontSize: 'var(--fs-12)' }}>Trigger · {r.triggerCategory === 'SOFA' ? (sofaTriggerByModel(r) ? 'Sofa (by Model)' : 'Sofa (by Combo)') : catLabel(r.triggerCategory)}</span>
                            <div style={{ fontWeight: 600, fontSize: 'var(--fs-14)' }}>{itemSummary(r.triggerCategory === 'SOFA' ? (sofaTriggerByModel(r) ? r.triggerEligibleModelIds : r.triggerComboIds) : r.triggerEligibleModelIds, r.triggerCategory)}</div>
                          </div>
                          <ArrowDown size={14} strokeWidth={1.75} style={{ color: 'var(--fg-muted)' }} />
                          <div style={{ fontSize: 'var(--fs-13)' }}>
                            <span style={{ color: 'var(--fg-muted)', textTransform: 'uppercase', letterSpacing: '0.03em', fontSize: 'var(--fs-12)' }}>Reward · {r.rewardCategory === 'SOFA' ? 'Sofa (by Combo)' : catLabel(r.rewardCategory)}</span>
                            <div style={{ fontWeight: 600, fontSize: 'var(--fs-14)' }}>{itemSummary(r.rewardCategory === 'SOFA' ? r.rewardComboIds : r.eligibleRewardModelIds, r.rewardCategory)}</div>
                          </div>
                        </div>
                        <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-soft)', marginTop: 'var(--space-3)' }}>
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
              </div>
            );
          })}
        </>
      )}

      {error && <div style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginTop: 'var(--space-3)' }} role="alert">{error}</div>}
      {!canEdit && <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginTop: 'var(--space-4)' }}>Read-only — only Master Admin can change PWP rules.</div>}
    </div>
  );
};
