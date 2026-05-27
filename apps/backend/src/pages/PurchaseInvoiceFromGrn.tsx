// ----------------------------------------------------------------------------
// PurchaseInvoiceFromGrn — multi-select GRN LINE → PI picker (PR — task #52,
// Commander 2026-05-27).
//
// Mirrors GrnFromPo but for GRN→PI: lists every accepted GRN line on
// POSTED GRNs that have NOT yet been invoiced (header-level dedupe per
// MVP — see /purchase-invoices/outstanding-grn-items handler for the
// trade-off note). Server groups picks by grn_id (PI has single grn_id
// FK) and emits one PI per GRN, auto-posted.
//
// PI does NOT touch inventory (PI is AP-only — inventory landed at GRN
// time). The trade-off this surfaces: if a GRN is partially invoiced
// today, the remaining lines won't show until grn_items gets an
// invoiced_qty column. Track as follow-up if/when needed.
//
// Routing: /purchase-invoices/from-grn — full-page form so the chrome
// matches GrnFromPo / PurchaseInvoiceNew.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useOutstandingGrnItems,
  useCreatePisFromGrnItems,
  type OutstandingGrnItem,
} from '../lib/suppliers-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

export const PurchaseInvoiceFromGrn = () => {
  const navigate = useNavigate();
  const itemsQ   = useOutstandingGrnItems();
  const create   = useCreatePisFromGrnItems();

  const [picks, setPicks] = useState<Record<string, { picked: boolean; qty: number }>>({});

  // PI Defaults applied to every emitted PI.
  const [supplierInvoiceNumber, setSupplierInvoiceNumber] = useState<string>('');
  const [invoiceDate, setInvoiceDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  const items = itemsQ.data ?? [];

  // Group by GRN doc no so the UI renders one card per GRN.
  const grouped = useMemo(() => {
    const byDoc = new Map<string, { meta: OutstandingGrnItem; lines: OutstandingGrnItem[] }>();
    for (const it of items) {
      const cur = byDoc.get(it.grnDocNo);
      if (cur) cur.lines.push(it);
      else byDoc.set(it.grnDocNo, { meta: it, lines: [it] });
    }
    return [...byDoc.entries()].map(([docNo, { meta, lines }]) => ({ docNo, meta, lines }));
  }, [items]);

  const togglePick = (id: string, accepted: number) =>
    setPicks((s) => ({
      ...s,
      [id]: s[id]?.picked
        ? { picked: false, qty: 0 }
        : { picked: true, qty: s[id]?.qty || accepted },
    }));

  const setQty = (id: string, qty: number) =>
    setPicks((s) => ({ ...s, [id]: { picked: true, qty } }));

  const toggleAllInGrn = (lines: OutstandingGrnItem[], on: boolean) =>
    setPicks((s) => {
      const next = { ...s };
      for (const l of lines) next[l.grnItemId] = on ? { picked: true, qty: l.qtyAccepted } : { picked: false, qty: 0 };
      return next;
    });

  const picked = Object.entries(picks).filter(([, v]) => v.picked && v.qty > 0);
  const pickedCount = picked.length;

  const onSave = () => {
    if (pickedCount === 0) { window.alert('Tick at least one GRN line first.'); return; }
    if (!invoiceDate) { window.alert('Invoice Date is required.'); return; }
    const body = {
      picks: picked.map(([grnItemId, v]) => ({ grnItemId, qty: v.qty })),
      supplierInvoiceNumber: supplierInvoiceNumber || undefined,
      invoiceDate,
      dueDate: dueDate || undefined,
      notes: notes || undefined,
    };
    create.mutate(body, {
      onSuccess: (res) => {
        const summary = res.created.map((p) => p.invoiceNumber).join(', ');
        window.alert(`Created ${res.total} PI${res.total === 1 ? '' : 's'}: ${summary}`);
        navigate('/purchase-invoices');
      },
      onError: (err) => window.alert(`Create failed: ${err instanceof Error ? err.message : String(err)}`),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-invoices" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Purchase Invoices</span>
          </Link>
          <h1 className={styles.title}>Create Purchase Invoice from GRNs</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase-invoices')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={create.isPending || pickedCount === 0 || !invoiceDate}
          >
            <Save {...ICON} />
            {create.isPending
              ? 'Creating…'
              : pickedCount === 0
                ? 'Pick at least 1 line'
                : !invoiceDate
                  ? 'Set invoice date'
                  : `Create PIs (${pickedCount} line${pickedCount === 1 ? '' : 's'})`}
          </Button>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>PI Defaults</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            Applied to every PI created from this batch.
          </span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier Invoice #</span>
              <input
                type="text"
                value={supplierInvoiceNumber}
                onChange={(e) => setSupplierInvoiceNumber(e.target.value)}
                placeholder="From the supplier's printed invoice (optional)"
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Invoice Date *</span>
              <input
                type="date"
                value={invoiceDate}
                onChange={(e) => setInvoiceDate(e.target.value)}
                className={styles.fieldInput}
                required
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Due Date</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Notes</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional — applies to every PI"
                className={styles.fieldInput}
              />
            </label>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Outstanding GRN Lines</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {itemsQ.isLoading ? 'Loading…'
              : items.length === 0 ? 'No outstanding lines — every posted GRN has already been invoiced.'
              : `${items.length} line${items.length === 1 ? '' : 's'} across ${grouped.length} GRN${grouped.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {grouped.length === 0 && !itemsQ.isLoading && (
            <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>
              Once a GRN is posted (and not yet invoiced), its accepted lines will show up here.
            </p>
          )}
          {grouped.map(({ docNo, meta, lines }) => {
            const allPicked = lines.every((l) => picks[l.grnItemId]?.picked);
            return (
              <div key={docNo} style={{
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-md)',
                background: 'var(--c-paper)',
                padding: 'var(--space-3) var(--space-4)',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={allPicked}
                      onChange={() => toggleAllInGrn(lines, !allPicked)}
                    />
                    <strong>{docNo}</strong>
                  </label>
                  <span style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
                    {[meta.supplierName || meta.supplierCode,
                      meta.poDocNo ? `PO ${meta.poDocNo}` : null,
                      `Received ${meta.receivedAt}`,
                    ].filter(Boolean).join(' · ')}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '24px minmax(120px, 1fr) minmax(200px, 2fr) 80px 80px 110px',
                  gap: 'var(--space-2)',
                  alignItems: 'center',
                  fontSize: 'var(--fs-12)',
                  fontFamily: 'var(--font-button)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.08em',
                  color: 'var(--fg-soft)',
                  padding: 'var(--space-2) 0',
                  borderBottom: '1px solid var(--line)',
                }}>
                  <div></div>
                  <div>Item Code</div>
                  <div>Description</div>
                  <div style={{ textAlign: 'right' }}>Accepted</div>
                  <div style={{ textAlign: 'right' }}>Pick Qty</div>
                  <div style={{ textAlign: 'right' }}>Line Value</div>
                </div>

                {lines.map((l) => {
                  const p = picks[l.grnItemId];
                  const on = Boolean(p?.picked);
                  const pickQty = on ? p!.qty : l.qtyAccepted;
                  return (
                    <div
                      key={l.grnItemId}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '24px minmax(120px, 1fr) minmax(200px, 2fr) 80px 80px 110px',
                        gap: 'var(--space-2)',
                        alignItems: 'center',
                        padding: 'var(--space-2) 0',
                        borderBottom: '1px solid var(--line)',
                        background: on ? 'rgba(213, 90, 40, 0.04)' : 'transparent',
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        onChange={() => togglePick(l.grnItemId, l.qtyAccepted)}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{l.itemCode}</span>
                      <span style={{ fontSize: 'var(--fs-13)' }}>{l.description ?? '—'}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{l.qtyAccepted}</span>
                      <input
                        type="number"
                        min={0}
                        max={l.qtyAccepted}
                        value={on ? pickQty : ''}
                        placeholder={String(l.qtyAccepted)}
                        onChange={(e) => setQty(l.grnItemId, Math.min(l.qtyAccepted, Math.max(0, Number(e.target.value) || 0)))}
                        disabled={!on}
                        className={styles.fieldInput}
                        style={{ textAlign: 'right', padding: '4px 6px', fontSize: 'var(--fs-13)' }}
                      />
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-12)' }}>
                        {fmtRm(pickQty * l.unitPriceCenti)}
                      </span>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
};
