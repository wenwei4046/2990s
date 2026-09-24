import { useId, useState, type ReactNode } from 'react';
import { ChevronDown } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import styles from '../../pages/Handover.module.css';

/** Collapse only the read-only recap; all checkout fields stay mounted. */
export function OrderSummaryDisclosure({ total, children }: { total: number; children: ReactNode }) {
  const mobile = useMediaQuery('(max-width: 640px)');
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className={styles.summaryShell}>
      {mobile && (
        <button type="button" className={styles.summaryToggle} aria-expanded={open} aria-controls={id} onClick={() => setOpen(!open)}>
          <span>Order summary</span>
          <strong>{fmtRM(total)}</strong>
          <ChevronDown size={18} strokeWidth={1.75} aria-hidden style={{ transform: open ? 'rotate(180deg)' : undefined }} />
        </button>
      )}
      <div id={id} hidden={mobile && !open}>{children}</div>
    </div>
  );
}
