import type { ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Bell, HelpCircle, Search } from 'lucide-react';
import styles from './Topbar.module.css';

export interface TopbarProps {
  title: string;
  sub?: string;
  searchPlaceholder?: string;
  right?: ReactNode;
}

export const Topbar = ({ title, sub, searchPlaceholder, right }: TopbarProps) => {
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
