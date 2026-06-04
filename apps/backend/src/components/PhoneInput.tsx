// PhoneInput — Task #91 (Commander 2026-05-27: "电话format 要统一").
//
// Wraps an <input type="tel"> with our shared phone helpers so every phone
// field in the Backend behaves the same way:
//   - During focus: user sees + edits raw text (no caret-jumping while typing)
//   - On blur: input is normalized to E.164 ("+601161556133") and the parent
//     state is updated via onChange with the storage form
//   - When not focused: the rendered value is the pretty Malaysian format
//     ("+60 11-6155 6133") produced by formatPhone()
//
// Parent state always holds the storage form, so submission to the API is
// already canonical. The API also runs normalizePhone defensively (see
// apps/api/src/routes/mfg-sales-orders.ts) to catch any client that bypasses
// this component.

import { useEffect, useRef, useState } from 'react';
import { formatPhone, normalizePhone } from '@2990s/shared/phone';

type PhoneInputProps = {
  value: string;
  onChange: (next: string) => void;
  className?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Standard <input> id / aria-* attributes are passed through. */
  id?: string;
  'aria-label'?: string;
};

export const PhoneInput = ({
  value,
  onChange,
  className,
  placeholder = '+60 11-6155 6133',
  disabled,
  required,
  id,
  'aria-label': ariaLabel,
}: PhoneInputProps) => {
  const [focused, setFocused] = useState(false);
  // Local buffer for the in-progress text. We initialise from the formatted
  // value so first-render shows the pretty form when the input is unfocused.
  const [buffer, setBuffer] = useState<string>(() => formatPhone(value));
  const lastSyncedValue = useRef(value);

  // When the parent updates `value` (e.g. a fresh row loads), pull it into
  // the buffer — but only when we're not actively typing, so we don't yank
  // characters out from under the user mid-edit.
  useEffect(() => {
    if (!focused && lastSyncedValue.current !== value) {
      setBuffer(formatPhone(value));
      lastSyncedValue.current = value;
    }
  }, [value, focused]);

  return (
    <input
      type="tel"
      id={id}
      className={className}
      aria-label={ariaLabel}
      placeholder={placeholder}
      disabled={disabled}
      required={required}
      value={focused ? buffer : formatPhone(value)}
      onFocus={(e) => {
        setFocused(true);
        // Show the storage form during edit — it's the source of truth.
        // If empty, leave the buffer empty so the placeholder shows.
        setBuffer(value ?? '');
        // Move caret to end so the user can keep typing.
        const len = (value ?? '').length;
        requestAnimationFrame(() => {
          try { e.target.setSelectionRange(len, len); } catch { /* noop */ }
        });
      }}
      onChange={(e) => {
        if (focused) {
          setBuffer(e.target.value);
          return;
        }
        // Not focused but the value changed → browser AUTOFILL painted a value
        // in. The input is controlled to formatPhone(value), so without this the
        // autofilled number is wiped on the next render and never reaches the
        // parent (leaving Save buttons stuck disabled). Normalize it and push to
        // the parent right away. (Wei Siang 2026-06-03)
        const normalized = normalizePhone(e.target.value) ?? '';
        if (normalized && normalized !== value) {
          lastSyncedValue.current = normalized;
          onChange(normalized);
        }
      }}
      onBlur={() => {
        setFocused(false);
        const normalized = normalizePhone(buffer);
        const next = normalized ?? '';
        lastSyncedValue.current = next;
        if (next !== value) onChange(next);
      }}
    />
  );
};
