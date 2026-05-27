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
export type MerchantProvider = 'GHL' | 'HLB' | 'MBB' | 'PBB';

export const PAYMENT_METHOD_OPTIONS = [
  'CASH', 'MBB', 'VISA', 'MASTER', 'CREDIT CARD', 'EPP',
  'ONLINE', 'TNG', 'DUITNOW', 'OTHER',
] as const;
export type PaymentMethodLabel = typeof PAYMENT_METHOD_OPTIONS[number];

export const labelToApi = (label: PaymentMethodLabel): {
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
      return { method: 'transfer', merchantProvider: null };
    case 'VISA':
    case 'MASTER':
    case 'CREDIT CARD':
    case 'EPP':
    case 'OTHER':
      return { method: 'merchant', merchantProvider: null };
  }
};

const apiToLabel = (p: SoPayment): string => {
  if (p.method === 'cash') return 'CASH';
  if (p.method === 'transfer') return p.merchant_provider ?? 'MBB';
  if (p.merchant_provider) return p.merchant_provider;
  return 'CREDIT CARD';
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

export type PaymentDraft = {
  uid:          string;
  paidAt:       string;                 // YYYY-MM-DD
  methodLabel:  PaymentMethodLabel;
  amountCenti:  number;
  accountSheet: string;
  approvalCode: string;
  collectedBy:  string;                 // staff.id (uuid) | ''
};

export const newPaymentDraft = (defaultStaffId = ''): PaymentDraft => ({
  uid: Math.random().toString(36).slice(2, 10),
  paidAt: new Date().toISOString().slice(0, 10),
  methodLabel: 'CASH',
  amountCenti: 0,
  accountSheet: '',
  approvalCode: '',
  collectedBy: defaultStaffId,
});

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

  const defaultStaffId = auth.staff?.id ?? '';

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
    const { method, merchantProvider } = labelToApi(d.methodLabel);
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
