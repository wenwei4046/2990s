// ----------------------------------------------------------------------------
// SofaComboTab — Sofa Combo Pricing UI.
//
// Commander 2026-05-28 ("去查看 hookka 的 combo module 把整个 copy 过来").
// Ported from HOOKKA's combo module spec — built fresh from the UI screenshot
// + commander's pricing-role + height-tier decisions.
//
// 2026-05-28 update — commander dropped customer scoping for 2990's B2C model
// ("2990 是不需要的。因为是 B2C 直接 apply 给全顾客的"). Removed:
//   · Copy-to-customer button + modal + API endpoint
//   · Customer filter dropdown
//   · Customer picker in New Combo modal (always null = applies to all)
//   · Customer chip on combo cards
// The DB column `customer_id` stays for future optionality but the UI never
// writes to it; every combo persists with customer_id = null.
//
// Layout:
//   header   — "Sofa Combo Pricing" + subtitle + "+ New Combo"
//   filters  — Base model dropdown + "N rules"
//   list     — grouped by base model; each combo card has the module
//              composition + tier + per-seat-height prices + Effective date
//              + Edit/History/Delete actions.
// ----------------------------------------------------------------------------

import { useMemo, useState, type CSSProperties } from 'react';
import { Plus, Pencil, Trash2, History, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { SOFA_MODULES, type SofaPriceTier, buildComboLabel } from '@2990s/shared';
import {
  useSofaCombos,
  useCreateSofaCombo,
  useUpdateSofaCombo,
  useDeleteSofaCombo,
  useSofaComboHistory,
  type SofaComboRule,
} from '../../lib/products/sofa-combos-queries';
import { useMfgProducts, useMaintenanceConfig } from '../../lib/products/mfg-products-queries';

// Seat-height columns mirror the live Maintenance pool (Products → Maintenance
// → Sofa → Sizes; config key `sofaSizes`). This fallback only shows if that
// config fails to load — same default the rest of the app uses.
const HEIGHTS_FALLBACK = ['24', '26', '28', '30', '32', '35'];
const TIERS: SofaPriceTier[] = ['PRICE_1', 'PRICE_2', 'PRICE_3'];

const ICON_PROPS = { size: 14, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null | undefined): string => {
  if (centi == null) return '—';
  return `RM ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const fmtDate = (iso: string): string => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return iso;
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
};

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const ALL_MODULE_CODES = SOFA_MODULES.map((m) => m.id).sort();

type ComboMode = 'view' | 'add-only' | 'full';

type ComboTabProps = {
  /** POS port: lock write affordances when the viewer is sales-side
   *  (sales / sales_executive / outlet_manager). Combo rules remain
   *  visible — useful for confirming the price the configurator quoted —
   *  but New Combo / Edit / Delete buttons hide. Legacy prop. */
  readonly?: boolean;
  /** Commander 2026-05-28 three-tier role gate. Overrides `readonly`
   *  when supplied. 'view' = no writes; 'add-only' = + New Combo only,
   *  no edit/delete on existing cards; 'full' = identical to Backend. */
  mode?: ComboMode;
};

export const SofaComboTab = ({ readonly = false, mode }: ComboTabProps) => {
  // Resolve effective mode. Caller-supplied `mode` wins.
  const effectiveMode: ComboMode =
    mode ?? (readonly ? 'view' : 'full');
  const canAdd  = effectiveMode !== 'view';
  const canEdit = effectiveMode === 'full';
  const [baseModelFilter, setBaseModelFilter] = useState<string>('');
  const [composer, setComposer] = useState<{ open: boolean; editing?: SofaComboRule }>({ open: false });
  const [historyFor, setHistoryFor] = useState<SofaComboRule | null>(null);

  // Default scope: customer_id = null (applies to all). 2990 is B2C, so we
  // never let the UI write a customer_id.
  const combosQ = useSofaCombos({
    baseModel: baseModelFilter || undefined,
    customerId: null,
  });
  const productsQ = useMfgProducts({ category: 'SOFA' });
  // Seat-height columns = the live Maintenance Sizes pool (single source of
  // truth), so a size added in Maintenance shows up here automatically.
  const heightsCfgQ = useMaintenanceConfig('master');
  const heights = heightsCfgQ.data?.data?.sofaSizes ?? HEIGHTS_FALLBACK;

  const baseModels = useMemo(() => {
    const set = new Set<string>();
    for (const p of productsQ.data ?? []) {
      const bm = (p as unknown as { base_model?: string | null }).base_model;
      if (bm) set.add(bm);
    }
    for (const r of combosQ.data ?? []) set.add(r.baseModel);
    return [...set].sort();
  }, [productsQ.data, combosQ.data]);

  const grouped = useMemo(() => {
    const map = new Map<string, SofaComboRule[]>();
    for (const r of combosQ.data ?? []) {
      const arr = map.get(r.baseModel) ?? [];
      arr.push(r);
      map.set(r.baseModel, arr);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [combosQ.data]);

  const total = combosQ.data?.length ?? 0;

  const deleteM = useDeleteSofaCombo();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: '8px 0' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <h2 style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'var(--fs-22)',
            color: 'var(--c-ink)',
            margin: 0,
          }}>
            Sofa Combo Pricing
          </h2>
          <p style={{
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--fs-13)',
            color: 'var(--fg-soft)',
            margin: '4px 0 0',
            maxWidth: 720,
          }}>
            Module-set combo deals with optional same-fabric-tier discount.
            Append-only history; edits = a new row with a fresher effective date.
            All combos apply to every customer (2990 B2C model).
          </p>
        </div>
        {canAdd && (
          <Button variant="primary" onClick={() => setComposer({ open: true })}>
            <Plus {...ICON_PROPS} style={{ marginRight: 6 }} /> New Combo
          </Button>
        )}
      </div>

      {/* Filters */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px',
        background: 'var(--c-paper)', borderRadius: 'var(--radius-md)',
        border: '1px solid var(--line)',
      }}>
        <select
          value={baseModelFilter}
          onChange={(e) => setBaseModelFilter(e.target.value)}
          style={selectStyle}
        >
          <option value="">All base models</option>
          {baseModels.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
        <div style={{ flex: 1 }} />
        <span style={{
          fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)', color: 'var(--fg-soft)',
        }}>
          {total} {total === 1 ? 'rule' : 'rules'}
        </span>
      </div>

      {/* List */}
      {combosQ.isLoading ? (
        <p style={{ color: 'var(--fg-muted)' }}>Loading…</p>
      ) : grouped.length === 0 ? (
        <div style={{
          padding: 24, textAlign: 'center',
          background: 'var(--c-paper)', borderRadius: 'var(--radius-md)',
          border: '1px dashed var(--line)',
          color: 'var(--fg-muted)',
        }}>
          {canAdd
            ? <>No combo rules yet. Click <strong>+ New Combo</strong> to create one.</>
            : 'No combo rules yet.'}
        </div>
      ) : (
        grouped.map(([model, rules]) => (
          <section key={model} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-15)',
              fontWeight: 600,
              color: 'var(--c-ink)',
              margin: 0,
              padding: '4px 0',
            }}>
              {model} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>({rules.length} combo{rules.length !== 1 ? 's' : ''})</span>
            </h3>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(380px, 1fr))',
              gap: 12,
            }}>
              {rules.map((r) => (
                <ComboCard
                  key={r.id}
                  rule={r}
                  heights={heights}
                  /* canEdit gates Edit + Delete on existing cards. add-only
                     viewers see the card but no per-card edit affordances. */
                  canEdit={canEdit}
                  onEdit={() => setComposer({ open: true, editing: r })}
                  onHistory={() => setHistoryFor(r)}
                  onDelete={() => {
                    if (confirm('Soft-delete this combo? (History will still show it.)')) {
                      deleteM.mutate(r.id);
                    }
                  }}
                />
              ))}
            </div>
          </section>
        ))
      )}

      {composer.open && (
        <ComposerModal
          editing={composer.editing}
          baseModels={baseModels}
          heights={heights}
          onClose={() => setComposer({ open: false })}
        />
      )}

      {historyFor && (
        <HistoryModal rule={historyFor} heights={heights} onClose={() => setHistoryFor(null)} />
      )}
    </div>
  );
};

// ─── Combo card ────────────────────────────────────────────────────────

function ComboCard({
  rule, heights, onEdit, onHistory, onDelete, canEdit = true,
}: {
  rule: SofaComboRule;
  heights: string[];
  onEdit: () => void;
  onHistory: () => void;
  onDelete: () => void;
  /** Show Edit + Delete on this card (admin/full only). add-only +
      view roles see the card but only History button. */
  canEdit?: boolean;
}) {
  const label = rule.label || buildComboLabel(rule.modules);
  const isActive = rule.effectiveFrom <= todayIso();
  return (
    <div style={{
      background: 'var(--c-paper)',
      border: '1px solid var(--line)',
      borderRadius: 'var(--radius-md)',
      padding: 12,
      display: 'flex',
      flexDirection: 'column',
      gap: 8,
    }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
        <span style={chipStyleStrong}>{rule.baseModel}</span>
        <span style={{
          flex: 1,
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-13)',
          fontWeight: 500,
          color: 'var(--c-ink)',
        }}>
          {label}
        </span>
        {rule.tier && <span style={chipStyleSoft}>{rule.tier}</span>}
        {canEdit && (
          <button
            type="button"
            onClick={onDelete}
            title="Soft-delete"
            style={iconBtnStyle}
          >
            <Trash2 size={14} strokeWidth={1.75} />
          </button>
        )}
      </div>

      {/* Height tiers */}
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${heights.length}, 1fr)`, gap: 4 }}>
        {heights.map((h) => {
          const v = rule.pricesByHeight?.[h];
          return (
            <div key={h} style={{
              padding: '4px 6px',
              background: 'var(--c-cream)',
              borderRadius: 'var(--radius-sm)',
              textAlign: 'center',
            }}>
              <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                {h}
              </div>
              <div style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-12)',
                fontWeight: 600,
                color: v == null ? 'var(--fg-muted)' : 'var(--c-ink)',
              }}>
                {fmtRm(v ?? null)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', color: 'var(--fg-soft)' }}>
          Effective {fmtDate(rule.effectiveFrom)}
        </span>
        <span style={isActive ? statusPillActive : statusPillPending}>
          {isActive ? 'Active' : 'Pending'}
        </span>
        <div style={{ flex: 1 }} />
        {canEdit && (
          <button type="button" onClick={onEdit} style={ghostBtnStyle}>
            <Pencil size={12} strokeWidth={1.75} /> Edit
          </button>
        )}
        <button type="button" onClick={onHistory} style={ghostBtnStyle}>
          <History size={12} strokeWidth={1.75} /> History
        </button>
      </div>
    </div>
  );
}

// ─── Composer modal (New / Edit) ──────────────────────────────────────

function ComposerModal({
  editing, baseModels, heights, onClose,
}: {
  editing?: SofaComboRule;
  baseModels: string[];
  heights: string[];
  onClose: () => void;
}) {
  const create = useCreateSofaCombo();
  const update = useUpdateSofaCombo();

  const [baseModel, setBaseModel] = useState(editing?.baseModel ?? '');
  // OR-set per slot (PR combo-or-per-slot): ordered slots, each a SET of
  // alternative codes joined by OR. e.g. [['2A-LHF','2A-RHF'],['L-LHF','L-RHF']].
  const [modules, setModules] = useState<string[][]>(editing?.modules ?? []);
  const [tier, setTier] = useState<SofaPriceTier | ''>(editing?.tier ?? 'PRICE_2');
  const [label, setLabel] = useState(editing?.label ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(editing?.effectiveFrom ?? todayIso());
  const [prices, setPrices] = useState<Record<string, string>>(() => {
    const seed: Record<string, string> = {};
    for (const h of heights) {
      const v = editing?.pricesByHeight?.[h];
      seed[h] = v == null ? '' : (v / 100).toFixed(2);
    }
    return seed;
  });
  const [notes, setNotes] = useState(editing?.notes ?? '');

  // Ordered positional slots (Hookka-style), each an OR-set of codes. A slot
  // toggles codes on/off; matching is set-cover + exact count. Empty slots are
  // dropped on save.
  const toggleSlotCode = (idx: number, code: string) => {
    setModules((cur) =>
      cur.map((slot, i) =>
        i === idx
          ? (slot.includes(code) ? slot.filter((c) => c !== code) : [...slot, code])
          : slot,
      ),
    );
  };
  const addSlot = () => setModules((cur) => [...cur, []]);
  const removeSlot = (idx: number) => setModules((cur) => cur.filter((_, i) => i !== idx));

  const submit = async () => {
    if (!baseModel) return alert('Base model is required.');
    const orderedModules = modules
      .map((slot) => [...new Set(slot.map((c) => c.trim()).filter(Boolean))])
      .filter((slot) => slot.length > 0);
    if (orderedModules.length === 0) return alert('Add at least one module slot.');

    const pricesByHeight: Record<string, number | null> = {};
    for (const h of heights) {
      const raw = (prices[h] ?? '').trim();
      if (!raw) pricesByHeight[h] = null;
      else {
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) return alert(`Bad price at ${h}".`);
        pricesByHeight[h] = Math.round(n * 100);
      }
    }

    try {
      if (editing) {
        await update.mutateAsync({
          id: editing.id,
          pricesByHeight,
          label: label || null,
          effectiveFrom,
          notes: notes || null,
        });
      } else {
        await create.mutateAsync({
          baseModel,
          modules: orderedModules,
          tier: tier || null,
          customerId: null,  // B2C: always null = applies to all customers
          pricesByHeight,
          label: label || null,
          effectiveFrom,
          notes: notes || null,
        });
      }
      onClose();
    } catch (e) {
      alert(`Save failed: ${String(e)}`);
    }
  };

  return (
    <ModalShell title={editing ? 'Edit combo' : 'New combo'} onClose={onClose}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <Field label="Base model">
          {editing ? (
            <input value={baseModel} readOnly style={readonlyInputStyle} />
          ) : (
            <input
              list="base-model-list"
              value={baseModel}
              onChange={(e) => setBaseModel(e.target.value)}
              placeholder="e.g. 5530"
              style={inputStyle}
            />
          )}
          <datalist id="base-model-list">
            {baseModels.map((m) => <option key={m} value={m} />)}
          </datalist>
        </Field>

        <Field label={`Modules (${modules.filter((s) => s.some((c) => c.trim())).length} slot${modules.length === 1 ? '' : 's'})`}>
          {editing ? (
            <div style={{ ...readonlyInputStyle, padding: 8 }}>
              {buildComboLabel(modules) || '—'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{
                fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-11)',
                color: 'var(--fg-muted)', padding: '2px 0',
              }}>
                Each slot is an OR-set — tick every module that may fill it
                (e.g. <strong>1A-LHF</strong> OR <strong>1A-RHF</strong>). A built
                sofa matches when each piece fills a distinct slot and the piece
                count equals the slot count.
              </div>
              {modules.length === 0 ? (
                <div style={{
                  fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)',
                  color: 'var(--fg-muted)', padding: '2px 0',
                }}>
                  No slots yet — add the first one.
                </div>
              ) : (
                modules.map((slot, idx) => (
                  <div key={idx} style={{
                    display: 'flex', flexDirection: 'column', gap: 4,
                    padding: 8, border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)', background: 'var(--c-cream)',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={slotNumberStyle}>Module {idx + 1}</span>
                      <span style={{
                        flex: 1, fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)',
                        color: slot.length ? 'var(--c-ink)' : 'var(--fg-muted)',
                      }}>
                        {slot.length ? slot.join(' / ') : 'pick one or more (OR)'}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeSlot(idx)}
                        title={`Remove Module ${idx + 1}`}
                        style={iconBtnStyle}
                      >
                        <X size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                      {ALL_MODULE_CODES.map((c) => {
                        const on = slot.includes(c);
                        return (
                          <button
                            type="button"
                            key={c}
                            onClick={() => toggleSlotCode(idx, c)}
                            style={on ? moduleChipOn : moduleChipOff}
                          >
                            {c}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))
              )}
              <div>
                <Button variant="ghost" onClick={addSlot}>
                  <Plus {...ICON_PROPS} style={{ marginRight: 6 }} /> Add Module
                </Button>
              </div>
            </div>
          )}
        </Field>

        <Field label="Tier">
          <select
            value={tier}
            onChange={(e) => setTier(e.target.value as SofaPriceTier | '')}
            style={selectStyle}
            disabled={!!editing}
          >
            <option value="">— Any —</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>

        <Field label="Prices by seat height (RM)">
          <div style={{ display: 'grid', gridTemplateColumns: `repeat(${heights.length}, 1fr)`, gap: 8 }}>
            {heights.map((h) => (
              <div key={h}>
                <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)', textAlign: 'center' }}>{h}{/^\d/.test(h) ? '"' : ''}</div>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={prices[h] ?? ''}
                  onChange={(e) => setPrices((cur) => ({ ...cur, [h]: e.target.value }))}
                  placeholder="—"
                  style={{ ...inputStyle, textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                />
              </div>
            ))}
          </div>
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <Field label="Effective from">
            <input
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              style={inputStyle}
            />
          </Field>
          <Field label="Label (optional)">
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="(auto: from modules)"
              style={inputStyle}
            />
          </Field>
        </div>

        <Field label="Notes (optional)">
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </Field>

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={create.isPending || update.isPending}>
            {(create.isPending || update.isPending) ? 'Saving…' : (editing ? 'Save new effective row' : 'Create combo')}
          </Button>
        </div>
      </div>
    </ModalShell>
  );
}

// ─── History modal ────────────────────────────────────────────────────

function HistoryModal({ rule, heights, onClose }: { rule: SofaComboRule; heights: string[]; onClose: () => void }) {
  const historyQ = useSofaComboHistory({
    baseModel: rule.baseModel,
    modules: rule.modules,
    tier: rule.tier,
    customerId: rule.customerId,
  });

  return (
    <ModalShell title="Combo history" onClose={onClose}>
      <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)', color: 'var(--fg-soft)' }}>
        {rule.baseModel} · {buildComboLabel(rule.modules)}{rule.tier ? ` · ${rule.tier}` : ''}
      </div>
      {historyQ.isLoading ? <p>Loading…</p> : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {(historyQ.data ?? []).map((r) => (
            <div key={r.id} style={{
              padding: 10, background: 'var(--c-cream)', borderRadius: 'var(--radius-sm)',
              border: '1px solid var(--line)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <strong>Effective {fmtDate(r.effectiveFrom)}</strong>
                {r.deletedAt && <span style={statusPillPending}>Deleted</span>}
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${heights.length}, 1fr)`, gap: 4, marginTop: 6 }}>
                {heights.map((h) => (
                  <div key={h} style={{ textAlign: 'center' }}>
                    <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>{h}</div>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>
                      {fmtRm(r.pricesByHeight?.[h] ?? null)}
                    </div>
                  </div>
                ))}
              </div>
              {r.notes && (
                <div style={{ marginTop: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-soft)' }}>
                  {r.notes}
                </div>
              )}
            </div>
          ))}
          {historyQ.data && historyQ.data.length === 0 && (
            <p style={{ color: 'var(--fg-muted)' }}>No history rows.</p>
          )}
        </div>
      )}
    </ModalShell>
  );
}

// ─── Small primitives ─────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-11)',
        fontWeight: 600,
        textTransform: 'uppercase',
        letterSpacing: 1,
        color: 'var(--fg-soft)',
      }}>
        {label}
      </span>
      {children}
    </label>
  );
}

function ModalShell({
  title, onClose, children,
}: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      padding: '5vh 16px', zIndex: 1000, overflowY: 'auto',
    }} onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} style={{
        background: 'var(--c-paper)', borderRadius: 'var(--radius-md)',
        padding: 20, width: '100%', maxWidth: 720,
        display: 'flex', flexDirection: 'column', gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <h3 style={{ margin: 0, fontFamily: 'var(--font-display)', fontSize: 'var(--fs-18)' }}>
            {title}
          </h3>
          <button type="button" onClick={onClose} style={iconBtnStyle}>
            <X size={16} strokeWidth={1.75} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

const selectStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-13)',
  background: 'var(--c-cream)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 10px',
  outline: 'none',
};

const inputStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-13)',
  background: 'var(--c-cream)',
  border: '1px solid var(--line-strong)',
  borderRadius: 'var(--radius-sm)',
  padding: '6px 8px',
  outline: 'none',
  width: '100%',
};

const readonlyInputStyle: CSSProperties = {
  ...inputStyle,
  background: 'var(--c-paper)',
  color: 'var(--fg-soft)',
  cursor: 'not-allowed',
};

const chipStyleStrong: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-12)',
  fontWeight: 600,
  background: 'var(--c-cream)',
  color: 'var(--c-ink)',
  padding: '2px 8px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line-strong)',
};

const chipStyleSoft: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-11)',
  background: 'var(--c-cream)',
  color: 'var(--fg-soft)',
  padding: '2px 6px',
  borderRadius: 'var(--radius-sm)',
  border: '1px solid var(--line)',
};

const statusPillActive: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-11)',
  fontWeight: 600,
  background: 'var(--c-mint, #d4edda)',
  color: 'var(--c-green, #1a7a3a)',
  padding: '2px 8px',
  borderRadius: 'var(--radius-pill, 999px)',
};

const statusPillPending: CSSProperties = {
  ...statusPillActive,
  background: 'var(--c-paper)',
  color: 'var(--fg-soft)',
  border: '1px solid var(--line)',
};

const iconBtnStyle: CSSProperties = {
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  color: 'var(--fg-soft)',
  padding: 4,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: 'var(--radius-sm)',
};

const ghostBtnStyle: CSSProperties = {
  background: 'transparent',
  border: '1px solid var(--line)',
  borderRadius: 'var(--radius-sm)',
  padding: '4px 8px',
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-12)',
  color: 'var(--fg-soft)',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
};

const slotNumberStyle: CSSProperties = {
  fontFamily: 'var(--font-sans)',
  fontSize: 'var(--fs-11)',
  fontWeight: 600,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'var(--fg-soft)',
  minWidth: 72,
  flexShrink: 0,
};

const moduleChipOn: CSSProperties = {
  fontFamily: 'var(--font-mono)',
  fontSize: 'var(--fs-11)',
  fontWeight: 600,
  background: 'var(--c-orange, #c47b2f)',
  color: 'var(--c-paper, #fff)',
  border: '1px solid var(--c-orange, #c47b2f)',
  borderRadius: 'var(--radius-sm)',
  padding: '2px 8px',
  cursor: 'pointer',
};

const moduleChipOff: CSSProperties = {
  ...moduleChipOn,
  background: 'var(--c-paper)',
  color: 'var(--c-ink)',
  border: '1px solid var(--line-strong)',
};
