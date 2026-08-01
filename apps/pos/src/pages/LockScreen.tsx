import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import { ChevronDown, Delete, Search } from 'lucide-react';
import { useShowroomSalesStaff, type SalesStaffRow } from '../lib/queries';
import { useAuth } from '../lib/auth';
import styles from './LockScreen.module.css';

const PIN_LENGTH = 6;

/* ── Staff picker ───────────────────────────────────────────────────────────
   The login used to lay every account out as a flat grid of cards. Staff turn
   over — people leave, people join — so that grid both grew unbounded and
   published the full roster to anyone standing at the showroom counter. Loo
   2026-08-01: a dropdown instead, searchable (approved deviation from
   UI_REFERENCE §3 "Login — staff list → tap → PIN pad"; the PIN pad below is
   untouched and still auto-submits on the 6th digit).

   Select-only combobox with a filter field, NOT a text input that doubles as
   the value: the value is an account, not free text, and a stray keystroke must
   never leave the field in a state that looks chosen but isn't. */
type StaffPickerProps = {
  staff: SalesStaffRow[];
  selected: SalesStaffRow | null;
  onSelect: (s: SalesStaffRow) => void;
  disabled?: boolean;
};

const StaffPicker = ({ staff, selected, onSelect, disabled }: StaffPickerProps) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  /* The keyboard highlight is drawn ONLY after an arrow key. Painting row 0 the
     moment the panel opens reads as "Bernard is already chosen" on a tablet,
     where there is no cursor to explain it. Pointer hover is CSS-only. */
  const [kbdNav, setKbdNav] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listId = useId();

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return staff;
    // Name OR staff code — the code is how the office refers to people, and
    // it is the only thing that disambiguates two staff sharing a first name.
    return staff.filter(
      (s) => s.name.toLowerCase().includes(q) || s.staffCode.toLowerCase().includes(q),
    );
  }, [staff, query]);

  // Keep the highlight inside the (shrinking) result set as the filter narrows.
  useEffect(() => { setActiveIdx(0); }, [query]);

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    setQuery('');
    setKbdNav(false);
    if (refocus) triggerRef.current?.focus();
  }, []);

  // Dismiss on an outside press. pointerdown, not click: a tap that starts
  // outside and ends inside a re-rendered list would otherwise select a row the
  // operator never aimed at.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, close]);

  useEffect(() => {
    if (!open) return;
    /* Focus the filter on a mouse/keyboard device only. On the tablet — the
       primary POS device — focusing a text field raises the software keyboard
       over the very list the operator is trying to tap. They can still tap the
       filter deliberately. */
    if (!window.matchMedia?.('(pointer: coarse)').matches) inputRef.current?.focus();
  }, [open]);

  const choose = (s: SalesStaffRow) => { onSelect(s); close(true); };

  const onListKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (matches.length === 0) return;
      const step = e.key === 'ArrowDown' ? 1 : -1;
      setKbdNav(true);
      setActiveIdx((i) => (kbdNav ? (i + step + matches.length) % matches.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      // Enter before any arrow key must not silently pick whoever is first.
      const s = kbdNav ? matches[activeIdx] : null;
      if (s) choose(s);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Tab') {
      close(false);
    }
  };

  return (
    <div className={styles.picker} ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        className={`${styles.pickerTrigger} ${open ? styles.pickerTriggerOpen : ''}`}
        onClick={() => (open ? close(false) : setOpen(true))}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) { e.preventDefault(); setOpen(true); }
        }}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
      >
        {selected ? (
          <>
            <span className={styles.staffAvatar} style={{ background: selected.color }}>
              {selected.initials}
            </span>
            <span className={styles.staffMeta}>
              <span className={styles.staffName}>{selected.name}</span>
              <span className={styles.staffCode}>{selected.staffCode}</span>
            </span>
          </>
        ) : (
          <>
            <span className={styles.pickerAvatarBlank} aria-hidden="true" />
            <span className={styles.pickerPlaceholder}>Select your name</span>
          </>
        )}
        <ChevronDown
          size={20}
          strokeWidth={1.75}
          className={`${styles.pickerChevron} ${open ? styles.pickerChevronOpen : ''}`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div className={styles.pickerPanel}>
          <div className={styles.pickerSearch}>
            <Search size={16} strokeWidth={1.75} aria-hidden="true" />
            <input
              ref={inputRef}
              type="text"
              className={styles.pickerSearchInput}
              placeholder="Type a name…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onListKeyDown}
              aria-label="Filter staff by name or code"
              aria-controls={listId}
              aria-activedescendant={kbdNav && matches[activeIdx] ? `${listId}-${matches[activeIdx].id}` : undefined}
              autoComplete="off"
              // A name field on a shared counter tablet: no autocorrect, no
              // capitalisation, and never offered to the browser's autofill.
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
            />
          </div>
          <ul className={styles.pickerList} id={listId} role="listbox" onKeyDown={onListKeyDown}>
            {matches.length === 0 && (
              <li className={styles.pickerNoMatch}>No one matches “{query.trim()}”.</li>
            )}
            {matches.map((s, i) => (
              <li key={s.id} role="none">
                <button
                  type="button"
                  id={`${listId}-${s.id}`}
                  role="option"
                  aria-selected={selected?.id === s.id}
                  className={`${styles.pickerOption} ${kbdNav && i === activeIdx ? styles.pickerOptionActive : ''}`}
                  onClick={() => choose(s)}
                >
                  <span className={styles.staffAvatar} style={{ background: s.color }}>
                    {s.initials}
                  </span>
                  <span className={styles.staffMeta}>
                    <span className={styles.staffName}>{s.name}</span>
                    <span className={styles.staffCode}>{s.staffCode}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};

export const LockScreen = () => {
  const staff = useShowroomSalesStaff();
  const { pinLogin } = useAuth();
  const [selected, setSelected] = useState<SalesStaffRow | null>(null);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [showErr, setShowErr] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  useEffect(() => {
    if (pin.length !== PIN_LENGTH || !selected || busy) return;
    const submit = async () => {
      setBusy(true);
      const result = await pinLogin(selected.id, pin);
      setBusy(false);
      if (!result.error) {
        setErrorMessage(null);
        setPin('');
        return;
      }
      // Clear PIN immediately so the useEffect's `pin.length === PIN_LENGTH`
      // guard doesn't re-fire submit when busy flips back to false. The dots
      // stay visibly red via showErr, which doesn't read pin.length.
      setPin('');
      setShowErr(true);
      if (result.error === 'too_many_attempts') {
        const after = result.retryAfter ?? 60;
        setRetryAfter(after);
        setErrorMessage(`Too many attempts — try again in ${after}s`);
      } else if (result.error === 'invalid_pin') {
        const remaining = result.remainingAttempts ?? 0;
        setErrorMessage(
          remaining > 0 ? `Invalid PIN — ${remaining} left` : 'Invalid PIN',
        );
      } else {
        setErrorMessage(result.error);
      }
      window.setTimeout(() => setShowErr(false), 700);
    };
    void submit();
  }, [pin, selected, busy, pinLogin]);

  useEffect(() => {
    if (retryAfter === null) return;
    if (retryAfter <= 0) {
      setRetryAfter(null);
      setErrorMessage(null);
      return;
    }
    const t = window.setTimeout(
      () => setRetryAfter((s) => (s == null ? null : s - 1)),
      1000,
    );
    return () => window.clearTimeout(t);
  }, [retryAfter]);

  const locked = retryAfter !== null && retryAfter > 0;
  const padDisabled = !selected || busy || locked;

  const press = useCallback(
    (key: string | 'del' | 'clr') => {
      if (padDisabled) return;
      if (key === 'del') {
        setPin((p) => p.slice(0, -1));
        return;
      }
      if (key === 'clr') {
        setPin('');
        return;
      }
      if (errorMessage && !locked) setErrorMessage(null);
      setShowErr(false);
      setPin((p) => (p.length >= PIN_LENGTH ? p : p + key));
    },
    [padDisabled, errorMessage, locked],
  );

  const handleSelect = (s: SalesStaffRow) => {
    setSelected(s);
    setPin('');
    setShowErr(false);
    setErrorMessage(null);
  };

  // `data` may be the localStorage placeholder rather than a fresh read — see
  // the staff-slot comment below for why that distinction is load-bearing.
  const rows = staff.data ?? [];

  const hint =
    errorMessage ??
    (selected ? `${PIN_LENGTH}-digit PIN` : 'Select your name first');

  return (
    <main className={styles.shell}>
      <aside className={styles.photo}>
        <div className={styles.mark}>
          2990<span className={styles.ring}>S</span>
        </div>
        <p className={styles.quote}>
          A beautiful space doesn&apos;t begin with luxury. It begins with
          clarity, honesty, and the feeling of truly being at home.
        </p>
      </aside>

      <section className={styles.panel}>
        <div className={`t-eyebrow ${styles.eyebrow}`}>Showroom KL · Sales Floor</div>
        <h1 className={styles.title}>Welcome back.</h1>
        <p className={styles.sub}>
          Pick your name and enter your PIN to start a session.
        </p>

        {/* A load failure does NOT replace the picker when we still have rows.
            useShowroomSalesStaff seeds placeholderData from the
            `pos:sales-staff-cache` localStorage copy exactly so the showroom can
            still sign in through a network blip — swallowing that behind an
            error box would lock the floor out over a flaky minute of wifi. The
            banner sits ABOVE the picker instead, so the staleness is visible
            and the list is still usable. */}
        <div className={styles.staffSlot}>
          {staff.error && (
            <div className={`${styles.empty} ${rows.length > 0 ? styles.emptyBanner : ''}`}>
              {rows.length > 0 ? 'Showing the last synced list.' : 'Failed to load staff.'}{' '}
              <button type="button" onClick={() => void staff.refetch()}>
                Retry
              </button>
            </div>
          )}
          {rows.length === 0 && !staff.error && staff.data && (
            <div className={styles.empty}>
              No POS users yet — add a sales user in Backend → Users.
            </div>
          )}
          {(rows.length > 0 || (!staff.error && !staff.data)) && (
            <StaffPicker
              staff={rows}
              selected={selected}
              onSelect={handleSelect}
              disabled={rows.length === 0}
            />
          )}
        </div>

        <div className={styles.pinRow}>
          <div className={styles.pinDots} aria-live="polite">
            {Array.from({ length: PIN_LENGTH }).map((_, i) => (
              <span
                key={i}
                className={`${styles.pinDot} ${
                  showErr
                    ? styles.pinDotErr
                    : pin.length > i
                      ? styles.pinDotOn
                      : ''
                }`}
                aria-hidden="true"
              />
            ))}
          </div>
          <span className={styles.pinHint}>{hint}</span>
        </div>

        <div className={styles.pad}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((k) => (
            <button
              key={k}
              type="button"
              className={styles.padKey}
              onClick={() => press(k)}
              disabled={padDisabled}
            >
              {k}
            </button>
          ))}
          <button
            type="button"
            className={`${styles.padKey} ${styles.padKeyUtil}`}
            onClick={() => press('clr')}
            disabled={padDisabled}
          >
            Clear
          </button>
          <button
            type="button"
            className={styles.padKey}
            onClick={() => press('0')}
            disabled={padDisabled}
          >
            0
          </button>
          <button
            type="button"
            className={`${styles.padKey} ${styles.padKeyUtil}`}
            onClick={() => press('del')}
            disabled={padDisabled}
            aria-label="Delete last digit"
          >
            <Delete size={18} strokeWidth={1.75} />
          </button>
        </div>

        <div className={styles.footer}>
          <span className={styles.footerDot} aria-hidden="true" />
          <span>Showroom KL · synced</span>
          <Link to="/login" className={styles.footerLink}>
            Email sign-in
          </Link>
        </div>
      </section>
    </main>
  );
};
