// ----------------------------------------------------------------------------
// SoLineCard — inline line-item editor card.
//
// PR #125 — Commander 2026-05-26: "为什么我的 add line 需要这样子（弹出 modal），
// 而不是跟 Hookka 一样（每一行就是一张可直接编辑的卡片）".
//
// Replaces the modal popup from PR #114 (SoLineItemModal.tsx). Each draft
// line renders as a card on the SO form with the product picker, per-category
// variant fields, pricing row and remark all visible at once. Continuous-add
// flow: bottom button appends an empty card.
//
// Per-category variants (same maintenance-driven source as the modal):
//   Mattress  → size
//   Sofa      → seat / leg / fabric / color / divan / special
//   Bedframe  → divan / total / leg / gap / special
//   Accessory / Others → free-text remark only
//
// Pricing recompute (unchanged from PR #114):
//   unitPriceSen = basePriceSen + Σ(variant surcharges)
//   Manual override on unit price stops the auto-recompute for that line.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useMfgProducts, useMaintenanceConfig, type MfgProductRow } from '../lib/mfg-products-queries';
import { useFabricTrackings } from '../lib/fabric-queries';
import styles from '../pages/SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

/** PR #114/#125 — Draft payload for one SO line. Matches the shape POST
 *  /mfg-sales-orders and PATCH /mfg-sales-orders/:docNo/items both expect. */
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

/** Factory for a fresh empty SO line draft. Used by the parent page to
 *  seed the initial card + on every "+ Add another item" click. */
export const emptySoLine = (): SoLineDraft => ({
  itemCode: '', itemGroup: 'others', description: '', uom: 'UNIT',
  qty: 1, unitPriceCenti: 0, discountCenti: 0, unitCostCenti: 0,
  variants: {}, remark: '',
});

const CATEGORY_BADGES: Record<string, { bg: string; fg: string; label: string }> = {
  sofa:      { bg: 'rgba(166, 71, 30, 0.12)', fg: 'var(--c-burnt)',                 label: 'SOFA' },
  bedframe:  { bg: 'rgba(47, 93, 79, 0.12)',  fg: 'var(--c-secondary-a, #2F5D4F)',  label: 'BEDFRAME' },
  mattress:  { bg: 'rgba(199, 127, 62, 0.16)', fg: 'var(--c-festive-a, #C77F3E)',   label: 'MATTRESS' },
  accessory: { bg: 'rgba(34, 31, 32, 0.10)',  fg: 'var(--fg-muted)',                label: 'ACCESSORY' },
  others:    { bg: 'rgba(34, 31, 32, 0.06)',  fg: 'var(--fg-muted)',                label: 'OTHERS' },
};

export const SoLineCard = ({
  index,
  draft,
  onChange,
  onRemove,
  canRemove,
}: {
  index:     number;
  draft:     SoLineDraft;
  onChange:  (patch: Partial<SoLineDraft>) => void;
  onRemove:  () => void;
  canRemove: boolean;
}) => {
  const maintQ   = useMaintenanceConfig('master');
  const maint    = maintQ.data?.data ?? null;
  const fabricsQ = useFabricTrackings();
  const fabrics  = fabricsQ.data ?? [];

  const [search, setSearch] = useState(draft.itemCode ?? '');
  const productsQuery = useMfgProducts({ search: search.trim() || undefined });
  const candidates = productsQuery.data ?? [];

  const [picked, setPicked]           = useState<MfgProductRow | null>(null);
  const [manualPrice, setManualPrice] = useState(false);

  // Keep local search box in sync if parent resets the card.
  useEffect(() => { setSearch(draft.itemCode ?? ''); }, [draft.itemCode]);

  const pickProduct = (p: MfgProductRow) => {
    setPicked(p);
    setManualPrice(false);
    onChange({
      itemCode:       p.code,
      itemGroup:      p.category.toLowerCase(),
      description:    p.name,
      unitPriceCenti: p.base_price_sen ?? 0,
      variants:       {},
    });
    setSearch(p.code);
  };

  const setVariant = (k: string, v: string | number | string[]) =>
    onChange({ variants: { ...draft.variants, [k]: v } });

  /* PR #127 — HOOKKA multi-select Special Orders. `variants.specials`
     (string[]) is the new canonical key; legacy `variants.special`
     (single string) is migrated on read so old saved drafts open
     correctly. */
  const specialsList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    if (typeof v === 'string' && v) return [v];
    return [];
  };

  /* Auto-recompute unit price — same formula as PR #114 SoLineItemModal:
     unitPriceSen = basePriceSen + Σ(variant surcharges).
     For sofa, base swaps to product.seat_height_prices PRICE_2 row when a
     seat height is picked. Manual override on Unit Price box freezes this. */
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
      const specs = specialsList(draft.variants.specials ?? draft.variants.special);
      extraSen += maint.sofaLegHeights.find((o) => o.value === legV)?.priceSen ?? 0;
      for (const s of specs) extraSen += maint.sofaSpecials.find((o) => o.value === s)?.priceSen ?? 0;
    } else if (category === 'bedframe') {
      const divanV = String(draft.variants.divanHeight ?? '');
      const totalV = String(draft.variants.totalHeight ?? '');
      const legV   = String(draft.variants.legHeight ?? '');
      const specs  = specialsList(draft.variants.specials ?? draft.variants.special);
      extraSen += maint.divanHeights.find((o) => o.value === divanV)?.priceSen ?? 0;
      extraSen += maint.totalHeights.find((o) => o.value === totalV)?.priceSen ?? 0;
      extraSen += maint.legHeights  .find((o) => o.value === legV)?.priceSen   ?? 0;
      for (const s of specs) extraSen += maint.specials.find((o) => o.value === s)?.priceSen ?? 0;
    }

    const newPrice = basePriceSen + extraSen;
    if (draft.unitPriceCenti !== newPrice) onChange({ unitPriceCenti: newPrice });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, draft.variants, draft.itemGroup, maint, manualPrice]);

  /* PR #127 — Footer pricing breakdown. Mirrors the auto-recompute so
     the displayed components always match the unit-price input. */
  const { basePriceSen, extraSen } = useMemo(() => {
    if (!maint || !picked) return { basePriceSen: draft.unitPriceCenti, extraSen: 0 };
    const category = draft.itemGroup.toLowerCase();
    let base = picked.base_price_sen ?? 0;
    let extra = 0;
    if (category === 'sofa') {
      const sh = String(draft.variants.seatHeight ?? '');
      if (sh && Array.isArray(picked.seat_height_prices)) {
        const match = (picked.seat_height_prices as Array<{ height: string; tier: string; priceSen: number }>)
          .find((p) => p.height === sh && p.tier === 'PRICE_2');
        if (match) base = match.priceSen;
      }
      const legV  = String(draft.variants.legHeight ?? '');
      const specs = specialsList(draft.variants.specials ?? draft.variants.special);
      extra += maint.sofaLegHeights.find((o) => o.value === legV)?.priceSen ?? 0;
      for (const s of specs) extra += maint.sofaSpecials.find((o) => o.value === s)?.priceSen ?? 0;
    } else if (category === 'bedframe') {
      const divanV = String(draft.variants.divanHeight ?? '');
      const totalV = String(draft.variants.totalHeight ?? '');
      const legV   = String(draft.variants.legHeight ?? '');
      const specs  = specialsList(draft.variants.specials ?? draft.variants.special);
      extra += maint.divanHeights.find((o) => o.value === divanV)?.priceSen ?? 0;
      extra += maint.totalHeights.find((o) => o.value === totalV)?.priceSen ?? 0;
      extra += maint.legHeights  .find((o) => o.value === legV)?.priceSen   ?? 0;
      for (const s of specs) extra += maint.specials.find((o) => o.value === s)?.priceSen ?? 0;
    }
    return { basePriceSen: base, extraSen: extra };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, draft.variants, draft.itemGroup, maint]);

  const lineTotal = useMemo(
    () => Math.max(0, draft.qty * draft.unitPriceCenti - draft.discountCenti),
    [draft.qty, draft.unitPriceCenti, draft.discountCenti],
  );

  const fallbackBadge = CATEGORY_BADGES.others!;
  const badge = CATEGORY_BADGES[draft.itemGroup] ?? fallbackBadge;

  return (
    <div
      style={{
        background: 'var(--c-paper)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-4)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-3)',
      }}
    >
      {/* ── Card header ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <span
            style={{
              fontFamily: 'var(--font-button)',
              fontSize: 'var(--fs-12)',
              fontWeight: 700,
              letterSpacing: '0.10em',
              color: 'var(--fg-muted)',
            }}
          >
            LINE {index + 1}
          </span>
          <span
            style={{
              fontFamily: 'var(--font-button)',
              fontSize: 'var(--fs-11)',
              fontWeight: 700,
              letterSpacing: '0.10em',
              padding: '2px 8px',
              borderRadius: 'var(--radius-pill)',
              background: badge.bg,
              color: badge.fg,
            }}
          >
            {badge.label}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className={styles.previewPrice}>{fmtRm(lineTotal)}</span>
          <button
            type="button"
            title="Remove this line"
            onClick={onRemove}
            disabled={!canRemove}
            style={{
              background: 'transparent',
              border: 'none',
              cursor: canRemove ? 'pointer' : 'not-allowed',
              color: canRemove ? 'var(--c-festive-b, #B8331F)' : 'var(--fg-muted)',
              opacity: canRemove ? 1 : 0.4,
              padding: 4,
              display: 'inline-flex',
            }}
          >
            <Trash2 {...ICON} />
          </button>
        </div>
      </div>

      {/* ── Product picker ───────────────────────────────────────────── */}
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

      {/* ── Variant editor (per category) ────────────────────────────── */}
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
          {/* PR #127 — Special Orders multi-select for bedframe */}
          {draft.itemGroup === 'bedframe' && (
            <SpecialsMultiSelect
              label="Special Orders"
              options={maint.specials}
              picked={specialsList(draft.variants.specials ?? draft.variants.special)}
              onChange={(arr) => setVariant('specials', arr)}
            />
          )}

          {/* SOFA — seat / leg / fabric / color / divan / special */}
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
            </div>
          )}
          {/* PR #127 — Special Orders multi-select for sofa */}
          {draft.itemGroup === 'sofa' && (
            <SpecialsMultiSelect
              label="Special Orders"
              options={maint.sofaSpecials}
              picked={specialsList(draft.variants.specials ?? draft.variants.special)}
              onChange={(arr) => setVariant('specials', arr)}
            />
          )}

          {/* MATTRESS — size only */}
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

          {/* ACCESSORY / OTHERS — no structured variants */}
          {(draft.itemGroup === 'accessory' || draft.itemGroup === 'others') && (
            <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', margin: 0 }}>
              No variants for this category — use the remark field below for any free-text details.
            </p>
          )}
        </div>
      )}

      {/* ── Pricing ──────────────────────────────────────────────────── */}
      <div>
        <p className={styles.subHead}>Pricing</p>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Qty</span>
            <input
              type="number" min={1} className={styles.fieldInput} value={draft.qty}
              onChange={(e) => onChange({ qty: Number(e.target.value) || 1 })}
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
                onChange({ unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0 });
              }}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Discount (RM)</span>
            <input
              type="number" step="0.01" className={styles.fieldInput}
              value={(draft.discountCenti / 100).toFixed(2)}
              onChange={(e) => onChange({ discountCenti: Math.round(Number(e.target.value) * 100) || 0 })}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Unit Cost (RM)</span>
            <input
              type="number" step="0.01" className={styles.fieldInput}
              value={(draft.unitCostCenti / 100).toFixed(2)}
              onChange={(e) => onChange({ unitCostCenti: Math.round(Number(e.target.value) * 100) || 0 })}
            />
          </label>
        </div>

        {/* PR #127 — HOOKKA-style footer breakdown */}
        {picked && (
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
            <div style={{ display: 'flex', justifyContent: 'space-between', color: 'var(--fg-muted)' }}>
              <span>Base price</span><span>{fmtRm(basePriceSen)}</span>
            </div>
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
        )}
      </div>

      {/* ── Line Notes (PR #127 — renamed from Remark) ───────────────── */}
      <label className={styles.field}>
        <span className={styles.fieldLabel}>Line Notes</span>
        <input
          className={styles.fieldInput}
          value={draft.remark}
          onChange={(e) => onChange({ remark: e.target.value })}
          placeholder="Free-text for this line (e.g. customer's special request)"
        />
      </label>
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

/* PR #127 — HOOKKA-style multi-select for Special Orders. Collapsible
   chip row with a count badge in the header. Replaces single-select
   dropdown for bedframe + sofa categories. */
const SpecialsMultiSelect = ({
  label, options, picked, onChange,
}: {
  label:    string;
  options:  Array<{ value: string; priceSen: number }>;
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
                {o.value}{o.priceSen > 0 ? ` (+${fmtRm(o.priceSen)})` : ''}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
