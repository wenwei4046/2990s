// ----------------------------------------------------------------------------
// CustomerNameSearch — name input with a returning-customer dropdown
// (Loo 2026-06-06: "when key in customer name, search the customer list,
// give option for same name"). Shared by the Handover Customer step and the
// Create-SO customer form.
//
// Same-name customers are listed one row per (name, phone) identity —
// migration 0144's key — with the phone + last order shown so sales can tell
// them apart. Picking a row calls onPick(hit); the consumer maps the
// snapshot into its own form fields (everything stays editable after).
// ----------------------------------------------------------------------------

import { useState, type CSSProperties } from 'react';
import { UserRound } from 'lucide-react';
import { useCustomerNameSearch, type CustomerSearchHit } from '../lib/customer-search';
import styles from './CustomerNameSearch.module.css';

export const CustomerNameSearch = ({
  value, onChange, onPick, required = false, autoFocus = false, placeholder, inputStyle,
}: {
  value: string;
  onChange: (next: string) => void;
  onPick: (hit: CustomerSearchHit) => void;
  required?: boolean;
  autoFocus?: boolean;
  placeholder?: string;
  /** NewOrder styles its inputs inline rather than via page CSS — pass-through. */
  inputStyle?: CSSProperties;
}) => {
  const [open, setOpen] = useState(false);
  // Once the salesperson picks (or keeps typing past a pick) the list only
  // re-opens on further typing/focus — it must never sit over the next field.
  const search = useCustomerNameSearch(value, open);
  const hits = search.data ?? [];

  return (
    <div className={styles.wrap}>
      <input
        type="text"
        required={required}
        value={value}
        autoComplete="off"
        autoFocus={autoFocus}
        placeholder={placeholder}
        style={inputStyle}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        /* Delay so a tap on a dropdown row lands before the list unmounts —
           same trick as the Backend debtor autocomplete. */
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && value.trim().length >= 2 && hits.length > 0 && (
        <ul className={styles.list} role="listbox" aria-label="Returning customers">
          {hits.map((h) => (
            <li key={`${h.debtorName}|${h.phone ?? ''}`}>
              <button
                type="button"
                className={styles.item}
                /* onMouseDown fires before the input's blur — a click always
                   lands. (touchstart on tablets maps to mousedown too.) */
                onMouseDown={(e) => { e.preventDefault(); onPick(h); setOpen(false); }}
              >
                <UserRound size={16} strokeWidth={1.75} className={styles.icon} aria-hidden />
                <span className={styles.name}>{h.debtorName}</span>
                <span className={styles.meta}>
                  {h.phone ?? 'no phone'} · last order {h.lastDocNo}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
