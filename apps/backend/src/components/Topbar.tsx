import type { ReactNode } from 'react';
import { Bell, HelpCircle } from 'lucide-react';
import styles from './Topbar.module.css';

export interface TopbarProps {
  title: string;
  sub?: string;
  right?: ReactNode;
}

export const Topbar = ({ title, sub, right }: TopbarProps) => (
  <header className={styles.topbar}>
    <div className={styles.left}>
      <div className={styles.title}>{title}</div>
      {sub && <div className={styles.sub}>{sub}</div>}
    </div>
    <div className={styles.right}>
      {right}
      <button type="button" className={styles.pill} aria-label="Alerts">
        <Bell size={16} strokeWidth={1.75} />
        <span className={styles.pillLabel}>Alerts</span>
      </button>
      <button type="button" className={styles.pill} aria-label="Help">
        <HelpCircle size={16} strokeWidth={1.75} />
        <span className={styles.pillLabel}>Help</span>
      </button>
    </div>
  </header>
);
