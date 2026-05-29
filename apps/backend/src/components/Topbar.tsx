import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Bell, HelpCircle, Search, Command } from 'lucide-react';
import { Breadcrumbs } from './Breadcrumbs';
import styles from './Topbar.module.css';

export interface TopbarProps {
  title: string;
  sub?: string;
  searchPlaceholder?: string;
  right?: ReactNode;
  /** Opens the global Ctrl+K command palette. */
  onOpenSearch?: () => void;
}

export const Topbar = ({ title, sub, searchPlaceholder, right, onOpenSearch }: TopbarProps) => {
  const [searchParams, setSearchParams] = useSearchParams();
  const q = searchParams.get('q') ?? '';

  const setQ = (v: string) => {
    const next = new URLSearchParams(searchParams);
    if (v) next.set('q', v);
    else next.delete('q');
    setSearchParams(next, { replace: true });
  };

  return (
    <header className={styles.topbar}>
      <div className={styles.left}>
        <Breadcrumbs />
        <div className={styles.title}>{title}</div>
        {sub && <div className={styles.sub}>{sub}</div>}
      </div>

      {searchPlaceholder ? (
        <div className={styles.search}>
          <Search size={14} strokeWidth={1.75} />
          <input
            type="search"
            placeholder={searchPlaceholder}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label={searchPlaceholder}
          />
        </div>
      ) : (
        <span aria-hidden="true" />
      )}

      <div className={styles.right}>
        {right}
        {/* Global jump-to (Ctrl/Cmd+K) — navigable from anywhere. */}
        <button type="button" className={styles.cmdK} onClick={onOpenSearch} aria-label="Search modules (Ctrl K)">
          <Search size={14} strokeWidth={1.75} />
          <span className={styles.cmdKText}>Jump to…</span>
          <kbd className={styles.cmdKKbd}><Command size={11} strokeWidth={2} />K</kbd>
        </button>
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
};
