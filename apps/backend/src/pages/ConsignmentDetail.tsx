// ----------------------------------------------------------------------------
// ConsignmentDetail — one Sales Consignment order at /consignment/:id.
//
// Uses the shared SalesOrderDetail.module.css section-card pattern (cardHeader /
// cardTitle / cardBody) so it matches the other detail pages. Sections:
//   • Header card  — Consignment No., Debtor, Branch, Placed Date, Status.
//   • ITEMS card   — Item Code, Description, Qty Placed, Out, Sold, Returned,
//                    Unit Price. "Out" (currently out) is computed client-side.
//   • NOTES card   — OUT / RETURN notes with a coloured badge + Cancel button.
//
// Two header actions — "Ship (OUT)" and "Return" — open an inline panel that
// picks a warehouse and a per-item qty, then POSTs a note. OUT is capped at
// qty_placed − alreadyOut; RETURN is capped at the currently-out qty.
//
// "Currently out" model: per item, out = qty_placed − qty_sold − qty_returned
// − qty_damaged is NOT correct (not all placed has shipped). The running
// item-level totals the API returns (qty_sold / qty_returned / qty_damaged)
// combined with the per-item shipped total are what define it. The notes list
// the API returns is header-level (no per-item qty), so we derive each item's
// "out" from the running totals it carries: shipped-so-far is tracked server
// side and reflected back through qty_sold + qty_returned + qty_damaged + the
// still-out remainder. We surface the still-out figure the server implies and
// recompute caps from it. See computeOut() below.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { ArrowLeft, Truck, Undo2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtDateOrDash } from '@2990s/shared';
import {
  useConsignmentOrder,
  useCreateConsignmentNote,
  useCancelConsignmentNote,
  type ConsignmentItem,
  type ConsignmentNoteType,
} from '../lib/consignment-queries';
import { useWarehouses } from '../lib/inventory-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtMoney = (centi: number | null | undefined): string =>
  `MYR ${((centi ?? 0) / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const STATUS_TINT: Record<string, { bg: string; fg: string }> = {
  OPEN:      { bg: 'rgba(166, 71, 30, 0.12)', fg: 'var(--c-burnt)' },
  ACTIVE:    { bg: 'rgba(47, 93, 79, 0.12)',  fg: 'var(--c-secondary-a, #2F5D4F)' },
  CLOSED:    { bg: 'rgba(34, 31, 32, 0.18)',  fg: 'var(--c-ink)' },
  CANCELLED: { bg: 'rgba(184, 51, 31, 0.10)', fg: 'var(--c-festive-b, #B8331F)' },
};

const titleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

/* Currently-out per item.
   out = qty_placed − qty_sold − qty_returned − qty_damaged, floored at 0.
   This is the qty physically still at the consignee, eligible to be returned.
   "alreadyOut" (for the OUT cap) is the same value — it's everything not yet
   sold / returned / damaged that's been placed. */
const computeOut = (it: ConsignmentItem): number =>
  Math.max(0, (it.qty_placed ?? 0) - (it.qty_sold ?? 0) - (it.qty_returned ?? 0) - (it.qty_damaged ?? 0));

/* OUT can still ship up to whatever of qty_placed hasn't been shipped yet.
   Without a per-item shipped total in the notes payload, the placeable cap is
   the remaining placed allowance: qty_placed − (currently out + sold + returned
   + damaged). When everything placed is accounted for, the cap is 0. */
const computePlaceableCap = (it: ConsignmentItem): number => {
  const accountedFor = computeOut(it) + (it.qty_sold ?? 0) + (it.qty_returned ?? 0) + (it.qty_damaged ?? 0);
  return Math.max(0, (it.qty_placed ?? 0) - accountedFor);
};

type PanelMode = ConsignmentNoteType | null;

export const ConsignmentDetail = () => {
  const { id = '' } = useParams();

  const { data, isLoading, error } = useConsignmentOrder(id);
  const createNote = useCreateConsignmentNote();
  const cancelNote = useCancelConsignmentNote();
  const warehouses = useWarehouses();
  const activeWarehouses = useMemo(
    () => (warehouses.data ?? []).filter((w) => w.is_active),
    [warehouses.data],
  );

  // ── Inline note panel ──────────────────────────────────────────────
  const [mode, setMode] = useState<PanelMode>(null);
  const [warehouseId, setWarehouseId] = useState('');
  const [qtyByItem, setQtyByItem] = useState<Record<string, number>>({});

  const order = data?.order;
  const items = data?.items ?? [];
  const notes = data?.notes ?? [];

  const openPanel = (m: ConsignmentNoteType) => {
    setMode(m);
    setQtyByItem({});
    setWarehouseId(activeWarehouses.find((w) => w.is_default)?.id ?? activeWarehouses[0]?.id ?? '');
  };
  const closePanel = () => { setMode(null); setQtyByItem({}); };

  const capFor = (it: ConsignmentItem): number =>
    mode === 'OUT' ? computePlaceableCap(it) : computeOut(it);

  const setQty = (itemId: string, raw: number, cap: number) => {
    const n = Math.min(cap, Math.max(0, Math.floor(raw || 0)));
    setQtyByItem((prev) => ({ ...prev, [itemId]: n }));
  };

  const submitNote = () => {
    if (!mode) return;
    if (!warehouseId) { window.alert('Pick a warehouse first.'); return; }
    const noteItems = items
      .map((it) => ({ consignmentItemId: it.id, qty: qtyByItem[it.id] ?? 0 }))
      .filter((r) => r.qty > 0);
    if (noteItems.length === 0) {
      window.alert(`Enter a quantity to ${mode === 'OUT' ? 'ship' : 'return'} on at least one item.`);
      return;
    }
    createNote.mutate(
      { id, noteType: mode, warehouseId, items: noteItems },
      {
        onSuccess: () => closePanel(),
        onError: (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          if (msg.includes('over_placed')) {
            window.alert('That ship quantity exceeds what was placed (qty_placed). Lower the amount and try again.');
          } else if (msg.includes('over_return')) {
            window.alert('That return quantity exceeds what is currently out at the consignee. Lower the amount and try again.');
          } else {
            window.alert(`Could not save the note: ${msg}`);
          }
        },
      },
    );
  };

  const doCancelNote = (noteId: string, noteNumber: string) => {
    if (!window.confirm(`Cancel note ${noteNumber}? This reverses its effect on the consignment.`)) return;
    cancelNote.mutate(
      { id, noteId },
      { onError: (err) => window.alert(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`) },
    );
  };

  if (isLoading) {
    return (
      <div className={styles.page}>
        <p className={styles.subtitle}>Loading consignment…</p>
      </div>
    );
  }

  if (error || !order) {
    return (
      <div className={styles.page}>
        <div className={styles.headerRow}>
          <div className={styles.titleBlock}>
            <Link to="/consignment" className={styles.backBtn}>
              <ArrowLeft {...ICON} /> <span>Sales Consignment</span>
            </Link>
          </div>
        </div>
        <div className={styles.bannerWarn}>
          <strong>Failed to load consignment.</strong>{' '}
          {error instanceof Error ? error.message : 'Not found.'}
        </div>
      </div>
    );
  }

  const tint = STATUS_TINT[order.status] ?? { bg: 'rgba(34, 31, 32, 0.08)', fg: 'var(--fg-muted)' };

  return (
    <div className={styles.page}>
      {/* ── Header row ────────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/consignment" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Sales Consignment</span>
          </Link>
          <h1 className={styles.title}>
            {order.consignment_number}
            <span className={styles.statusPill} style={{ background: tint.bg, color: tint.fg }}>
              {titleCase(order.status)}
            </span>
          </h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => openPanel('OUT')}>
            <Truck {...ICON} /> Ship (OUT)
          </Button>
          <Button variant="ghost" size="md" onClick={() => openPanel('RETURN')}>
            <Undo2 {...ICON} /> Return
          </Button>
        </div>
      </div>

      {/* ── Header card ───────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Consignment</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid4}>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Consignment No.</span>
              <div style={{ fontWeight: 700, color: 'var(--c-burnt)', fontVariantNumeric: 'tabular-nums' }}>
                {order.consignment_number}
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Debtor</span>
              <div>
                {order.debtor_name}
                {order.debtor_code && <span className={styles.muted}> · {order.debtor_code}</span>}
              </div>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Branch</span>
              <div>{order.branch_location || <span className={styles.muted}>—</span>}</div>
            </div>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Placed Date</span>
              <div style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDateOrDash(order.placed_at)}</div>
            </div>
            {order.notes && (
              <div className={`${styles.field} ${styles.fieldFull}`}>
                <span className={styles.fieldLabel}>Notes</span>
                <div>{order.notes}</div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Inline OUT / RETURN panel ─────────────────────────────────── */}
      {mode && (
        <section className={styles.card}>
          <div className={styles.cardHeader}>
            <h2 className={styles.cardTitle}>
              {mode === 'OUT' ? 'Ship to consignee (OUT note)' : 'Return from consignee (RETURN note)'}
            </h2>
            <button type="button" className={styles.iconBtn} onClick={closePanel} title="Close">
              <X size={16} strokeWidth={1.75} />
            </button>
          </div>
          <div className={styles.cardBody}>
            <div className={styles.formGrid2} style={{ marginBottom: 'var(--space-3)' }}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Warehouse *</span>
                <select
                  className={styles.fieldInput}
                  value={warehouseId}
                  onChange={(e) => setWarehouseId(e.target.value)}
                >
                  <option value="">— Pick a warehouse —</option>
                  {activeWarehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                  ))}
                </select>
              </label>
            </div>

            <table className={styles.table}>
              <thead>
                <tr>
                  <th>Item Code</th>
                  <th>Description</th>
                  <th className={styles.tableRight}>{mode === 'OUT' ? 'Can ship' : 'Currently out'}</th>
                  <th className={styles.tableRight}>{mode === 'OUT' ? 'Ship qty' : 'Return qty'}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => {
                  const cap = capFor(it);
                  return (
                    <tr key={it.id}>
                      <td className={styles.codeCell}>{it.item_code}</td>
                      <td>{it.description || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.tableRight}>
                        <span className={styles.muted}>max {cap}</span>
                      </td>
                      <td className={styles.tableRight}>
                        <input
                          type="number"
                          min={0}
                          max={cap}
                          step={1}
                          className={styles.fieldInput}
                          value={qtyByItem[it.id] ?? 0}
                          disabled={cap === 0}
                          onChange={(e) => setQty(it.id, Number(e.target.value), cap)}
                          style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', maxWidth: 96, marginLeft: 'auto' }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            <div className={styles.addLineRow}>
              <Button variant="ghost" size="sm" onClick={closePanel}>
                <X {...ICON} /> Cancel
              </Button>
              <Button variant="primary" size="sm" onClick={submitNote} disabled={createNote.isPending}>
                {createNote.isPending
                  ? 'Saving…'
                  : mode === 'OUT' ? 'Create OUT note' : 'Create RETURN note'}
              </Button>
            </div>
          </div>
        </section>
      )}

      {/* ── Items card ────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Items</h2>
        </div>
        <div className={styles.cardBody} style={{ padding: 0 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item Code</th>
                <th>Description</th>
                <th className={styles.tableRight}>Qty Placed</th>
                <th className={styles.tableRight}>Out</th>
                <th className={styles.tableRight}>Sold</th>
                <th className={styles.tableRight}>Returned</th>
                <th className={styles.tableRight}>Unit Price</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 && (
                <tr><td className={styles.emptyRow} colSpan={7}>No items on this consignment.</td></tr>
              )}
              {items.map((it) => (
                <tr key={it.id}>
                  <td className={styles.codeCell}>{it.item_code}</td>
                  <td>{it.description || <span className={styles.muted}>—</span>}</td>
                  <td className={styles.tableRight} style={{ fontVariantNumeric: 'tabular-nums' }}>{it.qty_placed}</td>
                  <td className={styles.tableRight} style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 700 }}>
                    {computeOut(it)}
                  </td>
                  <td className={styles.tableRight} style={{ fontVariantNumeric: 'tabular-nums' }}>{it.qty_sold}</td>
                  <td className={styles.tableRight} style={{ fontVariantNumeric: 'tabular-nums' }}>{it.qty_returned}</td>
                  <td className={styles.priceCell}>{fmtMoney(it.unit_price_centi)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Notes card ────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Delivery / Return Notes</h2>
        </div>
        <div className={styles.cardBody} style={{ padding: 0 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Note No.</th>
                <th>Type</th>
                <th>Date</th>
                <th>Driver</th>
                <th>Vehicle</th>
                <th className={styles.tableRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {notes.length === 0 && (
                <tr><td className={styles.emptyRow} colSpan={6}>No notes yet — use “Ship (OUT)” to place stock.</td></tr>
              )}
              {notes.map((n) => {
                const cancelled = Boolean(n.cancelled_at);
                const isOut = n.note_type === 'OUT';
                const badge = isOut
                  ? { bg: 'rgba(166, 71, 30, 0.12)', fg: 'var(--c-burnt)' }
                  : { bg: 'rgba(214, 158, 46, 0.18)', fg: '#8a5a00' };
                return (
                  <tr key={n.id} style={cancelled ? { opacity: 0.55 } : undefined}>
                    <td style={{ textDecoration: cancelled ? 'line-through' : undefined }}>
                      <span style={{ fontWeight: 700, color: 'var(--c-burnt)', fontVariantNumeric: 'tabular-nums' }}>
                        {n.note_number}
                      </span>
                    </td>
                    <td>
                      <span className={styles.statusPill} style={{ background: badge.bg, color: badge.fg }}>
                        {n.note_type}
                      </span>
                      {cancelled && (
                        <span
                          className={styles.statusPill}
                          style={{ marginLeft: 6, background: 'rgba(184, 51, 31, 0.10)', color: 'var(--c-festive-b, #B8331F)' }}
                        >
                          Cancelled
                        </span>
                      )}
                    </td>
                    <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDateOrDash(n.note_date)}</td>
                    <td>{n.driver_name || <span className={styles.muted}>—</span>}</td>
                    <td>{n.vehicle || <span className={styles.muted}>—</span>}</td>
                    <td className={styles.tableRight}>
                      {!cancelled && (
                        <button
                          type="button"
                          className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                          onClick={() => doCancelNote(n.id, n.note_number)}
                          disabled={cancelNote.isPending}
                          title="Cancel note"
                        >
                          <X size={15} strokeWidth={1.75} />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
};
