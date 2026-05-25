// ----------------------------------------------------------------------------
// PurchaseOrderDetail — full-page route at /purchase-orders/:id (PR #41).
//
// Apply SO Detail template to PO so PO→GRN→PI conversions preserve all
// variant data (sofa color, bedframe D1/divan/leg/special).
//
//   1. Header: back button + PO# · supplier + status pill + actions
//   2. Supplier card: editable supplier picker + dates + currency + notes
//   3. Line items table: code + group + variants summary + qty + unit + total
//      + Edit/Delete. "+ Add Line Item" opens a modal with product picker +
//      per-category variant editor (sofa: seat height + leg + special;
//      bedframe: divan + gap + leg + specials).
//   4. Totals card: subtotal + total
//   5. Status flow: Draft → Submitted → Partially Received → Received | Cancelled
// ----------------------------------------------------------------------------

import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft, FileText, Pencil, Trash2, Plus, X, Printer, Save, Send, Ban,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  usePurchaseOrderDetail,
  useUpdatePurchaseOrderHeader,
  useAddPurchaseOrderItem,
  useUpdatePurchaseOrderItem,
  useDeletePurchaseOrderItem,
  useSubmitPurchaseOrder,
  useCancelPurchaseOrder,
  useSuppliers,
  type PoItemRow,
  type NewPoItem,
} from '../lib/suppliers-queries';
import { useMfgProducts, useMaintenanceConfig, type MfgProductRow } from '../lib/mfg-products-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

const STATUS_LIST = ['DRAFT', 'SUBMITTED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
type PoStatus = typeof STATUS_LIST[number];

const STATUS_CLASS: Record<PoStatus, string> = {
  DRAFT:              styles.statusDraft ?? '',
  SUBMITTED:          styles.statusConfirmed ?? '',
  PARTIALLY_RECEIVED: styles.statusInProd ?? '',
  RECEIVED:           styles.statusDelivered ?? '',
  CANCELLED:          styles.statusCancelled ?? '',
};

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

export const PurchaseOrderDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = usePurchaseOrderDetail(id ?? null);
  const updateHeader = useUpdatePurchaseOrderHeader();
  const submit = useSubmitPurchaseOrder();
  const cancel = useCancelPurchaseOrder();
  const addItem = useAddPurchaseOrderItem();
  const updateItem = useUpdatePurchaseOrderItem();
  const deleteItem = useDeletePurchaseOrderItem();
  const maint = useMaintenanceConfig('master');

  const po = detail.data?.purchaseOrder ?? null;
  const items = detail.data?.items ?? [];

  const [editing, setEditing] = useState<PoItemRow | null>(null);
  const [adding, setAdding] = useState(false);

  // PO is locked once submitted (or received / cancelled). DRAFT-only edits.
  const isLocked = po ? po.status !== 'DRAFT' : true;

  if (detail.isLoading) {
    return <div className={styles.page}><p className={styles.fieldLabel}>Loading…</p></div>;
  }
  if (detail.isError || !po) {
    return (
      <div className={styles.page}>
        <Link to="/purchase-orders" className={styles.backBtn}>
          <ArrowLeft {...ICON} />
          <span>Back</span>
        </Link>
        <div className={styles.bannerWarn}>
          <strong>Purchase order not found.</strong>
          {detail.error instanceof Error ? ` ${detail.error.message}` : null}
        </div>
      </div>
    );
  }

  const handlePrint = () => {
    import('../lib/purchase-order-pdf').then(({ generatePurchaseOrderPdf }) =>
      generatePurchaseOrderPdf(po, items),
    ).catch((e) => alert(`PDF generation failed: ${e instanceof Error ? e.message : String(e)}`));
  };

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </Link>
          <div>
            <h1 className={styles.title}>
              <FileText size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {po.po_number} — {po.supplier?.name ?? po.supplier?.code ?? '—'}
            </h1>
            <p className={styles.subtitle}>
              PO date {po.po_date} · {items.length} {items.length === 1 ? 'line' : 'lines'}
              {po.expected_at && ` · Expected ${po.expected_at}`}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.statusPill} ${STATUS_CLASS[po.status as PoStatus]}`}>
            {po.status.replace(/_/g, ' ')}
          </span>
          <Button variant="ghost" size="md" onClick={handlePrint}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
          {po.status === 'DRAFT' && (
            <Button variant="primary" size="md"
              onClick={() => submit.mutate(po.id)} disabled={submit.isPending}>
              <Send {...ICON} />
              <span>{submit.isPending ? 'Submitting…' : 'Submit'}</span>
            </Button>
          )}
          {po.status === 'DRAFT' && (
            <Button variant="ghost" size="md"
              onClick={() => { if (confirm(`Cancel PO ${po.po_number}?`)) cancel.mutate(po.id); }}>
              <Ban {...ICON} />
              <span>Cancel</span>
            </Button>
          )}
        </div>
      </div>

      {/* ── Supplier / dates / currency / notes ─────────────────── */}
      <SupplierCard
        po={po}
        onSave={(patch) => updateHeader.mutate({ id: po.id, ...patch })}
        saving={updateHeader.isPending}
        locked={isLocked}
      />

      {/* ── Line items ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({items.length})</h2>
          <Button variant="primary" size="sm" onClick={() => setAdding(true)} disabled={isLocked}>
            <Plus {...ICON} />
            <span>Add Line Item</span>
          </Button>
        </header>

        {items.length === 0 ? (
          <p className={styles.emptyRow}>No items yet — click "Add Line Item" to begin.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Group</th>
                <th className={styles.tableRight}>Qty</th>
                <th className={styles.tableRight}>Unit</th>
                <th className={styles.tableRight}>Disc</th>
                <th className={styles.tableRight}>Total</th>
                <th className={styles.tableRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div className={styles.codeCell}>{it.material_code}</div>
                    {(it.description || it.material_name) && <div className={styles.muted}>{it.description ?? it.material_name}</div>}
                    {it.supplier_sku && <div className={styles.muted} style={{ fontSize: 'var(--fs-11)' }}>Sup SKU: {it.supplier_sku}</div>}
                    <VariantsPills variants={it.variants ?? null} />
                  </td>
                  <td className={styles.muted}>{it.item_group ?? it.material_kind}</td>
                  <td className={styles.tableRight}>{it.qty}</td>
                  <td className={styles.tableRight}>{fmtRm(it.unit_price_centi, po.currency)}</td>
                  <td className={styles.tableRight}>{(it.discount_centi ?? 0) > 0 ? fmtRm(it.discount_centi, po.currency) : '—'}</td>
                  <td className={styles.priceCell}>{fmtRm(it.line_total_centi, po.currency)}</td>
                  <td>
                    <span className={styles.actionsCell}>
                      <button type="button" className={styles.iconBtn} title="Edit" disabled={isLocked}
                        onClick={() => !isLocked && setEditing(it)}>
                        <Pencil {...SM_ICON} />
                      </button>
                      <button type="button"
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        title="Delete" disabled={isLocked}
                        onClick={() => {
                          if (isLocked) return;
                          if (confirm(`Remove ${it.material_code} from this PO?`)) {
                            deleteItem.mutate({ poId: po.id, itemId: it.id });
                          }
                        }}>
                        <Trash2 {...SM_ICON} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Totals ──────────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Totals</h2>
        </header>
        <div className={styles.cardBody}>
          <div className={styles.totalsGrid}>
            <div className={styles.totalsRow}>
              <span className={styles.totalsLabel}>Subtotal</span>
              <span className={styles.totalsValue}>{fmtRm(po.subtotal_centi, po.currency)}</span>
            </div>
            <div className={styles.totalsRow}>
              <span className={styles.totalsLabel}>Tax</span>
              <span className={styles.totalsValue}>{fmtRm(po.tax_centi, po.currency)}</span>
            </div>
            <div className={`${styles.totalsRow} ${styles.totalsRowGrand}`}>
              <span className={styles.totalsLabel}>Total</span>
              <span className={styles.totalsValue}>{fmtRm(po.total_centi, po.currency)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Modals ─────────────────────────────────────────────── */}
      {(adding || editing) && (
        <PoLineItemModal
          editing={editing}
          maint={maint.data?.data ?? null}
          currency={po.currency}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={(payload) => {
            if (editing) {
              updateItem.mutate(
                { poId: po.id, itemId: editing.id, ...payload },
                { onSuccess: () => setEditing(null) },
              );
            } else {
              addItem.mutate(
                { poId: po.id, ...payload },
                { onSuccess: () => setAdding(false) },
              );
            }
          }}
          saving={addItem.isPending || updateItem.isPending}
        />
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Supplier / header card — editable
   ════════════════════════════════════════════════════════════════════════ */

const SupplierCard = ({
  po, onSave, saving, locked,
}: {
  po: any;
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
  locked: boolean;
}) => {
  const suppliersQ = useSuppliers();
  const suppliers = suppliersQ.data ?? [];
  const [form, setForm] = useState({
    supplierId: po.supplier_id ?? '',
    poDate: po.po_date ?? '',
    expectedAt: po.expected_at ?? '',
    currency: po.currency ?? 'MYR',
    notes: po.notes ?? '',
  });

  useEffect(() => {
    setForm({
      supplierId: po.supplier_id ?? '',
      poDate: po.po_date ?? '',
      expectedAt: po.expected_at ?? '',
      currency: po.currency ?? 'MYR',
      notes: po.notes ?? '',
    });
  }, [po]);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Supplier · Dates · Notes</h2>
        <Button variant="primary" size="sm"
          onClick={() => onSave(form)} disabled={saving || locked}>
          <Save {...ICON} />
          <span>{saving ? 'Saving…' : 'Save'}</span>
        </Button>
      </header>
      <div className={styles.cardBody}>
        <div className={styles.formGrid4}>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Supplier *</span>
            <select className={styles.fieldSelect} value={form.supplierId} disabled={locked}
              onChange={(e) => set('supplierId', e.target.value)}>
              <option value="">— Pick supplier —</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
              ))}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Currency</span>
            <select className={styles.fieldSelect} value={form.currency} disabled={locked}
              onChange={(e) => set('currency', e.target.value)}>
              <option value="MYR">MYR</option>
              <option value="RMB">RMB</option>
              <option value="USD">USD</option>
              <option value="SGD">SGD</option>
            </select>
          </label>
          <div />
          <label className={styles.field}>
            <span className={styles.fieldLabel}>PO Date</span>
            <input type="date" className={styles.fieldInput} value={form.poDate} disabled={locked}
              onChange={(e) => set('poDate', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Expected Delivery</span>
            <input type="date" className={styles.fieldInput} value={form.expectedAt} disabled={locked}
              onChange={(e) => set('expectedAt', e.target.value)} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Notes</span>
            <input className={styles.fieldInput} value={form.notes} disabled={locked}
              onChange={(e) => set('notes', e.target.value)} />
          </label>
        </div>
      </div>
    </section>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Variants summary pills
   ════════════════════════════════════════════════════════════════════════ */
const VariantsPills = ({ variants }: { variants: Record<string, unknown> | null }) => {
  if (!variants || typeof variants !== 'object') return null;
  const entries = Object.entries(variants).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return null;
  return (
    <div className={styles.variantBlock}>
      {entries.map(([k, v]) => (
        <span key={k} className={styles.variantPill}>{k}: {String(v)}</span>
      ))}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   PoLineItemModal — HOOKKA per-category variant editor + auto-recompute
   Adapted from SO LineItemModal but with PO-specific fields (supplier_sku)
   ════════════════════════════════════════════════════════════════════════ */
type LinePayload = Omit<NewPoItem, 'qty' | 'unitPriceCenti'> & {
  qty: number;
  unitPriceCenti: number;
};

const PoLineItemModal = ({
  editing, maint, currency, onClose, onSave, saving,
}: {
  editing: PoItemRow | null;
  maint: import('../lib/mfg-products-queries').MaintenanceConfig | null;
  currency: string;
  onClose: () => void;
  onSave: (p: LinePayload) => void;
  saving: boolean;
}) => {
  const [search, setSearch] = useState(editing?.material_code ?? '');
  const productsQuery = useMfgProducts({ search: search.trim() || undefined });
  const candidates = productsQuery.data ?? [];

  const [picked, setPicked] = useState<import('../lib/mfg-products-queries').MfgProductRow | null>(null);
  const [manualPrice, setManualPrice] = useState(false);

  const [draft, setDraft] = useState<LinePayload>({
    materialKind: (editing?.material_kind ?? 'mfg_product') as 'mfg_product' | 'fabric' | 'raw',
    materialCode: editing?.material_code ?? '',
    materialName: editing?.material_name ?? '',
    supplierSku: editing?.supplier_sku ?? '',
    itemGroup: editing?.item_group ?? 'others',
    description: editing?.description ?? '',
    uom: editing?.uom ?? 'UNIT',
    qty: editing?.qty ?? 1,
    unitPriceCenti: editing?.unit_price_centi ?? 0,
    discountCenti: editing?.discount_centi ?? 0,
    unitCostCenti: editing?.unit_cost_centi ?? 0,
    variants: (editing?.variants as Record<string, unknown>) ?? {},
    notes: editing?.notes ?? '',
  });

  const pickProduct = (p: import('../lib/mfg-products-queries').MfgProductRow) => {
    setPicked(p);
    setManualPrice(false);
    setDraft((s) => ({
      ...s,
      materialKind: 'mfg_product',
      materialCode: p.code,
      materialName: p.name,
      itemGroup: p.category.toLowerCase(),
      description: p.name,
      unitPriceCenti: p.base_price_sen ?? 0,
      variants: {},
    }));
    setSearch(p.code);
  };

  const setVariant = (k: string, v: string | number) =>
    setDraft((s) => ({ ...s, variants: { ...s.variants, [k]: v } }));

  // Auto-recompute unit price from base + variant surcharges
  useEffect(() => {
    if (manualPrice || !maint || !picked) return;
    const category = (draft.itemGroup ?? '').toUpperCase();
    let basePriceSen = picked.base_price_sen ?? 0;
    let extraSen = 0;
    if (category === 'SOFA') {
      const sh = String(draft.variants?.seatHeight ?? '');
      if (sh && Array.isArray(picked.seat_height_prices)) {
        const match = (picked.seat_height_prices as Array<{ height: string; tier: string; priceSen: number }>)
          .find((p) => p.height === sh && p.tier === 'PRICE_2');
        if (match) basePriceSen = match.priceSen;
      }
      const legV = String(draft.variants?.legHeight ?? '');
      const specV = String(draft.variants?.special ?? '');
      extraSen += maint.sofaLegHeights.find((o) => o.value === legV)?.priceSen ?? 0;
      extraSen += maint.sofaSpecials.find((o) => o.value === specV)?.priceSen ?? 0;
    } else if (category === 'BEDFRAME') {
      const divanV = String(draft.variants?.divanHeight ?? '');
      const legV = String(draft.variants?.legHeight ?? '');
      const specV = String(draft.variants?.special ?? '');
      extraSen += maint.divanHeights.find((o) => o.value === divanV)?.priceSen ?? 0;
      extraSen += maint.legHeights.find((o) => o.value === legV)?.priceSen ?? 0;
      extraSen += maint.specials.find((o) => o.value === specV)?.priceSen ?? 0;
    }
    const newPrice = basePriceSen + extraSen;
    setDraft((s) => (s.unitPriceCenti === newPrice ? s : { ...s, unitPriceCenti: newPrice }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, draft.variants, draft.itemGroup, maint, manualPrice]);

  const lineTotal = (draft.qty * draft.unitPriceCenti) - (draft.discountCenti ?? 0);

  const submit = () => {
    if (!draft.materialCode.trim()) { alert('Pick a product first.'); return; }
    onSave(draft);
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{editing ? 'Edit Line Item' : 'Add Line Item'}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X {...ICON} />
          </button>
        </header>

        <div className={styles.modalBody}>
          {/* Product picker */}
          <div>
            <p className={styles.subHead}>Product</p>
            <div className={styles.pickerWrap}>
              <input
                className={styles.fieldInput}
                placeholder="Search by code or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search.trim() && candidates.length > 0 && search !== draft.materialCode && (
                <ul className={styles.suggestList}>
                  {candidates.slice(0, 8).map((p) => (
                    <li key={p.id} className={styles.suggestItem} onMouseDown={() => pickProduct(p)}>
                      <div><span className={styles.codeCell}>{p.code}</span> · {p.name}</div>
                      <div className={styles.suggestCode}>
                        {p.category} · {fmtRm(p.base_price_sen ?? 0, currency)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {draft.materialCode && (
              <div className={styles.previewLine} style={{ marginTop: 8 }}>
                <span><strong>{draft.materialCode}</strong> · {draft.description ?? draft.materialName}</span>
                <span className={styles.previewPrice}>{fmtRm(draft.unitPriceCenti, currency)}</span>
              </div>
            )}
            <label className={styles.field} style={{ marginTop: 'var(--space-2)' }}>
              <span className={styles.fieldLabel}>Supplier SKU (optional)</span>
              <input className={styles.fieldInput} value={draft.supplierSku ?? ''}
                placeholder="Supplier's own code for this product"
                onChange={(e) => setDraft((s) => ({ ...s, supplierSku: e.target.value }))} />
            </label>
          </div>

          {/* Variants editor — shown by category */}
          {(draft.itemGroup === 'bedframe' || draft.itemGroup === 'sofa') && maint && (
            <div>
              <p className={styles.subHead}>Variants</p>
              {draft.itemGroup === 'bedframe' ? (
                <div className={styles.formGrid4}>
                  <VariantSelect label="Divan Height" options={maint.divanHeights}
                    value={String(draft.variants?.divanHeight ?? '')}
                    onChange={(v) => setVariant('divanHeight', v)} />
                  <VariantSelect label="Gap"
                    options={maint.gaps.map((g) => ({ value: g, priceSen: 0 }))}
                    value={String(draft.variants?.gap ?? '')}
                    onChange={(v) => setVariant('gap', v)} />
                  <VariantSelect label="Leg Height" options={maint.legHeights}
                    value={String(draft.variants?.legHeight ?? '')}
                    onChange={(v) => setVariant('legHeight', v)} />
                  <VariantSelect label="Special" options={maint.specials}
                    value={String(draft.variants?.special ?? '')}
                    onChange={(v) => setVariant('special', v)} />
                </div>
              ) : (
                <div className={styles.formGrid4}>
                  <VariantSelect label="Seat Height"
                    options={maint.sofaSizes.map((s) => ({ value: s, priceSen: 0 }))}
                    value={String(draft.variants?.seatHeight ?? '')}
                    onChange={(v) => setVariant('seatHeight', v)} />
                  <VariantSelect label="Leg Height" options={maint.sofaLegHeights}
                    value={String(draft.variants?.legHeight ?? '')}
                    onChange={(v) => setVariant('legHeight', v)} />
                  <VariantSelect label="Special" options={maint.sofaSpecials}
                    value={String(draft.variants?.special ?? '')}
                    onChange={(v) => setVariant('special', v)} />
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Fabric Color (free text)</span>
                    <input className={styles.fieldInput}
                      value={String(draft.variants?.fabricColor ?? '')}
                      onChange={(e) => setVariant('fabricColor', e.target.value)} />
                  </label>
                </div>
              )}
            </div>
          )}

          {/* Pricing */}
          <div>
            <p className={styles.subHead}>Pricing</p>
            <div className={styles.formGrid4}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Qty</span>
                <input type="number" className={styles.fieldInput} value={draft.qty}
                  onChange={(e) => setDraft((s) => ({ ...s, qty: Number(e.target.value) || 0 }))} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>
                  Unit Price (RM)
                  {!manualPrice && picked && (
                    <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-orange)' }}>
                      · auto
                    </span>
                  )}
                </span>
                <input type="number" step="0.01" className={styles.fieldInput}
                  value={(draft.unitPriceCenti / 100).toFixed(2)}
                  onChange={(e) => {
                    setManualPrice(true);
                    setDraft((s) => ({ ...s, unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0 }));
                  }} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Discount (RM)</span>
                <input type="number" step="0.01" className={styles.fieldInput}
                  value={((draft.discountCenti ?? 0) / 100).toFixed(2)}
                  onChange={(e) => setDraft((s) => ({ ...s, discountCenti: Math.round(Number(e.target.value) * 100) || 0 }))} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Unit Cost (RM)</span>
                <input type="number" step="0.01" className={styles.fieldInput}
                  value={((draft.unitCostCenti ?? 0) / 100).toFixed(2)}
                  onChange={(e) => setDraft((s) => ({ ...s, unitCostCenti: Math.round(Number(e.target.value) * 100) || 0 }))} />
              </label>
            </div>
            <div className={styles.previewLine} style={{ marginTop: 8 }}>
              <span>Line total</span>
              <span className={styles.previewPrice}>{fmtRm(lineTotal, currency)}</span>
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Notes</span>
            <input className={styles.fieldInput} value={draft.notes ?? ''}
              onChange={(e) => setDraft((s) => ({ ...s, notes: e.target.value }))} />
          </label>
        </div>

        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Line Item'}
          </Button>
        </footer>
      </div>
    </div>
  );
};

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
    <select className={styles.fieldSelect} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value}{o.priceSen > 0 ? ` (+${fmtRm(o.priceSen)})` : ''}
        </option>
      ))}
    </select>
  </label>
);

