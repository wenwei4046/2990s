import { useMemo, useState } from 'react';
import {
  LayoutGrid,
  Search,
  ScanLine,
  Inbox,
  Send,
  Truck,
  PackageCheck,
  CheckCircle2,
  Forklift,
} from 'lucide-react';
import type { OrderListRow, OrderLane } from '../lib/queries';
import { OrderCard } from './OrderCard';
import styles from './OrdersBoard.module.css';

/* ─── Lane metadata for the board (mirrors LaneStepper but adds icon + sub) ─── */
interface LaneDef {
  id: Exclude<OrderLane, 'cancelled'>;
  num: string;
  title: string;
  sub: string;
  Icon: typeof Inbox;
  terminal?: boolean;
}

const LANES: ReadonlyArray<LaneDef> = [
  { id: 'received',   num: '01', title: 'Received',          sub: 'New from POS',          Icon: Inbox },
  { id: 'proceed',    num: '02', title: 'Proceed requested', sub: 'Slip + customer ready', Icon: Send },
  { id: 'logistics',  num: '03', title: 'Awaiting logistics', sub: 'PO & supplier coord',   Icon: Forklift },
  { id: 'ready',      num: '04', title: 'Ready to dispatch', sub: 'Goods in, scheduled',   Icon: PackageCheck },
  { id: 'dispatched', num: '05', title: 'Dispatched',        sub: 'Driver assigned, OTW',  Icon: Truck },
  { id: 'delivered',  num: '06', title: 'Delivered',         sub: 'Signed, complete',      Icon: CheckCircle2, terminal: true },
] as const;

type ViewState = 'overall' | LaneDef['id'];
type FilterTab = 'all' | 'late' | 'today';

interface Props {
  orders: ReadonlyArray<OrderListRow>;
  onOpenOrder: (id: string) => void;
  onOpenScanPo: () => void;
  highlightId?: string | null;
  isFetching?: boolean;
  onRefresh?: () => void;
}

export function OrdersBoard({
  orders,
  onOpenOrder,
  onOpenScanPo,
  highlightId,
  isFetching = false,
  onRefresh,
}: Props) {
  const [query, setQuery] = useState('');
  const [tab, setTab] = useState<FilterTab>('all');
  const [view, setView] = useState<ViewState>('overall');

  // Drop cancelled orders entirely — not shown as a lane in the prototype.
  const liveOrders = useMemo(
    () => orders.filter((o) => o.lane !== 'cancelled'),
    [orders],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return liveOrders.filter((o) => {
      if (tab === 'today' && new Date(o.placedAt).getTime() < dayAgo) return false;
      // 'late' filter: OrderListRow doesn't carry deliveryDate yet — empty result.
      // Keeping the tab visible for parity with prototype + future wiring.
      if (tab === 'late') return false;
      if (!q) return true;
      const phone = o.customerPhone ?? '';
      return (
        o.id.toLowerCase().includes(q) ||
        o.customerName.toLowerCase().includes(q) ||
        phone.toLowerCase().includes(q)
      );
    });
  }, [liveOrders, query, tab]);

  // Group filtered orders by lane.
  const lanes = useMemo(() => {
    const map: Record<LaneDef['id'], OrderListRow[]> = {
      received:   [],
      proceed:    [],
      logistics:  [],
      ready:      [],
      dispatched: [],
      delivered:  [],
    };
    for (const o of filtered) {
      if (o.lane !== 'cancelled' && map[o.lane]) {
        map[o.lane].push(o);
      }
    }
    return map;
  }, [filtered]);

  const counts = useMemo(() => {
    const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
    return {
      all: liveOrders.length,
      late: 0, // see filtered() comment above
      today: liveOrders.filter((o) => new Date(o.placedAt).getTime() >= dayAgo).length,
    };
  }, [liveOrders]);

  const logisticsAwaitingPo = lanes.logistics.filter((o) => !o.poIssued).length;
  const activeLane = view !== 'overall' ? LANES.find((l) => l.id === view) ?? null : null;

  return (
    <div className={styles.page}>
      {/* Subtabs row */}
      <div className={styles.subtabs}>
        <button
          type="button"
          className={`${styles.subtab} ${view === 'overall' ? styles.subtabActive : ''}`}
          onClick={() => setView('overall')}
        >
          <LayoutGrid size={14} strokeWidth={1.75} />
          Overall
          <span className={styles.subtabCount}>{filtered.length}</span>
        </button>
        {LANES.map((l) => (
          <button
            key={l.id}
            type="button"
            className={`${styles.subtab} ${view === l.id ? styles.subtabActive : ''}`}
            onClick={() => setView(l.id)}
          >
            <span className={styles.subtabNum}>{l.num}</span>
            {l.title.split(' ')[0]}
            <span className={styles.subtabCount}>{lanes[l.id].length}</span>
          </button>
        ))}
      </div>

      {/* Toolbar row */}
      <div className={styles.toolbar}>
        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'all' ? styles.tabActive : ''}`}
            onClick={() => setTab('all')}
          >
            All<span className={styles.tabCount}>{counts.all}</span>
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'late' ? styles.tabActive : ''}`}
            onClick={() => setTab('late')}
          >
            Running late<span className={styles.tabCount}>{counts.late}</span>
          </button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'today' ? styles.tabActive : ''}`}
            onClick={() => setTab('today')}
          >
            Last 24h<span className={styles.tabCount}>{counts.today}</span>
          </button>
        </div>

        <div className={styles.search}>
          <Search size={14} strokeWidth={1.75} />
          <input
            type="search"
            placeholder="Order ID, name, phone…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className={styles.toolbarRight}>
          {onRefresh && (
            <button
              type="button"
              className={styles.refresh}
              onClick={onRefresh}
              disabled={isFetching}
            >
              <span className={isFetching ? styles.spinning : ''}>↻</span>
              Refresh
            </button>
          )}
        </div>
      </div>

      {/* Overall view — 6 lane columns */}
      {view === 'overall' ? (
        <div className={styles.board}>
          {LANES.map((l) => {
            const items = lanes[l.id];
            const Icon = l.Icon;
            return (
              <div key={l.id} className={styles.lane}>
                <button
                  type="button"
                  className={styles.laneHead}
                  onClick={() => setView(l.id)}
                  title={`Open ${l.title}`}
                >
                  <div className={styles.laneNum}>{l.num}</div>
                  <div>
                    <div className={styles.laneTitle}>{l.title}</div>
                    <div className={styles.laneSub}>{l.sub}</div>
                  </div>
                  <div className={styles.laneCount}>{items.length}</div>
                </button>

                {l.id === 'logistics' && logisticsAwaitingPo > 0 && (
                  <button
                    type="button"
                    className={styles.laneScanBtn}
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenScanPo();
                    }}
                  >
                    <ScanLine size={12} strokeWidth={1.75} />
                    Scan PO ({logisticsAwaitingPo})
                  </button>
                )}

                <div className={styles.laneBody}>
                  {items.length === 0 ? (
                    <div className={styles.emptyLane}>
                      <Icon size={18} strokeWidth={1.5} />
                      <div>
                        {l.terminal ? 'Showroom marks delivered' : 'Nothing here yet'}
                      </div>
                    </div>
                  ) : (
                    items.map((o) => (
                      <OrderCard
                        key={o.id}
                        order={o}
                        onOpen={onOpenOrder}
                        isHighlighted={highlightId === o.id}
                      />
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        /* Single-lane focused view */
        activeLane && (
          <div className={styles.laneView}>
            <div className={styles.laneViewHead}>
              <div className={styles.laneViewNum}>{activeLane.num}</div>
              <div style={{ flex: 1 }}>
                <div className={styles.laneViewTitle}>{activeLane.title}</div>
                <div className={styles.laneViewSub}>{activeLane.sub}</div>
              </div>
              {activeLane.id === 'logistics' && logisticsAwaitingPo > 0 && (
                <button
                  type="button"
                  className={styles.scanBtn}
                  onClick={onOpenScanPo}
                >
                  <ScanLine size={18} strokeWidth={1.75} />
                  <span>
                    <strong>Scan PO needed</strong>
                    <small>{logisticsAwaitingPo} orders pending PO</small>
                  </span>
                </button>
              )}
              <div className={styles.laneViewCount}>
                <span>{lanes[activeLane.id].length}</span>
                <small>orders</small>
              </div>
            </div>
            <div className={styles.laneViewBody}>
              {lanes[activeLane.id].length === 0 ? (
                <div className={styles.emptyLaneBig}>
                  <activeLane.Icon size={32} strokeWidth={1.5} />
                  <div>
                    {activeLane.terminal
                      ? 'Nothing delivered yet'
                      : 'No orders in this stage'}
                  </div>
                </div>
              ) : (
                lanes[activeLane.id].map((o) => (
                  <OrderCard
                    key={o.id}
                    order={o}
                    onOpen={onOpenOrder}
                    isHighlighted={highlightId === o.id}
                  />
                ))
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}
