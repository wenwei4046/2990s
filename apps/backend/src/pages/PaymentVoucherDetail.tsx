// ----------------------------------------------------------------------------
// PaymentVoucherDetail — full-page route at /payment-vouchers/:id.
//
// A View → Edit machine for a standalone Payment Voucher (PV):
//   • View: header (payee, supplier, "Paid From" account, date, currency,
//     notes) + a read-only line table (description · debit account · amount) +
//     total (+ MYR-equiv for a foreign currency) + status pill.
//   • Edit (DRAFT only): the same fields as Create — payee, supplier, credit
//     account, date, exchange rate (foreign only), notes, and editable lines.
//   • Actions: Post (DRAFT → POSTED, writes the GL entry) and Cancel (reverses
//     the GL entry if posted, → CANCELLED). A POSTED / CANCELLED voucher is
//     read-only.
//
// payment_voucher_status enum: DRAFT / POSTED / CANCELLED.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { ArrowLeft, Pencil, Plus, Save, Send, Ban, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtDateOrDash } from '@2990s/shared';
import {
  usePaymentVoucherDetail,
  useUpdatePaymentVoucher,
  usePostPaymentVoucher,
  useCancelPaymentVoucher,
  useAccounts,
  type Account,
} from '../lib/flow-queries';
import { useSuppliers, useSupplierDetail } from '../lib/suppliers-queries';
import { sortByText } from '../lib/sort-options';
import { MoneyInput } from '../components/MoneyInput';
import { DateField } from '../components/DateField';
import { AccountSelect } from '../components/AccountSelect';
import { StatusPill } from '../components/StatusPill';
import { SkeletonDetailPage } from '../components/Skeleton';
import { useConfirm } from '../components/ConfirmDialog';
import { useNotify } from '../components/NotifyDialog';
import styles from './SalesOrderDetail.module.css';

const ICON    = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

type EditLine = {
  rid:              string;
  description:      string;
  debitAccountCode: string;
  amountCenti:      number;
};

const newLine = (): EditLine => ({
  rid:              `l${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  description:      '',
  debitAccountCode: '',
  amountCenti:      0,
});

function InfoCell({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <div style={{ fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--fg-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ color: value ? 'var(--fg)' : 'var(--fg-muted)' }}>{value || '—'}</div>
    </div>
  );
}

export const PaymentVoucherDetail = () => {
  const { id = '' } = useParams();
  const [searchParams] = useSearchParams();
  const askConfirm = useConfirm();
  const notify = useNotify();

  const detailQ = usePaymentVoucherDetail(id || null);
  const pv    = detailQ.data?.paymentVoucher as Record<string, any> | undefined;
  const lines = (detailQ.data?.lines ?? []) as Array<Record<string, any>>;

  const update = useUpdatePaymentVoucher();
  const post   = usePostPaymentVoucher();
  const cancel = useCancelPaymentVoucher();
  const busy   = update.isPending || post.isPending || cancel.isPending;

  const accountsQ = useAccounts();
  const accounts  = useMemo<Account[]>(() => (accountsQ.data?.accounts ?? []).filter((a) => a.is_active), [accountsQ.data]);
  const accountLabel = (code: string | null | undefined): string => {
    if (!code) return '—';
    const a = accounts.find((x) => x.account_code === code);
    return a ? `${a.account_code} · ${a.account_name}` : code;
  };

  const suppliersQ = useSuppliers({ status: 'ACTIVE' });

  const isDraft = pv?.status === 'DRAFT';
  const [isEditing, setIsEditing] = useState(() => searchParams.get('edit') === '1');

  // Edit draft state.
  const [payeeName, setPayeeName]                 = useState('');
  const [supplierId, setSupplierId]               = useState('');
  const [creditAccountCode, setCreditAccountCode] = useState('');
  const [voucherDate, setVoucherDate]             = useState('');
  const [notes, setNotes]                         = useState('');
  const [exchangeRate, setExchangeRate]           = useState('1');
  const [editLines, setEditLines]                 = useState<EditLine[]>([]);

  // A POSTED/CANCELLED voucher can never enter edit mode.
  useEffect(() => { if (!isDraft && isEditing) setIsEditing(false); }, [isDraft, isEditing]);

  // Seed the draft from the loaded voucher whenever we enter edit mode.
  useEffect(() => {
    if (!isEditing || !pv) return;
    setPayeeName(pv.payee_name ?? '');
    setSupplierId(pv.supplier_id ?? '');
    setCreditAccountCode(pv.credit_account_code ?? '');
    setVoucherDate(pv.voucher_date ?? '');
    setNotes(pv.notes ?? '');
    setExchangeRate(String(pv.exchange_rate ?? '1'));
    setEditLines(
      lines.length > 0
        ? lines.map((l) => ({
            rid:              `l${l.id}`,
            description:      l.description ?? '',
            debitAccountCode: l.debit_account_code ?? '',
            amountCenti:      Number(l.amount_centi ?? 0),
          }))
        : [newLine()],
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing, pv?.id]);

  const supplierDetailQ = useSupplierDetail(isEditing ? (supplierId || null) : null);
  const supplierDetail  = supplierDetailQ.data?.supplier ?? null;
  const supplierRow     = useMemo(() => (suppliersQ.data ?? []).find((s) => s.id === supplierId) ?? null, [suppliersQ.data, supplierId]);

  const viewCurrency = (pv?.currency ?? 'MYR').toUpperCase();
  const editCurrency = (supplierDetail?.currency ?? supplierRow?.currency ?? pv?.currency ?? 'MYR').toUpperCase();
  const currency  = isEditing ? editCurrency : viewCurrency;
  const isForeign = currency !== 'MYR';
  useEffect(() => { if (isEditing && !isForeign) setExchangeRate('1'); }, [isEditing, isForeign]);

  const setLine  = (rid: string, patch: Partial<EditLine>) =>
    setEditLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const dropLine = (rid: string) => setEditLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.rid !== rid)));
  const addLine  = () => setEditLines((prev) => [...prev, newLine()]);

  const editTotalCenti = useMemo(() => editLines.reduce((s, l) => s + l.amountCenti, 0), [editLines]);
  const viewTotalCenti = Number(pv?.total_centi ?? 0);
  const totalCenti = isEditing ? editTotalCenti : viewTotalCenti;
  const rate = Number(isEditing ? exchangeRate : (pv?.exchange_rate ?? 1)) || 0;

  if (detailQ.isLoading || !pv) return <SkeletonDetailPage />;

  const onSave = async () => {
    const realLines = editLines.filter((l) => l.debitAccountCode && l.amountCenti > 0);
    if (!payeeName.trim()) { notify({ title: 'Enter a payee', body: 'Who is this voucher paying?', tone: 'error' }); return; }
    if (!creditAccountCode) { notify({ title: 'Pick a “Paid From” account', body: 'Choose the bank / cash / payables account.', tone: 'error' }); return; }
    if (realLines.length === 0) { notify({ title: 'Add at least one line', body: 'Each line needs a debit account and an amount > 0.', tone: 'error' }); return; }
    try {
      await update.mutateAsync({
        id,
        payeeName:         payeeName.trim(),
        supplierId:        supplierId || null,
        creditAccountCode,
        voucherDate,
        notes:             notes || null,
        currency:          editCurrency,
        exchangeRate:      isForeign
          ? ((Number(exchangeRate) > 0 && Number.isFinite(Number(exchangeRate))) ? Number(exchangeRate) : 1)
          : 1,
        lines: realLines.map((l) => ({
          description:      l.description || undefined,
          debitAccountCode: l.debitAccountCode,
          amountCenti:      l.amountCenti,
        })),
      });
      setIsEditing(false);
    } catch (err) {
      notify({ title: 'Save failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const onPost = async () => {
    if (!(await askConfirm({ title: `Post voucher ${pv.pv_number}?`, body: 'This writes the journal entry to the General Ledger and locks the voucher.', confirmLabel: 'Post to GL' }))) return;
    try {
      await post.mutateAsync(id);
    } catch (err) {
      notify({ title: 'Post failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  const onCancel = async () => {
    if (!(await askConfirm({ title: `Cancel voucher ${pv.pv_number}?`, body: 'This sets status to CANCELLED and reverses the GL entry if it was posted.', confirmLabel: 'Cancel voucher', danger: true }))) return;
    try {
      await cancel.mutateAsync(id);
    } catch (err) {
      notify({ title: 'Cancel failed', body: err instanceof Error ? err.message : String(err), tone: 'error' });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/payment-vouchers" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Payment Vouchers</span>
          </Link>
          <h1 className={styles.title}>{pv.pv_number}</h1>
        </div>
        <div className={styles.actions} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
          <StatusPill docType="pv" status={pv.status} />
          {!isEditing ? (
            <>
              {isDraft && (
                <Button variant="ghost" size="md" onClick={() => setIsEditing(true)} disabled={busy}>
                  <Pencil {...ICON} /> Edit
                </Button>
              )}
              {isDraft && (
                <Button variant="primary" size="md" onClick={onPost} disabled={busy}>
                  <Send {...ICON} /> Post to GL
                </Button>
              )}
              {pv.status !== 'CANCELLED' && (
                <Button variant="ghost" size="md" onClick={onCancel} disabled={busy}>
                  <Ban {...ICON} /> Cancel
                </Button>
              )}
            </>
          ) : (
            <>
              <Button variant="ghost" size="md" onClick={() => setIsEditing(false)} disabled={busy}>
                <X {...ICON} /> Back
              </Button>
              <Button variant="primary" size="md" onClick={onSave} disabled={busy}>
                <Save {...ICON} /> {update.isPending ? 'Saving…' : 'Save'}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* ── Header card ───────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}><h2 className={styles.cardTitle}>Header</h2></div>
        <div className={styles.cardBody}>
          {!isEditing ? (
            <div className={styles.formGrid2}>
              <InfoCell label="Payee" value={pv.payee_name} />
              <InfoCell label="Supplier" value={pv.supplier?.name ?? null} />
              <InfoCell label="Paid From" value={accountLabel(pv.credit_account_code)} />
              <InfoCell label="Voucher Date" value={pv.voucher_date ? fmtDateOrDash(pv.voucher_date) : null} />
              <InfoCell label="Currency" value={viewCurrency} />
              {viewCurrency !== 'MYR' && <InfoCell label="Exchange Rate" value={`${pv.exchange_rate} (MYR per 1 ${viewCurrency})`} />}
              <InfoCell label="Notes" value={pv.notes ?? null} />
            </div>
          ) : (
            <div className={styles.formGrid2}>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Payee *</span>
                <input type="text" value={payeeName} onChange={(e) => setPayeeName(e.target.value)} className={styles.fieldInput} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Supplier (optional)</span>
                <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={styles.fieldInput} disabled={suppliersQ.isLoading}>
                  <option value="">— None (free-text payee) —</option>
                  {sortByText(suppliersQ.data ?? []).map((s) => (
                    <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                  ))}
                </select>
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Paid From (Credit) *</span>
                <AccountSelect accounts={accounts} value={creditAccountCode} onChange={setCreditAccountCode} className={styles.fieldInput} />
              </label>
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Voucher Date *</span>
                <DateField fullWidth value={voucherDate ?? ''} onChange={(iso) => setVoucherDate(iso)} className={styles.fieldInput} />
              </label>
              {isForeign && (
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Exchange rate (MYR per 1 {editCurrency})</span>
                  <input type="number" min={0} step="0.000001" inputMode="decimal"
                    value={exchangeRate} onChange={(e) => setExchangeRate(e.target.value)}
                    className={styles.fieldInput} style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }} />
                </label>
              )}
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Notes</span>
                <textarea value={notes} onChange={(e) => setNotes(e.target.value)} className={styles.fieldInput} rows={2} style={{ resize: 'vertical', minHeight: 60 }} />
              </label>
            </div>
          )}
        </div>
      </section>

      {/* ── Lines ─────────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Lines ({isEditing ? editLines.length : lines.length})</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>total {fmtRm(totalCenti, currency)}</span>
        </div>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {!isEditing ? (
            lines.length === 0 ? (
              <p style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)' }}>No lines.</p>
            ) : (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 'var(--fs-13)' }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--fg-muted)', fontSize: 'var(--fs-11)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <th style={{ padding: '6px 8px' }}>#</th>
                    <th style={{ padding: '6px 8px' }}>Description</th>
                    <th style={{ padding: '6px 8px' }}>Account (Debit)</th>
                    <th style={{ padding: '6px 8px', textAlign: 'right' }}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, idx) => (
                    <tr key={l.id} style={{ borderTop: '1px solid var(--line)' }}>
                      <td style={{ padding: '6px 8px', color: 'var(--fg-muted)' }}>{idx + 1}</td>
                      <td style={{ padding: '6px 8px' }}>{l.description || '—'}</td>
                      <td style={{ padding: '6px 8px' }}>{accountLabel(l.debit_account_code)}</td>
                      <td style={{ padding: '6px 8px', textAlign: 'right', fontFamily: 'var(--font-mono)' }}>{fmtRm(Number(l.amount_centi ?? 0), currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )
          ) : (
            <>
              {editLines.map((l, idx) => (
                <div key={l.rid} style={{
                  background: 'var(--c-paper)', border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
                  display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: 'var(--font-button)', fontSize: 'var(--fs-12)', fontWeight: 700, letterSpacing: '0.10em', color: 'var(--fg-muted)' }}>LINE {idx + 1}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                      <span className={styles.previewPrice}>{fmtRm(l.amountCenti, currency)}</span>
                      {editLines.length > 1 && (
                        <button type="button" onClick={() => dropLine(l.rid)} title="Remove line"
                          style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--c-festive-b, #B8331F)', padding: 4, display: 'inline-flex' }}>
                          <Trash2 {...SM_ICON} />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className={styles.formGrid2}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Description</span>
                      <input type="text" value={l.description} onChange={(e) => setLine(l.rid, { description: e.target.value })} className={styles.fieldInput} />
                    </label>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Account (Debit) *</span>
                      <AccountSelect accounts={accounts} value={l.debitAccountCode} onChange={(v) => setLine(l.rid, { debitAccountCode: v })} className={styles.fieldInput} />
                    </label>
                  </div>
                  <div className={styles.formGrid4} style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                    <label className={styles.field}>
                      <span className={styles.fieldLabel}>Amount ({currency})</span>
                      <MoneyInput bare valueSen={l.amountCenti}
                        onCommit={(sen) => setLine(l.rid, { amountCenti: sen ?? 0 })}
                        inputClassName={styles.fieldInput} selectOnFocus />
                    </label>
                  </div>
                </div>
              ))}
              <button type="button" onClick={addLine}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, width: '100%', padding: '12px 14px', border: '1px dashed var(--c-orange)', borderRadius: 'var(--radius-md)', background: 'transparent', color: 'var(--c-orange)', fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)', fontWeight: 600, cursor: 'pointer' }}>
                <Plus {...SM_ICON} /> Add another line
              </button>
            </>
          )}
        </div>
      </section>

      {/* ── Totals ────────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <section className={styles.card} style={{ maxWidth: 360, width: '100%' }}>
          <div className={styles.cardBody}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-16)', fontWeight: 700 }}>
              <span>Total</span>
              <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtRm(totalCenti, currency)}</span>
            </div>
            {isForeign && (
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginTop: 'var(--space-2)' }}>
                <span>≈ posted to GL</span>
                <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtRm(Math.round(totalCenti * rate), 'MYR')}</span>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};
