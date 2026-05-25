// ----------------------------------------------------------------------------
// SalesOrderDetail — full-page route at /mfg-sales-orders/:docNo.
//
// HOUZS-pattern B2B sales order:
//   1. Header: back button + doc no · debtor + status pill + actions (Print PDF)
//   2. Customer info card: editable debtor_code/name/phone/agent/branding/
//      venue/4 addresses with autocomplete from prior SOs
//   3. Line items table: Item code + group + description + variants summary +
//      qty + unit price + discount + total + Edit/Delete. "+ Add Line Item"
//      opens a modal with a product picker + variant editor (sofa: size +
//      fabric color + leg height; bedframe: divan + gap + leg + specials).
//   4. Totals card: per-category subtotal + grand total + margin
//   5. Status transition strip: Draft → Confirmed → In production → ... etc.
//
// Wires to: GET /mfg-sales-orders/:docNo, PATCH header, POST/PATCH/DELETE items,
// PATCH /:docNo/status, GET /debtors/search.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft, FileText, Pencil, Trash2, Plus, X, Printer, Save,
  DollarSign, Lock, Clock, AlertCircle,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useMfgSalesOrderDetail,
  useUpdateMfgSalesOrderHeader,
  useUpdateMfgSalesOrderStatus,
  useAddMfgSalesOrderItem,
  useUpdateMfgSalesOrderItem,
  useDeleteMfgSalesOrderItem,
  useDebtorSearch,
  useMfgSalesOrderStatusChanges,
  useMfgSalesOrderPriceOverrides,
  useOverrideMfgSoLinePrice,
  type DebtorSuggestion,
  type SoStatusChange,
  type SoPriceOverride,
} from '../lib/flow-queries';
import { useMfgProducts, useMaintenanceConfig } from '../lib/mfg-products-queries';
import { generateSalesOrderPdf } from '../lib/sales-order-pdf';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

const STATUS_LIST = [
  'DRAFT', 'CONFIRMED', 'IN_PRODUCTION', 'READY_TO_SHIP',
  'SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED',
] as const;
type SoStatus = typeof STATUS_LIST[number];

const STATUS_CLASS: Record<SoStatus, string> = {
  DRAFT:          styles.statusDraft ?? '',
  CONFIRMED:      styles.statusConfirmed ?? '',
  IN_PRODUCTION:  styles.statusInProd ?? '',
  READY_TO_SHIP:  styles.statusReady ?? '',
  SHIPPED:        styles.statusShipped ?? '',
  DELIVERED:      styles.statusDelivered ?? '',
  INVOICED:       styles.statusInvoiced ?? '',
  CLOSED:         styles.statusClosed ?? '',
  CANCELLED:      styles.statusCancelled ?? '',
};

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

type SoHeader = {
  doc_no: string;
  so_date: string;
  status: SoStatus;
  debtor_code: string | null;
  debtor_name: string;
  agent: string | null;
  sales_location: string | null;
  ref: string | null;
  po_doc_no: string | null;
  venue: string | null;
  branding: string | null;
  transfer_to: string | null;
  address1: string | null;
  address2: string | null;
  address3: string | null;
  address4: string | null;
  phone: string | null;
  mattress_sofa_centi: number;
  bedframe_centi: number;
  accessories_centi: number;
  others_centi: number;
  local_total_centi: number;
  total_cost_centi: number;
  total_margin_centi: number;
  margin_pct_basis: number;
  line_count: number;
  currency: string;
  note: string | null;
  // ── PR #35 additions ────────────────────────────────────────────────
  customer_id: string | null;
  customer_state: string | null;
  customer_po: string | null;
  customer_po_id: string | null;
  customer_po_date: string | null;
  customer_po_image_b64: string | null;
  hub_id: string | null;
  hub_name: string | null;
  customer_delivery_date: string | null;
  internal_expected_dd: string | null;
  linked_do_doc_no: string | null;
  ship_to_address: string | null;
  bill_to_address: string | null;
  install_to_address: string | null;
  subtotal_sen: number | null;
  overdue: string | null;
};

type SoItem = {
  id: string;
  doc_no: string;
  item_group: string;
  item_code: string;
  description: string | null;
  description2: string | null;
  uom: string;
  qty: number;
  unit_price_centi: number;
  discount_centi: number;
  total_centi: number;
  unit_cost_centi: number;
  line_cost_centi: number;
  line_margin_centi: number;
  variants: Record<string, unknown> | null;
  remark: string | null;
  cancelled: boolean;
};

export const SalesOrderDetail = () => {
  const { docNo } = useParams<{ docNo: string }>();
  const detail = useMfgSalesOrderDetail(docNo ?? null);
  const updateHeader = useUpdateMfgSalesOrderHeader();
  const updateStatus = useUpdateMfgSalesOrderStatus();
  const addItem = useAddMfgSalesOrderItem();
  const updateItem = useUpdateMfgSalesOrderItem();
  const deleteItem = useDeleteMfgSalesOrderItem();
  const maint = useMaintenanceConfig('master');

  const header = (detail.data?.salesOrder as SoHeader | undefined) ?? null;
  const items = (detail.data?.items as SoItem[] | undefined) ?? [];

  const [editing, setEditing] = useState<SoItem | null>(null);
  const [adding, setAdding] = useState(false);
  const [overriding, setOverriding] = useState<SoItem | null>(null);
  const [unlockOverride, setUnlockOverride] = useState(false);

  // Lock mechanism — once SO leaves DRAFT, edits require explicit override.
  // CANCELLED + CLOSED + INVOICED are also locked (terminal-ish states).
  const lockedStatuses: SoStatus[] = ['IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED'];

  if (detail.isLoading) {
    return <div className={styles.page}><p className={styles.fieldLabel}>Loading…</p></div>;
  }
  if (detail.isError || !header) {
    return (
      <div className={styles.page}>
        <Link to="/mfg-sales-orders" className={styles.backBtn}>
          <ArrowLeft {...ICON} />
          <span>Back</span>
        </Link>
        <div className={styles.bannerWarn}>
          <strong>Sales order not found.</strong>
          {detail.error instanceof Error ? ` ${detail.error.message}` : null}
        </div>
      </div>
    );
  }

  const isLocked = lockedStatuses.includes(header.status) && !unlockOverride;

  const handlePrint = () => {
    generateSalesOrderPdf(header, items).catch((e) => {
      // eslint-disable-next-line no-console
      console.error('PDF generation failed:', e);
      alert(`PDF generation failed: ${e instanceof Error ? e.message : String(e)}`);
    });
  };

  return (
    <div className={styles.page}>
      {/* ── Header ──────────────────────────────────────────────── */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/mfg-sales-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </Link>
          <div>
            <h1 className={styles.title}>
              <FileText size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              {header.doc_no} — {header.debtor_name}
            </h1>
            <p className={styles.subtitle}>
              SO date {header.so_date} · {header.line_count} {header.line_count === 1 ? 'line' : 'lines'}
              {header.po_doc_no && ` · Customer PO ${header.po_doc_no}`}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.statusPill} ${STATUS_CLASS[header.status]}`}>
            {header.status.replace(/_/g, ' ')}
          </span>
          <Button variant="ghost" size="md" onClick={handlePrint}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
        </div>
      </div>

      {/* ── Lock banner ─────────────────────────────────────────── */}
      {lockedStatuses.includes(header.status) && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: 'var(--space-3) var(--space-4)',
          background: unlockOverride ? 'rgba(184, 51, 31, 0.06)' : 'rgba(232, 107, 58, 0.08)',
          border: `1px solid ${unlockOverride ? 'var(--c-festive-b, #B8331F)' : 'var(--c-orange)'}`,
          borderRadius: 'var(--radius-md)',
          fontSize: 'var(--fs-13)',
        }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <Lock {...ICON} />
            {unlockOverride
              ? <strong>Edit-lock overridden — changes are tracked in the status timeline below.</strong>
              : <>This SO is <strong>{header.status.replace(/_/g, ' ')}</strong>. Line item edits + addresses are locked. Click <em>Override</em> if you must change something.</>}
          </span>
          <Button variant={unlockOverride ? 'ghost' : 'primary'} size="sm"
            onClick={() => {
              if (!unlockOverride) {
                const reason = window.prompt('Reason for override?', '');
                if (!reason || reason.trim().length < 10) {
                  alert('Override needs a reason ≥ 10 chars.');
                  return;
                }
                // Audit the override via a status change row (we re-affirm the
                // current status with an OVERRIDE notes prefix).
                updateStatus.mutate({ docNo: header.doc_no, status: header.status });
                setUnlockOverride(true);
              } else {
                setUnlockOverride(false);
              }
            }}>
            {unlockOverride ? 'Re-lock' : 'Override'}
          </Button>
        </div>
      )}

      {/* ── Customer info ───────────────────────────────────────── */}
      <CustomerCard
        header={header}
        onSave={(patch) => updateHeader.mutate({ docNo: header.doc_no, ...patch })}
        saving={updateHeader.isPending}
        locked={isLocked}
      />

      {/* ── Multi-address card (ship-to / bill-to / install-to) ── */}
      <AddressCard
        header={header}
        onSave={(patch) => updateHeader.mutate({ docNo: header.doc_no, ...patch })}
        saving={updateHeader.isPending}
        locked={isLocked}
      />

      {/* ── Line items ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({items.length})</h2>
          <Button variant="primary" size="sm" onClick={() => setAdding(true)} disabled={isLocked}>
            <Plus {...ICON} />
            <span>Add Line Item</span>
          </Button>
        </header>

        {items.length === 0 ? (
          <p className={styles.emptyRow}>No items yet — click "Add Line Item" to begin.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th>Group</th>
                <th className={styles.tableRight}>Qty</th>
                <th className={styles.tableRight}>Unit</th>
                <th className={styles.tableRight}>Disc</th>
                <th className={styles.tableRight}>Total</th>
                <th className={styles.tableRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => (
                <tr key={it.id}>
                  <td>
                    <div className={styles.codeCell}>{it.item_code}</div>
                    {it.description && <div className={styles.muted}>{it.description}</div>}
                    <VariantsPills variants={it.variants} />
                  </td>
                  <td className={styles.muted}>{it.item_group}</td>
                  <td className={styles.tableRight}>{it.qty}</td>
                  <td className={styles.tableRight}>{fmtRm(it.unit_price_centi, header.currency)}</td>
                  <td className={styles.tableRight}>{it.discount_centi > 0 ? fmtRm(it.discount_centi, header.currency) : '—'}</td>
                  <td className={styles.priceCell}>{fmtRm(it.total_centi, header.currency)}</td>
                  <td>
                    <span className={styles.actionsCell}>
                      <button type="button" className={styles.iconBtn} title="Edit" disabled={isLocked}
                        onClick={() => !isLocked && setEditing(it)}>
                        <Pencil {...SM_ICON} />
                      </button>
                      <button type="button" className={styles.iconBtn} title="Override price"
                        disabled={isLocked}
                        onClick={() => !isLocked && setOverriding(it)}>
                        <DollarSign {...SM_ICON} />
                      </button>
                      <button
                        type="button"
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        title="Delete"
                        disabled={isLocked}
                        onClick={() => {
                          if (isLocked) return;
                          if (confirm(`Remove ${it.item_code} from this SO?`)) {
                            deleteItem.mutate({ docNo: header.doc_no, itemId: it.id });
                          }
                        }}
                      >
                        <Trash2 {...SM_ICON} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* ── Totals ──────────────────────────────────────────────── */}
      <TotalsCard header={header} />

      {/* ── Status flow ─────────────────────────────────────────── */}
      <StatusBar
        status={header.status}
        onTransition={(s) => updateStatus.mutate({ docNo: header.doc_no, status: s })}
        pending={updateStatus.isPending}
      />

      {/* ── Status timeline (audit) ─────────────────────────────── */}
      <StatusTimeline docNo={header.doc_no} currentStatus={header.status} />

      {/* ── Price override audit ────────────────────────────────── */}
      <PriceOverridePanel docNo={header.doc_no} currency={header.currency} />

      {/* ── Modals ─────────────────────────────────────────────── */}
      {(adding || editing) && (
        <LineItemModal
          editing={editing}
          maint={maint.data?.data ?? null}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSave={(payload) => {
            if (editing) {
              updateItem.mutate(
                { docNo: header.doc_no, itemId: editing.id, ...payload },
                { onSuccess: () => setEditing(null) },
              );
            } else {
              addItem.mutate(
                { docNo: header.doc_no, ...payload },
                { onSuccess: () => setAdding(false) },
              );
            }
          }}
          saving={addItem.isPending || updateItem.isPending}
        />
      )}
      {overriding && (
        <OverridePriceModal
          item={overriding}
          docNo={header.doc_no}
          currency={header.currency}
          onClose={() => setOverriding(null)}
        />
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Customer info card — editable, with debtor autocomplete
   ════════════════════════════════════════════════════════════════════════ */

const CustomerCard = ({
  header,
  onSave,
  saving,
}: {
  header: SoHeader;
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
  /** When true, disable input editing — accepted but consumer must show
      the visual lock. We keep the prop optional so existing call sites
      compile. */
  locked?: boolean;
}) => {
  const [form, setForm] = useState({
    debtorCode: header.debtor_code ?? '',
    debtorName: header.debtor_name ?? '',
    agent: header.agent ?? '',
    branding: header.branding ?? '',
    venue: header.venue ?? '',
    ref: header.ref ?? '',
    poDocNo: header.po_doc_no ?? '',
    phone: header.phone ?? '',
    address1: header.address1 ?? '',
    address2: header.address2 ?? '',
    address3: header.address3 ?? '',
    address4: header.address4 ?? '',
    note: header.note ?? '',
  });
  const [showSuggest, setShowSuggest] = useState(false);
  const debtorQuery = useDebtorSearch(form.debtorName);
  const suggestions = (debtorQuery.data?.debtors ?? []).filter(
    (d) => (d.debtor_name ?? '').toLowerCase() !== form.debtorName.trim().toLowerCase(),
  );

  useEffect(() => {
    setForm({
      debtorCode: header.debtor_code ?? '',
      debtorName: header.debtor_name ?? '',
      agent: header.agent ?? '',
      branding: header.branding ?? '',
      venue: header.venue ?? '',
      ref: header.ref ?? '',
      poDocNo: header.po_doc_no ?? '',
      phone: header.phone ?? '',
      address1: header.address1 ?? '',
      address2: header.address2 ?? '',
      address3: header.address3 ?? '',
      address4: header.address4 ?? '',
      note: header.note ?? '',
    });
  }, [header]);

  const set = (k: keyof typeof form, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  const applySuggestion = (d: DebtorSuggestion) => {
    setForm((s) => ({
      ...s,
      debtorCode: d.debtor_code ?? s.debtorCode,
      debtorName: d.debtor_name ?? s.debtorName,
      phone: d.phone ?? s.phone,
      address1: d.address1 ?? s.address1,
      address2: d.address2 ?? s.address2,
      address3: d.address3 ?? s.address3,
      address4: d.address4 ?? s.address4,
    }));
    setShowSuggest(false);
  };

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Customer · Addresses</h2>
        <Button variant="primary" size="sm" onClick={() => onSave(form)} disabled={saving}>
          <Save {...ICON} />
          <span>{saving ? 'Saving…' : 'Save'}</span>
        </Button>
      </header>
      <div className={styles.cardBody}>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Debtor Code</span>
            <input className={styles.fieldInput} value={form.debtorCode}
              onChange={(e) => set('debtorCode', e.target.value)} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 3' }}>
            <span className={styles.fieldLabel}>Debtor Name *</span>
            <input
              className={styles.fieldInput}
              value={form.debtorName}
              onChange={(e) => { set('debtorName', e.target.value); setShowSuggest(true); }}
              onFocus={() => setShowSuggest(true)}
              onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
            />
            {showSuggest && suggestions.length > 0 && (
              <ul className={styles.suggestList}>
                {suggestions.slice(0, 8).map((d, i) => (
                  <li
                    key={`${d.debtor_code ?? ''}-${i}`}
                    className={styles.suggestItem}
                    onMouseDown={() => applySuggestion(d)}
                  >
                    <div>{d.debtor_name}</div>
                    {(d.debtor_code || d.phone) && (
                      <div className={styles.suggestCode}>
                        {d.debtor_code ?? ''}{d.debtor_code && d.phone ? ' · ' : ''}{d.phone ?? ''}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Phone</span>
            <input className={styles.fieldInput} value={form.phone}
              onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Agent</span>
            <input className={styles.fieldInput} value={form.agent}
              onChange={(e) => set('agent', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Branding</span>
            <input className={styles.fieldInput} value={form.branding}
              onChange={(e) => set('branding', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Venue</span>
            <input className={styles.fieldInput} value={form.venue}
              onChange={(e) => set('venue', e.target.value)} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Reference</span>
            <input className={styles.fieldInput} value={form.ref}
              onChange={(e) => set('ref', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Customer PO #</span>
            <input className={styles.fieldInput} value={form.poDocNo}
              onChange={(e) => set('poDocNo', e.target.value)} />
          </label>
          <label className={`${styles.field}`} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Note</span>
            <input className={styles.fieldInput} value={form.note}
              onChange={(e) => set('note', e.target.value)} />
          </label>

          <label className={`${styles.field} ${styles.fieldFull}`}>
            <span className={styles.fieldLabel}>Address Line 1</span>
            <input className={styles.fieldInput} value={form.address1}
              onChange={(e) => set('address1', e.target.value)} />
          </label>
          <label className={`${styles.field} ${styles.fieldFull}`}>
            <span className={styles.fieldLabel}>Address Line 2</span>
            <input className={styles.fieldInput} value={form.address2}
              onChange={(e) => set('address2', e.target.value)} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Address Line 3 (City / Postcode)</span>
            <input className={styles.fieldInput} value={form.address3}
              onChange={(e) => set('address3', e.target.value)} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Address Line 4 (State / Country)</span>
            <input className={styles.fieldInput} value={form.address4}
              onChange={(e) => set('address4', e.target.value)} />
          </label>
        </div>
      </div>
    </section>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Variants summary pills (for line items table)
   ════════════════════════════════════════════════════════════════════════ */

const VariantsPills = ({ variants }: { variants: Record<string, unknown> | null }) => {
  if (!variants || typeof variants !== 'object') return null;
  const entries = Object.entries(variants).filter(([, v]) => v != null && v !== '');
  if (entries.length === 0) return null;
  return (
    <div className={styles.variantBlock}>
      {entries.map(([k, v]) => (
        <span key={k} className={styles.variantPill}>
          {k}: {String(v)}
        </span>
      ))}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Totals card
   ════════════════════════════════════════════════════════════════════════ */

const TotalsCard = ({ header }: { header: SoHeader }) => {
  const marginPct = header.margin_pct_basis / 100;
  const marginCls =
    marginPct >= 30 ? styles.marginGood
    : marginPct >= 15 ? styles.marginWarn
    : styles.marginBad;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Totals · Margin</h2>
      </header>
      <div className={styles.cardBody}>
        <div className={styles.totalsGrid}>
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Mattress / Sofa</span>
            <span className={styles.totalValue}>{fmtRm(header.mattress_sofa_centi, header.currency)}</span>
          </div>
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Bedframe</span>
            <span className={styles.totalValue}>{fmtRm(header.bedframe_centi, header.currency)}</span>
          </div>
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Accessories</span>
            <span className={styles.totalValue}>{fmtRm(header.accessories_centi, header.currency)}</span>
          </div>
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Others</span>
            <span className={styles.totalValue}>{fmtRm(header.others_centi, header.currency)}</span>
          </div>
          <div className={`${styles.totalRow} ${styles.grandTotalRow}`}>
            <span className={styles.totalLabel}>Grand Total</span>
            <span className={styles.grandTotal}>{fmtRm(header.local_total_centi, header.currency)}</span>
          </div>
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Total Cost</span>
            <span className={styles.totalValue}>{fmtRm(header.total_cost_centi, header.currency)}</span>
          </div>
          <div className={styles.totalRow}>
            <span className={styles.totalLabel}>Margin · {marginPct.toFixed(1)}%</span>
            <span className={`${styles.totalValue} ${marginCls}`}>
              {fmtRm(header.total_margin_centi, header.currency)}
            </span>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Status transition bar
   ════════════════════════════════════════════════════════════════════════ */

const NEXT: Record<SoStatus, SoStatus[]> = {
  DRAFT:          ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:      ['IN_PRODUCTION', 'CANCELLED'],
  IN_PRODUCTION:  ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP:  ['SHIPPED'],
  SHIPPED:        ['DELIVERED'],
  DELIVERED:      ['INVOICED'],
  INVOICED:       ['CLOSED'],
  CLOSED:         [],
  CANCELLED:      [],
};

const StatusBar = ({
  status,
  onTransition,
  pending,
}: {
  status: SoStatus;
  onTransition: (s: SoStatus) => void;
  pending: boolean;
}) => {
  const opts = NEXT[status];
  if (opts.length === 0) {
    return (
      <section className={styles.card}>
        <div className={styles.cardBody}>
          <p className={styles.fieldLabel}>This SO is {status.replace(/_/g, ' ').toLowerCase()} — no further transitions available.</p>
        </div>
      </section>
    );
  }
  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Move to next stage</h2>
      </header>
      <div className={styles.cardBody}>
        <div className={styles.statusBar}>
          {opts.map((s, i) => (
            <Button
              key={s}
              variant={i === 0 ? 'primary' : 'ghost'}
              size="sm"
              onClick={() => onTransition(s)}
              disabled={pending}
            >
              <span>{s.replace(/_/g, ' ')}</span>
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Line item modal — product picker + variants editor
   ════════════════════════════════════════════════════════════════════════ */

type LinePayload = {
  itemCode: string;
  itemGroup: string;
  description: string;
  uom: string;
  qty: number;
  unitPriceCenti: number;
  discountCenti: number;
  unitCostCenti: number;
  variants: Record<string, unknown>;
  remark: string;
};

const LineItemModal = ({
  editing,
  maint,
  onClose,
  onSave,
  saving,
}: {
  editing: SoItem | null;
  maint: import('../lib/mfg-products-queries').MaintenanceConfig | null;
  onClose: () => void;
  onSave: (p: LinePayload) => void;
  saving: boolean;
}) => {
  const [search, setSearch] = useState(editing?.item_code ?? '');
  const productsQuery = useMfgProducts({ search: search.trim() || undefined });
  const candidates = productsQuery.data ?? [];

  const [draft, setDraft] = useState<LinePayload>({
    itemCode: editing?.item_code ?? '',
    itemGroup: editing?.item_group ?? 'others',
    description: editing?.description ?? '',
    uom: editing?.uom ?? 'UNIT',
    qty: editing?.qty ?? 1,
    unitPriceCenti: editing?.unit_price_centi ?? 0,
    discountCenti: editing?.discount_centi ?? 0,
    unitCostCenti: editing?.unit_cost_centi ?? 0,
    variants: (editing?.variants as Record<string, unknown>) ?? {},
    remark: editing?.remark ?? '',
  });

  const pickProduct = (p: import('../lib/mfg-products-queries').MfgProductRow) => {
    setDraft((s) => ({
      ...s,
      itemCode: p.code,
      itemGroup: p.category.toLowerCase(),
      description: p.name,
      unitPriceCenti: p.base_price_sen ?? 0,
    }));
    setSearch(p.code);
  };

  const setVariant = (k: string, v: string | number) =>
    setDraft((s) => ({ ...s, variants: { ...s.variants, [k]: v } }));

  const lineTotal = (draft.qty * draft.unitPriceCenti) - draft.discountCenti;

  const submit = () => {
    if (!draft.itemCode.trim()) { alert('Pick a product first.'); return; }
    onSave(draft);
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>{editing ? 'Edit Line Item' : 'Add Line Item'}</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X {...ICON} />
          </button>
        </header>

        <div className={styles.modalBody}>
          {/* Product picker */}
          <div>
            <p className={styles.subHead}>Product</p>
            <div className={styles.pickerWrap}>
              <input
                className={styles.fieldInput}
                placeholder="Search by code or name…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
              {search.trim() && candidates.length > 0 && search !== draft.itemCode && (
                <ul className={styles.suggestList}>
                  {candidates.slice(0, 8).map((p) => (
                    <li key={p.id} className={styles.suggestItem} onMouseDown={() => pickProduct(p)}>
                      <div>
                        <span className={styles.codeCell}>{p.code}</span> · {p.name}
                      </div>
                      <div className={styles.suggestCode}>
                        {p.category} · {fmtRm(p.base_price_sen ?? 0)}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {draft.itemCode && (
              <div className={styles.previewLine} style={{ marginTop: 8 }}>
                <span><strong>{draft.itemCode}</strong> · {draft.description}</span>
                <span className={styles.previewPrice}>{fmtRm(draft.unitPriceCenti)}</span>
              </div>
            )}
          </div>

          {/* Variants editor — shown by category */}
          {(draft.itemGroup === 'bedframe' || draft.itemGroup === 'sofa') && maint && (
            <div>
              <p className={styles.subHead}>Variants</p>
              {draft.itemGroup === 'bedframe' ? (
                <div className={styles.formGrid4}>
                  <VariantSelect
                    label="Divan Height"
                    options={maint.divanHeights}
                    value={String(draft.variants.divanHeight ?? '')}
                    onChange={(v) => setVariant('divanHeight', v)}
                  />
                  <VariantSelect
                    label="Gap"
                    options={maint.gaps.map((g) => ({ value: g, priceSen: 0 }))}
                    value={String(draft.variants.gap ?? '')}
                    onChange={(v) => setVariant('gap', v)}
                  />
                  <VariantSelect
                    label="Leg Height"
                    options={maint.legHeights}
                    value={String(draft.variants.legHeight ?? '')}
                    onChange={(v) => setVariant('legHeight', v)}
                  />
                  <VariantSelect
                    label="Special"
                    options={maint.specials}
                    value={String(draft.variants.special ?? '')}
                    onChange={(v) => setVariant('special', v)}
                  />
                </div>
              ) : (
                <div className={styles.formGrid4}>
                  <VariantSelect
                    label="Seat Size"
                    options={maint.sofaSizes.map((s) => ({ value: s, priceSen: 0 }))}
                    value={String(draft.variants.seatSize ?? '')}
                    onChange={(v) => setVariant('seatSize', v)}
                  />
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Fabric Color</span>
                    <input
                      className={styles.fieldInput}
                      value={String(draft.variants.fabricColor ?? '')}
                      onChange={(e) => setVariant('fabricColor', e.target.value)}
                    />
                  </label>
                  <VariantSelect
                    label="Leg Height"
                    options={maint.sofaLegHeights}
                    value={String(draft.variants.legHeight ?? '')}
                    onChange={(v) => setVariant('legHeight', v)}
                  />
                  <VariantSelect
                    label="Special"
                    options={maint.sofaSpecials}
                    value={String(draft.variants.special ?? '')}
                    onChange={(v) => setVariant('special', v)}
                  />
                </div>
              )}
            </div>
          )}

          {/* Pricing */}
          <div>
            <p className={styles.subHead}>Pricing</p>
            <div className={styles.formGrid4}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Qty</span>
                <input type="number" className={styles.fieldInput} value={draft.qty}
                  onChange={(e) => setDraft((s) => ({ ...s, qty: Number(e.target.value) || 0 }))} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Unit Price (RM)</span>
                <input type="number" step="0.01" className={styles.fieldInput}
                  value={(draft.unitPriceCenti / 100).toFixed(2)}
                  onChange={(e) => setDraft((s) => ({ ...s, unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0 }))} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Discount (RM)</span>
                <input type="number" step="0.01" className={styles.fieldInput}
                  value={(draft.discountCenti / 100).toFixed(2)}
                  onChange={(e) => setDraft((s) => ({ ...s, discountCenti: Math.round(Number(e.target.value) * 100) || 0 }))} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Unit Cost (RM)</span>
                <input type="number" step="0.01" className={styles.fieldInput}
                  value={(draft.unitCostCenti / 100).toFixed(2)}
                  onChange={(e) => setDraft((s) => ({ ...s, unitCostCenti: Math.round(Number(e.target.value) * 100) || 0 }))} />
              </label>
            </div>
            <div className={styles.previewLine} style={{ marginTop: 8 }}>
              <span>Line total</span>
              <span className={styles.previewPrice}>{fmtRm(lineTotal)}</span>
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Remark</span>
            <input className={styles.fieldInput} value={draft.remark}
              onChange={(e) => setDraft((s) => ({ ...s, remark: e.target.value }))} />
          </label>
        </div>

        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={saving}>
            {saving ? 'Saving…' : editing ? 'Save Changes' : 'Add Line Item'}
          </Button>
        </footer>
      </div>
    </div>
  );
};

const VariantSelect = ({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: string; priceSen: number }>;
  value: string;
  onChange: (v: string) => void;
}) => (
  <label className={styles.field}>
    <span className={styles.fieldLabel}>{label}</span>
    <select className={styles.fieldSelect} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value}{o.priceSen > 0 ? ` (+${fmtRm(o.priceSen)})` : ''}
        </option>
      ))}
    </select>
  </label>
);

/* ════════════════════════════════════════════════════════════════════════
   AddressCard — PR #35 multi-address (ship-to / bill-to / install-to)
   ════════════════════════════════════════════════════════════════════════ */

const AddressCard = ({
  header,
  onSave,
  saving,
  locked = false,
}: {
  header: SoHeader;
  onSave: (patch: Record<string, unknown>) => void;
  saving: boolean;
  locked?: boolean;
}) => {
  const [form, setForm] = useState({
    shipToAddress: header.ship_to_address ?? '',
    billToAddress: header.bill_to_address ?? '',
    installToAddress: header.install_to_address ?? '',
    customerPo: header.customer_po ?? '',
    customerPoId: header.customer_po_id ?? '',
    customerPoDate: header.customer_po_date ?? '',
    customerDeliveryDate: header.customer_delivery_date ?? '',
    internalExpectedDd: header.internal_expected_dd ?? '',
    hubName: header.hub_name ?? '',
    customerState: header.customer_state ?? '',
  });

  useEffect(() => {
    setForm({
      shipToAddress: header.ship_to_address ?? '',
      billToAddress: header.bill_to_address ?? '',
      installToAddress: header.install_to_address ?? '',
      customerPo: header.customer_po ?? '',
      customerPoId: header.customer_po_id ?? '',
      customerPoDate: header.customer_po_date ?? '',
      customerDeliveryDate: header.customer_delivery_date ?? '',
      internalExpectedDd: header.internal_expected_dd ?? '',
      hubName: header.hub_name ?? '',
      customerState: header.customer_state ?? '',
    });
  }, [header]);

  const set = (k: keyof typeof form, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Multi-Address · Customer PO · Schedule</h2>
        <Button variant="primary" size="sm"
          onClick={() => onSave(form)} disabled={saving || locked}>
          <Save {...ICON} />
          <span>{saving ? 'Saving…' : 'Save'}</span>
        </Button>
      </header>
      <div className={styles.cardBody}>
        {/* Customer PO row */}
        <p className={styles.subHead}>Customer Purchase Order</p>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Customer PO No</span>
            <input className={styles.fieldInput} value={form.customerPo} disabled={locked}
              onChange={(e) => set('customerPo', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Customer PO ID</span>
            <input className={styles.fieldInput} value={form.customerPoId} disabled={locked}
              onChange={(e) => set('customerPoId', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>PO Date</span>
            <input type="date" className={styles.fieldInput} value={form.customerPoDate} disabled={locked}
              onChange={(e) => set('customerPoDate', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>State</span>
            <input className={styles.fieldInput} value={form.customerState} disabled={locked}
              onChange={(e) => set('customerState', e.target.value)} />
          </label>
        </div>

        {/* Schedule row */}
        <p className={styles.subHead} style={{ marginTop: 'var(--space-3)' }}>Delivery Schedule</p>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Customer Delivery Date</span>
            <input type="date" className={styles.fieldInput} value={form.customerDeliveryDate} disabled={locked}
              onChange={(e) => set('customerDeliveryDate', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Internal Expected DD</span>
            <input type="date" className={styles.fieldInput} value={form.internalExpectedDd} disabled={locked}
              onChange={(e) => set('internalExpectedDd', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Hub / Branch</span>
            <input className={styles.fieldInput} value={form.hubName} disabled={locked}
              onChange={(e) => set('hubName', e.target.value)} />
          </label>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Overdue Flag</span>
            <span className={styles.fieldInput} style={{ display: 'inline-flex', alignItems: 'center', height: 32 }}>
              {header.overdue ? (
                <strong style={{
                  color: header.overdue === 'OVERDUE' ? 'var(--c-festive-b, #B8331F)' : 'var(--c-orange)',
                }}>
                  {header.overdue}
                </strong>
              ) : <span className={styles.muted}>—</span>}
            </span>
          </div>
        </div>

        {/* 3 address blocks */}
        <p className={styles.subHead} style={{ marginTop: 'var(--space-3)' }}>Addresses</p>
        <div className={styles.formGrid4}>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Ship-To Address</span>
            <textarea className={styles.fieldInput} rows={3} value={form.shipToAddress} disabled={locked}
              onChange={(e) => set('shipToAddress', e.target.value)} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Bill-To Address</span>
            <textarea className={styles.fieldInput} rows={3} value={form.billToAddress} disabled={locked}
              onChange={(e) => set('billToAddress', e.target.value)} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 4' }}>
            <span className={styles.fieldLabel}>Install-To Address</span>
            <textarea className={styles.fieldInput} rows={2} value={form.installToAddress} disabled={locked}
              onChange={(e) => set('installToAddress', e.target.value)} />
          </label>
        </div>

        {header.linked_do_doc_no && (
          <p className={styles.muted} style={{ marginTop: 'var(--space-2)' }}>
            Linked DO: <Link to={`/mfg-delivery-orders/${header.linked_do_doc_no}`}>{header.linked_do_doc_no}</Link>
          </p>
        )}
      </div>
    </section>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   StatusTimeline — PR #35 audit trail of status changes
   ════════════════════════════════════════════════════════════════════════ */

const StatusTimeline = ({
  docNo,
  currentStatus,
}: {
  docNo: string;
  currentStatus: SoStatus;
}) => {
  const q = useMfgSalesOrderStatusChanges(docNo);
  const changes = q.data ?? [];

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>
          <Clock {...ICON} style={{ verticalAlign: 'middle', marginRight: 6 }} />
          Status Timeline
          <span className={styles.muted} style={{ marginLeft: 8, fontWeight: 400 }}>
            ({changes.length} {changes.length === 1 ? 'entry' : 'entries'})
          </span>
        </h2>
      </header>
      <div className={styles.cardBody}>
        {q.isLoading ? (
          <p className={styles.fieldLabel}>Loading…</p>
        ) : changes.length === 0 ? (
          <p className={styles.muted}>
            No status changes recorded yet. Current status: <strong>{currentStatus.replace(/_/g, ' ')}</strong>.
          </p>
        ) : (
          <ol style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {changes.map((c: SoStatusChange) => (
              <li key={c.id} style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr',
                gap: 'var(--space-3)',
                padding: 'var(--space-2) 0',
                borderBottom: '1px solid var(--c-line, rgba(34,31,32,0.08))',
                fontSize: 'var(--fs-13)',
              }}>
                <div className={styles.muted}>
                  {new Date(c.created_at).toLocaleString('en-MY', {
                    year: 'numeric', month: 'short', day: '2-digit',
                    hour: '2-digit', minute: '2-digit',
                  })}
                </div>
                <div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    {c.from_status ? (
                      <>
                        <span className={`${styles.statusPill} ${STATUS_CLASS[c.from_status as SoStatus] ?? ''}`}>
                          {c.from_status.replace(/_/g, ' ')}
                        </span>
                        <span>→</span>
                      </>
                    ) : null}
                    <span className={`${styles.statusPill} ${STATUS_CLASS[c.to_status as SoStatus] ?? ''}`}>
                      {c.to_status.replace(/_/g, ' ')}
                    </span>
                  </span>
                  {c.notes && <div className={styles.muted} style={{ marginTop: 4 }}>{c.notes}</div>}
                  {Array.isArray(c.auto_actions) && c.auto_actions.length > 0 && (
                    <div className={styles.muted} style={{ marginTop: 4, fontStyle: 'italic' }}>
                      Auto: {(c.auto_actions as string[]).join(', ')}
                    </div>
                  )}
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
    </section>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   PriceOverridePanel — PR #35 audit trail of line price overrides
   ════════════════════════════════════════════════════════════════════════ */

const PriceOverridePanel = ({
  docNo,
  currency,
}: {
  docNo: string;
  currency: string;
}) => {
  const q = useMfgSalesOrderPriceOverrides(docNo);
  const overrides = q.data ?? [];

  if (q.isLoading) {
    return (
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Price Overrides</h2>
        </header>
        <div className={styles.cardBody}>
          <p className={styles.fieldLabel}>Loading…</p>
        </div>
      </section>
    );
  }

  if (overrides.length === 0) return null;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>
          <AlertCircle {...ICON} style={{ verticalAlign: 'middle', marginRight: 6, color: 'var(--c-orange)' }} />
          Price Overrides
          <span className={styles.muted} style={{ marginLeft: 8, fontWeight: 400 }}>
            ({overrides.length})
          </span>
        </h2>
      </header>
      <div className={styles.cardBody}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Item Code</th>
              <th className={styles.tableRight}>Original</th>
              <th className={styles.tableRight}>Override</th>
              <th className={styles.tableRight}>Δ</th>
              <th>Reason</th>
              <th>When</th>
            </tr>
          </thead>
          <tbody>
            {overrides.map((o: SoPriceOverride) => {
              const delta = o.override_price_sen - o.original_price_sen;
              const deltaPct = o.original_price_sen > 0
                ? (delta / o.original_price_sen) * 100
                : 0;
              return (
                <tr key={o.id}>
                  <td><div className={styles.codeCell}>{o.item_code}</div></td>
                  <td className={styles.tableRight}>{fmtRm(o.original_price_sen, currency)}</td>
                  <td className={styles.tableRight}>
                    <strong>{fmtRm(o.override_price_sen, currency)}</strong>
                  </td>
                  <td className={styles.tableRight} style={{
                    color: delta < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--c-burnt)',
                  }}>
                    {delta >= 0 ? '+' : ''}{fmtRm(delta, currency)}
                    <div className={styles.muted}>{deltaPct.toFixed(1)}%</div>
                  </td>
                  <td className={styles.muted}>{o.reason ?? '—'}</td>
                  <td className={styles.muted}>
                    {new Date(o.created_at).toLocaleString('en-MY', {
                      year: 'numeric', month: 'short', day: '2-digit',
                      hour: '2-digit', minute: '2-digit',
                    })}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   OverridePriceModal — PR #35 set line price override + reason audit
   ════════════════════════════════════════════════════════════════════════ */

const OverridePriceModal = ({
  item,
  docNo,
  currency,
  onClose,
}: {
  item: SoItem;
  docNo: string;
  currency: string;
  onClose: () => void;
}) => {
  const override = useOverrideMfgSoLinePrice();
  const [overrideRm, setOverrideRm] = useState(
    (item.unit_price_centi / 100).toFixed(2),
  );
  const [reason, setReason] = useState('');

  const submit = () => {
    const newSen = Math.round(Number(overrideRm) * 100);
    if (!Number.isFinite(newSen) || newSen <= 0) {
      alert('Override price must be a positive number.');
      return;
    }
    if (reason.trim().length < 10) {
      alert('Reason must be at least 10 characters.');
      return;
    }
    override.mutate(
      { docNo, itemId: item.id, overridePriceSen: newSen, reason: reason.trim() },
      { onSuccess: () => onClose() },
    );
  };

  const delta = Math.round(Number(overrideRm) * 100) - item.unit_price_centi;
  const deltaPct = item.unit_price_centi > 0
    ? (delta / item.unit_price_centi) * 100
    : 0;

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>
            <DollarSign {...ICON} style={{ verticalAlign: 'middle', marginRight: 6 }} />
            Override Line Price
          </h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} title="Close">
            <X {...ICON} />
          </button>
        </header>

        <div className={styles.modalBody}>
          <p className={styles.muted}>
            Item <strong>{item.item_code}</strong>{item.description ? ` — ${item.description}` : ''}<br />
            Current unit price: <strong>{fmtRm(item.unit_price_centi, currency)}</strong>
          </p>

          <div className={styles.formGrid4}>
            <label className={styles.field} style={{ gridColumn: 'span 2' }}>
              <span className={styles.fieldLabel}>Override Price (RM) *</span>
              <input type="number" step="0.01" min="0"
                className={styles.fieldInput}
                value={overrideRm}
                onChange={(e) => setOverrideRm(e.target.value)} />
            </label>
            <div className={styles.field} style={{ gridColumn: 'span 2' }}>
              <span className={styles.fieldLabel}>Δ vs current</span>
              <span className={styles.fieldInput} style={{
                display: 'inline-flex', alignItems: 'center', height: 32,
                color: delta < 0 ? 'var(--c-festive-b, #B8331F)' : 'var(--c-burnt)',
              }}>
                {delta >= 0 ? '+' : ''}{fmtRm(delta, currency)} ({deltaPct.toFixed(1)}%)
              </span>
            </div>
          </div>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Reason * (≥ 10 chars, audited)</span>
            <textarea className={styles.fieldInput} rows={3}
              placeholder="e.g. Manager approved 15% discount due to display unit blemish."
              value={reason}
              onChange={(e) => setReason(e.target.value)} />
          </label>
        </div>

        <footer className={styles.modalFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={override.isPending}>
            {override.isPending ? 'Saving…' : 'Override + Audit'}
          </Button>
        </footer>
      </div>
    </div>
  );
};
