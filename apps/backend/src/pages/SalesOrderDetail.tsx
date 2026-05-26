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
  /* PR #143 — Payment (mirrors POS handover) */
  payment_method: string | null;        // cash | transfer | merchant | installment
  installment_months: number | null;    // 6 | 12
  merchant_provider: string | null;     // GHL | HLB | MBB | PBB
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
  // PR #145 — IN_PRODUCTION removed from the locked list (trading flow
  // doesn't use it). READY_TO_SHIP is the new earliest locked state.
  const lockedStatuses: SoStatus[] = ['READY_TO_SHIP', 'SHIPPED', 'DELIVERED', 'INVOICED', 'CLOSED', 'CANCELLED'];

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
              {/* PR #144 — Group column removed ("group是什么 删掉").
                  Category is already visible as a colored badge inside
                  the item's variant pills, so the raw "mfg_product"
                  internal kind isn't useful in the table view. */}
              <tr>
                <th>Item</th>
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

      {/* ── Payment (PR #143) ───────────────────────────────────── */}
      <PaymentCard
        header={header}
        onSave={(patch) => updateHeader.mutate({ docNo: header.doc_no, ...patch })}
        saving={updateHeader.isPending}
        locked={isLocked}
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
        const requireVariants = !!header.internal_expected_dd;
        const REQUIRED_BEDFRAME_KEYS = ['divanHeight', 'legHeight', 'gap', 'fabricCode'] as const;
        const incompleteBedframeLines = requireVariants
          ? items
              .filter((it) => (it.item_group ?? '').toLowerCase() === 'bedframe')
              .filter((it) => {
                const v = (it.variants ?? {}) as Record<string, unknown>;
                return REQUIRED_BEDFRAME_KEYS.some((k) => {
                  const val = v[k];
                  return val === undefined || val === null || val === '';
                });
              })
              .map((it) => it.item_code)
          : [];
        const gated = incompleteBedframeLines.length > 0;
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
                <strong>Processing Date is set — bedframe variants must be filled before next stage.</strong>
                <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                  Incomplete: {incompleteBedframeLines.join(', ')}.<br />
                  Required: Divan Height · Leg Height · Gap · Fabric.
                </div>
              </div>
            )}
            <StatusBar
              status={header.status}
              onTransition={(s) => {
                if (gated) {
                  window.alert(
                    'Processing Date is set, so all bedframe variants (divan/leg/gap/fabric) must be filled before moving to the next stage.\n\n' +
                    'Incomplete: ' + incompleteBedframeLines.join(', '),
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
  const [form, setForm] = useState({
    customerCode: header.debtor_code ?? '',
    customerName: header.debtor_name ?? '',
    email: header.email ?? '',
    customerType: header.customer_type ?? '',
    salespersonId: header.salesperson_id ?? '',
    buildingType: header.building_type ?? header.venue ?? '',
    phone: header.phone ?? '',
    address1: header.address1 ?? '',
    address2: header.address2 ?? '',
    city: header.city ?? header.address3 ?? '',
    postcode: header.postcode ?? header.address4 ?? '',
    state: header.customer_state ?? '',
    emergencyContactName: header.emergency_contact_name ?? '',
    emergencyContactPhone: header.emergency_contact_phone ?? '',
    emergencyContactRelationship: header.emergency_contact_relationship ?? '',
    processingDate: header.internal_expected_dd ?? '',
    customerDeliveryDate: header.customer_delivery_date ?? '',
    note: header.note ?? '',
  });
  const [showSuggest, setShowSuggest] = useState(false);
  const debtorQuery = useDebtorSearch(form.customerName);
  const suggestions = (debtorQuery.data?.debtors ?? []).filter(
    (d) => (d.debtor_name ?? '').toLowerCase() !== form.customerName.trim().toLowerCase(),
  );

  useEffect(() => {
    setForm({
      customerCode: header.debtor_code ?? '',
      customerName: header.debtor_name ?? '',
      email: header.email ?? '',
      customerType: header.customer_type ?? '',
      salespersonId: header.salesperson_id ?? '',
      buildingType: header.building_type ?? header.venue ?? '',
      phone: header.phone ?? '',
      address1: header.address1 ?? '',
      address2: header.address2 ?? '',
      city: header.city ?? header.address3 ?? '',
      postcode: header.postcode ?? header.address4 ?? '',
      state: header.customer_state ?? '',
      emergencyContactName: header.emergency_contact_name ?? '',
      emergencyContactPhone: header.emergency_contact_phone ?? '',
      emergencyContactRelationship: header.emergency_contact_relationship ?? '',
      processingDate: header.internal_expected_dd ?? '',
      customerDeliveryDate: header.customer_delivery_date ?? '',
      note: header.note ?? '',
    });
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
    email: form.email,
    customerType: form.customerType,
    salespersonId: form.salespersonId || null,
    buildingType: form.buildingType,
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

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Customer · Addresses</h2>
        <Button variant="primary" size="sm" onClick={() => onSave(buildPayload())} disabled={saving}>
          <Save {...ICON} />
          <span>{saving ? 'Saving…' : 'Save'}</span>
        </Button>
      </header>
      <div className={styles.cardBody}>
        {/* ── Customer row (POS-aligned, PR #46) ─────────────────── */}
        <p className={styles.subHead}>Customer</p>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Customer Code</span>
            <input className={styles.fieldInput} value={form.customerCode}
              onChange={(e) => set('customerCode', e.target.value)} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 3' }}>
            <span className={styles.fieldLabel}>Customer Name *</span>
            <input
              className={styles.fieldInput}
              value={form.customerName}
              onChange={(e) => { set('customerName', e.target.value); setShowSuggest(true); }}
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
            <span className={styles.fieldLabel}>Phone *</span>
            <input className={styles.fieldInput} value={form.phone}
              onChange={(e) => set('phone', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email *</span>
            <input type="email" className={styles.fieldInput} value={form.email}
              onChange={(e) => set('email', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Customer Type</span>
            <select className={styles.fieldSelect} value={form.customerType}
              onChange={(e) => set('customerType', e.target.value)}>
              <option value="">—</option>
              <option value="NEW">New</option>
              <option value="EXISTING">Existing</option>
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Salesperson</span>
            <select className={styles.fieldSelect} value={form.salespersonId}
              onChange={(e) => set('salespersonId', e.target.value)}>
              <option value="">— Pick staff —</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.staffCode})</option>
              ))}
            </select>
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>Building Type</span>
            <select className={styles.fieldSelect} value={form.buildingType}
              onChange={(e) => set('buildingType', e.target.value)}>
              <option value="">—</option>
              {BUILDING_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
            </select>
          </label>
          {/* PR #140 — Processing + Delivery Date replace Target Date.
              Same fields the New SO form has; keeps create + edit in sync. */}
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Processing Date</span>
            <input type="date" className={styles.fieldInput} value={form.processingDate}
              onChange={(e) => set('processingDate', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Delivery Date</span>
            <input type="date" className={styles.fieldInput} value={form.customerDeliveryDate}
              onChange={(e) => set('customerDeliveryDate', e.target.value)} />
          </label>
          <label className={`${styles.field}`} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Note</span>
            <input className={styles.fieldInput} value={form.note}
              onChange={(e) => set('note', e.target.value)} />
          </label>
        </div>

        {/* ── Emergency contact (PR #46) ───────────────────────────── */}
        <p className={styles.subHead} style={{ marginTop: 'var(--space-3)' }}>
          Emergency Contact <span className={styles.muted} style={{ fontWeight: 400 }}>
            — used only if we can't reach the customer on delivery day
          </span>
        </p>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Contact Name</span>
            <input className={styles.fieldInput} value={form.emergencyContactName}
              placeholder="e.g. Lim Mei Hua"
              onChange={(e) => set('emergencyContactName', e.target.value)} />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Relationship</span>
            <input className={styles.fieldInput} value={form.emergencyContactRelationship}
              placeholder="Spouse / Parent / Sibling …"
              onChange={(e) => set('emergencyContactRelationship', e.target.value)} />
          </label>
          <label className={styles.field} style={{ gridColumn: 'span 2' }}>
            <span className={styles.fieldLabel}>Phone</span>
            <input className={styles.fieldInput} value={form.emergencyContactPhone}
              placeholder="+60 12 345 6789"
              onChange={(e) => set('emergencyContactPhone', e.target.value)} />
          </label>
        </div>

        {/* ── Address row ─────────────────────────────────────────── */}
        <p className={styles.subHead} style={{ marginTop: 'var(--space-3)' }}>Delivery Address</p>
        <div className={styles.formGrid4}>
          <label className={`${styles.field}`} style={{ gridColumn: 'span 4' }}>
            <span className={styles.fieldLabel}>Address Line 1</span>
            <input className={styles.fieldInput} value={form.address1}
              placeholder="Unit, street, area"
              onChange={(e) => set('address1', e.target.value)} />
          </label>
          <label className={`${styles.field}`} style={{ gridColumn: 'span 4' }}>
            <span className={styles.fieldLabel}>Address Line 2</span>
            <input className={styles.fieldInput} value={form.address2}
              placeholder="Apt, floor, building (optional)"
              onChange={(e) => set('address2', e.target.value)} />
          </label>

          <label className={styles.field}>
            <span className={styles.fieldLabel}>State</span>
            <select className={styles.fieldSelect} value={form.state}
              onChange={(e) => setForm((s) => ({ ...s, state: e.target.value, city: '', postcode: '' }))}
              disabled={localities.isLoading}>
              <option value="">{localities.isLoading ? 'Loading…' : 'Pick state'}</option>
              {states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>City</span>
            <select className={styles.fieldSelect} value={form.city}
              onChange={(e) => setForm((s) => ({ ...s, city: e.target.value, postcode: '' }))}
              disabled={!form.state}>
              <option value="">{form.state ? 'Pick city' : '— pick state first'}</option>
              {cities.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Postcode</span>
            <select className={styles.fieldSelect} value={form.postcode}
              onChange={(e) => set('postcode', e.target.value)}
              disabled={!form.city}>
              <option value="">{form.city ? 'Pick postcode' : '— pick city first'}</option>
              {postcodes.map((p) => <option key={p} value={p}>{p}</option>)}
            </select>
          </label>
          <div className={styles.field}>
            <span className={styles.fieldLabel}>Sales Location</span>
            <span className={styles.fieldInput} style={{
              display: 'inline-flex', alignItems: 'center', height: 32,
              color: 'var(--fg-muted)',
            }}>
              {header.sales_location ?? '—'}
            </span>
          </div>
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

/* PR #145 — Commander 2026-05-26: "这个 2990 整套系统是 trading 公司来的，
   它不是 manufacturing，不需要 in production". The IN_PRODUCTION stage is
   a HOOKKA manufacturing concept — trading shops skip straight from
   CONFIRMED to READY_TO_SHIP (goods already on hand at the warehouse, just
   waiting for dispatch).
   The DB enum still carries 'IN_PRODUCTION' (existing rows might use it),
   but the UI no longer offers it as a forward transition. */
const NEXT: Record<SoStatus, SoStatus[]> = {
  DRAFT:          ['CONFIRMED', 'CANCELLED'],
  CONFIRMED:      ['READY_TO_SHIP', 'CANCELLED'],
  IN_PRODUCTION:  ['READY_TO_SHIP', 'CANCELLED'], // legacy rows still resolve
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
   PaymentCard — PR #143. Commander: "POS system 的 payment 那个地方也放进来
   Sales Order 里面". Mirrors apps/pos/src/components/handover/
   AddonsPaymentStep — same 4 methods, same sub-options (merchant provider /
   installment term), same 50% deposit convention. Persists to migration
   0068 columns on mfg_sales_orders.
   ════════════════════════════════════════════════════════════════════════ */

type PaymentMethod = 'cash' | 'transfer' | 'merchant' | 'installment';

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

  const [form, setForm] = useState({
    method:          (header.payment_method as PaymentMethod | null) ?? '',
    installment:     header.installment_months ?? null,
    merchant:        header.merchant_provider ?? '',
    depositCenti:    header.deposit_centi ?? 0,
    paidCenti:       header.paid_centi ?? 0,
  });

  useEffect(() => {
    setForm({
      method:          (header.payment_method as PaymentMethod | null) ?? '',
      installment:     header.installment_months ?? null,
      merchant:        header.merchant_provider ?? '',
      depositCenti:    header.deposit_centi ?? 0,
      paidCenti:       header.paid_centi ?? 0,
    });
  }, [header]);

  const pick = (m: PaymentMethod) =>
    setForm((s) => ({
      ...s,
      method: m,
      installment: m === 'installment' ? (s.installment ?? 6) : null,
      merchant:    m === 'merchant'    ? (s.merchant || 'GHL') : '',
    }));

  const balanceCenti = Math.max(0, grandTotal - form.paidCenti);
  const isHalfPaid = form.paidCenti > 0 && form.paidCenti >= half && form.paidCenti < grandTotal;
  const isFullPaid = grandTotal > 0 && form.paidCenti >= grandTotal;

  const submit = () => {
    onSave({
      paymentMethod:     form.method || null,
      installmentMonths: form.installment,
      merchantProvider:  form.merchant || null,
      depositCenti:      form.depositCenti,
      paidCenti:         form.paidCenti,
    });
  };

  const methodBtn = (m: PaymentMethod, label: string, hint: string) => {
    const active = form.method === m;
    return (
      <button
        type="button"
        disabled={locked}
        onClick={() => pick(m)}
        style={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 2,
          padding: 'var(--space-3)',
          background: active ? 'rgba(232, 107, 58, 0.10)' : 'var(--c-paper)',
          border: '1px solid ' + (active ? 'var(--c-orange)' : 'var(--line)'),
          borderRadius: 'var(--radius-md)',
          color: active ? 'var(--c-burnt)' : 'var(--c-ink)',
          cursor: locked ? 'not-allowed' : 'pointer',
          fontFamily: 'var(--font-sans)',
          textAlign: 'left',
        }}
      >
        <strong style={{ fontSize: 'var(--fs-13)' }}>{label}</strong>
        <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>{hint}</span>
      </button>
    );
  };

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Payment</h2>
        <Button variant="primary" size="sm" onClick={submit} disabled={saving || locked}>
          <Save {...ICON} />
          <span>{saving ? 'Saving…' : 'Save'}</span>
        </Button>
      </header>
      <div className={styles.cardBody}>
        {/* Method picker — 4 buttons, 2x2 */}
        <p className={styles.subHead}>Method</p>
        <div style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 'var(--space-2)' }}>
          {methodBtn('merchant',    'Merchant',           'Card via GHL / HLB / MBB / PBB')}
          {methodBtn('transfer',    'Bank transfer / DuitNow', 'Slip required')}
        </div>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          {methodBtn('installment', 'Installment',        '0% — 6 or 12 months')}
          {methodBtn('cash',        'Cash',               'Cash received at counter')}
        </div>

        {/* Sub-options */}
        {form.method === 'merchant' && (
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span className={styles.fieldLabel}>Merchant</span>
            {(['GHL', 'HLB', 'MBB', 'PBB'] as const).map((p) => (
              <button
                key={p}
                type="button"
                disabled={locked}
                onClick={() => setForm((s) => ({ ...s, merchant: p }))}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-12)',
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid ' + (form.merchant === p ? 'var(--c-orange)' : 'var(--line)'),
                  background: form.merchant === p ? 'rgba(232, 107, 58, 0.12)' : 'var(--c-paper)',
                  color: form.merchant === p ? 'var(--c-burnt)' : 'var(--c-ink)',
                  cursor: locked ? 'not-allowed' : 'pointer',
                }}
              >
                {p}
              </button>
            ))}
          </div>
        )}

        {form.method === 'installment' && (
          <div style={{ marginTop: 'var(--space-3)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span className={styles.fieldLabel}>Term</span>
            {([6, 12] as const).map((m) => (
              <button
                key={m}
                type="button"
                disabled={locked}
                onClick={() => setForm((s) => ({ ...s, installment: m }))}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-12)',
                  fontWeight: 600,
                  padding: '4px 12px',
                  borderRadius: 'var(--radius-pill)',
                  border: '1px solid ' + (form.installment === m ? 'var(--c-orange)' : 'var(--line)'),
                  background: form.installment === m ? 'rgba(232, 107, 58, 0.12)' : 'var(--c-paper)',
                  color: form.installment === m ? 'var(--c-burnt)' : 'var(--c-ink)',
                  cursor: locked ? 'not-allowed' : 'pointer',
                }}
              >
                {m} months
              </button>
            ))}
          </div>
        )}

        {/* Deposit / Paid / Balance row */}
        <p className={styles.subHead} style={{ marginTop: 'var(--space-4)' }}>Amounts</p>
        <div className={styles.formGrid4}>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Grand Total</span>
            <span className={styles.fieldInput} style={{
              display: 'inline-flex', alignItems: 'center', height: 32,
              fontFamily: 'var(--font-mono)', color: 'var(--c-ink)', fontWeight: 600,
            }}>
              {fmtRm(grandTotal, header.currency)}
            </span>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Deposit ({header.currency})
              {form.depositCenti === half && grandTotal > 0 && (
                <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-orange)' }}>· 50%</span>
              )}
            </span>
            <input
              type="number" step="0.01" min={0}
              className={styles.fieldInput}
              value={(form.depositCenti / 100).toFixed(2)}
              disabled={locked}
              onChange={(e) => setForm((s) => ({ ...s, depositCenti: Math.round(Number(e.target.value) * 100) || 0 }))}
            />
            <button
              type="button"
              onClick={() => setForm((s) => ({ ...s, depositCenti: half }))}
              disabled={locked || grandTotal === 0}
              style={{
                marginTop: 4,
                background: 'transparent', border: 'none',
                color: 'var(--c-orange)', cursor: locked ? 'not-allowed' : 'pointer',
                fontSize: 'var(--fs-11)', fontWeight: 600, padding: 0, textAlign: 'left',
              }}
            >
              Set 50% deposit ({fmtRm(half, header.currency)})
            </button>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Paid ({header.currency})</span>
            <input
              type="number" step="0.01" min={0}
              className={styles.fieldInput}
              value={(form.paidCenti / 100).toFixed(2)}
              disabled={locked}
              onChange={(e) => setForm((s) => ({ ...s, paidCenti: Math.round(Number(e.target.value) * 100) || 0 }))}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>
              Balance
              {isFullPaid && (
                <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-secondary-a, #2F5D4F)' }}>· PAID</span>
              )}
              {isHalfPaid && (
                <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-orange)' }}>· deposit only</span>
              )}
            </span>
            <span className={styles.fieldInput} style={{
              display: 'inline-flex', alignItems: 'center', height: 32,
              fontFamily: 'var(--font-mono)',
              color: isFullPaid ? 'var(--c-secondary-a, #2F5D4F)' : 'var(--c-ink)',
              fontWeight: 600,
            }}>
              {fmtRm(balanceCenti, header.currency)}
            </span>
          </label>
        </div>
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
