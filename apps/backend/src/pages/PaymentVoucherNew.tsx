// ----------------------------------------------------------------------------
// PaymentVoucherNew — full-page Create Payment Voucher at /payment-vouchers/new.
//
// A "very plain" cash-out voucher to pay a vendor that is NOT a goods invoice
// (freight forwarder, one-off service):
//   • Payee (free text) + optional supplier link (auto-fills payee + currency)
//   • Credit account — the bank / cash / AP the money is paid FROM
//   • Lines — description + debit account (the expense/charge) + amount
//   • Total + (for a foreign currency) the MYR-equivalent posted to the GL
//
// Saves as DRAFT (POST /payment-vouchers); the user posts to the GL from the
// detail page. STANDALONE — no PO / landed-cost allocation here.
// ----------------------------------------------------------------------------

import { todayMyt } from '../lib/dates';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useCreatePaymentVoucher, useAccounts, type Account } from '../lib/flow-queries';
import { useSuppliers, useSupplierDetail } from '../lib/suppliers-queries';
import { useActiveCurrencies, rateFor } from '../lib/currencies-queries';
import { sortByText } from '../lib/sort-options';
import { MoneyInput } from '../components/MoneyInput';
import { ActionResultDialog } from '../components/ActionResultDialog';
import { DateField } from '../components/DateField';
import { AccountSelect } from '../components/AccountSelect';
import styles from './SalesOrderDetail.module.css';

const ICON    = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const v = centi ?? 0;
  return `${currency} ${(v / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

type DraftLine = {
  rid:              string;
  description:      string;
  debitAccountCode: string;
  amountCenti:      number;
};

const newLine = (): DraftLine => ({
  rid:              `l${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  description:      '',
  debitAccountCode: '',
  amountCenti:      0,
});

export const PaymentVoucherNew = () => {
  const navigate = useNavigate();
  const create   = useCreatePaymentVoucher();
  const saving   = create.isPending;

  const accountsQ = useAccounts();
  const accounts  = useMemo<Account[]>(() => (accountsQ.data?.accounts ?? []).filter((a) => a.is_active), [accountsQ.data]);

  const suppliersQ = useSuppliers({ status: 'ACTIVE' });

  const [payeeName, setPayeeName]         = useState<string>('');
  const [supplierId, setSupplierId]       = useState<string>('');
  const [creditAccountCode, setCreditAccountCode] = useState<string>('');
  const [voucherDate, setVoucherDate]     = useState<string>(() => todayMyt());
  const [notes, setNotes]                 = useState<string>('');
  const [exchangeRate, setExchangeRate]   = useState<string>('1');
  /* Migration 0193 — track a manual rate edit so the master-rate auto-fill
     stops overwriting it. */
  const [rateTouched, setRateTouched]     = useState<boolean>(false);
  const [lines, setLines]                 = useState<DraftLine[]>([newLine()]);
  const [dialog, setDialog] = useState<{ title: string; body: string; goTo?: string } | null>(null);

  // Supplier link is optional. When set, auto-fill the payee (if blank) + adopt
  // the supplier's default currency (e.g. a China vendor billing RMB).
  const supplierDetailQ = useSupplierDetail(supplierId || null);
  const supplierDetail  = supplierDetailQ.data?.supplier ?? null;
  const supplierRow     = useMemo(() => (suppliersQ.data ?? []).find((s) => s.id === supplierId) ?? null, [suppliersQ.data, supplierId]);

  useEffect(() => {
    if (!supplierRow) return;
    setPayeeName((prev) => prev.trim() ? prev : supplierRow.name);
  }, [supplierRow]);

  const currency  = (supplierDetail?.currency ?? supplierRow?.currency ?? 'MYR').toUpperCase();
  const isForeign = currency !== 'MYR';
  /* Migration 0193 — auto-fill the rate from the currencies MASTER when the PV
     settles on a foreign currency (still editable). MYR resets to 1; a manual
     edit wins. */
  const currenciesQ = useActiveCurrencies();
  useEffect(() => {
    if (!isForeign) { setExchangeRate('1'); setRateTouched(false); return; }
    if (rateTouched) return;
    setExchangeRate(String(rateFor(currenciesQ.data, currency)));
  }, [isForeign, currency, currenciesQ.data, rateTouched]);

  const setLine  = (rid: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const dropLine = (rid: string) => setLines((prev) => (prev.length <= 1 ? prev : prev.filter((l) => l.rid !== rid)));
  const addLine  = () => setLines((prev) => [...prev, newLine()]);

  const totalCenti = useMemo(() => lines.reduce((s, l) => s + l.amountCenti, 0), [lines]);

  const realLines = lines.filter((l) => l.debitAccountCode && l.amountCenti > 0);
  const canSave = !!payeeName.trim() && !!creditAccountCode && realLines.length > 0;

  const onSave = async () => {
    if (!payeeName.trim()) { setDialog({ title: 'Enter a payee', body: 'Who is this voucher paying?' }); return; }
    if (!creditAccountCode) { setDialog({ title: 'Pick a “Paid From” account', body: 'Choose the bank / cash / payables account the money leaves.' }); return; }
    if (realLines.length === 0) { setDialog({ title: 'Add at least one line', body: 'Each line needs a debit account and an amount > 0.' }); return; }
    try {
      const res = await create.mutateAsync({
        payeeName:         payeeName.trim(),
        supplierId:        supplierId || null,
        creditAccountCode,
        voucherDate,
        notes:             notes || undefined,
        currency,
        exchangeRate:      isForeign
          ? ((Number(exchangeRate) > 0 && Number.isFinite(Number(exchangeRate))) ? Number(exchangeRate) : 1)
          : 1,
        lines: realLines.map((l) => ({
          description:      l.description || undefined,
          debitAccountCode: l.debitAccountCode,
          amountCenti:      l.amountCenti,
        })),
      });
      setDialog({
        title: `Voucher ${res.pvNumber} created`,
        body: 'Saved as a draft — open it to post to the GL.',
        goTo: `/payment-vouchers/${res.id}`,
      });
    } catch (err) {
      setDialog({ title: 'Save failed', body: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/payment-vouchers" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Payment Vouchers</span>
          </Link>
          <h1 className={styles.title}>New Payment Voucher</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/payment-vouchers')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button variant="primary" size="md" onClick={onSave} disabled={saving || !canSave}>
            <Save {...ICON} />
            {saving ? 'Saving…' : 'Create Voucher'}
          </Button>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}><h2 className={styles.cardTitle}>Header</h2></div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Payee *</span>
              <input type="text" value={payeeName} onChange={(e) => setPayeeName(e.target.value)}
                placeholder="Who are we paying? (e.g. ABC Freight Forwarding)" className={styles.fieldInput} required />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>PV #</span>
              <input type="text" readOnly value="(assigned on Save)" className={styles.fieldInput}
                style={{ background: 'var(--c-cream)', color: 'var(--fg-muted)' }} />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Supplier (optional)</span>
              <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={styles.fieldInput} disabled={suppliersQ.isLoading}>
                <option value="">{suppliersQ.isLoading ? 'Loading suppliers…' : '— None (free-text payee) —'}</option>
                {sortByText(suppliersQ.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>{s.code} · {s.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Voucher Date *</span>
              <DateField fullWidth value={voucherDate ?? ''} onChange={(iso) => setVoucherDate(iso)} className={styles.fieldInput} />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Paid From (Credit) *</span>
              <AccountSelect
                accounts={accounts}
                value={creditAccountCode}
                onChange={setCreditAccountCode}
                className={styles.fieldInput}
                placeholder={accountsQ.isLoading ? 'Loading accounts…' : '— Bank / cash / payables —'}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Notes</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Internal notes" className={styles.fieldInput} rows={2} style={{ resize: 'vertical', minHeight: 60 }} />
            </label>

            {isForeign && (
              <label className={styles.field}>
                <span className={styles.fieldLabel}>Exchange rate (MYR per 1 {currency})</span>
                <input type="number" min={0} step="0.000001" inputMode="decimal"
                  value={exchangeRate} onChange={(e) => { setRateTouched(true); setExchangeRate(e.target.value); }}
                  placeholder="e.g. 0.62"
                  className={styles.fieldInput} style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }} />
                <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)', marginTop: 2 }}>
                  ≈ {fmtRm(Math.round(totalCenti * (Number(exchangeRate) || 0)), 'MYR')} posted to GL
                </span>
              </label>
            )}
          </div>
        </div>
      </section>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Lines</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {lines.length} line{lines.length === 1 ? '' : 's'} · total {fmtRm(totalCenti, currency)}
          </span>
        </div>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {lines.map((l, idx) => (
            <div key={l.rid} style={{
              background: 'var(--c-paper)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)',
              display: 'flex', flexDirection: 'column', gap: 'var(--space-3)',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <span style={{ fontFamily: 'var(--font-button)', fontSize: 'var(--fs-12)', fontWeight: 700, letterSpacing: '0.10em', color: 'var(--fg-muted)' }}>LINE {idx + 1}</span>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                  <span className={styles.previewPrice}>{fmtRm(l.amountCenti, currency)}</span>
                  {lines.length > 1 && (
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
                  <input type="text" value={l.description} onChange={(e) => setLine(l.rid, { description: e.target.value })}
                    placeholder="e.g. Sea freight — Shenzhen → Klang" className={styles.fieldInput} />
                </label>
                <label className={styles.field}>
                  <span className={styles.fieldLabel}>Account (Debit) *</span>
                  <AccountSelect
                    accounts={accounts}
                    value={l.debitAccountCode}
                    onChange={(v) => setLine(l.rid, { debitAccountCode: v })}
                    className={styles.fieldInput}
                    placeholder={accountsQ.isLoading ? 'Loading accounts…' : '— Expense / charge account —'}
                  />
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
            + Add another line
          </button>
        </div>
      </section>

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
                <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtRm(Math.round(totalCenti * (Number(exchangeRate) || 0)), 'MYR')}</span>
              </div>
            )}
          </div>
        </section>
      </div>

      {dialog && (
        <ActionResultDialog
          title={dialog.title}
          body={dialog.body}
          primaryLabel={dialog.goTo ? 'Open Voucher' : undefined}
          onPrimary={dialog.goTo ? () => { const g = dialog.goTo!; setDialog(null); navigate(g); } : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
};
