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

import {
  forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState,
  type CSSProperties,
} from 'react';
import { Link, useParams } from 'react-router';
import {
  ArrowLeft, FileText, Pencil, Trash2, Plus, X, Printer, Save,
  DollarSign, Lock, History, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { formatPhone } from '@2990s/shared/phone';
import { PhoneInput } from '../components/PhoneInput';
import {
  useMfgSalesOrderDetail,
  useUpdateMfgSalesOrderHeader,
  useUpdateMfgSalesOrderStatus,
  useAddMfgSalesOrderItem,
  useUpdateMfgSalesOrderItem,
  useDeleteMfgSalesOrderItem,
  useDebtorSearch,
  useOverrideMfgSoLinePrice,
  useSalesOrderAuditLog,
  useSalesOrderPayments,
  useAddSalesOrderPayment,
  useDeleteSalesOrderPayment,
  type DebtorSuggestion,
  type SoAuditEntry,
  type SoAuditFieldChange,
  type SoPayment,
} from '../lib/flow-queries';
import { useMfgProducts, useMaintenanceConfig } from '../lib/mfg-products-queries';
import {
  useLocalities,
  distinctStates,
  citiesInState,
  postcodesInCity,
  BUILDING_TYPES,
} from '../lib/localities-queries';
import { useStaff } from '../lib/admin-queries';
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
  /* PR #163 — customer's own SO number (their ERP reference). Already in
     schema since PR #121 but the Detail page never exposed it. Commander
     2026-05-27: "还需要顾客salesorder的reference在order details". */
  customer_so_no: string | null;
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
  /* PR #46 — POS handover */
  email: string | null;
  customer_type: string | null;
  salesperson_id: string | null;
  city: string | null;
  postcode: string | null;
  building_type: string | null;
  emergency_contact_name: string | null;
  emergency_contact_phone: string | null;
  emergency_contact_relationship: string | null;
  target_date: string | null;
  /* PR #143 + #150 — Payment. Installment is a sub-type of merchant
     (not its own top-level method). approval_code captured for the
     terminal auth slip. */
  payment_method: string | null;        // cash | transfer | merchant
  installment_months: number | null;    // 6 | 12 — NULL = normal swipe; valid only when method=merchant
  merchant_provider: string | null;     // GHL | HLB | MBB | PBB
  approval_code: string | null;
  payment_date: string | null;          // PR #157 — date funds received
  deposit_centi: number;
  paid_centi: number;
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
  /* PR-E — Per-item delivery date with cascade override flag.
     line_delivery_date null + overridden=false → display falls back to
     header.customer_delivery_date. Once the user types in the SoLineCard
     date input, overridden=true and the line keeps its own value even
     when the header date changes. */
  line_delivery_date: string | null;
  line_delivery_date_overridden: boolean;
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
  // PR-D — History panel toggle. Commander asked for the HOOKKA-style
  // floating right-side history drawer.
  const [historyOpen, setHistoryOpen] = useState(false);

  /* PR-A — Page-level Edit/Save framework. Default is read-only: all inputs
     are disabled, the "+ Add Line Item" button + per-line trash icons are
     hidden, and CustomerCard's own Save button is suppressed. Click Edit in
     the page header → entire page enters edit mode (CustomerCard inputs
     unlock, line-item actions appear, Edit button is replaced with Save +
     Cancel). Save commits via updateHeader; Cancel resets the local form.
     Status transitions remain accessible outside edit mode. */
  const [isEditing, setIsEditing] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const customerCardRef = useRef<CustomerCardHandle | null>(null);

  const enterEdit  = () => { setSaveError(null); setIsEditing(true); };
  const cancelEdit = () => {
    customerCardRef.current?.reset();
    setSaveError(null);
    setIsEditing(false);
  };
  const saveEdit = () => {
    const handle = customerCardRef.current;
    if (!handle) return;
    setSaveError(null);
    handle.save({
      onSuccess: () => setIsEditing(false),
      onError:   (msg) => setSaveError(msg),
    });
  };

  // Lock mechanism — once SO leaves DRAFT, edits require explicit override.
  // CANCELLED + CLOSED + INVOICED are also locked (terminal-ish states).
  // PR #145 + #146 — IN_PRODUCTION + READY_TO_SHIP removed from forward
  // flow (trading company). SHIPPED is now the earliest locked state —
  // once goods leave our hands, the SO header is no longer editable.
  const lockedStatuses: SoStatus[] = ['SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED'];

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
              {/* PR #163 — Total badge in title row so commander sees the SO
                  value the moment the page loads (was previously buried
                  inside the Payment card). */}
              <span style={{
                marginLeft: 'var(--space-2)',
                fontFamily: 'var(--font-mark)',
                fontSize: 'var(--fs-18)',
                fontWeight: 800,
                fontStretch: '80%',
                color: 'var(--c-burnt)',
              }}>
                {fmtRm(header.local_total_centi, header.currency)}
              </span>
            </h1>
            <p className={styles.subtitle}>
              SO date {header.so_date} · {header.line_count} {header.line_count === 1 ? 'line' : 'lines'}
              {header.po_doc_no && ` · Customer PO ${header.po_doc_no}`}
              {header.customer_so_no && ` · Customer SO Ref ${header.customer_so_no}`}
            </p>
          </div>
        </div>
        <div className={styles.actions}>
          <span className={`${styles.statusPill} ${STATUS_CLASS[header.status]}`}>
            {header.status.replace(/_/g, ' ')}
          </span>
          {/* PR-D — History drawer toggle. Commander 2026-05-27 wants a
              HOOKKA-style timeline showing who did what, when, and what
              changed. Reads from mfg_so_audit_log via useSalesOrderAuditLog. */}
          <Button variant="ghost" size="md" onClick={() => setHistoryOpen(true)}>
            <History {...ICON} />
            <span>History</span>
          </Button>
          <Button variant="ghost" size="md" onClick={handlePrint}>
            <Printer {...ICON} />
            <span>Print PDF</span>
          </Button>
          {/* PR-A — Page-level Edit/Save/Cancel. Default view is read-only
              (Edit shown). In edit mode, Edit is replaced by Save + Cancel.
              Edit is disabled while the SO is locked (e.g. SHIPPED+) unless
              the override is in effect. */}
          {!isEditing ? (
            <Button variant="primary" size="md"
              onClick={enterEdit} disabled={isLocked}>
              <Pencil {...ICON} />
              <span>Edit</span>
            </Button>
          ) : (
            <>
              <Button variant="ghost" size="md"
                onClick={cancelEdit} disabled={updateHeader.isPending}>
                <span>Cancel</span>
              </Button>
              <Button variant="primary" size="md"
                onClick={saveEdit} disabled={updateHeader.isPending}>
                <Save {...ICON} />
                <span>{updateHeader.isPending ? 'Saving…' : 'Save'}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* PR-A — Inline error from the page-level Save. Cleared on Edit /
          Cancel / next successful Save. */}
      {saveError && (
        <div className={styles.bannerWarn}>
          <strong>Save failed.</strong>
          <span>{saveError}</span>
        </div>
      )}

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
        ref={customerCardRef}
        header={header}
        onSave={(patch, cb) => updateHeader.mutate(
          { docNo: header.doc_no, ...patch },
          {
            onSuccess: () => cb?.onSuccess?.(),
            onError:   (e) => cb?.onError?.(e instanceof Error ? e.message : String(e)),
          },
        )}
        saving={updateHeader.isPending}
        locked={isLocked}
        isEditing={isEditing}
      />

      {/* PR #140 — Commander 2026-05-26: "这个 multi address、customer PO
          这些是什么？" The Multi-Address · Customer PO · Schedule card was
          a HOOKKA leftover (ship-to / bill-to / install-to / customer PO
          No / PO ID / PO Date). We don't model 3-way addresses or track
          the customer's own PO numbers. Dropped entirely; Processing
          Date + Delivery Date now live inside the Customer card below. */}

      {/* ── Line items ──────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({items.length})</h2>
          {/* PR-A — Add Line Item is only shown in edit mode. */}
          {isEditing && (
            <Button variant="primary" size="sm" onClick={() => setAdding(true)} disabled={isLocked}>
              <Plus {...ICON} />
              <span>Add Line Item</span>
            </Button>
          )}
        </header>

        {items.length === 0 ? (
          <p className={styles.emptyRow}>No items yet — click "Add Line Item" to begin.</p>
        ) : (
          <table className={styles.table}>
            <thead>
              {/* PR #144 — Group column removed ("group是什么 删掉").
                  Category is already visible as a colored badge inside
                  the item's variant pills, so the raw "mfg_product"
                  internal kind isn't useful in the table view. */}
              <tr>
                <th>Item</th>
                <th className={styles.tableRight}>Qty</th>
                <th className={styles.tableRight}>Unit</th>
                <th className={styles.tableRight}>Disc</th>
                {/* PR-E — Per-line delivery date. Falls back to the SO
                    header date when the line hasn't been overridden. */}
                <th className={styles.tableRight}>Delivery</th>
                <th className={styles.tableRight}>Total</th>
                <th className={styles.tableRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                /* PR-E — Display fallback: a line whose own date is null
                   AND that hasn't been overridden displays the SO header's
                   customer_delivery_date with a small "· auto" marker. The
                   API cascade keeps line_delivery_date populated for
                   non-overridden lines after each header save, so this
                   fallback mostly serves rows from before migration 0074
                   landed. */
                const displayDate = it.line_delivery_date
                  ?? (!it.line_delivery_date_overridden ? header.customer_delivery_date : null);
                const isAuto = !it.line_delivery_date_overridden;
                return (
                <tr key={it.id}>
                  <td>
                    <div className={styles.codeCell}>{it.item_code}</div>
                    {it.description && <div className={styles.muted}>{it.description}</div>}
                    <VariantsPills variants={it.variants} />
                  </td>
                  <td className={styles.tableRight}>{it.qty}</td>
                  <td className={styles.tableRight}>{fmtRm(it.unit_price_centi, header.currency)}</td>
                  <td className={styles.tableRight}>{it.discount_centi > 0 ? fmtRm(it.discount_centi, header.currency) : '—'}</td>
                  <td className={styles.tableRight}>
                    {displayDate ? (
                      <span style={isAuto ? { color: 'var(--fg-muted)' } : undefined}>
                        {displayDate}
                        {isAuto && (
                          <span style={{ marginLeft: 4, color: 'var(--c-orange)', fontSize: 'var(--fs-11)' }}>· auto</span>
                        )}
                      </span>
                    ) : '—'}
                  </td>
                  <td className={styles.priceCell}>{fmtRm(it.total_centi, header.currency)}</td>
                  <td>
                    {/* PR-A — Line-item Edit / Override / Delete actions are
                        only rendered in edit mode. Read-only view shows an
                        em-dash placeholder so the column doesn't collapse. */}
                    {isEditing ? (
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
                    ) : (
                      <span className={styles.muted}>—</span>
                    )}
                  </td>
                </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      {/* PR #154 — Commander 2026-05-27: "这个东西先hide起来" → Totals ·
          Margin card hidden for now. Margin tracking still happens
          server-side (total_cost_centi / total_margin_centi columns
          persist), but the public-facing UI doesn't surface cost to
          everyone. To restore: uncomment <TotalsCard /> below. */}
      {/* <TotalsCard header={header} /> */}

      {/* ── Payment (PR #143 → rebuilt as transactions ledger in PR-C) ── */}
      {/* Post-merge stitch — collapse PR-A's isEditing into PR-C's existing
          `locked` gate so the + Add Payment button + trash icons disappear
          when the page is in read-only mode. Status-lock OR not-editing
          both make PaymentCard immutable from the user's perspective. */}
      <PaymentCard
        header={header}
        onSave={(patch) => updateHeader.mutate({ docNo: header.doc_no, ...patch })}
        saving={updateHeader.isPending}
        locked={isLocked || !isEditing}
      />

      {/* ── Status flow ─────────────────────────────────────────── */}
      {/* PR #144 — Commander 2026-05-26 gating rule:
            1. 没 Processing Date → bedframe variants 可以不填，自由 proceed
            2. 有 Processing Date → bedframe 的 fabric / color / design / total
               height / divan / leg / gap 必须都填齐才能 proceed
          Rule encoded server-agnostic on the client: if processingDate is
          set, scan bedframe items' variants. If any of the canonical
          variant keys (divanHeight / legHeight / gap / fabricCode) is
          missing on a bedframe line, block the next-stage transition. */}
      {(() => {
        /* PR #144 / #156 — Processing-Date gating.
           Commander 2026-05-27 broadened: "variant 也没有补完" — sofa
           lines ALSO need their seat/leg/fabric set when Processing Date is
           on, not just bedframe. Each category has its own required keys: */
        const requireVariants = !!header.internal_expected_dd;
        const REQUIRED_BY_CATEGORY: Record<string, readonly string[]> = {
          bedframe: ['divanHeight', 'legHeight', 'gap', 'fabricCode'],
          sofa:     ['seatHeight',  'legHeight', 'fabricCode'],
        };
        const incompleteLines = requireVariants
          ? items
              .filter((it) => REQUIRED_BY_CATEGORY[(it.item_group ?? '').toLowerCase()])
              .filter((it) => {
                const keys = REQUIRED_BY_CATEGORY[(it.item_group ?? '').toLowerCase()] ?? [];
                const v = (it.variants ?? {}) as Record<string, unknown>;
                return keys.some((k) => {
                  const val = v[k];
                  return val === undefined || val === null || val === '';
                });
              })
              .map((it) => ({ code: it.item_code, group: (it.item_group ?? '').toLowerCase() }))
          : [];
        const gated = incompleteLines.length > 0;
        const formatGroupRequirements = (g: string) =>
          g === 'bedframe' ? 'Divan · Leg · Gap · Fabric' :
          g === 'sofa'     ? 'Seat · Leg · Fabric' : '';
        return (
          <>
            {gated && (
              <div style={{
                background: 'rgba(184, 51, 31, 0.08)',
                border: '1px solid var(--c-festive-b, #B8331F)',
                color: 'var(--c-festive-b, #B8331F)',
                padding: 'var(--space-3) var(--space-4)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--fs-13)',
              }}>
                <strong>Processing Date is set — line variants must be filled before next stage.</strong>
                <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                  {incompleteLines.map((l, i) => (
                    <div key={i}>
                      • <code>{l.code}</code> ({l.group}): {formatGroupRequirements(l.group)}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <StatusBar
              status={header.status}
              onTransition={(s) => {
                if (gated) {
                  window.alert(
                    'Processing Date is set, so all line variants must be filled before moving to the next stage.\n\n' +
                    'Incomplete:\n' + incompleteLines.map((l) => `  ${l.code} (${l.group})`).join('\n'),
                  );
                  return;
                }
                updateStatus.mutate({ docNo: header.doc_no, status: s });
              }}
              pending={updateStatus.isPending}
            />
          </>
        );
      })()}

      {/* Followup #85 — the standalone StatusTimeline + PriceOverridePanel
          audit cards were superseded by the PR-D History drawer, which
          shows ALL action types (CREATE / UPDATE_DETAILS / UPDATE_STATUS /
          ADD_LINE / UPDATE_LINE / DELETE_LINE / ADD_PAYMENT / …) in one
          unified feed. The underlying mfg_so_status_changes and
          mfg_so_price_overrides tables stay (writes continue), so old
          data remains queryable — only the rendering is removed. */}

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

      {/* PR-D — History drawer ─────────────────────────────────── */}
      {historyOpen && (
        <HistoryPanel docNo={header.doc_no} onClose={() => setHistoryOpen(false)} />
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Customer info card — editable, with debtor autocomplete
   ════════════════════════════════════════════════════════════════════════ */

/* PR-A — Imperative handle for the page-level Edit/Save framework.
   The parent calls save() with onSuccess/onError callbacks; reset() reverts
   the local form to the current header snapshot (used by Cancel). */
type CustomerCardHandle = {
  save: (cb: { onSuccess: () => void; onError: (msg: string) => void }) => void;
  reset: () => void;
};

type CustomerCardProps = {
  header: SoHeader;
  /** PR-A — Optional callbacks let the parent's page-level Save flow know
      when the mutation succeeded or failed, so it can return to read-only /
      surface an inline error. The per-card Save button (legacy) still works
      without callbacks. */
  onSave: (
    patch: Record<string, unknown>,
    cb?: { onSuccess?: () => void; onError?: (msg: string) => void },
  ) => void;
  saving: boolean;
  /** When true, disable input editing — accepted but consumer must show
      the visual lock. We keep the prop optional so existing call sites
      compile. */
  locked?: boolean;
  /** PR-A — Page-level edit mode. When false (default), every input in this
      card is disabled and the per-card Save button is hidden — the parent
      page renders Edit/Save/Cancel in its own header. */
  isEditing?: boolean;
};

const CustomerCard = forwardRef<CustomerCardHandle, CustomerCardProps>(({
  header,
  onSave,
  /* PR-A — `saving` prop kept on the type for compatibility but the
     per-card Save button it drove was removed. The page-level Save in
     SalesOrderDetail's header now surfaces the in-flight spinner. */
  saving: _saving,
  locked = false,
  isEditing = false,
}, ref) => {
  // PR #39 — POS-aligned customer + address form. Maps:
  //   • address1, address2 → free-text lines (POS "Address line 1/2")
  //   • address3           → city (cascade from localities)
  //   • address4           → postcode (cascade from city)
  //   • customer_state     → state (cascade source — PR #35 column)
  //   • venue              → reused for Building Type (POS dropdown)
  // Agent + Branding kept (B2B-specific, commander 2026-05-26).
  // POS field "Salesperson" → Agent column on the SO.
  const localities = useLocalities();
  const localityRows = localities.data ?? [];
  const staffQ = useStaff();
  const staffList = (staffQ.data ?? []).filter((s) => s.active);

  /* PR #46 — Form shape now matches POS handover schema. Renamed
     debtor → customer; building_type promoted to proper column;
     branding + ref + venue dropped per commander 2026-05-26. */
  // PR #140 — Commander 2026-05-26 drop list:
  //   - poDocNo (Customer PO #)   → "customer PO 不需要"
  //   - targetDate                → replaced by Processing + Delivery Date
  // PR #140 — add list:
  //   - processingDate (= internal_expected_dd column, just renamed for UI)
  //   - customerDeliveryDate
  // The DB column `internal_expected_dd` stays — only the label changes.
  /* PR-A — initialFormFor() is the single source-of-truth for what the
     local form looks like when reset (Cancel) or when the header reloads
     after a successful Save. Keeps the snapshot + reset paths consistent. */
  const initialFormFor = (h: SoHeader) => ({
    /* customerCode kept in state but the UI no longer renders an input
       (commander 2026-05-27: "customer code 不需要"). Payload still sends
       debtorCode so the server-side mapping is unchanged. */
    customerCode: h.debtor_code ?? '',
    customerName: h.debtor_name ?? '',
    /* PR-A — customer's own SO reference number (their ERP doc no). The
       column has existed since PR #121; this exposes it as an editable
       field inside the Customer sub-section. */
    customerSoNo: h.customer_so_no ?? '',
    email: h.email ?? '',
    customerType: h.customer_type ?? '',
    salespersonId: h.salesperson_id ?? '',
    buildingType: h.building_type ?? '',
    /* PR #156 — Commander 2026-05-27: "开单的 venue 呢也没有". Reinstate
       venue as a free-text field separate from Building Type. */
    venue: h.venue ?? '',
    phone: h.phone ?? '',
    address1: h.address1 ?? '',
    address2: h.address2 ?? '',
    city: h.city ?? h.address3 ?? '',
    postcode: h.postcode ?? h.address4 ?? '',
    state: h.customer_state ?? '',
    emergencyContactName: h.emergency_contact_name ?? '',
    emergencyContactPhone: h.emergency_contact_phone ?? '',
    emergencyContactRelationship: h.emergency_contact_relationship ?? '',
    processingDate: h.internal_expected_dd ?? '',
    customerDeliveryDate: h.customer_delivery_date ?? '',
    note: h.note ?? '',
  });

  const [form, setForm] = useState(() => initialFormFor(header));
  const [showSuggest, setShowSuggest] = useState(false);
  const debtorQuery = useDebtorSearch(form.customerName);
  const suggestions = (debtorQuery.data?.debtors ?? []).filter(
    (d) => (d.debtor_name ?? '').toLowerCase() !== form.customerName.trim().toLowerCase(),
  );

  useEffect(() => {
    setForm(initialFormFor(header));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [header]);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  // Cascade derivations
  const states = useMemo(() => distinctStates(localityRows), [localityRows]);
  const cities = useMemo(
    () => (form.state ? citiesInState(localityRows, form.state) : []),
    [localityRows, form.state],
  );
  const postcodes = useMemo(
    () => (form.state && form.city ? postcodesInCity(localityRows, form.state, form.city) : []),
    [localityRows, form.state, form.city],
  );

  const applySuggestion = (d: DebtorSuggestion) => {
    setForm((s) => ({
      ...s,
      customerCode: d.debtor_code ?? s.customerCode,
      customerName: d.debtor_name ?? s.customerName,
      phone: d.phone ?? s.phone,
      address1: d.address1 ?? s.address1,
      address2: d.address2 ?? s.address2,
      city: d.address3 ?? s.city,
      postcode: d.address4 ?? s.postcode,
    }));
    setShowSuggest(false);
  };

  /* PR #46 — Payload uses the proper column names now. Sales Location +
     Agent are NOT in this form — they auto-populate from the logged-in
     POS user (Sales Location = staff.showroom; Agent legacy column kept
     for B2B manual cases). */
  const buildPayload = () => ({
    debtorCode: form.customerCode,
    debtorName: form.customerName,
    /* PR-A — Persist customer's own SO ref. Empty string → null so we
       clear the column when the field is blanked. */
    customerSoNo: form.customerSoNo || null,
    email: form.email,
    customerType: form.customerType,
    salespersonId: form.salespersonId || null,
    buildingType: form.buildingType,
    venue: form.venue,
    phone: form.phone,
    address1: form.address1,
    address2: form.address2,
    city: form.city,
    postcode: form.postcode,
    customerState: form.state,
    emergencyContactName: form.emergencyContactName,
    emergencyContactPhone: form.emergencyContactPhone,
    emergencyContactRelationship: form.emergencyContactRelationship,
    /* PR #140 — Processing Date persists to internal_expected_dd column
       (renamed in the UI per commander 2026-05-26: "internal expected date
       是 Hookka 用的"). targetDate field dropped. */
    internalExpectedDd: form.processingDate || null,
    customerDeliveryDate: form.customerDeliveryDate || null,
    note: form.note,
  });

  /* PR #156 — Commander 2026-05-27: "为什么能 save processing date 呢
     没有 delivery date 而且 variant 也没有补完". Mirror the New SO form's
     XOR rule on Detail Save: block when only one of Processing/Delivery
     Date is set. */
  const datesXor =
    (form.processingDate.trim() !== '') !== (form.customerDeliveryDate.trim() !== '');

  const trySave = (cb?: { onSuccess?: () => void; onError?: (msg: string) => void }) => {
    if (datesXor) {
      const msg =
        'Processing Date and Delivery Date must be set together.\n\n' +
        'Either fill in BOTH dates, or leave BOTH empty.';
      if (cb?.onError) cb.onError(msg);
      else window.alert(msg);
      return;
    }
    onSave(buildPayload(), cb);
  };

  /* PR-A — Expose imperative save()/reset() so the page-level Edit/Save/
     Cancel buttons can drive this card without lifting all of its form
     state to the parent. No deps array → handle re-binds every render so
     `save` always closes over the latest form snapshot. */
  useImperativeHandle(ref, () => ({
    save: (cb) => trySave(cb),
    reset: () => setForm(initialFormFor(header)),
  }));

  /* PR-A — Inputs are read-only when the page isn't in edit mode OR the
     SO is locked (post-SHIPPED). Combining both keeps the existing lock
     semantics intact. */
  const inputsDisabled = !isEditing || locked;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Customer · Addresses</h2>
        {/* PR-A — Per-card Save removed. The page-level Save in the page
            header is now the single commit point for header edits. */}
      </header>
      <div className={styles.cardBody}>
        {/* ── 1. Customer ───────────────────────────────────────────── */}
        {/* PR #163 — Commander 2026-05-27: "这些全部资料挤在一起 也是要
            整理一下". Split into 4 visually-divided sub-sections with
            top-border separators (.subSection). Each sub-section has its
            own subhead. Fields regrouped so identification stays separate
            from order scheduling. */}
        <div className={styles.subSection}>
          <p className={styles.subHead}>Customer</p>
          {/* PR-A — Customer Code input removed (commander 2026-05-27:
              "customer code 不需要"). Field still flows through state +
              payload so the server-side mapping is untouched.
              Customer SO Ref added next to Customer Name. */}
          <div className={styles.formGrid4}>
            <label className={styles.field} style={{ gridColumn: 'span 3' }}>
              <span className={styles.fieldLabel}>Customer Name *</span>
              <input
                className={styles.fieldInput}
                value={form.customerName}
                disabled={inputsDisabled}
                onChange={(e) => { set('customerName', e.target.value); setShowSuggest(true); }}
                onFocus={() => setShowSuggest(true)}
                onBlur={() => setTimeout(() => setShowSuggest(false), 150)}
              />
              {showSuggest && suggestions.length > 0 && !inputsDisabled && (
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
                          {d.debtor_code ?? ''}{d.debtor_code && d.phone ? ' · ' : ''}{formatPhone(d.phone) || ''}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer SO Ref</span>
              <input className={styles.fieldInput} value={form.customerSoNo}
                placeholder="Their PO / SO number"
                disabled={inputsDisabled}
                onChange={(e) => set('customerSoNo', e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Phone *</span>
              {/* Task #91 — PhoneInput normalizes to E.164 on blur and shows
                  the pretty Malaysian format when unfocused. */}
              <PhoneInput
                className={styles.fieldInput}
                value={form.phone}
                disabled={inputsDisabled}
                onChange={(v) => set('phone', v)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Email *</span>
              <input type="email" className={styles.fieldInput} value={form.email}
                disabled={inputsDisabled}
                onChange={(e) => set('email', e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer Type</span>
              <select className={styles.fieldSelect} value={form.customerType}
                disabled={inputsDisabled}
                onChange={(e) => set('customerType', e.target.value)}>
                <option value="">—</option>
                <option value="NEW">New</option>
                <option value="EXISTING">Existing</option>
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Salesperson</span>
              <select className={styles.fieldSelect} value={form.salespersonId}
                disabled={inputsDisabled}
                onChange={(e) => set('salespersonId', e.target.value)}>
                <option value="">— Pick staff —</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.staffCode})</option>
                ))}
              </select>
            </label>
          </div>
        </div>

        {/* ── 2. Order Info (venue / dates / note) ──────────────────── */}
        <div className={styles.subSection}>
          <p className={styles.subHead}>Order Info</p>
          <div className={styles.formGrid4}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Building Type</span>
              <select className={styles.fieldSelect} value={form.buildingType}
                disabled={inputsDisabled}
                onChange={(e) => set('buildingType', e.target.value)}>
                <option value="">—</option>
                {BUILDING_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Venue</span>
              <input className={styles.fieldInput} value={form.venue}
                placeholder="e.g. KL Showroom, Penang Branch"
                disabled={inputsDisabled}
                onChange={(e) => set('venue', e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Processing Date</span>
              <input type="date" className={styles.fieldInput} value={form.processingDate}
                disabled={inputsDisabled}
                onChange={(e) => set('processingDate', e.target.value)}
                style={datesXor && !form.processingDate ? { borderColor: 'var(--c-festive-b, #B8331F)' } : undefined} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Delivery Date</span>
              <input type="date" className={styles.fieldInput} value={form.customerDeliveryDate}
                disabled={inputsDisabled}
                onChange={(e) => set('customerDeliveryDate', e.target.value)}
                style={datesXor && !form.customerDeliveryDate ? { borderColor: 'var(--c-festive-b, #B8331F)' } : undefined} />
            </label>
            <label className={`${styles.field}`} style={{ gridColumn: 'span 4' }}>
              <span className={styles.fieldLabel}>Note</span>
              <input className={styles.fieldInput} value={form.note}
                disabled={inputsDisabled}
                onChange={(e) => set('note', e.target.value)} />
            </label>
          </div>
          {datesXor && (
            <div
              style={{
                background: 'rgba(184, 51, 31, 0.08)',
                border: '1px solid var(--c-festive-b, #B8331F)',
                color: 'var(--c-festive-b, #B8331F)',
                padding: '4px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--fs-11)',
                fontWeight: 600,
                marginTop: 'var(--space-2)',
              }}
            >
              ⚠ Processing Date and Delivery Date must be set together — Save is blocked.
            </div>
          )}
        </div>

        {/* ── 3. Emergency Contact ──────────────────────────────────── */}
        <div className={styles.subSection}>
          <p className={styles.subHead}>
            Emergency Contact
            <span className={styles.muted} style={{ fontWeight: 400, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>
              — used only if we can't reach the customer on delivery day
            </span>
          </p>
          <div className={styles.formGrid4}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Contact Name</span>
              <input className={styles.fieldInput} value={form.emergencyContactName}
                placeholder="e.g. Lim Mei Hua"
                disabled={inputsDisabled}
                onChange={(e) => set('emergencyContactName', e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Relationship</span>
              <input className={styles.fieldInput} value={form.emergencyContactRelationship}
                placeholder="Spouse / Parent / Sibling …"
                disabled={inputsDisabled}
                onChange={(e) => set('emergencyContactRelationship', e.target.value)} />
            </label>
            <label className={styles.field} style={{ gridColumn: 'span 2' }}>
              <span className={styles.fieldLabel}>Phone</span>
              <PhoneInput
                className={styles.fieldInput}
                value={form.emergencyContactPhone}
                disabled={inputsDisabled}
                onChange={(v) => set('emergencyContactPhone', v)}
              />
            </label>
          </div>
        </div>

        {/* ── 4. Delivery Address ───────────────────────────────────── */}
        <div className={styles.subSection}>
          <p className={styles.subHead}>Delivery Address</p>
          <div className={styles.formGrid4}>
            <label className={`${styles.field}`} style={{ gridColumn: 'span 4' }}>
              <span className={styles.fieldLabel}>Address Line 1</span>
              <input className={styles.fieldInput} value={form.address1}
                placeholder="Unit, street, area"
                disabled={inputsDisabled}
                onChange={(e) => set('address1', e.target.value)} />
            </label>
            <label className={`${styles.field}`} style={{ gridColumn: 'span 4' }}>
              <span className={styles.fieldLabel}>Address Line 2</span>
              <input className={styles.fieldInput} value={form.address2}
                placeholder="Apt, floor, building (optional)"
                disabled={inputsDisabled}
                onChange={(e) => set('address2', e.target.value)} />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>State</span>
              <select className={styles.fieldSelect} value={form.state}
                onChange={(e) => setForm((s) => ({ ...s, state: e.target.value, city: '', postcode: '' }))}
                disabled={inputsDisabled || localities.isLoading}>
                <option value="">{localities.isLoading ? 'Loading…' : 'Pick state'}</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>City</span>
              <select className={styles.fieldSelect} value={form.city}
                onChange={(e) => setForm((s) => ({ ...s, city: e.target.value, postcode: '' }))}
                disabled={inputsDisabled || !form.state}>
                <option value="">{form.state ? 'Pick city' : '— pick state first'}</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Postcode</span>
              <select className={styles.fieldSelect} value={form.postcode}
                onChange={(e) => set('postcode', e.target.value)}
                disabled={inputsDisabled || !form.city}>
                <option value="">{form.city ? 'Pick postcode' : '— pick city first'}</option>
                {postcodes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Sales Location</span>
              <span className={styles.fieldInput} style={{
                display: 'inline-flex', alignItems: 'center', height: 26,
                color: 'var(--fg-muted)',
              }}>
                {header.sales_location ?? '—'}
              </span>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
});
CustomerCard.displayName = 'CustomerCard';

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

/* PR #145 + #146 — Commander 2026-05-26: trading company flow.
   - "2990 整套系统是 trading 公司来的，不需要 in production" → drop IN_PRODUCTION
   - "ready to ship 和 in production 整个删掉" → drop READY_TO_SHIP too.
     Goods sit in our warehouse, no "ready to ship" intermediate stage;
     SHIPPED captures the moment they leave.
   Final flow:
     DRAFT → CONFIRMED → SHIPPED → DELIVERED → INVOICED → CLOSED
   The DB enum still carries IN_PRODUCTION / READY_TO_SHIP rows from
   pre-#146 records; the fallback rows below let the UI forward those
   directly to SHIPPED instead of crashing. */
const NEXT: Record<SoStatus, SoStatus[]> = {
  DRAFT:          ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:      ['SHIPPED', 'CANCELLED'],
  IN_PRODUCTION:  ['SHIPPED', 'CANCELLED'], // legacy
  READY_TO_SHIP:  ['SHIPPED'],              // legacy
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

  // PR #39 — Track the FULL picked product so we can read
  // seat_height_prices for sofa pricing. Sofa tier defaults to PRICE_2
  // (the "base"), commander can change later via "Override price".
  const [picked, setPicked] = useState<import('../lib/mfg-products-queries').MfgProductRow | null>(null);

  // Manual unit-price override — when commander types in the Unit Price
  // box, we stop auto-recomputing. Tracked separately so any variant
  // change doesn't overwrite their edit.
  const [manualPrice, setManualPrice] = useState(false);

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
    setPicked(p);
    setManualPrice(false);
    setDraft((s) => ({
      ...s,
      itemCode: p.code,
      itemGroup: p.category.toLowerCase(),
      description: p.name,
      unitPriceCenti: p.base_price_sen ?? 0,
      variants: {},                              // reset variants on new product
    }));
    setSearch(p.code);
  };

  const setVariant = (k: string, v: string | number) =>
    setDraft((s) => ({ ...s, variants: { ...s.variants, [k]: v } }));

  /* ── Auto-recompute unit price from base + variant surcharges ─────
     Formula matches HOOKKA pricing.ts:
       unitPriceSen = basePriceSen + divanPriceSen + legPriceSen + specialSen
     For Sofa: basePriceSen comes from product.seat_height_prices
     when a seat height is picked (defaults to PRICE_2 tier).
     For Bedframe: basePriceSen is the product's base_price_sen.
     Skip if user has manually overridden the price. */
  useEffect(() => {
    if (manualPrice || !maint || !picked) return;
    const category = draft.itemGroup.toUpperCase();
    let basePriceSen = picked.base_price_sen ?? 0;
    let extraSen = 0;

    if (category === 'SOFA') {
      // Sofa base price comes from seat_height_prices (PRICE_2 default tier)
      const sh = String(draft.variants.seatHeight ?? '');
      if (sh && Array.isArray(picked.seat_height_prices)) {
        const match = (picked.seat_height_prices as Array<{ height: string; tier: string; priceSen: number }>)
          .find((p) => p.height === sh && p.tier === 'PRICE_2');
        if (match) basePriceSen = match.priceSen;
      }
      const legV = String(draft.variants.legHeight ?? '');
      const specV = String(draft.variants.special ?? '');
      extraSen += maint.sofaLegHeights.find((o) => o.value === legV)?.priceSen ?? 0;
      extraSen += maint.sofaSpecials.find((o) => o.value === specV)?.priceSen ?? 0;
    } else if (category === 'BEDFRAME') {
      const divanV = String(draft.variants.divanHeight ?? '');
      const legV = String(draft.variants.legHeight ?? '');
      const specV = String(draft.variants.special ?? '');
      extraSen += maint.divanHeights.find((o) => o.value === divanV)?.priceSen ?? 0;
      extraSen += maint.legHeights.find((o) => o.value === legV)?.priceSen ?? 0;
      extraSen += maint.specials.find((o) => o.value === specV)?.priceSen ?? 0;
    }

    const newPrice = basePriceSen + extraSen;
    setDraft((s) => (s.unitPriceCenti === newPrice ? s : { ...s, unitPriceCenti: newPrice }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked, draft.variants, draft.itemGroup, maint, manualPrice]);

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
                    label="Seat Height"
                    options={maint.sofaSizes.map((s) => {
                      // Surface the product's PRICE_2 sen for this height as
                      // hint, so the dropdown shows e.g. "28 (RM 649.00)".
                      const sh = picked?.seat_height_prices && Array.isArray(picked.seat_height_prices)
                        ? (picked.seat_height_prices as Array<{ height: string; tier: string; priceSen: number }>)
                            .find((p) => p.height === s && p.tier === 'PRICE_2')
                        : null;
                      return { value: s, priceSen: sh?.priceSen ?? 0 };
                    })}
                    value={String(draft.variants.seatHeight ?? '')}
                    onChange={(v) => setVariant('seatHeight', v)}
                  />
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
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Fabric Color (free text)</span>
                    <input
                      className={styles.fieldInput}
                      value={String(draft.variants.fabricColor ?? '')}
                      onChange={(e) => setVariant('fabricColor', e.target.value)}
                    />
                  </label>
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
                <span className={styles.fieldLabel}>
                  Unit Price (RM)
                  {!manualPrice && picked && (
                    <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-orange)' }}>
                      · auto
                    </span>
                  )}
                </span>
                <input type="number" step="0.01" className={styles.fieldInput}
                  value={(draft.unitPriceCenti / 100).toFixed(2)}
                  onChange={(e) => {
                    setManualPrice(true);
                    setDraft((s) => ({ ...s, unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0 }));
                  }} />
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
   PaymentCard — PR #163. HOOKKA-style transactions ledger.

   Each payment is one row in mfg_sales_order_payments (migration 0073) —
   no more single-row "current payment" overwrite. Sum of amount_centi =
   "Deposit Paid"; balance = local_total_centi − paid.

   Legacy header columns (payment_method, merchant_provider, installment_
   months, approval_code, payment_date, paid_centi) still exist in the
   schema but the UI no longer reads or writes them — they'll be dropped
   in a follow-up migration once live data is migrated.

   `depositCenti` stays on the header as the EXPECTED deposit target
   (e.g. 50% rule), distinct from the paid total.
   ════════════════════════════════════════════════════════════════════════ */

type PaymentMethod = 'merchant' | 'transfer' | 'cash';
type MerchantProvider = 'GHL' | 'HLB' | 'MBB' | 'PBB';

const METHOD_LABEL: Record<PaymentMethod, string> = {
  merchant: 'Merchant',
  transfer: 'Transfer',
  cash:     'Cash',
};

const methodPillStyle = (m: PaymentMethod): CSSProperties => {
  // Burnt for merchant, green for transfer, neutral muted for cash.
  const bg =
    m === 'merchant' ? 'rgba(232, 107, 58, 0.12)' :
    m === 'transfer' ? 'rgba(47, 93, 79, 0.12)'   :
                       'rgba(0, 0, 0, 0.06)';
  const fg =
    m === 'merchant' ? 'var(--c-burnt)' :
    m === 'transfer' ? 'var(--c-secondary-a, #2F5D4F)' :
                       'var(--fg-muted)';
  return {
    display: 'inline-block',
    fontFamily: 'var(--font-sans)',
    fontSize: 'var(--fs-11)',
    fontWeight: 600,
    padding: '1px 8px',
    borderRadius: 'var(--radius-pill)',
    background: bg,
    color: fg,
    letterSpacing: '0.02em',
  };
};

const PaymentCard = ({
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
  const grandTotal = header.local_total_centi ?? 0;
  const half = Math.round(grandTotal / 2);

  const paymentsQ = useSalesOrderPayments(header.doc_no);
  const payments = paymentsQ.data ?? [];
  const addPayment = useAddSalesOrderPayment();
  const deletePayment = useDeleteSalesOrderPayment();
  const staff = useStaff();

  /* ── Deposit (expected target on the header) ───────────────────────── */
  const [depositCenti, setDepositCenti] = useState<number>(header.deposit_centi ?? 0);
  useEffect(() => { setDepositCenti(header.deposit_centi ?? 0); }, [header.deposit_centi]);
  const saveDeposit = () => onSave({ depositCenti });

  /* ── Inline add-payment row ─────────────────────────────────────────── */
  const today = new Date().toISOString().slice(0, 10);
  const blankForm = {
    paidAt: today,
    method: 'merchant' as PaymentMethod,
    merchantProvider: 'GHL' as MerchantProvider | '',
    installmentMonths: '' as '' | '6' | '12',
    approvalCode: '',
    amountCenti: 0,
    accountSheet: '',
    collectedBy: '',
    note: '',
  };
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(blankForm);

  const resetForm = () => setForm({ ...blankForm, paidAt: new Date().toISOString().slice(0, 10) });

  const submitNew = () => {
    if (!form.method) return;
    if (!form.amountCenti || form.amountCenti <= 0) return;
    const body: Record<string, unknown> = {
      docNo:        header.doc_no,
      paidAt:       form.paidAt,
      method:       form.method,
      amountCenti:  form.amountCenti,
      approvalCode: form.approvalCode || null,
      accountSheet: form.accountSheet || null,
      collectedBy:  form.collectedBy  || null,
      note:         form.note         || null,
    };
    if (form.method === 'merchant') {
      body.merchantProvider  = form.merchantProvider || null;
      body.installmentMonths = form.installmentMonths ? Number(form.installmentMonths) : null;
    }
    addPayment.mutate(body as { docNo: string } & Record<string, unknown>, {
      onSuccess: () => { setAdding(false); resetForm(); },
    });
  };

  /* ── Summary ───────────────────────────────────────────────────────── */
  const paidCenti = payments.reduce((sum, p) => sum + (p.amount_centi || 0), 0);
  const balanceCenti = Math.max(0, grandTotal - paidCenti);
  const isFullPaid = grandTotal > 0 && paidCenti >= grandTotal;
  const isHalfPaid = paidCenti > 0 && paidCenti >= half && paidCenti < grandTotal;

  const staffNameById = (id: string | null): string | null => {
    if (!id) return null;
    return staff.data?.find((s) => s.id === id)?.name ?? null;
  };

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Payment</h2>
      </header>
      <div className={styles.cardBody}>
        {/* ── Transactions table ─────────────────────────────────────── */}
        <p className={styles.subHead}>Transactions</p>
        {paymentsQ.isLoading ? (
          <p className={styles.fieldLabel}>Loading…</p>
        ) : payments.length === 0 && !adding ? (
          <p className={styles.muted} style={{ fontSize: 'var(--fs-12)' }}>
            No payments recorded yet.
          </p>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Date</th>
                <th>Method</th>
                <th className={styles.tableRight}>Amount</th>
                <th>Account Sheet</th>
                <th>Approval Code</th>
                <th>Collected By</th>
                <th style={{ width: 36 }}></th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p: SoPayment) => (
                <tr key={p.id}>
                  <td style={{ fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>
                    {p.paid_at}
                  </td>
                  <td>
                    <span style={methodPillStyle(p.method)}>{METHOD_LABEL[p.method]}</span>
                    {p.method === 'merchant' && p.merchant_provider && (
                      <span className={styles.muted} style={{ marginLeft: 6, fontSize: 'var(--fs-11)' }}>
                        · {p.merchant_provider}
                        {p.installment_months ? ` · ${p.installment_months}m` : ''}
                      </span>
                    )}
                  </td>
                  <td className={styles.tableRight} style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                    {fmtRm(p.amount_centi, header.currency)}
                  </td>
                  <td>{p.account_sheet ?? <span className={styles.muted}>—</span>}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>
                    {p.approval_code ?? <span className={styles.muted}>—</span>}
                  </td>
                  <td>{p.collected_by_name ?? staffNameById(p.collected_by) ?? <span className={styles.muted}>—</span>}</td>
                  <td>
                    <button
                      type="button"
                      disabled={locked || deletePayment.isPending}
                      onClick={() => {
                        if (confirm(`Delete this ${METHOD_LABEL[p.method]} payment of ${fmtRm(p.amount_centi, header.currency)}?`)) {
                          deletePayment.mutate({ docNo: header.doc_no, id: p.id });
                        }
                      }}
                      title="Delete payment"
                      style={{
                        background: 'transparent', border: 'none', padding: 4,
                        cursor: locked ? 'not-allowed' : 'pointer',
                        color: 'var(--c-festive-b)',
                      }}
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  </td>
                </tr>
              ))}

              {/* Inline add-payment row */}
              {adding && (
                <tr style={{ background: 'var(--c-cream)' }}>
                  <td>
                    <input
                      type="date"
                      value={form.paidAt}
                      onChange={(e) => setForm((s) => ({ ...s, paidAt: e.target.value }))}
                      className={styles.fieldInput}
                      style={{ height: 28, fontSize: 'var(--fs-12)' }}
                    />
                  </td>
                  <td>
                    <select
                      value={form.method}
                      onChange={(e) => setForm((s) => ({ ...s, method: e.target.value as PaymentMethod }))}
                      className={styles.fieldInput}
                      style={{ height: 28, fontSize: 'var(--fs-12)' }}
                    >
                      <option value="merchant">Merchant</option>
                      <option value="transfer">Transfer</option>
                      <option value="cash">Cash</option>
                    </select>
                    {form.method === 'merchant' && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <select
                          value={form.merchantProvider}
                          onChange={(e) => setForm((s) => ({ ...s, merchantProvider: e.target.value as MerchantProvider | '' }))}
                          className={styles.fieldInput}
                          style={{ height: 26, fontSize: 'var(--fs-11)', flex: 1 }}
                        >
                          <option value="">Provider…</option>
                          <option value="GHL">GHL</option>
                          <option value="HLB">HLB</option>
                          <option value="MBB">MBB</option>
                          <option value="PBB">PBB</option>
                        </select>
                        <select
                          value={form.installmentMonths}
                          onChange={(e) => setForm((s) => ({ ...s, installmentMonths: e.target.value as '' | '6' | '12' }))}
                          className={styles.fieldInput}
                          style={{ height: 26, fontSize: 'var(--fs-11)', flex: 1 }}
                        >
                          <option value="">Normal</option>
                          <option value="6">6 mo</option>
                          <option value="12">12 mo</option>
                        </select>
                      </div>
                    )}
                  </td>
                  <td className={styles.tableRight}>
                    <input
                      type="number" step="0.01" min={0}
                      value={(form.amountCenti / 100).toFixed(2)}
                      onChange={(e) => setForm((s) => ({ ...s, amountCenti: Math.round(Number(e.target.value) * 100) || 0 }))}
                      className={styles.fieldInput}
                      style={{ height: 28, fontSize: 'var(--fs-12)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={form.accountSheet}
                      onChange={(e) => setForm((s) => ({ ...s, accountSheet: e.target.value }))}
                      placeholder="Bank / cashbook"
                      className={styles.fieldInput}
                      style={{ height: 28, fontSize: 'var(--fs-12)' }}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      value={form.approvalCode}
                      onChange={(e) => setForm((s) => ({ ...s, approvalCode: e.target.value }))}
                      placeholder={
                        form.method === 'merchant' ? 'Auth code' :
                        form.method === 'transfer' ? 'Slip ref' :
                                                     'Receipt'
                      }
                      className={styles.fieldInput}
                      style={{ height: 28, fontSize: 'var(--fs-12)', fontVariantNumeric: 'tabular-nums' }}
                    />
                  </td>
                  <td>
                    <select
                      value={form.collectedBy}
                      onChange={(e) => setForm((s) => ({ ...s, collectedBy: e.target.value }))}
                      className={styles.fieldInput}
                      style={{ height: 28, fontSize: 'var(--fs-12)' }}
                    >
                      <option value="">—</option>
                      {(staff.data ?? []).filter((s) => s.active).map((s) => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                      <button
                        type="button"
                        onClick={submitNew}
                        disabled={addPayment.isPending || !form.amountCenti}
                        title="Save payment"
                        style={{
                          background: 'transparent', border: 'none', padding: 4,
                          cursor: 'pointer', color: 'var(--c-secondary-a, #2F5D4F)',
                        }}
                      >
                        <Save size={14} strokeWidth={1.75} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setAdding(false); resetForm(); }}
                        title="Cancel"
                        style={{
                          background: 'transparent', border: 'none', padding: 4,
                          cursor: 'pointer', color: 'var(--fg-muted)',
                        }}
                      >
                        <X size={14} strokeWidth={1.75} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}

        {/* + Add Payment trigger */}
        {!adding && !locked && (
          <button
            type="button"
            onClick={() => { resetForm(); setAdding(true); }}
            style={{
              marginTop: 'var(--space-2)',
              background: 'transparent', border: 'none', padding: 0,
              color: 'var(--c-orange)', cursor: 'pointer',
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', fontWeight: 600,
            }}
          >
            + Add Payment
          </button>
        )}

        {/* ── Summary ────────────────────────────────────────────────── */}
        <div className={styles.subSection}>
          <p className={styles.subHead}>Summary</p>
          <div style={{
            display: 'grid', gridTemplateColumns: 'auto 1fr',
            gap: '4px 16px',
            fontFamily: 'var(--font-sans)',
            fontSize: 'var(--fs-13)',
            maxWidth: 360,
          }}>
            <span className={styles.muted}>Subtotal</span>
            <span style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
              {fmtRm(grandTotal, header.currency)}
            </span>
            <span className={styles.muted}>Deposit Paid</span>
            <span style={{
              textAlign: 'right', fontVariantNumeric: 'tabular-nums',
              color: 'var(--c-burnt)', fontWeight: 600,
            }}>
              {fmtRm(paidCenti, header.currency)}
            </span>
            <span style={{ fontWeight: 600 }}>
              Balance
              {isFullPaid && (
                <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-secondary-a, #2F5D4F)' }}>· PAID</span>
              )}
              {isHalfPaid && (
                <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-orange)' }}>· deposit only</span>
              )}
            </span>
            <span style={{
              textAlign: 'right', fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
              color: isFullPaid ? 'var(--c-secondary-a, #2F5D4F)' : 'var(--c-ink)',
            }}>
              {fmtRm(balanceCenti, header.currency)}
            </span>
          </div>
        </div>

        {/* ── Deposit target (expected, not paid) ─────────────────────── */}
        <div className={styles.subSection}>
          <p className={styles.subHead}>Expected Deposit</p>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
            <label className={styles.field} style={{ maxWidth: 200 }}>
              <span className={styles.fieldLabel}>
                Deposit ({header.currency})
                {depositCenti === half && grandTotal > 0 && (
                  <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-orange)' }}>· 50%</span>
                )}
              </span>
              <input
                type="number" step="0.01" min={0}
                className={styles.fieldInput}
                value={(depositCenti / 100).toFixed(2)}
                disabled={locked}
                onChange={(e) => setDepositCenti(Math.round(Number(e.target.value) * 100) || 0)}
              />
            </label>
            <button
              type="button"
              onClick={() => setDepositCenti(half)}
              disabled={locked || grandTotal === 0}
              style={{
                background: 'transparent', border: 'none',
                color: 'var(--c-orange)', cursor: locked ? 'not-allowed' : 'pointer',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-11)', fontWeight: 600, padding: 0,
                marginBottom: 8,
              }}
            >
              Set 50% deposit ({fmtRm(half, header.currency)})
            </button>
            <Button
              variant="primary" size="sm"
              onClick={saveDeposit}
              disabled={saving || locked || depositCenti === (header.deposit_centi ?? 0)}
              style={{ marginBottom: 4 }}
            >
              <Save {...ICON} />
              <span>{saving ? 'Saving…' : 'Save deposit'}</span>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   StatusTimeline + PriceOverridePanel — removed in followup #85
   Both standalone audit cards were superseded by the PR-D History drawer
   (useSalesOrderAuditLog), which renders the same data plus every other
   action type in one unified feed. The underlying tables and writes are
   retained so the data remains queryable for admin tooling.
   ════════════════════════════════════════════════════════════════════════ */

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

/* ════════════════════════════════════════════════════════════════════════
   PR-D — HistoryPanel
   Right-side drawer driven by mfg_so_audit_log. HOOKKA / Inistate-style:
     • avatar (initials in hash-colored circle)
     • "<actor> performed <action> [status pill] · <relative time>"
     • "via <source>" suffix
     • "Changes" toggle expands a field-level from→to diff block
   ════════════════════════════════════════════════════════════════════════ */

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
};

const MONEY_FIELDS = new Set(['unitPriceCenti', 'discountCenti', 'totalCenti', 'depositCenti', 'localTotalCenti', 'unitCostCenti']);

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

const HistoryPanel = ({
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
                      <div className={styles.historyMeta} style={{ fontStyle: 'italic' }}>
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
                            {fc.map((ch, idx) => (
                              <div key={idx} className={styles.historyChange}>
                                <span className={styles.historyChangeField}>
                                  {FIELD_LABEL[ch.field] ?? ch.field}
                                </span>
                                <span className={styles.historyChangeDiff}>
                                  {ch.from !== undefined && ch.from !== null && ch.from !== '' ? (
                                    <>
                                      <span className={styles.historyChangeFrom}>{fmtField(ch.field, ch.from)}</span>
                                      <span className={styles.historyChangeArrow}>→</span>
                                    </>
                                  ) : null}
                                  <span>{fmtField(ch.field, ch.to)}</span>
                                </span>
                              </div>
                            ))}
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
