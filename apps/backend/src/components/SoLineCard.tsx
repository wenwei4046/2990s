// ----------------------------------------------------------------------------
// SoLineCard — Houzs-pattern single-row line item editor.
//
// Commander 2026-05-27: "我要 Hookka 的 LineCard 排版". Verbatim port of
// houzs-erp/src/components/NewSalesOrderForm.tsx LineCard (lines 208-487)
// translated from Tailwind to CSS Modules + 2990 brand tokens.
//
// Layout (single row, collapsed):
//   [No #] [Item ▼] [Remarks input] [Qty] [Unit Price] [Delivery Date] [Amount $] [Group badge] [🗑]
//
// Below row, per-category variants (only when SKU picked + has variants):
//   BEDFRAME → Fabrics / Gaps / Divan Heights / Leg Heights · Specials accordion
//   SOFA     → Fabrics / Seat Heights / Leg Heights        · Specials accordion
//   MATTRESS / ACCESSORY / OTHERS → no variants section
//
// Wired to:
//   - useMfgProducts (SKU picker, search-as-you-type)
//   - useMaintenanceConfig (variant option lists + per-option surcharges)
//   - useFabricTrackings (fabric dropdown)
//   - useUploadSoItemPhoto / useDeleteSoItemPhoto (per-line photos, PR-F)
//
// State contract unchanged from PR #125: same SoLineDraft shape, same
// onChange(patch) callback. SalesOrderNew + SalesOrderDetail can drop
// this in without touching the parent.
// ----------------------------------------------------------------------------

import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { Trash2, ImagePlus, X, ChevronDown, ChevronRight } from 'lucide-react';
import { useMfgProducts, useMaintenanceConfig, type MfgProductRow } from '../lib/mfg-products-queries';
import { useFabricTrackings } from '../lib/fabric-queries';
import {
  useUploadSoItemPhoto,
  useDeleteSoItemPhoto,
  fetchSoItemPhotoSignedUrl,
} from '../lib/flow-queries';
import { useDebouncedValue } from '../lib/hooks';
import styles from './SoLineCard.module.css';
const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

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
  /* PR-E — Per-item delivery date + cascade override flag. */
  lineDeliveryDate?:           string | null;
  lineDeliveryDateOverridden?: boolean;
  /* PR-F (Task #79) — Per-line photo R2 object keys. */
  photoUrls?:                  string[];
};

/** Factory for a fresh empty SO line draft. */
export const emptySoLine = (): SoLineDraft => ({
  itemCode: '', itemGroup: 'others', description: '', uom: 'UNIT',
  qty: 1, unitPriceCenti: 0, discountCenti: 0, unitCostCenti: 0,
  variants: {}, remark: '',
  lineDeliveryDate: null,
  lineDeliveryDateOverridden: false,
  photoUrls: [],
});

/* ── Per-category badge swatches (Houzs groupChip equivalent) ──────── */

const CATEGORY_BADGE: Record<string, { bg: string; fg: string; label: string }> = {
  sofa:      { bg: 'rgba(166, 71, 30, 0.12)',  fg: 'var(--c-burnt)',                 label: 'SOFA' },
  bedframe:  { bg: 'rgba(47, 93, 79, 0.12)',   fg: 'var(--c-secondary-a, #2F5D4F)',  label: 'BEDFRAME' },
  mattress:  { bg: 'rgba(199, 127, 62, 0.16)', fg: 'var(--c-festive-a, #C77F3E)',    label: 'MATTRESS' },
  accessory: { bg: 'rgba(34, 31, 32, 0.10)',   fg: 'var(--fg-muted)',                label: 'ACC' },
  others:    { bg: 'rgba(34, 31, 32, 0.06)',   fg: 'var(--fg-muted)',                label: 'OTHERS' },
};

/* ──────────────────────────────────────────────────────────────────────
   SoLineCard
   ────────────────────────────────────────────────────────────────────── */

/* Task #103 — Wrap in React.memo at module bottom. The parent (SO Detail)
   now passes stable per-row callbacks via a useMemo'd Map keyed off
   editingLineIds, so the memo comparator can rely on shallow-equal props.
   `inheritVariantsByCategory` from SalesOrderNew is a fresh object on every
   render but the only state it captures is LINE 1's variants, which change
   exactly when the user is interacting with LINE 1 anyway — i.e. exactly
   when we DO want the follower rows to re-render. */
const SoLineCardInner = ({
  index,
  draft,
  onChange,
  onRemove,
  canRemove,
  inheritVariantsByCategory,
  docNo,
  itemId,
  isEditing = true,
}: {
  index:     number;
  draft:     SoLineDraft;
  onChange:  (patch: Partial<SoLineDraft>) => void;
  onRemove:  () => void;
  canRemove: boolean;
  inheritVariantsByCategory?: Record<string, Record<string, unknown> | undefined>;
  docNo?:    string;
  itemId?:   string;
  isEditing?: boolean;
}) => {
  const maintQ   = useMaintenanceConfig('master');
  const maint    = maintQ.data?.data ?? null;
  const fabricsQ = useFabricTrackings();
  const fabrics  = fabricsQ.data ?? [];

  const [search, setSearch] = useState(draft.description || draft.itemCode || '');
  const [picked, setPicked]         = useState<MfgProductRow | null>(null);
  const [manualPrice, setManualPrice] = useState(false);
  const [showPicker, setShowPicker]   = useState(false);
  const [specialsOpen, setSpecialsOpen] = useState(false);
  /* Task #102 — Same gate the debtor autocomplete got in PR #99. Without
     this the product picker fired one /mfg-products?search=… request per
     keystroke even when the picker wasn't open (every render of an
     already-saved line re-issued the query for the description text). The
     200 ms debounce smooths fast typists; the length>=2 + showPicker
     enabled-flag guards the closed-picker + single-character cases. */
  const debouncedSearch = useDebouncedValue(search, 200);
  const trimmedSearch   = debouncedSearch.trim();
  const productsQuery = useMfgProducts({
    search:  trimmedSearch || undefined,
    enabled: showPicker && trimmedSearch.length >= 2,
  });
  const candidates = productsQuery.data ?? [];

  /* PR-F (Task #79) — Per-line photo state. */
  const uploadPhoto = useUploadSoItemPhoto();
  const deletePhoto = useDeleteSoItemPhoto();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const photoUrls = draft.photoUrls ?? [];
  const canShowPhotos = Boolean(draft.itemCode);
  const canMutatePhotos = canShowPhotos && Boolean(docNo) && Boolean(itemId) && isEditing;

  // Sync picker search box to the description after picking.
  useEffect(() => { setSearch(draft.description ?? ''); }, [draft.description]);

  const pickProduct = (p: MfgProductRow) => {
    setPicked(p);
    setManualPrice(false);
    const category = p.category.toLowerCase();
    /* PR #141 — Sofa-set inherit: same-category follower lines copy the
       master's variants on pick. PR #147 — reset overriddenKeys on a fresh
       pick so cascade can repopulate everything cleanly. */
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

  /* PR #136 — Auto-compute bedframe Total Height = Divan + Leg + Gap. */
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

  useEffect(() => {
    if (draft.itemGroup !== 'bedframe') return;
    if (!computedTotalHeight) return;
    if (String(draft.variants.totalHeight ?? '') === computedTotalHeight) return;
    onChange({ variants: { ...draft.variants, totalHeight: computedTotalHeight } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computedTotalHeight, draft.itemGroup]);

  /* PR #147 — Variant edits add the key to overriddenKeys so cascade
     leaves this line alone when LINE 1 changes. */
  const setVariant = (k: string, v: string | number | string[]) => {
    const nextOverrides = Array.from(new Set([...(draft.overriddenKeys ?? []), k]));
    onChange({
      variants: { ...draft.variants, [k]: v },
      overriddenKeys: nextOverrides,
    });
  };

  /* PR #127 — HOOKKA multi-select Special Orders. */
  const specialsList = (v: unknown): string[] => {
    if (Array.isArray(v)) return v.map(String).filter(Boolean);
    if (typeof v === 'string' && v) return [v];
    return [];
  };

  /* Auto-recompute unit price from base + Σ(variant surcharges). */
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

  /* Pricing breakdown summary (mirrors recompute formula). */
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

  const category = draft.itemGroup.toLowerCase();
  const badge = CATEGORY_BADGE[category] ?? CATEGORY_BADGE.others!;
  const hasVariants = Boolean(draft.itemCode) && Boolean(maint) && (category === 'bedframe' || category === 'sofa');
  const specials = specialsList(draft.variants.specials ?? draft.variants.special);

  /* ── Render ─────────────────────────────────────────────────────── */

  return (
    <div className={styles.card}>
      {/* ── Main single row ────────────────────────────────────────── */}
      <div className={styles.row}>
        {/* 1. No # */}
        <span className={styles.lineNo}>{index + 1}</span>

        {/* 2. Item picker (SKU search → code on top, description below) */}
        <div className={styles.pickerWrap}>
          {draft.itemCode && search === draft.description && !showPicker ? (
            <button
              type="button"
              className={styles.input}
              style={{ textAlign: 'left', cursor: isEditing ? 'pointer' : 'not-allowed', padding: '2px 8px', height: 'auto', minHeight: 28 }}
              disabled={!isEditing}
              onClick={() => { setShowPicker(true); setSearch(''); }}
              title="Click to change product"
            >
              <div className={styles.pickerInputCol}>
                <span className={styles.pickerCode}>{draft.itemCode}</span>
                <span className={styles.pickerDesc}>{draft.description}</span>
              </div>
            </button>
          ) : (
            <input
              className={styles.input}
              placeholder="Click to pick or type to filter…"
              value={search}
              disabled={!isEditing}
              onFocus={() => setShowPicker(true)}
              onBlur={() => setTimeout(() => setShowPicker(false), 150)}
              onChange={(e) => { setSearch(e.target.value); setShowPicker(true); }}
            />
          )}
          {showPicker && isEditing && candidates.length > 0 && (
            <ul className={styles.suggestList}>
              {candidates.slice(0, 50).map((p) => (
                <li
                  key={p.id}
                  className={styles.suggestItem}
                  onMouseDown={() => { pickProduct(p); setShowPicker(false); }}
                >
                  <div><span className={styles.suggestItemCode}>{p.code}</span></div>
                  <div className={styles.suggestItemMeta}>
                    {p.name} · {p.category} · {fmtRm(p.base_price_sen ?? 0)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {showPicker && isEditing && candidates.length === 0 && (
            <ul className={styles.suggestList}>
              <li className={styles.suggestItem} style={{ color: 'var(--fg-muted)', cursor: 'default' }}>
                {/* Task #102 — Distinguish "type more" (gate hasn't tripped)
                    from "no matches" (server returned []) so the user knows
                    why nothing is showing. */}
                {trimmedSearch.length < 2
                  ? 'Type at least 2 characters to search…'
                  : productsQuery.isFetching
                    ? 'Searching…'
                    : `No products match "${trimmedSearch}".`}
              </li>
            </ul>
          )}
        </div>

        {/* 3. Remarks */}
        <input
          className={styles.input}
          placeholder="Type remarks…"
          value={draft.remark}
          disabled={!isEditing}
          onChange={(e) => onChange({ remark: e.target.value })}
        />

        {/* 4. Qty */}
        <input
          type="number"
          min={1}
          className={styles.numericInput}
          value={draft.qty === 0 ? '' : draft.qty}
          disabled={!isEditing}
          onChange={(e) => {
            const v = e.target.value;
            onChange({ qty: v === '' ? 0 : (parseInt(v) || 0) });
          }}
          onBlur={(e) => {
            if (!e.target.value || parseInt(e.target.value) <= 0) onChange({ qty: 1 });
          }}
        />

        {/* 5. Unit Price */}
        <input
          type="number"
          step="0.01"
          className={styles.numericInput}
          value={(draft.unitPriceCenti / 100).toFixed(2)}
          disabled={!isEditing}
          onChange={(e) => {
            setManualPrice(true);
            onChange({ unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0 });
          }}
        />

        {/* 6. Delivery Date (2990 addition between Unit Price and Amount) */}
        <input
          type="date"
          className={styles.input}
          value={draft.lineDeliveryDate ?? ''}
          disabled={!isEditing}
          title={!draft.lineDeliveryDateOverridden && draft.lineDeliveryDate ? 'Auto-inherited from SO header' : undefined}
          onChange={(e) => onChange({
            lineDeliveryDate: e.target.value || null,
            lineDeliveryDateOverridden: true,
          })}
          style={
            !draft.lineDeliveryDateOverridden && draft.lineDeliveryDate
              ? { borderColor: 'var(--c-orange)', background: 'var(--c-cream)' }
              : undefined
          }
        />

        {/* 7. Amount */}
        <span className={styles.amount}>{fmtRm(lineTotal)}</span>

        {/* 8. Group badge */}
        <span className={styles.badge} style={{ background: badge.bg, color: badge.fg }}>
          {badge.label}
        </span>

        {/* 9. Trash — hidden when not editing */}
        {isEditing ? (
          <button
            type="button"
            title="Remove this line"
            onClick={onRemove}
            disabled={!canRemove}
            className={styles.trashBtn}
          >
            <Trash2 {...SM_ICON} />
          </button>
        ) : <span />}
      </div>

      {/* ── Variants section (BEDFRAME / SOFA only) ─────────────────── */}
      {hasVariants && category === 'bedframe' && (
        <div className={styles.variants}>
          <div className={styles.variantsHead}>BEDFRAME VARIANTS</div>
          <div className={styles.variantsGrid}>
            <VariantSelect
              label="Fabrics"
              value={String(draft.variants.fabricCode ?? '')}
              disabled={!isEditing}
              options={fabrics.map((f) => ({
                value: f.fabric_code,
                priceSen: 0,
                display: `${f.fabric_code}${f.series ? ` · ${f.series}` : ''}`,
              }))}
              onChange={(v) => setVariant('fabricCode', v)}
            />
            <VariantSelect
              label="Gaps"
              value={String(draft.variants.gap ?? '')}
              disabled={!isEditing}
              options={maint!.gaps.map((g) => ({ value: g, priceSen: 0 }))}
              onChange={(v) => setVariant('gap', v)}
            />
            <VariantSelect
              label="Divan Heights"
              value={String(draft.variants.divanHeight ?? '')}
              disabled={!isEditing}
              options={maint!.divanHeights}
              onChange={(v) => setVariant('divanHeight', v)}
            />
            <VariantSelect
              label="Leg Heights"
              value={String(draft.variants.legHeight ?? '')}
              disabled={!isEditing}
              options={maint!.legHeights}
              onChange={(v) => setVariant('legHeight', v)}
            />
          </div>
          {/* Computed Total Height marker — Houzs shows this read-only;
              we surface it as a small inline hint instead of a 5th cell. */}
          {computedTotalHeight && (
            <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
              Total height (auto):{' '}
              <strong style={{ color: 'var(--c-ink)', fontVariantNumeric: 'tabular-nums' }}>
                {computedTotalHeight}
              </strong>{' '}
              (Divan + Leg + Gap)
            </div>
          )}
          <SpecialsAccordion
            open={specialsOpen}
            onToggle={() => setSpecialsOpen((o) => !o)}
            picked={specials}
            options={maint!.specials}
            disabled={!isEditing}
            onChange={(arr) => setVariant('specials', arr)}
          />
        </div>
      )}

      {hasVariants && category === 'sofa' && (
        <div className={styles.variants}>
          <div className={styles.variantsHead}>SOFA VARIANTS</div>
          <div className={styles.variantsGrid}>
            <VariantSelect
              label="Fabrics"
              value={String(draft.variants.fabricCode ?? '')}
              disabled={!isEditing}
              options={fabrics.map((f) => ({
                value: f.fabric_code,
                priceSen: 0,
                display: `${f.fabric_code}${f.series ? ` · ${f.series}` : ''}`,
              }))}
              onChange={(v) => setVariant('fabricCode', v)}
            />
            <VariantSelect
              label="Seat Heights"
              value={String(draft.variants.seatHeight ?? '')}
              disabled={!isEditing}
              options={maint!.sofaSizes.map((s) => {
                const sh = picked?.seat_height_prices && Array.isArray(picked.seat_height_prices)
                  ? (picked.seat_height_prices as Array<{ height: string; tier: string; priceSen: number }>)
                      .find((p) => p.height === s && p.tier === 'PRICE_2')
                  : null;
                return { value: s, priceSen: sh?.priceSen ?? 0 };
              })}
              onChange={(v) => setVariant('seatHeight', v)}
            />
            <VariantSelect
              label="Leg Heights"
              value={String(draft.variants.legHeight ?? '')}
              disabled={!isEditing}
              options={maint!.sofaLegHeights}
              onChange={(v) => setVariant('legHeight', v)}
            />
            {/* Empty cell so the 4-col grid stays balanced */}
            <span />
          </div>
          <SpecialsAccordion
            open={specialsOpen}
            onToggle={() => setSpecialsOpen((o) => !o)}
            picked={specials}
            options={maint!.sofaSpecials}
            disabled={!isEditing}
            onChange={(arr) => setVariant('specials', arr)}
          />
        </div>
      )}

      {/* ── Photos strip (PR-F) ─────────────────────────────────────── */}
      {canShowPhotos && (
        <div className={styles.photos}>
          <div className={styles.photosHead}>
            PHOTOS{photoUrls.length > 0 && (
              <span style={{ marginLeft: 6, color: 'var(--c-ink)', fontWeight: 600 }}>· {photoUrls.length}</span>
            )}
          </div>
          <div className={styles.photosStrip}>
            {photoUrls.map((key) => (
              <PhotoThumb
                key={key}
                photoKey={key}
                docNo={docNo}
                itemId={itemId}
                canDelete={canMutatePhotos && !deletePhoto.isPending}
                onDelete={() => {
                  if (!docNo || !itemId) return;
                  deletePhoto.mutate({ docNo, itemId, photoKey: key }, {
                    onSuccess: () => {
                      onChange({ photoUrls: photoUrls.filter((k) => k !== key) });
                    },
                  });
                }}
              />
            ))}
            {canMutatePhotos && (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  style={{ display: 'none' }}
                  onChange={async (e) => {
                    const files = Array.from(e.target.files ?? []);
                    if (files.length === 0 || !docNo || !itemId) return;
                    const newKeys: string[] = [];
                    for (const f of files) {
                      try {
                        const res = await uploadPhoto.mutateAsync({ docNo, itemId, file: f });
                        newKeys.push(res.photoKey);
                        // Task #92 — seed the signed-URL cache with the
                        // URL the API just minted so PhotoThumb doesn't
                        // do a redundant /signed round-trip on first
                        // render of the just-uploaded photo.
                        if (res.expiresAt && res.photoUrl?.startsWith('http')) {
                          signedUrlCache.set(res.photoKey, {
                            signedUrl: res.photoUrl,
                            expiresAt: new Date(res.expiresAt).getTime(),
                          });
                        }
                      } catch (err) {
                        // eslint-disable-next-line no-console
                        console.error('[so-line-photo] upload failed:', err);
                        window.alert(`Photo upload failed for ${f.name}: ${err instanceof Error ? err.message : String(err)}`);
                      }
                    }
                    if (newKeys.length > 0) {
                      onChange({ photoUrls: [...photoUrls, ...newKeys] });
                    }
                    if (fileInputRef.current) fileInputRef.current.value = '';
                  }}
                />
                <button
                  type="button"
                  className={styles.photoAddBtn}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploadPhoto.isPending}
                  title={uploadPhoto.isPending ? 'Uploading…' : 'Add photo'}
                >
                  <ImagePlus {...ICON} />
                </button>
              </>
            )}
            {!canMutatePhotos && photoUrls.length === 0 && (
              <span className={styles.photoHint}>
                {!docNo || !itemId
                  ? 'Save the line first to attach photos.'
                  : 'Read-only — photos can be edited in edit mode.'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Pricing breakdown summary ───────────────────────────────── */}
      {picked && (
        <div className={styles.summary}>
          <span>Base <strong>{fmtRm(basePriceSen)}</strong></span>
          {extraSen > 0 && <span>+ Variants <strong>{fmtRm(extraSen)}</strong></span>}
          <span>· Unit <strong>{fmtRm(draft.unitPriceCenti)}</strong> × {draft.qty}</span>
          {draft.discountCenti > 0 && <span>− Disc <strong>{fmtRm(draft.discountCenti)}</strong></span>}
          {!manualPrice && (
            <span style={{ color: 'var(--c-orange)' }}>· auto-priced</span>
          )}
        </div>
      )}
    </div>
  );
};
SoLineCardInner.displayName = 'SoLineCard';

/* Task #103 — Wrapped in React.memo with the default shallow comparator.
   With the SO Detail page now passing stable per-row callbacks
   (rowCallbacks Map + patchAddingDraft useCallback), the memo skips
   re-renders when an unrelated row's draft state, an unrelated parent
   state (History drawer toggle, Edit-mode flip, payment table activity),
   or the routinely-stable header useQuery cache result changes. */
export const SoLineCard = memo(SoLineCardInner);

/* ──────────────────────────────────────────────────────────────────────
   VariantSelect — uniform <select> with label + optional "+RM x.xx" suffix
   ────────────────────────────────────────────────────────────────────── */

const VariantSelect = ({
  label, options, value, onChange, disabled = false,
}: {
  label:    string;
  options:  Array<{ value: string; priceSen: number; display?: string }>;
  value:    string;
  disabled?: boolean;
  onChange: (v: string) => void;
}) => (
  <label className={styles.variantField}>
    <span className={styles.variantLabel}>{label}</span>
    <select
      className={styles.select}
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    >
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.display ?? o.value}{o.priceSen > 0 ? ` (+${fmtRm(o.priceSen)})` : ''}
        </option>
      ))}
    </select>
  </label>
);

/* ──────────────────────────────────────────────────────────────────────
   SpecialsAccordion — collapsible checkbox grid (Houzs <details>)
   ────────────────────────────────────────────────────────────────────── */

const SpecialsAccordion = ({
  open, onToggle, picked, options, onChange, disabled = false,
}: {
  open:     boolean;
  onToggle: () => void;
  picked:   string[];
  options:  Array<{ value: string; priceSen: number }>;
  disabled?: boolean;
  onChange: (next: string[]) => void;
}) => {
  const toggle = (v: string) => {
    if (disabled) return;
    const next = picked.includes(v) ? picked.filter((x) => x !== v) : [...picked, v];
    onChange(next);
  };
  return (
    <div className={styles.specials}>
      <div
        className={styles.specialsHead}
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onToggle(); }}
      >
        {open ? <ChevronDown {...SM_ICON} /> : <ChevronRight {...SM_ICON} />}
        <span>Special Orders</span>
        <span className={styles.specialsCount}>({picked.length} selected)</span>
      </div>
      {open && (
        <div className={styles.specialsBody}>
          {options.length === 0 && (
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              No specials configured.
            </span>
          )}
          {options.map((o) => {
            const on = picked.includes(o.value);
            return (
              <label key={o.value} className={styles.specialsItem}>
                <input
                  type="checkbox"
                  className={styles.specialsCheckbox}
                  checked={on}
                  disabled={disabled}
                  onChange={() => toggle(o.value)}
                />
                <div>
                  <div className={styles.specialsLabel}>{o.value}</div>
                  <div className={styles.specialsSurcharge}>
                    {o.priceSen > 0 ? `+${fmtRm(o.priceSen)}` : 'RM 0'}
                  </div>
                </div>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
};

/* ──────────────────────────────────────────────────────────────────────
   PhotoThumb — Task #92 signed-URL flow
   ──────────────────────────────────────────────────────────────────────
   Previously this fetched bytes through an authed Worker proxy on every
   thumbnail render (N photos × N renders = N² Worker invocations). Now
   each photoKey has a short-lived signed R2 GET URL we use directly as
   <img src>. Cache layout:
     - Module-level Map<photoKey, { signedUrl, expiresAt }> — survives
       component unmounts (e.g. drawer open/close) within a single page
       load, so reopening a SO doesn't re-sign every thumb.
     - SKEW_BUFFER_MS — treat URLs within 30s of expiry as already
       expired. Avoids the race where a URL passes our check, then 401s
       at the browser because the clock drifted or R2's check fires
       slightly later.
     - On <img onError>, retry once with a fresh URL. The signed URL
       MIGHT have expired between cache check and HTTP fetch, or the
       cached entry pre-dated some R2 token-rotation event. One retry
       is enough; a second failure means the photo is genuinely gone.
   ────────────────────────────────────────────────────────────────────── */

const SIGNED_URL_SKEW_BUFFER_MS = 30_000;
const signedUrlCache = new Map<string, { signedUrl: string; expiresAt: number }>();

const isCachedUrlFresh = (entry: { expiresAt: number } | undefined): boolean =>
  !!entry && entry.expiresAt - SIGNED_URL_SKEW_BUFFER_MS > Date.now();

const PhotoThumb = ({
  photoKey, docNo, itemId, canDelete, onDelete,
}: {
  photoKey:  string;
  docNo?:    string;
  itemId?:   string;
  canDelete: boolean;
  onDelete:  () => void;
}) => {
  const [src, setSrc]     = useState<string | null>(() => {
    const cached = signedUrlCache.get(photoKey);
    return isCachedUrlFresh(cached) ? cached!.signedUrl : null;
  });
  const [error, setError] = useState<string | null>(null);
  // Tracks whether we've already retried after a 403/error. Prevents
  // a permanently-broken key from looping forever.
  const retriedRef = useRef(false);

  const loadSignedUrl = async (cancelled: () => boolean) => {
    if (!docNo || !itemId) return;
    try {
      const { signedUrl, expiresAt } = await fetchSoItemPhotoSignedUrl(docNo, itemId, photoKey);
      if (cancelled()) return;
      signedUrlCache.set(photoKey, {
        signedUrl,
        expiresAt: new Date(expiresAt).getTime(),
      });
      setSrc(signedUrl);
      setError(null);
    } catch (e) {
      if (!cancelled()) setError(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    let cancelled = false;
    const cached = signedUrlCache.get(photoKey);
    if (isCachedUrlFresh(cached)) {
      setSrc(cached!.signedUrl);
      return;
    }
    // Cache miss or stale entry — fetch a fresh signed URL.
    loadSignedUrl(() => cancelled);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docNo, itemId, photoKey]);

  const handleImgError = () => {
    // The signed URL we handed to <img src> didn't load. Most likely
    // it expired (cache survived a tab being suspended for >1 hour);
    // could also be an R2 transient. Drop the cache entry and refetch
    // once. retriedRef prevents an infinite onError → setState loop
    // if the new URL also fails.
    if (retriedRef.current) {
      setError('image_load_failed');
      return;
    }
    retriedRef.current = true;
    signedUrlCache.delete(photoKey);
    setSrc(null);
    let cancelled = false;
    loadSignedUrl(() => cancelled);
    // No cleanup return — this isn't an effect; the cancelled flag
    // is only meaningful if the component unmounts mid-fetch, which
    // would also blow away the setState calls harmlessly.
    void cancelled;
  };

  return (
    <div className={styles.photoTile}>
      {src ? (
        <img src={src} alt="Line photo" onError={handleImgError} />
      ) : error ? (
        <span className={styles.photoError} title={error}>err</span>
      ) : (
        <span className={styles.photoPlaceholder}>…</span>
      )}
      {canDelete && (
        <button
          type="button"
          className={styles.photoDelete}
          onClick={onDelete}
          title="Remove photo"
        >
          <X size={12} strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
};
