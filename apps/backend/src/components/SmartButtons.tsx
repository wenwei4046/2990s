// ----------------------------------------------------------------------------
// SmartButtons — Odoo-style document-linkage fan-out for procurement docs.
//
// Renders a horizontal row of pill buttons across the top of a detail page.
// Each button: dominant count + small label, links to the child docs.
//
//   <SmartButtons buttons={[
//     { count: 2, label: 'GRNs',     to: '/grns?poId=...' },
//     { count: 1, label: 'Invoice',  to: '/purchase-invoices?poId=...' },
//     { count: 0, label: 'Returns',  to: '/purchase-returns?poId=...' },
//   ]} />
//
// Buttons with count=0 render as a dimmed, non-clickable span (the underlying
// list page would show zero rows anyway — clicking it would be misleading).
// loading={true} reserves the row so the page doesn't jump on first paint.
// ----------------------------------------------------------------------------

import { Link } from 'react-router';
import styles from './SmartButtons.module.css';

export type SmartButtonSpec = {
  count: number;
  label: string;
  /** Always render as a clickable Link unless count=0. */
  to: string;
};

type Props = {
  buttons: SmartButtonSpec[];
  /** While the linked query is in flight, render skeleton pills so the page
      doesn't reflow when counts arrive. */
  loading?: boolean;
};

export const SmartButtons = ({ buttons, loading = false }: Props) => {
  if (loading) {
    return (
      <div className={styles.row} aria-busy="true">
        {buttons.length > 0
          ? buttons.map((b) => <div key={b.label} className={styles.skeleton} />)
          : [0, 1, 2].map((i) => <div key={i} className={styles.skeleton} />)}
      </div>
    );
  }

  return (
    <div className={styles.row}>
      {buttons.map((b) => {
        const isZero = b.count === 0;
        const label = pluralLabel(b.label, b.count);
        if (isZero) {
          return (
            <span
              key={b.label}
              className={`${styles.btn} ${styles.dim}`}
              aria-disabled="true"
              title={`No ${b.label.toLowerCase()} yet`}
            >
              <span className={styles.count}>0</span>
              <span className={styles.label}>{label}</span>
            </span>
          );
        }
        return (
          <Link key={b.label} to={b.to} className={styles.btn}>
            <span className={styles.count}>{b.count}</span>
            <span className={styles.label}>{label}</span>
          </Link>
        );
      })}
    </div>
  );
};

/** Naive singular/plural for the small set of labels we use ("GRN/GRNs",
 *  "Invoice/Invoices", "Return/Returns", "PO/POs"). The convention used in
 *  the rest of the app: count=1 → singular, anything else → plural. */
function pluralLabel(label: string, count: number): string {
  if (count === 1) {
    if (label.endsWith('s')) return label.slice(0, -1);
    return label;
  }
  if (label.endsWith('s')) return label;
  return `${label}s`;
}
