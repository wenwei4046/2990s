// ----------------------------------------------------------------------------
// PurchaseOrderNew — full-page Create PO at /purchase-orders/new (PR #97).
//
// Commander 2026-05-26 (AutoCount parity): "Create PO 也要像这样子啊". The
// old side-drawer with 3 modes (Blank Draft / From Supplier / From Item) is
// gone — replaced with a single full-page form that mirrors AutoCount's
// "New Purchase Order" window:
//
//   ┌────────────────────────────────────────────────────────────────────┐
//   │  ← Back   New Purchase Order                  [ Cancel ] [ Save ]  │
//   ├────────────────────────────────────────────────────────────────────┤
//   │  Creditor          [ supplier picker ▾ ]   P/O No   <<Next>>       │
//   │  Name              <auto-fill, read-only>  Date     YYYY-MM-DD     │
//   │  Address           <auto-fill, multi-line> Expected YYYY-MM-DD     │
//   │  Purchase Location [ warehouse dropdown ▾] Notes    <free text>    │
//   ├────────────────────────────────────────────────────────────────────┤
//   │  Item Code | Description | Qty | Unit Price | Disc | Delivery     │
//   │            |             |     |            |      | Warehouse |   │
//   │  ─────────────────────────────────────────────────────────────────  │
//   │  [ + Add Line Item ]                                                │
//   ├────────────────────────────────────────────────────────────────────┤
//   │                                       Subtotal   MYR 0.00          │
//   │                                       Total      MYR 0.00          │
//   └────────────────────────────────────────────────────────────────────┘
//
// On Save: POSTs a single payload with header + items[] → server creates the
// PO + all lines in one shot → navigates to /purchase-orders/:id where the
// existing detail page handles submit / convert-from-SO / etc.
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

/** Per-line draft row — mirrors NewPoItem with id for React keying + a
    binding hint so the Item Code picker can auto-fill unit price + sku.
    PR #97 — materialKind uses the schema's lowercase enum
    ('mfg_product' | 'fabric' | 'raw') so the POST body lines up with what
    apps/api/src/routes/mfg-purchase-orders.ts §VALID_KINDS accepts. */
type DraftLine = {
  rid: string;                   // React key
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

  // ── Totals ──────────────────────────────────────────────────────────
  const subtotalCenti = useMemo(
    () => lines.reduce(
      (s, l) => s + Math.max(0, l.qty * l.unitPriceCenti - (l.discountCenti ?? 0)),
      0,
    ),
    [lines],
  );

  // ── Submit ──────────────────────────────────────────────────────────
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
        onSuccess: (res) => {
          // Land on the detail page so commander can continue with submit /
          // convert-from-SO / etc. PurchaseOrderDetail also handles the
          // purchase_location header field — PR #97 leaves that there
          // (single source of truth) and surfaces it in the new form too.
          navigate(`/purchase-orders/${res.id}`);
        },
        onError: (err) => {
          window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`);
        },
      },
    );
  };

  // ── Render ──────────────────────────────────────────────────────────
  return (
    <div className={styles.page}>
      {/* Top bar */}
      <div className={styles.header}>
        <Link to="/purchase-orders" className={styles.backBtn}>
          <ArrowLeft {...ICON} /> <span>Purchase Orders</span>
        </Link>
        <div className={styles.titleRow}>
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

      {/* Header card — 2-column grid mirroring AutoCount */}
      <section className={styles.card}>
        <h2 className={styles.cardTitle}>Header</h2>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
          {/* LEFT column — Creditor / Name / Address / Purchase Location */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
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
              <span className={styles.fieldLabel}>Address</span>
              <textarea
                readOnly
                value={[supplier?.address, supplier?.area, supplier?.postcode, supplier?.state, supplier?.country]
                  .filter(Boolean).join(', ')}
                placeholder="(auto-filled when supplier selected)"
                className={styles.fieldInput}
                style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)', minHeight: 60 }}
                rows={3}
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
              <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)', marginTop: 2 }}>
                Default ship-to warehouse for every line; each line can override below.
              </span>
            </label>
          </div>

          {/* RIGHT column — P/O No / Date / Expected / Notes */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
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
              <span className={styles.fieldLabel}>Date *</span>
              <input
                type="date"
                value={poDate}
                onChange={(e) => setPoDate(e.target.value)}
                className={styles.fieldInput}
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
              <span className={styles.fieldLabel}>Notes</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Free text — supplier instructions, internal notes…"
                className={styles.fieldInput}
                rows={3}
                style={{ minHeight: 60 }}
              />
            </label>
            {supplier && (
              <div style={{
                background: 'var(--c-cream)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: 'var(--space-2) var(--space-3)',
                fontSize: 'var(--fs-12)',
                color: 'var(--fg-muted)',
                display: 'flex',
                flexDirection: 'column',
                gap: 2,
              }}>
                {supplier.contact_person && <span>Contact: {supplier.contact_person}</span>}
                {supplier.phone          && <span>Phone: {supplier.phone}</span>}
                {supplier.email          && <span>Email: {supplier.email}</span>}
                {supplier.payment_terms  && <span>Payment Terms: {supplier.payment_terms}</span>}
                <span>Currency: {currency}</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Items table */}
      <section className={styles.card}>
        <div className={styles.cardHeadRow}>
          <h2 className={styles.cardTitle}>Items</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {supplierId
              ? `${bindings.length} item(s) bound to this supplier — picker filters to these`
              : 'Pick a Creditor first to enable the item-code picker'}
          </span>
        </div>

        <table className={styles.itemsTable} style={{ width: '100%' }}>
          <thead>
            <tr>
              <th style={{ width: 280 }}>Item Code</th>
              <th>Description</th>
              <th style={{ width: 70,  textAlign: 'right' }}>Qty</th>
              <th style={{ width: 120, textAlign: 'right' }}>Unit Price</th>
              <th style={{ width: 100, textAlign: 'right' }}>Discount</th>
              <th style={{ width: 130 }}>Delivery</th>
              <th style={{ width: 150 }}>Warehouse</th>
              <th style={{ width: 120, textAlign: 'right' }}>Total</th>
              <th style={{ width: 32 }}></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((l) => {
              const lineTotalCenti = Math.max(0, l.qty * l.unitPriceCenti - (l.discountCenti ?? 0));
              return (
                <tr key={l.rid}>
                  <td>
                    {/* Picker: if supplier has bindings, datalist them so the
                        Item Code input can autocomplete. Free text still
                        allowed for non-bound items (raw description PO). */}
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
                      style={{ width: '100%', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}
                    />
                    <datalist id={`bindings-${l.rid}`}>
                      {bindings.map((b) => (
                        <option key={b.id} value={b.material_code}>
                          {b.material_name} · {b.supplier_sku} · {fmtRm(b.unit_price_centi, b.currency)}
                        </option>
                      ))}
                    </datalist>
                  </td>
                  <td>
                    <input
                      type="text"
                      value={l.materialName}
                      onChange={(e) => setLine(l.rid, { materialName: e.target.value })}
                      placeholder="(auto-filled if bound)"
                      className={styles.fieldInput}
                      style={{ width: '100%', fontSize: 'var(--fs-13)' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={l.qty}
                      onChange={(e) => setLine(l.rid, { qty: Number(e.target.value) })}
                      className={styles.fieldInput}
                      style={{ width: '100%', textAlign: 'right', fontSize: 'var(--fs-13)' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={(l.unitPriceCenti / 100).toFixed(2)}
                      onChange={(e) => setLine(l.rid, { unitPriceCenti: Math.round(Number(e.target.value) * 100) })}
                      className={styles.fieldInput}
                      style={{ width: '100%', textAlign: 'right', fontSize: 'var(--fs-13)' }}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={((l.discountCenti ?? 0) / 100).toFixed(2)}
                      onChange={(e) => setLine(l.rid, { discountCenti: Math.round(Number(e.target.value) * 100) })}
                      className={styles.fieldInput}
                      style={{ width: '100%', textAlign: 'right', fontSize: 'var(--fs-13)' }}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={l.deliveryDate ?? ''}
                      onChange={(e) => setLine(l.rid, { deliveryDate: e.target.value })}
                      className={styles.fieldInput}
                      style={{ width: '100%', fontSize: 'var(--fs-12)' }}
                    />
                  </td>
                  <td>
                    <select
                      value={l.warehouseId ?? ''}
                      onChange={(e) => setLine(l.rid, { warehouseId: e.target.value })}
                      className={styles.fieldInput}
                      style={{ width: '100%', fontSize: 'var(--fs-12)' }}
                    >
                      <option value="">— Header default —</option>
                      {(warehouses.data ?? []).map((w) => (
                        <option key={w.id} value={w.id}>{w.code}</option>
                      ))}
                    </select>
                  </td>
                  <td style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>
                    {fmtRm(lineTotalCenti, currency)}
                  </td>
                  <td>
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
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

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
            marginTop: 8,
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
      </section>

      {/* Totals footer */}
      <section className={styles.card} style={{ alignSelf: 'flex-end', maxWidth: 360, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-14)' }}>
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
      </section>
    </div>
  );
};
