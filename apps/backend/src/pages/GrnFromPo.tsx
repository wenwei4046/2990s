// ----------------------------------------------------------------------------
// GrnFromPo — multi-select PO LINE → GRN picker (PR — task #52, Commander
// 2026-05-27).
//
// Workflow mirrors PurchaseOrderFromSo: lists every outstanding PO line
// (qty - received_qty > 0) grouped by parent PO; commander ticks lines,
// optionally edits the pick qty (defaults to remaining), and hits Save.
// Server groups picks by purchase_order_id and emits one GRN per PO (since
// grns.purchase_order_id is a single FK). Each GRN is auto-posted →
// inventory IN movements + PO.received_qty rollup + PO status flip.
//
// Routing: /grns/from-po — full-page form so the chrome matches
// PurchaseOrderFromSo / GrnNew (back link, Save button, cards).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useOutstandingPoItems,
  useCreateGrnsFromPoItems,
  type OutstandingPoItem,
} from '../lib/suppliers-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

export const GrnFromPo = () => {
  const navigate = useNavigate();
  const itemsQ   = useOutstandingPoItems();
  const create   = useCreateGrnsFromPoItems();

  // Map<poItemId, { picked, qty }>
  const [picks, setPicks] = useState<Record<string, { picked: boolean; qty: number }>>({});

  // GRN Defaults — applied to every GRN emitted by this batch.
  const [receivedDate, setReceivedDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState<string>('');

  const items = itemsQ.data ?? [];

  // Group by PO doc no so the UI renders one card per PO.
  const grouped = useMemo(() => {
    const byDoc = new Map<string, { meta: OutstandingPoItem; lines: OutstandingPoItem[] }>();
    for (const it of items) {
      const cur = byDoc.get(it.poDocNo);
      if (cur) cur.lines.push(it);
      else byDoc.set(it.poDocNo, { meta: it, lines: [it] });
    }
    return [...byDoc.entries()].map(([docNo, { meta, lines }]) => ({ docNo, meta, lines }));
  }, [items]);

  const togglePick = (id: string, remaining: number) =>
    setPicks((s) => ({
      ...s,
      [id]: s[id]?.picked
        ? { picked: false, qty: 0 }
        : { picked: true, qty: s[id]?.qty || remaining },
    }));

  const setQty = (id: string, qty: number) =>
    setPicks((s) => ({ ...s, [id]: { picked: true, qty } }));

  const toggleAllInPo = (lines: OutstandingPoItem[], on: boolean) =>
    setPicks((s) => {
      const next = { ...s };
      for (const l of lines) next[l.poItemId] = on ? { picked: true, qty: l.remainingQty } : { picked: false, qty: 0 };
      return next;
    });

  const picked = Object.entries(picks).filter(([, v]) => v.picked && v.qty > 0);
  const pickedCount = picked.length;

  const onSave = () => {
    if (pickedCount === 0) { window.alert('Tick at least one PO line first.'); return; }
    if (!receivedDate)     { window.alert('Received Date is required.'); return; }
    const body = {
      picks: picked.map(([poItemId, v]) => ({ poItemId, qty: v.qty })),
      receivedDate,
      notes: notes || undefined,
    };
    create.mutate(body, {
      onSuccess: (res) => {
        const summary = res.created.map((g) => g.grnNumber).join(', ');
        window.alert(`Created ${res.total} GRN${res.total === 1 ? '' : 's'}: ${summary}\nInventory updated.`);
        navigate('/grns');
      },
      onError: (err) => window.alert(`Create failed: ${err instanceof Error ? err.message : String(err)}`),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/grns" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Goods Receipts</span>
          </Link>
          <h1 className={styles.title}>Create GRN from Purchase Orders</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/grns')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={create.isPending || pickedCount === 0 || !receivedDate}
          >
            <Save {...ICON} />
            {create.isPending
              ? 'Creating…'
              : pickedCount === 0
                ? 'Pick at least 1 line'
                : !receivedDate
                  ? 'Set received date'
                  : `Create GRNs (${pickedCount} line${pickedCount === 1 ? '' : 's'})`}
          </Button>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>GRN Defaults</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            Applied to every GRN created from this batch.
          </span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Received Date *</span>
              <input
                type="date"
                value={receivedDate}
                onChange={(e) => setReceivedDate(e.target.value)}
                className={styles.fieldInput}
                required
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Notes</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional — applies to every GRN"
                className={styles.fieldInput}
              />
            </label>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Outstanding PO Lines</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {itemsQ.isLoading ? 'Loading…'
              : items.length === 0 ? 'No outstanding lines — every PO line has already been received (or there are no outstanding POs).'
              : `${items.length} line${items.length === 1 ? '' : 's'} across ${grouped.length} PO${grouped.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {grouped.length === 0 && !itemsQ.isLoading && (
            <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>
              Once a PO is submitted with line items, the lines that still need to be received will show up here.
            </p>
          )}
          {grouped.map(({ docNo, meta, lines }) => {
            const allPicked = lines.every((l) => picks[l.poItemId]?.picked);
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
                      onChange={() => toggleAllInPo(lines, !allPicked)}
                    />
                    <strong>{docNo}</strong>
                  </label>
                  <span style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
                    {[meta.supplierName || meta.supplierCode, `PO ${meta.poDate}`, meta.expectedAt ? `Δ ${meta.expectedAt}` : null]
                      .filter(Boolean).join(' · ')}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '24px minmax(120px, 1fr) minmax(200px, 2fr) 70px 70px 70px 70px 110px',
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
                  <div style={{ textAlign: 'right' }}>Ordered</div>
                  <div style={{ textAlign: 'right' }}>Received</div>
                  <div style={{ textAlign: 'right' }}>Remaining</div>
                  <div style={{ textAlign: 'right' }}>Pick Qty</div>
                  <div style={{ textAlign: 'right' }}>Line Value</div>
                </div>

                {lines.map((l) => {
                  const p = picks[l.poItemId];
                  const on = Boolean(p?.picked);
                  const pickQty = on ? p!.qty : l.remainingQty;
                  return (
                    <div
                      key={l.poItemId}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '24px minmax(120px, 1fr) minmax(200px, 2fr) 70px 70px 70px 70px 110px',
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
                        onChange={() => togglePick(l.poItemId, l.remainingQty)}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{l.itemCode}</span>
                      <span style={{ fontSize: 'var(--fs-13)' }}>{l.description ?? '—'}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{l.qty}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>{l.receivedQty}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{l.remainingQty}</span>
                      <input
                        type="number"
                        min={0}
                        max={l.remainingQty}
                        value={on ? pickQty : ''}
                        placeholder={String(l.remainingQty)}
                        onChange={(e) => setQty(l.poItemId, Math.min(l.remainingQty, Math.max(0, Number(e.target.value) || 0)))}
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
