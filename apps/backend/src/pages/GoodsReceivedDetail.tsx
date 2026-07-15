// ----------------------------------------------------------------------------
// GoodsReceivedDetail — full-page route at /grns/:id.
//
// EXACT clone of PurchaseOrderDetail (the gold standard): a draft-style View →
// Edit → Save/Back machine, Print PDF, Cancel. The ONLY difference from the PO
// page is the status label — a GRN reads as "Confirmed" (no Draft/lifecycle).
//
//   1. Header: back button + GRN# · supplier + status pill + actions
//   2. Supplier card: editable supplier + received date + DN ref + receive-into
//      warehouse + currency + notes (inputs in Edit, read-only InfoCells in View)
//   3. Line items table: code + group + variants summary + qty(received) + unit
//      + disc + total + delivery (inline-editable in Edit)
//   4. Totals card: subtotal + total (live from line items)
//
// Draft model (mirrors PO #194):
//   • Edit  → snapshots header + lets you edit Qty(received) / Unit / Disc /
//             Delivery INLINE per row. Nothing persists until the single top Save.
//   • Save  → commits header changes + every changed line's field edits.
//   • Back  → leaves the page, discarding the field-edit draft (no auto-save).
//   • Delete (trash) removes the line immediately (no confirm popup).
//   • Changing the header Received Date cascades to every line's delivery date.
//
// grn_status: POSTED → "Confirmed" (editable). CANCELLED → "Cancelled" (locked).
// CLOSED → "Closed" (locked). isLocked = CANCELLED or CLOSED.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft, FileText, Pencil, Trash2, Printer, Save, Ban, ChevronDown, ArrowRightLeft, CheckCircle2,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { activeOptions, buildVariantSummary, canonicalizeVariants, fmtDateOrDash, isServiceLine, maintPickerValues } from '@2990s/shared';
import {
  useGrnDetail,
  useUpdateGrnHeader,
  useUpdateGrnItem,
  useDeleteGrnItem,
  useCancelGrn,
  usePostGrn,
} from '../lib/flow-queries';
import {
  useSuppliers, useSupplierDetail,
  type SupplierRow,
} from '../lib/suppliers-queries';
import { useWarehouses } from '../lib/inventory-queries';
import { sortByText } from '../lib/sort-options';
import { useRacks } from '../lib/warehouse-queries';
import { useMaintenanceConfig, useSpecialAddons } from '../lib/mfg-products-queries';
import { ItemGroupPill } from '../lib/category-badges';
import { MoneyInput } from '../components/MoneyInput';
import { useConfirm } from '../components/ConfirmDialog';
import { useNotify } from '../components/NotifyDialog';
import { SkeletonDetailPage } from '../components/Skeleton';
import { RelationshipMapButton } from '../components/RelationshipMapButton';
import { StatusPill } from '../components/StatusPill';
import { DateField } from '../components/DateField';
import { CurrencyOptions } from '../lib/currencies-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/* Landed-cost allocation (migration 0191) — display labels for the freight
   "平摊" basis. */
const ALLOC_LABEL: Record<string, string> = {
  QTY: 'By quantity',
  VALUE: 'By value',
  CBM: 'By volume (CBM)',
};

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/* T12 — bedframe Total Height is AUTO-COMPUTED = Divan + Leg + Gap (mirrors
   GrnNew / SoLineCard); it is NOT a manual pick. */
const parseInches = (s: unknown): number => {
  if (s == null) return 0;
  const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
  return m && m[1] ? Number(m[1]) : 0;
};

/* T12 — existing GRN lines whose product is a bedframe/sofa get the SAME
   per-category variant editor as New GRN. Small local copy of GrnNew's
   VariantSelect (not exported there). */
const VariantSelect = ({
  label, options, value, onChange, disabled = false,
}: {
  label: string;
  options: Array<{ value: string; priceSen: number }>;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <span className={styles.selectWrap}>
      <select className={styles.fieldSelect} value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}>
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

/* Draft state shapes (mirror PO #194). HeaderDraft mirrors the editable GRN
   header fields; LineDraft holds the inline-editable per-line fields where qty
   maps to qty_received. T12 widens it with the line's identity/variant fields
   (materialName / itemGroup / variants) so an EXISTING GRN line can edit its
   description + bedframe/sofa variants in Edit mode; the server re-buckets
   inventory on save. */
type HeaderDraft = {
  supplierId: string;
  receivedAt: string;
  deliveryNoteRef: string;
  warehouseId: string;
  currency: string;
  /* Landed-cost core (migration 0190) — MYR per 1 unit of the GRN currency, kept
     as a string for the numeric input. Editing it re-costs the FIFO lot to MYR. */
  exchangeRate: string;
  /* Landed-cost allocation (migration 0191) — freight "平摊" basis ('QTY' |
     'VALUE' | 'CBM'). Kept as string (like currency) so the page's generic
     setHeaderField(k, v: string) accepts it; the server normalises. Changing it
     re-splits the charge pool + re-costs the lot on Save. */
  allocationMethod: string;
  notes: string;
};
type LineDraft = {
  qty: number;            // maps to qty_received
  unitPriceCenti: number;
  discountCenti: number;
  deliveryDate: string | null;
  materialName: string;
  itemGroup: string | null;
  variants: Record<string, unknown> | null;
};

type GrnItemRow = Record<string, unknown> & {
  id: string;
  material_code: string;
  material_name: string;
  /* Supplier-facing dual-code rule (Commander) — grn_items snapshots the
     supplier's own SKU at receive time; surfaced read-only on the line card. */
  supplier_sku?: string | null;
  qty_received: number;
  unit_price_centi: number;
  discount_centi?: number;
  line_total_centi?: number;
  /* Landed-cost allocation (migration 0191) — freight (MYR sen) allocated to
     this goods line at GRN-post; folded into the FIFO lot cost. */
  allocated_charge_centi?: number;
  delivery_date?: string | null;
  item_group?: string | null;
  material_kind?: string | null;
  description?: string | null;
  variants?: Record<string, unknown> | null;
  /* Commander 2026-06-04 — destination rack chosen at receiving time (nullable).
     Resolved to its label via the GRN's warehouse racks for display. */
  rack_id?: string | null;
  /* Bug #2 (2026-05-31) — server-resolved per-line source PO number + the GRN's
     receive date, so each line surfaces "received from which PO" + "receive date". */
  source_po_number?: string | null;
  received_at?: string | null;
  /* Downstream "Transfer To" breakdown (read-only): the Purchase Invoice(s) and
     Purchase Return(s) this GRN line was carried into, resolved server-side. */
  downstream?: { docNumber: string; docType: 'PI' | 'PR'; qty: number; status: string }[];
};

const headerSnapshot = (g: any): HeaderDraft => ({
  supplierId:      g.supplier_id ?? '',
  receivedAt:      (g.received_at ?? '').slice(0, 10),
  deliveryNoteRef: g.delivery_note_ref ?? '',
  warehouseId:     g.warehouse_id ?? '',
  currency:        g.currency ?? 'MYR',
  // Landed-cost core (0190) — numeric(14,6) comes back as a string; default '1'.
  exchangeRate:    g.exchange_rate != null ? String(g.exchange_rate) : '1',
  // Landed-cost allocation (0191) — freight basis; default QTY.
  allocationMethod: (g.allocation_method as string) ?? 'QTY',
  notes:           g.notes ?? '',
});

const lineSnapshot = (it: GrnItemRow): LineDraft => ({
  qty:            it.qty_received,
  unitPriceCenti: it.unit_price_centi,
  discountCenti:  it.discount_centi ?? 0,
  deliveryDate:   it.delivery_date ?? null,
  materialName:   it.description ?? it.material_name ?? '',
  itemGroup:      it.item_group ?? null,
  /* Variants-vocabulary unification (Commander 2026-06-26) — canonicalize on
     enter-edit so a stray non-canonical GRN line still prefills the dropdowns. */
  variants:       canonicalizeVariants(it.item_group ?? 'others', (it.variants as Record<string, unknown> | null) ?? null),
});

export const GoodsReceivedDetail = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const detail = useGrnDetail(id ?? null);
  const updateHeader = useUpdateGrnHeader();
  const updateItem = useUpdateGrnItem();
  const deleteItem = useDeleteGrnItem();
  const askConfirm = useConfirm();
  const notify = useNotify();
  const cancel = useCancelGrn();
  const confirmGrn = usePostGrn();

  const grn = detail.data?.grn ?? null;
  const items = (detail.data?.items ?? []) as GrnItemRow[];

  /* Commander 2026-06-04 — resolve each line's rack_id to its label. Racks are
     warehouse-scoped, so we load the racks of THIS GRN's receive-into warehouse
     (grn.warehouse_id) and build an id → label map for the Rack column below. */
  const racksQ = useRacks({ warehouseId: grn?.warehouse_id ?? undefined });
  const rackLabelById = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of racksQ.data?.racks ?? []) m.set(r.id, r.rack);
    return m;
  }, [racksQ.data?.racks]);

  /* Owner 2026-07-15 — Supplier Code display fallback. GRNs created before the
     supplier-SKU carry-through landed have grn_items.supplier_sku = NULL, so
     resolve the SUPPLIER's live bindings (material_code → supplier_sku, main
     binding wins) and use them when the line snapshot is empty. Same
     snapshot-first-binding-fallback rule the GRN PDF already applies. */
  const lineSupplierDetail = useSupplierDetail(grn?.supplier_id ?? null);
  const supplierSkuByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of lineSupplierDetail.data?.bindings ?? []) {
      if (b.material_kind !== 'mfg_product' || !b.supplier_sku?.trim()) continue;
      if (b.is_main_supplier || !m.has(b.material_code)) m.set(b.material_code, b.supplier_sku);
    }
    return m;
  }, [lineSupplierDetail.data?.bindings]);

  /* T12 — maintenance config + special-orders pools drive the per-category
     variant editor on EXISTING bedframe/sofa lines in Edit mode (same dropdown
     pools as New GRN). */
  const maintQ = useMaintenanceConfig('master');
  const maint  = maintQ.data?.data ?? null;
  const specialAddonsQ = useSpecialAddons();
  const specialsPools = useMemo(() => {
    const rows = (specialAddonsQ.data ?? [])
      .filter((r) => r.active)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code));
    const pick = (cat: string) => rows.filter((r) => r.categories.includes(cat)).map((r) => ({ value: r.code, priceSen: 0 }));
    return { bedframe: pick('BEDFRAME'), sofa: pick('SOFA') };
  }, [specialAddonsQ.data]);

  /* View → Edit gate (mirror PO) — default read-only View; click Edit to flip
     into draft mode. The GRN list's right-click "Edit" lands here with ?edit=1. */
  const [searchParams] = useSearchParams();
  const [isEditing, setIsEditing] = useState(() => searchParams.get('edit') === '1');

  /* Draft buffers. headerDraft is null until the first header field is touched
     (then seeded from the GRN). lineDrafts overlays per-line edits keyed by item
     id; any line without an entry shows its stored values. None of this persists
     until Save. */
  const [headerDraft, setHeaderDraft] = useState<HeaderDraft | null>(null);
  const [lineDrafts, setLineDrafts] = useState<Record<string, LineDraft>>({});
  const [savingDraft, setSavingDraft] = useState(false);

  // DRAFT + POSTED ("Confirmed") are both editable; a DRAFT additionally shows a
  // Confirm action that posts it (stock IN + PO rollup). Editing locks only once
  // the GRN has a downstream PI/PR (unified model, migration 0106) — delete the
  // child first — or once it's CANCELLED / CLOSED.
  const hasChildren = Boolean(grn?.has_children);
  const isDraft = grn?.status === 'DRAFT';
  const isEditableStatus = grn ? (grn.status === 'POSTED' || grn.status === 'DRAFT') : false;
  const isLocked = grn ? (!isEditableStatus || hasChildren) : true;
  // Distinguish the child-lock case so we can show the "delete it first" note.
  const lockedDueToChildren = grn ? (isEditableStatus && hasChildren) : false;

  /* If the GRN locks while we're in Edit mode (e.g. cancelled in another tab),
     drop back to View + discard the draft. */
  useEffect(() => {
    if (isLocked && isEditing) {
      setIsEditing(false);
      setHeaderDraft(null);
      setLineDrafts({});
    }
  }, [isLocked, isEditing]);

  if (detail.isLoading) {
    return <SkeletonDetailPage />;
  }
  if (detail.isError || !grn) {
    return (
      <div className={styles.page}>
        <Link to="/grns" className={styles.backBtn}>
          <ArrowLeft {...ICON} />
          <span>Back</span>
        </Link>
        <div className={styles.bannerWarn}>
          <strong>Goods received note not found.</strong>
          {detail.error instanceof Error ? ` ${detail.error.message}` : null}
        </div>
      </div>
    );
  }

  /* ── Draft helpers (grn is guaranteed non-null past the guards above) ── */
  const visibleItems = items;
  const lineOf = (it: GrnItemRow): LineDraft => lineDrafts[it.id] ?? lineSnapshot(it);
  const lineTotalOf = (it: GrnItemRow): number => {
    if (!isEditing) return it.line_total_centi ?? (it.qty_received * it.unit_price_centi - (it.discount_centi ?? 0));
    const d = lineOf(it);
    return d.qty * d.unitPriceCenti - d.discountCenti;
  };
  const itemsSubtotal = visibleItems.reduce((s, it) => s + lineTotalOf(it), 0);
  const grandTotal = itemsSubtotal + (grn.tax_centi ?? 0);

  const headerView = headerDraft ?? headerSnapshot(grn);

  /* Landed-cost allocation (migration 0191) — the stored per-line freight +
     total charge pool. In VIEW we show the SAVED allocation (allocated_charge_centi
     persisted at post). The header select is read-only in View, editable in Edit
     (re-allocates + re-costs on Save). chargePool = Σ SERVICE-line line totals. */
  const isSvcItem = (it: GrnItemRow) =>
    isServiceLine({ itemGroup: it.item_group ?? null, itemCode: it.material_code });
  const chargePoolCenti = visibleItems
    .filter(isSvcItem)
    .reduce((s, it) => s + lineTotalOf(it), 0);
  const allocatedOf = (it: GrnItemRow): number => it.allocated_charge_centi ?? 0;
  /* Landed-cost core (migration 0190) — the effective FX rate (draft in Edit,
     stored in View) + whether this GRN is foreign, for the MYR cost preview.
     The line prices stay in the GRN currency; this rate converts the recorded
     inventory cost (FIFO lot) to MYR. */
  const isForeignGrn = String(grn.currency ?? 'MYR').toUpperCase() !== 'MYR';
  const grnRateNum = (() => {
    const n = Number(headerView.exchangeRate);
    return Number.isFinite(n) && n > 0 ? n : 0;
  })();

  const setHeaderField = (k: keyof HeaderDraft, v: string) => {
    setHeaderDraft((h) => ({ ...(h ?? headerSnapshot(grn)), [k]: v }));
    // Received Date cascades to every line's delivery date (mirror PO's Expected
    // Delivery cascade).
    if (k === 'receivedAt') {
      setLineDrafts((prev) => {
        const next = { ...prev };
        for (const it of items) {
          next[it.id] = { ...(prev[it.id] ?? lineSnapshot(it)), deliveryDate: v || null };
        }
        return next;
      });
    }
  };

  const setLine = (it: GrnItemRow, patch: Partial<LineDraft>) =>
    setLineDrafts((prev) => ({ ...prev, [it.id]: { ...(prev[it.id] ?? lineSnapshot(it)), ...patch } }));

  /* T12 — patch one variant key on a line + auto-compute bedframe Total Height
     (= Divan + Leg + Gap), mirroring New GRN's setVariant. */
  const setVariant = (it: GrnItemRow, key: string, value: string) =>
    setLineDrafts((prev) => {
      const cur = prev[it.id] ?? lineSnapshot(it);
      const variants: Record<string, unknown> = { ...(cur.variants ?? {}), [key]: value };
      if (cur.itemGroup === 'bedframe' && (key === 'divanHeight' || key === 'legHeight' || key === 'gap')) {
        const d = parseInches(variants.divanHeight);
        const lg = parseInches(variants.legHeight);
        const g = parseInches(variants.gap);
        variants.totalHeight = (d === 0 && lg === 0 && g === 0) ? '' : `${d + lg + g}"`;
      }
      return { ...prev, [it.id]: { ...cur, variants } };
    });

  const enterEdit = () => {
    setHeaderDraft(null);
    setLineDrafts({});
    setIsEditing(true);
  };

  /* Single Save — commit header (only if touched) + every changed line's field
     edits, then drop back to View. Back discards the field-edit draft.
     (Line delete already committed server-side — see the trash handler.) */
  const handleSave = async () => {
    if (savingDraft) return;
    setSavingDraft(true);
    try {
      if (headerDraft) {
        await updateHeader.mutateAsync({ id: grn.id, ...(headerDraft as Record<string, unknown>) });
      }
      for (const it of items) {
        const d = lineDrafts[it.id];
        if (!d) continue;
        const snap = lineSnapshot(it);
        const changed =
          d.qty !== it.qty_received ||
          d.unitPriceCenti !== it.unit_price_centi ||
          d.discountCenti !== (it.discount_centi ?? 0) ||
          (d.deliveryDate ?? null) !== (it.delivery_date ?? null) ||
          /* T12 — identity/variant edits participate in the dirty check. */
          d.materialName !== snap.materialName ||
          (d.itemGroup ?? '') !== (snap.itemGroup ?? '') ||
          JSON.stringify(d.variants ?? {}) !== JSON.stringify(snap.variants ?? {});
        if (changed) {
          await updateItem.mutateAsync({
            grnId: grn.id, itemId: it.id,
            qty: d.qty, unitPriceCenti: d.unitPriceCenti,
            discountCenti: d.discountCenti, deliveryDate: d.deliveryDate,
            /* T12 — send the line's identity + variants; useUpdateGrnItem
               forwards them and the server re-buckets inventory + recomputes
               description2. materialName maps to both description + name. */
            materialName: d.materialName,
            description:  d.materialName,
            itemGroup:    d.itemGroup ?? undefined,
            variants:     d.variants ?? {},
          });
        }
      }
      setIsEditing(false);
      setHeaderDraft(null);
      setLineDrafts({});
    } catch (e) {
      notify({ title: 'Save failed', body: e instanceof Error ? e.message : String(e), tone: 'error' });
    } finally {
      setSavingDraft(false);
    }
  };

  const handlePrint = () => {
    // GRN PDF (AutoCount layout) — mirrors PO's handlePrint wiring its own
    // purchase-order-pdf helper, here the GRN-specific grn-pdf helper.
    import('../lib/grn-pdf').then(({ generateGrnPdf }) =>
      generateGrnPdf(grn, items as any),
    ).catch((e) => notify({ title: 'PDF generation failed', body: e instanceof Error ? e.message : String(e), tone: 'error' }));
  };

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/grns" className={styles.backBtn}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </Link>
          <div>
            <h1 className={styles.title}>
              <FileText size={14} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {grn.grn_number} — {grn.supplier?.name ?? grn.supplier?.code ?? '—'}
            </h1>
          </div>
        </div>
        <div className={styles.actions}>
          {/* Total KPI tile — tracks the live line items (incl. unsaved draft edits). */}
          <div className={styles.totalRail}>
            <span className={styles.totalRailLabel}>Total</span>
            <span className={styles.totalRailValue}>{fmtRm(grandTotal, grn.currency)}</span>
          </div>
          {/* A GRN is Confirmed the moment it exists (no Draft/lifecycle). */}
          <StatusPill docType="grn" status={grn.status} />
          <RelationshipMapButton type="grn" id={id} />
          {/* From Purchase Order — Commander 2026-05-31: the EDIT flow uses the
              SAME top-level convert-from-PO picker as Create GR (a GRN is built by
              CONVERTING from POs, aggregating the supplier's outstanding PO lines
              for THIS warehouse — not a free line-by-line add). Mirrors GrnNew's
              header action; appends the picked lines into THIS GRN. Shown only in
              Edit mode and never while locked (cancelled / closed / has PI-PR). */}
          {isEditing && !isLocked && (
            <Button
              variant="ghost" size="md"
              onClick={() => navigate(`/grns/from-po?appendToGrn=${grn.id}`)}
              title="Add the supplier's outstanding PO lines for this warehouse into this GRN"
            >
              <ArrowRightLeft {...ICON} />
              <span>From Purchase Order</span>
            </Button>
          )}
          <Button variant="ghost" size="md" onClick={handlePrint}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
          {/* Confirm — only on a DRAFT (and not child-locked). Posts the GRN:
              the stock IN + PO received-rollup fire server-side via /post. After
              that it reads as Confirmed. Mirrors the SO/DO/SI/PO Confirm. */}
          {isDraft && !hasChildren && (
            <Button variant="primary" size="md"
              onClick={async () => {
                if (!(await askConfirm({
                  title: `Confirm GRN ${grn.grn_number}?`,
                  body: 'This posts the receipt — stock moves in and the source PO\'s received qty is updated. You can still cancel afterwards.',
                  confirmLabel: 'Confirm GRN',
                }))) return;
                confirmGrn.mutate(grn.id, {
                  onError: (err) => notify({ title: 'Confirm failed', body: err instanceof Error ? err.message : String(err), tone: 'error' }),
                });
              }}
              disabled={confirmGrn.isPending}>
              <CheckCircle2 {...ICON} />
              <span>{confirmGrn.isPending ? 'Confirming…' : 'Confirm'}</span>
            </Button>
          )}
          {/* Cancel — when the GRN is still editable (Draft or Confirmed) AND has
              no downstream PI/PR (unified model). A DRAFT just flips to CANCELLED
              (nothing to reverse); a POSTED GRN reverses the receipt server-side. */}
          {(grn.status === 'POSTED' || isDraft) && !hasChildren && (
            <Button variant="ghost" size="md"
              onClick={async () => {
                if (!(await askConfirm({
                  title: `Cancel GRN ${grn.grn_number}?`,
                  body: isDraft
                    ? 'This cancels the draft. Nothing was posted, so no stock or PO quantities change. Line items stay for audit.'
                    : `This reverses the receipt — stock is taken back out and the source PO's received qty is rolled back. Line items stay for audit.`,
                  confirmLabel: 'Cancel GRN',
                  danger: true,
                }))) return;
                cancel.mutate(grn.id, {
                  onError: (err) => notify({ title: 'Cancel failed', body: err instanceof Error ? err.message : String(err), tone: 'error' }),
                });
              }}
              disabled={cancel.isPending}>
              <Ban {...ICON} />
              <span>{cancel.isPending ? 'Cancelling…' : 'Cancel'}</span>
            </Button>
          )}
          {/* View → Edit gate. Default View shows Edit (disabled while locked);
              editing flips into draft mode and the button becomes the single
              "Save" that commits the whole draft. Back (top-left) discards. */}
          {!isEditing ? (
            <Button variant="primary" size="md" onClick={enterEdit} disabled={isLocked}>
              <Pencil {...ICON} />
              <span>Edit</span>
            </Button>
          ) : (
            <Button variant="primary" size="md" onClick={handleSave} disabled={savingDraft}>
              <Save {...ICON} />
              <span>{savingDraft ? 'Saving…' : 'Save'}</span>
            </Button>
          )}
        </div>
      </div>

      {/* Child-lock note — POSTED but has a downstream PI/PR, so the page is
          read-only until the child is deleted (unified model, migration 0106). */}
      {lockedDueToChildren && (
        <div className={styles.bannerWarn}>
          <strong>Locked</strong> — has a Purchase Invoice / Return. Delete it first to edit.
        </div>
      )}

      {/* ── Supplier / dates / warehouse / currency / notes ─────── */}
      {/* In View the card renders read-only text; in Edit it shows inputs bound
          to the draft (committed by the single top Save). */}
      <SupplierCard
        grn={grn}
        draft={headerView}
        onField={setHeaderField}
        locked={isLocked}
        isEditing={isEditing}
      />

      {/* ── Line items ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({visibleItems.length})</h2>
          {/* Entry-point consistency (Commander 2026-05-31): the convert-from-PO
              action now lives as a prominent TOP-LEVEL header button (see actions
              row above), mirroring Create GR — NOT a buried line-level add. A GRN
              is built by CONVERTING from POs, never by free add-line. */}
        </header>

        {visibleItems.length === 0 ? (
          <p className={styles.emptyRow}>No items on this GRN.</p>
        ) : (
          /* Card-per-line layout — Commander 2026-05-31: "全部用卡片带框", GR first
             to match Create GR. Each line is a bordered card with LINE N + category
             pill + line value + remove at top, a read-only identity row (code +
             description), the variant summary, then a fields row. Qty(received) /
             Unit / Disc / Delivery are inline-editable in Edit; read-only in View. */
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {visibleItems.map((it, idx) => {
              const d = lineOf(it);
              const lineValueCenti = lineTotalOf(it);
              const variantSummary = buildVariantSummary(it.item_group ?? null, it.variants as Record<string, unknown> | null)
                || it.description
                || it.material_name;
              /* Landed-cost allocation (0191) — this goods line's stored freight +
                 landed unit cost (base unit + per-unit freight). Goods lines only,
                 shown when the GRN carries a charge pool. */
              const lineIsSvc = isSvcItem(it);
              const lineAllocCenti = allocatedOf(it);
              const lineQty = it.qty_received ?? 0;
              const landedUnitCenti = it.unit_price_centi + (lineQty > 0 ? Math.round(lineAllocCenti / lineQty) : 0);
              return (
                <div
                  key={it.id}
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
                      {it.item_group && <ItemGroupPill group={it.item_group} />}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
                        <span className={styles.previewPrice}>{fmtRm(lineValueCenti, grn.currency)}</span>
                        {/* Landed-cost allocation (0191) — +freight & landed unit
                            cost on goods lines when the GRN carries a charge. */}
                        {chargePoolCenti > 0 && !lineIsSvc && lineAllocCenti > 0 && (
                          <span style={{ fontSize: 'var(--fs-11)', color: 'var(--c-accent, #8a6d3b)', marginTop: 2 }}>
                            +{fmtRm(lineAllocCenti, grn.currency)} freight · landed {fmtRm(landedUnitCenti, grn.currency)}/unit
                          </span>
                        )}
                      </span>
                      {/* Remove — Edit mode only. Commander 2026-06-15 — confirm
                          before delete (no more 裸奔). On confirm the line is
                          removed and the server releases the PO's received_qty back. */}
                      {isEditing && (
                        <button
                          type="button"
                          onClick={async () => {
                            if (isLocked) return;
                            if (await askConfirm({
                              title: 'Remove this line?',
                              body: "The line is removed and the PO's received quantity is released back.",
                              confirmLabel: 'Remove',
                              danger: true,
                            })) {
                              deleteItem.mutate({ grnId: grn.id, itemId: it.id });
                            }
                          }}
                          title="Remove line"
                          disabled={isLocked || deleteItem.isPending}
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
                      )}
                    </div>
                  </div>

                  {/* Identity row — Item Code (always read-only; a GRN line's
                      code comes from the source PO / SKU). T12: Description is now
                      EDITABLE in Edit mode (read-only in View). */}
                  <div className={styles.formGrid2}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Item Code (Internal)</span>
                      <input
                        type="text" readOnly value={it.material_code}
                        className={styles.fieldInput}
                        style={{ fontFamily: 'var(--font-mono)', background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Supplier Code</span>
                      {/* Snapshot first, live binding fallback (pre-carry-through
                          GRNs have a NULL snapshot) — mirrors the GRN PDF rule. */}
                      <input
                        type="text" readOnly
                        value={it.supplier_sku?.trim() || supplierSkuByCode.get(it.material_code) || '—'}
                        className={styles.fieldInput}
                        style={{ fontFamily: 'var(--font-mono)', background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                      />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Description</span>
                      {isEditing ? (
                        <input
                          type="text" value={d.materialName} disabled={isLocked}
                          onChange={(e) => setLine(it, { materialName: e.target.value })}
                          className={styles.fieldInput}
                        />
                      ) : (
                        <input
                          type="text" readOnly value={it.description ?? it.material_name}
                          className={styles.fieldInput}
                          style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                        />
                      )}
                    </label>
                  </div>

                  {/* T12 — variants. View shows the read-only summary; Edit shows
                      the per-category editor (bedframe / sofa) for EXISTING lines,
                      mirroring New GRN. The server re-buckets inventory on save. */}
                  {isEditing && (d.itemGroup === 'bedframe' || d.itemGroup === 'sofa') && maint ? (
                    <div style={{ background: 'var(--c-cream)', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)' }}>
                      <div style={{ fontFamily: 'var(--font-button)', fontSize: 'var(--fs-11)', fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--fg-muted)', marginBottom: 'var(--space-2)' }}>{d.itemGroup} Variants</div>
                      {d.itemGroup === 'bedframe' ? (
                        <div className={styles.formGrid4}>
                          <VariantSelect label="Divan Height" disabled={isLocked} options={activeOptions(maint.divanHeights, String(d.variants?.divanHeight ?? ''))}
                            value={String(d.variants?.divanHeight ?? '')} onChange={(v) => setVariant(it, 'divanHeight', v)} />
                          <VariantSelect label="Gap" disabled={isLocked} options={maintPickerValues(maint.gaps, String(d.variants?.gap ?? '')).map((g) => ({ value: g, priceSen: 0 }))}
                            value={String(d.variants?.gap ?? '')} onChange={(v) => setVariant(it, 'gap', v)} />
                          <VariantSelect label="Leg Height" disabled={isLocked} options={activeOptions(maint.legHeights, String(d.variants?.legHeight ?? ''))}
                            value={String(d.variants?.legHeight ?? '')} onChange={(v) => setVariant(it, 'legHeight', v)} />
                          {/* Total Height auto-computed (see setVariant). */}
                          <VariantSelect label="Special" disabled={isLocked} options={specialsPools.bedframe}
                            value={String(d.variants?.special ?? '')} onChange={(v) => setVariant(it, 'special', v)} />
                        </div>
                      ) : (
                        <div className={styles.formGrid4}>
                          <VariantSelect label="Seat Size" disabled={isLocked} options={maintPickerValues(maint.sofaSizes, String(d.variants?.seatHeight ?? '')).map((s) => ({ value: s, priceSen: 0 }))}
                            value={String(d.variants?.seatHeight ?? '')} onChange={(v) => setVariant(it, 'seatHeight', v)} />
                          <VariantSelect label="Leg Height" disabled={isLocked} options={activeOptions(maint.sofaLegHeights, String(d.variants?.legHeight ?? ''))}
                            value={String(d.variants?.legHeight ?? '')} onChange={(v) => setVariant(it, 'legHeight', v)} />
                          <VariantSelect label="Special" disabled={isLocked} options={specialsPools.sofa}
                            value={String(d.variants?.special ?? '')} onChange={(v) => setVariant(it, 'special', v)} />
                          <label className={styles.field}>
                            <span className={styles.fieldLabel}>Fabrics (free text)</span>
                            <input className={styles.fieldInput} disabled={isLocked} value={String(d.variants?.fabricColor ?? '')}
                              onChange={(e) => setVariant(it, 'fabricColor', e.target.value)} />
                          </label>
                        </div>
                      )}
                    </div>
                  ) : (
                    variantSummary && (
                      <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{variantSummary}</div>
                    )
                  )}

                  {/* Bug #2 (2026-05-31) — "received from which PO" + "receive date"
                      per line. source_po_number is server-resolved from the line's
                      purchase_order_item_id (null for manual lines); received_at
                      mirrors the GRN header date. */}
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-4)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                    <span>
                      Received from PO:{' '}
                      <strong style={{ fontFamily: 'var(--font-mono)', color: 'var(--fg)' }}>
                        {it.source_po_number ?? '— (manual)'}
                      </strong>
                    </span>
                    <span>
                      Receive date:{' '}
                      <strong style={{ color: 'var(--fg)' }}>
                        {fmtDateOrDash(it.received_at ?? grn.received_at ?? null)}
                      </strong>
                    </span>
                    <span>
                      Transfer To:{' '}
                      {(it.downstream ?? []).length === 0
                        ? <strong style={{ color: 'var(--fg)' }}>—</strong>
                        : (it.downstream ?? []).map((dn, dni) => (
                            <strong key={dni} style={{ color: 'var(--c-burnt)', marginRight: 8, whiteSpace: 'nowrap' }}>
                              {dn.docNumber} <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>×{dn.qty}</span>
                            </strong>
                          ))}
                    </span>
                  </div>

                  {/* Fields row — Received · Unit Price · Discount · Delivery Date.
                      Editable inline in Edit; read-only display in View. */}
                  <div className={styles.formGrid4}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Received</span>
                      {isEditing ? (
                        <input
                          type="number" min={0}
                          className={styles.fieldInput} style={{ textAlign: 'right' }}
                          value={d.qty} disabled={isLocked}
                          onChange={(e) => setLine(it, { qty: Number(e.target.value) || 0 })}
                        />
                      ) : (
                        <input
                          type="text" readOnly value={it.qty_received}
                          className={styles.fieldInput}
                          style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                        />
                      )}
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Unit Price ({grn.currency})</span>
                      {isEditing ? (
                        <MoneyInput bare selectOnFocus inputClassName={styles.fieldInput}
                          valueSen={d.unitPriceCenti} disabled={isLocked}
                          onCommit={(sen) => setLine(it, { unitPriceCenti: sen ?? 0 })} />
                      ) : (
                        <input
                          type="text" readOnly value={fmtRm(it.unit_price_centi, grn.currency)}
                          className={styles.fieldInput}
                          style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                        />
                      )}
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Discount</span>
                      {isEditing ? (
                        <MoneyInput bare selectOnFocus inputClassName={styles.fieldInput}
                          valueSen={d.discountCenti} disabled={isLocked}
                          onCommit={(sen) => setLine(it, { discountCenti: sen ?? 0 })} />
                      ) : (
                        <input
                          type="text" readOnly
                          value={(it.discount_centi ?? 0) > 0 ? fmtRm(it.discount_centi, grn.currency) : '—'}
                          className={styles.fieldInput}
                          style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                        />
                      )}
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Delivery Date</span>
                      {isEditing ? (
                        <DateField
                          fullWidth className={styles.fieldInput}
                          value={d.deliveryDate ?? ''} disabled={isLocked}
                          onChange={(iso) => setLine(it, { deliveryDate: iso || null })}
                        />
                      ) : (
                        <input
                          type="text" readOnly value={it.delivery_date ?? '—'}
                          className={styles.fieldInput}
                          style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                        />
                      )}
                    </label>
                    {/* Commander 2026-06-04 — destination Rack this line went to.
                        Read-only: rack_id is set at receiving time (New GRN form).
                        Resolved to its label via the GRN warehouse's racks; "—"
                        when the line has no rack. */}
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Rack</span>
                      <input
                        type="text" readOnly
                        value={it.rack_id ? (rackLabelById.get(it.rack_id) ?? '—') : '—'}
                        className={styles.fieldInput}
                        style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }}
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Totals ────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Totals</h2>
        </header>
        <div className={styles.cardBody}>
          {/* Subtotal/total computed LIVE from the visible line items (incl.
              unsaved draft edits). GRN has no tax. */}
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}>
              <span className={styles.totalLabel}>Subtotal</span>
              <span className={styles.totalValue}>{fmtRm(itemsSubtotal, grn.currency)}</span>
            </div>
            <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
              <span className={styles.totalLabel}>Total</span>
              <span className={`${styles.totalValue} ${styles.grandTotal}`}>{fmtRm(grandTotal, grn.currency)}</span>
            </div>
            {/* Landed-cost allocation (0191) — the SERVICE-line freight pool being
                spread across goods lines ("平摊"). Shown only when there's a charge. */}
            {chargePoolCenti > 0 && (
              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>Freight allocated ({ALLOC_LABEL[String(grn.allocation_method ?? 'QTY')] ?? 'By quantity'})</span>
                <span className={styles.totalValue}>{fmtRm(chargePoolCenti, grn.currency)}</span>
              </div>
            )}
            {/* Landed-cost core (0190) — MYR inventory cost for a foreign GRN. */}
            {isForeignGrn && (
              <div className={styles.totalRow}>
                <span className={styles.totalLabel}>Inventory cost (MYR)</span>
                <span className={styles.totalValue}>{fmtRm(Math.round(grandTotal * grnRateNum), 'MYR')}</span>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Supplier / header card — controlled by the page's draft (mirror PO).
   In View it renders read-only InfoCells; in Edit it shows inputs bound to the
   page draft (committed by the single top Save).
   ════════════════════════════════════════════════════════════════════════ */

const SupplierCard = ({
  grn, draft, onField, locked, isEditing = true,
}: {
  grn: any;
  /** Draft header values (page-owned). In View these mirror the saved GRN. */
  draft: HeaderDraft;
  /** Update a single header field on the page draft. */
  onField: (k: keyof HeaderDraft, v: string) => void;
  locked: boolean;
  /** View → Edit gate. When false the card renders read-only display text. */
  isEditing?: boolean;
}) => {
  const suppliersQ = useSuppliers();
  const suppliers = suppliersQ.data ?? [];
  const warehousesQ = useWarehouses();
  const warehouses = warehousesQ.data ?? [];
  // In Edit follow the draft's picked supplier; in View follow the saved GRN.
  const supplierIdForDetail = isEditing ? (draft.supplierId || null) : (grn.supplier_id ?? null);
  const supplierDetail = useSupplierDetail(supplierIdForDetail);
  const supplier: SupplierRow | null = supplierDetail.data?.supplier ?? null;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Supplier · Dates · Notes</h2>
      </header>
      <div className={styles.cardBody}>
        {!isEditing ? (
          /* View mode — read-only display text sourced from the saved GRN. */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'var(--space-3) var(--space-4)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-13)',
            }}
          >
            <div style={{ gridColumn: 'span 2' }}>
              <InfoCell label="Supplier"
                value={grn.supplier?.name ?? grn.supplier?.code ?? supplier?.name ?? supplier?.code ?? null} />
            </div>
            <InfoCell label="Currency" value={grn.currency || null} />
            {/* Landed-cost core (0190) — show the FX rate only for a foreign GRN. */}
            {String(grn.currency ?? 'MYR').toUpperCase() !== 'MYR'
              ? <InfoCell label={`Exchange rate (MYR per 1 ${grn.currency})`}
                  value={grn.exchange_rate != null ? String(grn.exchange_rate) : null} />
              : <div />}
            <InfoCell label="Received Date" value={grn.received_at ? fmtDateOrDash(grn.received_at) : null} />
            <InfoCell label="Delivery Note Ref" value={grn.delivery_note_ref || null} />
            <InfoCell label="Receive Into"
              value={(() => {
                const wh = warehouses.find((w) => w.id === grn.warehouse_id);
                return wh ? `${wh.code} · ${wh.name}` : null;
              })()} />
            {/* Landed-cost allocation (0191) — the freight "平摊" basis. */}
            <InfoCell label="Charge allocation"
              value={ALLOC_LABEL[String(grn.allocation_method ?? 'QTY')] ?? 'By quantity'} />
            <div style={{ gridColumn: 'span 2' }}>
              <InfoCell label="Notes" value={grn.notes || null} />
            </div>
          </div>
        ) : (
        <div className={styles.formGrid4}>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Supplier *</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={draft.supplierId} disabled={locked}
                onChange={(e) => onField('supplierId', e.target.value)}>
                <option value="">— Pick supplier —</option>
                {sortByText(suppliers).map((s) => (
                  <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                ))}
              </select>
              <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} />
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Currency</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={draft.currency} disabled={locked}
                onChange={(e) => onField('currency', e.target.value)}>
                {/* Active currencies from the master (migration 0193). */}
                <CurrencyOptions current={draft.currency} />
              </select>
              <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} />
            </span>
          </label>
          {/* Landed-cost core (0190) — Exchange rate, shown only for a foreign
              GRN currency. Editing it re-costs the FIFO lot to MYR on Save. */}
          {String(draft.currency).toUpperCase() !== 'MYR' ? (
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Exchange rate (MYR per 1 {draft.currency})</span>
              <input
                type="number" min={0} step="0.000001" inputMode="decimal"
                value={draft.exchangeRate} disabled={locked}
                onChange={(e) => onField('exchangeRate', e.target.value)}
                placeholder="e.g. 0.62"
                className={styles.fieldInput} style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
              />
            </label>
          ) : <div />}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Received Date</span>
            {/* Changing this cascades to every line's Delivery Date (handled in
                the page's setHeaderField). */}
            <DateField fullWidth className={styles.fieldInput} value={draft.receivedAt ?? ''} disabled={locked}
              onChange={(iso) => onField('receivedAt', iso)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Delivery Note Ref</span>
            <input className={styles.fieldInput} value={draft.deliveryNoteRef} disabled={locked}
              onChange={(e) => onField('deliveryNoteRef', e.target.value)} />
          </label>
          {/* Receive-into warehouse: where the inventory IN landed. */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Receive Into</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={draft.warehouseId} disabled={locked}
                onChange={(e) => onField('warehouseId', e.target.value)}>
                <option value="">— No warehouse —</option>
                {sortByText(warehouses.filter((w) => w.is_active)).map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
              <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} />
            </span>
          </label>
          {/* Landed-cost allocation (0191) — choose how a SERVICE-line freight
              charge is spread across goods lines into the FIFO lot cost. Changing
              it re-allocates + re-costs the lot on Save. */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Charge allocation</span>
            <span className={styles.selectWrap}>
              <select className={styles.fieldSelect} value={draft.allocationMethod} disabled={locked}
                onChange={(e) => onField('allocationMethod', e.target.value)}>
                <option value="QTY">By quantity (default)</option>
                <option value="VALUE">By value</option>
                <option value="CBM">By volume (CBM)</option>
              </select>
              <ChevronDown size={14} strokeWidth={1.75} className={styles.selectChevron} />
            </span>
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Notes</span>
            <input className={styles.fieldInput} value={draft.notes} disabled={locked}
              onChange={(e) => onField('notes', e.target.value)} />
          </label>
        </div>
        )}

        {/* Supplier-info auto-fill card. Read-only display from /suppliers/:id. */}
        {supplier && (
          <div
            style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              background: 'var(--c-cream)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 'var(--space-3) var(--space-4)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-13)',
            }}
          >
            <InfoCell label="Supplier code" value={supplier.code} />
            <InfoCell label="Contact"       value={supplier.contact_person ?? supplier.attention} />
            <InfoCell label="Phone"         value={supplier.phone ?? supplier.mobile} />
            <InfoCell label="Payment terms" value={supplier.payment_terms} />
            <InfoCell label="Email"         value={supplier.email} />
            <InfoCell label="TIN"           value={supplier.tin_number} />
            <InfoCell label="Country / state" value={[supplier.country, supplier.state].filter(Boolean).join(' / ') || null} />
            <InfoCell label="Bindings count" value={String(supplierDetail.data?.bindings?.length ?? 0)} />
            <div style={{ gridColumn: '1 / -1', color: 'var(--fg-muted)' }}>
              <span style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Address ·
              </span>{' '}
              {[supplier.address, supplier.area, supplier.postcode].filter(Boolean).join(', ') || '—'}
            </div>
          </div>
        )}
      </div>
    </section>
  );
};

/* Read-only label/value cell for the supplier auto-fill card. */
function InfoCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div style={{
        fontSize: "var(--fs-11)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        color: "var(--fg-muted)",
        marginBottom: 2,
      }}>{label}</div>
      <div style={{ color: value ? "var(--fg)" : "var(--fg-muted)" }}>{value || "—"}</div>
    </div>
  );
}
