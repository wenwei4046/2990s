// CountryPhoneInput (POS) — country-selectable phone field (request 2026-06-05:
// "包括 POS 系统那边，电话号码默认 +60，可点选更换国家").
//
// A country dial-code dropdown (defaults to Malaysia +60) + a national-number
// input. Emits the canonical E.164 storage form ("+60116155633") via onChange,
// so the API stores the same format as the Backend. Shares the country list +
// split/combine helpers with the Backend via @2990s/shared/phone.

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { COUNTRY_DIAL_CODES, splitE164, combineE164 } from '@2990s/shared/phone';

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** Applied to the national-number <input> so it matches the host form. */
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  required?: boolean;
  placeholder?: string;
  id?: string;
};

export function CountryPhoneInput({
  value,
  onChange,
  className,
  style,
  disabled,
  required,
  placeholder = '11-6155 6133',
  id,
}: Props) {
  const init = splitE164(value);
  const [dial, setDial] = useState(init.dial);
  const [national, setNational] = useState(init.national);
  const lastSynced = useRef(value);

  useEffect(() => {
    if (lastSynced.current !== value) {
      const p = splitE164(value);
      setDial(p.dial);
      setNational(p.national);
      lastSynced.current = value;
    }
  }, [value]);

  const emit = (d: string, n: string) => {
    const next = combineE164(d, n);
    lastSynced.current = next;
    onChange(next);
  };

  const selStyle: CSSProperties = {
    flex: '0 0 auto',
    padding: '8px 6px',
    borderRadius: 8,
    border: '1px solid #d8d3c8',
    background: '#fff',
    font: 'inherit',
    cursor: disabled ? 'default' : 'pointer',
  };

  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'stretch', minWidth: 0 }}>
      <select
        aria-label="Country dial code"
        disabled={disabled}
        value={dial}
        onChange={(e) => { setDial(e.target.value); emit(e.target.value, national); }}
        style={selStyle}
      >
        {COUNTRY_DIAL_CODES.map((c) => (
          <option key={c.iso} value={c.dial}>{c.flag} +{c.dial}</option>
        ))}
      </select>
      <input
        type="tel"
        id={id}
        className={className}
        placeholder={placeholder}
        disabled={disabled}
        required={required}
        inputMode="tel"
        autoComplete="tel"
        value={national}
        onChange={(e) => {
          const n = e.target.value.replace(/\D+/g, '');
          setNational(n);
          emit(dial, n);
        }}
        style={{ flex: 1, minWidth: 0, ...style }}
      />
    </div>
  );
}
