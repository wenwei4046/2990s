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

import { useEffect, useMemo, useState } from 'react';
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

  // Manual unit-price override — when commander types in the Unit Price box,
  // we stop auto-recomputing. Tracked separately so any variant change
  // doesn't overwrite their edit.
  const [manualPrice, setManualPrice] = useState(false);

  const [draft, setDraft] = useState<SoLineDraft>(initial ?? {
    itemCode: '', itemGroup: 'others', description: '', uom: 'UNIT',
    qty: 1, unitPriceCenti: 0, discountCenti: 0, unitCostCenti: 0,
    variants: {}, remark: '',
  });

  const pickProduct = (p: MfgProductRow) => {
    setPicked(p);
    setManualPrice(false);
    setDraft((s) => ({
      ...s,
      itemCode:       p.code,
      itemGroup:      p.category.toLowerCase(),
      description:    p.name,
      unitPriceCenti: p.base_price_sen ?? 0,
      variants:       {},        // reset variants when product changes
    }));
    setSearch(p.code);
  };

  const setVariant = (k: string, v: string | number) =>
    setDraft((s) => ({ ...s, variants: { ...s.variants, [k]: v } }));

  /* PR #114 — Auto-recompute unit price from base + variant surcharges.
     Formula: unitPriceSen = basePriceSen + Σ(variant surcharges)
     For Sofa: base comes from product.seat_height_prices (PRICE_2 tier)
               when commander picks a seat height; else falls back to
               product.base_price_sen.
     For Bedframe: base = product.base_price_sen.
     Skipped if user manually overrode. */
  useEffect(() => {
    if (manualPrice || !maint || !picked) return;
    const category = draft.itemGroup.toLowerCase();
    let basePriceSen = picked.base_price_sen ?? 0;
    let extraSen = 0;

    if (category === 'sofa') {
      const sh = String(draft.variants.seatHeight ?? '');
      if (sh && Array.isArray(picked.seat_height_prices)) {
        const match = (picked.seat_height_prices as Array<{ height: string; tier: string; priceSen: number }>)
          .find((p) => p.height === sh && p.tier === 'PRICE_2');
        if (match) basePriceSen = match.priceSen;
      }
      const legV  = String(draft.variants.legHeight ?? '');
      const specV = String(draft.variants.special ?? '');
      extraSen += maint.sofaLegHeights.find((o) => o.value === legV)?.priceSen  ?? 0;
      extraSen += maint.sofaSpecials  .find((o) => o.value === specV)?.priceSen ?? 0;
    } else if (category === 'bedframe') {
      const divanV = String(draft.variants.divanHeight ?? '');
      const totalV = String(draft.variants.totalHeight ?? '');
      const legV   = String(draft.variants.legHeight ?? '');
      const specV  = String(draft.variants.special ?? '');
      extraSen += maint.divanHeights.find((o) => o.value === divanV)?.priceSen ?? 0;
      extraSen += maint.totalHeights.find((o) => o.value === totalV)?.priceSen ?? 0;
      extraSen += maint.legHeights  .find((o) => o.value === legV)?.priceSen   ?? 0;
      extraSen += maint.specials    .find((o) => o.value === specV)?.priceSen  ?? 0;
    }
    // Mattress / Accessory / Others: no variant surcharges. Base price as-is.

    const newPrice = basePriceSen + extraSen;
    setDraft((s) => (s.unitPriceCenti === newPrice ? s : { ...s, unitPriceCenti: newPrice }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, draft.variants, draft.itemGroup, maint, manualPrice]);

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
                className={styles.fieldInput}
                placeholder="Search by code or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search.trim() && candidates.length > 0 && search !== draft.itemCode && (
                <ul className={styles.suggestList}>
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
                </ul>
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
                  <VariantSelect
                    label="Special"
                    options={maint.specials}
                    value={String(draft.variants.special ?? '')}
                    onChange={(v) => setVariant('special', v)}
                  />
                </div>
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
                    <span className={styles.fieldLabel}>Fabric Code</span>
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
                    <span className={styles.fieldLabel}>Color Code</span>
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
                  <VariantSelect
                    label="Special"
                    options={maint.sofaSpecials}
                    value={String(draft.variants.special ?? '')}
                    onChange={(v) => setVariant('special', v)}
                  />
                </div>
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
                  {!manualPrice && picked && (
                    <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-orange)' }}>
                      · auto
                    </span>
                  )}
                </span>
                <input
                  type="number" step="0.01" className={styles.fieldInput}
                  value={(draft.unitPriceCenti / 100).toFixed(2)}
                  onChange={(e) => {
                    setManualPrice(true);
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
            <div className={styles.previewLine} style={{ marginTop: 8 }}>
              <span>Line total</span>
              <span className={styles.previewPrice}>{fmtRm(lineTotal)}</span>
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Remark</span>
            <input
              className={styles.fieldInput} value={draft.remark}
              onChange={(e) => setDraft((s) => ({ ...s, remark: e.target.value }))}
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
  options:  Array<{ value: string; priceSen: number }>;
  value:    string;
  onChange: (v: string) => void;
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <select className={styles.fieldSelect} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value}{o.priceSen > 0 ? ` (+${fmtRm(o.priceSen)})` : ''}
        </option>
      ))}
    </select>
  </label>
);
