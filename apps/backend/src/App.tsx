import { LayoutDashboard, ListOrdered, Boxes } from 'lucide-react';
import { IconButton, PriceTag } from '@2990s/design-system';
import { fmtRM, daysAgo } from '@2990s/shared/format';
import styles from './App.module.css';

// Phase 0 sanity-check screen. Real Backend ports from prototype/backend-*.jsx
// in Phase 3 (order lifecycle). This just verifies tokens + design-system +
// shared/format wire correctly.
export const App = () => (
  <div className={styles.shell}>
    <aside className={styles.sidebar}>
      <span className="t-eyebrow">2990's · Backend</span>
      <nav className={styles.nav}>
        <button className={styles.navItem} type="button">
          <LayoutDashboard size={20} strokeWidth={1.75} />
          Dashboard
        </button>
        <button className={styles.navItem} type="button">
          <ListOrdered size={20} strokeWidth={1.75} />
          Orders
        </button>
        <button className={styles.navItem} type="button">
          <Boxes size={20} strokeWidth={1.75} />
          SKU master
        </button>
      </nav>
    </aside>

    <main className={styles.main}>
      <header className={styles.header}>
        <h2 className="t-h2">Dashboard</h2>
        <IconButton icon={<LayoutDashboard />} aria-label="Refresh dashboard" variant="secondary" />
      </header>

      <section className={styles.metrics}>
        <article className={styles.metric}>
          <span className="t-eyebrow">Today's revenue</span>
          <PriceTag amount={29800} size="lg" />
          <small className="t-caption">Up {fmtRM(2400)} vs {daysAgo(new Date(Date.now() - 24 * 3600 * 1000))}</small>
        </article>
        <article className={styles.metric}>
          <span className="t-eyebrow">Orders in flight</span>
          <p className="t-h3" style={{ margin: 0 }}>12</p>
          <small className="t-caption">3 awaiting verification</small>
        </article>
      </section>

      <p className="t-body fg-muted">
        Phase 0 scaffold. Full 6-lane order board ports from `prototype/backend-orders.jsx`
        in Phase 3.
      </p>
    </main>
  </div>
);
