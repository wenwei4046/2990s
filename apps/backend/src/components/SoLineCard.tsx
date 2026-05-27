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
 *  /mfg-sales-orders and PATCH /mfg-sales-orders/:docNo/items both expect.
 *  PR #147 — `overriddenKeys` is a client-only audit set (not persisted to
 *  API) that records which variant keys this line has been MANUALLY edited
 *  for. The master-follower cascade in SalesOrderNew uses it to decide
 *  whether to overwrite a follower's variant when LINE 1's changes:
 *    - key NOT in overriddenKeys → cascade overwrites (follower stays in sync)
 *    - key IN overriddenKeys     → cascade leaves alone (follower wins) */
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
  overriddenKeys?: string[];
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
  inheritVariantsByCategory,
}: {
  index:     number;
  draft:     SoLineDraft;
  onChange:  (patch: Partial<SoLineDraft>) => void;
  onRemove:  () => void;
  canRemove: boolean;
  /* PR #141 — Commander 2026-05-26: "正常我的沙发是一整套… 根据第一个 item
     带下来的 sofa seat、leg size、fabric 等，这些都会跟着第一个自动带下来".
     Parent (SalesOrderNew) supplies a per-category variants bag captured
     from the FIRST line of that category. When commander picks an SKU
     and this line currently has no variants set, those defaults are
     merged in. Categories shipped today: sofa, bedframe — mattress has
     no variants now (PR #136). */
  inheritVariantsByCategory?: Record<string, Record<string, unknown> | undefined>;
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
  // PR #129 — Product picker shows a click-to-open dropdown (not just
  // type-ahead). Tracks whether the suggestion list is currently visible.
  const [showPicker, setShowPicker]   = useState(false);

  // PR #136 — Commander: "Product 那边，收一个 Row 就可以了… 就 show Description
  // 就行了". After picking we sync the search box to the product NAME (not the
  // code) so the single row already shows the readable description. The
  // separate preview line below is removed.
  useEffect(() => { setSearch(draft.description ?? ''); }, [draft.description]);

  const pickProduct = (p: MfgProductRow) => {
    setPicked(p);
    setManualPrice(false);
    const category = p.category.toLowerCase();
    /* PR #141 — When commander picks an SKU, if there's already an earlier
       line of the same category with variants filled in, inherit those.
       Sofa as a SET: line 1 sets seat/leg/fabric → lines 2,3,…N carry the
       same values forward automatically.
       PR #147 — Reset overriddenKeys on a fresh pick: a new product wipes
       the slate so cascade can repopulate everything cleanly. */
    const inherited = inheritVariantsByCategory?.[category];
    const seedVariants: Record<string, unknown> =
      inherited && Object.keys(inherited).length > 0 ? { ...inherited } : {};
    onChange({
      itemCode:       p.code,
      itemGroup:      category,
      description:    p.name,
      unitPriceCenti: p.base_price_sen ?? 0,
      variants:       seedVariants,
      overriddenKeys: [],
    });
    setSearch(p.name);
  };

  /* PR #136 — Auto-compute bedframe Total Height = Divan + Leg + Gap.
     Commander: "Total Height 是不需要选择的。是 Divan + Leg + Gap 自动算出来
     的". Maintenance values are formatted like "8\"", "4\"", "20\"" — parse
     the leading number, sum, format back with a quote suffix. */
  const parseInches = (s: unknown): number => {
    if (s === null || s === undefined) return 0;
    const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
    return m && m[1] ? Number(m[1]) : 0;
  };
  const computedTotalHeight = useMemo(() => {
    if (draft.itemGroup !== 'bedframe') return '';
    const d = parseInches(draft.variants.divanHeight);
    const l = parseInches(draft.variants.legHeight);
    const g = parseInches(draft.variants.gap);
    if (d === 0 && l === 0 && g === 0) return '';
    return `${d + l + g}"`;
  }, [draft.itemGroup, draft.variants.divanHeight, draft.variants.legHeight, draft.variants.gap]);

  // Write the computed value back into the variants bag so it ships to API
  // alongside the picked divan/leg/gap.
  useEffect(() => {
    if (draft.itemGroup !== 'bedframe') return;
    if (!computedTotalHeight) return;
    if (String(draft.variants.totalHeight ?? '') === computedTotalHeight) return;
    onChange({ variants: { ...draft.variants, totalHeight: computedTotalHeight } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedTotalHeight, draft.itemGroup]);

  /* PR #147 — Any user edit through setVariant adds the key to the line's
     overriddenKeys set. This protects follower lines from cascade overwrite
     once commander deliberately diverges (e.g. one module in a sofa set
     uses a different fabric). Master line (LINE 1 of category) is never
     cascaded onto, so adding the override flag there is harmless. */
  const setVariant = (k: string, v: string | number | string[]) => {
    const nextOverrides = Array.from(new Set([...(draft.overriddenKeys ?? []), k]));
    onChange({
      variants: { ...draft.variants, [k]: v },
      overriddenKeys: nextOverrides,
    });
  };

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

  /* PR #162 — Commander 2026-05-27: "排版再优化 才一个line 就那么大了".
     Compacted layout: header + picker on row 1, qty/price/discount on row 2,
     variants only when category actually has them (mattress/accessory/others
     render nothing), price breakdown collapsed to a single inline summary
     line, notes input is a single row without a separate label row. */
  const hasVariants = draft.itemCode && maint && (draft.itemGroup === 'bedframe' || draft.itemGroup === 'sofa');

  return (
    <div
      style={{
        background: 'var(--c-paper)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-lg)',
        padding: 'var(--space-3)',
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--space-2)',
      }}
    >
      {/* ── Row 1: header + product picker ─────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
        <span
          style={{
            fontFamily: 'var(--font-button)',
            fontSize: 'var(--fs-11)',
            fontWeight: 700,
            letterSpacing: '0.10em',
            color: 'var(--fg-muted)',
            whiteSpace: 'nowrap',
          }}
        >
          LINE {index + 1}
        </span>
        <span
          style={{
            fontFamily: 'var(--font-button)',
            fontSize: 'var(--fs-10)',
            fontWeight: 700,
            letterSpacing: '0.10em',
            padding: '2px 6px',
            borderRadius: 'var(--radius-pill)',
            background: badge.bg,
            color: badge.fg,
            whiteSpace: 'nowrap',
          }}
        >
          {badge.label}
        </span>
        <div className={styles.pickerWrap} style={{ flex: 1, minWidth: 0 }}>
          <input
            className={styles.fieldInput}
            placeholder="Click to pick or type to filter…"
            value={search}
            onFocus={() => setShowPicker(true)}
            onBlur={() => setTimeout(() => setShowPicker(false), 150)}
            onChange={(e) => { setSearch(e.target.value); setShowPicker(true); }}
          />
          {showPicker && candidates.length > 0 && !(draft.itemCode && search === draft.description) && (
            <ul className={styles.suggestList}>
              {candidates.slice(0, 50).map((p) => (
                <li key={p.id} className={styles.suggestItem} onMouseDown={() => { pickProduct(p); setShowPicker(false); }}>
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
          {showPicker && candidates.length === 0 && (
            <ul className={styles.suggestList}>
              <li className={styles.suggestItem} style={{ color: 'var(--fg-muted)', cursor: 'default' }}>
                No products match{search.trim() ? ` "${search}"` : ''}.
              </li>
            </ul>
          )}
        </div>
        <span className={styles.previewPrice} style={{ whiteSpace: 'nowrap' }}>{fmtRm(lineTotal)}</span>
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

      {/* ── Row 2: variants (only when category actually has them) ──── */}
      {hasVariants && draft.itemGroup === 'bedframe' && (
        <div className={styles.formGrid4}>
          <VariantSelect
            label="Divan Height"
            options={maint!.divanHeights}
            value={String(draft.variants.divanHeight ?? '')}
            onChange={(v) => setVariant('divanHeight', v)}
          />
          <VariantSelect
            label="Leg Height"
            options={maint!.legHeights}
            value={String(draft.variants.legHeight ?? '')}
            onChange={(v) => setVariant('legHeight', v)}
          />
          <VariantSelect
            label="Gap"
            options={maint!.gaps.map((g) => ({ value: g, priceSen: 0 }))}
            value={String(draft.variants.gap ?? '')}
            onChange={(v) => setVariant('gap', v)}
          />
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Total<span style={{ marginLeft: 4, color: 'var(--c-orange)' }}>· auto</span>
            </span>
            <input
              readOnly
              className={styles.fieldInput}
              value={computedTotalHeight || '—'}
              style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
              title="Auto-computed: Divan + Leg + Gap"
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Fabric</span>
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
          <SpecialsMultiSelect
            label="Specials"
            options={maint!.specials}
            picked={specialsList(draft.variants.specials ?? draft.variants.special)}
            onChange={(arr) => setVariant('specials', arr)}
          />
        </div>
      )}

      {hasVariants && draft.itemGroup === 'sofa' && (
        <div className={styles.formGrid4}>
          <VariantSelect
            label="Seat Height"
            options={maint!.sofaSizes.map((s) => {
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
            options={maint!.sofaLegHeights}
            value={String(draft.variants.legHeight ?? '')}
            onChange={(v) => setVariant('legHeight', v)}
          />
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Fabric</span>
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
          <SpecialsMultiSelect
            label="Specials"
            options={maint!.sofaSpecials}
            picked={specialsList(draft.variants.specials ?? draft.variants.special)}
            onChange={(arr) => setVariant('specials', arr)}
          />
        </div>
      )}

      {/* ── Row 3: pricing inputs + inline breakdown + notes ─────────── */}
      <div style={{ display: 'grid', gridTemplateColumns: '80px 140px 140px 1fr', gap: 'var(--space-2)', alignItems: 'end' }}>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Qty</span>
          <input
            type="number" min={1} className={styles.fieldInput} value={draft.qty}
            onChange={(e) => onChange({ qty: Number(e.target.value) || 1 })}
          />
        </label>
        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            Unit (RM){!manualPrice && picked && <span style={{ marginLeft: 4, color: 'var(--c-orange)' }}>· auto</span>}
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
          <span className={styles.fieldLabel}>Line Notes</span>
          <input
            className={styles.fieldInput}
            value={draft.remark}
            onChange={(e) => onChange({ remark: e.target.value })}
            placeholder="Free-text for this line"
          />
        </label>
      </div>

      {/* PR #162 — Single-line price summary. Replaces the 4-row box that
          ate vertical space. Only shows when a product is picked. */}
      {picked && (
        <div style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-12)',
          color: 'var(--fg-muted)',
          display: 'flex',
          gap: 'var(--space-3)',
          flexWrap: 'wrap',
        }}>
          <span>Base {fmtRm(basePriceSen)}</span>
          {extraSen > 0 && <span>+ Variants {fmtRm(extraSen)}</span>}
          <span>· Unit {fmtRm(draft.unitPriceCenti)} × {draft.qty}</span>
          {draft.discountCenti > 0 && <span>− Disc {fmtRm(draft.discountCenti)}</span>}
        </div>
      )}
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
  /* PR #162 — fits into a 4-col grid cell now: label row matches sibling
     selects, picker is a compact summary button that pops a chip row
     below the grid only when expanded. */
  const [open, setOpen] = useState(false);
  const toggle = (v: string) => {
    const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v];
    onChange(next);
  };
  const summary = picked.length === 0 ? '—' : `${picked.length} selected`;
  return (
    <label className={styles.field} style={{ position: 'relative' }}>
      <span className={styles.fieldLabel}>{label}</span>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={styles.fieldInput}
        style={{
          textAlign: 'left',
          cursor: 'pointer',
          color: picked.length > 0 ? 'var(--c-ink)' : 'var(--fg-muted)',
          background: 'var(--c-paper)',
        }}
      >
        {summary} {open ? '▾' : '▸'}
      </button>
      {open && (
        <div
          style={{
            position: 'absolute',
            top: '100%',
            left: 0,
            right: 0,
            marginTop: 4,
            background: 'var(--c-paper)',
            border: '1px solid var(--line-strong)',
            borderRadius: 'var(--radius-md)',
            boxShadow: 'var(--shadow-2)',
            padding: 'var(--space-2)',
            display: 'flex',
            flexWrap: 'wrap',
            gap: 6,
            zIndex: 20,
            minWidth: 240,
          }}
        >
          {options.length === 0 && (
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              No specials configured.
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
                  padding: '4px 10px',
                  fontFamily: 'var(--font-sans)',
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
    </label>
  );
};
