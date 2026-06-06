// ----------------------------------------------------------------------------
// CustomerCard — extracted from SalesOrderDetail.tsx (task #61).
//
// Owns: Customer Name + Customer SO Ref + Phone + Email + Customer Type +
//       Salesperson + debtor-search autocomplete.
//
// Perf contract:
//   - Local useState for every field → typing here does NOT propagate to the
//     parent until Save is pressed.
//   - Parent commits via CardHandle.getPatch() through ref + useImperativeHandle.
//   - React.memo on the export. Props are stable (header object is one ref
//     per page render; isEditing/locked are primitives; ref is stable).
// ----------------------------------------------------------------------------

import {
  forwardRef, memo, useEffect, useImperativeHandle, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import { formatPhone } from '@2990s/shared/phone';
import { PhoneInput } from '../../components/PhoneInput';
import { useDebtorSearch, type DebtorSuggestion } from '../../lib/flow-queries';
import {
  useSoDropdownOptions, optionsOrFallback,
} from '../../lib/so-dropdown-options-queries';
import { useStaff } from '../../lib/admin-queries';
import { useDebouncedValue } from '../../lib/hooks';
import type { CardHandle, SoHeader } from './types';
import styles from '../SalesOrderDetail.module.css';

type Props = {
  header: SoHeader;
  isEditing: boolean;
  locked: boolean;
};

const initialFormFor = (h: SoHeader) => ({
  customerCode: h.debtor_code ?? '',
  customerName: h.debtor_name ?? '',
  customerSoNo: h.customer_so_no ?? '',
  phone: h.phone ?? '',
  email: h.email ?? '',
  customerType: h.customer_type ?? '',
  salespersonId: h.salesperson_id ?? '',
});

const CustomerCardInner = forwardRef<CardHandle, Props>(({ header, isEditing, locked }, ref) => {
  const [form, setForm] = useState(() => initialFormFor(header));
  const formRef = useRef(form);
  formRef.current = form;
  const headerRef = useRef(header);
  headerRef.current = header;

  // Reset local form when the header changes upstream (after a successful save).
  useEffect(() => { setForm(initialFormFor(header)); }, [header]);

  const [showSuggest, setShowSuggest] = useState(false);

  /* Task #99 (UI perf) — 200 ms debounce on the debtor autocomplete. */
  const debouncedDebtorQ = useDebouncedValue(form.customerName, 200);
  const debtorQuery = useDebtorSearch(debouncedDebtorQ);
  const suggestions = (debtorQuery.data?.debtors ?? []).filter(
    (d) => (d.debtor_name ?? '').toLowerCase() !== form.customerName.trim().toLowerCase(),
  );

  /* Task #118 — DB-backed dropdowns. */
  const customerTypeOptsQ = useSoDropdownOptions('customer_type');
  const customerTypeOpts = optionsOrFallback('customer_type', customerTypeOptsQ.data);

  const staffQ = useStaff();
  const staffList = (staffQ.data ?? []).filter((s) => s.active);

  const set = <K extends keyof typeof form>(k: K, v: string) =>
    setForm((s) => ({ ...s, [k]: v }));

  const applySuggestion = (d: DebtorSuggestion) => {
    setForm((s) => ({
      ...s,
      customerCode: d.debtor_code ?? s.customerCode,
      customerName: d.debtor_name ?? s.customerName,
      phone:        d.phone        ?? s.phone,
    }));
    setShowSuggest(false);
  };

  useImperativeHandle(ref, () => ({
    getPatch: () => {
      const f = formRef.current;
      return {
        debtorCode:    f.customerCode,
        debtorName:    f.customerName,
        customerSoNo:  f.customerSoNo || null,
        email:         f.email,
        customerType:  f.customerType,
        salespersonId: f.salespersonId || null,
        phone:         f.phone,
      };
    },
    reset: () => setForm(initialFormFor(headerRef.current)),
  }), []);

  const inputsDisabled = !isEditing || locked;

  return (
    <section className={styles.card}>
      <header className={styles.cardHeader}>
        <h2 className={styles.cardTitle}>Customer</h2>
      </header>
      <div className={styles.cardBody}>
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
            <input
              className={styles.fieldInput}
              value={form.customerSoNo}
              placeholder="Their PO / SO number"
              disabled={inputsDisabled}
              onChange={(e) => set('customerSoNo', e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Phone *</span>
            <PhoneInput
              className={styles.fieldInput}
              value={form.phone}
              disabled={inputsDisabled}
              onChange={(v) => set('phone', v)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Email *</span>
            <input
              type="email"
              className={styles.fieldInput}
              value={form.email}
              disabled={inputsDisabled}
              onChange={(e) => set('email', e.target.value)}
            />
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Customer Type</span>
            <select
              className={styles.fieldSelect}
              value={form.customerType}
              disabled={inputsDisabled}
              onChange={(e) => set('customerType', e.target.value)}
            >
              <option value="">—</option>
              {customerTypeOpts.map((t) => (
                <option key={t.id} value={t.value}>{t.label}</option>
              ))}
              {form.customerType && !customerTypeOpts.some((t) => t.value === form.customerType) && (
                <option value={form.customerType}>{form.customerType}</option>
              )}
            </select>
          </label>
          <label className={styles.field}>
            <span className={styles.fieldLabel}>Salesperson</span>
            <select
              className={styles.fieldSelect}
              value={form.salespersonId}
              disabled={inputsDisabled}
              onChange={(e) => set('salespersonId', e.target.value)}
            >
              <option value="">— Pick staff —</option>
              {staffList.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.staffCode})</option>
              ))}
            </select>
          </label>
        </div>
      </div>
    </section>
  );
});
CustomerCardInner.displayName = 'CustomerCardInner';

export const CustomerCard = memo(CustomerCardInner) as typeof CustomerCardInner;
