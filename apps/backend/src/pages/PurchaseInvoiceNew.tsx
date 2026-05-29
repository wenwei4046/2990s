// ----------------------------------------------------------------------------
// PurchaseInvoiceNew — full-page Create Purchase Invoice at
// /purchase-invoices/new (PR — Phase 3 of Purchasing rebuild,
// Commander 2026-05-26).
//
// Two ways in (Commander 2026-05-29 — PI must have its OWN create form like
// New PO / New GRN, not be forced through a GRN):
//
//   1. From a posted GRN detail page, commander clicks "Generate Invoice" and
//      lands here with ?grnId={uuid} pre-loaded. The page shows the GRN header
//      (supplier + dates as read-only context) and the GRN accepted items as
//      PI lines (editable price). This path is unchanged.
//   2. MANUAL — no grnId at all: pick a supplier, search products, add line
//      items by hand (mirrors GrnNew's manual mode, including the per-category
//      bedframe/sofa variant editor with auto-computed Total Height). Saves
//      with grnId:null + each line carrying its own item_group + variants.
//
// PR-DRAFT-removal (2026-05-27, migration 0078): POST /purchase-invoices
// now creates the PI as POSTED directly. PI does NOT touch inventory
// (already done at GRN time per AutoCount standard) — it just establishes
// the AP liability for paying the supplier.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { ArrowLeft, Save, Trash2, X, ChevronDown } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { buildVariantSummary } from '@2990s/shared';
import {
  useCreatePurchaseInvoice,
  usePostPurchaseInvoice,
  useGrnDetail,
} from '../lib/flow-queries';
import { useSuppliers } from '../lib/suppliers-queries';
import { useMfgProducts, useMaintenanceConfig } from '../lib/mfg-products-queries';
import { MoneyInput } from '../components/MoneyInput';
import { ActionResultDialog } from '../components/ActionResultDialog';
import styles from './SalesOrderDetail.module.css';

const ICON    = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

/* Commander 2026-05-29 — bedframe Total Height is AUTO-COMPUTED = Divan + Leg +
   Gap (mirrors GrnNew / SoLineCard); it is NOT a manual pick. */
const parseInches = (s: unknown): number => {
  if (s == null) return 0;
  const m = String(s).match(/(-?\d+(?:\.\d+)?)/);
  return m && m[1] ? Number(m[1]) : 0;
};

/* Commander 2026-05-29 — manual PI lines whose product is a bedframe/sofa get
   the SAME per-category variant editor as New GRN / New PO. Small local copy of
   GrnNew's VariantSelect (not exported there). */
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
  rid:            string;
  grnItemId:      string | null;
  materialKind:   string;
  materialCode:   string;
  materialName:   string;
  /* Commander 2026-05-29 — PI lines must show the same content as PO/GRN
     ("PO 有什么内容，Purchase Invoice 也应该随之对应"). GRN-sourced lines carry
     the GRN line's category + variants; manual lines pick them below. */
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

  // Manual mode = no ?grnId= in the URL (Commander 2026-05-29 — blank PI).
  const isManual = !grnId;

  const create = useCreatePurchaseInvoice();
  const post   = usePostPurchaseInvoice();
  const saving = create.isPending || post.isPending;

  // Manual-mode supplier (mirrors GrnNew).
  const [manualSupplierId, setManualSupplierId] = useState<string>('');
  const suppliersQ = useSuppliers({ status: 'ACTIVE' });

  // Maintenance config drives the per-category variant editor on MANUAL
  // bedframe/sofa lines (same dropdown pools as New GRN / New PO).
  const maintQ = useMaintenanceConfig('master');
  const maint  = maintQ.data?.data ?? null;

  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate]         = useState<string>('');
  const [notes, setNotes]             = useState<string>('');
  const [lines, setLines]             = useState<DraftLine[]>([]);
  const [dialog, setDialog] = useState<{ title: string; body: string; goTo?: string } | null>(null);

  // ── GRN-sourced lines (only when ?grnId= present). ──────────────────────
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
        // Carried from the GRN line (grns.ts ITEM select returns these) so the
        // PI shows the same variant summary as the GRN it descends from.
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

  // Effective supplier id + display name (from GRN, or the manual <select>).
  const supplierId   = isManual ? (manualSupplierId || null) : (grn?.supplier_id ?? null);
  const supplierName = isManual
    ? ((suppliersQ.data ?? []).find((s) => s.id === manualSupplierId)?.name ?? null)
    : (supplier?.name ?? null);

  // ── Manual product search (gated by min query length, mirrors GrnNew). ───
  const [productQuery, setProductQuery] = useState<string>('');
  const productsQ = useMfgProducts({
    search: productQuery,
    enabled: isManual && productQuery.trim().length >= 2,
  });

  const addManualLine = (code: string, name: string, category: string | null) => {
    setLines((prev) => [...prev, {
      rid:            `m${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      grnItemId:      null,
      materialKind:   'mfg_product',
      materialCode:   code,
      materialName:   name,
      itemGroup:      category ? category.toLowerCase() : null,
      variants:       null,
      qty:            1,
      unitPriceCenti: 0,
      notes:          '',
    }]);
    setProductQuery('');
  };

  const canSave = !!supplierId && lines.length > 0 && lines.every((l) => l.qty > 0);

  const onSave = async () => {
    if (!supplierId) {
      setDialog({ title: 'Pick a supplier', body: isManual
        ? 'Choose a supplier for this manual invoice.'
        : 'This GRN is missing a supplier — reopen it and try again.' });
      return;
    }
    if (lines.length === 0) {
      setDialog({ title: 'Add at least one line', body: 'A purchase invoice needs at least one item.' });
      return;
    }
    if (!canSave) { setDialog({ title: 'Check the quantities', body: 'Each line needs qty > 0.' }); return; }
    try {
      const createRes = await create.mutateAsync({
        // Manual: no GRN / PO behind it. GRN-sourced: carry both FKs through.
        supplierId,
        purchaseOrderId:    isManual ? null : (grn?.purchase_order_id ?? null),
        grnId:              isManual ? null : (grn?.id ?? null),
        supplierInvoiceRef: supplierInvoiceRef || undefined,
        invoiceDate,
        dueDate:            dueDate || undefined,
        notes:              notes || undefined,
        items: lines.map((l) => ({
          grnItemId:      l.grnItemId,
          materialKind:   l.materialKind,
          materialCode:   l.materialCode,
          materialName:   l.materialName,
          qty:            l.qty,
          unitPriceCenti: l.unitPriceCenti,
          notes:          l.notes || undefined,
          // Commander 2026-05-29 — persist the line's category + variant
          // selections (columns exist on purchase_invoice_items, migration 0057)
          // so the PI reflects WHAT was billed, same as the GRN/PO upstream.
          itemGroup:      l.itemGroup,
          variants:       l.variants,
        })),
      });
      // Auto-post so PI lands in POSTED state (matches PO + GRN behaviour).
      await post.mutateAsync(createRes.id);
      setDialog({
        title: `PI ${createRes.invoiceNumber} created`,
        body: 'Created + posted — AP liability recorded.',
        goTo: `/purchase-invoices/${createRes.id}`,
      });
    } catch (err) {
      setDialog({ title: 'Save failed', body: err instanceof Error ? err.message : String(err) });
    }
  };

  const gridTemplate = 'minmax(180px, 1.4fr) minmax(220px, 2fr) 90px 120px 130px 32px';
  const cellPad = 'var(--space-2)';

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-invoices" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Purchase Invoices</span>
          </Link>
          <h1 className={styles.title}>New Purchase Invoice{!isManual && grn?.grn_number ? ` · ${grn.grn_number}` : ''}</h1>
        </div>
        <div className={styles.actions}>
          {/* Keep the GRN→Invoice path: jump to the multi-GRN-line picker. */}
          {isManual && (
            <Button variant="ghost" size="md" onClick={() => navigate('/purchase-invoices/from-grn')}>
              From GRN (multi)
            </Button>
          )}
          <Button variant="ghost" size="md" onClick={() => navigate(isManual ? '/purchase-invoices' : (grn ? `/grns/${grn.id}` : '/grns'))}>
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
            {/* GRN # / PO # context only when sourced from a GRN. In manual mode
                we show the supplier picker in their place. */}
            {!isManual ? (
              <>
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
                  <input type="text" readOnly value={supplierName ?? ''} className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
                </label>
              </>
            ) : (
              <>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Supplier *</span>
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
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>PI #</span>
                  <input type="text" readOnly value="(assigned on Save)" className={styles.fieldInput} style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
                </label>
              </>
            )}

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
            {!isManual && grnQ.isLoading
              ? 'Loading GRN items…'
              : lines.length === 0
                ? (isManual ? 'Manual invoice — pick a supplier above, then add items below' : 'No accepted items on this GRN')
                : `${lines.length} line${lines.length === 1 ? '' : 's'} · subtotal ${fmtRm(subtotalCenti, currency)}`}
          </span>
        </div>
        <div className={styles.cardBody}>
          {/* Manual item search — only in manual mode. */}
          {isManual && (
            <div style={{ marginBottom: 'var(--space-3)' }}>
              <label className={styles.field} style={{ maxWidth: 480 }}>
                <span className={styles.fieldLabel}>Add item</span>
                <input
                  type="text"
                  list="pi-manual-products"
                  value={productQuery}
                  onChange={(e) => {
                    const v = e.target.value;
                    setProductQuery(v);
                    const match = (productsQ.data ?? []).find((p) => p.code === v);
                    if (match) addManualLine(match.code, match.name, match.category);
                  }}
                  placeholder="Type ≥2 chars to search SKUs by code or name…"
                  className={styles.fieldInput}
                />
                <datalist id="pi-manual-products">
                  {(productsQ.data ?? []).map((p) => (
                    <option key={p.id} value={p.code}>{p.name} · {p.category}</option>
                  ))}
                </datalist>
                <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                  Pick a SKU to append a line. Qty + price are editable below.
                </span>
              </label>
            </div>
          )}

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
            // Editable variant section only for MANUAL lines (grnItemId === null)
            // that are bedframe/sofa, once the maintenance pools are loaded.
            // GRN-sourced lines keep their read-only summary.
            const showVariantEditor =
              l.grnItemId === null &&
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
              <div key={l.rid}>
                <div style={{
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

                {/* Per-category VARIANT EDITOR for MANUAL bedframe/sofa lines —
                    Commander 2026-05-29: mirrors New GRN / New PO so the operator
                    specifies divan/leg/total height, gap, special, seat size +
                    fabric. Same variant keys the PO/SO/GRN store. */}
                {showVariantEditor && (
                  <div style={{
                    padding: `var(--space-2) ${cellPad} var(--space-3)`,
                    borderBottom: '1px solid var(--line)', background: 'var(--c-cream)',
                  }}>
                    <div style={{
                      fontFamily: 'var(--font-button)', fontSize: 'var(--fs-11)', fontWeight: 600,
                      letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-soft)',
                      marginBottom: 'var(--space-2)',
                    }}>Variants — {l.itemGroup}</div>
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
              </div>
            );
          })}

          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)', paddingTop: 'var(--space-3)', borderTop: '1px solid var(--line)', fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-20)', fontWeight: 800, color: 'var(--c-burnt)' }}>
            Total: {fmtRm(subtotalCenti, currency)}
          </div>
        </div>
      </section>

      {dialog && (
        <ActionResultDialog
          title={dialog.title}
          body={dialog.body}
          primaryLabel={dialog.goTo ? 'Open PI' : undefined}
          onPrimary={dialog.goTo ? () => { const g = dialog.goTo!; setDialog(null); navigate(g); } : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};
