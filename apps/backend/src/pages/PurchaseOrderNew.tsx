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

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useCreatePurchaseOrder,
  useSuppliers,
  useSupplierDetail,
  useSuppliersForMaterial,
  type BindingRow,
  type NewPoItem,
  type MaterialKind,
} from '../lib/suppliers-queries';
import { useMfgProducts, useMaintenanceConfig } from '../lib/mfg-products-queries';
import { useFabricTrackings } from '../lib/fabric-queries';
import { useWarehouses } from '../lib/inventory-queries';
import {
  computeMfgPoUnitCost,
  type MfgFabricTier,
  type PoPriceMatrix,
} from '@2990s/shared/mfg-pricing';
import styles from './SalesOrderDetail.module.css';

const ICON    = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/** Per-line draft row. PR #97 — materialKind uses the schema's lowercase
    enum ('mfg_product' | 'fabric' | 'raw') so the POST body lines up with
    apps/api/src/routes/mfg-purchase-orders.ts §VALID_KINDS.
    PR #126 — Commander 2026-05-26: "Item Code 需要显示两行（internal +
    supplier code）+ description 也要显示两行 + 根据 category 带出变体属性".
    `category` is set when an SKU is picked; drives which variant editor
    unfolds beneath the line. `variants` JSON ships to API as part of
    NewPoItem.variants — already supported by the API §POST handler. */
type DraftLine = {
  rid: string;
  bindingId?: string;
  materialKind: MaterialKind;
  materialCode: string;
  materialName: string;
  supplierSku?: string;
  qty: number;
  unitPriceCenti: number;
  discountCenti?: number;
  deliveryDate?: string;
  warehouseId?: string;
  /* PR #126 — set when materialCode matches an mfg_product so the row knows
     which variant editor to render (sofa / bedframe / mattress). Lowercase
     to match SoLineCard's itemGroup convention. */
  category?: string;
  /** PR #126 — variant payload (fabric / color / design / total height /
      seat / leg / size depending on category). Shipped to API as
      NewPoItem.variants. */
  variants: Record<string, unknown>;
  /** Phase 3 (2026-05-29) — true once the operator types into Unit Price.
      A manual override always wins: auto-pricing from the supplier price
      table + maintenance surcharges stops touching this line's cost. */
  priceTouched?: boolean;
};

const newLine = (): DraftLine => ({
  rid: `l${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  materialKind: 'mfg_product',
  materialCode: '',
  materialName: '',
  qty: 1,
  unitPriceCenti: 0,
  variants: {},
});

/* Commander 2026-05-28 — Special Orders multi-select, mirroring the Sales
   Order variant editor (PO previously had none). Writes variants.specials as
   a string[] so it flows into Description 2 like SO does. */
const SpecialsCheckboxes = ({
  pool, picked, onChange,
}: {
  pool: Array<{ value: string }> | undefined;
  picked: string[];
  onChange: (arr: string[]) => void;
}) => {
  if (!pool || pool.length === 0) return null;
  return (
    <div style={{ marginTop: 'var(--space-2)' }}>
      <div style={{
        fontSize: 'var(--fs-11)', fontWeight: 700, letterSpacing: '0.08em',
        textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 4,
      }}>
        Special Orders
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px' }}>
        {pool.map((o) => {
          const on = picked.includes(o.value);
          return (
            <label key={o.value} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-12)', cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={on}
                onChange={() => onChange(on ? picked.filter((x) => x !== o.value) : [...picked, o.value])}
              />
              {o.value}
            </label>
          );
        })}
      </div>
    </div>
  );
};

export const PurchaseOrderNew = () => {
  const navigate = useNavigate();
  const create   = useCreatePurchaseOrder();

  // ── Header state ────────────────────────────────────────────────────
  const [supplierId, setSupplierId]   = useState<string>('');
  const [poDate, setPoDate]           = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [expectedAt, setExpectedAt]   = useState<string>('');
  const [purchaseLocationId, setPurchaseLocationId] = useState<string>('');
  const [notes, setNotes]             = useState<string>('');

  // ── Items state ─────────────────────────────────────────────────────
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);

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
     editors so other line fields (qty, price, supplier SKU) stay untouched. */
  const setVariant = (rid: string, k: string, v: unknown) =>
    setLines((prev) => prev.map((l) =>
      l.rid === rid ? { ...l, variants: { ...l.variants, [k]: v } } : l,
    ));

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
      window.alert('Pick a Creditor (supplier) first.');
      return;
    }
    // PR #157 — Commander 2026-05-26: "这些没有 expected delivery date 和
    // purchase location，为什么能生成 PO 呢？" Both fields are required on
    // submit — they fan out to per-line warehouse + delivery date and are
    // needed downstream for GRN. Defense-in-depth: API also rejects missing.
    if (!expectedAt) {
      window.alert('Expected Delivery date is required.');
      return;
    }
    if (!purchaseLocationId) {
      window.alert('Purchase Location is required.');
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
      warehouseId:    l.warehouseId  || undefined,
      /* PR #126 — Per-line variants + itemGroup. NewPoItem already supports
         these (PR #41 schema). The API §POST handler persists them onto
         purchase_order_items.variants JSONB / item_group. */
      itemGroup:      l.category,
      variants:       Object.keys(l.variants).length ? l.variants : undefined,
    }));

    create.mutate(
      {
        supplierId,
        currency,
        poDate,
        expectedAt,
        notes: notes || undefined,
        purchaseLocationId,
        items,
      },
      {
        onSuccess: (res) => navigate(`/purchase-orders/${res.id}`),
        onError:   (err) => window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
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
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase-orders/from-so')}>
            <Plus {...ICON} /> From SO
          </Button>
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase-orders')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={create.isPending || !supplierId || !expectedAt || !purchaseLocationId}
          >
            <Save {...ICON} />
            {/* PR #131 + 0078 — POST creates SUBMITTED; DRAFT removed entirely. */}
            {create.isPending ? 'Creating…' : 'Create PO'}
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
          {/* PR #129 — Card-per-line layout. Commander 2026-05-26: "其实有很
              多字都塞在了一个小小的格子里，你可能 UI 整个要再整理过一下".
              Replaces the 9-column cramped grid with breathing-room cards
              (same shape as SoLineCard from PR #125). Each card has 4
              sections: identity (item + supplier code), description,
              variants (per category), pricing. */}
          {lines.map((l, idx) => {
            const lineTotalCenti = Math.max(0, l.qty * l.unitPriceCenti - (l.discountCenti ?? 0));
            const categoryLabel = l.category?.toUpperCase() ?? 'UNSET';
            // PR #135 — drop mattress from the variant editor list.
            // Commander 2026-05-26: "mattress variant 还有 branding 为什么要带
            // 出来呢？不需要带出来啊". For mattress SKUs the size + branding
            // are already encoded in the SKU code itself (e.g. "HAPPI.S
            // DEWCOOL MATT (S)"), so the editor was just visual noise.
            const showVariants  = l.category && ['sofa', 'bedframe'].includes(l.category) && maint;

            return (
              <div
                key={l.rid}
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
                {/* Card header — Line N · category badge · line total · remove */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                    <span style={{
                      fontFamily: 'var(--font-button)',
                      fontSize: 'var(--fs-12)',
                      fontWeight: 700,
                      letterSpacing: '0.10em',
                      color: 'var(--fg-muted)',
                    }}>
                      LINE {idx + 1}
                    </span>
                    {l.category && (
                      <span style={{
                        fontFamily: 'var(--font-button)',
                        fontSize: 'var(--fs-11)',
                        fontWeight: 700,
                        letterSpacing: '0.10em',
                        padding: '2px 8px',
                        borderRadius: 'var(--radius-pill)',
                        background: 'rgba(166, 71, 30, 0.12)',
                        color: 'var(--c-burnt)',
                      }}>
                        {categoryLabel}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <span className={styles.previewPrice}>{fmtRm(lineTotalCenti, currency)}</span>
                    <button
                      type="button"
                      onClick={() => dropLine(l.rid)}
                      title="Remove line"
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: 'var(--c-festive-b, #B8331F)',
                        padding: 4,
                        display: 'inline-flex',
                      }}
                    >
                      <Trash2 {...ICON} />
                    </button>
                  </div>
                </div>

                {/* Identity row — Internal code + Supplier SKU side by side */}
                <div className={styles.formGrid2}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Item Code (Internal)</span>
                    <input
                      type="text"
                      list={`bindings-${l.rid}`}
                      value={l.materialCode}
                      onChange={(e) => {
                        const code = e.target.value;
                        // Bound match wins (autofills supplier SKU + price).
                        const match = supplierId
                          ? bindings.find((b) => b.material_code === code)
                          : undefined;
                        if (match) { pickBinding(l.rid, match); return; }
                        // No binding (no supplier yet, OR supplier has no binding
                        // for this code) → one-off line: pull name + category
                        // from the master SKU list so the row isn't left blank.
                        const sku = (allSkus.data ?? []).find((p) => p.code === code);
                        setLine(l.rid, {
                          materialCode: code,
                          materialName: sku?.name ?? l.materialName,
                          bindingId: undefined,
                          category: sku?.category.toLowerCase() ?? categoryForCode(code),
                        });
                        // Reverse supplier lookup only matters before a supplier
                        // is chosen; once one is picked we don't re-narrow.
                        if (!supplierId) setPendingItemPick(code ? { rid: l.rid, code } : null);
                      }}
                      placeholder="Type or pick our internal SKU…"
                      className={styles.fieldInput}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <datalist id={`bindings-${l.rid}`}>
                      {/* PR — Commander 2026-05-28: only show bound SKUs when the
                          supplier actually HAS bindings; otherwise fall back to
                          the full catalogue so the picker is never dead. */}
                      {supplierId && bindings.length > 0
                        ? bindings.map((b) => (
                            <option key={b.id} value={b.material_code}>
                              {b.material_name} · {b.supplier_sku} · {fmtRm(b.unit_price_centi, b.currency)}
                            </option>
                          ))
                        : (allSkus.data ?? []).map((p) => (
                            <option key={p.id} value={p.code}>
                              {p.name} · {p.category}
                            </option>
                          ))
                      }
                    </datalist>
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Supplier SKU</span>
                    {/* PR #134 — Bi-directional picker: typing/picking a
                        supplier_sku reverse-fills the matching binding's
                        internal materialCode + name + price (same as
                        picking from the Item Code side). Commander: "怎么
                        不能选 Supplier Code 呢". Requires supplier picked
                        first (we only know which bindings to search). */}
                    <input
                      type="text"
                      list={`supplier-skus-${l.rid}`}
                      value={l.supplierSku ?? ''}
                      onChange={(e) => {
                        const sku = e.target.value;
                        if (supplierId) {
                          const match = bindings.find((b) => b.supplier_sku === sku);
                          if (match) {
                            pickBinding(l.rid, match);
                          } else {
                            setLine(l.rid, { supplierSku: sku });
                          }
                        } else {
                          setLine(l.rid, { supplierSku: sku });
                        }
                      }}
                      placeholder={supplierId
                        ? 'Type or pick supplier’s code…'
                        : 'Pick a supplier first to enable picker'}
                      className={styles.fieldInput}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                    <datalist id={`supplier-skus-${l.rid}`}>
                      {supplierId && bindings.map((b) => (
                        <option key={b.id} value={b.supplier_sku || ''}>
                          {b.material_code} · {b.material_name} · {fmtRm(b.unit_price_centi, b.currency)}
                        </option>
                      ))}
                    </datalist>
                  </label>
                </div>

                {/* Description — full width */}
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Description</span>
                  <input
                    type="text"
                    value={l.materialName}
                    onChange={(e) => setLine(l.rid, { materialName: e.target.value })}
                    placeholder="(auto-filled if bound — editable for one-off purchases)"
                    className={styles.fieldInput}
                  />
                </label>

                {/* Per-category variant editor (PR #126 logic, PR #129 card layout) */}
                {showVariants && (
                  <div style={{
                    background: 'var(--c-cream)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-button)',
                      fontSize: 'var(--fs-11)',
                      fontWeight: 700,
                      letterSpacing: '0.16em',
                      textTransform: 'uppercase',
                      color: 'var(--fg-muted)',
                      marginBottom: 'var(--space-2)',
                    }}>
                      {l.category} Variants
                    </div>

                    {/* BEDFRAME — Commander 2026-05-28: mirror the Sales Order
                        variant editor exactly — Fabrics · Gaps · Divan · Leg
                        (dropdowns) + Special Orders. Dropped the free-text
                        Color + Design fields. */}
                    {l.category === 'bedframe' && (
                      <>
                        <div className={styles.formGrid4}>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Fabrics</span>
                            <select
                              className={styles.fieldSelect}
                              value={String(l.variants.fabricCode ?? '')}
                              onChange={(e) => setVariant(l.rid, 'fabricCode', e.target.value)}
                            >
                              <option value="" disabled>Select…</option>
                              {fabrics.map((f) => (
                                <option key={f.id} value={f.fabric_code}>
                                  {f.fabric_code}{f.series ? ` · ${f.series}` : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Gaps</span>
                            <select
                              className={styles.fieldSelect}
                              value={String(l.variants.gap ?? '')}
                              onChange={(e) => setVariant(l.rid, 'gap', e.target.value)}
                            >
                              <option value="" disabled>Select…</option>
                              {maint!.gaps.map((g) => (<option key={g} value={g}>{g}</option>))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Divan Heights</span>
                            <select
                              className={styles.fieldSelect}
                              value={String(l.variants.divanHeight ?? '')}
                              onChange={(e) => setVariant(l.rid, 'divanHeight', e.target.value)}
                            >
                              <option value="" disabled>Select…</option>
                              {maint!.divanHeights.map((o) => (<option key={o.value} value={o.value}>{o.value}</option>))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Leg Heights</span>
                            <select
                              className={styles.fieldSelect}
                              value={String(l.variants.legHeight ?? '')}
                              onChange={(e) => setVariant(l.rid, 'legHeight', e.target.value)}
                            >
                              <option value="" disabled>Select…</option>
                              {maint!.legHeights.map((o) => (<option key={o.value} value={o.value}>{o.value}</option>))}
                            </select>
                          </label>
                          {/* Total Heights — Commander 2026-05-29: mirror the SO
                              bedframe editor so its maintenance surcharge applies.
                              Bound to variants.totalHeight (read by the pricing
                              engine via computeMfgPoUnitCost → totalHeights). */}
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Total Heights</span>
                            <select
                              className={styles.fieldSelect}
                              value={String(l.variants.totalHeight ?? '')}
                              onChange={(e) => setVariant(l.rid, 'totalHeight', e.target.value)}
                            >
                              <option value="" disabled>Select…</option>
                              {maint!.totalHeights.map((o) => (<option key={o.value} value={o.value}>{o.value}</option>))}
                            </select>
                          </label>
                        </div>
                        <SpecialsCheckboxes
                          pool={maint!.specials}
                          picked={Array.isArray(l.variants.specials) ? (l.variants.specials as string[]) : []}
                          onChange={(arr) => setVariant(l.rid, 'specials', arr)}
                        />
                      </>
                    )}

                    {/* SOFA — Commander 2026-05-28: mirror the SO editor —
                        Fabrics · Seat · Leg + Special Orders. Dropped free-text
                        Color. */}
                    {l.category === 'sofa' && (
                      <>
                        <div className={styles.formGrid4}>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Fabrics</span>
                            <select
                              className={styles.fieldSelect}
                              value={String(l.variants.fabricCode ?? '')}
                              onChange={(e) => setVariant(l.rid, 'fabricCode', e.target.value)}
                            >
                              <option value="" disabled>Select…</option>
                              {fabrics.map((f) => (
                                <option key={f.id} value={f.fabric_code}>
                                  {f.fabric_code}{f.series ? ` · ${f.series}` : ''}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Seat Size</span>
                            <select
                              className={styles.fieldSelect}
                              value={String(l.variants.seatHeight ?? '')}
                              onChange={(e) => setVariant(l.rid, 'seatHeight', e.target.value)}
                            >
                              <option value="" disabled>Select…</option>
                              {maint!.sofaSizes.map((s) => (<option key={s} value={s}>{s}</option>))}
                            </select>
                          </label>
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Leg Heights</span>
                            <select
                              className={styles.fieldSelect}
                              value={String(l.variants.legHeight ?? '')}
                              onChange={(e) => setVariant(l.rid, 'legHeight', e.target.value)}
                            >
                              <option value="" disabled>Select…</option>
                              {maint!.sofaLegHeights.map((o) => (<option key={o.value} value={o.value}>{o.value}</option>))}
                            </select>
                          </label>
                          <span />
                        </div>
                        <SpecialsCheckboxes
                          pool={maint!.sofaSpecials}
                          picked={Array.isArray(l.variants.specials) ? (l.variants.specials as string[]) : []}
                          onChange={(arr) => setVariant(l.rid, 'specials', arr)}
                        />
                      </>
                    )}

                    {/* PR #135 — mattress block removed: size + branding are
                        already encoded in the mattress SKU code itself, no
                        need for a separate editor. */}
                  </div>
                )}

                {/* Pricing row — Qty · Unit Price · Discount · Delivery · Ship-to */}
                <div className={styles.formGrid4} style={{ gridTemplateColumns: 'repeat(5, 1fr)' }}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Qty</span>
                    <input
                      type="number" min={0} step={1}
                      value={l.qty}
                      onChange={(e) => setLine(l.rid, { qty: Number(e.target.value) })}
                      className={styles.fieldInput}
                      style={{ textAlign: 'right' }}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Unit Price ({currency})</span>
                    <input
                      type="number" min={0} step={0.01}
                      value={(l.unitPriceCenti / 100).toFixed(2)}
                      // Phase 3 — manual edit wins: flag priceTouched so the
                      // supplier-price auto-fill stops overwriting this line.
                      onChange={(e) => setLine(l.rid, { unitPriceCenti: Math.round(Number(e.target.value) * 100), priceTouched: true })}
                      className={styles.fieldInput}
                      style={{ textAlign: 'right' }}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Discount ({currency})</span>
                    <input
                      type="number" min={0} step={0.01}
                      value={((l.discountCenti ?? 0) / 100).toFixed(2)}
                      onChange={(e) => setLine(l.rid, { discountCenti: Math.round(Number(e.target.value) * 100) })}
                      className={styles.fieldInput}
                      style={{ textAlign: 'right' }}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Delivery Date</span>
                    <input
                      type="date"
                      value={l.deliveryDate ?? ''}
                      onChange={(e) => setLine(l.rid, { deliveryDate: e.target.value })}
                      className={styles.fieldInput}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Ship-to Location</span>
                    <select
                      value={l.warehouseId ?? ''}
                      onChange={(e) => setLine(l.rid, { warehouseId: e.target.value })}
                      className={styles.fieldInput}
                    >
                      <option value="">— Inherit Purchase Location —</option>
                      {(warehouses.data ?? []).map((w) => (
                        <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                      ))}
                    </select>
                  </label>
                </div>
              </div>
            );
          })}

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
    </div>
  );
};
