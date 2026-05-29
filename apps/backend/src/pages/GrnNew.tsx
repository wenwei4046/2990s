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
import { ArrowLeft, Save, Trash2, X, Layers } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared';
import { useCreateGrn, usePostGrn } from '../lib/flow-queries';
import { usePurchaseOrderDetail, usePurchaseOrders, useSuppliers } from '../lib/suppliers-queries';
import { useMfgProducts } from '../lib/mfg-products-queries';
import { ActionResultDialog } from '../components/ActionResultDialog';
import { MoneyInput } from '../components/MoneyInput';
import type { GrnFromPoPick } from './GrnFromPo';
import styles from './SalesOrderDetail.module.css';

const ICON    = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

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
    if (!selPoId) { setLines([]); return; }
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

  // ── Manual product search (gated by min query length, mirrors PO form). ──
  const [productQuery, setProductQuery] = useState<string>('');
  const productsQ = useMfgProducts({
    search: productQuery,
    enabled: isManual && productQuery.trim().length >= 2,
  });

  const addManualLine = (code: string, name: string, category: string | null) => {
    setLines((prev) => [...prev, {
      rid:                 `m${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      purchaseOrderItemId: null,
      materialKind:        'mfg_product',
      materialCode:        code,
      materialName:        name,
      itemGroup:           category ? category.toLowerCase() : null,
      variants:            null,
      outstanding:         null,
      qtyReceived:         1,
      qtyAccepted:         1,
      qtyRejected:         0,
      unitPriceCenti:      0,
      notes:               '',
    }]);
    setProductQuery('');
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
    if (lines.length === 0) {
      setDialog({ title: 'Add at least one line', body: 'A GRN needs at least one received item.' });
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
        receivedAt,
        deliveryNoteRef: deliveryNoteRef || undefined,
        notes:           notes || undefined,
        items: lines.map((l) => ({
          purchaseOrderItemId: l.purchaseOrderItemId,
          materialKind:        l.materialKind,
          materialCode:        l.materialCode,
          materialName:        l.materialName,
          qtyReceived:         l.qtyReceived,
          qtyAccepted:         l.qtyAccepted,
          qtyRejected:         l.qtyRejected,
          unitPriceCenti:      l.unitPriceCenti,
          notes:               l.notes || undefined,
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

  const gridTemplate = 'minmax(170px, 1.3fr) minmax(220px, 1.8fr) 70px 70px 70px 70px 120px 120px 32px';
  const cellPad = 'var(--space-2)';

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
          </span>
        </div>
        <div className={styles.cardBody}>
          {/* Manual item search — only in blank/manual mode. */}
          {isManual && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label className={styles.field} style={{ maxWidth: 480 }}>
                <span className={styles.fieldLabel}>Add item</span>
                <input
                  type="text"
                  list="grn-manual-products"
                  value={productQuery}
                  onChange={(e) => {
                    const v = e.target.value;
                    setProductQuery(v);
                    // If the typed value exactly matches a product code, add it.
                    const match = (productsQ.data ?? []).find((p) => p.code === v);
                    if (match) addManualLine(match.code, match.name, match.category);
                  }}
                  placeholder="Type ≥2 chars to search SKUs by code or name…"
                  className={styles.fieldInput}
                />
                <datalist id="grn-manual-products">
                  {(productsQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.code}>{p.name} · {p.category}</option>
                  ))}
                </datalist>
                <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                  Pick a SKU to append a line. Qty, price + accepted/rejected are editable below.
                </span>
              </label>
            </div>
          )}

          {lines.length === 0 ? (
            <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)', padding: 'var(--space-3) 0' }}>
              {isManual
                ? 'Pick a supplier in the header, then search for items to add above. Receiving against a PO? Pick one in the header, or use '
                : 'Choose a Purchase Order in the header to receive against it. Receiving lines from several POs at once? Use '}
              <button type="button" onClick={() => navigate('/grns/from-po')} style={{ background: 'none', border: 'none', color: 'var(--c-orange)', cursor: 'pointer', padding: 0, font: 'inherit' }}>From PO (multi)</button>.
            </p>
          ) : (
            <>
              {/* Header */}
              <div style={{
                display: 'grid', gridTemplateColumns: gridTemplate, gap: 'var(--space-2)',
                padding: cellPad, fontFamily: 'var(--font-button)', fontSize: 'var(--fs-11)',
                fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase',
                color: 'var(--fg-soft)', borderBottom: '1px solid var(--line)',
              }}>
                <div>Item Code</div>
                <div>Description</div>
                <div style={{ textAlign: 'right' }}>Outstanding</div>
                <div style={{ textAlign: 'right' }}>Received</div>
                <div style={{ textAlign: 'right' }}>Accepted</div>
                <div style={{ textAlign: 'right' }}>Rejected</div>
                <div style={{ textAlign: 'right' }}>Unit Price</div>
                <div style={{ textAlign: 'right' }}>Line Value</div>
                <div></div>
              </div>

              {/* Rows */}
              {lines.map((l) => {
                const lineValueCenti = l.qtyAccepted * l.unitPriceCenti;
                const variantSummary = buildVariantSummary(l.itemGroup, l.variants);
                // Manual lines have no outstanding cap — qty inputs go uncapped.
                const cap = l.outstanding;
                return (
                  <div key={l.rid} style={{
                    display: 'grid', gridTemplateColumns: gridTemplate, gap: 'var(--space-2)',
                    padding: cellPad, alignItems: 'center', borderBottom: '1px solid var(--line)',
                  }}>
                    <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{l.materialCode}</div>
                    <div style={{ fontSize: 'var(--fs-13)' }}>
                      <div>{l.materialName}</div>
                      {variantSummary && (
                        <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>{variantSummary}</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>{cap ?? '—'}</div>
                    <input type="number" min={0} max={cap ?? undefined} value={l.qtyReceived}
                      onChange={(e) => {
                        let v = Math.max(0, Number(e.target.value) || 0);
                        if (cap != null) v = Math.min(cap, v);
                        setLine(l.rid, { qtyReceived: v, qtyAccepted: Math.min(l.qtyAccepted, v) });
                      }}
                      className={styles.fieldInput} style={{ textAlign: 'right', fontSize: 'var(--fs-13)' }} />
                    <input type="number" min={0} max={l.qtyReceived} value={l.qtyAccepted}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(l.qtyReceived, Number(e.target.value) || 0));
                        setLine(l.rid, { qtyAccepted: v, qtyRejected: l.qtyReceived - v });
                      }}
                      className={styles.fieldInput} style={{ textAlign: 'right', fontSize: 'var(--fs-13)' }} />
                    <input type="number" min={0} max={l.qtyReceived} value={l.qtyRejected}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(l.qtyReceived, Number(e.target.value) || 0));
                        setLine(l.rid, { qtyRejected: v, qtyAccepted: l.qtyReceived - v });
                      }}
                      className={styles.fieldInput} style={{ textAlign: 'right', fontSize: 'var(--fs-13)' }} />
                    {/* Editable unit price — carried from the PO / manual entry,
                        adjustable at receiving time (Commander 2026-05-29). */}
                    <MoneyInput bare valueSen={l.unitPriceCenti}
                      onCommit={(sen) => setLine(l.rid, { unitPriceCenti: sen ?? 0 })}
                      inputClassName={styles.fieldInput} style={{ fontSize: 'var(--fs-13)' }} selectOnFocus />
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{fmtRm(lineValueCenti, currency)}</div>
                    <button type="button" onClick={() => dropLine(l.rid)} title="Remove line"
                      style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--c-festive-b, #B8331F)', padding: 4 }}>
                      <Trash2 {...SM_ICON} />
                    </button>
                  </div>
                );
              })}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--line)', fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-20)', fontWeight: 800, color: 'var(--c-burnt)' }}>
                Subtotal: {fmtRm(subtotalCenti, currency)}
              </div>
            </>
          )}
        </div>
      </section>

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
