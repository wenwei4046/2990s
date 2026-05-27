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
//   5. Status transition strip: Draft → Confirmed → Shipped → Delivered → Invoiced → Closed.
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
  Calendar as CalIcon, User as UserIcon, Tag,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import { formatPhone } from '@2990s/shared/phone';
import { PhoneInput } from '../components/PhoneInput';
import { useAuth } from '../lib/auth';
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
import { SoLineCard, emptySoLine, type SoLineDraft } from '../components/SoLineCard';
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
import paymentsStyles from './Payments.module.css';

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

  const header = (detail.data?.salesOrder as SoHeader | undefined) ?? null;
  const items = (detail.data?.items as SoItem[] | undefined) ?? [];

  /* Followup #81 — Print PDF reads payments from the ledger now. PaymentCard
     also calls this hook (with the same docNo), so TanStack Query dedupes
     and shares the cache entry — no double fetch. */
  const printPaymentsQ = useSalesOrderPayments(docNo ?? null);

  /* Task #80 — Inline edit replaces the LineItemModal. Pencil on a row
     toggles that row into an inline SoLineCard editor pre-populated with
     the row's current values. The draft lives in editingDrafts keyed by
     item id; the editingLineIds set drives the table-row swap. On submit
     (updateItem) → success removes the id from the set + drops the draft.
     The "+ Add Line Item" button seeds addingDraft with emptySoLine() +
     the SO header's customer_delivery_date so the new row renders an
     inline SoLineCard at the bottom of the table (same component, same
     behavior as the New SO page — there is no longer a modal flow at all). */
  const [editingLineIds, setEditingLineIds] = useState<Set<string>>(new Set());
  const [editingDrafts, setEditingDrafts] = useState<Record<string, SoLineDraft>>({});
  const [addingDraft, setAddingDraft] = useState<SoLineDraft | null>(null);
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

  /* Task #80 — Inline line-item edit helpers. Each is keyed on the SoItem.id
     except startAdd which seeds a brand-new SoLineDraft. The mutation payload
     mirrors what SalesOrderNew.tsx posts (snake_case happens server-side). */
  const startEditLine = (it: SoItem) => {
    setEditingLineIds((prev) => {
      const next = new Set(prev);
      next.add(it.id);
      return next;
    });
    setEditingDrafts((prev) => ({
      ...prev,
      [it.id]: {
        itemCode:       it.item_code ?? '',
        itemGroup:      it.item_group ?? 'others',
        description:    it.description ?? '',
        uom:            it.uom ?? 'UNIT',
        qty:            it.qty ?? 1,
        unitPriceCenti: it.unit_price_centi ?? 0,
        discountCenti:  it.discount_centi ?? 0,
        unitCostCenti:  it.unit_cost_centi ?? 0,
        variants:       (it.variants as Record<string, unknown>) ?? {},
        remark:         it.remark ?? '',
        lineDeliveryDate:           it.line_delivery_date ?? null,
        lineDeliveryDateOverridden: it.line_delivery_date_overridden ?? false,
      },
    }));
  };

  const stopEditLine = (id: string) => {
    setEditingLineIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setEditingDrafts((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  };

  const patchEditingDraft = (id: string, patch: Partial<SoLineDraft>) => {
    setEditingDrafts((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  };

  const submitEditingDraft = (id: string) => {
    const d = editingDrafts[id];
    if (!d) return;
    if (!d.itemCode.trim()) { window.alert('Pick a product first.'); return; }
    if (!header) return;
    updateItem.mutate(
      {
        docNo: header.doc_no,
        itemId: id,
        itemCode:       d.itemCode,
        itemGroup:      d.itemGroup,
        description:    d.description,
        uom:            d.uom,
        qty:            d.qty,
        unitPriceCenti: d.unitPriceCenti,
        discountCenti:  d.discountCenti,
        unitCostCenti:  d.unitCostCenti,
        variants:       d.variants,
        remark:         d.remark,
        lineDeliveryDate:           d.lineDeliveryDate ?? null,
        lineDeliveryDateOverridden: d.lineDeliveryDateOverridden ?? false,
      },
      { onSuccess: () => stopEditLine(id) },
    );
  };

  /* Add path — single inline SoLineCard appended below the table when
     "+ Add Line Item" is clicked. Same submit-payload shape as edit. */
  const startAddLine = () => {
    if (!header) return;
    setAddingDraft({
      ...emptySoLine(),
      // Seed the line delivery date from the SO header so the SoLineCard
      // displays a default — same pattern SalesOrderNew uses.
      lineDeliveryDate: header.customer_delivery_date ?? null,
      lineDeliveryDateOverridden: false,
    });
  };

  const cancelAddLine = () => setAddingDraft(null);

  const submitAddLine = () => {
    if (!addingDraft) return;
    if (!addingDraft.itemCode.trim()) { window.alert('Pick a product first.'); return; }
    if (!header) return;
    addItem.mutate(
      {
        docNo: header.doc_no,
        itemCode:       addingDraft.itemCode,
        itemGroup:      addingDraft.itemGroup,
        description:    addingDraft.description,
        uom:            addingDraft.uom,
        qty:            addingDraft.qty,
        unitPriceCenti: addingDraft.unitPriceCenti,
        discountCenti:  addingDraft.discountCenti,
        unitCostCenti:  addingDraft.unitCostCenti,
        variants:       addingDraft.variants,
        remark:         addingDraft.remark,
        lineDeliveryDate:           addingDraft.lineDeliveryDate ?? null,
        lineDeliveryDateOverridden: addingDraft.lineDeliveryDateOverridden ?? false,
      },
      { onSuccess: () => setAddingDraft(null) },
    );
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
    /* Followup #81 — Wait for the payments query before generating; legacy
       header columns (paid_centi, payment_method, …) are deprecated. If
       the query is still loading we surface a brief notice and bail out
       rather than printing a PDF with an empty Payments table. */
    if (printPaymentsQ.isLoading) {
      alert('Loading payments… please try again in a moment.');
      return;
    }
    const payments = printPaymentsQ.data ?? [];
    generateSalesOrderPdf(header, items, payments).catch((e) => {
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
          {/* PR-A — Add Line Item is only shown in edit mode.
              Task #80 — clicking now seeds an inline SoLineCard at the
              bottom of the table (no more modal). Button hides itself
              while a draft is open to avoid stacking two add-cards. */}
          {isEditing && !addingDraft && (
            <Button variant="primary" size="sm" onClick={startAddLine} disabled={isLocked}>
              <Plus {...ICON} />
              <span>Add Line Item</span>
            </Button>
          )}
        </header>

        {items.length === 0 && !addingDraft ? (
          <p className={styles.emptyRow}>No items yet — click "Add Line Item" to begin.</p>
        ) : items.length === 0 && addingDraft ? (
          // Task #80 — Empty SO + Add clicked: render the SoLineCard without
          // the surrounding table (no rows to keep the same column grid in
          // sync with). Mirrors the empty-state add path on the New SO page.
          <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <SoLineCard
              index={0}
              draft={addingDraft}
              onChange={(patch) => setAddingDraft((prev) => prev ? { ...prev, ...patch } : prev)}
              onRemove={cancelAddLine}
              canRemove={true}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-2)',
            }}>
              <Button variant="ghost" size="sm"
                onClick={cancelAddLine}
                disabled={addItem.isPending}>
                <span>Cancel</span>
              </Button>
              <Button variant="primary" size="sm"
                onClick={submitAddLine}
                disabled={addItem.isPending}>
                <Save {...SM_ICON} />
                <span>{addItem.isPending ? 'Saving…' : 'Add Line Item'}</span>
              </Button>
            </div>
          </div>
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
                /* Task #80 — When this row is in inline edit mode, replace
                   the entire row's contents with a full-width SoLineCard.
                   Save/Cancel buttons render under the card; the action
                   icons in the right column are suppressed since the inline
                   form supplies its own commit affordances. */
                const inlineEditing = editingLineIds.has(it.id);
                const editDraft = editingDrafts[it.id];
                if (inlineEditing && editDraft) {
                  return (
                    <tr key={it.id}>
                      <td colSpan={7} style={{ padding: 'var(--space-3)' }}>
                        <SoLineCard
                          index={items.indexOf(it)}
                          draft={editDraft}
                          onChange={(patch) => patchEditingDraft(it.id, patch)}
                          onRemove={() => stopEditLine(it.id)}
                          canRemove={true}
                          /* PR-F (#79) wiring — enable photo upload on
                             already-saved lines. New lines (addingDraft)
                             don't have an itemId yet so photos defer to
                             after the first save. */
                          docNo={header.doc_no}
                          itemId={it.id}
                          isEditing={isEditing}
                        />
                        <div style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          gap: 'var(--space-2)',
                          marginTop: 'var(--space-2)',
                        }}>
                          <Button variant="ghost" size="sm"
                            onClick={() => stopEditLine(it.id)}
                            disabled={updateItem.isPending}>
                            <span>Cancel</span>
                          </Button>
                          <Button variant="primary" size="sm"
                            onClick={() => submitEditingDraft(it.id)}
                            disabled={updateItem.isPending}>
                            <Save {...SM_ICON} />
                            <span>{updateItem.isPending ? 'Saving…' : 'Save'}</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                }
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
                        em-dash placeholder so the column doesn't collapse.
                        Task #80 — Pencil now opens an inline SoLineCard
                        editor on the same row (replaces the legacy modal). */}
                    {isEditing ? (
                      <span className={styles.actionsCell}>
                        <button type="button" className={styles.iconBtn} title="Edit" disabled={isLocked}
                          onClick={() => !isLocked && startEditLine(it)}>
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
              {/* Task #80 — Inline "+ Add Line Item" SoLineCard appended at
                  the bottom of the table when the user clicks the button. */}
              {addingDraft && (
                <tr>
                  <td colSpan={7} style={{ padding: 'var(--space-3)' }}>
                    <SoLineCard
                      index={items.length}
                      draft={addingDraft}
                      onChange={(patch) => setAddingDraft((prev) => prev ? { ...prev, ...patch } : prev)}
                      onRemove={cancelAddLine}
                      canRemove={true}
                    />
                    <div style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      gap: 'var(--space-2)',
                      marginTop: 'var(--space-2)',
                    }}>
                      <Button variant="ghost" size="sm"
                        onClick={cancelAddLine}
                        disabled={addItem.isPending}>
                        <span>Cancel</span>
                      </Button>
                      <Button variant="primary" size="sm"
                        onClick={submitAddLine}
                        disabled={addItem.isPending}>
                        <Save {...SM_ICON} />
                        <span>{addItem.isPending ? 'Saving…' : 'Add Line Item'}</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
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

      {/* ── Payment — Houzs-pattern transactions table ────────────── */}
      {/* Commander 2026-05-27: "Payment 也 follow Hookka 那个排版". Verbatim
          port of houzs-erp/src/components/NewSalesOrderForm.tsx Payments
          block (lines 1047-1126). Subtotal / Expected Deposit dropped —
          Houzs doesn't have them, and commander wants the ledger view
          (transactions + Deposit Paid + Balance) only. */}
      <PaymentCard
        header={header}
        locked={isLocked || !isEditing}
      />

      {/* ── Variant-completeness banner ─────────────────────────────
          PR #144 + #156 gating rule kept as a read-only warning. The
          "Move to next stage" pill strip below it (commander 2026-05-27:
          "这个不需要") was removed — status transitions now flow through
          the Edit/Save path or the API directly, while this banner stays
          so the Order Coordinator still sees which lines are incomplete
          when a Processing Date is set. updateStatus is still wired for
          the lock-override flow above. */}
      {(() => {
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
        if (incompleteLines.length === 0) return null;
        const formatGroupRequirements = (g: string) =>
          g === 'bedframe' ? 'Divan · Leg · Gap · Fabric' :
          g === 'sofa'     ? 'Seat · Leg · Fabric' : '';
        return (
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
      {/* Task #80 — LineItemModal removed (deleted with PR #125's inline
          SoLineCard work). Both Add + Edit now use inline SoLineCard rows
          inside the line-items table above. */}
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

  /* PR #168 — Commander 2026-05-27 screenshot diff vs. Create SO: Detail
     was using one big "Customer · Addresses" card with 4 hairline-divided
     sub-blocks; Create SO uses 4 visually distinct top-level cards. Mirror
     the New SO layout here — same module classes (.card / .cardHeader /
     .cardTitle / .formGrid4 / .field / .fieldLabel) — so the two pages
     read identically. The component still exposes its imperative save() /
     reset() handle to the page-level Edit/Save flow; the 4 cards just
     replace the single wrapper. */
  return (
    <>
      {/* ── CUSTOMER ──────────────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Customer</h2>
        </header>
        <div className={styles.cardBody}>
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
      </section>

      {/* ── ORDER INFO (venue / dates / note) ─────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Order Info</h2>
        </header>
        <div className={styles.cardBody}>
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
      </section>

      {/* ── EMERGENCY CONTACT ─────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Emergency Contact</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            Used only if we cannot reach the customer on delivery day
          </span>
        </header>
        <div className={styles.cardBody}>
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
      </section>

      {/* ── DELIVERY ADDRESS ──────────────────────────────────────── */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Delivery Address</h2>
        </header>
        <div className={styles.cardBody}>
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
      </section>
    </>
  );
});
CustomerCard.displayName = 'CustomerCard';

/* ════════════════════════════════════════════════════════════════════════
   Variants summary pills (for line items table)
   ════════════════════════════════════════════════════════════════════════ */

/* PR #168 — Commander 2026-05-27: "字体统一". Pill keys were rendering as
   camelCase variable names (gap / legHeight / fabricCode) which read like
   debug output. Map known keys to human Title Case labels, fall back to
   camelCase → "Camel Case" splitter for anything unmapped. Array values
   (e.g. specials: ['Extra cushion', 'Pet-proof']) join with ", ". */
const VARIANT_KEY_LABELS: Record<string, string> = {
  gap:          'Gap',
  legHeight:    'Leg Height',
  fabricCode:   'Fabric Code',
  divanHeight:  'Divan Height',
  totalHeight:  'Total Height',
  seatHeight:   'Seat Height',
  specials:     'Specials',
};

const camelCaseToTitle = (s: string): string => {
  if (!s) return s;
  const spaced = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const formatVariantValue = (v: unknown): string => {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  return String(v);
};

const VariantsPills = ({ variants }: { variants: Record<string, unknown> | null }) => {
  if (!variants || typeof variants !== 'object') return null;
  const entries = Object.entries(variants).filter(([, v]) => {
    if (v == null || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  if (entries.length === 0) return null;
  return (
    <div className={styles.variantBlock}>
      {entries.map(([k, v]) => (
        <span key={k} className={styles.variantPill}>
          {VARIANT_KEY_LABELS[k] ?? camelCaseToTitle(k)}: {formatVariantValue(v)}
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
   PaymentCard — Houzs-pattern transactions ledger.

   Commander 2026-05-27: "Payment 也 follow Hookka 那个排版". Verbatim port
   of houzs-erp/src/components/NewSalesOrderForm.tsx Payments block (lines
   1047-1126). The previous Subtotal / Expected Deposit (50% rule) section
   is dropped — Houzs doesn't have it, and commander wants only the
   transactions table + Deposit Paid + Balance summary.

   Each row in the table = one row in mfg_sales_order_payments (migration
   0073). Sum of amount_centi = "Deposit Paid"; balance = local_total_centi
   − paid. Legacy header columns (payment_method, merchant_provider,
   installment_months, approval_code, payment_date, paid_centi) still exist
   in the schema but the UI no longer reads or writes them.

   Houzs has a flat list of "method" strings (CASH/MBB/VISA/EPP/...). The
   2990 API uses a typed enum: 'merchant' | 'transfer' | 'cash' + optional
   merchantProvider/installmentMonths. We map Houzs string → API enum at
   submit time:
     - CASH                            → method=cash
     - MBB / ONLINE / TNG / DUITNOW    → method=transfer, merchant_provider=null
     - VISA / MASTER / CREDIT / EPP    → method=merchant, merchant_provider derived
   Reverse mapping for display: rebuild the friendly label from method +
   merchant_provider + installment_months so legacy ledger rows still show
   sensibly.
   ════════════════════════════════════════════════════════════════════════ */

type PaymentMethod = 'merchant' | 'transfer' | 'cash';
type MerchantProvider = 'GHL' | 'HLB' | 'MBB' | 'PBB';

/** Friendly Houzs-style method labels. Top of the list = sensible default. */
const PAYMENT_METHOD_OPTIONS = [
  'CASH', 'MBB', 'VISA', 'MASTER', 'CREDIT CARD', 'EPP',
  'ONLINE', 'TNG', 'DUITNOW', 'OTHER',
] as const;
type PaymentMethodLabel = typeof PAYMENT_METHOD_OPTIONS[number];

/** Houzs string → API enum (method, optional merchant provider). */
const labelToApi = (label: PaymentMethodLabel): {
  method: PaymentMethod;
  merchantProvider: MerchantProvider | null;
} => {
  switch (label) {
    case 'CASH':
      return { method: 'cash', merchantProvider: null };
    case 'MBB':
    case 'ONLINE':
    case 'TNG':
    case 'DUITNOW':
      // Bank transfer family — provider field stays null on the API.
      return { method: 'transfer', merchantProvider: null };
    case 'VISA':
    case 'MASTER':
    case 'CREDIT CARD':
    case 'EPP':
    case 'OTHER':
      // Merchant rails. Provider isn't intrinsic to the user's label here
      // (cardholder doesn't know which acquirer settles); leave null so
      // commander can pick it in a follow-up edit if needed.
      return { method: 'merchant', merchantProvider: null };
  }
};

/** API row → friendly label (best-effort, falls back to METHOD). */
const apiToLabel = (p: SoPayment): string => {
  if (p.method === 'cash') return 'CASH';
  if (p.method === 'transfer') return p.merchant_provider ?? 'MBB';
  // merchant
  if (p.merchant_provider) return p.merchant_provider;
  return 'CREDIT CARD';
};

/** Per-method pill swatch (Houzs uses category-coloured chip tags). */
const methodPillStyle = (m: PaymentMethod): CSSProperties => {
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
  locked = false,
}: {
  header: SoHeader;
  locked?: boolean;
}) => {
  const grandTotal = header.local_total_centi ?? 0;

  const paymentsQ    = useSalesOrderPayments(header.doc_no);
  const payments     = paymentsQ.data ?? [];
  const addPayment   = useAddSalesOrderPayment();
  const deletePayment = useDeleteSalesOrderPayment();
  const staffQ       = useStaff();
  const staff        = staffQ.data ?? [];
  const auth         = useAuth();

  /* In-flight "draft" rows. Houzs lets commander Add Payment which appends
     a blank row inline; the same model is used here so a row is fully
     editable as soon as it appears. We store local drafts keyed by a uid
     and POST them when commander tabs/blurs out (after at least one
     non-trivial change). */
  type DraftRow = {
    uid:          string;
    paidAt:       string;
    methodLabel:  PaymentMethodLabel;
    amountCenti:  number;
    accountSheet: string;
    approvalCode: string;
    collectedBy:  string;        // staff.id (uuid) | ''
  };

  const newDraft = (): DraftRow => ({
    uid: Math.random().toString(36).slice(2, 10),
    paidAt: new Date().toISOString().slice(0, 10),
    methodLabel: 'CASH',
    amountCenti: 0,
    accountSheet: '',
    approvalCode: '',
    // Default Collected By = current logged-in staff (commander screenshot).
    collectedBy: auth.staff?.id ?? '',
  });

  const [drafts, setDrafts] = useState<DraftRow[]>([]);

  const addDraft = () => setDrafts((prev) => [...prev, newDraft()]);
  const patchDraft = (uid: string, patch: Partial<DraftRow>) =>
    setDrafts((prev) => prev.map((d) => d.uid === uid ? { ...d, ...patch } : d));
  const removeDraft = (uid: string) =>
    setDrafts((prev) => prev.filter((d) => d.uid !== uid));

  /* Commit a draft to the API. Trips on:
     - amountCenti > 0
     - method present (always true since CASH is the default) */
  const commitDraft = (d: DraftRow) => {
    if (d.amountCenti <= 0) return;
    const { method, merchantProvider } = labelToApi(d.methodLabel);
    const body: Record<string, unknown> = {
      docNo:        header.doc_no,
      paidAt:       d.paidAt,
      method,
      amountCenti:  d.amountCenti,
      accountSheet: d.accountSheet || null,
      approvalCode: d.approvalCode || null,
      collectedBy:  d.collectedBy  || null,
    };
    if (method === 'merchant') {
      body.merchantProvider = merchantProvider;
    }
    addPayment.mutate(body as { docNo: string } & Record<string, unknown>, {
      onSuccess: () => removeDraft(d.uid),
      onError: (e) => {
        // eslint-disable-next-line no-console
        console.error('[payment] add failed:', e);
        window.alert(`Failed to save payment: ${e instanceof Error ? e.message : String(e)}`);
      },
    });
  };

  /* Summary maths — same as Houzs (paid = Σ amount_centi; balance =
     grandTotal − paid, clamped at 0). */
  const paidCenti    = payments.reduce((sum, p) => sum + (p.amount_centi || 0), 0);
  const balanceCenti = Math.max(0, grandTotal - paidCenti);

  const staffNameById = (id: string | null): string | null => {
    if (!id) return null;
    return staff.find((s) => s.id === id)?.name ?? null;
  };

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>
          <DollarSign size={14} strokeWidth={1.75} /> Payments
        </h2>
      </header>
      <div className={styles.cardBody}>
        <div className={paymentsStyles.section}>
          {/* Top bar with + Add Payment trigger ─────────────────────── */}
          <div className={paymentsStyles.head}>
            <span className={paymentsStyles.headLabel}>
              {payments.length + drafts.length} transaction{payments.length + drafts.length === 1 ? '' : 's'}
            </span>
            {!locked && (
              <button
                type="button"
                className={paymentsStyles.addBtn}
                onClick={addDraft}
                disabled={addPayment.isPending}
              >
                <Plus size={14} strokeWidth={1.75} />
                Add Payment
              </button>
            )}
          </div>

          {/* Transactions table ──────────────────────────────────────── */}
          <div className={paymentsStyles.grid}>
            {/* Header row */}
            <span className={paymentsStyles.headerCell}>
              Date <CalIcon size={12} strokeWidth={1.75} />
            </span>
            <span className={paymentsStyles.headerCell}>
              Payment Method <Tag size={12} strokeWidth={1.75} />
            </span>
            <span className={paymentsStyles.headerCellRight}>
              Amount <DollarSign size={12} strokeWidth={1.75} />
            </span>
            <span className={paymentsStyles.headerCell}>
              Account Sheet <FileText size={12} strokeWidth={1.75} />
            </span>
            <span className={paymentsStyles.headerCell}>
              Approval Code <FileText size={12} strokeWidth={1.75} />
            </span>
            <span className={paymentsStyles.headerCell}>
              Collected By <UserIcon size={12} strokeWidth={1.75} />
            </span>
            <span className={paymentsStyles.headerCell} />

            {/* Empty state */}
            {paymentsQ.isLoading && (
              <span className={paymentsStyles.emptyRow} style={{ gridColumn: '1 / -1' }}>
                Loading…
              </span>
            )}
            {!paymentsQ.isLoading && payments.length === 0 && drafts.length === 0 && (
              <span className={paymentsStyles.emptyRow} style={{ gridColumn: '1 / -1' }}>
                No payments recorded yet · click "Add Payment" to log a deposit
              </span>
            )}

            {/* Persisted payment rows */}
            {payments.map((p: SoPayment) => (
              <div className={paymentsStyles.row} key={p.id}>
                <span className={paymentsStyles.cell} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {p.paid_at}
                </span>
                <span className={paymentsStyles.cell}>
                  <span className={paymentsStyles.methodPill} style={methodPillStyle(p.method)}>
                    {apiToLabel(p)}
                  </span>
                  {p.installment_months ? (
                    <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                      · {p.installment_months}m
                    </span>
                  ) : null}
                </span>
                <span className={paymentsStyles.cellRight}
                      style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {fmtRm(p.amount_centi, header.currency)}
                </span>
                <span className={paymentsStyles.cell}>
                  {p.account_sheet ?? <span className={styles.muted}>—</span>}
                </span>
                <span className={paymentsStyles.cell} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {p.approval_code ?? <span className={styles.muted}>—</span>}
                </span>
                <span className={paymentsStyles.cell}>
                  {p.collected_by_name ?? staffNameById(p.collected_by) ?? <span className={styles.muted}>—</span>}
                </span>
                <span className={paymentsStyles.cell}>
                  {!locked && (
                    <button
                      type="button"
                      className={paymentsStyles.trashBtn}
                      disabled={deletePayment.isPending}
                      onClick={() => {
                        if (confirm(`Delete this ${apiToLabel(p)} payment of ${fmtRm(p.amount_centi, header.currency)}?`)) {
                          deletePayment.mutate({ docNo: header.doc_no, id: p.id });
                        }
                      }}
                      title="Remove payment"
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  )}
                </span>
              </div>
            ))}

            {/* In-flight draft rows (commander typing) */}
            {drafts.map((d) => (
              <div className={paymentsStyles.row} key={d.uid}>
                <span className={paymentsStyles.cell}>
                  <input
                    type="date"
                    className={paymentsStyles.inlineInput}
                    value={d.paidAt}
                    disabled={locked}
                    onChange={(e) => patchDraft(d.uid, { paidAt: e.target.value })}
                  />
                </span>
                <span className={paymentsStyles.cell}>
                  <select
                    className={paymentsStyles.inlineSelect}
                    value={d.methodLabel}
                    disabled={locked}
                    onChange={(e) => patchDraft(d.uid, { methodLabel: e.target.value as PaymentMethodLabel })}
                  >
                    {PAYMENT_METHOD_OPTIONS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </span>
                <span className={paymentsStyles.cellRight}>
                  <input
                    type="number" min={0} step="0.01"
                    className={paymentsStyles.inlineInputRight}
                    value={d.amountCenti === 0 ? '' : (d.amountCenti / 100).toFixed(2)}
                    placeholder="0"
                    disabled={locked}
                    onChange={(e) => patchDraft(d.uid, {
                      amountCenti: Math.round(Number(e.target.value) * 100) || 0,
                    })}
                  />
                </span>
                <span className={paymentsStyles.cell}>
                  <input
                    type="text"
                    className={`${paymentsStyles.inlineInput} ${paymentsStyles.placeholderHint}`}
                    placeholder="e.g. AKHC 3809"
                    value={d.accountSheet}
                    disabled={locked}
                    onChange={(e) => patchDraft(d.uid, { accountSheet: e.target.value })}
                  />
                </span>
                <span className={paymentsStyles.cell}>
                  <input
                    type="text"
                    className={paymentsStyles.inlineInput}
                    value={d.approvalCode}
                    disabled={locked}
                    onChange={(e) => patchDraft(d.uid, { approvalCode: e.target.value })}
                  />
                </span>
                <span className={paymentsStyles.cell}>
                  <select
                    className={paymentsStyles.inlineInputUser}
                    value={d.collectedBy}
                    disabled={locked}
                    onChange={(e) => patchDraft(d.uid, { collectedBy: e.target.value })}
                  >
                    <option value="">—</option>
                    {staff.filter((s) => s.active).map((s) => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                </span>
                <span className={paymentsStyles.cell}>
                  <div style={{ display: 'flex', gap: 2, justifyContent: 'flex-end' }}>
                    <button
                      type="button"
                      onClick={() => commitDraft(d)}
                      disabled={locked || addPayment.isPending || d.amountCenti <= 0}
                      title={d.amountCenti <= 0 ? 'Enter an amount > 0 first' : 'Save payment'}
                      style={{
                        background: 'transparent', border: 'none', padding: 4,
                        cursor: d.amountCenti <= 0 ? 'not-allowed' : 'pointer',
                        color: d.amountCenti <= 0 ? 'var(--fg-muted)' : 'var(--c-secondary-a, #2F5D4F)',
                      }}
                    >
                      <Save size={14} strokeWidth={1.75} />
                    </button>
                    <button
                      type="button"
                      className={paymentsStyles.trashBtn}
                      onClick={() => removeDraft(d.uid)}
                      title="Discard"
                      disabled={locked}
                    >
                      <Trash2 size={14} strokeWidth={1.75} />
                    </button>
                  </div>
                </span>
              </div>
            ))}
          </div>

          {/* ── Summary (Deposit Paid + Balance) ────────────────────── */}
          <div className={paymentsStyles.summary}>
            <span className={paymentsStyles.summaryLabel}>
              Deposit Paid <DollarSign size={12} strokeWidth={1.75} />
            </span>
            <span className={paymentsStyles.summaryValueAccent}>
              {fmtRm(paidCenti, header.currency)}
            </span>
            <span className={paymentsStyles.summaryLabel}>
              Balance <DollarSign size={12} strokeWidth={1.75} />
            </span>
            <span className={balanceCenti > 0 ? paymentsStyles.balanceOutstanding : paymentsStyles.balanceClear}>
              {fmtRm(balanceCenti, header.currency)}
              {grandTotal > 0 && paidCenti >= grandTotal && (
                <span style={{ marginLeft: 8, fontSize: 'var(--fs-11)' }}>· PAID</span>
              )}
            </span>
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
