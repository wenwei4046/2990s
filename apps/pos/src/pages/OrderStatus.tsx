import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
  X,
  Package,
  Save,
  ArrowRight,
  Circle,
  Check,
  Delete,
  Receipt,
  Store,
  Loader2,
  Printer,
} from 'lucide-react';
import { Button, IconButton } from '@2990s/design-system';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { Topbar } from '../components/Topbar';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalities, useSalesStats } from '../lib/queries';
import { useStaff } from '../lib/staff';
import { SlipUploadStep } from '../components/SlipUploadStep';
import styles from './OrderStatus.module.css';

const PIN_LEN = 6;
// Scoped by user.id so a fresh login on the same tablet re-prompts for PIN
// instead of inheriting the previous user's unlocked state.
const SESSION_KEY_PREFIX = 'pos-orders-unlocked-v2:';
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

type Lane = 'received' | 'proceed' | 'logistics' | 'ready' | 'dispatched' | 'delivered' | 'cancelled';

interface OrderItem {
  qty: number;
  lineTotal: number;
  productName: string | null;
  productImage: string | null;
}

interface MyOrderRow {
  id: string;
  placedAt: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  customerCity: string | null;
  customerAddress: string | null;
  customerAddressLine2: string | null;
  customerPostcode: string | null;
  customerState: string | null;
  total: number;
  subtotal: number;
  addonTotal: number;
  paid: number;
  lane: Lane;
  deliveryDate: string | null;
  deliverySlot: string | null;
  paymentMethod: string | null;
  approvalCode: string | null;
  notes: string | null;
  staffName: string | null;
  staffInitials: string | null;
  pieces: number;
  firstImage: string | null;
  items: OrderItem[];
}

const useMyOrders = () =>
  useQuery({
    queryKey: ['my-orders'],
    queryFn: async (): Promise<MyOrderRow[]> => {
      // RLS scopes sales to own orders automatically. No explicit filter needed.
      // Embed staff (placing salesperson) + order_items (qty, line_total, product
      // for photo). Disambiguate staff embed via the explicit FK name because
      // orders has 4 FKs to staff (staff_id, salesperson_id, po_issued_by,
      // slip_verified_by).
      const { data, error } = await supabase
        .from('orders')
        .select(`
          id, placed_at,
          customer_name, customer_phone, customer_email,
          customer_address, customer_address_line2,
          customer_postcode, customer_city, customer_state,
          subtotal, addon_total, total, paid, lane,
          delivery_date, delivery_slot,
          payment_method, approval_code, notes,
          staff:orders_staff_id_staff_id_fk (name, initials),
          order_items (qty, kind, line_total, products:product_id (name, img_key, thumb_key))
        `)
        .order('placed_at', { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((r: any) => {
        const items: OrderItem[] = (r.order_items ?? [])
          .filter((it: any) => it.kind === 'product')
          .map((it: any) => ({
            qty: it.qty ?? 0,
            lineTotal: it.line_total ?? 0,
            productName: it.products?.name ?? null,
            productImage: it.products?.thumb_key ?? it.products?.img_key ?? null,
          }));
        const pieces = items.reduce((s, it) => s + it.qty, 0);
        const firstImage = items.find((it) => it.productImage)?.productImage ?? null;
        return {
          id: r.id,
          placedAt: r.placed_at,
          customerName: r.customer_name,
          customerPhone: r.customer_phone ?? null,
          customerEmail: r.customer_email ?? null,
          customerCity: r.customer_city ?? null,
          customerAddress: r.customer_address ?? null,
          customerAddressLine2: r.customer_address_line2 ?? null,
          customerPostcode: r.customer_postcode ?? null,
          customerState: r.customer_state ?? null,
          subtotal: r.subtotal ?? 0,
          addonTotal: r.addon_total ?? 0,
          total: r.total,
          paid: r.paid ?? 0,
          lane: r.lane as Lane,
          deliveryDate: r.delivery_date ?? null,
          deliverySlot: r.delivery_slot ?? null,
          paymentMethod: r.payment_method ?? null,
          approvalCode: r.approval_code ?? null,
          notes: r.notes ?? null,
          staffName: r.staff?.name ?? null,
          staffInitials: r.staff?.initials ?? null,
          pieces,
          firstImage,
          items,
        };
      });
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
  const sessionKey = user ? `${SESSION_KEY_PREFIX}${user.id}` : null;
  const [unlocked, setUnlocked] = useState<boolean>(() => {
    if (!user || typeof sessionStorage === 'undefined') return false;
    return sessionStorage.getItem(`${SESSION_KEY_PREFIX}${user.id}`) === '1';
  });

  if (!user) return null; // AuthGate blocks unauthenticated access upstream.

  if (!unlocked) {
    return (
      <PinGate
        onUnlock={() => {
          if (sessionKey) sessionStorage.setItem(sessionKey, '1');
          setUnlocked(true);
        }}
      />
    );
  }

  return <OrderBoard sessionKey={sessionKey} />;
};

/* ─── PIN Gate ─── */

const PinGate = ({ onUnlock }: { onUnlock: () => void }) => {
  const [pin, setPin] = useState('');
  const [showErr, setShowErr] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [retryAfter, setRetryAfter] = useState<number | null>(null);

  // onUnlock is recreated on every parent render. Stashing it in a ref keeps
  // the submit effect's dep array stable — otherwise the effect re-runs every
  // render, its cleanup fires, and any in-flight fetch gets wrongly cancelled.
  const onUnlockRef = useRef(onUnlock);
  onUnlockRef.current = onUnlock;

  // Countdown for rate-limit lockout.
  useEffect(() => {
    if (retryAfter === null) return;
    if (retryAfter <= 0) {
      setRetryAfter(null);
      setErrorMsg(null);
      return;
    }
    const t = window.setTimeout(
      () => setRetryAfter((s) => (s == null ? null : s - 1)),
      1000,
    );
    return () => window.clearTimeout(t);
  }, [retryAfter]);

  // Submit when PIN reaches 6 digits.
  useEffect(() => {
    if (pin.length !== PIN_LEN || busy) return;
    const submit = async () => {
      setBusy(true);
      try {
        const session = await supabase.auth.getSession();
        const token = session.data.session?.access_token;
        if (!token || !API_URL) {
          setPin('');
          setShowErr(true);
          setErrorMsg('Session lost — sign in again');
          window.setTimeout(() => setShowErr(false), 700);
          return;
        }
        const res = await fetch(`${API_URL}/pos/verify-pin`, {
          method: 'POST',
          headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
          body: JSON.stringify({ pin }),
        });
        const body = (await res.json().catch(() => ({}))) as {
          valid?: boolean;
          remainingAttempts?: number;
          retryAfter?: number;
          error?: string;
        };
        if (res.ok && body.valid) {
          window.setTimeout(() => onUnlockRef.current(), 180);
          return;
        }
        setPin('');
        setShowErr(true);
        if (res.status === 429 && typeof body.retryAfter === 'number') {
          setRetryAfter(body.retryAfter);
          setErrorMsg(`Too many attempts — try again in ${body.retryAfter}s`);
        } else if (body.valid === false) {
          const remaining = body.remainingAttempts ?? 0;
          setErrorMsg(remaining > 0 ? `Wrong PIN — ${remaining} left` : 'Wrong PIN');
        } else {
          setErrorMsg(body.error ?? 'Verification failed');
        }
        window.setTimeout(() => setShowErr(false), 700);
      } finally {
        setBusy(false);
      }
    };
    void submit();
  }, [pin, busy]);

  const locked = retryAfter !== null && retryAfter > 0;
  const padDisabled = busy || locked;

  const press = useCallback(
    (k: string | 'del' | 'clr') => {
      if (padDisabled) return;
      if (k === 'del') { setPin((p) => p.slice(0, -1)); return; }
      if (k === 'clr') { setPin(''); return; }
      if (errorMsg && !locked) setErrorMsg(null);
      setShowErr(false);
      setPin((p) => (p.length >= PIN_LEN ? p : p + k));
    },
    [padDisabled, errorMsg, locked],
  );

  return (
    <>
      <Topbar />
      <main className={styles.gate}>
        <div className={styles.gateCard}>
          <div className={styles.gateIcon}>
            <ShieldCheck size={26} strokeWidth={1.75} />
          </div>
          <div className={styles.gateEyebrow}>Your orders</div>
          <h2 className={styles.gateTitle}>Enter your PIN</h2>
          <p className={styles.gateSub}>
            Same PIN you signed in with. Keeps customer details safe when the
            tablet is shared.
          </p>

          <div
            className={`${styles.gateDots} ${showErr ? styles.gateDotsErr : ''}`}
            aria-live="polite"
          >
            {Array.from({ length: PIN_LEN }).map((_, i) => (
              <span
                key={i}
                className={`${styles.gateDot} ${
                  showErr ? styles.gateDotErr : pin.length > i ? styles.gateDotOn : ''
                }`}
                aria-hidden="true"
              />
            ))}
          </div>

          {errorMsg && <div className={styles.gateError} role="alert">{errorMsg}</div>}

          <div className={styles.gatePad}>
            {['1','2','3','4','5','6','7','8','9'].map((k) => (
              <button
                key={k}
                type="button"
                className={styles.gateKey}
                onClick={() => press(k)}
                disabled={padDisabled}
              >
                {k}
              </button>
            ))}
            <button
              type="button"
              className={`${styles.gateKey} ${styles.gateKeyUtil}`}
              onClick={() => press('clr')}
              disabled={padDisabled}
            >
              Clear
            </button>
            <button
              type="button"
              className={styles.gateKey}
              onClick={() => press('0')}
              disabled={padDisabled}
            >
              0
            </button>
            <button
              type="button"
              className={`${styles.gateKey} ${styles.gateKeyUtil}`}
              onClick={() => press('del')}
              disabled={padDisabled}
              aria-label="Delete last digit"
            >
              <Delete size={18} strokeWidth={1.75} />
            </button>
          </div>

          <Link to="/catalog" className={styles.gateBack}>
            <ArrowLeft size={14} strokeWidth={1.75} /> Back to catalog
          </Link>
        </div>
      </main>
    </>
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

const OrderBoard = ({ sessionKey }: { sessionKey: string | null }) => {
  const orders = useMyOrders();
  const stats = useSalesStats();
  const staff = useStaff();
  const list = orders.data ?? [];
  const [active, setActive] = useState<MyOrderRow | null>(null);

  const staffName = staff.data?.name ?? stats.data?.staffName ?? 'Sales';

  // Keep the active drawer order in sync with refetches.
  useEffect(() => {
    if (!active) return;
    const fresh = list.find((o) => o.id === active.id);
    if (fresh && fresh !== active) setActive(fresh);
  }, [list, active]);

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
              if (sessionKey) sessionStorage.removeItem(sessionKey);
              window.location.reload();
            }}
          >
            <ShieldCheck size={14} strokeWidth={1.75} /> Lock again
          </button>
        </div>
      </header>

      <SalesKpis stats={stats} staffName={staffName} />

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
                    items.map((o) => (
                      <OrderTile key={o.id} order={o} onOpen={setActive} />
                    ))
                  )}
                </div>
              </section>
            );
          })}
        </div>
      )}
      {active && (
        <OrderDetail order={active} onClose={() => setActive(null)} />
      )}
    </main>
    </>
  );
};

/* ─── Sales KPIs (2 cards above the board) ─── */

const SalesKpis = ({
  stats,
  staffName,
}: {
  stats: ReturnType<typeof useSalesStats>;
  staffName: string;
}) => {
  const monthLabel = stats.data?.monthLabel ?? '';
  return (
    <section className={styles.kpis} aria-label={`Sales · ${monthLabel}`}>
      <div className={styles.kpiCard}>
        <div className={styles.kpiHead}>
          <Store size={13} strokeWidth={1.75} />
          Showroom · {monthLabel || '—'}
        </div>
        {stats.isLoading && !stats.data ? (
          <KpiPlaceholder />
        ) : stats.error ? (
          <div className={styles.kpiError}>Couldn’t load</div>
        ) : (
          <>
            <div className={styles.kpiNum}>
              <span className={styles.kpiUnit}>RM</span>
              {fmtMoney(stats.data?.showroomTotal ?? 0)}
            </div>
            <div className={styles.kpiDelta}>
              <Receipt size={12} strokeWidth={1.75} />
              {stats.data?.showroomCount ?? 0}{' '}
              {(stats.data?.showroomCount ?? 0) === 1 ? 'order' : 'orders'}
            </div>
          </>
        )}
      </div>

      <div className={styles.kpiCard}>
        <div className={styles.kpiHead}>
          <ShieldCheck size={13} strokeWidth={1.75} />
          {staffName} · {monthLabel || '—'}
        </div>
        {stats.isLoading && !stats.data ? (
          <KpiPlaceholder />
        ) : stats.error ? (
          <div className={styles.kpiError}>Couldn’t load</div>
        ) : (
          <>
            <div className={styles.kpiNum}>
              <span className={styles.kpiUnit}>RM</span>
              {fmtMoney(stats.data?.personalTotal ?? 0)}
            </div>
            <div className={styles.kpiDelta}>
              <Receipt size={12} strokeWidth={1.75} />
              {stats.data?.personalCount ?? 0}{' '}
              {(stats.data?.personalCount ?? 0) === 1 ? 'order' : 'orders'}
            </div>
          </>
        )}
      </div>
    </section>
  );
};

const KpiPlaceholder = () => (
  <div className={styles.kpiLoading}>
    <Loader2 size={16} strokeWidth={1.75} className={styles.kpiSpin} />
  </div>
);

const OrderTile = ({ order, onOpen }: {
  order: MyOrderRow;
  onOpen: (o: MyOrderRow) => void;
}) => {
  const paidPct = order.total > 0 ? Math.min(100, Math.round((order.paid / order.total) * 100)) : 0;
  const dateLabel = order.deliveryDate
    ? new Date(order.deliveryDate).toLocaleDateString('en-MY', { day: 'numeric', month: 'short' })
    : 'Date TBD';
  const addressLabel = order.customerCity ?? order.customerAddress?.slice(0, 28) ?? 'Address pending';

  return (
    <button type="button" className={styles.tile} onClick={() => onOpen(order)}>
      <div className={styles.tileTopRow}>
        <div className={styles.tileTopInfo}>
          <span className={styles.tileId}>{order.id}</span>
          <span className={styles.tileName}>{order.customerName}</span>
        </div>
        <div
          className={styles.tilePhoto}
          style={order.firstImage ? { backgroundImage: `url(${order.firstImage})` } : undefined}
        >
          {!order.firstImage && <Package size={18} strokeWidth={1.5} />}
          {order.pieces > 1 && (
            <span className={styles.tilePieces}>×{order.pieces}</span>
          )}
        </div>
      </div>
      <div className={styles.tileTotalRow}>
        <span className={styles.tileTotal}>
          <span className={styles.tileTotalUnit}>RM</span>{fmtMoney(order.total)}
        </span>
        <span className={styles.tilePaid}>
          <Clock size={10} strokeWidth={1.75} />
          {paidPct}% paid
        </span>
      </div>
      <div className={styles.tilePaidBar}>
        <div
          className={`${styles.tilePaidBarFill} ${paidPct < 50 ? styles.tilePaidBarFillLow : ''}`}
          style={{ width: `${paidPct}%` }}
        />
      </div>
      <div className={styles.tileMeta}>
        <span className={styles.tileMetaItem}>
          <Calendar size={11} strokeWidth={1.75} />
          {dateLabel}
        </span>
        <span className={styles.tileMetaItem}>
          <MapPin size={11} strokeWidth={1.75} />
          {addressLabel}
        </span>
      </div>
      <div className={styles.tileFoot}>
        <span>{order.staffName ?? '—'}</span>
        <span>{fmtTimeAgo(order.placedAt)}</span>
      </div>
    </button>
  );
};

/* ─── Order Detail Drawer ─── */

const LANE_LABEL: Record<Lane, string> = {
  received: 'Place',
  proceed: 'Proceed',
  logistics: 'Logistics',
  ready: 'Ready',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};

const fmtAbsDate = (iso: string | null): string => {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-MY', { day: 'numeric', month: 'short', year: 'numeric' });
};

const OrderDetail = ({ order, onClose }: {
  order: MyOrderRow;
  onClose: () => void;
}) => {
  const queryClient = useQueryClient();
  const editable = order.lane === 'received';

  // Local edit state. Resync ONLY when switching orders, not on background
  // refetches of the same order — otherwise typing would get blown away.
  const [edited, setEdited] = useState<MyOrderRow>(order);
  useEffect(() => { setEdited(order); }, [order.id]);

  // Payment recorded this session (added on top of order.paid).
  const [paymentAdd, setPaymentAdd] = useState<string>('');
  const [slipSessionId, setSlipSessionId] = useState<string | null>(null);

  // Earliest delivery date = order placed_at + 30 days (production + logistics
  // window). Sales can't quote a date earlier than that — matches the
  // "As fast as possible" default in the Handover Target Date step.
  const minDeliveryDate = useMemo(() => {
    const placedAt = new Date(order.placedAt);
    placedAt.setDate(placedAt.getDate() + 30);
    placedAt.setHours(0, 0, 0, 0);
    const y = placedAt.getFullYear();
    const m = String(placedAt.getMonth() + 1).padStart(2, '0');
    const d = String(placedAt.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }, [order.placedAt]);

  // Cascading dropdowns (state → city → postcode) sourced from my_localities.
  const localities = useLocalities();
  const states = useMemo(() => {
    const set = new Set<string>();
    for (const l of localities.data ?? []) set.add(l.state);
    return Array.from(set).sort();
  }, [localities.data]);
  const cities = useMemo(() => {
    if (!edited.customerState) return [] as string[];
    const set = new Set<string>();
    for (const l of localities.data ?? []) {
      if (l.state === edited.customerState) set.add(l.city);
    }
    return Array.from(set).sort();
  }, [localities.data, edited.customerState]);
  const postcodes = useMemo(() => {
    if (!edited.customerState || !edited.customerCity) return [] as string[];
    const set = new Set<string>();
    for (const l of localities.data ?? []) {
      if (l.state === edited.customerState && l.city === edited.customerCity) set.add(l.postcode);
    }
    return Array.from(set).sort();
  }, [localities.data, edited.customerState, edited.customerCity]);

  const set = <K extends keyof MyOrderRow>(k: K, v: MyOrderRow[K]) =>
    setEdited((prev) => ({ ...prev, [k]: v }));

  const additionalPaid = Math.max(0, Number(paymentAdd) || 0);
  const effectivePaid = Math.min(order.total, edited.paid + additionalPaid);
  const paidPct = order.total > 0 ? Math.min(100, Math.round((effectivePaid / order.total) * 100)) : 0;

  const customerInfoOk = !!(edited.customerName.trim() && edited.customerEmail?.trim());
  const addressOk = !!(edited.customerAddress?.trim() && edited.customerPostcode?.trim());
  const dateOk = !!edited.deliveryDate;
  const paidOk = order.total > 0 && effectivePaid / order.total >= 0.5;
  // When recording additional payment, slip upload is required as proof.
  const slipOk = additionalPaid === 0 || slipSessionId !== null;
  const allOk = customerInfoOk && addressOk && paidOk && slipOk;

  // Dirty check: any of the editable string fields changed, or payment recorded
  const dirty =
    edited.customerName !== order.customerName ||
    edited.customerPhone !== order.customerPhone ||
    edited.customerEmail !== order.customerEmail ||
    edited.customerAddress !== order.customerAddress ||
    edited.customerAddressLine2 !== order.customerAddressLine2 ||
    edited.customerPostcode !== order.customerPostcode ||
    edited.customerCity !== order.customerCity ||
    edited.customerState !== order.customerState ||
    edited.deliveryDate !== order.deliveryDate ||
    edited.approvalCode !== order.approvalCode ||
    additionalPaid > 0 ||
    slipSessionId !== null;

  const buildPatch = (extra: Record<string, unknown> = {}) => {
    const patch: Record<string, unknown> = {
      customer_name: edited.customerName.trim() || null,
      customer_phone: edited.customerPhone?.trim() || null,
      customer_email: edited.customerEmail?.trim() || null,
      customer_address: edited.customerAddress?.trim() || null,
      customer_address_line2: edited.customerAddressLine2?.trim() || null,
      customer_postcode: edited.customerPostcode?.trim() || null,
      customer_city: edited.customerCity?.trim() || null,
      customer_state: edited.customerState?.trim() || null,
      delivery_date: edited.deliveryDate || null,
      approval_code: edited.approvalCode?.trim() || null,
      paid: effectivePaid,
      ...extra,
    };
    return patch;
  };

  const saveMutation = useMutation({
    mutationFn: async (extra: Record<string, unknown>) => {
      const patch = buildPatch(extra);
      // If user uploaded a slip with the top-up, store its r2_key on the order
      // and promote the pending row (mirrors create_order_with_items pattern).
      if (slipSessionId) {
        const { data: session } = await supabase
          .from('pending_slip_uploads')
          .select('r2_key')
          .eq('id', slipSessionId)
          .maybeSingle();
        if (session?.r2_key) {
          patch.slip_key = session.r2_key;
          patch.slip_state = 'pending';
        }
        await supabase
          .from('pending_slip_uploads')
          .update({ status: 'promoted', promoted_at: new Date().toISOString(), promoted_to_order_id: order.id })
          .eq('id', slipSessionId);
      }
      const { error } = await supabase.from('orders').update(patch).eq('id', order.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setPaymentAdd('');
      setSlipSessionId(null);
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
    },
  });

  const onSave = () => saveMutation.mutate({});
  const onProceed = () => {
    if (!allOk) return;
    saveMutation.mutate({ lane: 'proceed' }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['my-orders'] });
        onClose();
      },
    });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [onClose]);

  return (
    <div className={styles.detailOverlay} onClick={onClose}>
      <aside className={styles.detail} onClick={(e) => e.stopPropagation()}>
        <header className={styles.detailHead}>
          <div>
            <div className={styles.detailEyebrow}>Order · {LANE_LABEL[order.lane]}</div>
            <h2 className={styles.detailTitle}>{order.id}</h2>
            <div className={styles.detailSub}>
              {order.customerName} · placed {fmtTimeAgo(order.placedAt)} by {order.staffName ?? '—'}
            </div>
          </div>
          <IconButton
            icon={<X size={18} strokeWidth={1.75} />}
            aria-label="Close"
            onClick={onClose}
          />
        </header>

        <div className={styles.detailBody}>
          <section className={styles.detailSection}>
            <h4 className={styles.detailSectionTitle}>
              Items <span className={styles.detailSectionMeta}>{order.pieces} {order.pieces === 1 ? 'piece' : 'pieces'}</span>
            </h4>
            <div className={styles.detailItems}>
              {order.items.map((it, i) => (
                <div key={i} className={styles.detailItem}>
                  <div
                    className={styles.detailItemPhoto}
                    style={it.productImage ? { backgroundImage: `url(${it.productImage})` } : undefined}
                  >
                    {!it.productImage && <Package size={16} strokeWidth={1.5} />}
                  </div>
                  <div className={styles.detailItemBody}>
                    <div className={styles.detailItemName}>{it.productName ?? 'Product'}</div>
                  </div>
                  <div className={styles.detailItemQty}>×{it.qty}</div>
                  <div className={styles.detailItemPrice}>
                    <span className={styles.detailItemPriceUnit}>RM</span>{fmtMoney(it.lineTotal)}
                  </div>
                </div>
              ))}
            </div>
            <div className={styles.detailTotalsRow}>
              <span>Subtotal</span>
              <span><span className={styles.detailItemPriceUnit}>RM</span>{fmtMoney(order.subtotal)}</span>
            </div>
            {order.addonTotal > 0 && (
              <div className={styles.detailTotalsRow}>
                <span>Add-ons</span>
                <span><span className={styles.detailItemPriceUnit}>RM</span>{fmtMoney(order.addonTotal)}</span>
              </div>
            )}
            <div className={`${styles.detailTotalsRow} ${styles.detailTotalsRowGrand}`}>
              <span>Total</span>
              <span><span className={styles.detailItemPriceUnit}>RM</span>{fmtMoney(order.total)}</span>
            </div>
          </section>

          <section className={styles.detailSection}>
            <h4 className={styles.detailSectionTitle}>
              Customer
              <span className={`${styles.detailTick} ${customerInfoOk ? styles.detailTickOk : ''}`}>
                {customerInfoOk ? 'Complete' : 'Incomplete'}
              </span>
            </h4>
            <div className={styles.detailFieldGrid}>
              <DetailField label="Full name *" disabled={!editable}>
                <input
                  type="text"
                  value={edited.customerName}
                  onChange={(e) => set('customerName', e.target.value)}
                  disabled={!editable}
                  placeholder="Customer's full name"
                />
              </DetailField>
              <DetailField label="Phone" disabled={!editable}>
                <input
                  type="tel"
                  value={edited.customerPhone ?? ''}
                  onChange={(e) => set('customerPhone', e.target.value)}
                  disabled={!editable}
                  placeholder="+60 12 345 6789"
                />
              </DetailField>
              <DetailField label="Email *" span={2} disabled={!editable}>
                <input
                  type="email"
                  value={edited.customerEmail ?? ''}
                  onChange={(e) => set('customerEmail', e.target.value)}
                  disabled={!editable}
                  placeholder="customer@example.com"
                />
              </DetailField>
            </div>
          </section>

          <section className={styles.detailSection}>
            <h4 className={styles.detailSectionTitle}>
              Delivery
              <span className={`${styles.detailTick} ${addressOk ? styles.detailTickOk : ''}`}>
                {addressOk ? 'Set' : 'Missing'}
              </span>
            </h4>
            <div className={styles.detailFieldGrid}>
              <DetailField label="Address line 1 *" span={2} disabled={!editable}>
                <input
                  type="text"
                  value={edited.customerAddress ?? ''}
                  onChange={(e) => set('customerAddress', e.target.value)}
                  disabled={!editable}
                  placeholder="Unit, street, area"
                />
              </DetailField>
              <DetailField label="Address line 2" span={2} disabled={!editable}>
                <input
                  type="text"
                  value={edited.customerAddressLine2 ?? ''}
                  onChange={(e) => set('customerAddressLine2', e.target.value)}
                  disabled={!editable}
                  placeholder="Apt, floor, building (optional)"
                />
              </DetailField>
              <DetailField label="State *" disabled={!editable}>
                <select
                  value={edited.customerState ?? ''}
                  onChange={(e) => {
                    setEdited((p) => ({
                      ...p,
                      customerState: e.target.value || null,
                      customerCity: null,
                      customerPostcode: null,
                    }));
                  }}
                  disabled={!editable}
                >
                  <option value="">Select state…</option>
                  {states.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </DetailField>
              <DetailField label="City *" disabled={!editable || !edited.customerState}>
                <select
                  value={edited.customerCity ?? ''}
                  onChange={(e) => {
                    setEdited((p) => ({
                      ...p,
                      customerCity: e.target.value || null,
                      customerPostcode: null,
                    }));
                  }}
                  disabled={!editable || !edited.customerState}
                >
                  <option value="">{edited.customerState ? 'Select city…' : 'Pick state first'}</option>
                  {cities.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </DetailField>
              <DetailField label="Postcode *" disabled={!editable || !edited.customerCity}>
                <select
                  value={edited.customerPostcode ?? ''}
                  onChange={(e) => set('customerPostcode', e.target.value || null)}
                  disabled={!editable || !edited.customerCity}
                >
                  <option value="">
                    {!edited.customerState ? 'Pick state first'
                      : !edited.customerCity ? 'Pick city first'
                      : 'Select postcode…'}
                  </option>
                  {postcodes.map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </DetailField>
              <DetailField label="Delivery date" disabled={!editable}>
                <input
                  type="date"
                  value={edited.deliveryDate ?? ''}
                  onChange={(e) => set('deliveryDate', e.target.value || null)}
                  disabled={!editable}
                  min={minDeliveryDate}
                />
              </DetailField>
            </div>
          </section>

          <section className={styles.detailSection}>
            <h4 className={styles.detailSectionTitle}>
              Payment
              <span className={`${styles.detailTick} ${paidOk ? styles.detailTickOk : ''}`}>
                {paidOk ? '≥ 50% paid' : 'Below 50%'}
              </span>
            </h4>
            <div className={styles.detailKV}><span>Method</span><span>{order.paymentMethod ?? 'Pending'}</span></div>
            <div className={styles.detailKV}>
              <span>Paid so far</span>
              <span>
                <span className={styles.detailItemPriceUnit}>RM</span>{fmtMoney(effectivePaid)}
                {' '}<em>/ {fmtMoney(order.total)}</em>
              </span>
            </div>
            <div className={styles.detailPayBar}>
              <div
                className={`${styles.detailPayBarFill} ${paidPct < 50 ? styles.tilePaidBarFillLow : ''}`}
                style={{ width: `${paidPct}%` }}
              />
            </div>
            <div className={styles.detailPayLegend}>
              <span>{paidPct}% collected</span>
              <span>Threshold · 50%</span>
            </div>
            {editable && (
              <>
                <div className={styles.detailFieldGrid} style={{ marginTop: 12 }}>
                  <DetailField label="Record additional payment (RM)" disabled={false}>
                    <input
                      type="number"
                      min={0}
                      max={order.total - order.paid}
                      value={paymentAdd}
                      onChange={(e) => setPaymentAdd(e.target.value)}
                      placeholder="0"
                    />
                  </DetailField>
                  <DetailField label="Approval code" disabled={false}>
                    <input
                      type="text"
                      value={edited.approvalCode ?? ''}
                      onChange={(e) => set('approvalCode', e.target.value)}
                      placeholder="POS terminal ref"
                    />
                  </DetailField>
                </div>

                {additionalPaid > 0 && (
                  <div className={styles.detailSlipWrap}>
                    <div className={styles.detailFieldLabel}>
                      Payment slip <span className={styles.detailRequired}>*</span>
                    </div>
                    <SlipUploadStep
                      onConfirmed={(id) => setSlipSessionId(id)}
                      onCleared={() => setSlipSessionId(null)}
                    />
                  </div>
                )}
              </>
            )}
          </section>

          {order.notes && (
            <section className={styles.detailSection}>
              <h4 className={styles.detailSectionTitle}>Notes</h4>
              <p className={styles.detailNotes}>{order.notes}</p>
            </section>
          )}
        </div>

        <footer className={styles.detailFoot}>
          {order.lane !== 'delivered' && order.lane !== 'cancelled' && (
            <div className={styles.detailFootActions}>
              <a
                href={`/print/sales-order/${order.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className={styles.detailPrintBtn}
              >
                <Printer size={14} strokeWidth={1.75} />
                Generate Sales Order
              </a>
            </div>
          )}
          {editable && (
            <>
              <div className={styles.detailChecklist}>
                <ChecklistItem ok={customerInfoOk} label="Customer info" />
                <ChecklistItem ok={addressOk} label="Delivery address" />
                <ChecklistItem ok={dateOk} label="Delivery date" />
                <ChecklistItem ok={paidOk} label="≥ 50% paid" />
              </div>
              {saveMutation.error && (
                <p className={styles.detailFootError}>
                  Save failed: {String((saveMutation.error as Error).message)}
                </p>
              )}
              <div className={styles.detailCta}>
                <button
                  type="button"
                  className={styles.detailSaveBtn}
                  onClick={onSave}
                  disabled={!dirty || saveMutation.isPending}
                >
                  <Save size={14} strokeWidth={1.75} />
                  {saveMutation.isPending ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  className={styles.detailProceedBtn}
                  onClick={onProceed}
                  disabled={!allOk || saveMutation.isPending}
                >
                  Move to Proceed
                  <ArrowRight size={14} strokeWidth={1.75} />
                </button>
              </div>
            </>
          )}
          {!editable && (
            <span className={styles.detailFootInfo}>
              {order.lane === 'delivered' ? 'Delivered · managed in backend' : 'Locked · coordinator handling'}
            </span>
          )}
        </footer>
      </aside>
    </div>
  );
};

/* ─── Footer checklist item ─── */

const ChecklistItem = ({ ok, label }: { ok: boolean; label: string }) => (
  <span className={`${styles.detailCheck} ${ok ? styles.detailCheckOk : ''}`}>
    {ok
      ? <Check size={14} strokeWidth={2.25} />
      : <Circle size={14} strokeWidth={1.75} />}
    {label}
  </span>
);

/* ─── Editable field primitive ─── */

const DetailField = ({ label, span, disabled, children }: {
  label: string;
  span?: number;
  disabled: boolean;
  children: React.ReactNode;
}) => (
  <label
    className={`${styles.detailField} ${disabled ? styles.detailFieldDisabled : ''}`}
    style={span === 2 ? { gridColumn: 'span 2' } : undefined}
  >
    <span className={styles.detailFieldLabel}>{label}</span>
    {children}
  </label>
);
