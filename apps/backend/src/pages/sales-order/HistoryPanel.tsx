// ----------------------------------------------------------------------------
// HistoryPanel — right-side audit-log drawer.
// Extracted from SalesOrderDetail.tsx (task #61). Code-split via React.lazy
// from the page so it's not in the cold-load chunk.
// ----------------------------------------------------------------------------

import { memo, useState } from 'react';
import { ChevronDown, ChevronRight, History, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useSalesOrderAuditLog,
  type SoAuditEntry, type SoAuditFieldChange,
} from '../../lib/flow-queries';
import type { SoStatus } from './types';
import { HISTORY_NOTE_STYLE, SM_ICON } from './types';
import styles from '../SalesOrderDetail.module.css';

const STATUS_CLASS: Record<SoStatus, string> = {
  CONFIRMED:      styles.statusConfirmed ?? '',
  IN_PRODUCTION:  styles.statusInProd ?? '',
  READY_TO_SHIP:  styles.statusReady ?? '',
  SHIPPED:        styles.statusShipped ?? '',
  DELIVERED:      styles.statusDelivered ?? '',
  INVOICED:       styles.statusInvoiced ?? '',
  CLOSED:         styles.statusClosed ?? '',
  CANCELLED:      styles.statusCancelled ?? '',
};

const ACTION_LABEL: Record<string, string> = {
  CREATE:         'Created order',
  UPDATE_DETAILS: 'Updated details',
  UPDATE_STATUS:  'Status changed',
  ADD_LINE:       'Added line',
  UPDATE_LINE:    'Updated line',
  DELETE_LINE:    'Removed line',
  ADD_PAYMENT:    'Added payment',
  DELETE_PAYMENT: 'Removed payment',
};

const FIELD_LABEL: Record<string, string> = {
  debtorCode: 'Customer code', debtorName: 'Customer', agent: 'Agent',
  phone: 'Phone', email: 'Email', soDate: 'SO date', status: 'Status',
  paymentMethod: 'Payment method', depositCenti: 'Deposit',
  internalExpectedDd: 'Processing date', customerSoNo: 'Customer SO ref',
  customerPo: 'Customer PO', customerState: 'State',
  customerDeliveryDate: 'Delivery date', city: 'City', postcode: 'Postcode',
  buildingType: 'Building type', address1: 'Address 1', address2: 'Address 2',
  address3: 'Address 3', address4: 'Address 4', note: 'Note',
  remark2: 'Remark 2', remark3: 'Remark 3', remark4: 'Remark 4',
  itemCode: 'Item', itemGroup: 'Group', description: 'Description',
  description2: 'Description 2', uom: 'UOM', qty: 'Qty',
  unitPriceCenti: 'Unit price', discountCenti: 'Discount',
  unitCostCenti: 'Unit cost', totalCenti: 'Line total',
  lineCount: 'Lines', localTotalCenti: 'Total', cancelled: 'Cancelled',
  remark: 'Remark', salespersonId: 'Salesperson', customerType: 'Customer type',
  emergencyContactName: 'Emergency name', emergencyContactPhone: 'Emergency phone',
  emergencyContactRelationship: 'Emergency relationship',
  targetDate: 'Target date', branding: 'Branding', venue: 'Venue',
  salesLocation: 'Sales location', ref: 'Ref', poDocNo: 'PO doc no',
  // Payment ledger fields (ADD_PAYMENT / DELETE_PAYMENT actions). Without
  // these entries the drawer rendered raw camelCase ("paidAt 2026-05-27")
  // which commander flagged as ambiguous on 2026-05-28.
  paidAt: 'Payment date', method: 'Method', amountCenti: 'Amount',
  merchantProvider: 'Merchant provider', installmentMonths: 'Installment term',
  onlineType: 'Online type', approvalCode: 'Approval code',
  accountSheet: 'Account', collectedBy: 'Collected by',
};

const MONEY_FIELDS = new Set(['unitPriceCenti', 'discountCenti', 'totalCenti', 'depositCenti', 'localTotalCenti', 'unitCostCenti', 'amountCenti']);

const fmtField = (field: string, val: unknown): string => {
  if (val === null || val === undefined || val === '') return '—';
  if (MONEY_FIELDS.has(field) && typeof val === 'number') {
    return `RM ${(val / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (typeof val === 'object') return JSON.stringify(val);
  return String(val).replace(/_/g, ' ');
};

const hashHue = (s: string): number => {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
};

const initialsFor = (name: string | null): string => {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  const first = parts[0] ?? '';
  if (parts.length === 1) return first.slice(0, 2).toUpperCase();
  const last = parts[parts.length - 1] ?? '';
  return ((first[0] ?? '') + (last[0] ?? '')).toUpperCase();
};

const relTime = (iso: string): string => {
  const then = new Date(iso).getTime();
  const diffMs = Date.now() - then;
  const m = Math.round(diffMs / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-MY', { year: 'numeric', month: 'short', day: '2-digit' });
};

const HistoryPanelInner = ({
  docNo,
  onClose,
}: {
  docNo: string;
  onClose: () => void;
}) => {
  const q = useSalesOrderAuditLog(docNo);
  const entries = q.data ?? [];
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  return (
    <>
      <div className={styles.historyBackdrop} onClick={onClose} />
      <aside className={styles.historyPanel} role="dialog" aria-label="Sales order history">
        <header className={styles.historyPanelHead}>
          <h3 className={styles.historyPanelTitle}>
            <History {...SM_ICON} />
            History · {docNo}
            <span style={{ marginLeft: 8, fontWeight: 400 }}>
              ({entries.length})
            </span>
          </h3>
          <Button variant="ghost" size="sm" onClick={onClose}>
            <X {...SM_ICON} />
          </Button>
        </header>
        <div className={styles.historyPanelBody}>
          {q.isLoading ? (
            <p className={styles.fieldLabel} style={{ padding: 'var(--space-3)' }}>Loading…</p>
          ) : entries.length === 0 ? (
            <p className={styles.muted} style={{ padding: 'var(--space-3)' }}>
              No history yet.
            </p>
          ) : (
            entries.map((e: SoAuditEntry) => {
              const name = e.actor_name_snapshot ?? '(unknown)';
              const hue = hashHue(name);
              const fc: SoAuditFieldChange[] = Array.isArray(e.field_changes) ? e.field_changes : [];
              const isExpanded = !!expanded[e.id];
              const label = ACTION_LABEL[e.action] ?? e.action.replace(/_/g, ' ').toLowerCase();
              const statusPillStatus = e.action === 'UPDATE_STATUS'
                ? (fc.find((f) => f.field === 'status')?.to as string | undefined)
                : null;
              return (
                <div key={e.id} className={styles.historyItem}>
                  <span
                    className={styles.historyAvatar}
                    style={{ background: `hsl(${hue}, 50%, 60%)` }}
                    aria-hidden
                  >
                    {initialsFor(name)}
                  </span>
                  <div>
                    <div className={styles.historyLine}>
                      <span className={styles.historyActor}>{name}</span>
                      {' performed '}
                      <strong>{label}</strong>
                      {statusPillStatus && (
                        <span
                          className={`${styles.statusPill} ${STATUS_CLASS[statusPillStatus as SoStatus] ?? ''}`}
                          style={{ marginLeft: 6, fontSize: 'var(--fs-10)' }}
                        >
                          {statusPillStatus.replace(/_/g, ' ')}
                        </span>
                      )}
                    </div>
                    <div className={styles.historyMeta}>
                      {new Date(e.created_at).toLocaleString('en-MY', {
                        year: 'numeric', month: 'short', day: '2-digit',
                        hour: '2-digit', minute: '2-digit',
                      })}
                      {' · '}{relTime(e.created_at)}
                      {e.source ? ` · via ${e.source}` : ''}
                    </div>
                    {e.note && (
                      <div className={styles.historyMeta} style={HISTORY_NOTE_STYLE}>
                        “{e.note}”
                      </div>
                    )}
                    {fc.length > 0 && (
                      <>
                        <button
                          type="button"
                          className={styles.historyChangesBtn}
                          onClick={() => setExpanded((s) => ({ ...s, [e.id]: !s[e.id] }))}
                        >
                          {isExpanded ? <ChevronDown size={12} strokeWidth={1.75} /> : <ChevronRight size={12} strokeWidth={1.75} />}
                          {' '}Changes ({fc.length})
                        </button>
                        {isExpanded && (
                          <div className={styles.historyChanges}>
                            {fc.map((ch, idx) => {
                              // Always render "from → to" with em-dash for the
                              // null side. Commander 2026-05-28: bare
                              // "paidAt 2026-05-27" reads ambiguously — is it
                              // a key-value pair or a change? Showing
                              // "— → 2026-05-27" makes INSERT clearly an "added"
                              // change; "2026-05-27 → —" makes DELETE explicit.
                              return (
                                <div key={idx} className={styles.historyChange}>
                                  <span className={styles.historyChangeField}>
                                    {FIELD_LABEL[ch.field] ?? ch.field}
                                  </span>
                                  <span className={styles.historyChangeDiff}>
                                    <span className={styles.historyChangeFrom}>
                                      {fmtField(ch.field, ch.from)}
                                    </span>
                                    <span className={styles.historyChangeArrow}>→</span>
                                    <span>{fmtField(ch.field, ch.to)}</span>
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </aside>
    </>
  );
};

export const HistoryPanel = memo(HistoryPanelInner);
HistoryPanel.displayName = 'HistoryPanel';

export default HistoryPanel;
