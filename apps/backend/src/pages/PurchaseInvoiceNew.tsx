// ----------------------------------------------------------------------------
// PurchaseInvoiceNew — full-page Create Purchase Invoice at
// /purchase-invoices/new (PR — Phase 3 of Purchasing rebuild,
// Commander 2026-05-26).
//
// Workflow: from a posted GRN detail page, commander clicks "Generate
// Invoice" and lands here with ?grnId={uuid} pre-loaded. The page shows
// the GRN header (supplier + dates as read-only context) and the GRN
// accepted items as PI lines. Commander enters the supplier's invoice
// reference + due date, hits Save.
//
// PR-DRAFT-removal (2026-05-27, migration 0078): POST /purchase-invoices
// now creates the PI as POSTED directly. PI does NOT touch inventory
// (already done at GRN time per AutoCount standard) — it just establishes
// the AP liability for paying the supplier.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Save, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared';
import {
  useCreatePurchaseInvoice,
  usePostPurchaseInvoice,
  useGrnDetail,
} from '../lib/flow-queries';
import { MoneyInput } from '../components/MoneyInput';
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
  /* Commander 2026-05-29 — PI lines must show the same content as PO/GRN
     ("PO 有什么内容，Purchase Invoice 也应该随之对应"). Carry the GRN line's
     category + variant selections so buildVariantSummary can render the same
     muted sub-line GrnNew shows. */
  itemGroup:      string | null;
  variants:       Record<string, unknown> | null;
  qty:            number;
  unitPriceCenti: number;
  notes:          string;
};

export const PurchaseInvoiceNew = () => {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const grnId    = params.get('grnId');
  const grnQ     = useGrnDetail(grnId);

  const create = useCreatePurchaseInvoice();
  const post   = usePostPurchaseInvoice();
  const saving = create.isPending || post.isPending;

  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate]         = useState<string>('');
  const [notes, setNotes]             = useState<string>('');
  const [lines, setLines]             = useState<DraftLine[]>([]);

  useEffect(() => {
    if (!grnQ.data) return;
    const next: DraftLine[] = (grnQ.data.items ?? [])
      .filter((it: any) => (it.qty_accepted ?? 0) > 0)
      .map((it: any) => ({
        rid:            `r${it.id}`,
        grnItemId:      it.id,
        materialKind:   it.material_kind,
        materialCode:   it.material_code,
        materialName:   it.material_name,
        // Carried from the GRN line (grns.ts ITEM select now returns these) so
        // the PI shows the same variant summary as the GRN it descends from.
        itemGroup:      it.item_group ?? null,
        variants:       (it.variants as Record<string, unknown> | null) ?? null,
        qty:            it.qty_accepted,
        unitPriceCenti: it.unit_price_centi ?? 0,
        notes:          '',
      }));
    setLines(next);
  }, [grnQ.data]);

  const setLine  = (rid: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const dropLine = (rid: string) => setLines((prev) => prev.filter((l) => l.rid !== rid));

  const subtotalCenti = useMemo(
    () => lines.reduce((s, l) => s + l.qty * l.unitPriceCenti, 0),
    [lines],
  );

  // flow-queries.ts types this as `any`; narrow locally to the fields we
  // actually touch here. Keeps the rest of the page honest without forcing
  // a global refactor of the shared queries file.
  type GrnDetail = {
    id: string;
    grn_number: string;
    supplier_id: string;
    purchase_order_id: string | null;
    supplier?: { id?: string; name?: string; code?: string } | null;
    purchase_order?: { id?: string; po_number?: string } | null;
  };
  const grn      = grnQ.data?.grn as GrnDetail | undefined;
  const supplier = grn?.supplier;
  const po       = grn?.purchase_order;
  const currency = 'MYR';

  const canSave = !!grn && lines.length > 0 && lines.every((l) => l.qty > 0);

  const onSave = async () => {
    if (!grn) return;
    if (!canSave) { window.alert('Each line needs qty > 0.'); return; }
    try {
      const createRes = await create.mutateAsync({
        supplierId:          grn.supplier_id,
        purchaseOrderId:     grn.purchase_order_id,
        grnId:               grn.id,
        supplierInvoiceRef:  supplierInvoiceRef || undefined,
        invoiceDate,
        dueDate:             dueDate || undefined,
        notes:               notes || undefined,
        items: lines.map((l) => ({
          grnItemId:      l.grnItemId,
          materialKind:   l.materialKind,
          materialCode:   l.materialCode,
          materialName:   l.materialName,
          qty:            l.qty,
          unitPriceCenti: l.unitPriceCenti,
          notes:          l.notes || undefined,
        })),
      });
      // Auto-post so PI lands in POSTED state (matches PO + GRN behaviour).
      await post.mutateAsync(createRes.id);
      window.alert(`PI ${createRes.invoiceNumber} created + posted.`);
      navigate(`/purchase-invoices/${createRes.id}`);
    } catch (err) {
      window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  if (!grnId) {
    return (
      <div className={styles.page}>
        <div className={styles.headerRow}>
          <div className={styles.titleBlock}>
            <Link to="/grns" className={styles.backBtn}>
              <ArrowLeft {...ICON} /> <span>Goods Receipts</span>
            </Link>
            <h1 className={styles.title}>New Purchase Invoice</h1>
          </div>
          <div className={styles.actions}>
            {/* PR — task #52: shortcut into the line-level multi-GRN picker. */}
            <Button variant="ghost" size="md" onClick={() => navigate('/purchase-invoices/from-grn')}>
              From GRN (multi)
            </Button>
          </div>
        </div>
        <section className={styles.card}>
          <div className={styles.cardBody}>
            <p>Open a GRN first, then click <strong>Generate Invoice</strong> from there.</p>
            <Button variant="primary" size="md" onClick={() => navigate('/grns')}>Go to Goods Receipts</Button>
          </div>
        </section>
      </div>
    );
  }

  const gridTemplate = 'minmax(180px, 1.4fr) minmax(220px, 2fr) 90px 120px 130px 32px';
  const cellPad = 'var(--space-2)';

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/grns" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Goods Receipts</span>
          </Link>
          <h1 className={styles.title}>New Purchase Invoice{grn?.grn_number ? ` · ${grn.grn_number}` : ''}</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate(grn ? `/grns/${grn.id}` : '/grns')}>
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
              <span className={styles.fieldLabel}>GRN #</span>
              <input type="text" readOnly value={grn?.grn_number ?? ''} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>PI #</span>
              <input type="text" readOnly value="(assigned on Save)" className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>PO #</span>
              <input type="text" readOnly value={po?.po_number ?? '—'} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier</span>
              <input type="text" readOnly value={supplier?.name ?? ''} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier Invoice # *</span>
              <input type="text" value={supplierInvoiceRef} onChange={(e) => setSupplierInvoiceRef(e.target.value)} placeholder="From the supplier's printed invoice" className={styles.fieldInput} required />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Invoice Date *</span>
              <input type="date" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} className={styles.fieldInput} required />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Due Date</span>
              <input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className={styles.fieldInput} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes for AP" className={styles.fieldInput} rows={2} style={{ resize: 'vertical', minHeight: 60 }} />
            </label>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Items</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {grnQ.isLoading
              ? 'Loading GRN items…'
              : lines.length === 0
                ? 'No accepted items on this GRN'
                : `${lines.length} line${lines.length === 1 ? '' : 's'} · subtotal ${fmtRm(subtotalCenti, currency)}`}
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
            <div style={{ textAlign: 'right' }}>Line Total</div>
            <div></div>
          </div>

          {lines.map((l) => {
            const lineTotal = l.qty * l.unitPriceCenti;
            // Commander 2026-05-29 — same muted variant sub-line GrnNew shows,
            // so the PI mirrors what the GRN (and PO upstream) describe.
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
                <input type="number" min={0} value={l.qty}
                  onChange={(e) => setLine(l.rid, { qty: Math.max(0, Number(e.target.value) || 0) })}
                  className={styles.fieldInput} style={{ textAlign: 'right', fontSize: 'var(--fs-13)' }} />
                <MoneyInput bare valueSen={l.unitPriceCenti}
                  onCommit={(sen) => setLine(l.rid, { unitPriceCenti: sen ?? 0 })}
                  inputClassName={styles.fieldInput} style={{ fontSize: 'var(--fs-13)' }} selectOnFocus />
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{fmtRm(lineTotal, currency)}</div>
                <button type="button" onClick={() => dropLine(l.rid)} title="Remove line"
                  style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--c-festive-b, #B8331F)', padding: 4 }}>
                  <Trash2 {...SM_ICON} />
                </button>
              </div>
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--line)', fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-20)', fontWeight: 800, color: 'var(--c-burnt)' }}>
            Total: {fmtRm(subtotalCenti, currency)}
          </div>
        </div>
      </section>
    </div>
  );
};
