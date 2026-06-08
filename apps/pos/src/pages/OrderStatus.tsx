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
  FileText,
  Search,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { IconButton } from '@2990s/design-system';
import { groupSoLinesForDisplay } from '@2990s/shared/so-line-display';
import { PAYMENT_METHOD_CODES } from '@2990s/shared/payment-methods';
import { useAuth } from '../lib/auth';
import { supabase } from '../lib/supabase';
import { Topbar } from '../components/Topbar';
import { CountryPhoneInput } from '../components/CountryPhoneInput';
import { SlipUploadStep } from '../components/SlipUploadStep';
import {
  MERCHANT_FALLBACK,
  INSTALLMENT_FALLBACK,
  parseTermMonths,
} from '../components/handover/AddonsPaymentStep';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useLocalities, useSalesStats } from '../lib/queries';
import {
  usePaymentMethodLabels,
  useSoDropdownValues,
} from '../lib/so-maintenance/so-dropdown-options-queries';
import { useStaff } from '../lib/staff';
import styles from './OrderStatus.module.css';

const PIN_LEN = 6;
// Scoped by user.id so a fresh login on the same tablet re-prompts for PIN
// instead of inheriting the previous user's unlocked state.
const SESSION_KEY_PREFIX = 'pos-orders-unlocked-v2:';
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

// mfg_so_status enum. The 3-column board buckets these (see LANES).
// ON_HOLD / CANCELLED are excluded server-side, so the board never sees them.
type SoStatus =
  | 'CONFIRMED'
  | 'IN_PRODUCTION'
  | 'READY_TO_SHIP'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'INVOICED'
  | 'CLOSED'
  | 'ON_HOLD'
  | 'CANCELLED';

interface OrderItem {
  qty: number;
  lineTotal: number;
  productName: string | null;
  productImage: string | null;
  remark: string | null;
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
  status: SoStatus;
  proceededAt: string | null;
  deliveryDate: string | null;
  processingDate: string | null;
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

// Shape of one Sales Order row from GET /mfg-sales-orders/mine.
interface MineSoRow {
  doc_no: string;
  debtor_name: string | null;
  phone: string | null;
  email: string | null;
  address1: string | null;
  address2: string | null;
  city: string | null;
  postcode: string | null;
  customer_state: string | null;
  customer_delivery_date: string | null;
  internal_expected_dd: string | null;
  status: SoStatus;
  payment_method: string | null;
  approval_code: string | null;
  note: string | null;
  so_date: string | null;
  created_at: string;
  proceeded_at: string | null;
  total_revenue_centi: number | null;
  line_count: number | null;
  paid_centi_total: number | null;
  items: Array<{
    item_code: string;
    description: string | null;
    qty: number | null;
    total_centi: number | null;
    variants: unknown;
    remark?: string | null;
  }> | null;
}

/* ─── Period model (My-orders toolbar) ───────────────────────────────────
   The board + the two KPI cards display ONE selected period — either a whole
   calendar month (◀ June 2026 ▶) or a from–to date range. Search is separate:
   a non-empty search query ignores the period and looks across all dates. */
type Period =
  | { mode: 'month'; year: number; month0: number }
  | { mode: 'range'; from: string; to: string }; // YYYY-MM-DD ('' = open)

const pad2 = (n: number) => String(n).padStart(2, '0');

/** Current MY calendar month (live on today's date, Asia/Kuala_Lumpur ≈ UTC+8). */
const currentMonthPeriod = (): Period => {
  const nowMy = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return { mode: 'month', year: nowMy.getUTCFullYear(), month0: nowMy.getUTCMonth() };
};

/** Period → MY-local YYYY-MM-DD window (`to` inclusive) the API expects. */
const periodToWindow = (p: Period): { from: string | null; to: string | null } => {
  if (p.mode === 'range') return { from: p.from || null, to: p.to || null };
  const lastDay = new Date(Date.UTC(p.year, p.month0 + 1, 0)).getUTCDate();
  return {
    from: `${p.year}-${pad2(p.month0 + 1)}-01`,
    to: `${p.year}-${pad2(p.month0 + 1)}-${pad2(lastDay)}`,
  };
};

/** Stable cache-key fragment for a period. */
const periodKey = (p: Period): string =>
  p.mode === 'month' ? `m:${p.year}-${p.month0}` : `r:${p.from}_${p.to}`;

const monthName = (year: number, month0: number): string =>
  new Intl.DateTimeFormat('en-MY', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, month0, 1)));

const useMyOrders = (period: Period, search: string) =>
  useQuery({
    // Search ignores the period (global lookup); otherwise key by the period so
    // each month / range caches on its own.
    queryKey: ['my-orders', search.trim() ? `q:${search.trim()}` : `p:${periodKey(period)}`],
    // Reads the salesperson's own Backend Sales Orders via the API (the board
    // is unified onto mfg_sales_orders; the legacy retail `orders` table is no
    // longer used here). salesperson_id filtering + CANCELLED/ON_HOLD exclusion
    // happen server-side in GET /mfg-sales-orders/mine.
    queryFn: async (): Promise<MyOrderRow[]> => {
      if (!API_URL) throw new Error('VITE_API_URL is not set');
      const session = await supabase.auth.getSession();
      const token = session.data.session?.access_token;
      if (!token) throw new Error('not_authenticated');
      const params = new URLSearchParams();
      const q = search.trim();
      if (q) {
        params.set('q', q);
      } else {
        const { from, to } = periodToWindow(period);
        if (from) params.set('from', from);
        if (to) params.set('to', to);
      }
      const qs = params.toString();
      const res = await fetch(`${API_URL}/mfg-sales-orders/mine${qs ? `?${qs}` : ''}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`GET /mfg-sales-orders/mine failed (${res.status})`);
      const body = (await res.json()) as { salesOrders: MineSoRow[] };
      return (body.salesOrders ?? []).map((r): MyOrderRow => {
        /* Loo 2026-06-05 — fold per-module sofa SKU lines (variants.buildKey
           groups from the P3 split) into ONE Model row with the combined
           price, matching the customer-facing SO print. Lines without a
           buildKey (legacy SOs, services, bedframes…) pass through 1:1. */
        const items: OrderItem[] = groupSoLinesForDisplay(r.items ?? []).map((g) =>
          g.kind === 'sofa-build' && g.display
            ? {
                qty: g.display.qty,
                lineTotal: Math.round(g.display.totalCenti / 100),
                productName: g.display.description,
                productImage: null,
                remark: g.display.remark,
              }
            : {
                qty: g.lines[0]!.qty ?? 0,
                lineTotal: Math.round((g.lines[0]!.total_centi ?? 0) / 100),
                productName: g.lines[0]!.description ?? g.lines[0]!.item_code,
                productImage: null,
                remark: g.lines[0]!.remark ?? null,
              },
        );
        const total = Math.round((r.total_revenue_centi ?? 0) / 100);
        return {
          id: r.doc_no,
          placedAt: r.created_at,
          customerName: r.debtor_name ?? '',
          customerPhone: r.phone ?? null,
          customerEmail: r.email ?? null,
          customerCity: r.city ?? null,
          customerAddress: r.address1 ?? null,
          customerAddressLine2: r.address2 ?? null,
          customerPostcode: r.postcode ?? null,
          customerState: r.customer_state ?? null,
          // No separate subtotal on the SO — the total stands in for it; add-ons
          // ride inside the line totals so there's no separate add-on bucket.
          subtotal: total,
          addonTotal: 0,
          total,
          paid: Math.round((r.paid_centi_total ?? 0) / 100),
          status: r.status,
          proceededAt: r.proceeded_at ?? null,
          deliveryDate: r.customer_delivery_date ?? null,
          processingDate: r.internal_expected_dd ?? null,
          deliverySlot: null,
          paymentMethod: r.payment_method ?? null,
          approvalCode: r.approval_code ?? null,
          notes: r.note ?? null,
          // The salesperson is the viewer — no per-order staff badge needed.
          staffName: null,
          staffInitials: null,
          pieces: r.line_count ?? items.reduce((s, it) => s + it.qty, 0),
          firstImage: null,
          items,
        };
      });
    },
    staleTime: 10_000,
    // Fallback to a poll if Supabase Realtime is blocked on the tablet network.
    refetchInterval: 30_000,
  });

// Realtime invalidate on mfg_sales_orders edits so the board refetches within
// ~300ms (mirrors useCatalogRealtime in lib/queries.ts). Mounted in OrderBoard.
const useMyOrdersRealtime = () => {
  const qc = useQueryClient();
  useEffect(() => {
    const channel = supabase
      .channel('my-orders-so')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'mfg_sales_orders' },
        () => {
          void qc.invalidateQueries({ queryKey: ['my-orders'] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [qc]);
};

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
  matches: SoStatus[];
}

const LANES: ReadonlyArray<LaneDef> = [
  {
    id: 'place',
    num: '01',
    title: 'Order placed',
    sub: 'Just placed · may need detail tweaks',
    Icon: Inbox,
    matches: ['CONFIRMED'],
  },
  {
    id: 'proceed',
    num: '02',
    title: 'Proceed',
    sub: 'Locked · coordinator handling',
    Icon: Send,
    matches: ['IN_PRODUCTION', 'READY_TO_SHIP', 'SHIPPED'],
  },
  {
    id: 'delivered',
    num: '03',
    title: 'Delivered',
    sub: 'Closed · signed off',
    Icon: CheckCircle2,
    matches: ['DELIVERED', 'INVOICED', 'CLOSED'],
  },
];

/* Lane bucketing — "Proceed" is a SALES marker driven by proceeded_at, NOT a
   production status (Owner 2026-06-03). A CONFIRMED order moves Place→Proceed
   the moment the salesperson marks it proceeded; the backend status stays
   CONFIRMED (the coordinator drives the real production status from the SO
   detail). Any production status the backend itself sets still buckets under
   Proceed; terminal statuses bucket under Delivered. */
const laneIdFor = (o: MyOrderRow): LaneDef['id'] => {
  if (LANES[2]?.matches.includes(o.status)) return 'delivered';
  if (o.status === 'CONFIRMED') return o.proceededAt ? 'proceed' : 'place';
  return 'proceed';
};

/* ─── Toolbar: search (left) + period picker (right) ─── */

const OrderToolbar = ({
  period,
  setPeriod,
  query,
  setQuery,
}: {
  period: Period;
  setPeriod: (p: Period) => void;
  query: string;
  setQuery: (q: string) => void;
}) => {
  // Live MY month — can't browse into the future, so clamp the stepper here.
  const nowMy = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const curYear = nowMy.getUTCFullYear();
  const curMonth0 = nowMy.getUTCMonth();
  const atCurrentMonth =
    period.mode === 'month' &&
    period.year === curYear &&
    period.month0 === curMonth0;
  const isDefault = atCurrentMonth;

  const stepMonth = (delta: number) => {
    if (period.mode !== 'month') return;
    const d = new Date(Date.UTC(period.year, period.month0 + delta, 1));
    setPeriod({ mode: 'month', year: d.getUTCFullYear(), month0: d.getUTCMonth() });
  };

  const toMonth = () =>
    setPeriod(period.mode === 'month' ? period : currentMonthPeriod());
  const toRange = () => {
    if (period.mode === 'range') return;
    const w = periodToWindow(period);
    setPeriod({ mode: 'range', from: w.from ?? '', to: w.to ?? '' });
  };

  return (
    <section className={styles.toolbar} aria-label="Search and period filter">
      <div className={styles.searchBox}>
        <Search size={18} strokeWidth={1.75} />
        <input
          type="search"
          className={styles.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search SO no., customer or phone"
          aria-label="Search orders"
        />
        {query && (
          <button
            type="button"
            className={styles.searchClear}
            onClick={() => setQuery('')}
            aria-label="Clear search"
          >
            <X size={16} strokeWidth={1.75} />
          </button>
        )}
      </div>

      <div className={styles.periodCtl}>
        <div className={styles.modeToggle} role="tablist" aria-label="Period mode">
          <button
            type="button"
            role="tab"
            aria-selected={period.mode === 'month'}
            data-active={period.mode === 'month'}
            onClick={toMonth}
          >
            Month
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={period.mode === 'range'}
            data-active={period.mode === 'range'}
            onClick={toRange}
          >
            Range
          </button>
        </div>

        {period.mode === 'month' ? (
          <div className={styles.monthStepper}>
            <button
              type="button"
              onClick={() => stepMonth(-1)}
              aria-label="Previous month"
            >
              <ChevronLeft size={18} strokeWidth={1.75} />
            </button>
            <span className={styles.monthLabel}>
              {monthName(period.year, period.month0)}
            </span>
            <button
              type="button"
              onClick={() => stepMonth(1)}
              disabled={atCurrentMonth}
              aria-label="Next month"
            >
              <ChevronRight size={18} strokeWidth={1.75} />
            </button>
          </div>
        ) : (
          <div className={styles.rangeInputs}>
            <input
              type="date"
              className={styles.dateInput}
              value={period.from}
              max={period.to || undefined}
              onChange={(e) => setPeriod({ ...period, from: e.target.value })}
              aria-label="From date"
            />
            <span className={styles.rangeDash}>–</span>
            <input
              type="date"
              className={styles.dateInput}
              value={period.to}
              min={period.from || undefined}
              onChange={(e) => setPeriod({ ...period, to: e.target.value })}
              aria-label="To date"
            />
          </div>
        )}

        {!isDefault && (
          <button
            type="button"
            className={styles.resetLink}
            onClick={() => setPeriod(currentMonthPeriod())}
          >
            This month
          </button>
        )}
      </div>
    </section>
  );
};

const OrderBoard = ({ sessionKey }: { sessionKey: string | null }) => {
  const [period, setPeriod] = useState<Period>(currentMonthPeriod);
  const [query, setQuery] = useState('');
  // Debounce the search box so we don't refetch on every keystroke.
  const [debouncedQuery, setDebouncedQuery] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 300);
    return () => clearTimeout(t);
  }, [query]);
  const searching = debouncedQuery.trim().length > 0;

  const orders = useMyOrders(period, debouncedQuery);
  const stats = useSalesStats(periodToWindow(period));
  const staff = useStaff();
  useMyOrdersRealtime();
  const list = orders.data ?? [];
  const [active, setActive] = useState<MyOrderRow | null>(null);

  const staffName = staff.data?.name ?? stats.data?.staffName ?? 'Sales';
  const periodLabel =
    period.mode === 'month'
      ? monthName(period.year, period.month0)
      : stats.data?.monthLabel ?? 'the selected dates';

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
      map[laneIdFor(o)].push(o);
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

      <OrderToolbar
        period={period}
        setPeriod={setPeriod}
        query={query}
        setQuery={setQuery}
      />

      {searching && (
        <p className={styles.searchHint}>
          Showing search results across all dates.
        </p>
      )}

      {orders.isLoading ? (
        <p className={styles.empty}>Loading…</p>
      ) : orders.error ? (
        <p className={styles.empty}>Failed to load: {String(orders.error)}</p>
      ) : list.length === 0 ? (
        <div className={styles.empty}>
          {searching ? (
            <p>No orders match “{debouncedQuery.trim()}”.</p>
          ) : (
            <p>No orders in {periodLabel}.</p>
          )}
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

const LANE_LABEL: Record<SoStatus, string> = {
  CONFIRMED: 'Order placed',
  IN_PRODUCTION: 'In production',
  READY_TO_SHIP: 'Ready to ship',
  SHIPPED: 'Shipped',
  DELIVERED: 'Delivered',
  INVOICED: 'Invoiced',
  CLOSED: 'Closed',
  ON_HOLD: 'On hold',
  CANCELLED: 'Cancelled',
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
  const { user } = useAuth();
  const editable = order.status === 'CONFIRMED' && !order.proceededAt;

  // Local edit state. Resync ONLY when switching orders, not on background
  // refetches of the same order — otherwise typing would get blown away.
  const [edited, setEdited] = useState<MyOrderRow>(() => ({ ...order, approvalCode: null }));
  /* Resync on order switch. approvalCode is blanked every time: it is NOT a
     header field (absent from `dirty` + buildPatch) — it only feeds the NEXT
     payment's approval code. Seeding it from order.approval_code made a new
     payment silently inherit the PREVIOUS payment's terminal ref (Loo
     2026-06-09); the post-record onSuccess clears it for the same reason. */
  useEffect(() => { setEdited({ ...order, approvalCode: null }); }, [order.id]);

  // Payment recorded this session (added on top of order.paid).
  const [paymentAdd, setPaymentAdd] = useState<string>('');

  /* Loo 2026-06-09 — default the amount to the OUTSTANDING balance so the
     operator can just confirm a full balance payment instead of typing it.
     Resyncs when switching orders and after the board refetches a new paid
     total (e.g. just after recording a payment → prefills the new remainder;
     zero balance → blank). Keyed on paid/total so a same-order background
     refetch with no money change can't blow away a custom amount mid-type. */
  useEffect(() => {
    const outstanding = Math.max(0, order.total - order.paid);
    setPaymentAdd(outstanding > 0 ? String(outstanding) : '');
  }, [order.id, order.total, order.paid]);

  // "Paid so far" = the order's recorded paid total from /mine (handover
  // deposit + any ledger payments). After recording a payment we invalidate
  // ['my-orders']; the board refetches and syncs the open drawer's order, so
  // this reflects the new total without a separate ledger fetch here.
  const paidSoFar = order.paid;

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

  // Processing Date floor = today (Malaysia, UTC+8) — mirrors the API's
  // processing_date_past guard, which rejects a NEW past Processing Date.
  const todayMY = useMemo(() => {
    return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
  }, []);

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
  /* Progress reflects the RECORDED ledger total only (paidSoFar). We no longer
     fold the typed amount into the bar: the amount field now autofills the
     outstanding balance (Loo 2026-06-09), so an optimistic preview would always
     read 100% before anything is recorded — and disagree with the order card. */
  const paidPct = order.total > 0 ? Math.min(100, Math.round((paidSoFar / order.total) * 100)) : 0;

  const customerInfoOk = !!(edited.customerName.trim() && edited.customerEmail?.trim());
  const addressOk = !!(edited.customerAddress?.trim() && edited.customerPostcode?.trim());
  const dateOk = !!edited.deliveryDate;
  // Gate on the live ledger (paidSoFar), the recorded source of truth.
  const paidOk = order.total > 0 && paidSoFar / order.total >= 0.5;
  const allOk = customerInfoOk && addressOk && dateOk && paidOk;

  // Dirty check: any of the editable header fields changed. (Payment is now
  // recorded via its own action against the SO ledger, not folded into Save.)
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
    edited.processingDate !== order.processingDate;

  // SO header PATCH body — camelCase keys per the API contract.
  const buildPatch = (): Record<string, unknown> => {
    const patch: Record<string, unknown> = {
      debtorName: edited.customerName.trim() || null,
      phone: edited.customerPhone?.trim() || null,
      email: edited.customerEmail?.trim() || null,
      address1: edited.customerAddress?.trim() || null,
      address2: edited.customerAddressLine2?.trim() || null,
      city: edited.customerCity?.trim() || null,
      postcode: edited.customerPostcode?.trim() || null,
      customerState: edited.customerState?.trim() || null,
    };
    // Only send a date when it actually changed — re-sending an unchanged PAST
    // value would trip the API's delivery_date_past / processing_date_past guard
    // (it grandfathers an unchanged elapsed date only if we don't re-send it).
    // The Processing Date also triggers the backend's variant-completeness and
    // Processing ≤ Delivery checks, surfaced via the Save error line.
    if (edited.deliveryDate !== order.deliveryDate) {
      patch.customerDeliveryDate = edited.deliveryDate || null;
    }
    if (edited.processingDate !== order.processingDate) {
      patch.internalExpectedDd = edited.processingDate || null;
    }
    return patch;
  };

  const authedFetch = async (path: string, init: RequestInit) => {
    if (!API_URL) throw new Error('VITE_API_URL is not set');
    const session = await supabase.auth.getSession();
    const token = session.data.session?.access_token;
    if (!token) throw new Error('not_authenticated');
    const res = await fetch(`${API_URL}${path}`, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!res.ok) {
      let detail = '';
      try { detail = JSON.stringify(await res.json()); } catch { detail = await res.text().catch(() => ''); }
      throw new Error(`${init.method ?? 'GET'} ${path} failed (${res.status})${detail ? `: ${detail}` : ''}`);
    }
    return res;
  };

  /* Record-payment full set (spec 2026-06-06 D4/D6) — method cascade synced
     with SO Maintenance (same hooks as the handover), per-payment slip,
     ledger history. */
  const methodLabels = usePaymentMethodLabels() as Record<string, string>;
  const merchants = useSoDropdownValues('payment_merchant', MERCHANT_FALLBACK);
  const onlineTypes = useSoDropdownValues('online_type', []);
  const installmentPlans = useSoDropdownValues('installment_plan', INSTALLMENT_FALLBACK);
  const [payMethod, setPayMethod] = useState<'merchant' | 'transfer' | 'cash' | 'installment'>('cash');
  const [payMerchant, setPayMerchant] = useState('');
  const [payOnlineType, setPayOnlineType] = useState('');
  const [payInstallmentMonths, setPayInstallmentMonths] = useState<number | null>(null);
  const [paySlipSession, setPaySlipSession] = useState<string | null>(null);
  /* Slip uploader remount key — a recorded payment must reset the uploader
     to idle (its internal state is otherwise sticky). */
  const [slipResetKey, setSlipResetKey] = useState(0);
  const paymentsQ = useQuery({
    queryKey: ['so-payments', order.id],
    queryFn: async () => {
      const res = await authedFetch(`/mfg-sales-orders/${order.id}/payments`, { method: 'GET' });
      return ((await res.json()) as { payments: Array<{
        id: string; paid_at: string; method: string; approval_code: string | null;
        amount_centi: number; slip_key: string | null;
      }> }).payments;
    },
  });

  // Header edit → PATCH /mfg-sales-orders/:docNo.
  const saveMutation = useMutation({
    mutationFn: async () => {
      await authedFetch(`/mfg-sales-orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify(buildPatch()),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
    },
  });

  // Record payment → POST /mfg-sales-orders/:docNo/payments (SO ledger). Full
  // set (spec D4/D6): method cascade synced with SO Maintenance, a REQUIRED
  // slip per payment, approval code, server-side overpay guard.
  const paymentMutation = useMutation({
    mutationFn: async () => {
      const amount = additionalPaid;
      if (amount <= 0 || !paySlipSession) return;
      const today = new Date().toISOString().slice(0, 10);
      await authedFetch(`/mfg-sales-orders/${order.id}/payments`, {
        method: 'POST',
        body: JSON.stringify({
          paidAt: today,
          method: payMethod,
          amountCenti: Math.round(amount * 100),
          ...(payMethod === 'merchant' ? { merchantProvider: payMerchant || null } : {}),
          ...(payMethod === 'merchant' || payMethod === 'installment'
            ? { installmentMonths: payInstallmentMonths } : {}),
          ...(payMethod === 'transfer' ? { onlineType: payOnlineType || null } : {}),
          ...(edited.approvalCode?.trim() ? { approvalCode: edited.approvalCode.trim() } : {}),
          ...(user?.id ? { collectedBy: user.id } : {}),
          uploadSessionId: paySlipSession,
        }),
      });
    },
    onSuccess: () => {
      setPaymentAdd('');
      setPaySlipSession(null);
      setSlipResetKey((k) => k + 1);
      // Clear the approval code so the next payment can't silently reuse the
      // last terminal ref. Raw setter used intentionally — approvalCode is NOT
      // in the dirty expression, so this won't flip the Save button on.
      setEdited((prev) => ({ ...prev, approvalCode: null }));
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      queryClient.invalidateQueries({ queryKey: ['so-payments', order.id] });
    },
  });

  // Proceed = a SALES tracking marker, NOT a production hand-off. It (1) saves
  // the salesperson-entered info into the backend SO detail and (2) stamps
  // proceeded_at as the "done" marker. We deliberately do NOT change the
  // production status — it stays CONFIRMED; the backend coordinator drives the
  // real status from the SO detail. One PATCH carries both the header edits and
  // the proceeded_at stamp (the API stamps it once, never overwriting an earlier
  // value).
  const proceedMutation = useMutation({
    mutationFn: async () => {
      await authedFetch(`/mfg-sales-orders/${order.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ ...buildPatch(), proceededAt: new Date().toISOString() }),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['my-orders'] });
      onClose();
    },
  });

  const onSave = () => saveMutation.mutate();
  const onRecordPayment = () => { if (additionalPaid > 0 && paySlipSession !== null) paymentMutation.mutate(); };
  const onProceed = () => {
    if (!allOk) return;
    proceedMutation.mutate();
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
            <div className={styles.detailEyebrow}>Order · {order.status === 'CONFIRMED' && order.proceededAt ? 'Proceed' : LANE_LABEL[order.status]}</div>
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
                    {it.remark && <div className={styles.detailSectionMeta}>Remark: {it.remark}</div>}
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
                <CountryPhoneInput
                  value={edited.customerPhone ?? ''}
                  onChange={(next) => set('customerPhone', next)}
                  disabled={!editable}
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
              <DetailField label="Processing date" disabled={!editable}>
                <input
                  type="date"
                  value={edited.processingDate ?? ''}
                  onChange={(e) => set('processingDate', e.target.value || null)}
                  disabled={!editable}
                  min={todayMY}
                  max={edited.deliveryDate ?? undefined}
                />
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
                <span className={styles.detailItemPriceUnit}>RM</span>{fmtMoney(paidSoFar)}
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
            {(paymentsQ.data ?? []).length > 0 && (
              <div style={{ marginTop: 8 }}>
                {(paymentsQ.data ?? []).map((p) => (
                  <div key={p.id} className={styles.detailKV}>
                    <span>{p.paid_at} · {methodLabels[p.method] ?? p.method}</span>
                    <span>
                      <span className={styles.detailItemPriceUnit}>RM</span>
                      {fmtMoney(Math.round(p.amount_centi / 100))}
                      {p.approval_code ? <em> · {p.approval_code}</em> : null}
                    </span>
                  </div>
                ))}
                <div className={styles.detailPayLegend}>
                  <span>{(paymentsQ.data ?? []).length} payment{(paymentsQ.data ?? []).length > 1 ? 's' : ''} recorded</span>
                </div>
              </div>
            )}
            {editable && (
              <>
                <div className={styles.detailFieldGrid} style={{ marginTop: 12 }}>
                  <DetailField label="Method *" disabled={false}>
                    <select value={payMethod} onChange={(e) => {
                      const m = e.target.value as typeof payMethod;
                      setPayMethod(m);
                      if (m !== 'merchant') setPayMerchant('');
                      if (m !== 'merchant' && m !== 'installment') setPayInstallmentMonths(null);
                      if (m !== 'transfer') setPayOnlineType('');
                    }}>
                      {PAYMENT_METHOD_CODES.map((code) => (
                        <option key={code} value={code}>{methodLabels[code] ?? code}</option>
                      ))}
                    </select>
                  </DetailField>
                  {payMethod === 'merchant' && (
                    <DetailField label="Merchant *" disabled={false}>
                      <select value={payMerchant} onChange={(e) => setPayMerchant(e.target.value)}>
                        <option value="">Select…</option>
                        {merchants.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                    </DetailField>
                  )}
                  {payMethod === 'transfer' && (
                    <DetailField label="Online type" disabled={false}>
                      <select value={payOnlineType} onChange={(e) => setPayOnlineType(e.target.value)}>
                        <option value="">Select…</option>
                        {onlineTypes.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </DetailField>
                  )}
                  {(payMethod === 'merchant' || payMethod === 'installment') && (
                    <DetailField label="Installment term" disabled={false}>
                      <select
                        value={payInstallmentMonths ?? ''}
                        onChange={(e) => setPayInstallmentMonths(e.target.value ? Number(e.target.value) : null)}
                      >
                        <option value="">One-off</option>
                        {installmentPlans
                          .map((o) => parseTermMonths(o.value))
                          .filter((n): n is number => n !== null)
                          .map((t) => <option key={t} value={t}>{t} months</option>)}
                      </select>
                    </DetailField>
                  )}
                </div>
                <div className={styles.detailFieldGrid} style={{ marginTop: 12 }}>
                  <DetailField label="Record payment (RM)" disabled={false}>
                    <input
                      type="number"
                      min={0}
                      max={Math.max(0, order.total - paidSoFar)}
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
                <div style={{ marginTop: 8 }}>
                  <DetailField label="Payment slip / proof *" disabled={false}>
                    <SlipUploadStep
                      key={slipResetKey}
                      onConfirmed={(id) => setPaySlipSession(id)}
                      onCleared={() => setPaySlipSession(null)}
                    />
                  </DetailField>
                </div>

                {paymentMutation.error && (
                  <p className={styles.detailFootError}>
                    Payment failed: {String((paymentMutation.error as Error).message)}
                  </p>
                )}
                <div className={styles.detailCta}>
                  <button
                    type="button"
                    className={styles.detailSaveBtn}
                    onClick={onRecordPayment}
                    disabled={
                      additionalPaid <= 0
                      || paymentMutation.isPending
                      || paySlipSession === null
                      || !(edited.approvalCode ?? '').trim()
                      || (payMethod === 'merchant' && !payMerchant)
                      || (payMethod === 'installment' && payInstallmentMonths === null)
                    }
                  >
                    <Receipt size={14} strokeWidth={1.75} />
                    {paymentMutation.isPending ? 'Recording…' : 'Record payment'}
                  </button>
                </div>
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
          {/* Customer-facing Sales Order — always available (incl. locked /
              delivered orders) so the salesperson can pull it up to show or
              hand the customer a PDF. Reads the live mfg_sales_orders model. */}
          <div className={styles.detailFootActions}>
            <Link to={`/print/sales-order/${order.id}`} className={styles.detailPrintBtn}>
              <FileText size={14} strokeWidth={1.75} />
              View SO / PDF
            </Link>
          </div>
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
              {proceedMutation.error && (
                <p className={styles.detailFootError}>
                  Proceed failed: {String((proceedMutation.error as Error).message)}
                </p>
              )}
              <div className={styles.detailCta}>
                <button
                  type="button"
                  className={styles.detailSaveBtn}
                  onClick={onSave}
                  disabled={!dirty || saveMutation.isPending || proceedMutation.isPending}
                >
                  <Save size={14} strokeWidth={1.75} />
                  {saveMutation.isPending ? 'Saving…' : 'Save changes'}
                </button>
                <button
                  type="button"
                  className={styles.detailProceedBtn}
                  onClick={onProceed}
                  disabled={!allOk || saveMutation.isPending || proceedMutation.isPending}
                >
                  Move to Proceed
                  <ArrowRight size={14} strokeWidth={1.75} />
                </button>
              </div>
            </>
          )}
          {!editable && (
            <span className={styles.detailFootInfo}>
              {LANES[2]?.matches.includes(order.status)
                ? 'Delivered · managed in backend'
                : 'Locked · coordinator handling'}
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
