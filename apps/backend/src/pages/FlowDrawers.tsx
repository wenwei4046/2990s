// ----------------------------------------------------------------------------
// Create drawers for the 7 procurement/sales-flow modules.
//
// One file per module pattern would balloon to ~3000 lines across 7 files.
// Bundling here trades file-size readability for *less duplication* — every
// drawer follows the same skeleton (header form + items editor + submit).
//
// 2990s tokens; styles imported from Suppliers.module.css for drawer chrome
// + FlowPages.module.css for surface.
//
// Each component takes one prop:  onClose: () => void
// And renders the backdrop + drawer + form. Caller controls visibility.
// ----------------------------------------------------------------------------

import { todayMyt } from '../lib/dates';
import { useMemo, useState } from 'react';
import { X, Plus, Trash2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useCreateGrn, useCreatePurchaseInvoice, useCreateMfgSalesOrder,
  useCreateSalesInvoice,
} from '../lib/flow-queries';
import {
  useSuppliers, usePurchaseOrders, usePurchaseOrderDetail,
} from '../lib/suppliers-queries';
import { useMfgDeliveryOrders } from '../lib/flow-queries';
import { MoneyInput } from '../components/MoneyInput';
import sup from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtMoney = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ── Shared field components ─────────────────────────────────────────── */

const Field = ({
  label, value, onChange, type = 'text', placeholder, multiline, gridFull, required,
}: {
  label: string; value: string | number; onChange: (v: string) => void;
  type?: string; placeholder?: string; multiline?: boolean; gridFull?: boolean; required?: boolean;
}) => (
  <label className={`${sup.field} ${gridFull ? sup.formGridFull : ''}`}>
    <span className={sup.fieldLabel}>{label}{required && ' *'}</span>
    {multiline ? (
      <textarea
        className={sup.fieldTextarea}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    ) : (
      <input
        className={sup.fieldInput}
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    )}
  </label>
);

const DrawerShell = ({
  title, onClose, onSubmit, submitLabel, submitting, children, canSubmit = true,
}: {
  title: string; onClose: () => void; onSubmit: () => void;
  submitLabel: string; submitting: boolean; children: React.ReactNode; canSubmit?: boolean;
}) => (
  <>
    <div className={sup.backdrop} onClick={onClose} />
    <aside className={sup.drawer}>
      <header className={sup.drawerHeader}>
        <h2 className={sup.drawerTitle}>{title}</h2>
        <button type="button" className={sup.iconBtn} onClick={onClose}><X {...ICON} /></button>
      </header>
      <div className={sup.drawerBody}>{children}</div>
      <footer className={sup.drawerFooter}>
        <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
        <Button variant="primary" size="md" onClick={onSubmit} disabled={!canSubmit || submitting}>
          {submitting ? 'Creating…' : submitLabel}
        </Button>
      </footer>
    </aside>
  </>
);

/* ══════════════════════════════════════════════════════════════════════
   1. GRN — receive a PO
   ══════════════════════════════════════════════════════════════════════ */

export const CreateGrnDrawer = ({ onClose }: { onClose: () => void }) => {
  const pos = usePurchaseOrders({ status: 'SUBMITTED' });
  const [poId, setPoId] = useState<string | null>(null);
  const poDetail = usePurchaseOrderDetail(poId);
  const [deliveryNoteRef, setDeliveryNoteRef] = useState('');
  const [notes, setNotes] = useState('');
  const [qtyMap, setQtyMap] = useState<Record<string, number>>({});
  const create = useCreateGrn();

  const items = useMemo(() => poDetail.data?.items ?? [], [poDetail.data]);
  const lineItems = useMemo(
    () => items.map((it: any) => ({ poi: it, qty: qtyMap[it.id] ?? Math.max(0, it.qty - (it.received_qty ?? 0)) })),
    [items, qtyMap],
  );

  const submit = () => {
    if (!poId) return alert('Pick a PO');
    const itemsBody = lineItems
      .filter((r) => r.qty > 0)
      .map((r) => ({
        purchaseOrderItemId: r.poi.id,
        materialKind: r.poi.material_kind,
        materialCode: r.poi.material_code,
        materialName: r.poi.material_name,
        qtyReceived: r.qty,
        qtyAccepted: r.qty,
        unitPriceCenti: r.poi.unit_price_centi,
      }));
    if (!itemsBody.length) return alert('Enter qty for at least one item.');
    const po = poDetail.data?.purchaseOrder;
    if (!po) return;
    create.mutate(
      {
        purchaseOrderId: poId,
        supplierId: po.supplier_id,
        deliveryNoteRef: deliveryNoteRef || undefined,
        notes: notes || undefined,
        items: itemsBody,
      },
      { onSuccess: (res: any) => { alert(`GRN created: ${res.grnNumber}`); onClose(); } },
    );
  };

  return (
    <DrawerShell
      title="New Goods Receipt Note"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Create GRN"
      submitting={create.isPending}
      canSubmit={Boolean(poId)}
    >
      <div className={sup.section}>
        <p className={sup.eyebrow ?? sup.fieldLabel}>1. Pick Purchase Order</p>
        <select
          className={sup.fieldSelect}
          value={poId ?? ''}
          onChange={(e) => setPoId(e.target.value || null)}
        >
          <option value="">— Select PO —</option>
          {(pos.data ?? []).map((p: any) => (
            <option key={p.id} value={p.id}>
              {p.po_number} · {p.supplier?.name ?? p.supplier?.code}
            </option>
          ))}
        </select>
      </div>

      {poId && (
        <>
          <div className={sup.section}>
            <p className={sup.fieldLabel}>2. Items received</p>
            {poDetail.isLoading && <p>Loading items…</p>}
            {items.map((it: any) => {
              const outstanding = Math.max(0, it.qty - (it.received_qty ?? 0));
              const qty = qtyMap[it.id] ?? outstanding;
              return (
                <div key={it.id} className={sup.bindingRow}>
                  <span className={sup.bindingIcon}>·</span>
                  <div className={sup.bindingMaterial}>
                    <span className={sup.bindingCode}>{it.material_code}</span>
                    <span className={sup.bindingName}>{it.material_name}</span>
                  </div>
                  <span className={sup.bindingSku}>{it.supplier_sku ?? '—'}</span>
                  <span className={sup.bindingMeta}>{it.qty} ordered</span>
                  <span className={sup.bindingMeta}>{it.received_qty ?? 0} received</span>
                  <input
                    type="number"
                    min={0}
                    max={outstanding}
                    className={sup.fieldInput}
                    style={{ width: 80, textAlign: 'right' }}
                    value={qty}
                    onChange={(e) =>
                      setQtyMap((s) => ({ ...s, [it.id]: Math.max(0, Number(e.target.value) || 0) }))
                    }
                  />
                  <span />
                </div>
              );
            })}
          </div>

          <div className={sup.section}>
            <p className={sup.fieldLabel}>3. Header</p>
            <div className={sup.formGrid}>
              <Field label="Delivery Note Ref" value={deliveryNoteRef} onChange={setDeliveryNoteRef} placeholder="Supplier's DO #" />
              <Field label="Notes" value={notes} onChange={setNotes} multiline gridFull />
            </div>
          </div>
        </>
      )}
    </DrawerShell>
  );
};

/* ══════════════════════════════════════════════════════════════════════
   2. Purchase Invoice
   ══════════════════════════════════════════════════════════════════════ */

export const CreatePurchaseInvoiceDrawer = ({ onClose }: { onClose: () => void }) => {
  const suppliers = useSuppliers({ status: 'ACTIVE' });
  const [supplierId, setSupplierId] = useState<string | null>(null);
  const [supplierInvoiceRef, setSupplierInvoiceRef] = useState('');
  const [invoiceDate, setInvoiceDate] = useState(todayMyt());
  const [dueDate, setDueDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<Array<{ materialCode: string; materialName: string; qty: number; unitPriceCenti: number }>>([]);
  const create = useCreatePurchaseInvoice();

  const subtotal = items.reduce((s, i) => s + i.qty * i.unitPriceCenti, 0);

  const addLine = () => setItems([...items, { materialCode: '', materialName: '', qty: 1, unitPriceCenti: 0 }]);
  const remLine = (i: number) => setItems(items.filter((_, j) => j !== i));
  const upd = (i: number, k: string, v: unknown) =>
    setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));

  const submit = () => {
    if (!supplierId) return alert('Pick supplier.');
    const valid = items.filter((it) => it.materialCode && it.materialName && it.qty > 0);
    if (!valid.length) return alert('Add at least one item with code + name + qty.');
    create.mutate(
      {
        supplierId,
        supplierInvoiceRef: supplierInvoiceRef || undefined,
        invoiceDate,
        dueDate: dueDate || undefined,
        notes: notes || undefined,
        items: valid.map((it) => ({ ...it, materialKind: 'mfg_product' })),
      },
      { onSuccess: (res: any) => { alert(`Invoice created: ${res.invoiceNumber}`); onClose(); } },
    );
  };

  return (
    <DrawerShell
      title="New Purchase Invoice"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Create Invoice"
      submitting={create.isPending}
      canSubmit={Boolean(supplierId)}
    >
      <div className={sup.section}>
        <p className={sup.fieldLabel}>Supplier</p>
        <select
          className={sup.fieldSelect}
          value={supplierId ?? ''}
          onChange={(e) => setSupplierId(e.target.value || null)}
        >
          <option value="">— Select supplier —</option>
          {(suppliers.data ?? []).map((s: any) => (
            <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
          ))}
        </select>
      </div>

      <div className={sup.formGrid}>
        <Field label="Supplier's Invoice #" value={supplierInvoiceRef} onChange={setSupplierInvoiceRef} />
        <Field label="Invoice Date" type="date" value={invoiceDate} onChange={setInvoiceDate} />
        <Field label="Due Date" type="date" value={dueDate} onChange={setDueDate} />
        <Field label="Notes" value={notes} onChange={setNotes} multiline gridFull />
      </div>

      <div className={sup.section}>
        <p className={sup.fieldLabel}>Items</p>
        {items.map((it, i) => (
          <div key={i} className={sup.bindingRow}>
            <span className={sup.bindingIcon}>·</span>
            <input className={sup.fieldInput} placeholder="Material code" value={it.materialCode} onChange={(e) => upd(i, 'materialCode', e.target.value)} />
            <input className={sup.fieldInput} placeholder="Name" value={it.materialName} onChange={(e) => upd(i, 'materialName', e.target.value)} />
            <input type="number" className={sup.fieldInput} style={{ width: 80, textAlign: 'right' }} value={it.qty} onChange={(e) => upd(i, 'qty', Number(e.target.value) || 0)} />
            <MoneyInput bare valueSen={it.unitPriceCenti} onCommit={(sen) => upd(i, 'unitPriceCenti', sen ?? 0)} inputClassName={sup.fieldInput} style={{ width: 100 }} selectOnFocus />
            <span className={sup.bindingMeta}>{fmtMoney(it.qty * it.unitPriceCenti)}</span>
            <button type="button" className={sup.iconBtn} onClick={() => remLine(i)}><Trash2 {...ICON} /></button>
          </div>
        ))}
        <button type="button" className={sup.addBindingBtn} onClick={addLine}>+ Add Line Item</button>
        <p style={{ textAlign: 'right', fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-18)', color: 'var(--c-burnt)', fontWeight: 800 }}>
          Subtotal: {fmtMoney(subtotal)}
        </p>
      </div>
    </DrawerShell>
  );
};

/* ══════════════════════════════════════════════════════════════════════
   3. Mfg Sales Order — HOUZS pattern
   ══════════════════════════════════════════════════════════════════════ */

const SO_GROUPS = ['bedframe', 'sofa', 'mattress', 'accessory', 'others'] as const;
const SO_BRANDINGS = ['AKEMI', 'ZANOTTI', 'ERGOTEX', 'DUNLOPILLO', 'OTHER'] as const;

export const CreateSalesOrderDrawer = ({ onClose }: { onClose: () => void }) => {
  const [form, setForm] = useState({
    debtorCode: '', debtorName: '', agent: '', branding: '',
    venue: '', poDocNo: '', ref: '',
    address1: '', address2: '', address3: '', address4: '', phone: '',
    note: '',
  });
  const [items, setItems] = useState<Array<{
    itemGroup: string; itemCode: string; description: string;
    qty: number; unitPriceCenti: number; discountCenti: number; unitCostCenti: number;
  }>>([
    { itemGroup: 'bedframe', itemCode: '', description: '', qty: 1, unitPriceCenti: 0, discountCenti: 0, unitCostCenti: 0 },
  ]);
  const create = useCreateMfgSalesOrder();

  const upd = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  const updI = (i: number, k: string, v: unknown) =>
    setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const addLine = () => setItems([...items, { itemGroup: 'others', itemCode: '', description: '', qty: 1, unitPriceCenti: 0, discountCenti: 0, unitCostCenti: 0 }]);
  const remLine = (i: number) => setItems(items.filter((_, j) => j !== i));

  const subtotal = items.reduce((s, i) => s + (i.qty * i.unitPriceCenti - i.discountCenti), 0);

  const submit = () => {
    if (!form.debtorName.trim()) return alert('Debtor name required.');
    const valid = items.filter((it) => it.itemCode && it.qty > 0);
    if (!valid.length) return alert('Add at least one item with code + qty.');
    create.mutate(
      { ...form, items: valid },
      { onSuccess: (res: any) => { alert(`SO created: ${res.docNo}`); onClose(); } },
    );
  };

  return (
    <DrawerShell
      title="New Sales Order"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Create SO"
      submitting={create.isPending}
      canSubmit={Boolean(form.debtorName.trim())}
    >
      <div className={sup.section}>
        <p className={sup.fieldLabel}>Customer</p>
        <div className={sup.formGrid}>
          <Field label="Debtor Code" value={form.debtorCode} onChange={(v) => upd('debtorCode', v)} />
          <Field label="Debtor Name" value={form.debtorName} onChange={(v) => upd('debtorName', v)} required />
          <Field label="Agent" value={form.agent} onChange={(v) => upd('agent', v)} />
          <label className={sup.field}>
            <span className={sup.fieldLabel}>Branding</span>
            <select className={sup.fieldSelect} value={form.branding} onChange={(e) => upd('branding', e.target.value)}>
              <option value="">—</option>
              {SO_BRANDINGS.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          <Field label="Venue" value={form.venue} onChange={(v) => upd('venue', v)} />
          <Field label="Customer PO #" value={form.poDocNo} onChange={(v) => upd('poDocNo', v)} />
        </div>
      </div>

      <div className={sup.section}>
        <p className={sup.fieldLabel}>Delivery Address</p>
        <div className={sup.formGrid}>
          <Field label="Address 1" value={form.address1} onChange={(v) => upd('address1', v)} gridFull />
          <Field label="Address 2" value={form.address2} onChange={(v) => upd('address2', v)} gridFull />
          <Field label="Address 3" value={form.address3} onChange={(v) => upd('address3', v)} />
          <Field label="Address 4" value={form.address4} onChange={(v) => upd('address4', v)} />
          <Field label="Phone" value={form.phone} onChange={(v) => upd('phone', v)} />
          <Field label="Ref" value={form.ref} onChange={(v) => upd('ref', v)} />
        </div>
      </div>

      <div className={sup.section}>
        <p className={sup.fieldLabel}>Lines</p>
        {items.map((it, i) => (
          <div
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '110px 1fr 1fr 60px 90px 80px 40px',
              gap: 'var(--space-2)',
              alignItems: 'center',
              padding: 'var(--space-3)',
              background: 'var(--c-paper)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
            }}
          >
            <select
              className={sup.fieldSelect}
              value={it.itemGroup}
              onChange={(e) => updI(i, 'itemGroup', e.target.value)}
            >
              {SO_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
            </select>
            <input className={sup.fieldInput} placeholder="Item code" value={it.itemCode} onChange={(e) => updI(i, 'itemCode', e.target.value)} />
            <input className={sup.fieldInput} placeholder="Description" value={it.description} onChange={(e) => updI(i, 'description', e.target.value)} />
            <input type="number" min={1} className={sup.fieldInput} style={{ textAlign: 'right' }} value={it.qty} onChange={(e) => updI(i, 'qty', Number(e.target.value) || 1)} />
            <MoneyInput bare valueSen={it.unitPriceCenti} onCommit={(sen) => updI(i, 'unitPriceCenti', sen ?? 0)} inputClassName={sup.fieldInput} placeholder="unit" selectOnFocus />
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)', textAlign: 'right' }}>
              {fmtMoney(it.qty * it.unitPriceCenti - it.discountCenti)}
            </span>
            <button type="button" className={sup.iconBtn} onClick={() => remLine(i)}><Trash2 {...ICON} /></button>
          </div>
        ))}
        <button type="button" className={sup.addBindingBtn} onClick={addLine}>
          <Plus {...ICON} /> Add Line Item
        </button>
        <p style={{ textAlign: 'right', fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-20)', color: 'var(--c-burnt)', fontWeight: 800 }}>
          Subtotal: {fmtMoney(subtotal)}
        </p>
      </div>

      <div className={sup.section}>
        <Field label="Note" value={form.note} onChange={(v) => upd('note', v)} multiline />
      </div>
    </DrawerShell>
  );
};

/* ══════════════════════════════════════════════════════════════════════
   4. Delivery Order (mfg) — RETIRED 2026-05-29.
   CreateDeliveryOrderDrawer was replaced by the full Create-DO screen at
   src/pages/DeliveryOrderNew.tsx (route /mfg-delivery-orders/new), prefilled
   from an SO via "Issue Delivery Order" on the SO list. The
   useCreateMfgDeliveryOrder hook now backs that page.
   ══════════════════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════════════════
   5. Sales Invoice
   ══════════════════════════════════════════════════════════════════════ */

export const CreateSalesInvoiceDrawer = ({ onClose }: { onClose: () => void }) => {
  const dos = useMfgDeliveryOrders('DELIVERED');
  const dos2 = useMfgDeliveryOrders('SIGNED');
  const allDos = [...(dos.data?.deliveryOrders ?? []), ...(dos2.data?.deliveryOrders ?? [])];
  const [deliveryOrderId, setDeliveryOrderId] = useState<string | null>(null);
  const [form, setForm] = useState({
    debtorCode: '', debtorName: '', soDocNo: '',
    invoiceDate: todayMyt(),
    dueDate: '', notes: '',
  });
  const [items, setItems] = useState<Array<{ itemCode: string; description: string; qty: number; unitPriceCenti: number; discountCenti: number; taxCenti: number }>>([
    { itemCode: '', description: '', qty: 1, unitPriceCenti: 0, discountCenti: 0, taxCenti: 0 },
  ]);
  const create = useCreateSalesInvoice();

  const upd = (k: keyof typeof form, v: string) => setForm({ ...form, [k]: v });
  const updI = (i: number, k: string, v: unknown) =>
    setItems(items.map((it, j) => (j === i ? { ...it, [k]: v } : it)));
  const addLine = () => setItems([...items, { itemCode: '', description: '', qty: 1, unitPriceCenti: 0, discountCenti: 0, taxCenti: 0 }]);
  const remLine = (i: number) => setItems(items.filter((_, j) => j !== i));

  // Auto-fill from picked DO
  type DoLite = { id: string; debtor_code?: string; debtor_name?: string; so_doc_no?: string };
  const pickDo = (id: string) => {
    setDeliveryOrderId(id || null);
    if (id) {
      const d = (allDos as DoLite[]).find((x) => x.id === id);
      if (d) setForm((s) => ({ ...s, debtorCode: d.debtor_code ?? '', debtorName: d.debtor_name ?? '', soDocNo: d.so_doc_no ?? '' }));
    }
  };

  const subtotal = items.reduce((s, i) => s + (i.qty * i.unitPriceCenti - i.discountCenti + i.taxCenti), 0);

  const submit = () => {
    if (!form.debtorName.trim()) return alert('Debtor name required.');
    const valid = items.filter((it) => it.itemCode && it.qty > 0);
    if (!valid.length) return alert('Add at least one item.');
    create.mutate(
      {
        ...form,
        deliveryOrderId: deliveryOrderId ?? undefined,
        soDocNo: form.soDocNo || undefined,
        dueDate: form.dueDate || undefined,
        items: valid,
      },
      { onSuccess: (res: any) => { alert(`Invoice: ${res.invoiceNumber}`); onClose(); } },
    );
  };

  return (
    <DrawerShell
      title="New Sales Invoice"
      onClose={onClose}
      onSubmit={submit}
      submitLabel="Create Invoice"
      submitting={create.isPending}
      canSubmit={Boolean(form.debtorName.trim())}
    >
      <div className={sup.section}>
        <p className={sup.fieldLabel}>From DO (optional)</p>
        <select className={sup.fieldSelect} value={deliveryOrderId ?? ''} onChange={(e) => pickDo(e.target.value)}>
          <option value="">— Free entry —</option>
          {allDos.map((d: any) => (
            <option key={d.id} value={d.id}>{d.do_number} · {d.debtor_name}</option>
          ))}
        </select>
      </div>

      <div className={sup.formGrid}>
        <Field label="Debtor Code" value={form.debtorCode} onChange={(v) => upd('debtorCode', v)} />
        <Field label="Debtor Name" value={form.debtorName} onChange={(v) => upd('debtorName', v)} required />
        <Field label="SO #" value={form.soDocNo} onChange={(v) => upd('soDocNo', v)} />
        <Field label="Invoice Date" type="date" value={form.invoiceDate} onChange={(v) => upd('invoiceDate', v)} />
        <Field label="Due Date" type="date" value={form.dueDate} onChange={(v) => upd('dueDate', v)} />
      </div>

      <div className={sup.section}>
        <p className={sup.fieldLabel}>Lines</p>
        {items.map((it, i) => (
          <div key={i} className={sup.bindingRow}>
            <span className={sup.bindingIcon}>·</span>
            <input className={sup.fieldInput} placeholder="Item code" value={it.itemCode} onChange={(e) => updI(i, 'itemCode', e.target.value)} />
            <input className={sup.fieldInput} placeholder="Description" value={it.description} onChange={(e) => updI(i, 'description', e.target.value)} />
            <input type="number" min={1} className={sup.fieldInput} style={{ width: 60, textAlign: 'right' }} value={it.qty} onChange={(e) => updI(i, 'qty', Number(e.target.value) || 1)} />
            <MoneyInput bare valueSen={it.unitPriceCenti} onCommit={(sen) => updI(i, 'unitPriceCenti', sen ?? 0)} inputClassName={sup.fieldInput} style={{ width: 90 }} selectOnFocus />
            <span className={sup.bindingMeta}>{fmtMoney(it.qty * it.unitPriceCenti - it.discountCenti + it.taxCenti)}</span>
            <button type="button" className={sup.iconBtn} onClick={() => remLine(i)}><Trash2 {...ICON} /></button>
          </div>
        ))}
        <button type="button" className={sup.addBindingBtn} onClick={addLine}>+ Add Line Item</button>
        <p style={{ textAlign: 'right', fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-18)', color: 'var(--c-burnt)', fontWeight: 800 }}>
          Subtotal: {fmtMoney(subtotal)}
        </p>
      </div>

      <Field label="Notes" value={form.notes} onChange={(v) => upd('notes', v)} multiline />
    </DrawerShell>
  );
};

/* ══════════════════════════════════════════════════════════════════════
   7. Delivery Return — RETIRED 2026-05-29.
   The plain CreateDeliveryReturnDrawer was replaced by the DO-clone Delivery
   Return module: a "Convert From DO" picker (pages/DeliveryReturnFromDo.tsx)
   + a blank Create form (pages/DeliveryReturnNew.tsx) + an editable detail
   (pages/DeliveryReturnDetail.tsx), all wired in router.tsx.
   ══════════════════════════════════════════════════════════════════════ */
