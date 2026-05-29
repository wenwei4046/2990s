// ----------------------------------------------------------------------------
// GrnNew — full-page Create Goods Receipt at /grns/new.
//
// Commander 2026-05-29: New GRN must work like New PO — land straight on a
// fillable FORM (header + line items) you can complete directly, NOT a
// separate "pick a PO" gate page. The Purchase Order picker now lives INLINE
// in the form header: choose a PO → its outstanding lines load into the items
// grid → adjust qty received/accepted/rejected → Receive & Post. Arriving with
// ?poId= (from a PO detail "Receive Goods") pre-selects it. The multi-PO /
// MRP-style bulk picker stays one click away via "From PO (multi)".
//
// POST /grns creates the row POSTED directly (rolls received_qty onto the PO +
// writes inventory_movements inline).
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Save, Trash2, X, Layers } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared';
import { useCreateGrn, usePostGrn } from '../lib/flow-queries';
import { usePurchaseOrderDetail, usePurchaseOrders } from '../lib/suppliers-queries';
import { ActionResultDialog } from '../components/ActionResultDialog';
import { MoneyInput } from '../components/MoneyInput';
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
  outstanding:       number;
  qtyReceived:       number;
  qtyAccepted:       number;
  qtyRejected:       number;
  unitPriceCenti:    number;
  notes:             string;
};

export const GrnNew = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();

  // Inline PO picker drives the form (Commander 2026-05-29 — form-first).
  const [selPoId, setSelPoId] = useState<string>(params.get('poId') ?? '');
  const poListQ = usePurchaseOrders();
  const poQ     = usePurchaseOrderDetail(selPoId || null);

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

  // Load lines from the selected PO (only outstanding qty > 0).
  useEffect(() => {
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
      .filter((l) => l.outstanding > 0);
    setLines(next);
  }, [poQ.data, selPoId]);

  const setLine  = (rid: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const dropLine = (rid: string) => setLines((prev) => prev.filter((l) => l.rid !== rid));

  const subtotalCenti = useMemo(
    () => lines.reduce((s, l) => s + l.qtyAccepted * l.unitPriceCenti, 0),
    [lines],
  );

  const po       = poQ.data?.purchaseOrder;
  const supplier = po?.supplier;
  const currency = po?.currency ?? 'MYR';

  const canSave = !!po && lines.length > 0 &&
    lines.every((l) => l.qtyReceived >= 0 && l.qtyAccepted + l.qtyRejected <= l.qtyReceived);

  const onSave = async () => {
    if (!po) { setDialog({ title: 'Pick a Purchase Order', body: 'Choose the PO you are receiving against first.' }); return; }
    if (!canSave) {
      setDialog({ title: 'Check the quantities', body: 'Each line: qty accepted + qty rejected must be ≤ qty received.' });
      return;
    }
    try {
      const createRes = await create.mutateAsync({
        purchaseOrderId: po.id,
        supplierId:      po.supplier_id,
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
          {/* Bulk / MRP-style multi-PO picker (different flow). */}
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
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Receive against PO *</span>
              <select
                value={selPoId}
                onChange={(e) => setSelPoId(e.target.value)}
                className={styles.fieldInput}
                disabled={poListQ.isLoading || outstanding.length === 0}
              >
                <option value="">
                  {poListQ.isLoading ? 'Loading POs…'
                    : outstanding.length === 0 ? 'No outstanding POs'
                    : '— Pick an outstanding PO —'}
                </option>
                {outstanding.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.po_number} · {p.supplier?.name ?? p.supplier?.code ?? '—'} · {p.po_date}
                    {p.status === 'PARTIALLY_RECEIVED' ? ' (partial)' : ''}
                  </option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>GRN #</span>
              <input type="text" readOnly value="(assigned on Save)" className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier</span>
              <input type="text" readOnly value={supplier?.name ?? '(auto-filled from PO)'} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
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
            {!selPoId
              ? 'Pick a PO above to load its outstanding lines'
              : poQ.isLoading
                ? 'Loading PO items…'
                : lines.length === 0
                  ? 'No outstanding lines on this PO (all qty already received)'
                  : `${lines.length} line${lines.length === 1 ? '' : 's'} · subtotal ${fmtRm(subtotalCenti, currency)}`}
          </span>
        </div>
        <div className={styles.cardBody}>
          {!selPoId ? (
            <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)', padding: 'var(--space-3) 0' }}>
              Choose a Purchase Order in the header to receive against it. Receiving lines from several POs at once?
              Use <button type="button" onClick={() => navigate('/grns/from-po')} style={{ background: 'none', border: 'none', color: 'var(--c-orange)', cursor: 'pointer', padding: 0, font: 'inherit' }}>From PO (multi)</button>.
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
                    <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>{l.outstanding}</div>
                    <input type="number" min={0} max={l.outstanding} value={l.qtyReceived}
                      onChange={(e) => {
                        const v = Math.max(0, Math.min(l.outstanding, Number(e.target.value) || 0));
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
                    {/* Editable unit price — carried from the PO, adjustable at
                        receiving time (Commander 2026-05-29: "Edit 价钱的功能"). */}
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
