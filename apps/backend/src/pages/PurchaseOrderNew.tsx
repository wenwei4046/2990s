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

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useCreatePurchaseOrder,
  useSuppliers,
  useSupplierDetail,
  type BindingRow,
  type NewPoItem,
  type MaterialKind,
} from '../lib/suppliers-queries';
import { useWarehouses } from '../lib/inventory-queries';
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
    apps/api/src/routes/mfg-purchase-orders.ts §VALID_KINDS. */
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
};

const newLine = (): DraftLine => ({
  rid: `l${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  materialKind: 'mfg_product',
  materialCode: '',
  materialName: '',
  qty: 1,
  unitPriceCenti: 0,
});

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

  // ── Helpers ─────────────────────────────────────────────────────────
  const setLine  = (rid: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const addLine  = () => setLines((prev) => [...prev, newLine()]);
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
    });
  };

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
    }));

    create.mutate(
      {
        supplierId,
        currency,
        poDate,
        expectedAt: expectedAt || undefined,
        notes: notes || undefined,
        purchaseLocationId: purchaseLocationId || undefined,
        items,
      },
      {
        onSuccess: (res) => navigate(`/purchase-orders/${res.id}`),
        onError:   (err) => window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  // Inline styles for the items grid — avoids adding a whole new module CSS
  // file for one table. Header row + body rows share grid template so
  // columns line up exactly with their header.
  const gridTemplate = 'minmax(180px, 1.4fr) minmax(160px, 1.4fr) 70px 110px 100px 130px 150px 110px 32px';
  const cellPad = 'var(--space-2) var(--space-2)';

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
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase-orders')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={create.isPending || !supplierId}
          >
            <Save {...ICON} />
            {create.isPending ? 'Saving…' : 'Save PO (Draft)'}
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
                style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)', minHeight: 80, resize: 'vertical' }}
                rows={3}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Expected Delivery</span>
              <input
                type="date"
                value={expectedAt}
                onChange={(e) => setExpectedAt(e.target.value)}
                className={styles.fieldInput}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Purchase Location</span>
              <select
                value={purchaseLocationId}
                onChange={(e) => setPurchaseLocationId(e.target.value)}
                className={styles.fieldInput}
              >
                <option value="">— Set on detail page —</option>
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
                style={{ minHeight: 80, resize: 'vertical' }}
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

      {/* Items card */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Items</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {supplierId
              ? `${bindings.length} item(s) bound to this supplier — picker filters to these`
              : 'Pick a Creditor first to enable the item-code picker'}
          </span>
        </div>
        <div className={styles.cardBody}>
          {/* Grid header row */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: gridTemplate,
            gap: 'var(--space-2)',
            padding: cellPad,
            fontFamily: 'var(--font-button)',
            fontSize: 'var(--fs-11)',
            fontWeight: 600,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: 'var(--fg-soft)',
            borderBottom: '1px solid var(--line)',
          }}>
            <div>Item Code</div>
            <div>Description</div>
            <div style={{ textAlign: 'right' }}>Qty</div>
            <div style={{ textAlign: 'right' }}>Unit Price</div>
            <div style={{ textAlign: 'right' }}>Discount</div>
            <div>Delivery</div>
            <div>Warehouse</div>
            <div style={{ textAlign: 'right' }}>Total</div>
            <div></div>
          </div>

          {/* Grid body */}
          {lines.map((l) => {
            const lineTotalCenti = Math.max(0, l.qty * l.unitPriceCenti - (l.discountCenti ?? 0));
            return (
              <div
                key={l.rid}
                style={{
                  display: 'grid',
                  gridTemplateColumns: gridTemplate,
                  gap: 'var(--space-2)',
                  alignItems: 'center',
                  padding: cellPad,
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <div>
                  <input
                    type="text"
                    list={`bindings-${l.rid}`}
                    value={l.materialCode}
                    onChange={(e) => {
                      const code = e.target.value;
                      const match = bindings.find((b) => b.material_code === code);
                      if (match) pickBinding(l.rid, match);
                      else setLine(l.rid, { materialCode: code, bindingId: undefined });
                    }}
                    placeholder={supplierId ? 'Type or pick…' : 'Pick a supplier first'}
                    disabled={!supplierId}
                    className={styles.fieldInput}
                    style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}
                  />
                  <datalist id={`bindings-${l.rid}`}>
                    {bindings.map((b) => (
                      <option key={b.id} value={b.material_code}>
                        {b.material_name} · {b.supplier_sku} · {fmtRm(b.unit_price_centi, b.currency)}
                      </option>
                    ))}
                  </datalist>
                </div>
                <div>
                  <input
                    type="text"
                    value={l.materialName}
                    onChange={(e) => setLine(l.rid, { materialName: e.target.value })}
                    placeholder="(auto-filled if bound)"
                    className={styles.fieldInput}
                    style={{ fontSize: 'var(--fs-13)' }}
                  />
                </div>
                <div>
                  <input
                    type="number" min={0} step={1}
                    value={l.qty}
                    onChange={(e) => setLine(l.rid, { qty: Number(e.target.value) })}
                    className={styles.fieldInput}
                    style={{ textAlign: 'right', fontSize: 'var(--fs-13)' }}
                  />
                </div>
                <div>
                  <input
                    type="number" min={0} step={0.01}
                    value={(l.unitPriceCenti / 100).toFixed(2)}
                    onChange={(e) => setLine(l.rid, { unitPriceCenti: Math.round(Number(e.target.value) * 100) })}
                    className={styles.fieldInput}
                    style={{ textAlign: 'right', fontSize: 'var(--fs-13)' }}
                  />
                </div>
                <div>
                  <input
                    type="number" min={0} step={0.01}
                    value={((l.discountCenti ?? 0) / 100).toFixed(2)}
                    onChange={(e) => setLine(l.rid, { discountCenti: Math.round(Number(e.target.value) * 100) })}
                    className={styles.fieldInput}
                    style={{ textAlign: 'right', fontSize: 'var(--fs-13)' }}
                  />
                </div>
                <div>
                  <input
                    type="date"
                    value={l.deliveryDate ?? ''}
                    onChange={(e) => setLine(l.rid, { deliveryDate: e.target.value })}
                    className={styles.fieldInput}
                    style={{ fontSize: 'var(--fs-12)' }}
                  />
                </div>
                <div>
                  <select
                    value={l.warehouseId ?? ''}
                    onChange={(e) => setLine(l.rid, { warehouseId: e.target.value })}
                    className={styles.fieldInput}
                    style={{ fontSize: 'var(--fs-12)' }}
                  >
                    <option value="">— Header default —</option>
                    {(warehouses.data ?? []).map((w) => (
                      <option key={w.id} value={w.id}>{w.code}</option>
                    ))}
                  </select>
                </div>
                <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>
                  {fmtRm(lineTotalCenti, currency)}
                </div>
                <div>
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
                    }}
                  >
                    <Trash2 {...SM_ICON} />
                  </button>
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
              padding: '10px 12px',
              marginTop: 'var(--space-3)',
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
            <Plus {...SM_ICON} /> Add line item
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
