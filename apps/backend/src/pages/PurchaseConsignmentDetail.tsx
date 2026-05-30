// ----------------------------------------------------------------------------
// PurchaseConsignmentDetail — buyer-side mirror of ConsignmentDetail.
//
// Cloned from apps/backend/src/pages/DocDetailPages.tsx → ConsignmentDetail
// (header + items + notes panel with per-note Post / Cancel + lock banner
// when has_children). Adapted to the PC endpoints + naming:
//   • IN  note → supplier delivers to your warehouse (inventory IN)
//   • RETURN note → you ship back to supplier         (inventory OUT)
// The note-add UI lets the user pick IN or RETURN.
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft, X, CheckCircle2, AlertCircle, Undo2, Plus, PackageCheck,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { LoadingButton } from '../components/LoadingButton';
import {
  usePurchaseConsignmentDetail,
  useAddPurchaseConsignmentNote,
  usePostPurchaseConsignmentNote,
  useCancelPurchaseConsignmentNote,
} from '../lib/flow-queries';
import styles from './DocDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null, currency = 'MYR'): string => {
  if (centi == null) return '—';
  return `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

const Loading = () => <div className={styles.page}><p className={styles.fieldLabel}>Loading…</p></div>;

const NotFound = ({ back, error }: { back: string; error: unknown }) => (
  <div className={styles.page}>
    <Link to={back} className={styles.backBtn}><ArrowLeft {...ICON} /><span>Back</span></Link>
    <div className={styles.bannerWarn}>
      <strong>Document not found.</strong>
      {error instanceof Error ? ` ${error.message}` : null}
    </div>
  </div>
);

const InfoCell = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div className={styles.infoCell}>
    <span className={styles.infoLabel}>{label}</span>
    <span className={styles.infoValue}>{value}</span>
  </div>
);

const PC_STATUS_CLASS: Record<string, string> = {
  AT_WAREHOUSE: styles.statusInProgress ?? '',
  SOLD:         styles.statusOk ?? '',
  RETURNED:     styles.statusClosed ?? '',
  DAMAGED:      styles.statusBad ?? '',
};

export const PurchaseConsignmentDetail = () => {
  const { id } = useParams<{ id: string }>();
  const detail = usePurchaseConsignmentDetail(id ?? null);
  const postNote = usePostPurchaseConsignmentNote();
  const cancelNote = useCancelPurchaseConsignmentNote();
  const [noteModal, setNoteModal] = useState<'IN' | 'RETURN' | null>(null);

  if (detail.isLoading) return <Loading />;
  if (detail.isError || !detail.data?.purchaseConsignment) return <NotFound back="/purchase-consignment" error={detail.error} />;

  const pc = detail.data.purchaseConsignment as Record<string, unknown> & {
    pc_number: string; status: string; agreement_date: string;
    supplier_id: string | null;
    notes: string | null;
    supplier?: { id: string; code: string; name: string } | null;
    // Migration 0111 — flags surfaced by the GET handler.
    has_children?: boolean; fully_sold?: boolean; fully_returned?: boolean;
  };
  const hasChildren = Boolean(pc.has_children);
  const items = (detail.data.items as Array<Record<string, unknown> & {
    id: string;
    material_code: string; description: string | null;
    qty_placed: number; qty_sold: number; qty_returned: number; qty_damaged: number;
    unit_price_centi: number;
  }>) ?? [];
  const notes = (detail.data.notes as Array<Record<string, unknown> & {
    id: string;
    note_number: string; note_type: 'IN' | 'RETURN'; note_date: string;
    driver_name: string | null; signed_at: string | null;
    cancelled_at: string | null;
  }>) ?? [];

  const totalPlaced = items.reduce((s, it) => s + it.qty_placed, 0);
  const totalSold = items.reduce((s, it) => s + it.qty_sold, 0);
  const totalReturned = items.reduce((s, it) => s + it.qty_returned, 0);
  const totalDamaged = items.reduce((s, it) => s + it.qty_damaged, 0);
  const totalOnHand = totalPlaced - totalSold - totalReturned - totalDamaged;

  const supplierLabel = pc.supplier
    ? `${pc.supplier.code} · ${pc.supplier.name}`
    : (pc.supplier_id ?? '—');

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/purchase-consignment" className={styles.backBtn}><ArrowLeft {...ICON} /><span>Back</span></Link>
          <div>
            <h1 className={styles.title}>
              <PackageCheck size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {pc.pc_number}
            </h1>
            <p className={styles.subtitle}>
              {supplierLabel} · agreed {fmtDate(pc.agreement_date)}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.statusPill} ${PC_STATUS_CLASS[pc.status] ?? ''}`}>{pc.status.replace('_', ' ')}</span>
        </div>
      </div>

      {hasChildren && (
        /* Migration 0111 — header + items lock once any active note exists.
           Mirrors the consignment / GRN downstream-lock banner. */
        <section className={styles.card} style={{ borderColor: 'var(--c-orange)' }}>
          <div className={styles.cardBody} style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <AlertCircle {...ICON} style={{ color: 'var(--c-orange)', flexShrink: 0 }} />
            <span className={styles.muted}>
              Locked — has posted notes. Cancel a note first to edit the PC or items.
            </span>
          </div>
        </section>
      )}

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Supplier · Agreement</h2></header>
        <div className={styles.cardBody}>
          <div className={styles.infoGrid}>
            <InfoCell label="Supplier" value={supplierLabel} />
            <InfoCell label="Agreement Date" value={fmtDate(pc.agreement_date)} />
            <InfoCell label="Status" value={pc.status.replace('_', ' ')} />
            {pc.notes && <div className={styles.infoCellFull}><span className={styles.infoLabel}>Notes</span><div className={styles.infoValue}>{pc.notes}</div></div>}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}><h2 className={styles.cardTitle}>Items ({items.length})</h2></header>
        {items.length === 0 ? <p className={styles.emptyRow}>No items.</p> : (
          <table className={styles.table}>
            <thead><tr>
              <th>Item</th>
              <th className={styles.tableRight}>Placed</th>
              <th className={styles.tableRight}>Sold</th>
              <th className={styles.tableRight}>Returned</th>
              <th className={styles.tableRight}>Damaged</th>
              <th className={styles.tableRight}>On Hand</th>
              <th className={styles.tableRight}>Unit Price</th>
            </tr></thead>
            <tbody>
              {items.map((it) => {
                const onHand = it.qty_placed - it.qty_sold - it.qty_returned - it.qty_damaged;
                return (
                  <tr key={it.id as string}>
                    <td><div className={styles.codeCell}>{it.material_code}</div><div className={styles.muted}>{it.description ?? '—'}</div></td>
                    <td className={styles.tableRight}>{it.qty_placed}</td>
                    <td className={styles.tableRight}>{it.qty_sold}</td>
                    <td className={styles.tableRight}>{it.qty_returned}</td>
                    <td className={`${styles.tableRight} ${it.qty_damaged > 0 ? '' : styles.muted}`}
                        style={it.qty_damaged > 0 ? { color: 'var(--c-festive-b, #B8331F)' } : undefined}>
                      {it.qty_damaged}
                    </td>
                    <td className={styles.tableRight} style={{ fontWeight: 600 }}>{onHand}</td>
                    <td className={styles.tableRight}>{fmtRm(it.unit_price_centi)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className={styles.card}>
        <div className={styles.cardBody}>
          <div className={styles.totalsGrid}>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Total Placed</span><span className={styles.totalValue}>{totalPlaced}</span></div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Total Sold</span><span className={styles.totalValue} style={{ color: 'var(--c-secondary-a, #2F5D4F)' }}>{totalSold}</span></div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Total Returned</span><span className={styles.totalValue}>{totalReturned}</span></div>
            <div className={styles.totalRow}><span className={styles.totalLabel}>Total Damaged</span><span className={styles.totalValue} style={{ color: totalDamaged > 0 ? 'var(--c-festive-b, #B8331F)' : undefined }}>{totalDamaged}</span></div>
            <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
              <span className={styles.totalLabel}>Remaining On Hand</span>
              <span className={styles.grandTotal}>{totalOnHand}</span>
            </div>
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Notes ({notes.length})</h2>
          <span className={styles.actions}>
            <Button variant="primary" size="sm" onClick={() => setNoteModal('IN')}>
              <Plus {...ICON} /><span>IN note</span>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setNoteModal('RETURN')}>
              <Undo2 {...ICON} /><span>RETURN note</span>
            </Button>
          </span>
        </header>
        {notes.length === 0 ? <p className={styles.emptyRow}>No notes yet. IN = supplier delivers to your warehouse. RETURN = you ship back to supplier.</p> : (
          <table className={styles.table}>
            <thead><tr>
              <th>Note #</th><th>Type</th><th>Date</th><th>Driver</th><th>Status</th><th className={styles.tableRight}>Action</th>
            </tr></thead>
            <tbody>
              {notes.map((n) => {
                const isCancelled = Boolean(n.cancelled_at);
                const isPosted = Boolean(n.signed_at) && !isCancelled;
                return (
                  <tr key={n.id} style={isCancelled ? { opacity: 0.55 } : undefined}>
                    <td className={styles.codeCell}>{n.note_number}</td>
                    <td>
                      <span className={`${styles.statusPill} ${n.note_type === 'IN' ? styles.statusOk : styles.statusInProgress}`}>
                        {n.note_type}
                      </span>
                    </td>
                    <td className={styles.muted}>{fmtDate(n.note_date)}</td>
                    <td className={styles.muted}>{n.driver_name ?? '—'}</td>
                    <td className={styles.muted}>
                      {isCancelled
                        ? `Cancelled ${fmtDate(n.cancelled_at as string)}`
                        : n.signed_at ? `Posted ${fmtDate(n.signed_at)}` : 'Draft'}
                    </td>
                    <td className={styles.tableRight}>
                      {!n.signed_at && !isCancelled && (
                        <LoadingButton
                          variant="ghost"
                          size="sm"
                          onClick={() => postNote.mutate({ id: id!, noteId: n.id })}
                          loading={postNote.isPending}
                        >
                          <CheckCircle2 {...ICON} />Post
                        </LoadingButton>
                      )}
                      {isPosted && (
                        /* Migration 0111 — cancel/unpost a posted note. Reverses
                           the inventory movement + rolls back qty_returned (for
                           RETURN notes). Idempotent on the server. */
                        <LoadingButton
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            if (!confirm(`Cancel ${n.note_number}? This will reverse the inventory movement.`)) return;
                            cancelNote.mutate({ id: id!, noteId: n.id });
                          }}
                          loading={cancelNote.isPending}
                        >
                          <X {...ICON} />Cancel
                        </LoadingButton>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {noteModal && (
        <CreatePcNoteModal
          pcId={id!}
          type={noteModal}
          items={items}
          onClose={() => setNoteModal(null)}
        />
      )}
    </div>
  );
};

/* Modal for creating an IN or RETURN note. Mirrors CreateConsignmentNoteModal —
   tick which items + qty to include from the parent pc_order_items list. */
const CreatePcNoteModal = ({
  pcId,
  type,
  items,
  onClose,
}: {
  pcId: string;
  type: 'IN' | 'RETURN';
  items: Array<{ id: string; material_code: string; description: string | null; qty_placed: number; qty_sold: number; qty_returned: number; qty_damaged: number }>;
  onClose: () => void;
}) => {
  const addNote = useAddPurchaseConsignmentNote();
  const [driverName, setDriverName] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [lineQty, setLineQty] = useState<Record<string, number>>({});

  const submit = () => {
    const lines = items
      .filter((it) => (lineQty[it.id] ?? 0) > 0)
      .map((it) => ({
        pcItemId: it.id,
        itemCode: it.material_code,
        description: it.description ?? undefined,
        qty: lineQty[it.id],
      }));
    if (lines.length === 0) { alert('Tick at least one item with qty > 0.'); return; }
    addNote.mutate(
      { id: pcId, noteType: type, driverName, vehicle, items: lines },
      { onSuccess: onClose },
    );
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} style={{ width: 'min(640px, 95vw)' }} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            New {type} Note · {type === 'IN' ? 'Supplier delivers to your warehouse' : 'Return unsold stock to supplier'}
          </h3>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON} /></button>
        </header>
        <div className={styles.modalBody} style={{ gap: 'var(--space-3)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-3)' }}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Driver Name</span>
              <input className={styles.fieldInput} value={driverName} onChange={(e) => setDriverName(e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Vehicle</span>
              <input className={styles.fieldInput} value={vehicle} onChange={(e) => setVehicle(e.target.value)} />
            </label>
          </div>
          <table className={styles.table}>
            <thead><tr>
              <th>Item</th>
              <th className={styles.tableRight}>{type === 'IN' ? 'Placed' : 'On hand'}</th>
              <th className={styles.tableRight}>Qty for this note</th>
            </tr></thead>
            <tbody>
              {items.map((it) => {
                const remaining = type === 'IN'
                  ? it.qty_placed
                  : (it.qty_placed - it.qty_sold - it.qty_returned - it.qty_damaged);
                return (
                  <tr key={it.id}>
                    <td>
                      <div className={styles.codeCell}>{it.material_code}</div>
                      <div className={styles.muted}>{it.description ?? '—'}</div>
                    </td>
                    <td className={`${styles.tableRight} ${styles.muted}`}>{remaining}</td>
                    <td className={styles.tableRight}>
                      <input
                        type="number"
                        min={0}
                        max={remaining}
                        value={lineQty[it.id] ?? 0}
                        onChange={(e) => setLineQty((s) => ({ ...s, [it.id]: Number(e.target.value) || 0 }))}
                        style={{
                          width: 70, textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          background: 'var(--c-cream)',
                          border: '1px solid var(--c-orange)',
                          borderRadius: 'var(--radius-sm)',
                          padding: '4px 8px',
                          outline: 'none',
                        }}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <LoadingButton
            variant="primary"
            size="md"
            onClick={submit}
            loading={addNote.isPending}
            loadingText="Saving…"
          >
            {`Create ${type} Note`}
          </LoadingButton>
        </footer>
      </div>
    </div>
  );
};
