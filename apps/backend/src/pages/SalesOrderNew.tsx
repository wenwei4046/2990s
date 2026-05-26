// ----------------------------------------------------------------------------
// SalesOrderNew — full-page Create SO at /mfg-sales-orders/new (PR #106).
//
// Commander 2026-05-26: "我是要直接整个一个 Full 的界面" — the old side-
// drawer is replaced by a full-page form modelled after PurchaseOrderNew
// (PR #103, AutoCount parity). This is PR 1 of a 3-PR rebuild:
//
//   PR 1 (this) — Move the existing CreateSalesOrderDrawer field set into a
//                 dedicated route. Layout mirrors PurchaseOrderNew. No new
//                 fields, no new line-item shape — just relocate.
//   PR 2        — Order Details card per POS pattern (Customer dropdown,
//                 Delivery Hub, Customer PO No / SO No, Reference, SO Date,
//                 Customer Delivery Date, Notes).
//   PR 3        — Line Items per HOOKKA pattern (Product picker + Size +
//                 Fabric + Qty + Base Price + Gap + Divan / Leg / Total
//                 Height + Special Orders dropdown + custom items + Notes).
//
// CreateSalesOrderDrawer in FlowDrawers.tsx is left in place (unused) until
// PR 2 lands and we can delete it confidently.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useCreateMfgSalesOrder } from '../lib/flow-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const SO_GROUPS    = ['bedframe', 'sofa', 'mattress', 'accessory', 'others'] as const;
const SO_BRANDINGS = ['AKEMI', 'ZANOTTI', 'ERGOTEX', 'DUNLOPILLO', 'OTHER'] as const;

type DraftLine = {
  rid: string;
  itemGroup:       (typeof SO_GROUPS)[number];
  itemCode:        string;
  description:     string;
  qty:             number;
  unitPriceCenti:  number;
  discountCenti:   number;
  unitCostCenti:   number;
};

const newLine = (group: (typeof SO_GROUPS)[number] = 'bedframe'): DraftLine => ({
  rid: `l${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  itemGroup: group, itemCode: '', description: '',
  qty: 1, unitPriceCenti: 0, discountCenti: 0, unitCostCenti: 0,
});

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

export const SalesOrderNew = () => {
  const navigate = useNavigate();
  const create   = useCreateMfgSalesOrder();

  // ── Header state ────────────────────────────────────────────────────
  const [debtorCode, setDebtorCode] = useState('');
  const [debtorName, setDebtorName] = useState('');
  const [agent,      setAgent]      = useState('');
  const [branding,   setBranding]   = useState('');
  const [venue,      setVenue]      = useState('');
  const [poDocNo,    setPoDocNo]    = useState('');
  const [ref,        setRef]        = useState('');
  const [address1,   setAddress1]   = useState('');
  const [address2,   setAddress2]   = useState('');
  const [address3,   setAddress3]   = useState('');
  const [address4,   setAddress4]   = useState('');
  const [phone,      setPhone]      = useState('');
  const [note,       setNote]       = useState('');

  // ── Items state ─────────────────────────────────────────────────────
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);

  const setLine  = (rid: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const addLine  = () => setLines((prev) => [...prev, newLine('others')]);
  const dropLine = (rid: string) => setLines((prev) =>
    prev.length === 1 ? [newLine()] : prev.filter((l) => l.rid !== rid),
  );

  const subtotalCenti = useMemo(
    () => lines.reduce(
      (s, l) => s + Math.max(0, l.qty * l.unitPriceCenti - l.discountCenti),
      0,
    ),
    [lines],
  );

  const canSave = debtorName.trim().length > 0;

  const onSave = () => {
    if (!canSave) {
      window.alert('Debtor name is required.');
      return;
    }
    const validLines = lines.filter((l) => l.itemCode.trim() && l.qty > 0);
    if (validLines.length === 0) {
      window.alert('Add at least one item with code + qty.');
      return;
    }

    create.mutate(
      {
        debtorCode, debtorName, agent, branding,
        venue, poDocNo, ref,
        address1, address2, address3, address4, phone, note,
        items: validLines.map((l) => ({
          itemGroup:      l.itemGroup,
          itemCode:       l.itemCode,
          description:    l.description,
          qty:            l.qty,
          unitPriceCenti: l.unitPriceCenti,
          discountCenti:  l.discountCenti,
          unitCostCenti:  l.unitCostCenti,
        })),
      },
      {
        onSuccess: (res: { docNo: string }) => navigate(`/mfg-sales-orders/${res.docNo}`),
        onError:   (err) => window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  // Items grid template — keeps header + body in lockstep without a fresh
  // CSS module file just for this one table. Matches the PurchaseOrderNew
  // pattern.
  const gridTemplate = '110px minmax(160px, 1.2fr) minmax(180px, 1.6fr) 70px 110px 120px 32px';
  const cellPad = 'var(--space-2) var(--space-2)';

  return (
    <div className={styles.page}>
      {/* Top bar */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/mfg-sales-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Sales Orders</span>
          </Link>
          <h1 className={styles.title}>New Sales Order</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/mfg-sales-orders')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={create.isPending || !canSave}
          >
            <Save {...ICON} />
            {create.isPending ? 'Saving…' : 'Save SO (Draft)'}
          </Button>
        </div>
      </div>

      {/* Customer card */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Customer</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Debtor Code</span>
              <input type="text" value={debtorCode} onChange={(e) => setDebtorCode(e.target.value)} className={styles.fieldInput} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Debtor Name *</span>
              <input type="text" value={debtorName} onChange={(e) => setDebtorName(e.target.value)} className={styles.fieldInput} required />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Agent</span>
              <input type="text" value={agent} onChange={(e) => setAgent(e.target.value)} className={styles.fieldInput} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Branding</span>
              <select value={branding} onChange={(e) => setBranding(e.target.value)} className={styles.fieldInput}>
                <option value="">—</option>
                {SO_BRANDINGS.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Venue</span>
              <input type="text" value={venue} onChange={(e) => setVenue(e.target.value)} className={styles.fieldInput} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer PO #</span>
              <input type="text" value={poDocNo} onChange={(e) => setPoDocNo(e.target.value)} className={styles.fieldInput} />
            </label>
          </div>
        </div>
      </section>

      {/* Delivery address card */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Delivery Address</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
              <span className={styles.fieldLabel}>Address 1</span>
              <input type="text" value={address1} onChange={(e) => setAddress1(e.target.value)} className={styles.fieldInput} />
            </label>
            <label className={styles.field} style={{ gridColumn: '1 / -1' }}>
              <span className={styles.fieldLabel}>Address 2</span>
              <input type="text" value={address2} onChange={(e) => setAddress2(e.target.value)} className={styles.fieldInput} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Address 3</span>
              <input type="text" value={address3} onChange={(e) => setAddress3(e.target.value)} className={styles.fieldInput} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Address 4</span>
              <input type="text" value={address4} onChange={(e) => setAddress4(e.target.value)} className={styles.fieldInput} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Phone</span>
              <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className={styles.fieldInput} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Ref</span>
              <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} className={styles.fieldInput} />
            </label>
          </div>
        </div>
      </section>

      {/* Items card */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Lines</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {lines.length} line{lines.length === 1 ? '' : 's'} · subtotal {fmtRm(subtotalCenti)}
          </span>
        </div>
        <div className={styles.cardBody}>
          {/* Header row */}
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
            <div>Group</div>
            <div>Item Code</div>
            <div>Description</div>
            <div style={{ textAlign: 'right' }}>Qty</div>
            <div style={{ textAlign: 'right' }}>Unit Price</div>
            <div style={{ textAlign: 'right' }}>Total</div>
            <div></div>
          </div>

          {/* Body rows */}
          {lines.map((l) => {
            const lineTotalCenti = Math.max(0, l.qty * l.unitPriceCenti - l.discountCenti);
            return (
              <div
                key={l.rid}
                style={{
                  display: 'grid',
                  gridTemplateColumns: gridTemplate,
                  gap: 'var(--space-2)',
                  padding: cellPad,
                  alignItems: 'center',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <select
                  value={l.itemGroup}
                  onChange={(e) => setLine(l.rid, { itemGroup: e.target.value as DraftLine['itemGroup'] })}
                  className={styles.fieldInput}
                >
                  {SO_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="Item code"
                  value={l.itemCode}
                  onChange={(e) => setLine(l.rid, { itemCode: e.target.value })}
                  className={styles.fieldInput}
                />
                <input
                  type="text"
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => setLine(l.rid, { description: e.target.value })}
                  className={styles.fieldInput}
                />
                <input
                  type="number"
                  min={1}
                  value={l.qty}
                  onChange={(e) => setLine(l.rid, { qty: Number(e.target.value) || 1 })}
                  className={styles.fieldInput}
                  style={{ textAlign: 'right' }}
                />
                <input
                  type="number"
                  step="0.01"
                  value={(l.unitPriceCenti / 100).toFixed(2)}
                  onChange={(e) => setLine(l.rid, { unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0 })}
                  className={styles.fieldInput}
                  style={{ textAlign: 'right' }}
                />
                <div style={{
                  textAlign: 'right',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-13)',
                }}>
                  {fmtRm(lineTotalCenti)}
                </div>
                <button
                  type="button"
                  onClick={() => dropLine(l.rid)}
                  title="Remove line"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--fg-muted)',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <Trash2 {...ICON} />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addLine}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 'var(--space-3)',
              padding: '8px 12px',
              background: 'transparent',
              border: '1px dashed var(--c-orange)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--c-orange)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus {...ICON} /> Add line
          </button>

          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 'var(--space-4)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--line)',
            fontFamily: 'var(--font-mark)',
            fontSize: 'var(--fs-20)',
            fontWeight: 800,
            color: 'var(--c-burnt)',
          }}>
            Subtotal: {fmtRm(subtotalCenti)}
          </div>
        </div>
      </section>

      {/* Note card */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Note</h2>
        </div>
        <div className={styles.cardBody}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Internal notes — visible on the SO detail page only"
            className={styles.fieldInput}
            rows={3}
            style={{ minHeight: 80, resize: 'vertical', width: '100%' }}
          />
        </div>
      </section>
    </div>
  );
};
