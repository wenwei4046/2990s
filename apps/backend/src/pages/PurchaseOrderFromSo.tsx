// ----------------------------------------------------------------------------
// PurchaseOrderFromSo — multi-select SO → PO picker (PR — Commander
// 2026-05-26).
//
// Commander: "1 个 SO 部分转 + 多 SO 合并 — 两者都要". Lists every SO line
// with qty - po_qty_picked > 0; commander toggles checkboxes per line,
// optionally edits the qty to convert (defaults to remaining), then hits
// "Create POs". Server groups by main supplier and emits one PO per
// supplier.
//
// Routing: /purchase-orders/from-so — modelled after PurchaseOrderNew so
// the chrome (back link, Save button, cards) is consistent.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useOutstandingSoItems,
  useCreatePosFromSoItems,
  type OutstandingSoItem,
} from '../lib/suppliers-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

export const PurchaseOrderFromSo = () => {
  const navigate = useNavigate();
  const itemsQ   = useOutstandingSoItems();
  const create   = useCreatePosFromSoItems();

  // Map<soItemId, { picked: boolean, qty: number }>
  // Defaults: picked = false. When commander ticks, qty = remainingQty.
  const [picks, setPicks] = useState<Record<string, { picked: boolean; qty: number }>>({});

  const items = itemsQ.data ?? [];

  // Group by soDocNo so the UI shows each SO as a card containing its lines.
  const grouped = useMemo(() => {
    const byDoc = new Map<string, { meta: OutstandingSoItem; lines: OutstandingSoItem[] }>();
    for (const it of items) {
      const cur = byDoc.get(it.soDocNo);
      if (cur) cur.lines.push(it);
      else byDoc.set(it.soDocNo, { meta: it, lines: [it] });
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

  const toggleAllInSo = (lines: OutstandingSoItem[], on: boolean) =>
    setPicks((s) => {
      const next = { ...s };
      for (const l of lines) next[l.soItemId] = on ? { picked: true, qty: l.remainingQty } : { picked: false, qty: 0 };
      return next;
    });

  const picked = Object.entries(picks).filter(([, v]) => v.picked && v.qty > 0);
  const pickedCount = picked.length;

  const onSave = () => {
    if (pickedCount === 0) { window.alert('Tick at least one SO line first.'); return; }
    const body = picked.map(([soItemId, v]) => ({ soItemId, qty: v.qty }));
    create.mutate(body, {
      onSuccess: (res) => {
        const summary = res.created.map((p) => p.poNumber).join(', ');
        window.alert(`Created ${res.total} PO${res.total === 1 ? '' : 's'}: ${summary}`);
        // Land on the list so commander can drill into any of the new POs.
        navigate('/purchase-orders');
      },
      onError: (err) => window.alert(`Create failed: ${err instanceof Error ? err.message : String(err)}`),
    });
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Purchase Orders</span>
          </Link>
          <h1 className={styles.title}>Create PO from Sales Orders</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/purchase-orders')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={create.isPending || pickedCount === 0}
          >
            <Save {...ICON} />
            {create.isPending
              ? 'Creating…'
              : pickedCount === 0
                ? 'Pick at least 1 line'
                : `Create POs (${pickedCount} line${pickedCount === 1 ? '' : 's'})`}
          </Button>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Outstanding SO Lines</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {itemsQ.isLoading ? 'Loading…'
              : items.length === 0 ? 'No outstanding lines — every SO line has already been converted (or there are no SOs).'
              : `${items.length} line${items.length === 1 ? '' : 's'} across ${grouped.length} SO${grouped.length === 1 ? '' : 's'}`}
          </span>
        </div>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {grouped.length === 0 && !itemsQ.isLoading && (
            <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>
              Once you create a Sales Order with line items, the lines that still need to be sourced will show up here.
            </p>
          )}
          {grouped.map(({ docNo, meta, lines }) => {
            const allPicked = lines.every((l) => picks[l.soItemId]?.picked);
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
                      onChange={() => toggleAllInSo(lines, !allPicked)}
                    />
                    <strong>{docNo}</strong>
                  </label>
                  <span style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
                    {[meta.debtorName, meta.branding, meta.soStatus, meta.deliveryDate ? `· Δ ${meta.deliveryDate}` : null].filter(Boolean).join(' · ')}
                  </span>
                </div>

                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '24px minmax(120px, 1fr) minmax(200px, 2fr) 70px 70px 70px 110px',
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
                  <div style={{ textAlign: 'right' }}>SO Qty</div>
                  <div style={{ textAlign: 'right' }}>Done</div>
                  <div style={{ textAlign: 'right' }}>Pick Qty</div>
                  <div style={{ textAlign: 'right' }}>Line Value</div>
                </div>

                {lines.map((l) => {
                  const p = picks[l.soItemId];
                  const on = Boolean(p?.picked);
                  const pickQty = on ? p!.qty : l.remainingQty;
                  return (
                    <div
                      key={l.soItemId}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '24px minmax(120px, 1fr) minmax(200px, 2fr) 70px 70px 70px 110px',
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
                        onChange={() => togglePick(l.soItemId, l.remainingQty)}
                      />
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{l.itemCode}</span>
                      <span style={{ fontSize: 'var(--fs-13)' }}>{l.description ?? '—'}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>{l.qty}</span>
                      <span style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>{l.poQtyPicked}</span>
                      <input
                        type="number"
                        min={0}
                        max={l.remainingQty}
                        value={on ? pickQty : ''}
                        placeholder={String(l.remainingQty)}
                        onChange={(e) => setQty(l.soItemId, Math.min(l.remainingQty, Math.max(0, Number(e.target.value) || 0)))}
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
