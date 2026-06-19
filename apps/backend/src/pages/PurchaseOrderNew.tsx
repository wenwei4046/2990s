// ----------------------------------------------------------------------------
// PurchaseOrderNew — full-page Create PO at /purchase-orders/new (PR #97).
//
// Commander 2026-05-26 (AutoCount parity): "Create PO 也要像这样子啊". The
// old side-drawer is gone — replaced with a single full-page form that
// mirrors AutoCount's "New Purchase Order" window: 2-col header above an
// inline-editable items table.
//
// PR #103 — Layout fix: original landed using class names that don't exist
// on SalesOrderDetail.module.css (header / titleRow / cardHeadRow / itemsTable).
// CSS modules silently return undefined for missing keys, so half the page
// fell back to default block layout. Switched to the real class names
// (headerRow / titleBlock / cardHeader / cardBody / table / formGrid2) and
// dropped the inline `grid-template-columns` in favour of formGrid2 + a
// dedicated `.itemsGrid` table column setup.
// ----------------------------------------------------------------------------

import { todayMyt } from '../lib/dates';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Plus, Save, X, ArrowRightLeft } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useCreatePurchaseOrder,
  useSuppliers,
  useSupplierDetail,
  useSuppliersForMaterial,
  type BindingRow,
  type NewPoItem,
  type OutstandingSoItem,
} from '../lib/suppliers-queries';
import { useMfgProducts, useMaintenanceConfig, useSpecialAddons } from '../lib/mfg-products-queries';
import { useFabricTrackings } from '../lib/fabric-queries';
import { useWarehouses } from '../lib/inventory-queries';
import {
  computeMfgPoUnitCost,
  type MfgFabricTier,
  type PoPriceMatrix,
} from '@2990s/shared/mfg-pricing';
import { PoLineCard, emptyPoLine, type PoLineDraft } from '../components/PoLineCard';
import { ActionResultDialog } from '../components/ActionResultDialog';
import { useNotify } from '../components/NotifyDialog';
import styles from './SalesOrderDetail.module.css';

const ICON    = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/* Per-line draft row. The shape (incl. the §PR #126 variant payload + Phase 3
   priceTouched override flag) now lives on the shared PoLineCard as PoLineDraft
   so Create + Edit share one editor; alias it locally to keep this file's
   references terse. The DraftLine-only `soItemId` (the source SO line for
   From-SO converts) rides on PoLineDraft too. */
type DraftLine = PoLineDraft;
const newLine = emptyPoLine;

export const PurchaseOrderNew = () => {
  const navigate = useNavigate();
  const create   = useCreatePurchaseOrder();
  const notify   = useNotify();

  // ── Header state ────────────────────────────────────────────────────
  const [supplierId, setSupplierId]   = useState<string>('');
  const [poDate, setPoDate]           = useState<string>(() => todayMyt());
  const [expectedAt, setExpectedAt]   = useState<string>('');
  /* Supplier-revised header delivery dates (migration 0180). Optional; the
     supplier pushes the delivery back. These fan out to each line's matching
     per-line date on the server (a line's own override survives). */
  const [supplierDeliveryDate2, setSupplierDeliveryDate2] = useState<string>('');
  const [supplierDeliveryDate3, setSupplierDeliveryDate3] = useState<string>('');
  const [supplierDeliveryDate4, setSupplierDeliveryDate4] = useState<string>('');
  const [purchaseLocationId, setPurchaseLocationId] = useState<string>('');
  const [notes, setNotes]             = useState<string>('');

  // ── Items state ─────────────────────────────────────────────────────
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);

  /* Commander 2026-05-29 (BUG 2) — in-app result dialog. Used to surface the
     "一张 PO 只能一个 supplier" guard when From-SO picks belong to a different
     supplier than the one this PO is already bound to. */
  const [dialog, setDialog] = useState<{ title: string; body: string } | null>(null);


  // ── Data ────────────────────────────────────────────────────────────
  const suppliers       = useSuppliers({ status: 'ACTIVE' });
  const supplierDetail  = useSupplierDetail(supplierId || null);
  const warehouses      = useWarehouses();
  const supplier        = supplierDetail.data?.supplier ?? null;
  const bindings        = useMemo(() => supplierDetail.data?.bindings ?? [], [supplierDetail.data?.bindings]);
  const currency        = supplier?.currency ?? 'MYR';

  // PR #114 — Commander 2026-05-26: "逻辑上应该可以让我选 Item，选好之后
  // Supplier 的范围再缩小到目前供货这个 Item 的几个供应商". Item-first
  // picking — item input is enabled even when supplier is unset; the
  // datalist falls back to the full mfg_products list when no supplier is
  // picked. Picking an item triggers a reverse lookup against the
  // existing GET /suppliers/material/:kind/:code endpoint. Outcome:
  //   1 binding   → auto-set supplier + pull the binding's price/SKU
  //   N bindings  → show a hint banner so commander picks above
  //   0 bindings  → one-off purchase, commander enters everything manually
  const allSkus = useMfgProducts();
  /* PR #126 — Pull maintenance config + fabrics list so per-category variant
     editors can render the same dropdowns SO uses (single source of truth).
     PR #208 — when a supplier is picked, surcharges resolve from the supplier
     scope first (commander's per-supplier price book) and fall back to the
     master / selling-price config when no supplier row exists. The query is
     gated so a no-supplier PO doesn't fire a doomed lookup. */
  const supplierMaintQ = useMaintenanceConfig(
    supplierId ? `supplier:${supplierId}` : '',
    { enabled: Boolean(supplierId) },
  );
  const masterMaintQ = useMaintenanceConfig('master', {
    enabled: !supplierId || !supplierMaintQ.data?.data,
  });
  const maint =
    supplierMaintQ.data?.data ?? masterMaintQ.data?.data ?? null;
  const fabrics = useFabricTrackings().data ?? [];

  // Special Orders pool from special_addons (Backend↔POS parity, Loo
  // 2026-06-08), filtered by category — replaces legacy maint.specials /
  // maint.sofaSpecials. `code` shares the old value namespace.
  const specialAddonsQ = useSpecialAddons();
  const specialsPools = useMemo(() => {
    const rows = (specialAddonsQ.data ?? [])
      .filter((r) => r.active)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    const pick = (cat: string) => rows.filter((r) => r.categories.includes(cat)).map((r) => ({ value: r.code, priceSen: 0 }));
    return { bedframe: pick('BEDFRAME'), sofa: pick('SOFA') };
  }, [specialAddonsQ.data]);

  /* PR #126 — Helper: look up an mfg_product by code → returns its category
     (lowercased). Used by both supplier-first and item-first flows to tag
     the line with which variant editor to show. */
  const categoryForCode = (code: string): string | undefined => {
    const sku = (allSkus.data ?? []).find((p) => p.code === code);
    return sku?.category.toLowerCase();
  };
  const [pendingItemPick, setPendingItemPick] = useState<{ rid: string; code: string } | null>(null);
  const itemSuppliersQuery = useSuppliersForMaterial(
    pendingItemPick ? 'mfg_product' : null,
    pendingItemPick?.code ?? null,
  );
  useEffect(() => {
    if (!pendingItemPick) return;
    if (supplierId) { setPendingItemPick(null); return; }
    if (itemSuppliersQuery.isLoading) return;
    const matches = itemSuppliersQuery.data?.bindings ?? [];
    const b = matches[0];
    if (matches.length === 1 && b) {
      // Exactly one supplier binds this — adopt it + autofill the line.
      setSupplierId(b.supplier.id);
      setLines((prev) => prev.map((l) => (l.rid === pendingItemPick.rid ? {
        ...l,
        bindingId:      b.id,
        materialKind:   b.material_kind,
        materialCode:   b.material_code,
        materialName:   b.material_name,
        supplierSku:    b.supplier_sku,
        unitPriceCenti: b.unit_price_centi,
        category:       categoryForCode(b.material_code) ?? l.category,
      } : l)));
      setPendingItemPick(null);
    }
    // N > 1 — leave pendingItemPick set so the hint banner renders.
    // 0      — keep pendingItemPick so the "no bindings, free entry" hint renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- categoryForCode is a stable code→category lookup, not a reactive trigger
  }, [pendingItemPick, supplierId, itemSuppliersQuery.isLoading, itemSuppliersQuery.data]);

  // Item-first companion effect — once supplier resolves (commander clicked a
  // hint banner link, or picked manually after typing an item), backfill any
  // line whose materialCode matches a binding but lacks a bindingId. Mirrors
  // pickBinding without forcing commander to re-type the code.
  useEffect(() => {
    if (!supplierId || bindings.length === 0) return;
    setLines((prev) => prev.map((l) => {
      if (l.bindingId || !l.materialCode) return l;
      const b = bindings.find((x) => x.material_code === l.materialCode);
      if (!b) return l;
      return {
        ...l,
        bindingId:      b.id,
        materialKind:   b.material_kind,
        materialName:   b.material_name,
        supplierSku:    b.supplier_sku,
        unitPriceCenti: l.unitPriceCenti || b.unit_price_centi,
        category:       l.category ?? categoryForCode(b.material_code),
      };
    }));
    // Banner has done its job once a supplier is chosen.
    setPendingItemPick(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- categoryForCode is a stable code→category lookup, not a reactive trigger
  }, [supplierId, bindings]);

  // PR #115 — Commander 2026-05-26: "Purchase Location 已经换了，可是下面的
  // Warehouse 还没换". Header values fan out to all lines whenever they
  // change — commander can still override any single line afterwards, but
  // a fresh header change will overwrite again (matches AutoCount: header
  // is the source of truth, lines inherit until explicitly diverged).
  // Same pattern for Expected Delivery → per-line Delivery Date.
  useEffect(() => {
    if (!purchaseLocationId) return;
    setLines((prev) => prev.map((l) => ({ ...l, warehouseId: purchaseLocationId })));
  }, [purchaseLocationId]);
  useEffect(() => {
    if (!expectedAt) return;
    setLines((prev) => prev.map((l) => ({ ...l, deliveryDate: expectedAt })));
  }, [expectedAt]);

  /* "From SO" → add the picked SO lines into THIS form (Commander 2026-05-29).
     A PO is one supplier, so adopt the picks' main supplier; the binding /
     price backfill effects above then fill each line's supplier SKU + cost.

     Commander 2026-05-29 (BUG 2) — a PO is ONE supplier. The picker greys out
     other suppliers within a session, but the form may already be bound to a
     supplier (a creditor was chosen, or earlier From-SO picks set one) before a
     SECOND From-SO trip brings back a DIFFERENT supplier's lines. Guard here:
     resolve the form's current supplier, and only append picks that match it.
     If the form has no supplier yet, adopt the picks' supplier (old behaviour).
     Mismatched picks are dropped and surfaced via the result dialog. */
  const applyFromSo = (picks: Array<OutstandingSoItem & { _pickQty?: number }>) => {
    if (picks.length === 0) return;

    // The supplier CODE the form is already bound to (if any): explicit creditor
    // wins; else fall back to the first existing non-empty line's resolved
    // binding supplier code.
    const formSupplierCode = (() => {
      if (supplierId) {
        return (suppliers.data ?? []).find((s) => s.id === supplierId)?.code ?? null;
      }
      const existing = lines.find((l) => l.materialCode.trim());
      if (!existing) return null;
      const b = existing.bindingId
        ? bindings.find((x) => x.id === existing.bindingId)
        : bindings.find((x) => x.material_code === existing.materialCode);
      // bindings only resolve once a supplierId is set, so this is mostly a
      // no-op when supplierId is empty — the explicit-creditor branch above is
      // the real guard. Returned for completeness.
      return b ? (suppliers.data ?? []).find((s) => s.id === b.supplier_id)?.code ?? null : null;
    })();

    // The picks' bound supplier — first pick that HAS a main supplier.
    const picksSupplierCode = picks.find((p) => p.mainSupplierCode)?.mainSupplierCode ?? null;

    if (formSupplierCode && picksSupplierCode && picksSupplierCode !== formSupplierCode) {
      // Whole batch belongs to a different supplier — reject all, tell the user.
      setDialog({
        title: 'One supplier per PO',
        body: `These Sales Order lines belong to supplier ${picksSupplierCode}, but this PO is already bound to ${formSupplierCode}. Clear this PO first, or start a new PO to convert them.`,
      });
      return;
    }

    // When the form is already bound, only keep picks that match (or are unbound
    // — they ride as one-off lines under the current creditor). Drop the rest.
    const keep = formSupplierCode
      ? picks.filter((p) => !p.mainSupplierCode || p.mainSupplierCode === formSupplierCode)
      : picks;
    const dropped = picks.length - keep.length;

    // No supplier yet → adopt the picks' supplier (old behaviour); the binding /
    // price backfill effects then fill each line's supplier SKU + cost.
    if (!formSupplierCode && picksSupplierCode) {
      const sup = (suppliers.data ?? []).find((s) => s.code === picksSupplierCode);
      if (sup) setSupplierId(sup.id);
    }

    if (keep.length === 0) {
      setDialog({
        title: 'One supplier per PO',
        body: `No lines match supplier ${formSupplierCode}. Lines from other suppliers were skipped — clear this PO or start a new one.`,
      });
      return;
    }

    const mapped: DraftLine[] = keep.map((p) => ({
      rid: `l${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      materialKind: 'mfg_product',
      materialCode: p.itemCode,
      materialName: p.description ?? p.itemCode,
      qty: p._pickQty ?? (p.remainingQty > 0 ? p.remainingQty : p.qty),
      unitPriceCenti: 0,
      variants: (p.variants ?? {}) as Record<string, unknown>,
      category: categoryForCode(p.itemCode),
      deliveryDate: p.lineDeliveryDate ?? p.deliveryDate ?? undefined,
      // Commander 2026-05-29 (BUG 1) — remember the source SO line so the
      // create call can increment its po_qty_picked (drops it from the picker).
      soItemId: p.soItemId,
    }));
    // Replace the initial blank line if the form is still empty; else append.
    setLines((prev) => (prev.some((l) => l.materialCode.trim()) ? [...prev, ...mapped] : mapped));

    /* Commander 2026-05-29 — carry the SO's header context onto the PO so the
       buyer doesn't re-key it: "为什么 convert 进来不会把 SO 的 Purchase
       Location 跟 Delivery Date 带过来呢？SO 的 Delivery Date 就等于我们的
       Expected Delivery Date". Use functional setState with `cur ||` so an
       already-set value (e.g. restored draft) wins; otherwise adopt the SO's.
         · Expected Delivery ← SO line delivery date (else SO header date)
         · Purchase Location ← SO sales_location (a warehouse CODE) resolved to
           the matching warehouse id in the Purchase Location dropdown. */
    const firstDelivery = keep.map((p) => p.lineDeliveryDate ?? p.deliveryDate).find(Boolean) ?? null;
    if (firstDelivery) setExpectedAt((cur) => cur || firstDelivery);
    const firstLoc = keep.map((p) => p.salesLocation).find(Boolean) ?? null;
    if (firstLoc) {
      const wh = (warehouses.data ?? []).find((w) => w.code === firstLoc || w.name === firstLoc);
      if (wh) setPurchaseLocationId((cur) => cur || wh.id);
    }

    // If some (but not all) picks were a supplier mismatch, tell the user what
    // was skipped so the omission isn't silent.
    if (dropped > 0) {
      setDialog({
        title: 'Some lines skipped',
        body: `Added ${keep.length} line(s) for supplier ${formSupplierCode}. The other ${dropped} line(s) belong to different suppliers and were skipped — one supplier per PO.`,
      });
    }
  };

  /* Commander 2026-05-29 — when the From-SO grid hands back a selection, it
     stashes the picked rows in sessionStorage and returns here. Apply them once
     suppliers have loaded (so the creditor can resolve), then clear.

     Commander 2026-05-29 (fix) — clicking "From SO" NAVIGATES away, which
     unmounts this form and wipes the lines you already added. So before
     leaving we stash the whole draft (header + lines) under `poNewDraft`; on
     return we RESTORE that draft first, then applyFromSo APPENDS the new picks
     to it (instead of the old behaviour where the remounted form started blank
     and the picks replaced everything). The draft is only consumed when picks
     are actually present; a stale draft (user cancelled the picker) is dropped
     on the next New-PO mount. */
  const appliedFromSoRef = useRef(false);
  useEffect(() => {
    if (appliedFromSoRef.current || suppliers.isLoading) return;
    let rawPicks: string | null = null;
    try { rawPicks = sessionStorage.getItem('poFromSoPicks'); } catch { /* ignore */ }
    /* Commander 2026-05-30 — restore the stashed draft REGARDLESS of whether
       picks came back. If the operator hit Cancel on the picker, picks are
       absent but they STILL want their in-progress lines/header back — losing
       the draft on Cancel was the original complaint. The draft is cleared
       once it's been read so a fresh /new visit (no draft) starts blank. */
    let draft: {
      supplierId?: string; poDate?: string; expectedAt?: string;
      purchaseLocationId?: string; notes?: string; lines?: DraftLine[];
    } | null = null;
    try {
      const rawDraft = sessionStorage.getItem('poNewDraft');
      if (rawDraft) draft = JSON.parse(rawDraft);
    } catch { /* ignore */ }
    try { sessionStorage.removeItem('poNewDraft'); } catch { /* ignore */ }

    appliedFromSoRef.current = true;
    try {
      // Restore the prior draft (header + lines) FIRST so any picks append.
      if (draft) {
        if (draft.supplierId)         setSupplierId(draft.supplierId);
        if (draft.poDate)             setPoDate(draft.poDate);
        if (draft.expectedAt)         setExpectedAt(draft.expectedAt);
        if (draft.purchaseLocationId) setPurchaseLocationId(draft.purchaseLocationId);
        if (draft.notes)              setNotes(draft.notes);
        if (Array.isArray(draft.lines) && draft.lines.length) setLines(draft.lines);
      }
      if (rawPicks) {
        sessionStorage.removeItem('poFromSoPicks');
        const rows = JSON.parse(rawPicks) as Array<OutstandingSoItem & { _pickQty?: number }>;
        if (Array.isArray(rows) && rows.length) applyFromSo(rows);
      }
    } catch { /* malformed — ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suppliers.isLoading]);

  /* Persist the in-progress draft, then go to the full-page From-SO picker.
     Restored on return (see the effect above) so the picked lines APPEND to
     what's already here instead of resetting the form. */
  const goToFromSo = () => {
    try {
      sessionStorage.setItem('poNewDraft', JSON.stringify({
        supplierId, poDate, expectedAt, purchaseLocationId, notes, lines,
      }));
    } catch { /* quota — fall through, picks still apply */ }
    navigate('/purchase-orders/from-so');
  };

  /* Phase 3 (2026-05-29) — Resolve the fabric tier for a line from the
     `fabrics` list by the line's `variants.fabricCode`, split per category
     (sofa → sofa_price_tier, bedframe → bedframe_price_tier), mirroring
     SoLineCard. Returns null for non-tiered categories or when no fabric /
     tier is set → the cost engine then defaults to P2. */
  const fabricTierForLine = (line: DraftLine): MfgFabricTier | null => {
    const code = String(line.variants.fabricCode ?? '');
    if (!code) return null;
    const f = fabrics.find((x) => x.fabric_code === code);
    if (!f) return null;
    const cat = line.category?.toLowerCase();
    if (cat === 'sofa')     return f.sofa_price_tier ?? f.price_tier ?? null;
    if (cat === 'bedframe') return f.bedframe_price_tier ?? f.price_tier ?? null;
    return null;
  };

  /* Phase 3 (2026-05-29) — Auto-fill a PO line's unit COST from the SUPPLIER's
     own price table (binding.price_matrix) + that supplier's maintenance
     surcharges, instead of the flat binding.unit_price_centi. Falls back to
     the flat binding price when there's no binding / matrix / maint, and is a
     no-op (returns the line's current cost) when the operator has manually
     overridden the price (priceTouched). Combos are OUT OF SCOPE this phase —
     PO lines are per-SKU, so there's no combo override here. */
  const recomputeLineCost = (line: DraftLine): number => {
    // Find the line's binding: by id when known, else by material_code.
    const binding = line.bindingId
      ? bindings.find((b) => b.id === line.bindingId)
      : bindings.find((b) => b.material_code === line.materialCode);
    if (!binding) return line.unitPriceCenti;
    // No maint config loaded yet (or none seeded) → don't crash / zero out;
    // computeMfgPoUnitCost still returns the matrix/flat base with no
    // surcharges, which is the right fallback.
    const category = (line.category?.toUpperCase() ?? '') as
      'BEDFRAME' | 'SOFA' | 'MATTRESS' | 'ACCESSORY' | 'SERVICE' | '';
    if (!category) return binding.unit_price_centi;
    const v = line.variants;
    const specials = Array.isArray(v.specials) ? (v.specials as string[]) : [];
    const breakdown = computeMfgPoUnitCost(
      {
        category,
        priceMatrix:    (binding.price_matrix ?? null) as PoPriceMatrix,
        unitPriceCenti: binding.unit_price_centi,
        fabricTier:     fabricTierForLine(line),
        // Sofa seat SIZE lives on variants.seatHeight; sofa leg height is the
        // same variants.legHeight field (the editor only renders one leg input).
        seatSize:       category === 'SOFA' ? (v.seatHeight as string | undefined) ?? null : null,
        divanHeight:    (v.divanHeight as string | undefined) ?? null,
        legHeight:      category === 'BEDFRAME' ? (v.legHeight as string | undefined) ?? null : null,
        sofaLegHeight:  category === 'SOFA' ? (v.legHeight as string | undefined) ?? null : null,
        // Bedframe Total Heights surcharge — Commander 2026-05-29: picking a
        // total height now re-prices the line (engine reads totalHeights).
        totalHeight:    (v.totalHeight as string | undefined) ?? null,
        specials,
      },
      maint,
    );
    return breakdown.unitPriceSen;
  };

  // ── Helpers ─────────────────────────────────────────────────────────
  const setLine  = (rid: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const addLine  = () => setLines((prev) => [...prev, { ...newLine(), warehouseId: purchaseLocationId || undefined, deliveryDate: expectedAt || undefined }]);
  const dropLine = (rid: string) => setLines((prev) =>
    prev.length === 1 ? [newLine()] : prev.filter((l) => l.rid !== rid),
  );

  const pickBinding = (rid: string, b: BindingRow) => {
    setLine(rid, {
      bindingId:      b.id,
      materialKind:   b.material_kind,
      materialCode:   b.material_code,
      materialName:   b.material_name,
      supplierSku:    b.supplier_sku,
      unitPriceCenti: b.unit_price_centi,
      category:       categoryForCode(b.material_code),
      // Phase 3 — picking a (new) SKU re-arms supplier-price auto-fill; the
      // auto-pricing effect below then overwrites the flat seed with the
      // matrix + maintenance cost (mirrors SoLineCard re-enabling on re-pick).
      priceTouched:   false,
    });
  };

  /* PR #126 — Patch only the variants bag for a line. Used by per-category
     editors so other line fields (qty, price, supplier SKU) stay untouched.
     Commander 2026-05-29: bedframe Total Height is NOT a manual pick — it's
     AUTO-COMPUTED = Divan + Leg + Gap (mirrors SoLineCard), so we recompute it
     here whenever one of those three changes. */
  const parseInches = (s: unknown): number => {
    if (s == null) return 0;
    const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
    return m && m[1] ? Number(m[1]) : 0;
  };
  const setVariant = (rid: string, k: string, v: unknown) =>
    setLines((prev) => prev.map((l) => {
      if (l.rid !== rid) return l;
      const variants: Record<string, unknown> = { ...l.variants, [k]: v };
      if (l.category === 'bedframe' && (k === 'divanHeight' || k === 'legHeight' || k === 'gap')) {
        const d = parseInches(variants.divanHeight);
        const lg = parseInches(variants.legHeight);
        const g = parseInches(variants.gap);
        variants.totalHeight = (d === 0 && lg === 0 && g === 0) ? '' : `${d + lg + g}"`;
      }
      return { ...l, variants };
    }));

  /* Phase 3 (2026-05-29) — Auto-fill each line's unit COST from the supplier
     price table + maintenance surcharges whenever a binding is picked
     (pickBinding / the two item-first effects) or variants change (setVariant).
     Centralised here so all those paths share one recompute. A manually
     overridden line (priceTouched) is left alone — the manual value wins.
     Updates only lines whose computed cost differs from the current value, so
     this doesn't loop. */
  useEffect(() => {
    setLines((prev) => {
      let changed = false;
      const next = prev.map((l) => {
        if (l.priceTouched) return l;
        const cost = recomputeLineCost(l);
        if (cost === l.unitPriceCenti) return l;
        changed = true;
        return { ...l, unitPriceCenti: cost };
      });
      return changed ? next : prev;
    });
    // recomputeLineCost closes over bindings / fabrics / maint; re-run when any
    // of those (or the lines' pricing-relevant fields) change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bindings, fabrics, maint, lines]);

  const subtotalCenti = useMemo(
    () => lines.reduce(
      (s, l) => s + Math.max(0, l.qty * l.unitPriceCenti - (l.discountCenti ?? 0)),
      0,
    ),
    [lines],
  );

  const onSave = () => {
    if (!supplierId) {
      notify({ title: 'Pick a Creditor (supplier) first.', tone: 'error' });
      return;
    }
    // PR #157 — Commander 2026-05-26: "这些没有 expected delivery date 和
    // purchase location，为什么能生成 PO 呢？" Both fields are required on
    // submit — they fan out to per-line warehouse + delivery date and are
    // needed downstream for GRN. Defense-in-depth: API also rejects missing.
    if (!expectedAt) {
      notify({ title: 'Expected Delivery date is required.', tone: 'error' });
      return;
    }
    if (!purchaseLocationId) {
      notify({ title: 'Purchase Location is required.', tone: 'error' });
      return;
    }
    const validLines = lines.filter((l) => l.materialCode.trim() && l.qty > 0);
    const items: NewPoItem[] = validLines.map((l) => ({
      materialKind:   l.materialKind,
      materialCode:   l.materialCode,
      materialName:   l.materialName || l.materialCode,
      supplierSku:    l.supplierSku,
      qty:            l.qty,
      unitPriceCenti: l.unitPriceCenti,
      bindingId:      l.bindingId,
      discountCenti:  l.discountCenti,
      deliveryDate:   l.deliveryDate || undefined,
      /* Migration 0180 — per-line supplier-revised delivery dates. */
      supplierDeliveryDate2: l.supplierDeliveryDate2 || undefined,
      supplierDeliveryDate3: l.supplierDeliveryDate3 || undefined,
      supplierDeliveryDate4: l.supplierDeliveryDate4 || undefined,
      warehouseId:    l.warehouseId  || undefined,
      /* PR #126 — Per-line variants + itemGroup. NewPoItem already supports
         these (PR #41 schema). The API §POST handler persists them onto
         purchase_order_items.variants JSONB / item_group. */
      itemGroup:      l.category,
      variants:       Object.keys(l.variants).length ? l.variants : undefined,
      // Commander 2026-05-29 (BUG 1) — pass the source SO line id (when this
      // line came from "From SO") so the API rolls po_qty_picked forward and
      // the line disappears from the From-SO picker.
      soItemId:       l.soItemId ?? null,
    }));

    create.mutate(
      {
        supplierId,
        currency,
        poDate,
        expectedAt,
        /* Migration 0180 — supplier-revised header delivery dates. */
        supplierDeliveryDate2: supplierDeliveryDate2 || undefined,
        supplierDeliveryDate3: supplierDeliveryDate3 || undefined,
        supplierDeliveryDate4: supplierDeliveryDate4 || undefined,
        notes: notes || undefined,
        purchaseLocationId,
        items,
      },
      {
        onSuccess: (res) => navigate(`/purchase-orders/${res.id}`),
        onError:   (err) => notify({ title: 'Save failed', body: `${err instanceof Error ? err.message : String(err)}`, tone: 'error' }),
      },
    );
  };

  return (
    <div className={styles.page}>
      {/* Top bar — same shape as PurchaseOrderDetail */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Purchase Orders</span>
          </Link>
          <h1 className={styles.title}>New Purchase Order</h1>
        </div>
        <div className={styles.actions}>
          {/* PR — Commander 2026-05-27: parity with PO list — quick swap into
              the SO-driven flow without bouncing back to the list page. */}
          <Button variant="ghost" size="md" onClick={goToFromSo}>
            <ArrowRightLeft {...ICON} /> From Sales Order
          </Button>
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase-orders')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={create.isPending}
          >
            <Save {...ICON} />
            {/* PR #131 + 0078 — POST creates SUBMITTED; DRAFT removed entirely. */}
            {create.isPending ? 'Saving…' : 'Create Purchase Order'}
          </Button>
        </div>
      </div>

      {/* Header card — 2-column grid */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Header</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            {/* LEFT column */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Creditor *</span>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className={styles.fieldInput}
              >
                <option value="">— Pick a supplier —</option>
                {(suppliers.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                ))}
              </select>
            </label>

            {/* RIGHT column */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>P/O No</span>
              <input
                type="text"
                readOnly
                value="(assigned on Save)"
                className={styles.fieldInput}
                style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Name</span>
              <input
                type="text"
                readOnly
                value={supplier?.name ?? ''}
                placeholder="(auto-filled when supplier selected)"
                className={styles.fieldInput}
                style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Date *</span>
              <input
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className={styles.fieldInput}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Address</span>
              <textarea
                readOnly
                value={[supplier?.address, supplier?.area, supplier?.postcode, supplier?.state, supplier?.country]
                  .filter(Boolean).join(', ')}
                placeholder="(auto-filled when supplier selected)"
                className={styles.fieldInput}
                style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)', minHeight: 52, resize: 'vertical' }}
                rows={3}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Expected Delivery *</span>
              <input
                type="date"
                value={expectedAt}
                onChange={(e) => setExpectedAt(e.target.value)}
                className={styles.fieldInput}
                required
              />
            </label>

            {/* Supplier-revised header delivery dates (migration 0180). Optional —
                set when the supplier pushes the delivery back. The latest non-empty
                date becomes the effective ETA downstream. */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier Delivery Date 2</span>
              <input
                type="date"
                value={supplierDeliveryDate2}
                onChange={(e) => setSupplierDeliveryDate2(e.target.value)}
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier Delivery Date 3</span>
              <input
                type="date"
                value={supplierDeliveryDate3}
                onChange={(e) => setSupplierDeliveryDate3(e.target.value)}
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier Delivery Date 4</span>
              <input
                type="date"
                value={supplierDeliveryDate4}
                onChange={(e) => setSupplierDeliveryDate4(e.target.value)}
                className={styles.fieldInput}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Purchase Location *</span>
              <select
                value={purchaseLocationId}
                onChange={(e) => setPurchaseLocationId(e.target.value)}
                className={styles.fieldInput}
                required
              >
                <option value="">— Pick a warehouse —</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
              <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                Default ship-to warehouse for every line; each line can override below.
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Free text — supplier instructions, internal notes…"
                className={styles.fieldInput}
                rows={3}
                style={{ minHeight: 52, resize: 'vertical' }}
              />
            </label>
          </div>

          {supplier && (
            <div style={{
              marginTop: 'var(--space-3)',
              background: 'var(--c-cream)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-muted)',
              display: 'flex',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
            }}>
              {supplier.contact_person && <span>Contact: <strong>{supplier.contact_person}</strong></span>}
              {supplier.phone          && <span>Phone: <strong>{supplier.phone}</strong></span>}
              {supplier.email          && <span>Email: <strong>{supplier.email}</strong></span>}
              {supplier.payment_terms  && <span>Terms: <strong>{supplier.payment_terms}</strong></span>}
              <span>Currency: <strong>{currency}</strong></span>
            </div>
          )}
        </div>
      </section>

      {/* Item-first lookup hint — only renders when commander picked an item
          before a supplier and the reverse lookup found >1 bound suppliers
          (or 0). The 1-supplier case is handled silently by the useEffect
          above. */}
      {pendingItemPick && !supplierId && !itemSuppliersQuery.isLoading && (() => {
        const matches = itemSuppliersQuery.data?.bindings ?? [];
        if (matches.length === 0) {
          return (
            <div style={{
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--c-cream)',
              border: '1px solid var(--line)',
              borderLeft: '3px solid var(--fg-muted)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-13)',
              color: 'var(--fg)',
            }}>
              <strong style={{ fontFamily: 'var(--font-mono)' }}>{pendingItemPick.code}</strong> isn't bound to any supplier yet. Pick any Creditor above for a one-off purchase, or add a binding from the supplier detail page first.
            </div>
          );
        }
        // N > 1
        return (
          <div style={{
            padding: 'var(--space-3) var(--space-4)',
            background: 'rgba(213, 90, 40, 0.06)',
            border: '1px solid var(--c-orange)',
            borderRadius: 'var(--radius-md)',
            fontSize: 'var(--fs-13)',
            color: 'var(--fg)',
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}>
            <div>
              <strong style={{ fontFamily: 'var(--font-mono)' }}>{pendingItemPick.code}</strong> is bound to {matches.length} suppliers — pick one above to auto-fill price + supplier SKU.
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              {matches.map((b) => (
                <span key={b.id}>
                  <button
                    type="button"
                    onClick={() => setSupplierId(b.supplier.id)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      padding: 0,
                      color: 'var(--c-orange)',
                      cursor: 'pointer',
                      fontWeight: 600,
                      textDecoration: 'underline',
                    }}
                  >
                    {b.supplier.code} · {b.supplier.name}
                  </button>
                  {' '}({fmtRm(b.unit_price_centi, b.currency)})
                </span>
              ))}
            </div>
          </div>
        );
      })()}

      {/* Items card */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Items</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {supplierId
              ? (bindings.length > 0
                  ? `${bindings.length} item(s) bound to this supplier — picker filters to these`
                  // PR — Commander 2026-05-28: a supplier with no SKU bindings used
                  // to leave the Item Code picker empty (dead field). Fall back to
                  // the full catalogue so a one-off purchase is still pickable.
                  : `No SKUs bound to this supplier yet — picker shows all ${(allSkus.data ?? []).length} SKUs (one-off purchase)`)
              : `Pick any item from ${(allSkus.data ?? []).length} SKUs — supplier auto-narrows`}
          </span>
        </div>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* PR-pdf-rollout (owner 2026-06-19) — the inline per-line card was
              extracted to the shared PoLineCard so PO Edit can reuse the exact
              same rich editor. Behaviour is identical; the parent still owns the
              cost auto-recompute effect, the bedframe Total-Height auto-compute
              (setVariant), pickBinding, and the item-first pendingItemPick. */}
          {lines.map((l, idx) => (
            <PoLineCard
              key={l.rid}
              index={idx}
              line={l}
              currency={currency}
              supplierId={supplierId}
              bindings={bindings}
              allSkus={allSkus.data ?? []}
              warehouses={warehouses.data ?? []}
              maint={maint}
              fabrics={fabrics}
              specialsPools={specialsPools}
              onChange={(patch) => setLine(l.rid, patch)}
              onPickBinding={(b) => pickBinding(l.rid, b)}
              onSetVariant={(k, v) => setVariant(l.rid, k, v)}
              onPendingItemPick={(code) => setPendingItemPick(code ? { rid: l.rid, code } : null)}
              onRemove={() => dropLine(l.rid)}
            />
          ))}

          <button
            type="button"
            onClick={addLine}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              width: '100%',
              padding: '12px 14px',
              border: '1px dashed var(--c-orange)',
              borderRadius: 'var(--radius-md)',
              background: 'transparent',
              color: 'var(--c-orange)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus {...ICON} /> Add another item
          </button>
        </div>
      </section>

      {/* Totals card aligned right */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <section className={styles.card} style={{ maxWidth: 360, width: '100%' }}>
          <div className={styles.cardBody}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-14)', marginBottom: 'var(--space-2)' }}>
              <span>Subtotal</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtRm(subtotalCenti, currency)}</span>
            </div>
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 'var(--fs-16)',
              fontWeight: 700,
              borderTop: '1px solid var(--line)',
              paddingTop: 'var(--space-2)',
            }}>
              <span>Total</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtRm(subtotalCenti, currency)}</span>
            </div>
          </div>
        </section>
      </div>

      {/* BUG 2 — one-supplier-per-PO guard surfaced in-app (no window.alert). */}
      {dialog && (
        <ActionResultDialog
          title={dialog.title}
          body={dialog.body}
          onClose={() => setDialog(null)}
        />
      )}

    </div>
  );
};
