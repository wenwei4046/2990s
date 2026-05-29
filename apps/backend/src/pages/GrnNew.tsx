// ----------------------------------------------------------------------------
// GrnNew — full-page Create Goods Receipt at /grns/new.
//
// Commander 2026-05-29: New GRN must work like New PO — land straight on a
// fillable FORM (header + line items) you can complete directly. Three ways in:
//
//   1. Single PO dropdown (or ?poId= deep link from a PO detail "Receive
//      Goods") → its outstanding lines load into the items grid.
//   2. "From PO (multi)" picker (/grns/from-po) → multi-select PO lines across
//      one supplier, stashed to sessionStorage['grnFromPoPicks'], which this
//      form reads ONCE on mount and loads as lines (supplier locked, header
//      purchaseOrderId = first pick's PO id; each line keeps its own
//      purchase_order_item_id so received_qty rolls up to every source PO).
//   3. Manual / blank GRN — no PO at all: pick a supplier, search products,
//      add line items by hand. Saves with purchaseOrderId:null + each item
//      purchaseOrderItemId:null (server writes inventory-IN, skips PO rollup).
//
// POST /grns creates the row POSTED directly (rolls received_qty onto the PO +
// writes inventory_movements inline). Adjust qty received/accepted/rejected per
// line → Receive & Post.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Plus, Save, Trash2, X, Layers, ChevronDown } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared';
import { useCreateGrn, usePostGrn } from '../lib/flow-queries';
import { usePurchaseOrderDetail, usePurchaseOrders, useSuppliers, useSupplierDetail } from '../lib/suppliers-queries';
import { useMfgProducts, useMaintenanceConfig } from '../lib/mfg-products-queries';
import { useWarehouses } from '../lib/inventory-queries';
import { ItemGroupPill } from '../lib/category-badges';
import { ActionResultDialog } from '../components/ActionResultDialog';
import { MoneyInput } from '../components/MoneyInput';
import type { GrnFromPoPick } from './GrnFromPo';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/* Commander 2026-05-29 — bedframe Total Height is AUTO-COMPUTED = Divan + Leg +
   Gap (mirrors SoLineCard); it is NOT a manual pick. */
const parseInches = (s: unknown): number => {
  if (s == null) return 0;
  const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
  return m && m[1] ? Number(m[1]) : 0;
};

/* Commander 2026-05-29 — "PO 那边根据 Category 会叫我填写我的 Variant，这个
   (GRN) 怎么没有？" Manual GRN lines whose product is a bedframe/sofa now get
   the SAME per-category variant editor as New PO / the PO Edit modal. Small
   local copy of PurchaseOrderDetail's VariantSelect (not exported there). */
const VariantSelect = ({
  label, options, value, onChange,
}: {
  label: string;
  options: Array<{ value: string; priceSen: number }>;
  value: string;
  onChange: (v: string) => void;
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <span className={styles.selectWrap}>
      <select className={styles.fieldSelect} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">—</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.value}{o.priceSen > 0 ? ` (+${fmtRm(o.priceSen)})` : ''}
          </option>
        ))}
      </select>
      <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} />
    </span>
  </label>
);

type DraftLine = {
  rid:               string;
  purchaseOrderItemId: string | null;
  materialKind:      string;
  materialCode:      string;
  materialName:      string;
  /* Commander 2026-05-29 — GRN must show WHAT is being received (carry the
     PO line's category + variant selections, exactly like the PO shows). */
  itemGroup:         string | null;
  variants:          Record<string, unknown> | null;
  /** Outstanding qty for PO-linked lines; for manual lines there's no cap so
      this is null (the qty inputs go uncapped). */
  outstanding:       number | null;
  qtyReceived:       number;
  qtyAccepted:       number;
  qtyRejected:       number;
  unitPriceCenti:    number;
  notes:             string;
};

export const GrnNew = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // ── From-PO-multi picks (Commander 2026-05-29) — read ONCE on mount.
  //    When present, they drive the form: lines pre-loaded, supplier locked,
  //    header purchaseOrderId = first pick's PO id. ────────────────────────
  const [picks, setPicks] = useState<GrnFromPoPick[] | null>(null);
  const pickSupplierId   = picks?.[0]?.supplierId ?? null;
  const pickSupplierName = picks?.[0]?.supplierName ?? picks?.[0]?.supplierCode ?? null;
  const pickPoId         = picks?.[0]?.poId ?? null;
  const hasPicks         = !!picks && picks.length > 0;

  // Inline single-PO picker (drives the form when there are no picks).
  const [selPoId, setSelPoId] = useState<string>(params.get('poId') ?? '');
  const poListQ = usePurchaseOrders();
  const poQ     = usePurchaseOrderDetail(selPoId || null);

  // Manual-mode supplier (Commander 2026-05-29 — blank GRN, no PO).
  const [manualSupplierId, setManualSupplierId] = useState<string>('');
  const suppliersQ = useSuppliers({ status: 'ACTIVE' });

  // Commander 2026-05-29 — maintenance config drives the per-category variant
  // editor on MANUAL bedframe/sofa lines (same dropdown pools as New PO / the
  // PO Edit modal: divan/leg/total height, gap, special, seat size, fabric).
  const maintQ = useMaintenanceConfig('master');
  const maint  = maintQ.data?.data ?? null;

  const outstanding = useMemo(
    () => (poListQ.data ?? []).filter((po) => po.status === 'SUBMITTED' || po.status === 'PARTIALLY_RECEIVED'),
    [poListQ.data],
  );

  const create = useCreateGrn();
  const post   = usePostGrn();
  const saving = create.isPending || post.isPending;

  const [receivedAt, setReceivedAt]           = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [deliveryNoteRef, setDeliveryNoteRef] = useState<string>('');
  const [notes, setNotes]                     = useState<string>('');
  const [lines, setLines]                     = useState<DraftLine[]>([]);
  /* Commander 2026-05-29 — New GRN must mirror New PO's header, including a
     "Receive into" Warehouse picker (PO calls it Purchase Location). The chosen
     warehouse threads into the create payload (warehouseId) → grns.ts sets it on
     the header so the inventory-IN movement lands there. */
  const [warehouseId, setWarehouseId]         = useState<string>('');
  const warehousesQ = useWarehouses();
  const [dialog, setDialog] = useState<{ title: string; body: string; goTo?: string } | null>(null);

  // ── Read From-PO-multi picks once on mount (remove after reading). ──────
  const readPicksRef = useRef(false);
  useEffect(() => {
    if (readPicksRef.current) return;
    readPicksRef.current = true;
    let raw: string | null = null;
    try { raw = sessionStorage.getItem('grnFromPoPicks'); } catch { /* ignore */ }
    if (!raw) return;
    try {
      sessionStorage.removeItem('grnFromPoPicks');
      const rows = JSON.parse(raw) as GrnFromPoPick[];
      if (Array.isArray(rows) && rows.length) {
        setPicks(rows);
        setLines(rows.map((p) => ({
          rid:                 `p${p.poItemId}`,
          purchaseOrderItemId: p.poItemId,
          materialKind:        'mfg_product',
          materialCode:        p.itemCode,
          materialName:        p.description ?? p.itemCode,
          itemGroup:           p.itemGroup || null,
          variants:            (p.variants as Record<string, unknown> | null) ?? null,
          outstanding:         p.remainingQty,
          qtyReceived:         p._pickQty,
          qtyAccepted:         p._pickQty,
          qtyRejected:         0,
          unitPriceCenti:      p.unitPriceCenti ?? 0,
          notes:               '',
        })));
      }
    } catch { /* malformed — ignore */ }
  }, []);

  // Load lines from the selected single PO (only outstanding qty > 0). Skipped
  // when From-PO-multi picks already populated the form.
  useEffect(() => {
    if (hasPicks) return;
    if (!selPoId) {
      // Manual mode — seed ONE blank starter line so a LINE 1 card shows
      // immediately (matches New PO). Never clobber existing lines (picks /
      // hand-added) — only seed when empty.
      setLines((prev) => prev.length > 0 ? prev : [{
        rid:                 `m${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        purchaseOrderItemId: null,
        materialKind:        'mfg_product',
        materialCode:        '',
        materialName:        '',
        itemGroup:           null,
        variants:            null,
        outstanding:         null,
        qtyReceived:         1,
        qtyAccepted:         1,
        qtyRejected:         0,
        unitPriceCenti:      0,
        notes:               '',
      }]);
      return;
    }
    if (!poQ.data) return;
    const next: DraftLine[] = poQ.data.items
      .map((it: any) => {
        const outstanding = (it.qty ?? 0) - (it.received_qty ?? 0);
        return {
          rid:               `r${it.id}`,
          purchaseOrderItemId: it.id,
          materialKind:      it.material_kind,
          materialCode:      it.material_code,
          materialName:      it.material_name,
          itemGroup:         it.item_group ?? null,
          variants:          (it.variants as Record<string, unknown> | null) ?? null,
          outstanding,
          qtyReceived:       outstanding,
          qtyAccepted:       outstanding,
          qtyRejected:       0,
          unitPriceCenti:    it.unit_price_centi ?? 0,
          notes:             '',
        };
      })
      .filter((l) => (l.outstanding ?? 0) > 0);
    setLines(next);
  }, [poQ.data, selPoId, hasPicks]);

  const setLine  = (rid: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const dropLine = (rid: string) => setLines((prev) => prev.filter((l) => l.rid !== rid));

  const subtotalCenti = useMemo(
    () => lines.reduce((s, l) => s + l.qtyAccepted * l.unitPriceCenti, 0),
    [lines],
  );

  // ── Mode + resolved supplier / header PO. ──────────────────────────────
  // Manual mode = no picks AND no single PO chosen. Then the operator picks a
  // supplier + adds lines by hand.
  const po       = poQ.data?.purchaseOrder;
  const isManual = !hasPicks && !selPoId;

  // The effective supplier id + display name for the save + header card.
  const supplierId =
    hasPicks   ? pickSupplierId
    : po       ? po.supplier_id
    : isManual ? (manualSupplierId || null)
    : null;
  const supplierName =
    hasPicks   ? pickSupplierName
    : po       ? (po.supplier?.name ?? po.supplier?.code ?? null)
    : isManual ? ((suppliersQ.data ?? []).find((s) => s.id === manualSupplierId)?.name ?? null)
    : null;
  // Header PO id: picks → first pick's PO; single-PO → that PO; manual → null.
  const headerPoId = hasPicks ? pickPoId : (po?.id ?? null);
  const currency   = po?.currency ?? 'MYR';

  // Commander 2026-05-29 — make the MANUAL item picker supplier-binding-aware,
  // exactly like New PO. Once a supplier is chosen the per-line Item Code
  // datalist lists THAT supplier's bound SKUs (material_code + name + price);
  // picking one fills name + unit price + itemGroup from the binding. When no
  // supplier is set yet we fall back to the free useMfgProducts search below.
  const supplierDetailQ = useSupplierDetail(supplierId);
  const bindings        = useMemo(() => supplierDetailQ.data?.bindings ?? [], [supplierDetailQ.data?.bindings]);
  /* Commander 2026-05-29 — the resolved supplier object (same source PO uses)
     so the GRN header can auto-fill Name + Address + the Contact · Phone ·
     Email · Terms · Currency info bar, exactly like New PO. */
  const supplier        = supplierDetailQ.data?.supplier ?? null;

  /* Default the Warehouse picker sensibly: prefer the source PO's purchase
     location (so receiving against a PO lands where the PO expected), else the
     first warehouse. Only seeds when the picker is still blank — never clobbers
     a manual choice. */
  useEffect(() => {
    if (warehouseId) return;
    const poLoc = (po as { purchase_location_id?: string | null } | undefined)?.purchase_location_id ?? null;
    const fallback = poLoc ?? (warehousesQ.data?.[0]?.id ?? '');
    if (fallback) setWarehouseId(fallback);
  }, [warehouseId, po, warehousesQ.data]);

  // ── Manual product search (gated by min query length, mirrors PO form). ──
  // Commander 2026-05-29 — the single top "ADD ITEM" box is gone. Each MANUAL
  // line now carries its own inline Item Code picker (PO parity). The search
  // query is shared: only one line input is focused at a time, so a single
  // gated query feeds whichever line's datalist is active.
  const [productQuery, setProductQuery] = useState<string>('');
  const productsQ = useMfgProducts({
    search: productQuery,
    enabled: isManual && productQuery.trim().length >= 2,
  });

  // Commander 2026-05-29 — supplier-bound picks carry no category on the
  // binding row, so (mirroring New PO's `allSkus`/`categoryForCode`) we pull
  // the full catalogue to resolve a bound SKU's itemGroup. Gated to manual +
  // supplier so a PO-sourced / no-supplier GRN never fires the lookup.
  const allSkusQ = useMfgProducts({ enabled: isManual && !!supplierId });
  const categoryForCode = (code: string): string | undefined => {
    const sku = (allSkusQ.data ?? []).find((p) => p.code === code);
    return sku?.category ? sku.category.toLowerCase() : undefined;
  };

  // Append a fresh, empty MANUAL line (the per-line picker fills it in). Used by
  // the dashed "Add another item" button at the bottom of the items card.
  const addEmptyManualLine = () => {
    setLines((prev) => [...prev, {
      rid:                 `m${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      purchaseOrderItemId: null,
      materialKind:        'mfg_product',
      materialCode:        '',
      materialName:        '',
      itemGroup:           null,
      variants:            null,
      outstanding:         null,
      qtyReceived:         1,
      qtyAccepted:         1,
      qtyRejected:         0,
      unitPriceCenti:      0,
      notes:               '',
    }]);
  };

  // Pick / type an internal SKU on a manual line → fill code + name + itemGroup
  // (category drives the variant editor below, exactly like the PO line picker).
  const pickItemForLine = (rid: string, code: string) => {
    const sku = (productsQ.data ?? []).find((p) => p.code === code);
    setLine(rid, {
      materialCode: code,
      materialName: sku?.name ?? code,
      itemGroup:    sku?.category ? sku.category.toLowerCase() : null,
    });
  };

  // Commander 2026-05-29 — supplier-bound pick (New PO parity): when a supplier
  // is chosen and the typed/picked code matches one of THAT supplier's
  // bindings, fill name + UNIT PRICE (from the binding) + itemGroup. GRN's
  // DraftLine has no supplierSku field, so we skip it. Category is resolved
  // from the full catalogue (categoryForCode) since bindings carry no category.
  const pickBindingForLine = (rid: string, b: typeof bindings[number]) => {
    setLine(rid, {
      materialCode:   b.material_code,
      materialName:   b.material_name,
      unitPriceCenti: b.unit_price_centi,
      itemGroup:      categoryForCode(b.material_code) ?? null,
    });
  };

  const canSave = !!supplierId && lines.length > 0 &&
    lines.every((l) => l.qtyReceived >= 0 && l.qtyAccepted + l.qtyRejected <= l.qtyReceived);

  const onSave = async () => {
    if (!supplierId) {
      setDialog({ title: 'Pick a supplier', body: hasPicks
        ? 'The picks are missing a supplier — go back to the picker and try again.'
        : 'Choose the PO you are receiving against, or pick a supplier for a manual receipt.' });
      return;
    }
    // Drop the blank starter line(s) — only real items (with a code) are saved.
    const realLines = lines.filter((l) => l.materialCode.trim());
    if (realLines.length === 0) {
      setDialog({ title: 'Add at least one item', body: 'Pick at least one SKU to receive.' });
      return;
    }
    if (!canSave) {
      setDialog({ title: 'Check the quantities', body: 'Each line: qty accepted + qty rejected must be ≤ qty received.' });
      return;
    }
    try {
      const createRes = await create.mutateAsync({
        purchaseOrderId: headerPoId,
        supplierId,
        // Commander 2026-05-29 — chosen "Receive into" warehouse (PO parity).
        // grns.ts persists it on the header (falls back to the default warehouse
        // when omitted) so the inventory-IN movement lands in the right place.
        warehouseId:     warehouseId || undefined,
        receivedAt,
        deliveryNoteRef: deliveryNoteRef || undefined,
        notes:           notes || undefined,
        items: realLines.map((l) => ({
          purchaseOrderItemId: l.purchaseOrderItemId,
          materialKind:        l.materialKind,
          materialCode:        l.materialCode,
          materialName:        l.materialName,
          qtyReceived:         l.qtyReceived,
          qtyAccepted:         l.qtyAccepted,
          qtyRejected:         l.qtyRejected,
          unitPriceCenti:      l.unitPriceCenti,
          notes:               l.notes || undefined,
          // Commander 2026-05-29 — persist the line's category + variant
          // selections (manual bedframe/sofa lines pick these below; PO-sourced
          // lines carry them through) so the GRN/inventory reflect WHAT was received.
          itemGroup:           l.itemGroup,
          variants:            l.variants,
        })),
      });
      await post.mutateAsync(createRes.id);
      setDialog({
        title: `GRN ${createRes.grnNumber} created`,
        body: 'Received & posted — inventory + PO received qty updated.',
        goTo: `/grns/${createRes.id}`,
      });
    } catch (err) {
      setDialog({ title: 'Save failed', body: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/grns" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Goods Receipts</span>
          </Link>
          <h1 className={styles.title}>New Goods Receipt{po?.po_number ? ` · ${po.po_number}` : ''}</h1>
        </div>
        <div className={styles.actions}>
          {/* Bulk / multi-PO picker that FEEDS this form. */}
          <Button variant="ghost" size="md" onClick={() => navigate('/grns/from-po')}>
            <Layers {...ICON} /> From PO (multi)
          </Button>
          <Button variant="ghost" size="md" onClick={() => navigate('/grns')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button variant="primary" size="md" onClick={onSave} disabled={saving || !canSave}>
            <Save {...ICON} />
            {saving ? 'Receiving…' : 'Receive & Post'}
          </Button>
        </div>
      </div>

      {/* Header card — PO picker is inline so you stay on the form. */}
      <section className={styles.card}>
        <div className={styles.cardHeader}><h2 className={styles.cardTitle}>Header</h2></div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            {/* Receive-against picker. Hidden when From-PO-multi picks drive the
                form (supplier + PO are locked to the picks). */}
            {hasPicks ? (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Receiving from PO picks</span>
                <input
                  type="text"
                  readOnly
                  value={`${picks!.length} line${picks!.length === 1 ? '' : 's'} from ${[...new Set(picks!.map((p) => p.poDocNo))].join(', ')}`}
                  className={styles.fieldInput}
                  style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                />
              </label>
            ) : (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Receive against PO</span>
                <select
                  value={selPoId}
                  onChange={(e) => setSelPoId(e.target.value)}
                  className={styles.fieldInput}
                  disabled={poListQ.isLoading || outstanding.length === 0}
                >
                  <option value="">
                    {poListQ.isLoading ? 'Loading POs…'
                      : outstanding.length === 0 ? 'No outstanding POs — receive manually below'
                      : '— Pick an outstanding PO (or leave blank for a manual receipt) —'}
                  </option>
                  {outstanding.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.po_number} · {p.supplier?.name ?? p.supplier?.code ?? '—'} · {p.po_date}
                      {p.status === 'PARTIALLY_RECEIVED' ? ' (partial)' : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>GRN #</span>
              <input type="text" readOnly value="(assigned on Save)" className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>

            {/* Supplier — locked from picks / PO, or a manual <select>. */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier *{hasPicks ? ' (from picks)' : ''}</span>
              {isManual ? (
                <select
                  value={manualSupplierId}
                  onChange={(e) => setManualSupplierId(e.target.value)}
                  className={styles.fieldInput}
                  disabled={suppliersQ.isLoading}
                >
                  <option value="">{suppliersQ.isLoading ? 'Loading suppliers…' : '— Pick a supplier —'}</option>
                  {(suppliersQ.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                  ))}
                </select>
              ) : (
                <input type="text" readOnly value={supplierName ?? '(auto-filled from PO)'} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
              )}
            </label>
            {/* Commander 2026-05-29 — Name + Address auto-fill once a supplier is
                resolved (manual / from PO / from picks), mirroring New PO. */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Name</span>
              <input
                type="text"
                readOnly
                value={supplier?.name ?? supplierName ?? ''}
                placeholder="(auto-filled when supplier selected)"
                className={styles.fieldInput}
                style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
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
            {/* Receive into — Warehouse picker (PO's Purchase Location equivalent).
                Threads into the create payload → inventory-IN lands here. */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Receive into *</span>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className={styles.fieldInput}
                disabled={warehousesQ.isLoading}
                required
              >
                <option value="">{warehousesQ.isLoading ? 'Loading warehouses…' : '— Pick a warehouse —'}</option>
                {(warehousesQ.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
              <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                Warehouse the received stock moves into.
              </span>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Received Date *</span>
              <input type="date" value={receivedAt} onChange={(e) => setReceivedAt(e.target.value)} className={styles.fieldInput} required />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Delivery Note Ref</span>
              <input type="text" value={deliveryNoteRef} onChange={(e) => setDeliveryNoteRef(e.target.value)} placeholder="Supplier's DN # (optional)" className={styles.fieldInput} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Receiving notes — visible on the GRN detail page" className={styles.fieldInput} rows={2} style={{ resize: 'vertical', minHeight: 60 }} />
            </label>
          </div>

          {/* Read-only supplier-info bar — same markup/classes as New PO. */}
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
              <span>Currency: <strong>{supplier.currency ?? currency}</strong></span>
            </div>
          )}
        </div>
      </section>

      {/* Items card */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Items</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {hasPicks
              ? `${lines.length} line${lines.length === 1 ? '' : 's'} from picks · subtotal ${fmtRm(subtotalCenti, currency)}`
              : selPoId
                ? (poQ.isLoading
                    ? 'Loading PO items…'
                    : lines.length === 0
                      ? 'No outstanding lines on this PO (all qty already received)'
                      : `${lines.length} line${lines.length === 1 ? '' : 's'} · subtotal ${fmtRm(subtotalCenti, currency)}`)
                : lines.length === 0
                  ? 'Manual receipt — pick a supplier above, then add items below'
                  : `${lines.length} line${lines.length === 1 ? '' : 's'} · subtotal ${fmtRm(subtotalCenti, currency)}`}
            {/* Commander 2026-05-29 — same supplier-binding hint New PO shows:
                once a supplier is chosen the manual picker filters to that
                supplier's bound SKUs (or falls back to the full catalogue when
                the supplier has no bindings yet). */}
            {isManual && supplierId && (
              <span style={{ display: 'block', marginTop: 2, color: 'var(--c-burnt)' }}>
                {bindings.length > 0
                  ? `${bindings.length} item${bindings.length === 1 ? '' : 's'} bound to this supplier — picker filters to these`
                  : 'No SKUs bound to this supplier yet — picker shows all SKUs (one-off receipt)'}
              </span>
            )}
          </span>
        </div>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {lines.length === 0 ? (
            <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)', padding: 'var(--space-3) 0' }}>
              {isManual
                ? 'Pick a supplier in the header, then use “Add another item” below to receive items by hand. Receiving against a PO? Pick one in the header, or use '
                : 'Choose a Purchase Order in the header to receive against it. Receiving lines from several POs at once? Use '}
              <button type="button" onClick={() => navigate('/grns/from-po')} style={{ background: 'none', border: 'none', color: 'var(--c-orange)', cursor: 'pointer', padding: 0, font: 'inherit' }}>From PO (multi)</button>.
            </p>
          ) : (
            /* Card-per-line layout — Commander 2026-05-29: "PO 跟 GRN 界面要一样".
               Mirrors PurchaseOrderNew's ITEMS: each line is a bordered card with
               LINE N + category pill + line value + remove at top, an inline item
               picker (manual) / read-only code (PO-sourced), description, the
               per-category variant editor, then a fields row. */
            lines.map((l, idx) => {
              const lineValueCenti = l.qtyAccepted * l.unitPriceCenti;
              const variantSummary = buildVariantSummary(l.itemGroup, l.variants);
              // Manual lines have no outstanding cap — qty inputs go uncapped.
              const cap = l.outstanding;
              const isManualLine = l.purchaseOrderItemId === null;
              // Commander 2026-05-29 — editable variant section only for MANUAL
              // lines (purchaseOrderItemId === null) that are bedframe/sofa, once
              // the maintenance pools are loaded. PO-sourced lines keep their
              // read-only summary (their variants came from the PO).
              const showVariantEditor =
                isManualLine &&
                (l.itemGroup === 'bedframe' || l.itemGroup === 'sofa') &&
                !!maint;
              const setVariant = (key: string, value: string) =>
                setLine(l.rid, { variants: (() => {
                  const variants: Record<string, unknown> = { ...(l.variants ?? {}), [key]: value };
                  // Auto-compute bedframe Total Height = Divan + Leg + Gap.
                  if (l.itemGroup === 'bedframe' && (key === 'divanHeight' || key === 'legHeight' || key === 'gap')) {
                    const d = parseInches(variants.divanHeight);
                    const lg = parseInches(variants.legHeight);
                    const g = parseInches(variants.gap);
                    variants.totalHeight = (d === 0 && lg === 0 && g === 0) ? '' : `${d + lg + g}"`;
                  }
                  return variants;
                })() });

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
                  {/* Card header — LINE N · category pill · line value · remove */}
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
                      {l.itemGroup && <ItemGroupPill group={l.itemGroup} />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span className={styles.previewPrice}>{fmtRm(lineValueCenti, currency)}</span>
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

                  {/* Identity row — Item Code (Internal) + Description */}
                  <div className={styles.formGrid2}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Item Code (Internal)</span>
                      {isManualLine ? (
                        <>
                          <input
                            type="text"
                            list={`grn-products-${l.rid}`}
                            value={l.materialCode}
                            onChange={(e) => {
                              const code = e.target.value;
                              setProductQuery(code);
                              // Commander 2026-05-29 — supplier-binding-aware
                              // pick (New PO parity). When a supplier is chosen
                              // and the code matches one of its bindings, fill
                              // name + unit price + itemGroup from the binding.
                              const bound = supplierId
                                ? bindings.find((b) => b.material_code === code)
                                : undefined;
                              if (bound) { pickBindingForLine(l.rid, bound); return; }
                              // No supplier (or no binding for this code) → fall
                              // back to the full SKU search match.
                              const match = (productsQ.data ?? []).find((p) => p.code === code);
                              if (match) { pickItemForLine(l.rid, code); return; }
                              // Free typing — keep what's typed so the field stays editable.
                              setLine(l.rid, { materialCode: code });
                            }}
                            placeholder={supplierId && bindings.length > 0
                              ? 'Pick one of this supplier’s bound SKUs…'
                              : 'Type ≥2 chars to search SKUs by code or name…'}
                            className={styles.fieldInput}
                            style={{ fontFamily: 'var(--font-mono)' }}
                          />
                          <datalist id={`grn-products-${l.rid}`}>
                            {/* Supplier chosen + has bindings → list THAT
                                supplier's bound SKUs (New PO parity). Else fall
                                back to the gated full-catalogue search. */}
                            {supplierId && bindings.length > 0
                              ? bindings.map((b) => (
                                  <option key={b.id} value={b.material_code}>
                                    {b.material_name} · {b.supplier_sku} · {fmtRm(b.unit_price_centi, b.currency)}
                                  </option>
                                ))
                              : (productsQ.data ?? []).map((p) => (
                                  <option key={p.id} value={p.code}>{p.name} · {p.category}</option>
                                ))}
                          </datalist>
                        </>
                      ) : (
                        <input
                          type="text"
                          readOnly
                          value={l.materialCode}
                          className={styles.fieldInput}
                          style={{ fontFamily: 'var(--font-mono)', background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                        />
                      )}
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Description</span>
                      <input
                        type="text"
                        value={l.materialName}
                        onChange={(e) => setLine(l.rid, { materialName: e.target.value })}
                        readOnly={!isManualLine}
                        placeholder={isManualLine ? '(auto-filled when an item is picked — editable)' : ''}
                        className={styles.fieldInput}
                        style={!isManualLine ? { background: 'var(--c-cream)', color: 'var(--fg-muted)' } : undefined}
                      />
                    </label>
                  </div>

                  {/* PO-sourced lines: read-only variant summary (variants came
                      from the PO). Manual lines get the editable variant block. */}
                  {!isManualLine && variantSummary && (
                    <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{variantSummary}</div>
                  )}

                  {/* Per-category VARIANT EDITOR for MANUAL bedframe/sofa lines —
                      Commander 2026-05-29: mirrors New PO / the PO Edit modal so
                      the receiver specifies divan/leg/total height, gap, special,
                      seat size + fabric. Same variant keys the PO/SO store. */}
                  {showVariantEditor && (
                    <div style={{
                      background: 'var(--c-cream)',
                      border: '1px solid var(--line)',
                      borderRadius: 'var(--radius-md)',
                      padding: 'var(--space-3)',
                    }}>
                      <div style={{
                        fontFamily: 'var(--font-button)', fontSize: 'var(--fs-11)', fontWeight: 700,
                        letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--fg-muted)',
                        marginBottom: 'var(--space-2)',
                      }}>{l.itemGroup} Variants</div>
                      {l.itemGroup === 'bedframe' ? (
                        <div className={styles.formGrid4}>
                          <VariantSelect label="Divan Height" options={maint!.divanHeights}
                            value={String(l.variants?.divanHeight ?? '')}
                            onChange={(v) => setVariant('divanHeight', v)} />
                          <VariantSelect label="Gap"
                            options={maint!.gaps.map((g) => ({ value: g, priceSen: 0 }))}
                            value={String(l.variants?.gap ?? '')}
                            onChange={(v) => setVariant('gap', v)} />
                          <VariantSelect label="Leg Height" options={maint!.legHeights}
                            value={String(l.variants?.legHeight ?? '')}
                            onChange={(v) => setVariant('legHeight', v)} />
                          {/* Total Heights removed — auto-computed from Divan +
                              Leg + Gap (see setVariant). */}
                          <VariantSelect label="Special" options={maint!.specials}
                            value={String(l.variants?.special ?? '')}
                            onChange={(v) => setVariant('special', v)} />
                        </div>
                      ) : (
                        <div className={styles.formGrid4}>
                          <VariantSelect label="Seat Size"
                            options={maint!.sofaSizes.map((s) => ({ value: s, priceSen: 0 }))}
                            value={String(l.variants?.seatHeight ?? '')}
                            onChange={(v) => setVariant('seatHeight', v)} />
                          <VariantSelect label="Leg Height" options={maint!.sofaLegHeights}
                            value={String(l.variants?.legHeight ?? '')}
                            onChange={(v) => setVariant('legHeight', v)} />
                          <VariantSelect label="Special" options={maint!.sofaSpecials}
                            value={String(l.variants?.special ?? '')}
                            onChange={(v) => setVariant('special', v)} />
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Fabrics (free text)</span>
                            <input className={styles.fieldInput}
                              value={String(l.variants?.fabricColor ?? '')}
                              onChange={(e) => setVariant('fabricColor', e.target.value)} />
                          </label>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Fields row — Outstanding · Received · Accepted · Rejected ·
                      Unit Price · Line Value. (Outstanding is read-only / PO lines
                      only; manual lines show "—".) */}
                  <div className={styles.formGrid4} style={{ gridTemplateColumns: 'repeat(6, 1fr)' }}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Outstanding</span>
                      <input
                        type="text"
                        readOnly
                        value={cap ?? '—'}
                        className={styles.fieldInput}
                        style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Received</span>
                      <input type="number" min={0} max={cap ?? undefined} value={l.qtyReceived}
                        onChange={(e) => {
                          let v = Math.max(0, Number(e.target.value) || 0);
                          if (cap != null) v = Math.min(cap, v);
                          setLine(l.rid, { qtyReceived: v, qtyAccepted: Math.min(l.qtyAccepted, v) });
                        }}
                        className={styles.fieldInput} style={{ textAlign: 'right' }} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Accepted</span>
                      <input type="number" min={0} max={l.qtyReceived} value={l.qtyAccepted}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(l.qtyReceived, Number(e.target.value) || 0));
                          setLine(l.rid, { qtyAccepted: v, qtyRejected: l.qtyReceived - v });
                        }}
                        className={styles.fieldInput} style={{ textAlign: 'right' }} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Rejected</span>
                      <input type="number" min={0} max={l.qtyReceived} value={l.qtyRejected}
                        onChange={(e) => {
                          const v = Math.max(0, Math.min(l.qtyReceived, Number(e.target.value) || 0));
                          setLine(l.rid, { qtyRejected: v, qtyAccepted: l.qtyReceived - v });
                        }}
                        className={styles.fieldInput} style={{ textAlign: 'right' }} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Unit Price ({currency})</span>
                      {/* Editable unit price — carried from the PO / manual entry,
                          adjustable at receiving time (Commander 2026-05-29). */}
                      <MoneyInput bare valueSen={l.unitPriceCenti}
                        onCommit={(sen) => setLine(l.rid, { unitPriceCenti: sen ?? 0 })}
                        inputClassName={styles.fieldInput} selectOnFocus />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Line Value</span>
                      <input
                        type="text"
                        readOnly
                        value={fmtRm(lineValueCenti, currency)}
                        className={styles.fieldInput}
                        style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                      />
                    </label>
                  </div>
                </div>
              );
            })
          )}

          {/* "Add another item" — manual mode (mirrors New PO, always shown). */}
          {isManual && (
            <button
              type="button"
              onClick={addEmptyManualLine}
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
          )}

        </div>
      </section>

      {/* Totals card aligned right — identical to New PO / New Purchase Invoice. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <section className={styles.card} style={{ maxWidth: 360, width: '100%' }}>
          <div className={styles.cardBody}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-14)', marginBottom: 'var(--space-2)' }}>
              <span>Subtotal</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtRm(subtotalCenti, currency)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-16)', fontWeight: 700, borderTop: '1px solid var(--line)', paddingTop: 'var(--space-2)' }}>
              <span>Total</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtRm(subtotalCenti, currency)}</span>
            </div>
          </div>
        </section>
      </div>

      {dialog && (
        <ActionResultDialog
          title={dialog.title}
          body={dialog.body}
          primaryLabel={dialog.goTo ? 'Open GRN' : undefined}
          onPrimary={dialog.goTo ? () => { const g = dialog.goTo!; setDialog(null); navigate(g); } : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};
