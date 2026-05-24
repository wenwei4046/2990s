// ----------------------------------------------------------------------------
// Purchase Orders (manufacturer-side).
//
// 简洁版第一版:
//   - List 所有 PO,按 status 过滤
//   - "New PO" → 选 supplier → 列出 supplier 的 bindings → 给每条填 qty →
//     POST /mfg-purchase-orders
//   - 列表行点击 → 显示 PO detail(items + 状态 actions: Submit/Cancel)
//
// 没做(后续):GRN 收货、3-way match、PDF 打印、邮件发送。
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Plus, X, Send, Ban, FileText, Printer } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  usePurchaseOrders,
  usePurchaseOrderDetail,
  useCreatePurchaseOrder,
  useSubmitPurchaseOrder,
  useCancelPurchaseOrder,
  useSuppliers,
  useSupplierDetail,
  type PoStatus,
  type PoHeaderRow,
  type BindingRow,
  type Currency,
  type NewPoItem,
} from '../lib/suppliers-queries';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const STATUS_CHIPS: { value: 'all' | PoStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'DRAFT', label: 'Draft' },
  { value: 'SUBMITTED', label: 'Submitted' },
  { value: 'PARTIALLY_RECEIVED', label: 'Partial' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

const STATUS_COLOR: Record<PoStatus, string> = {
  DRAFT: 'rgba(34, 31, 32, 0.06)',
  SUBMITTED: 'rgba(31, 58, 138, 0.10)',
  PARTIALLY_RECEIVED: 'rgba(232, 107, 58, 0.10)',
  RECEIVED: 'rgba(47, 93, 79, 0.12)',
  CANCELLED: 'rgba(184, 51, 31, 0.10)',
};

const fmtMoney = (centi: number, currency: Currency): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type Drawer =
  | { kind: 'closed' }
  | { kind: 'create' }
  | { kind: 'detail'; poId: string };

export const PurchaseOrders = () => {
  const [status, setStatus] = useState<'all' | PoStatus>('all');
  const [drawer, setDrawer] = useState<Drawer>({ kind: 'closed' });

  const { data, isLoading, error } = usePurchaseOrders({
    status: status === 'all' ? undefined : status,
  });
  const rows = useMemo(() => data ?? [], [data]);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Purchase Orders</h1>
          <p className={styles.subtitle}>Manufacturer POs to suppliers</p>
        </div>
        <Button variant="primary" size="md" onClick={() => setDrawer({ kind: 'create' })}>
          <Plus {...ICON} />
          <span>New PO</span>
        </Button>
      </div>

      <div className={styles.statusChips}>
        {STATUS_CHIPS.map((c) => (
          <button
            key={c.value}
            type="button"
            onClick={() => setStatus(c.value)}
            style={{
              fontFamily: 'var(--font-button)',
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              padding: 'var(--space-2) var(--space-4)',
              borderRadius: 'var(--radius-pill)',
              border: status === c.value ? '1px solid var(--c-ink)' : '1px solid var(--line)',
              background: status === c.value ? 'var(--c-ink)' : 'var(--c-paper)',
              color: status === c.value ? 'var(--c-cream)' : 'var(--c-ink)',
              cursor: 'pointer',
            }}
          >
            {c.label}
          </button>
        ))}
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading POs…' : `${rows.length} purchase orders`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load POs.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>PO #</th>
              <th>Supplier</th>
              <th>Date</th>
              <th>Expected</th>
              <th>Currency</th>
              <th style={{ textAlign: 'right' }}>Total</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && rows.map((po) => (
              <tr key={po.id} onClick={() => setDrawer({ kind: 'detail', poId: po.id })}>
                <td><span className={styles.codeChip}>{po.po_number}</span></td>
                <td>{po.supplier?.name ?? po.supplier?.code ?? '—'}</td>
                <td>{po.po_date}</td>
                <td>{po.expected_at ?? '—'}</td>
                <td>{po.currency}</td>
                <td style={{ textAlign: 'right', fontFamily: 'var(--font-mark)', color: 'var(--c-burnt)', fontWeight: 800 }}>
                  {fmtMoney(po.total_centi, po.currency)}
                </td>
                <td>
                  <span
                    className={styles.statusPill}
                    style={{ background: STATUS_COLOR[po.status] }}
                  >
                    {po.status.replace('_', ' ')}
                  </span>
                </td>
              </tr>
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyRow}>No POs yet — click "New PO" to start.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {drawer.kind === 'create' && <CreatePoDrawer onClose={() => setDrawer({ kind: 'closed' })} />}
      {drawer.kind === 'detail' && (
        <DetailPoDrawer poId={drawer.poId} onClose={() => setDrawer({ kind: 'closed' })} />
      )}
    </div>
  );
};

/* ─────────────────── Create PO Drawer ──────────────────────────────── */

const CreatePoDrawer = ({ onClose }: { onClose: () => void }) => {
  const suppliers = useSuppliers({ status: 'ACTIVE' });
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [expectedAt, setExpectedAt] = useState('');
  const [notes, setNotes] = useState('');
  const supplierDetail = useSupplierDetail(supplierId);
  const create = useCreatePurchaseOrder();

  const bindings = supplierDetail.data?.bindings ?? [];
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const onQty = (bindingId: string, qty: number) =>
    setQtyMap((s) => ({ ...s, [bindingId]: Math.max(0, qty || 0) }));

  const lineItems = useMemo<Array<{ binding: BindingRow; qty: number }>>(() => {
    return bindings
      .map((b) => ({ binding: b, qty: qtyMap[b.id] ?? 0 }))
      .filter((r) => r.qty > 0);
  }, [bindings, qtyMap]);

  const subtotalCenti = useMemo(
    () => lineItems.reduce((s, r) => s + r.qty * r.binding.unit_price_centi, 0),
    [lineItems],
  );

  const currency = bindings[0]?.currency ?? 'MYR';

  const submit = () => {
    if (!supplierId) return alert('Pick a supplier.');
    if (lineItems.length === 0) return alert('Add at least one item with qty > 0.');

    const items: NewPoItem[] = lineItems.map((r) => ({
      materialKind: r.binding.material_kind,
      materialCode: r.binding.material_code,
      materialName: r.binding.material_name,
      supplierSku: r.binding.supplier_sku,
      qty: r.qty,
      unitPriceCenti: r.binding.unit_price_centi,
      bindingId: r.binding.id,
    }));

    create.mutate(
      { supplierId, currency, expectedAt: expectedAt || undefined, notes: notes || undefined, items },
      {
        onSuccess: (res) => {
          alert(`PO created: ${res.poNumber}`);
          onClose();
        },
      },
    );
  };

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>New Purchase Order</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON} /></button>
        </header>

        <div className={styles.drawerBody}>
          <div className={styles.section}>
            <p className={styles.eyebrow}>1. Pick Supplier</p>
            <select
              className={styles.fieldSelect}
              value={supplierId ?? ''}
              onChange={(e) => setSupplierId(e.target.value || null)}
            >
              <option value="">— Select supplier —</option>
              {suppliers.data?.map((s) => (
                <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
              ))}
            </select>
          </div>

          {supplierId && (
            <>
              <div className={styles.section}>
                <p className={styles.eyebrow}>2. Add Items (qty per binding)</p>
                {supplierDetail.isLoading && <p>Loading bindings…</p>}
                {bindings.length === 0 && !supplierDetail.isLoading && (
                  <p className={styles.bannerWarn}>
                    This supplier has no material bindings. Add bindings on the Suppliers page first.
                  </p>
                )}
                {bindings.map((b) => (
                  <div key={b.id} className={styles.bindingRow}>
                    <span className={styles.bindingIcon}>·</span>
                    <div className={styles.bindingMaterial}>
                      <span className={styles.bindingCode}>{b.material_code}</span>
                      <span className={styles.bindingName}>{b.material_name}</span>
                    </div>
                    <span className={styles.bindingSku}>{b.supplier_sku}</span>
                    <span className={styles.bindingPrice}>{fmtMoney(b.unit_price_centi, b.currency)}</span>
                    <input
                      type="number"
                      min={0}
                      className={styles.fieldInput}
                      style={{ width: 80, textAlign: 'right' }}
                      placeholder="qty"
                      value={qtyMap[b.id] ?? ''}
                      onChange={(e) => onQty(b.id, Number(e.target.value))}
                    />
                    <span className={styles.bindingMeta}>
                      {qtyMap[b.id] ? fmtMoney(qtyMap[b.id]! * b.unit_price_centi, b.currency) : '—'}
                    </span>
                    <span />
                  </div>
                ))}
              </div>

              <div className={styles.section}>
                <p className={styles.eyebrow}>3. Header</p>
                <div className={styles.formGrid}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Expected delivery</span>
                    <input
                      type="date"
                      className={styles.fieldInput}
                      value={expectedAt}
                      onChange={(e) => setExpectedAt(e.target.value)}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Currency</span>
                    <input className={styles.fieldInput} value={currency} disabled />
                  </label>
                  <label className={`${styles.field} ${styles.formGridFull}`}>
                    <span className={styles.fieldLabel}>Notes</span>
                    <textarea
                      className={styles.fieldTextarea}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                    />
                  </label>
                </div>
              </div>

              <div className={styles.section}>
                <p className={styles.eyebrow}>Summary</p>
                <p style={{ fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-24)', color: 'var(--c-burnt)', fontWeight: 800 }}>
                  Subtotal: {fmtMoney(subtotalCenti, currency)} · {lineItems.length} line items
                </p>
              </div>
            </>
          )}
        </div>

        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="md"
            onClick={submit}
            disabled={create.isPending || !supplierId || lineItems.length === 0}
          >
            {create.isPending ? 'Creating…' : 'Create PO (Draft)'}
          </Button>
        </footer>
      </aside>
    </>
  );
};

/* ─────────────────── Detail PO Drawer ──────────────────────────────── */

const DetailPoDrawer = ({ poId, onClose }: { poId: string; onClose: () => void }) => {
  const detail = usePurchaseOrderDetail(poId);
  const submit = useSubmitPurchaseOrder();
  const cancel = useCancelPurchaseOrder();

  const po = detail.data?.purchaseOrder;
  const items = detail.data?.items ?? [];

  return (
    <>
      <div className={styles.backdrop} onClick={onClose} />
      <aside className={styles.drawer}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>
            {po?.po_number ?? 'Purchase Order'}
          </h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON} /></button>
        </header>

        <div className={styles.drawerBody}>
          {detail.isLoading && <p className={styles.eyebrow}>Loading…</p>}
          {po && (
            <>
              <div className={styles.section}>
                <p className={styles.eyebrow}>Supplier</p>
                <p style={{ fontFamily: 'var(--font-title)', fontSize: 'var(--fs-20)', fontWeight: 700 }}>
                  {po.supplier?.name ?? po.supplier?.code}
                </p>
              </div>

              <div className={styles.formGrid}>
                <SmallStat label="PO Date" value={po.po_date} />
                <SmallStat label="Expected" value={po.expected_at ?? '—'} />
                <SmallStat label="Currency" value={po.currency} />
                <SmallStat label="Status" value={po.status.replace('_', ' ')} />
                <SmallStat label="Subtotal" value={fmtMoney(po.subtotal_centi, po.currency)} />
                <SmallStat label="Total" value={fmtMoney(po.total_centi, po.currency)} />
              </div>

              {po.notes && (
                <div className={styles.section}>
                  <p className={styles.eyebrow}>Notes</p>
                  <p>{po.notes}</p>
                </div>
              )}

              <div className={styles.section}>
                <p className={styles.eyebrow}>Items ({items.length})</p>
                {items.map((it) => (
                  <div key={it.id} className={styles.bindingRow}>
                    <span className={styles.bindingIcon}><FileText size={14} strokeWidth={1.75} /></span>
                    <div className={styles.bindingMaterial}>
                      <span className={styles.bindingCode}>{it.material_code}</span>
                      <span className={styles.bindingName}>{it.material_name}</span>
                    </div>
                    <span className={styles.bindingSku}>{it.supplier_sku ?? '—'}</span>
                    <span className={styles.bindingPrice}>
                      {fmtMoney(it.unit_price_centi, po.currency)}
                    </span>
                    <span className={styles.bindingMeta}>× {it.qty}</span>
                    <span className={styles.bindingMeta}>{fmtMoney(it.line_total_centi, po.currency)}</span>
                    <span />
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {po && (
          <footer className={styles.drawerFooter}>
            <Button
              variant="ghost"
              size="md"
              onClick={() => {
                // Dynamic import — PDF chunk is shared with SO/DO so it's cached
                // after first use on any flow.
                import('../lib/purchase-order-pdf').then(({ generatePurchaseOrderPdf }) =>
                  generatePurchaseOrderPdf(po, items),
                ).catch((e) => alert(`PDF generation failed: ${e instanceof Error ? e.message : String(e)}`));
              }}
            >
              <Printer {...ICON} />
              <span>Print PDF</span>
            </Button>
            {po.status === 'DRAFT' && (
              <Button
                variant="ghost"
                size="md"
                onClick={() => {
                  if (confirm(`Cancel PO ${po.po_number}?`)) cancel.mutate(po.id, { onSuccess: onClose });
                }}
              >
                <Ban {...ICON} />
                <span>Cancel</span>
              </Button>
            )}
            {po.status === 'DRAFT' && (
              <Button variant="primary" size="md" onClick={() => submit.mutate(po.id, { onSuccess: onClose })}>
                <Send {...ICON} />
                <span>{submit.isPending ? 'Submitting…' : 'Submit'}</span>
              </Button>
            )}
            {po.status !== 'DRAFT' && (
              <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
            )}
          </footer>
        )}
      </aside>
    </>
  );
};

const SmallStat = ({ label, value }: { label: string; value: string }) => (
  <div className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <span style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-14)', fontWeight: 600 }}>
      {value}
    </span>
  </div>
);
