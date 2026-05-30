// ----------------------------------------------------------------------------
// PaymentsTable — shared Houzs-pattern payments ledger.
//
// Task #105 — Commander 2026-05-27: "Edit SO 和 New SO 界面一定要一样的啊"
// New SO and Edit SO must render an IDENTICAL Payments section. This component
// was extracted verbatim from SalesOrderDetail.tsx's PaymentCard so both pages
// can reuse it without drift.
//
// Two modes:
//   - SAVED mode  (docNo: string)
//       Uses useSalesOrderPayments / useAddSalesOrderPayment /
//       useDeleteSalesOrderPayment. Each row commit POSTs to
//       /mfg-sales-orders/:docNo/payments.
//   - DRAFT mode  (docNo: null + payments + onChange)
//       Holds payments in caller-supplied local state. No API calls. Used
//       on the New SO page where the docNo doesn't exist until the SO has
//       been created. After the parent POSTs the SO, it replays each draft
//       through POST /:docNo/payments before navigating to the Detail page.
//
// Visuals + columns + method options + label→API enum mapping are identical
// across both modes.
// ----------------------------------------------------------------------------

import { memo, useState, type CSSProperties } from 'react';
import {
  DollarSign, Plus, Trash2, Save, FileText,
  Calendar as CalIcon, User as UserIcon, Tag,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useStaff } from '../lib/admin-queries';
import {
  useSalesOrderPayments,
  useAddSalesOrderPayment,
  useDeleteSalesOrderPayment,
  type SoPayment,
} from '../lib/flow-queries';
import {
  useSoDropdownOptions, optionsOrFallback,
} from '../lib/so-dropdown-options-queries';
import detailStyles from '../pages/SalesOrderDetail.module.css';
import paymentsStyles from '../pages/Payments.module.css';

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

/* ════════════════════════════════════════════════════════════════════════
   API enum + Houzs friendly-label mapping (kept verbatim from PaymentCard
   so the Detail page's ledger semantics don't change).
   ════════════════════════════════════════════════════════════════════════ */

export type PaymentMethod = 'merchant' | 'transfer' | 'cash';
/* Bank provider name (now open-ended — sourced from
   so_dropdown_options('payment_merchant'), no longer constrained to the
   legacy 4-bank enum). */
export type MerchantProvider = string;

/* Task #122 (cascade) — Commander 2026-05-27 corrected the structure.
   Method is now a 3-step cascade:
     Method (L1)  → Merchant | Online | Cash
       Merchant   → pick Merchant bank + Installment plan
       Online     → pick Online sub-type (Bank Transfer / TNG / Cheque / DuitNow)
       Cash       → done
   The L1 labels are the only thing labelToApi() needs to route: Merchant →
   'merchant' (card / installment), Online → 'transfer' (TNG / DuitNow /
   cheque / bank transfer), Cash → 'cash'. Anything else falls through to
   cash with a console.warn so a typo on the maintenance page doesn't
   silently miscategorise a transaction. */
export const PAYMENT_METHOD_OPTIONS = ['Merchant', 'Online', 'Cash'] as const;
export type PaymentMethodLabel = string;

export const labelToApi = (label: PaymentMethodLabel): {
  method: PaymentMethod;
  merchantProvider: MerchantProvider | null;
} => {
  switch (label) {
    case 'Merchant':
      return { method: 'merchant', merchantProvider: null };
    case 'Online':
      return { method: 'transfer', merchantProvider: null };
    case 'Cash':
      return { method: 'cash', merchantProvider: null };
    default:
      // Cascade Method labels are tightly scoped (3 values). An unknown
      // label means the maintenance page row drifted from the cascade
      // structure — surface it and fall back to cash so we don't book a
      // card payment as transfer accidentally.
      // eslint-disable-next-line no-console
      console.warn(
        `[PaymentsTable] Unknown payment method label "${label}" — falling ` +
        `back to method=cash. Method labels must be Merchant / Online / Cash. ` +
        `If you've added a new category, update labelToApi() in ` +
        `apps/backend/src/components/PaymentsTable.tsx.`,
      );
      return { method: 'cash', merchantProvider: null };
  }
};

const apiToLabel = (p: SoPayment): string => {
  if (p.method === 'cash')     return 'Cash';
  if (p.method === 'transfer') return 'Online';
  if (p.method === 'merchant') return 'Merchant';
  return 'Cash';
};

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

/* ════════════════════════════════════════════════════════════════════════
   Shared draft row shape — what the inline-editor renders.

   In SAVED mode this is internal state; rows promote to API rows on commit.
   In DRAFT mode the parent owns the array (PaymentDraft[]) so we expose the
   same shape minus the `uid` (parent can derive a key per row).
   ════════════════════════════════════════════════════════════════════════ */

/* Task #122 (cascade) — methodLabel is the L1 pick (Merchant / Online /
   Cash). The three optional sub-fields below carry the L2 picks; only the
   field(s) relevant to the current methodLabel are populated.
     methodLabel = Merchant → merchantProvider + installmentMonthsLabel
     methodLabel = Online   → onlineType
     methodLabel = Cash     → all three sub-fields stay ''
   installmentMonthsLabel is stored verbatim from the dropdown (e.g.
   'One-off', '3 months', '12 months') and parsed to an integer on
   persist (One-off → null/0; 'N months' → N). */
export type PaymentDraft = {
  uid:                      string;
  paidAt:                   string;             // YYYY-MM-DD
  methodLabel:              PaymentMethodLabel;
  merchantProvider:         string;             // L2 bank pick (Merchant only)
  installmentMonthsLabel:   string;             // L2 plan pick (Merchant only)
  onlineType:               string;             // L2 sub-type (Online only)
  amountCenti:              number;
  accountSheet:             string;
  approvalCode:             string;
  collectedBy:              string;             // staff.id (uuid) | ''
};

export const newPaymentDraft = (defaultStaffId = ''): PaymentDraft => ({
  uid: Math.random().toString(36).slice(2, 10),
  paidAt: new Date().toISOString().slice(0, 10),
  methodLabel: 'Cash',
  merchantProvider:       '',
  installmentMonthsLabel: '',
  onlineType:             '',
  amountCenti: 0,
  accountSheet: '',
  approvalCode: '',
  collectedBy: defaultStaffId,
});

/* Parse an installment-plan label like 'One-off' / '3 months' / '12 months'
   into an integer term in months. 'One-off' and unrecognised strings return
   null (= no installment); otherwise the leading number. */
export const parseInstallmentMonths = (label: string): number | null => {
  if (!label || label === 'One-off') return null;
  const m = /^(\d+)\s*month/i.exec(label.trim());
  return m ? Number(m[1]) : null;
};

/* ════════════════════════════════════════════════════════════════════════
   Props — discriminated union on `docNo`.
   - docNo: string   → SAVED mode (mutations + remote fetch)
   - docNo: null     → DRAFT mode (caller-owned state)
   ════════════════════════════════════════════════════════════════════════ */

type SavedModeProps = {
  docNo: string;
  /** Grand total used to compute the Balance summary at the bottom. */
  grandTotalCenti: number;
  currency?: string;
  /** When true, hides Add Payment + per-row trash/save controls. */
  locked?: boolean;
};

type DraftModeProps = {
  docNo: null;
  payments: PaymentDraft[];
  onChange: (next: PaymentDraft[]) => void;
  grandTotalCenti: number;
  currency?: string;
  locked?: boolean;
};

export type PaymentsTableProps = SavedModeProps | DraftModeProps;

/* ════════════════════════════════════════════════════════════════════════
   Component.
   ════════════════════════════════════════════════════════════════════════ */

const PaymentsTableInner = (props: PaymentsTableProps) => {
  const currency = props.currency ?? 'MYR';
  const grandTotal = props.grandTotalCenti ?? 0;
  const locked = props.locked ?? false;

  const staffQ = useStaff();
  const staff  = staffQ.data ?? [];
  const auth   = useAuth();

  /* Task #118 — methods are DB-backed (so_dropdown_options 'payment_method').
     Falls back to PAYMENT_METHOD_OPTIONS during loading + when the DB has
     zero rows so the user never sees an empty select.

     Task #122 (cascade) — three additional categories for the L2 picks
     under Merchant + Online. */
  const methodOptsQ      = useSoDropdownOptions('payment_method');
  const methodOpts       = optionsOrFallback('payment_method', methodOptsQ.data);
  const merchantOptsQ    = useSoDropdownOptions('payment_merchant');
  const merchantOpts     = optionsOrFallback('payment_merchant', merchantOptsQ.data);
  const onlineOptsQ      = useSoDropdownOptions('online_type');
  const onlineOpts       = optionsOrFallback('online_type', onlineOptsQ.data);
  const installmentOptsQ = useSoDropdownOptions('installment_plan');
  const installmentOpts  = optionsOrFallback('installment_plan', installmentOptsQ.data);

  /* ── SAVED MODE hooks (always called — TanStack Query lazily skips
        when enabled=false). docNo is non-null in SAVED mode. ──────────── */
  const isSaved = props.docNo !== null;
  const paymentsQ     = useSalesOrderPayments(isSaved ? props.docNo : null);
  const addPayment    = useAddSalesOrderPayment();
  const deletePayment = useDeleteSalesOrderPayment();

  /* SAVED-mode local drafts (pre-commit rows). DRAFT mode uses parent's
     `payments` array directly. */
  const [savedDrafts, setSavedDrafts] = useState<PaymentDraft[]>([]);

  const persistedPayments: SoPayment[] = isSaved ? (paymentsQ.data ?? []) : [];
  const drafts: PaymentDraft[] = isSaved ? savedDrafts : (props as DraftModeProps).payments;

  /* Default Collected By → current logged-in staff (2026-05-27 audit pass).
     Commander's screenshot showed new payment rows defaulting to '—' / first
     dropdown entry instead of the staff who's actually entering the
     payment. Resolves auth.staff?.id and validates that the id exists in
     the active staff dropdown before applying — guards against the race
     where the user clicks Add Payment before useStaff() resolves, and the
     edge case where the auth'd user's staff row is inactive (rare; happens
     when an admin disables themselves). Falls back to '' (= '—' option)
     so the dropdown doesn't lie about who collected the cash. Existing
     persisted payments retain their saved `collected_by` value — this
     default only seeds NEW draft rows. */
  const defaultStaffId = (() => {
    const id = auth.staff?.id ?? '';
    if (!id) return '';
    // Validate the staff id is in the active list. If staff hasn't loaded
    // yet (staffQ.isLoading) the filter is empty — still return the id
    // so the dropdown gets the right initial value once the option lands.
    if (staff.length === 0) return id;
    const hit = staff.find((s) => s.id === id && s.active);
    return hit ? id : '';
  })();

  const addDraft = () => {
    const d = newPaymentDraft(defaultStaffId);
    if (isSaved) {
      setSavedDrafts((prev) => [...prev, d]);
    } else {
      (props as DraftModeProps).onChange([...(props as DraftModeProps).payments, d]);
    }
  };

  const patchDraft = (uid: string, patch: Partial<PaymentDraft>) => {
    if (isSaved) {
      setSavedDrafts((prev) => prev.map((d) => d.uid === uid ? { ...d, ...patch } : d));
    } else {
      const cur = (props as DraftModeProps).payments;
      (props as DraftModeProps).onChange(
        cur.map((d) => d.uid === uid ? { ...d, ...patch } : d),
      );
    }
  };

  const removeDraft = (uid: string) => {
    if (isSaved) {
      setSavedDrafts((prev) => prev.filter((d) => d.uid !== uid));
    } else {
      const cur = (props as DraftModeProps).payments;
      (props as DraftModeProps).onChange(cur.filter((d) => d.uid !== uid));
    }
  };

  /* SAVED mode commit — fire POST /:docNo/payments. DRAFT mode has no
     commit affordance; the parent batches them at SO-create time. */
  const commitDraft = (d: PaymentDraft) => {
    if (!isSaved) return;
    if (d.amountCenti <= 0) return;
    const { method } = labelToApi(d.methodLabel);
    /* Cascade payload — populate sub-fields by the L1 method only. The
       API mirrors the same guard and will scrub any irrelevant sub-fields
       (e.g. a stale onlineType left over from a Merchant→Online toggle). */
    const body: Record<string, unknown> = {
      docNo:        (props as SavedModeProps).docNo,
      paidAt:       d.paidAt,
      method,
      amountCenti:  d.amountCenti,
      accountSheet: d.accountSheet || null,
      approvalCode: d.approvalCode || null,
      collectedBy:  d.collectedBy  || null,
    };
    if (method === 'merchant') {
      body.merchantProvider  = d.merchantProvider || null;
      body.installmentMonths = parseInstallmentMonths(d.installmentMonthsLabel);
    } else if (method === 'transfer') {
      body.onlineType = d.onlineType || null;
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

  /* Summary maths — identical across modes. In DRAFT mode there are no
     persisted rows yet, so paid is just Σ drafts. In SAVED mode paid is
     Σ persisted (drafts only enter the total once committed via API). */
  const paidCenti = isSaved
    ? persistedPayments.reduce((sum, p) => sum + (p.amount_centi || 0), 0)
    : drafts.reduce((sum, d) => sum + (d.amountCenti || 0), 0);
  const balanceCenti = Math.max(0, grandTotal - paidCenti);

  const staffNameById = (id: string | null): string | null => {
    if (!id) return null;
    return staff.find((s) => s.id === id)?.name ?? null;
  };

  const totalRowCount = persistedPayments.length + drafts.length;

  return (
    <section className={detailStyles.card}>
      <header className={detailStyles.cardHeader}>
        <h2 className={detailStyles.cardTitle}>
          <DollarSign size={14} strokeWidth={1.75} /> Payments
        </h2>
      </header>
      <div className={detailStyles.cardBody}>
        <div className={paymentsStyles.section}>
          {/* Top bar with + Add Payment trigger ─────────────────────── */}
          <div className={paymentsStyles.head}>
            <span className={paymentsStyles.headLabel}>
              {totalRowCount} transaction{totalRowCount === 1 ? '' : 's'}
            </span>
            {!locked && (
              <button
                type="button"
                className={paymentsStyles.addBtn}
                onClick={addDraft}
                disabled={isSaved && addPayment.isPending}
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

            {/* Empty + loading states */}
            {isSaved && paymentsQ.isLoading && (
              <span className={paymentsStyles.emptyRow} style={{ gridColumn: '1 / -1' }}>
                Loading…
              </span>
            )}
            {(!isSaved || !paymentsQ.isLoading) &&
              persistedPayments.length === 0 &&
              drafts.length === 0 && (
              <span className={paymentsStyles.emptyRow} style={{ gridColumn: '1 / -1' }}>
                No payments recorded yet · click "Add Payment" to log a deposit
              </span>
            )}

            {/* Persisted payment rows (SAVED mode only) */}
            {persistedPayments.map((p) => (
              <div className={paymentsStyles.row} key={p.id}>
                <span className={paymentsStyles.cell} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {p.paid_at}
                </span>
                <span className={paymentsStyles.cell} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: 2 }}>
                  <span className={paymentsStyles.methodPill} style={methodPillStyle(p.method)}>
                    {apiToLabel(p)}
                  </span>
                  {/* Task #122 (cascade) — surface the L2 picks below the
                      pill so a Merchant row reads as "Merchant · MBB · 12
                      months", an Online row as "Online · TNG", etc. */}
                  {p.method === 'merchant' && (p.merchant_provider || p.installment_months) && (
                    <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                      {p.merchant_provider ?? '—'}
                      {p.installment_months ? ` · ${p.installment_months}m` : ''}
                    </span>
                  )}
                  {p.method === 'transfer' && p.online_type && (
                    <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                      {p.online_type}
                    </span>
                  )}
                </span>
                <span className={paymentsStyles.cellRight}
                      style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                  {fmtRm(p.amount_centi, currency)}
                </span>
                <span className={paymentsStyles.cell}>
                  {p.account_sheet ?? <span className={detailStyles.muted}>—</span>}
                </span>
                <span className={paymentsStyles.cell} style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {p.approval_code ?? <span className={detailStyles.muted}>—</span>}
                </span>
                <span className={paymentsStyles.cell}>
                  {p.collected_by_name ?? staffNameById(p.collected_by) ?? <span className={detailStyles.muted}>—</span>}
                </span>
                <span className={paymentsStyles.cell}>
                  {!locked && (
                    <button
                      type="button"
                      className={paymentsStyles.trashBtn}
                      disabled={deletePayment.isPending}
                      onClick={() => {
                        if (confirm(`Delete this ${apiToLabel(p)} payment of ${fmtRm(p.amount_centi, currency)}?`)) {
                          deletePayment.mutate({ docNo: (props as SavedModeProps).docNo, id: p.id });
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

            {/* In-flight draft rows (SAVED + DRAFT) */}
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
                <span className={paymentsStyles.cell} style={{ flexDirection: 'column', alignItems: 'stretch', gap: 4 }}>
                  {/* L1 — Method (always visible) */}
                  <select
                    className={paymentsStyles.inlineSelect}
                    value={d.methodLabel}
                    disabled={locked}
                    onChange={(e) => {
                      /* When Method changes, clear the L2 fields that
                         don't apply to the new pick. Keeps stale data
                         out of the API call + the audit log. */
                      const next = e.target.value;
                      patchDraft(d.uid, {
                        methodLabel: next,
                        merchantProvider:       next === 'Merchant' ? d.merchantProvider       : '',
                        installmentMonthsLabel: next === 'Merchant' ? d.installmentMonthsLabel : '',
                        onlineType:             next === 'Online'   ? d.onlineType             : '',
                      });
                    }}
                  >
                    {methodOpts.map((m) => (
                      <option key={m.id} value={m.value}>{m.label}</option>
                    ))}
                    {/* Persist labels that are no longer active in the
                        list so existing drafts (rehydrated from
                        somewhere) still render their selection. */}
                    {d.methodLabel && !methodOpts.some((m) => m.value === d.methodLabel) && (
                      <option value={d.methodLabel}>{d.methodLabel}</option>
                    )}
                  </select>

                  {/* L2 — Merchant cascade: pick the Bank + Installment plan. */}
                  {d.methodLabel === 'Merchant' && (
                    <>
                      <select
                        className={paymentsStyles.inlineSelect}
                        style={{ fontSize: 'var(--fs-11)' }}
                        value={d.merchantProvider}
                        disabled={locked}
                        onChange={(e) => patchDraft(d.uid, { merchantProvider: e.target.value })}
                        aria-label="Merchant bank"
                      >
                        <option value="">— Bank —</option>
                        {merchantOpts.map((m) => (
                          <option key={m.id} value={m.value}>{m.label}</option>
                        ))}
                        {d.merchantProvider && !merchantOpts.some((m) => m.value === d.merchantProvider) && (
                          <option value={d.merchantProvider}>{d.merchantProvider}</option>
                        )}
                      </select>
                      <select
                        className={paymentsStyles.inlineSelect}
                        style={{ fontSize: 'var(--fs-11)' }}
                        value={d.installmentMonthsLabel}
                        disabled={locked}
                        onChange={(e) => patchDraft(d.uid, { installmentMonthsLabel: e.target.value })}
                        aria-label="Installment plan"
                      >
                        <option value="">— Plan —</option>
                        {installmentOpts.map((m) => (
                          <option key={m.id} value={m.value}>{m.label}</option>
                        ))}
                        {d.installmentMonthsLabel && !installmentOpts.some((m) => m.value === d.installmentMonthsLabel) && (
                          <option value={d.installmentMonthsLabel}>{d.installmentMonthsLabel}</option>
                        )}
                      </select>
                    </>
                  )}

                  {/* L2 — Online cascade: pick the sub-type. */}
                  {d.methodLabel === 'Online' && (
                    <select
                      className={paymentsStyles.inlineSelect}
                      style={{ fontSize: 'var(--fs-11)' }}
                      value={d.onlineType}
                      disabled={locked}
                      onChange={(e) => patchDraft(d.uid, { onlineType: e.target.value })}
                      aria-label="Online sub-type"
                    >
                      <option value="">— Type —</option>
                      {onlineOpts.map((o) => (
                        <option key={o.id} value={o.value}>{o.label}</option>
                      ))}
                      {d.onlineType && !onlineOpts.some((o) => o.value === d.onlineType) && (
                        <option value={d.onlineType}>{d.onlineType}</option>
                      )}
                    </select>
                  )}

                  {/* L2 — Cash: no extra fields */}
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
                    {/* SAVED mode shows the Save (commit) button next to
                        Discard. DRAFT mode has no Save — the parent batches
                        all drafts on SO-create. We still show Discard so the
                        user can drop a half-typed row. */}
                    {isSaved && (
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
                    )}
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
              {fmtRm(paidCenti, currency)}
            </span>
            <span className={paymentsStyles.summaryLabel}>
              Balance <DollarSign size={12} strokeWidth={1.75} />
            </span>
            <span className={balanceCenti > 0 ? paymentsStyles.balanceOutstanding : paymentsStyles.balanceClear}>
              {fmtRm(balanceCenti, currency)}
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

export const PaymentsTable = memo(PaymentsTableInner) as typeof PaymentsTableInner;
