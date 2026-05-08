import { PriceTag } from '@2990s/design-system';
import { fmtRM, daysAgo } from '@2990s/shared/format';
import { useAuth } from '../lib/auth';
import styles from './Dashboard.module.css';

export const Dashboard = () => {
  const { staff } = useAuth();
  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <h2 className="t-h2">Dashboard</h2>
        <p className="t-body fg-muted">Welcome back, {staff?.name}.</p>
      </header>

      <section className={styles.metrics}>
        <article className={styles.metric}>
          <span className="t-eyebrow">Today's revenue</span>
          <PriceTag amount={29800} size="lg" />
          <small className="t-caption">Up {fmtRM(2400)} vs {daysAgo(new Date(Date.now() - 24 * 3600 * 1000))}</small>
        </article>
        <article className={styles.metric}>
          <span className="t-eyebrow">Orders in flight</span>
          <p className="t-h3" style={{ margin: 0 }}>0</p>
          <small className="t-caption">No orders yet — POS not wired</small>
        </article>
        <article className={styles.metric}>
          <span className="t-eyebrow">Slips awaiting verification</span>
          <p className="t-h3" style={{ margin: 0 }}>0</p>
          <small className="t-caption">Phase 4 verify queue lands here</small>
        </article>
      </section>

      <p className="t-body fg-muted">
        Phase 0 complete. Phase 1 next: SKU Master editor (admin-only) →
        POST /products → POS catalog Realtime.
      </p>
    </div>
  );
};
