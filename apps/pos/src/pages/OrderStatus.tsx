import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowLeft,
  ShieldCheck,
  Inbox,
  Send,
  CheckCircle2,
  MapPin,
  Calendar,
  Clock,
} from 'lucide-react';
import { Button, IconButton } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { Topbar } from '../components/Topbar';
import { useQuery } from '@tanstack/react-query';
import styles from './OrderStatus.module.css';

// Demo PIN for pilot (per CLAUDE.md prototype reference). Production wires
// through to staff.pin_hash via /api/auth/pin endpoint.
const DEMO_PIN = '299000';
const PIN_LEN = 6;
const SESSION_KEY = 'pos-orders-unlocked-v1';

type Lane = 'received' | 'proceed' | 'logistics' | 'ready' | 'dispatched' | 'delivered' | 'cancelled';

interface MyOrderRow {
  id: string;
  placedAt: string;
  customerName: string;
  customerCity: string | null;
  total: number;
  paid: number;
  lane: Lane;
  deliveryDate: string | null;
}

const useMyOrders = () =>
  useQuery({
    queryKey: ['my-orders'],
    queryFn: async (): Promise<MyOrderRow[]> => {
      // RLS scopes sales to own orders automatically. No explicit filter needed.
      const { data, error } = await supabase
        .from('orders')
        .select('id, placed_at, customer_name, customer_city, total, paid, lane, delivery_date')
        .order('placed_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({
        id: r.id,
        placedAt: r.placed_at,
        customerName: r.customer_name,
        customerCity: r.customer_city ?? null,
        total: r.total,
        paid: r.paid ?? 0,
        lane: r.lane as Lane,
        deliveryDate: r.delivery_date ?? null,
      }));
    },
    staleTime: 10_000,
  });

const fmtMoney = (n: number) => n.toLocaleString('en-MY');
const fmtTimeAgo = (iso: string): string => {
  const d = new Date(iso).getTime();
  const diff = Math.floor((Date.now() - d) / 60000);
  if (diff < 1) return 'just now';
  if (diff < 60) return `${diff}m ago`;
  if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
  return `${Math.floor(diff / 1440)}d ago`;
};

export const OrderStatus = () => {
  const { user } = useAuth();
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (typeof sessionStorage === 'undefined') return false;
    return sessionStorage.getItem(SESSION_KEY) === '1';
  });

  if (!unlocked) {
    return (
      <PinGate
        onUnlock={() => {
          sessionStorage.setItem(SESSION_KEY, '1');
          setUnlocked(true);
        }}
      />
    );
  }

  // POS auth currently exposes user.email; staff name lookup lands when the
  // staff table read is wired through (per-staff PIN comes with that).
  const fallbackName = user?.email?.split('@')[0] ?? 'Sales';
  return <OrderBoard staffName={fallbackName} />;
};

/* ─── PIN Gate ─── */

const PinGate = ({ onUnlock }: { onUnlock: () => void }) => {
  const [digits, setDigits] = useState<string[]>(Array(PIN_LEN).fill(''));
  const [error, setError] = useState<string | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const setDigit = (i: number, v: string) => {
    const cleaned = v.replace(/\D/g, '').slice(0, 1);
    setDigits((cur) => {
      const next = [...cur];
      next[i] = cleaned;
      return next;
    });
    setError(null);
    if (cleaned && i < PIN_LEN - 1) refs.current[i + 1]?.focus();
  };

  const tryUnlock = () => {
    const pin = digits.join('');
    if (pin.length < PIN_LEN) {
      setError('Enter the 6-digit PIN');
      return;
    }
    if (pin === DEMO_PIN) {
      onUnlock();
    } else {
      setError('PIN incorrect — try again');
      setDigits(Array(PIN_LEN).fill(''));
      refs.current[0]?.focus();
    }
  };

  useEffect(() => {
    refs.current[0]?.focus();
  }, []);

  return (
    <main className={styles.gate}>
      <div className={styles.gateCard}>
        <div className={styles.gateIcon}>
          <ShieldCheck size={32} strokeWidth={1.75} />
        </div>
        <h1 className={styles.gateTitle}>Order status</h1>
        <p className={styles.gateBody}>
          Enter your 6-digit staff PIN to view your orders. PIN switching keeps
          this tablet shareable across sales staff.
        </p>
        <div
          className={styles.pinRow}
          onPaste={(e) => {
            const txt = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LEN);
            if (!txt) return;
            e.preventDefault();
            const next = Array(PIN_LEN).fill('');
            for (let i = 0; i < txt.length; i++) next[i] = txt[i];
            setDigits(next);
            refs.current[Math.min(txt.length, PIN_LEN - 1)]?.focus();
          }}
        >
          {digits.map((d, i) => (
            <input
              key={i}
              ref={(el) => { refs.current[i] = el; }}
              type="password"
              inputMode="numeric"
              autoComplete="off"
              maxLength={1}
              value={d}
              onChange={(e) => setDigit(i, e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Backspace' && !d && i > 0) {
                  refs.current[i - 1]?.focus();
                }
                if (e.key === 'Enter') tryUnlock();
              }}
              className={styles.pinInput}
              aria-label={`PIN digit ${i + 1}`}
            />
          ))}
        </div>
        {error && <p className={styles.gateError}>{error}</p>}
        <Button variant="primary" onClick={tryUnlock} fullWidth>
          Unlock
        </Button>
        <Link to="/catalog" className={styles.gateBack}>
          <ArrowLeft size={14} strokeWidth={1.75} /> Back to catalog
        </Link>
        <p className={styles.gateHint}>
          Pilot PIN: <code>299000</code>. Production will switch to per-staff hashed PINs.
        </p>
      </div>
    </main>
  );
};

/* ─── Order Board (3 lanes) ─── */

interface LaneDef {
  id: 'place' | 'proceed' | 'delivered';
  num: string;
  title: string;
  sub: string;
  Icon: typeof Inbox;
  matches: Lane[];
}

const LANES: ReadonlyArray<LaneDef> = [
  {
    id: 'place',
    num: '01',
    title: 'Place order',
    sub: 'Just placed · may need detail tweaks',
    Icon: Inbox,
    matches: ['received'],
  },
  {
    id: 'proceed',
    num: '02',
    title: 'Proceed order',
    sub: 'Locked · coordinator handling',
    Icon: Send,
    matches: ['proceed', 'logistics', 'ready', 'dispatched'],
  },
  {
    id: 'delivered',
    num: '03',
    title: 'Delivered',
    sub: 'Closed · signed off',
    Icon: CheckCircle2,
    matches: ['delivered'],
  },
];

const OrderBoard = ({ staffName }: { staffName: string }) => {
  const orders = useMyOrders();
  const list = orders.data ?? [];

  const grouped = useMemo(() => {
    const map: Record<LaneDef['id'], MyOrderRow[]> = {
      place: [],
      proceed: [],
      delivered: [],
    };
    for (const o of list) {
      for (const lane of LANES) {
        if (lane.matches.includes(o.lane)) {
          map[lane.id].push(o);
          break;
        }
      }
    }
    return map;
  }, [list]);

  return (
    <>
    <Topbar />
    <main className={styles.shell}>
      <header className={styles.header}>
        <Link to="/catalog">
          <IconButton
            icon={<ArrowLeft size={20} strokeWidth={1.75} />}
            aria-label="Back to catalog"
          />
        </Link>
        <div>
          <span className="t-eyebrow">Sales view · {staffName}</span>
          <h1 className={styles.heading}>My orders</h1>
        </div>
        <div className={styles.headerRight}>
          <button
            type="button"
            className={styles.lockBtn}
            onClick={() => {
              sessionStorage.removeItem(SESSION_KEY);
              window.location.reload();
            }}
          >
            <ShieldCheck size={14} strokeWidth={1.75} /> Lock again
          </button>
        </div>
      </header>

      {orders.isLoading ? (
        <p className={styles.empty}>Loading…</p>
      ) : orders.error ? (
        <p className={styles.empty}>Failed to load: {String(orders.error)}</p>
      ) : list.length === 0 ? (
        <div className={styles.empty}>
          <p>No orders yet. Sales you place will appear here.</p>
          <Link to="/catalog">
            <Button variant="primary">Back to catalog</Button>
          </Link>
        </div>
      ) : (
        <div className={styles.lanes}>
          {LANES.map((lane) => {
            const items = grouped[lane.id];
            const Icon = lane.Icon;
            return (
              <section key={lane.id} className={styles.lane}>
                <header className={styles.laneHead}>
                  <div className={styles.laneNum}>{lane.num}</div>
                  <div className={styles.laneInfo}>
                    <Icon size={14} strokeWidth={1.75} />
                    <span className={styles.laneTitle}>{lane.title}</span>
                    <span className={styles.laneSub}>{lane.sub}</span>
                  </div>
                  <div className={styles.laneCount}>{items.length}</div>
                </header>
                <div className={styles.laneBody}>
                  {items.length === 0 ? (
                    <div className={styles.laneEmpty}>
                      Nothing here yet
                    </div>
                  ) : (
                    items.map((o) => <OrderTile key={o.id} order={o} />)
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </main>
    </>
  );
};

const OrderTile = ({ order }: { order: MyOrderRow }) => {
  const paidPct = order.total > 0 ? Math.min(100, Math.round((order.paid / order.total) * 100)) : 0;
  return (
    <article className={styles.tile}>
      <div className={styles.tileHead}>
        <span className={styles.tileId}>{order.id}</span>
        <span className={styles.tileWhen}>{fmtTimeAgo(order.placedAt)}</span>
      </div>
      <div className={styles.tileName}>{order.customerName}</div>
      <div className={styles.tileMeta}>
        <span className={styles.tileMetaItem}>
          <MapPin size={11} strokeWidth={1.75} />
          {order.customerCity ?? 'Address pending'}
        </span>
        <span className={styles.tileMetaItem}>
          <Calendar size={11} strokeWidth={1.75} />
          {order.deliveryDate
            ? new Date(order.deliveryDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
            : 'Date TBD'}
        </span>
      </div>
      <div className={styles.tileTotalRow}>
        <span className={styles.tileTotal}>
          <sup>RM</sup>{fmtMoney(order.total)}
        </span>
        <span className={styles.tilePaid}>
          <Clock size={10} strokeWidth={1.75} />
          {paidPct}% paid
        </span>
      </div>
      <div className={styles.tilePaidBar}>
        <div className={styles.tilePaidBarFill} style={{ width: `${paidPct}%` }} />
      </div>
    </article>
  );
};
