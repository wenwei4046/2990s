// ----------------------------------------------------------------------------
// GrnNew — full-page Create Goods Receipt at /grns/new (PR — Phase 2 of
// Purchasing rebuild, Commander 2026-05-26).
//
// Workflow: from a PO detail page, commander clicks "Receive Goods" and
// lands here with ?poId={uuid} pre-loaded. The page shows the PO header
// (supplier + dates as read-only context) and the PO line items with each
// row's outstanding qty pre-filled in the Qty Received column. Commander
// adjusts qty / rejects, hits Save. We:
//
//   1. POST /grns        → creates DRAFT GRN + items
//   2. PATCH /grns/:id/post  → flips to POSTED, rolls up received_qty on
//                              the PO items, writes inventory_movements
//                              (IN movement, FIFO lot creation).
//
// Two calls in one button so commander never sees DRAFT — saves directly
// to the inventory-affecting POSTED state per AutoCount default behaviour.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Save, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useCreateGrn, usePostGrn } from '../lib/flow-queries';
import { usePurchaseOrderDetail } from '../lib/suppliers-queries';
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
  const poId = params.get('poId');
  const poQ  = usePurchaseOrderDetail(poId);

  const create = useCreateGrn();
  const post   = usePostGrn();
  const saving = create.isPending || post.isPending;

  const [receivedAt, setReceivedAt]         = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [deliveryNoteRef, setDeliveryNoteRef] = useState<string>('');
  const [notes, setNotes]                   = useState<string>('');
  const [lines, setLines]                   = useState<DraftLine[]>([]);

  // Pre-fill lines from PO (only those with outstanding qty > 0).
  useEffect(() => {
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
  }, [poQ.data]);

  const setLine  = (rid: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const dropLine = (rid: string) => setLines((prev) => prev.filter((l) => l.rid !== rid));

  const subtotalCenti = useMemo(
    () => lines.reduce((s, l) => s + l.qtyAccepted * l.unitPriceCenti, 0),
    [lines],
  );

  const po       = poQ.data?.purchaseOrder;
  const supplier = (po as any)?.supplier;
  const currency = (po as any)?.currency ?? 'MYR';

  const canSave = !!po && lines.length > 0 && lines.every((l) => l.qtyReceived >= 0 && l.qtyAccepted + l.qtyRejected <= l.qtyReceived);

  const onSave = async () => {
    if (!po) return;
    if (!canSave) {
      window.alert('Each line: qty accepted + qty rejected must be ≤ qty received.');
      return;
    }
    try {
      const createRes = await create.mutateAsync({
        purchaseOrderId: po.id,
        supplierId:      (po as any).supplier_id,
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
      // Auto-post so inventory + PO received_qty update immediately.
      await post.mutateAsync(createRes.id);
      window.alert(`GRN ${createRes.grnNumber} created + posted. Inventory updated.`);
      navigate(`/grns/${createRes.id}`);
    } catch (err) {
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!poId) {
    return (
      <div className={styles.page}>
        <div className={styles.headerRow}>
          <div className={styles.titleBlock}>
            <Link to="/purchase-orders" className={styles.backBtn}>
              <ArrowLeft {...ICON} /> <span>Purchase Orders</span>
            </Link>
            <h1 className={styles.title}>New Goods Receipt</h1>
          </div>
        </div>
        <section className={styles.card}>
          <div className={styles.cardBody}>
            <p>Open a Purchase Order first, then click <strong>Receive Goods</strong> from there.</p>
            <Button variant="primary" size="md" onClick={() => navigate('/purchase-orders')}>
              Go to Purchase Orders
            </Button>
          </div>
        </section>
      </div>
    );
  }

  const gridTemplate = 'minmax(180px, 1.4fr) minmax(200px, 1.8fr) 80px 80px 80px 110px 110px 32px';
  const cellPad = 'var(--space-2)';

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Purchase Orders</span>
          </Link>
          <h1 className={styles.title}>Receive Goods{po?.po_number ? ` · ${po.po_number}` : ''}</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate(po ? `/purchase-orders/${po.id}` : '/purchase-orders')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button variant="primary" size="md" onClick={onSave} disabled={saving || !canSave}>
            <Save {...ICON} />
            {saving ? 'Receiving…' : 'Receive & Post'}
          </Button>
        </div>
      </div>

      {/* Header card */}
      <section className={styles.card}>
        <div className={styles.cardHeader}><h2 className={styles.cardTitle}>Header</h2></div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>PO #</span>
              <input type="text" readOnly value={po?.po_number ?? ''} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>GRN #</span>
              <input type="text" readOnly value="(assigned on Save)" className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier</span>
              <input type="text" readOnly value={supplier?.name ?? ''} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
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
            {poQ.isLoading
              ? 'Loading PO items…'
              : lines.length === 0
                ? 'No outstanding lines on this PO (all qty already received)'
                : `${lines.length} line${lines.length === 1 ? '' : 's'} · subtotal ${fmtRm(subtotalCenti, currency)}`}
          </span>
        </div>
        <div className={styles.cardBody}>
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
            <div style={{ textAlign: 'right' }}>Line Value</div>
            <div></div>
          </div>

          {/* Rows */}
          {lines.map((l) => {
            const lineValueCenti = l.qtyAccepted * l.unitPriceCenti;
            return (
              <div key={l.rid} style={{
                display: 'grid', gridTemplateColumns: gridTemplate, gap: 'var(--space-2)',
                padding: cellPad, alignItems: 'center', borderBottom: '1px solid var(--line)',
              }}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{l.materialCode}</div>
                <div style={{ fontSize: 'var(--fs-13)' }}>{l.materialName}</div>
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
        </div>
      </section>
    </div>
  );
};
