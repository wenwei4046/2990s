import { useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import styles from '../SaShared.module.css';

interface DisclosureProps {
  label: string;
  /** Button text while open; defaults to `label`. */
  openLabel?: string;
  children: ReactNode;
}

/** Plain text-button disclosure. Instant expand — no height animation (calm). */
export const Disclosure = ({ label, openLabel, children }: DisclosureProps) => {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={styles.discBtn}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? (openLabel ?? label) : label}
        {open
          ? <ChevronUp size={16} strokeWidth={1.75} />
          : <ChevronDown size={16} strokeWidth={1.75} />}
      </button>
      {open && children}
    </>
  );
};
