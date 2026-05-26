// ----------------------------------------------------------------------------
// PurchaseReturnNew — full-page Create Purchase Return at
// /purchase-returns/new (PR — Phase 4 of Purchasing rebuild,
// Commander 2026-05-26).
//
// Two entry modes via URL params:
//   ?grnId={uuid}  — pre-fill lines from a posted GRN (defect / reject /
//                    over-supply). Each line carries grn_item_id so the
//                    server can validate qty <= qty_accepted - already
//                    returned (future check).
//   ?poId={uuid}   — pre-fill supplier + lines from the PO header. No
//                    grn_item_id linkage; commander enters qty manually.
//   (neither)      — free-form. Pick supplier from a dropdown, type lines.
//
// Save flow: POST /purchase-returns → PATCH /:id/post in sequence.
// /post writes inventory OUT (stock leaves the warehouse) and stamps
// posted_at. Subsequent /complete adds the supplier's credit note ref.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useCreatePurchaseReturn,
  usePostPurchaseReturn,
  useGrnDetail,
} from '../lib/flow-queries';
import { usePurchaseOrderDetail, useSuppliers } from '../lib/suppliers-queries';
import styles from './SalesOrderDetail.module.css';

const ICON    = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

type DraftLine = {
  rid:            string;
  grnItemId:      string | null;
  materialKind:   string;
  materialCode:   string;
  materialName:   string;
  qtyReturned:    number;
  unitPriceCenti: number;
  reason:         string;
  notes:          string;
};

const newLine = (): DraftLine => ({
  rid:            `l${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  grnItemId:      null,
  materialKind:   'mfg_product',
  materialCode:   '',
  materialName:   '',
  qtyReturned:    1,
  unitPriceCenti: 0,
  reason:         '',
  notes:          '',
});

export const PurchaseReturnNew = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const grnId    = params.get('grnId');
  const poId     = params.get('poId');

  const grnQ       = useGrnDetail(grnId);
  const poQ        = usePurchaseOrderDetail(poId);
  const suppliersQ = useSuppliers({ status: 'ACTIVE' });

  const create = useCreatePurchaseReturn();
  const post   = usePostPurchaseReturn();
  const saving = create.isPending || post.isPending;

  const [supplierId, setSupplierId]   = useState<string>('');
  const [returnDate, setReturnDate]   = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [reason, setReason]           = useState<string>('');
  const [notes, setNotes]             = useState<string>('');
  const [lines, setLines]             = useState<DraftLine[]>([newLine()]);

  // Pre-fill lines + supplier from GRN.
  useEffect(() => {
    if (!grnQ.data) return;
    const grn = grnQ.data.grn as any;
    setSupplierId(grn.supplier_id ?? '');
    const items: DraftLine[] = (grnQ.data.items ?? [])
      .filter((it: any) => (it.qty_accepted ?? 0) > 0)
      .map((it: any) => ({
        rid:            `r${it.id}`,
        grnItemId:      it.id,
        materialKind:   it.material_kind,
        materialCode:   it.material_code,
        materialName:   it.material_name,
        qtyReturned:    it.qty_rejected ?? 0,        // pre-fill with rejected qty if any
        unitPriceCenti: it.unit_price_centi ?? 0,
        reason:         it.rejection_reason ?? '',
        notes:          '',
      }));
    if (items.length > 0) setLines(items);
  }, [grnQ.data]);

  // Pre-fill lines + supplier from PO (no grnItemId linkage).
  useEffect(() => {
    if (!poQ.data) return;
    const po = poQ.data.purchaseOrder as any;
    setSupplierId(po.supplier_id ?? '');
    const items: DraftLine[] = (poQ.data.items ?? []).map((it: any) => ({
      rid:            `r${it.id}`,
      grnItemId:      null,
      materialKind:   it.material_kind,
      materialCode:   it.material_code,
      materialName:   it.material_name,
      qtyReturned:    0,                              // commander enters
      unitPriceCenti: it.unit_price_centi ?? 0,
      reason:         '',
      notes:          '',
    }));
    if (items.length > 0) setLines(items);
  }, [poQ.data]);

  const setLine  = (rid: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const dropLine = (rid: string) => setLines((prev) =>
    prev.length === 1 ? [newLine()] : prev.filter((l) => l.rid !== rid),
  );
  const addLine  = () => setLines((prev) => [...prev, newLine()]);

  const subtotalCenti = useMemo(
    () => lines.filter((l) => l.qtyReturned > 0).reduce((s, l) => s + l.qtyReturned * l.unitPriceCenti, 0),
    [lines],
  );

  const grn = grnQ.data?.grn as any;
  const po  = poQ.data?.purchaseOrder as any;
  const supplierName = useMemo(() => {
    if (grn?.supplier?.name) return grn.supplier.name;
    if (po?.supplier?.name)  return po.supplier.name;
    const s = (suppliersQ.data ?? []).find((sp) => sp.id === supplierId);
    return s ? `${s.code} · ${s.name}` : '';
  }, [grn, po, suppliersQ.data, supplierId]);

  const validLines = lines.filter((l) => l.materialCode && l.qtyReturned > 0);
  const canSave = supplierId && validLines.length > 0;

  const onSave = async () => {
    if (!canSave) { window.alert('Need supplier + at least one line with qty > 0.'); return; }
    try {
      const createRes = await create.mutateAsync({
        supplierId,
        purchaseOrderId: poId ?? (grn?.purchase_order_id ?? null),
        grnId,
        returnDate,
        reason: reason || undefined,
        notes: notes || undefined,
        items: validLines.map((l) => ({
          grnItemId:      l.grnItemId,
          materialKind:   l.materialKind,
          materialCode:   l.materialCode,
          materialName:   l.materialName,
          qtyReturned:    l.qtyReturned,
          unitPriceCenti: l.unitPriceCenti,
          lineRefundCenti: l.qtyReturned * l.unitPriceCenti,
          reason:         l.reason || undefined,
          notes:          l.notes || undefined,
        })),
      });
      await post.mutateAsync(createRes.id);
      window.alert(`Purchase Return ${createRes.returnNumber} created + posted. Stock OUT recorded.`);
      navigate(`/purchase-returns/${createRes.id}`);
    } catch (err) {
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const sourceTitle =
    grn ? `from GRN ${grn.grn_number}` :
    po  ? `from PO ${po.po_number}` :
    '(free-form)';

  const gridTemplate = 'minmax(140px, 1fr) minmax(200px, 1.8fr) 80px 110px 130px minmax(160px, 1.2fr) 32px';
  const cellPad = 'var(--space-2)';

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-returns" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Purchase Returns</span>
          </Link>
          <h1 className={styles.title}>New Purchase Return {sourceTitle}</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase-returns')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button variant="primary" size="md" onClick={onSave} disabled={saving || !canSave}>
            <Save {...ICON} />
            {saving ? 'Posting…' : 'Save & Post'}
          </Button>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}><h2 className={styles.cardTitle}>Header</h2></div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier *</span>
              {grn || po ? (
                <input type="text" readOnly value={supplierName} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
              ) : (
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={styles.fieldInput} required>
                  <option value="">— Pick a supplier —</option>
                  {(suppliersQ.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                  ))}
                </select>
              )}
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Return Date *</span>
              <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} className={styles.fieldInput} required />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Source GRN #</span>
              <input type="text" readOnly value={grn?.grn_number ?? '—'} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Source PO #</span>
              <input type="text" readOnly value={po?.po_number ?? (grn?.purchase_order?.po_number ?? '—')} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Reason</span>
              <input type="text" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. defective, wrong colour, over-supply" className={styles.fieldInput} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" className={styles.fieldInput} rows={2} style={{ resize: 'vertical', minHeight: 60 }} />
            </label>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Items to Return</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {validLines.length} line{validLines.length === 1 ? '' : 's'} · refund {fmtRm(subtotalCenti)}
          </span>
        </div>
        <div className={styles.cardBody}>
          <div style={{
            display: 'grid', gridTemplateColumns: gridTemplate, gap: 'var(--space-2)',
            padding: cellPad, fontFamily: 'var(--font-button)', fontSize: 'var(--fs-11)',
            fontWeight: 600, letterSpacing: '0.10em', textTransform: 'uppercase',
            color: 'var(--fg-soft)', borderBottom: '1px solid var(--line)',
          }}>
            <div>Item Code</div>
            <div>Description</div>
            <div style={{ textAlign: 'right' }}>Qty</div>
            <div style={{ textAlign: 'right' }}>Unit Price</div>
            <div style={{ textAlign: 'right' }}>Line Refund</div>
            <div>Reason</div>
            <div></div>
          </div>

          {lines.map((l) => {
            const lineRefund = l.qtyReturned * l.unitPriceCenti;
            return (
              <div key={l.rid} style={{
                display: 'grid', gridTemplateColumns: gridTemplate, gap: 'var(--space-2)',
                padding: cellPad, alignItems: 'center', borderBottom: '1px solid var(--line)',
              }}>
                <input type="text" value={l.materialCode}
                  onChange={(e) => setLine(l.rid, { materialCode: e.target.value })}
                  placeholder="Item code"
                  className={styles.fieldInput} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}
                  readOnly={!!l.grnItemId} />
                <input type="text" value={l.materialName}
                  onChange={(e) => setLine(l.rid, { materialName: e.target.value })}
                  placeholder="Description"
                  className={styles.fieldInput} style={{ fontSize: 'var(--fs-13)' }}
                  readOnly={!!l.grnItemId} />
                <input type="number" min={0} value={l.qtyReturned}
                  onChange={(e) => setLine(l.rid, { qtyReturned: Math.max(0, Number(e.target.value) || 0) })}
                  className={styles.fieldInput} style={{ textAlign: 'right', fontSize: 'var(--fs-13)' }} />
                <input type="number" min={0} step="0.01" value={(l.unitPriceCenti / 100).toFixed(2)}
                  onChange={(e) => setLine(l.rid, { unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0 })}
                  className={styles.fieldInput} style={{ textAlign: 'right', fontSize: 'var(--fs-13)' }} />
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{fmtRm(lineRefund)}</div>
                <input type="text" value={l.reason}
                  onChange={(e) => setLine(l.rid, { reason: e.target.value })}
                  placeholder="Optional"
                  className={styles.fieldInput} style={{ fontSize: 'var(--fs-13)' }} />
                <button type="button" onClick={() => dropLine(l.rid)} title="Remove line"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--c-festive-b, #B8331F)', padding: 4 }}>
                  <Trash2 {...SM_ICON} />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addLine}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              marginTop: 'var(--space-3)', padding: '8px 12px',
              background: 'transparent', border: '1px dashed var(--c-orange)',
              borderRadius: 'var(--radius-md)', color: 'var(--c-orange)',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)', fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus {...ICON} /> Add line
          </button>

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--line)', fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-20)', fontWeight: 800, color: 'var(--c-burnt)' }}>
            Refund Total: {fmtRm(subtotalCenti)}
          </div>
        </div>
      </section>
    </div>
  );
};
