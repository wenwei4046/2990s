// ----------------------------------------------------------------------------
// SoLineItemModal — shared line-item editor used by /mfg-sales-orders/new
// (PR #114) and (TBD) /mfg-sales-orders/:docNo detail.
//
// Commander 2026-05-26: "每个 category 弹出不同的字段：
//   Mattress: 选 size 就够了
//   Sofa:     color code · fabric code · divan · 沙发尺寸 · seat height · special orders
//   Bedframe: divan · leg · gap · total height · specials
//   Accessory / Others: 普通文字
// 这个需要从 maintenance api 过来"
//
// Pulls all dropdown options from useMaintenanceConfig (Maintenance > Bedframe
// Heights / Gaps / Leg Heights / Specials / Sofa Sizes / Sofa Legs / Sofa
// Specials / Mattress Sizes) + useFabricTrackings (fabric_code dropdown for
// sofa). Mattress thickness comes from product_models.allowed_options when
// the picked SKU has a model_id.
//
// Workflow:
//   1. Search → pick a product (mfg_products row)
//   2. itemGroup auto-derives from product.category
//   3. Category-specific variant editor unfolds below
//   4. Unit price auto-recomputes from base + variant surcharges
//      (commander can manually override; auto-recompute stops)
//   5. Submit → returns LinePayload to caller, caller decides whether to
//      POST (detail page) or stash in local draft state (new-SO page)
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useMfgProducts, useMaintenanceConfig, type MfgProductRow } from '../lib/mfg-products-queries';
import { useFabricTrackings } from '../lib/fabric-queries';
import styles from '../pages/SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

/** PR #114 — payload returned to the caller when the modal commits. Matches
 *  the shape both the SO create POST body and the SO detail PATCH endpoint
 *  expect for items. */
export type SoLineDraft = {
  itemCode:       string;
  itemGroup:      string;        // 'sofa' | 'bedframe' | 'mattress' | 'accessory' | 'others'
  description:    string;
  uom:            string;
  qty:            number;
  unitPriceCenti: number;
  discountCenti:  number;
  unitCostCenti:  number;
  variants:       Record<string, unknown>;
  remark:         string;
};

export const SoLineItemModal = ({
  initial,
  onClose,
  onSubmit,
  saving = false,
}: {
  initial:  SoLineDraft | null;
  onClose:  () => void;
  onSubmit: (line: SoLineDraft) => void;
  saving?:  boolean;
}) => {
  const maintQ   = useMaintenanceConfig('master');
  const maint    = maintQ.data?.data ?? null;
  const fabricsQ = useFabricTrackings();
  const fabrics  = fabricsQ.data ?? [];

  const [search, setSearch] = useState(initial?.itemCode ?? '');
  const productsQuery = useMfgProducts({ search: search.trim() || undefined });
  const candidates = productsQuery.data ?? [];

  // PR #39 / #114 — track the FULL picked product so we can read
  // seat_height_prices for sofa pricing + mattress size pool.
  const [picked, setPicked] = useState<MfgProductRow | null>(null);

  // Portal the SKU dropdown so an overflow:hidden ancestor can't clip it.
  const pickerInputRef = useRef<HTMLInputElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const [draft, setDraft] = useState<SoLineDraft>(initial ?? {
    itemCode: '', itemGroup: 'others', description: '', uom: 'UNIT',
    qty: 1, unitPriceCenti: 0, discountCenti: 0, unitCostCenti: 0,
    variants: {}, remark: '',
  });

  const showProductPicker = Boolean(search.trim()) && candidates.length > 0 && search !== draft.itemCode;
  useEffect(() => {
    if (!showProductPicker) { setMenuPos(null); return; }
    const update = () => {
      const el = pickerInputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('scroll', update, true);
    window.addEventListener('resize', update);
    return () => { window.removeEventListener('scroll', update, true); window.removeEventListener('resize', update); };
  }, [showProductPicker]);

  const pickProduct = (p: MfgProductRow) => {
    setPicked(p);
    setDraft((s) => ({
      ...s,
      itemCode:       p.code,
      itemGroup:      p.category.toLowerCase(),
      description:    p.name,
      // Commander 2026-05-29: SELLING unit price defaults to 0 and is typed
      // manually. base_price_sen is COST, never the selling price — so it must
      // not auto-populate the selling field. Re-picking resets selling to 0.
      unitPriceCenti: 0,
      variants:       {},        // reset variants when product changes
    }));
    setSearch(p.code);
  };

  const setVariant = (k: string, v: string | number | string[]) =>
    setDraft((s) => ({ ...s, variants: { ...s.variants, [k]: v } }));

  /* PR #125 — multi-select Special Orders. variants.specials is the new
     canonical key (string[]); legacy variants.special (single string) is
     migrated on read. specialsList() normalises both shapes. */
  const specialsList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    if (typeof v === 'string' && v) return [v];
    return [];
  };

  /* Commander 2026-05-29 — the SELLING unit price is operator-authored. It
     defaults to 0 on product pick (see pickProduct) and is typed manually; it
     is NEVER auto-recomputed from the product's price tables (those are COST).
     The previous auto-recompute effect that wrote base + surcharges into the
     Unit Price field is intentionally removed. The footer below shows the
     operator-entered Unit Price plus the SELLING variant surcharges only
     (sellingPriceSen — 0 today, non-zero only once a Sales Director sets one).
     The product cost base is never shown as the selling base. */
  const extraSen = useMemo(() => {
    if (!maint || !picked) return 0;
    const category = draft.itemGroup.toLowerCase();
    let extra = 0;
    if (category === 'sofa') {
      const legV  = String(draft.variants.legHeight ?? '');
      const specs = specialsList(draft.variants.specials ?? draft.variants.special);
      extra += maint.sofaLegHeights.find((o) => o.value === legV)?.sellingPriceSen ?? 0;
      for (const s of specs) extra += maint.sofaSpecials.find((o) => o.value === s)?.sellingPriceSen ?? 0;
    } else if (category === 'bedframe') {
      const divanV = String(draft.variants.divanHeight ?? '');
      const totalV = String(draft.variants.totalHeight ?? '');
      const legV   = String(draft.variants.legHeight ?? '');
      const specs  = specialsList(draft.variants.specials ?? draft.variants.special);
      extra += maint.divanHeights.find((o) => o.value === divanV)?.sellingPriceSen ?? 0;
      extra += maint.totalHeights.find((o) => o.value === totalV)?.sellingPriceSen ?? 0;
      extra += maint.legHeights  .find((o) => o.value === legV)?.sellingPriceSen   ?? 0;
      for (const s of specs) extra += maint.specials.find((o) => o.value === s)?.sellingPriceSen ?? 0;
    }
    return extra;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, draft.variants, draft.itemGroup, maint]);

  const lineTotal = useMemo(
    () => Math.max(0, draft.qty * draft.unitPriceCenti - draft.discountCenti),
    [draft.qty, draft.unitPriceCenti, draft.discountCenti],
  );

  const submit = () => {
    if (!draft.itemCode.trim()) { window.alert('Pick a product first.'); return; }
    onSubmit(draft);
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{initial ? 'Edit Line Item' : 'Add Line Item'}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X {...ICON} />
          </button>
        </header>

        <div className={styles.modalBody}>
          {/* ── Product picker ──────────────────────────────────────── */}
          <div>
            <p className={styles.subHead}>Product</p>
            <div className={styles.pickerWrap}>
              <input
                ref={pickerInputRef}
                className={styles.fieldInput}
                placeholder="Search by code or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {showProductPicker && menuPos && createPortal(
                <ul
                  className={styles.suggestList}
                  style={{ position: 'fixed', top: menuPos.top, left: menuPos.left, width: menuPos.width, right: 'auto', marginTop: 0, zIndex: 1000 }}
                >
                  {candidates.slice(0, 10).map((p) => (
                    <li key={p.id} className={styles.suggestItem} onMouseDown={() => pickProduct(p)}>
                      <div>
                        <span className={styles.codeCell}>{p.code}</span> · {p.name}
                      </div>
                      <div className={styles.suggestCode}>
                        {p.category} · {fmtRm(p.base_price_sen ?? 0)}
                      </div>
                    </li>
                  ))}
                </ul>,
                document.body,
              )}
            </div>
            {draft.itemCode && (
              <div className={styles.previewLine} style={{ marginTop: 8 }}>
                <span><strong>{draft.itemCode}</strong> · {draft.description}</span>
                <span className={styles.previewPrice}>{fmtRm(draft.unitPriceCenti)}</span>
              </div>
            )}
          </div>

          {/* ── Variant editor (per category) ────────────────────────── */}
          {draft.itemCode && maint && (
            <div>
              <p className={styles.subHead}>Variants</p>

              {/* BEDFRAME — divan / leg / gap / total height / specials */}
              {draft.itemGroup === 'bedframe' && (
                <div className={styles.formGrid4}>
                  <VariantSelect
                    label="Divan Height"
                    options={maint.divanHeights}
                    value={String(draft.variants.divanHeight ?? '')}
                    onChange={(v) => setVariant('divanHeight', v)}
                  />
                  <VariantSelect
                    label="Total Height"
                    options={maint.totalHeights}
                    value={String(draft.variants.totalHeight ?? '')}
                    onChange={(v) => setVariant('totalHeight', v)}
                  />
                  <VariantSelect
                    label="Leg Height"
                    options={maint.legHeights}
                    value={String(draft.variants.legHeight ?? '')}
                    onChange={(v) => setVariant('legHeight', v)}
                  />
                  <VariantSelect
                    label="Gap"
                    options={maint.gaps.map((g) => ({ value: g, priceSen: 0 }))}
                    value={String(draft.variants.gap ?? '')}
                    onChange={(v) => setVariant('gap', v)}
                  />
                </div>
              )}
              {/* PR #125 — Special Orders is multi-select for bedframe.
                  HOOKKA pattern: commander toggles N specials at once
                  (e.g. recliner + storage + USB port), price recomputes. */}
              {draft.itemGroup === 'bedframe' && (
                <SpecialsMultiSelect
                  label="Special Orders"
                  options={maint.specials}
                  picked={specialsList(draft.variants.specials ?? draft.variants.special)}
                  onChange={(arr) => setVariant('specials', arr)}
                />
              )}

              {/* SOFA — fabric code / color code / divan / sofa size /
                  seat height / leg height / special */}
              {draft.itemGroup === 'sofa' && (
                <div className={styles.formGrid4}>
                  <VariantSelect
                    label="Seat Height"
                    options={maint.sofaSizes.map((s) => {
                      const sh = picked?.seat_height_prices && Array.isArray(picked.seat_height_prices)
                        ? (picked.seat_height_prices as Array<{ height: string; tier: string; priceSen: number }>)
                            .find((p) => p.height === s && p.tier === 'PRICE_2')
                        : null;
                      return { value: s, priceSen: sh?.priceSen ?? 0 };
                    })}
                    value={String(draft.variants.seatHeight ?? '')}
                    onChange={(v) => setVariant('seatHeight', v)}
                  />
                  <VariantSelect
                    label="Leg Height"
                    options={maint.sofaLegHeights}
                    value={String(draft.variants.legHeight ?? '')}
                    onChange={(v) => setVariant('legHeight', v)}
                  />
                  <label className={styles.field}>
                    {/* Commander 2026-05-28 — unify fabric/colour term → "Fabrics". Key fabricCode unchanged. */}
                    <span className={styles.fieldLabel}>Fabrics</span>
                    <select
                      className={styles.fieldSelect}
                      value={String(draft.variants.fabricCode ?? '')}
                      onChange={(e) => setVariant('fabricCode', e.target.value)}
                    >
                      <option value="">—</option>
                      {fabrics.map((f) => (
                        <option key={f.id} value={f.fabric_code}>
                          {f.fabric_code}{f.series ? ` · ${f.series}` : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className={styles.field}>
                    {/* Commander 2026-05-28 — unify fabric/colour term → "Fabrics".
                        Adjacent "Fabrics" select stays; qualify this one as
                        "Fabrics (Color)" to avoid a near-duplicate label.
                        Key colorCode unchanged. */}
                    <span className={styles.fieldLabel}>Fabrics (Color)</span>
                    <input
                      className={styles.fieldInput}
                      placeholder="e.g. PC151-04"
                      value={String(draft.variants.colorCode ?? '')}
                      onChange={(e) => setVariant('colorCode', e.target.value)}
                    />
                  </label>
                  <VariantSelect
                    label="Divan Height"
                    options={maint.divanHeights}
                    value={String(draft.variants.divanHeight ?? '')}
                    onChange={(v) => setVariant('divanHeight', v)}
                  />
                </div>
              )}
              {/* PR #125 — Special Orders multi-select for sofa (mirrors
                  bedframe). HOOKKA pattern: multiple specials at once. */}
              {draft.itemGroup === 'sofa' && (
                <SpecialsMultiSelect
                  label="Special Orders"
                  options={maint.sofaSpecials}
                  picked={specialsList(draft.variants.specials ?? draft.variants.special)}
                  onChange={(arr) => setVariant('specials', arr)}
                />
              )}

              {/* MATTRESS — just size (commander 2026-05-26: "选 size 就够了") */}
              {draft.itemGroup === 'mattress' && (
                <div className={styles.formGrid4}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Size</span>
                    <select
                      className={styles.fieldSelect}
                      value={String(draft.variants.size ?? '')}
                      onChange={(e) => setVariant('size', e.target.value)}
                    >
                      <option value="">—</option>
                      {(maint.mattressSizes ?? []).map((s) => {
                        const lbl = maint.sizeLabels?.[s]?.label;
                        return (
                          <option key={s} value={s}>
                            {s}{lbl ? ` · ${lbl}` : ''}
                          </option>
                        );
                      })}
                    </select>
                  </label>
                </div>
              )}

              {/* ACCESSORY / OTHERS — no structured variants, just remark
                  (handled below) */}
              {(draft.itemGroup === 'accessory' || draft.itemGroup === 'others') && (
                <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', margin: 0 }}>
                  No variants for this category — use the remark field below for any free-text details.
                </p>
              )}
            </div>
          )}

          {/* ── Pricing ─────────────────────────────────────────────── */}
          <div>
            <p className={styles.subHead}>Pricing</p>
            <div className={styles.formGrid4}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Qty</span>
                <input
                  type="number" min={1} className={styles.fieldInput} value={draft.qty}
                  onChange={(e) => setDraft((s) => ({ ...s, qty: Number(e.target.value) || 1 }))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  Unit Price (RM)
                </span>
                <input
                  type="number" step="0.01" className={styles.fieldInput}
                  value={(draft.unitPriceCenti / 100).toFixed(2)}
                  onChange={(e) => {
                    // Commander 2026-05-29 — selling price is operator-authored.
                    setDraft((s) => ({ ...s, unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0 }));
                  }}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Discount (RM)</span>
                <input
                  type="number" step="0.01" className={styles.fieldInput}
                  value={(draft.discountCenti / 100).toFixed(2)}
                  onChange={(e) => setDraft((s) => ({ ...s, discountCenti: Math.round(Number(e.target.value) * 100) || 0 }))}
                />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Unit Cost (RM)</span>
                <input
                  type="number" step="0.01" className={styles.fieldInput}
                  value={(draft.unitCostCenti / 100).toFixed(2)}
                  onChange={(e) => setDraft((s) => ({ ...s, unitCostCenti: Math.round(Number(e.target.value) * 100) || 0 }))}
                />
              </label>
            </div>
            {/* Commander 2026-05-29 — footer breakdown. The selling price is
                operator-authored, so we show the entered Unit Price (× qty,
                less discount) and any SELLING variant surcharges (0 today).
                The product cost base is never shown as a selling base. */}
            <div style={{
              marginTop: 8,
              display: 'grid',
              gap: 4,
              padding: 'var(--space-2) var(--space-3)',
              background: 'var(--c-cream)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-12)',
            }}>
              {extraSen > 0 && (
                <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fg-muted)' }}>
                  <span>+ Variant surcharges</span><span>+ {fmtRm(extraSen)}</span>
                </div>
              )}
              <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fg-muted)' }}>
                <span>Unit price × {draft.qty}{draft.discountCenti > 0 ? ` − ${fmtRm(draft.discountCenti)} discount` : ''}</span>
                <span>{fmtRm(draft.unitPriceCenti)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700, color: 'var(--c-burnt)', fontSize: 'var(--fs-14)', borderTop: '1px solid var(--line)', paddingTop: 4, marginTop: 2 }}>
                <span>Line total</span><span>{fmtRm(lineTotal)}</span>
              </div>
            </div>
          </div>

          <label className={styles.field}>
            {/* PR #125 — Commander wants "Line Notes" per HOOKKA terminology. */}
            <span className={styles.fieldLabel}>Line Notes</span>
            <input
              className={styles.fieldInput} value={draft.remark}
              onChange={(e) => setDraft((s) => ({ ...s, remark: e.target.value }))}
              placeholder="Free-text for this line (e.g. customer's special request)"
            />
          </label>
        </div>

        <footer className={styles.modalFooter}>
          <Button variant="ghost"   size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : initial ? 'Save Changes' : 'Add Line Item'}
          </Button>
        </footer>
      </div>
    </div>
  );
};

const VariantSelect = ({
  label, options, value, onChange,
}: {
  label:    string;
  /* Commander 2026-05-28: label shows SELLING surcharge (sellingPriceSen)
     only — the cost `priceSen` must never surface in the SO create flow. */
  options:  Array<{ value: string; priceSen: number; sellingPriceSen?: number }>;
  value:    string;
  onChange: (v: string) => void;
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <select className={styles.fieldSelect} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => {
        const sell = o.sellingPriceSen ?? 0;
        return (
          <option key={o.value} value={o.value}>
            {o.value}{sell > 0 ? ` (+${fmtRm(sell)})` : ''}
          </option>
        );
      })}
    </select>
  </label>
);

/* PR #125 — HOOKKA-style multi-select for Special Orders. Renders an
   expandable chip list with a count badge in the header — clicking
   the header toggles the picker open/closed, clicking a chip toggles
   that option. Per-option surcharge appears next to the chip label. */
const SpecialsMultiSelect = ({
  label, options, picked, onChange,
}: {
  label:    string;
  /* Commander 2026-05-28: chip shows SELLING surcharge (sellingPriceSen),
     never the cost priceSen. */
  options:  Array<{ value: string; priceSen: number; sellingPriceSen?: number }>;
  picked:   string[];
  onChange: (next: string[]) => void;
}) => {
  const [open, setOpen] = useState(picked.length > 0);
  const toggle = (v: string) => {
    const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v];
    onChange(next);
  };
  return (
    <div style={{ marginTop: 'var(--space-3)' }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          background: 'transparent',
          border: '1px dashed var(--line-strong)',
          borderRadius: 'var(--radius-sm)',
          padding: '6px 10px',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-13)',
          color: 'var(--fg)',
          cursor: 'pointer',
          width: '100%',
          justifyContent: 'space-between',
        }}
      >
        <span>
          <span style={{ fontWeight: 600 }}>{label}</span>
          {picked.length > 0 && (
            <span style={{ marginLeft: 8, color: 'var(--c-orange)', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>
              ({picked.length} selected)
            </span>
          )}
        </span>
        <span style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-12)' }}>{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 8 }}>
          {options.length === 0 && (
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              No specials configured in Maintenance.
            </span>
          )}
          {options.map((o) => {
            const on = picked.includes(o.value);
            const sell = o.sellingPriceSen ?? 0;
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                style={{
                  background: on ? 'var(--c-orange)' : 'var(--c-paper)',
                  color: on ? 'var(--bg)' : 'var(--fg)',
                  border: `1px solid ${on ? 'var(--c-orange)' : 'var(--line-strong)'}`,
                  borderRadius: 999,
                  padding: '4px 12px',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-12)',
                  cursor: 'pointer',
                }}
              >
                {o.value}{sell > 0 ? ` (+${fmtRm(sell)})` : ''}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
