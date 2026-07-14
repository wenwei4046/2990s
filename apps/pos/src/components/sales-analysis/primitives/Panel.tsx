import type { ReactNode } from 'react';
import styles from '../SaShared.module.css';

interface PanelProps {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** White card with a small muted title row; `right` hosts chips/controls. */
export const Panel = ({ title, right, children, className }: PanelProps) => (
  <section className={className ? `${styles.panel} ${className}` : styles.panel}>
    <div className={styles.panelHead}>
      <h2 className={styles.panelTitle}>{title}</h2>
      {right != null && <div className={styles.panelRight}>{right}</div>}
    </div>
    {children}
  </section>
);
