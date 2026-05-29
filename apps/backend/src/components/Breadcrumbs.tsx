// Breadcrumb trail derived from the current path: Home › Group › Page.
// Detail routes (e.g. /suppliers/:id) append a muted "Detail" crumb.
// (Commander 2026-05-29 — UI/UX reorg.)

import { Link, useLocation } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { navItemForPath } from '../lib/nav-items';
import styles from './Topbar.module.css';

export const Breadcrumbs = () => {
  const { pathname } = useLocation();
  if (pathname === '/dashboard' || pathname === '/') return null;

  const item = navItemForPath(pathname);
  if (!item) return null;

  // Is this a deeper sub-route than the matched item (detail / new / nested)?
  const tail = pathname.slice(item.path.length).replace(/^\/+/, '');
  const sub =
    tail === 'new' ? 'New'
    : tail === 'from-so' ? 'From SO'
    : tail === 'from-po' ? 'From PO'
    : tail === 'from-grn' ? 'From GRN'
    : tail === 'maintenance' ? 'Maintenance'
    : tail ? 'Detail'
    : '';

  return (
    <nav className={styles.crumbs} aria-label="Breadcrumb">
      <Link to="/dashboard" className={styles.crumbLink}>Home</Link>
      <ChevronRight size={12} strokeWidth={2} className={styles.crumbSep} />
      <span className={styles.crumbGroup}>{item.group}</span>
      <ChevronRight size={12} strokeWidth={2} className={styles.crumbSep} />
      {sub ? (
        <>
          <Link to={item.path} className={styles.crumbLink}>{item.label}</Link>
          <ChevronRight size={12} strokeWidth={2} className={styles.crumbSep} />
          <span className={styles.crumbCurrent}>{sub}</span>
        </>
      ) : (
        <span className={styles.crumbCurrent}>{item.label}</span>
      )}
    </nav>
  );
};
