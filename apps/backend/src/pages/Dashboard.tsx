import { useMemo } from 'react';
import {
  Sparkles,
  Banknote,
  TrendingUp,
  CircleDot,
  Inbox,
  ArrowRightCircle,
  CheckCircle2,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useMfgSalesOrders } from '../lib/flow-queries';
import styles from './Dashboard.module.css';

/* Phase C2 — Dashboard reads Sales Orders (mfg_sales_orders), not the legacy
   retail `orders` board. SOs bucket into 3 lifecycle stages. "Proceed" is the
   SALES marker (proceeded_at) — matching the POS board, NOT a production status
   (Owner 2026-06-03): a CONFIRMED order stays "placed" until the salesperson
   marks it proceeded. Production/terminal statuses the backend sets still bucket
   under Proceed/Delivered. ON_HOLD + CANCELLED are excluded from every count. */
type SoBucket = 'placed' | 'proceed' | 'delivered';
const bucketFor = (o: { status: string; proceeded_at: string | null }): SoBucket | null => {
  if (o.status === 'DELIVERED' || o.status === 'INVOICED' || o.status === 'CLOSED') return 'delivered';
  if (o.status === 'IN_PRODUCTION' || o.status === 'READY_TO_SHIP' || o.status === 'SHIPPED') return 'proceed';
  if (o.status === 'CONFIRMED') return o.proceeded_at ? 'proceed' : 'placed';
  return null; // ON_HOLD / CANCELLED — excluded from all counts
};

/* Minimal row shape off useMfgSalesOrders (full row typed in
   MfgSalesOrdersList). Totals are centi; created_at is an ISO timestamp. */
type SoRow = {
  doc_no: string;
  status: string;
  proceeded_at: string | null;
  local_total_centi: number;
  created_at: string | null;
  so_date: string | null;
};

const greetingForHour = (h: number): string => {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const fmtDateLong = (d: Date): string => {
  const weekday = d.toLocaleDateString('en-MY', { weekday: 'long' });
  const ymd = d.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/-/g, '/');
  return `${weekday}, ${ymd}`;
};

const isToday = (iso: string | null | undefined): boolean => {
  if (!iso) return false;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return false;
  const t = new Date();
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  );
};

export const Dashboard = () => {
  const { staff } = useAuth();
  const salesOrders = useMfgSalesOrders(undefined);

  const list = useMemo<ReadonlyArray<SoRow>>(
    () => (salesOrders.data?.salesOrders ?? []) as SoRow[],
    [salesOrders.data],
  );

  const counts = useMemo(() => {
    const c = { placed: 0, proceed: 0, delivered: 0 };
    for (const o of list) {
      const bucket = bucketFor(o);
      if (bucket) c[bucket]++;
    }
    return c;
  }, [list]);

  /* "New today" = SOs created today (fall back to so_date when created_at is
     absent). "Awaiting proceed" = CONFIRMED count (replaces the old
     "Dispatch today", which has no SO equivalent). */
  const newToday = list.filter((o) => isToday(o.created_at ?? o.so_date)).length;
  const awaitingProceed = counts.placed;

  /* The SO list hook exposes only a cumulative paid total (paid_total_centi),
     not a per-day collected figure — so the old per-day "Collected today" KPI
     can't be computed here. Replaced with "Open orders" = placed + proceed,
     the count of SOs not yet delivered/closed. */
  const openOrders = counts.placed + counts.proceed;

  const needsAttention = counts.placed;

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.heroCard}>
          <div className={styles.heroEyebrow}>{fmtDateLong(new Date())}</div>
          <h1 className={styles.heroTitle}>
            {greetingForHour(new Date().getHours())}, {staff?.name?.split(' ')[0] ?? 'there'}.{' '}
            <span className={styles.heroScript}>{needsAttention}</span>{' '}
            {needsAttention === 1 ? 'order needs' : 'orders need'} a careful look today.
          </h1>
          <p className={styles.heroSub}>
            Same price. Every piece. Always. The showroom placed {newToday}{' '}
            {newToday === 1 ? 'order' : 'orders'} today — confirm details first, then move to proceed.
          </p>
          <div className={styles.heroChips}>
            <span className={styles.heroChip}><Inbox size={14} strokeWidth={1.75} />{counts.placed} order placed</span>
            <span className={styles.heroChip}><ArrowRightCircle size={14} strokeWidth={1.75} />{counts.proceed} proceed</span>
            <span className={styles.heroChip}><CheckCircle2 size={14} strokeWidth={1.75} />{counts.delivered} delivered</span>
          </div>
        </div>

        <div className={styles.kpiGrid}>
          <div className={styles.kpi}>
            <div className={styles.kpiHead}><Sparkles size={16} strokeWidth={1.75} />New today</div>
            <div className={styles.kpiNum}>{newToday}</div>
            <div className={`${styles.kpiDelta} ${styles.kpiUp}`}>
              <TrendingUp size={12} strokeWidth={1.75} />Live from POS
            </div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiHead}><ArrowRightCircle size={16} strokeWidth={1.75} />Awaiting proceed</div>
            <div className={styles.kpiNum}>{awaitingProceed}</div>
            <div className={styles.kpiDelta}>
              <CircleDot size={12} strokeWidth={1.75} />Confirmed, not yet proceeded
            </div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiHead}><Banknote size={16} strokeWidth={1.75} />Open orders</div>
            <div className={styles.kpiNum}>{openOrders}</div>
            <div className={styles.kpiDelta}>
              <CircleDot size={12} strokeWidth={1.75} />Placed + in proceed
            </div>
          </div>
        </div>
      </section>

    </div>
  );
};
