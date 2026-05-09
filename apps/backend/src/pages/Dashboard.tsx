import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import {
  Sparkles,
  Truck,
  ShieldCheck,
  Banknote,
  TrendingUp,
  MapPin,
  AlertCircle,
  CircleDot,
  ArrowRight,
  Inbox,
  ArrowRightCircle,
  PackageSearch,
  CheckCircle2,
  Clock,
  ChevronRight,
  CreditCard,
  type LucideIcon,
} from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import { useAuth } from '../lib/auth';
import { useOrders, useOrdersRealtime, useSlipQueue, type OrderListRow } from '../lib/queries';
import { LANES, type LaneId } from '../lib/lanes';
import styles from './Dashboard.module.css';

const greetingForHour = (h: number): string => {
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const fmtDateLong = (d: Date): string =>
  d.toLocaleDateString('en-MY', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });

const isToday = (iso: string): boolean => {
  const d = new Date(iso);
  const t = new Date();
  return (
    d.getFullYear() === t.getFullYear() &&
    d.getMonth() === t.getMonth() &&
    d.getDate() === t.getDate()
  );
};

const PAYMENT_ICON: Record<string, LucideIcon> = {
  transfer: Banknote,
  credit: CreditCard,
  debit: CreditCard,
  installment: CreditCard,
};

const PAYMENT_LABEL: Record<string, string> = {
  transfer: 'Bank transfer / DuitNow',
  credit: 'Credit card',
  debit: 'Debit card',
  installment: 'Installment',
};

export const Dashboard = () => {
  const { staff } = useAuth();
  const navigate = useNavigate();
  const orders = useOrders();
  const slipQueue = useSlipQueue();
  useOrdersRealtime();

  const list: ReadonlyArray<OrderListRow> = orders.data ?? [];

  const counts = useMemo(() => {
    const c: Record<LaneId, number> = {
      received: 0, proceed: 0, logistics: 0, ready: 0, dispatched: 0, delivered: 0,
    };
    for (const o of list) if (o.lane in c) c[o.lane as LaneId]++;
    return c;
  }, [list]);

  const todayOrders = list.filter((o) => isToday(o.placedAt));
  const newToday = todayOrders.length;
  const dispatchToday = list.filter(
    (o) => o.lane === 'dispatched' && o.deliveryDate && isToday(o.deliveryDate),
  ).length;
  const collectedToday = todayOrders.reduce((s, o) => s + (o.paid ?? 0), 0);
  const toVerify = slipQueue.data?.length ?? 0;
  const needsAttention = counts.received + counts.proceed + toVerify;
  const pendingSlips = (slipQueue.data ?? []).slice(0, 4);

  const goToLane = (id: LaneId) => navigate(`/orders?lane=${id}`);
  const goToBoard = () => navigate('/orders');
  const goToVerify = () => navigate('/verify-slips');
  const openOrder = (id: string) => navigate(`/orders?orderId=${encodeURIComponent(id)}`);

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
            Same price. Every piece. Always. The showroom passed {newToday}{' '}
            {newToday === 1 ? 'order' : 'orders'} today — verify slips first, then move stock.
          </p>
          <div className={styles.heroChips}>
            <span className={styles.heroChip}><Inbox size={14} strokeWidth={1.75} />{counts.received} received</span>
            <span className={styles.heroChip}><ArrowRightCircle size={14} strokeWidth={1.75} />{counts.proceed} proceed</span>
            <span className={styles.heroChip}><PackageSearch size={14} strokeWidth={1.75} />{counts.logistics} logistics</span>
            <span className={styles.heroChip}><Truck size={14} strokeWidth={1.75} />{counts.dispatched} on the road</span>
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
            <div className={styles.kpiHead}><Truck size={16} strokeWidth={1.75} />Dispatch today</div>
            <div className={styles.kpiNum}>{dispatchToday}</div>
            <div className={styles.kpiDelta}>
              <MapPin size={12} strokeWidth={1.75} />By driver schedule
            </div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiHead}><ShieldCheck size={16} strokeWidth={1.75} />Slips to verify</div>
            <div className={styles.kpiNum}>{toVerify}</div>
            <div className={`${styles.kpiDelta} ${styles.kpiFlag}`}>
              <AlertCircle size={12} strokeWidth={1.75} />Verify only · Finance approves
            </div>
          </div>
          <div className={styles.kpi}>
            <div className={styles.kpiHead}><Banknote size={16} strokeWidth={1.75} />Collected today</div>
            <div className={styles.kpiNum}>
              <sup>RM</sup>{collectedToday.toLocaleString('en-MY')}
            </div>
            <div className={styles.kpiDelta}>
              <CircleDot size={12} strokeWidth={1.75} />Across {newToday} {newToday === 1 ? 'order' : 'orders'}
            </div>
          </div>
        </div>
      </section>

      <div className={styles.sectionTitle}>
        <div>
          <h2 className={styles.sectionH2}>Order pipeline</h2>
          <span className={styles.sectionSub}>Click a lane to jump to the board</span>
        </div>
        <button type="button" className={styles.ghostBtn} onClick={goToBoard}>
          Open board <ArrowRight size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className={styles.lanesStrip}>
        {LANES.map((l) => {
          const Icon = l.Icon;
          const n = counts[l.id] ?? 0;
          return (
            <button
              key={l.id}
              type="button"
              className={styles.laneTile}
              onClick={() => goToLane(l.id)}
            >
              <div className={styles.laneTileIcon}><Icon size={18} strokeWidth={1.75} /></div>
              <div className={styles.laneTileNum}>{l.num}</div>
              <div className={styles.laneTileTitle}>{l.title}</div>
              <div className={styles.laneTileCount}>
                <span className={styles.laneTileNumBig}>{n}</span>
                <span className={styles.laneTileLbl}>{n === 1 ? 'order' : 'orders'}</span>
              </div>
            </button>
          );
        })}
      </div>

      <div className={styles.sectionTitle}>
        <div>
          <h2 className={styles.sectionH2}>Awaiting payment slip check</h2>
          <span className={styles.sectionSub}>You verify the slip matches — Finance approves</span>
        </div>
        <button type="button" className={styles.ghostBtn} onClick={goToVerify}>
          All slips <ArrowRight size={14} strokeWidth={1.75} />
        </button>
      </div>

      <div className={styles.verifyCard}>
        {pendingSlips.length === 0 ? (
          <div className={styles.verifyEmpty}>
            <CheckCircle2 size={22} strokeWidth={1.75} />
            <span>All slips checked. Nicely done.</span>
          </div>
        ) : (
          pendingSlips.map((o) => {
            const PayIcon = PAYMENT_ICON[o.paymentMethod] ?? CreditCard;
            const initial = o.customerName?.charAt(0).toUpperCase() ?? '?';
            return (
              <button
                key={o.id}
                type="button"
                className={styles.verifyRow}
                onClick={() => openOrder(o.id)}
              >
                <span className={styles.verifyAvatar}>{initial}</span>
                <div className={styles.verifyMain}>
                  <div className={styles.verifyName}>
                    {o.customerName} <span className={styles.verifyId}>· {o.id}</span>
                  </div>
                  <div className={styles.verifySub}>
                    Placed {new Date(o.placedAt).toLocaleString('en-MY', { hour: '2-digit', minute: '2-digit', day: 'numeric', month: 'short' })}
                  </div>
                </div>
                <div className={styles.verifyAmount}>
                  <sup>RM</sup>{fmtRM(o.total).replace('RM', '').trim()}
                </div>
                <div className={styles.verifyMethod}>
                  <PayIcon size={14} strokeWidth={1.75} />
                  {PAYMENT_LABEL[o.paymentMethod] ?? o.paymentMethod}
                </div>
                <span className={`${styles.verifyPill} ${styles.verifyPillWarn}`}>
                  <Clock size={12} strokeWidth={1.75} />Awaiting check
                </span>
                <ChevronRight size={16} strokeWidth={1.75} className={styles.verifyChev} />
              </button>
            );
          })
        )}
      </div>
    </div>
  );
};
