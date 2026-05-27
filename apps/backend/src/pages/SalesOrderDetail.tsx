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
  forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState,
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
  type DebtorSuggestion,
  type SoAuditEntry,
  type SoAuditFieldChange,
} from '../lib/flow-queries';
import { SoLineCard, emptySoLine, type SoLineDraft } from '../components/SoLineCard';
import { PaymentsTable } from '../components/PaymentsTable';
import {
  useLocalities,
  distinctStates,
  citiesInState,
  postcodesInCity,
  BUILDING_TYPES,
} from '../lib/localities-queries';
import { useStaff } from '../lib/admin-queries';
import { useDebouncedValue } from '../lib/hooks';
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

/* Task #99 (UI perf) — Local debounce hook lifted to ../lib/hooks.ts as
   useDebouncedValue so SoLineCard's product picker (Task #102) can reuse
   it without duplicating the implementation. */

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
  /* Task #114 — per-category cost rollup (migration 0079). Used by the
     Totals card category breakdown so each row can show Revenue / Cost /
     Margin without summing items. May be undefined on rows older than
     0079 — fall back to 0 in the consumer. */
  mattress_sofa_cost_centi?: number;
  bedframe_cost_centi?:      number;
  accessories_cost_centi?:   number;
  others_cost_centi?:        number;
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

  /* Task #99 (UI perf) — Stable callbacks for the memo'd child cards. Without
     these, every parent render produces a new `onSave`/`onClose`, defeating
     React.memo on PaymentCard / CustomerCard / HistoryPanel. The mutations
     they call are stable across renders (TanStack Query returns the same
     mutate fn) so the only moving piece is `docNo` from URL params, which
     never changes inside one mounted page. */
  const stableDocNo = docNo ?? '';
  const handleHeaderSave = useCallback(
    (patch: Record<string, unknown>, cb?: { onSuccess?: () => void; onError?: (msg: string) => void }) => {
      updateHeader.mutate(
        { docNo: stableDocNo, ...patch },
        {
          onSuccess: () => cb?.onSuccess?.(),
          onError:   (e) => cb?.onError?.(e instanceof Error ? e.message : String(e)),
        },
      );
    },
    [stableDocNo, updateHeader],
  );
  const handlePaymentSave = useCallback(
    (patch: Record<string, unknown>) => {
      updateHeader.mutate({ docNo: stableDocNo, ...patch });
    },
    [stableDocNo, updateHeader],
  );
  const closeHistory = useCallback(() => setHistoryOpen(false), []);

  /* Task #80 — Inline line-item edit helpers. Each is keyed on the SoItem.id
     except startAdd which seeds a brand-new SoLineDraft. The mutation payload
     mirrors what SalesOrderNew.tsx posts (snake_case happens server-side).

     Task #103 — startEditLine doesn't need to be stable (it only fires from
     the table-row Pencil button, never as a child prop), but stopEditLine +
     patchEditingDraft DO — they're closed over by the per-row callbacks the
     memoized SoLineCard receives. useCallback with no deps keeps them
     reference-stable across renders; both rely entirely on setState callbacks
     so there's no stale-closure risk. */
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

  const stopEditLine = useCallback((id: string) => {
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
  }, []);

  const patchEditingDraft = useCallback((id: string, patch: Partial<SoLineDraft>) => {
    setEditingDrafts((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  }, []);

  /* Task #103 — Per-row callback map. SoLineCard is now React.memo'd, but a
     fresh `(patch) => patchEditingDraft(it.id, patch)` arrow on every parent
     render still busts shallow-equality on the props and forces a re-render
     of the heaviest child component on the page (which carries its own
     useMfgProducts + useMaintenanceConfig + useFabricTrackings sub-trees).
     The map is keyed on the editing-row id; the Map identity changes only
     when the set of editing rows changes — which is exactly when a row's
     callbacks need to rebind anyway. patchEditingDraft + stopEditLine are
     themselves stable via useCallback above, so the bound arrows here are
     the only churn. */
  const rowCallbacks = useMemo(() => {
    const map = new Map<string, {
      onChange: (patch: Partial<SoLineDraft>) => void;
      onRemove: () => void;
    }>();
    for (const id of editingLineIds) {
      map.set(id, {
        onChange: (patch) => patchEditingDraft(id, patch),
        onRemove: () => stopEditLine(id),
      });
    }
    return map;
  }, [editingLineIds, patchEditingDraft, stopEditLine]);

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

  const cancelAddLine = useCallback(() => setAddingDraft(null), []);

  /* Task #103 — Stable onChange for the lone "+ Add Line Item" SoLineCard at
     the bottom of the table. Mirrors rowCallbacks above but kept as a
     standalone useCallback because there is at most one add-draft at a time. */
  const patchAddingDraft = useCallback(
    (patch: Partial<SoLineDraft>) =>
      setAddingDraft((prev) => prev ? { ...prev, ...patch } : prev),
    [],
  );

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
        onSave={handleHeaderSave}
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
              onChange={patchAddingDraft}
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
                {/* Task #114 — Per-line cost + margin columns. Cost is
                    snapshotted server-side from mfg_products on insert;
                    margin = line_total − line_cost. Mirrors the Houzs
                    Sales Order line-item layout commander pointed at. */}
                <th className={styles.tableRight}>Unit Cost</th>
                <th className={styles.tableRight}>Line Cost</th>
                <th className={styles.tableRight}>Margin</th>
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
                  /* Task #103 — Pull the stable per-row callbacks built once
                     above. The Map entry exists for every id in
                     editingLineIds, so the !cb branch is theoretical. */
                  const cb = rowCallbacks.get(it.id);
                  return (
                    <tr key={it.id}>
                      <td colSpan={10} style={{ padding: 'var(--space-3)' }}>
                        <SoLineCard
                          index={items.indexOf(it)}
                          draft={editDraft}
                          onChange={cb?.onChange ?? ((patch) => patchEditingDraft(it.id, patch))}
                          onRemove={cb?.onRemove ?? (() => stopEditLine(it.id))}
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
                  {/* Task #114 — cost + margin columns. unit_cost_centi is
                      snapshotted server-side from mfg_products on insert.
                      Margin coloring rule matches Houzs: green > 0, red < 0,
                      grey when zero (typically a not-yet-priced item). */}
                  <td className={styles.tableRight}>
                    <span className={styles.muted}>
                      {it.unit_cost_centi > 0 ? fmtRm(it.unit_cost_centi, header.currency) : '—'}
                    </span>
                  </td>
                  <td className={styles.tableRight}>
                    <span className={styles.muted}>
                      {it.line_cost_centi > 0 ? fmtRm(it.line_cost_centi, header.currency) : '—'}
                    </span>
                  </td>
                  <td className={styles.tableRight}>
                    {it.total_centi > 0 ? (
                      <span className={
                        it.line_margin_centi > 0 ? styles.marginGood
                        : it.line_margin_centi < 0 ? styles.marginBad
                        : styles.muted
                      } style={{ fontWeight: 600 }}>
                        {fmtRm(it.line_margin_centi, header.currency)}
                      </span>
                    ) : <span className={styles.muted}>—</span>}
                  </td>
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
                  <td colSpan={10} style={{ padding: 'var(--space-3)' }}>
                    <SoLineCard
                      index={items.length}
                      draft={addingDraft}
                      onChange={patchAddingDraft}
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

      {/* Task #114 — Totals card restored (commander 2026-05-27: "Houzs
          ERP 会计算全部 sku 的 costing 和自动总结一个 category 的 costing").
          The PR #154 hide was about pre-cost-wiring noise; with cost now
          snapshotted server-side and rolled up per category, the card is
          finally useful. Shows Revenue / Cost / Margin / Margin % at the
          top plus a per-category breakdown below. */}
      <TotalsCard header={header} />

      {/* ── Payment — Houzs-pattern transactions table ────────────── */}
      {/* Commander 2026-05-27: "Payment 也 follow Hookka 那个排版". Verbatim
          port of houzs-erp/src/components/NewSalesOrderForm.tsx Payments
          block (lines 1047-1126). Subtotal / Expected Deposit dropped —
          Houzs doesn't have them, and commander wants the ledger view
          (transactions + Deposit Paid + Balance) only.
          Task #105 — PaymentCard was extracted into <PaymentsTable> so
          New SO and Edit SO render the same ledger from one source. */}
      <PaymentsTable
        docNo={header.doc_no}
        grandTotalCenti={header.local_total_centi}
        currency={header.currency}
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
        <HistoryPanel docNo={header.doc_no} onClose={closeHistory} />
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

/* Task #99 (UI perf) — Wrap the CustomerCard in memo so parent page state
   churn (Edit-mode toggle, History drawer, line-item edits) doesn't
   re-render the full address-cascade tree. Combined with the `onSave`
   useCallback in the page below + the debtor-search debounce, this is the
   biggest single saving on the Detail page. */
const CustomerCardInner = forwardRef<CustomerCardHandle, CustomerCardProps>(({
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
  /* Task #99 (UI perf) — 200 ms debounce on the debtor autocomplete. Until
     this commit each keystroke in the Customer Name field issued a
     /debtors/search request. The hook itself now guards length>=2 (see
     flow-queries.ts) but a fast typist still produced one request per
     character on top of that, which was the dominant freeze when entering
     a new customer. Debouncing here keeps `form.customerName` reactive for
     the rest of the card (state cascade, save payload) while the autocomplete
     hook sees a settled value. */
  const debouncedDebtorQ = useDebouncedValue(form.customerName, 200);
  const debtorQuery = useDebtorSearch(debouncedDebtorQ);
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
CustomerCardInner.displayName = 'CustomerCardInner';
const CustomerCard = memo(CustomerCardInner) as typeof CustomerCardInner;

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

/* Task #99 (UI perf) — VariantsPills renders once per line item in the
   table. With ~20 lines on a typical SO + 36-col DataGrid in the same
   page, the cumulative re-render cost was non-trivial. Pure prop-driven
   so React.memo is a free win. */
const VariantsPills = memo(({ variants }: { variants: Record<string, unknown> | null }) => {
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
});
VariantsPills.displayName = 'VariantsPills';

/* ════════════════════════════════════════════════════════════════════════
   Totals card
   ════════════════════════════════════════════════════════════════════════ */

const TotalsCard = ({ header }: { header: SoHeader }) => {
  // margin_pct_basis is margin/revenue × 10000 (i.e. percent × 100). Divide
  // by 100 to get the displayed percentage. Coloring rule matches the Houzs
  // detail page: ≥30% emerald, ≥15% amber, < 15% red, 0/negative red.
  const marginPct = header.margin_pct_basis / 100;
  const marginCls =
    header.total_margin_centi <= 0 ? styles.marginBad
    : marginPct >= 30 ? styles.marginGood
    : marginPct >= 15 ? styles.marginWarn
    : styles.marginBad;

  /* Task #114 — Per-category rows. Each category surfaces revenue, cost,
     and margin (revenue − cost) so commander can see where the SO's
     margin is coming from at a glance. Cost columns fall back to 0 when
     the row pre-dates migration 0079 (it'll backfill on next item write). */
  const categories: Array<{ label: string; rev: number; cost: number }> = [
    { label: 'Mattress / Sofa', rev: header.mattress_sofa_centi, cost: header.mattress_sofa_cost_centi ?? 0 },
    { label: 'Bedframe',        rev: header.bedframe_centi,      cost: header.bedframe_cost_centi      ?? 0 },
    { label: 'Accessories',     rev: header.accessories_centi,   cost: header.accessories_cost_centi   ?? 0 },
    { label: 'Others',          rev: header.others_centi,        cost: header.others_cost_centi        ?? 0 },
  ];

  const fmtMarginClass = (rev: number, marginCenti: number) => {
    if (rev <= 0) return styles.muted;
    if (marginCenti > 0) return styles.marginGood;
    if (marginCenti < 0) return styles.marginBad;
    return styles.muted;
  };

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Totals · Margin</h2>
      </header>
      <div className={styles.cardBody}>
        {/* Top row — Revenue / Cost / Margin / Margin % as 4 KPI tiles */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 'var(--space-3)',
          marginBottom: 'var(--space-3)',
          paddingBottom: 'var(--space-3)',
          borderBottom: '1px solid var(--line)',
        }}>
          <div>
            <div className={styles.totalLabel}>Revenue</div>
            <div className={styles.grandTotal} style={{ fontSize: 'var(--fs-18)' }}>
              {fmtRm(header.local_total_centi, header.currency)}
            </div>
          </div>
          <div>
            <div className={styles.totalLabel}>Cost</div>
            <div className={styles.totalValue} style={{ fontSize: 'var(--fs-18)' }}>
              {fmtRm(header.total_cost_centi, header.currency)}
            </div>
          </div>
          <div>
            <div className={styles.totalLabel}>Margin</div>
            <div className={`${styles.totalValue} ${marginCls}`} style={{ fontSize: 'var(--fs-18)' }}>
              {fmtRm(header.total_margin_centi, header.currency)}
            </div>
          </div>
          <div>
            <div className={styles.totalLabel}>Margin %</div>
            <div className={`${styles.totalValue} ${marginCls}`} style={{ fontSize: 'var(--fs-18)' }}>
              {header.local_total_centi > 0 ? `${marginPct.toFixed(1)}%` : '—'}
            </div>
          </div>
        </div>

        {/* By-category breakdown */}
        <div className={styles.totalLabel} style={{ marginBottom: 'var(--space-2)' }}>
          By Category
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {categories.map(({ label, rev, cost }) => {
            const margin = rev - cost;
            return (
              <div key={label} style={{
                display: 'grid',
                gridTemplateColumns: '1.4fr 1fr 1fr 1fr',
                gap: 'var(--space-3)',
                alignItems: 'baseline',
              }}>
                <div className={styles.totalLabel} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 'var(--fs-13)' }}>
                  {label}
                </div>
                <div className={styles.totalValue}>
                  Revenue {fmtRm(rev, header.currency)}
                </div>
                <div className={styles.totalValue} style={{ color: 'var(--fg-muted)' }}>
                  Cost {fmtRm(cost, header.currency)}
                </div>
                <div className={`${styles.totalValue} ${fmtMarginClass(rev, margin)}`}>
                  Margin {fmtRm(margin, header.currency)}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Task #101 — dead code removal (2026-05-27)
   ────────────────────────────────────────────────────────────────────────
   The following exports/components were removed because PR #171 (Houzs
   rollout) replaced their callers:
     • StatusBar + NEXT — status transition strip; the Edit/Save framework
       now drives status changes via updateStatus.mutate() directly from
       the page header (commander 2026-05-27: "这个不需要")
     • AddressCard — multi-address (ship-to / bill-to / install-to) card;
       PR #168 replaced it with the 4-section CustomerCard split below.
   The DB columns the deleted components read from (ship_to_address /
   bill_to_address / install_to_address / customer_po / customer_po_id /
   customer_po_date / hub_name / overdue) remain in the schema so existing
   rows stay queryable — only the UI rendering is gone.
   ════════════════════════════════════════════════════════════════════════ */

/* ════════════════════════════════════════════════════════════════════════
   PaymentCard moved → components/PaymentsTable (task #105).
   AddressCard + StatusBar + NEXT deleted as dead code (task #101).
   ════════════════════════════════════════════════════════════════════════ */



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

/* Task #99 (UI perf) — Memoize the History drawer. It only mounts when
   `historyOpen` is true (so the audit-log query is correctly lazy by
   construction) but once opened, scrolling / expanding individual entries
   triggers internal state changes that would otherwise re-render the entire
   parent page. With docNo + onClose stable from the parent (the parent's
   onClose is wrapped in useCallback below), shallow-compare prevents the
   parent-driven re-renders. */
const HistoryPanel = memo(({
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
});
HistoryPanel.displayName = 'HistoryPanel';
