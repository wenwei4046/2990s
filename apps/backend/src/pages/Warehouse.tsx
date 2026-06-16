// ----------------------------------------------------------------------------
// Warehouse — rack/bin management (ported from Hookka ERP).
//
// KPI tiles: Total Slots · Occupied · Empty · Reserved · Occupancy %
// Three tabs:
//   1. Rack Overview   — rack-grid layout, every rack shown EMPTY/OCCUPIED/
//                        RESERVED. Click an occupied rack → detail drawer;
//                        click an empty rack → jump to Stock In pre-filled.
//   2. Stock In/Out    — add an item to a rack / release an item from a rack.
//   3. Movement History — append-only stock-in/out ledger with filters.
//
// Adapted to 2990s conventions: CSS modules + design tokens, React Query hooks
// in lib/warehouse-queries.ts, design-system <Button>. Unlike Hookka (which
// stocks-in from completed production orders), 2990s is a trading company, so
// Stock In takes a free-form product code + qty + optional source-doc ref.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import {
  Grid3x3, Package, MapPin, LayoutGrid, Warehouse as WarehouseIcon,
  ArrowRightLeft, History, ArrowDownToLine, ArrowUpFromLine, X, RefreshCw, Plus,
  Pencil, Check,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useRacks,
  useRackMovements,
  useStockIn,
  useStockOut,
  useCreateRack,
  useUpdateRack,
  type Rack,
  type RackItem,
  type RackMovement,
  type RackStatus,
} from '../lib/warehouse-queries';
import { useToast } from '../components/Toast';
import styles from './Warehouse.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;
const ICON_MD = { size: 16, strokeWidth: 1.75 } as const;

type Tab = 'grid' | 'stockio' | 'history';

const TABS: { key: Tab; label: string; icon: typeof Grid3x3 }[] = [
  { key: 'grid',    label: 'Rack Overview',    icon: Grid3x3 },
  { key: 'stockio', label: 'Stock In/Out',     icon: ArrowRightLeft },
  { key: 'history', label: 'Movement History', icon: History },
];

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  const date = d.toLocaleDateString('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/-/g, '/');
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  return `${date} ${time}`;
};

export const Warehouse = () => {
  const [tab, setTab] = useState<Tab>('grid');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);

  // Detail drawer + cross-tab stock-in/out targets.
  const [detailRack, setDetailRack] = useState<Rack | null>(null);
  const [stockInRackId, setStockInRackId] = useState('');
  const [stockOutItemId, setStockOutItemId] = useState('');

  const racksQ = useRacks({ warehouseId: warehouseId ?? undefined });
  const racks = racksQ.data?.racks ?? [];
  const summary = racksQ.data?.summary ?? { total: 0, occupied: 0, empty: 0, reserved: 0, occupancyRate: 0 };
  const warehouses = racksQ.data?.warehouses ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Warehouse</h1>
          <p className={styles.subtitle}>
            Rack location management · stock-in / stock-out tracking · {summary.total} racks
          </p>
        </div>
        <div className={styles.tabRow}>
          {TABS.map((t) => {
            const Icon = t.icon;
            return (
              <button key={t.key} type="button" className={styles.tab}
                data-active={tab === t.key} onClick={() => setTab(t.key)}>
                <Icon {...ICON} />
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Warehouse picker + refresh */}
      <div className={styles.filterRow} style={{ justifyContent: 'space-between' }}>
        <div className={styles.chipRow}>
          <button type="button" className={styles.chip}
            data-active={warehouseId === null} onClick={() => setWarehouseId(null)}>
            All warehouses
          </button>
          {warehouses.map((w) => (
            <button key={w.id} type="button" className={styles.chip}
              data-active={warehouseId === w.id} onClick={() => setWarehouseId(w.id)}>
              {w.code} · {w.name}
            </button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => racksQ.refetch()}>
          <RefreshCw {...ICON} />
          <span>Refresh</span>
        </Button>
      </div>

      {/* KPI tiles */}
      <div className={styles.statGrid}>
        <KpiTile label="Total Slots" value={summary.total} icon={<Grid3x3 {...ICON_MD} />} />
        <KpiTile label="Occupied" value={summary.occupied} icon={<Package {...ICON_MD} />} />
        <KpiTile label="Empty" value={summary.empty} icon={<MapPin {...ICON_MD} />} />
        <KpiTile label="Reserved" value={summary.reserved} icon={<LayoutGrid {...ICON_MD} />} />
        <KpiTile label="Occupancy" value={`${summary.occupancyRate}%`} icon={<WarehouseIcon {...ICON_MD} />} />
      </div>

      {racksQ.error && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load.</strong>{' '}
          {racksQ.error instanceof Error ? racksQ.error.message : String(racksQ.error)}
        </div>
      )}

      {/* ── Tab 1: Rack Overview ─────────────────────────────────────────── */}
      {tab === 'grid' && (
        <RackGrid
          racks={racks}
          loading={racksQ.isLoading}
          warehouses={warehouses}
          selectedWarehouseId={warehouseId}
          onOpenOccupied={(rack) => setDetailRack(rack)}
          onStockInEmpty={(rack) => { setStockInRackId(rack.id); setTab('stockio'); }}
        />
      )}

      {/* ── Tab 2: Stock In/Out ──────────────────────────────────────────── */}
      {tab === 'stockio' && (
        <StockInOutTab
          racks={racks}
          stockInRackId={stockInRackId}
          setStockInRackId={setStockInRackId}
          stockOutItemId={stockOutItemId}
          setStockOutItemId={setStockOutItemId}
        />
      )}

      {/* ── Tab 3: Movement History ──────────────────────────────────────── */}
      {tab === 'history' && (
        <MovementHistoryTab warehouseId={warehouseId} />
      )}

      {/* Occupied-rack detail drawer */}
      {detailRack && (
        <RackDetailDrawer
          rack={detailRack}
          onClose={() => setDetailRack(null)}
          onStockOut={(itemId) => {
            setStockOutItemId(itemId);
            setDetailRack(null);
            setTab('stockio');
          }}
        />
      )}
    </div>
  );
};

const KpiTile = ({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) => (
  <div className={styles.statCard}>
    <span className={styles.statLabel}>{label}</span>
    <span className={styles.statValue}>{value}</span>
    <span className={styles.statCaption} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      {icon}
    </span>
  </div>
);

/* ════════════════════════════════════════════════════════════════════════
   Shared rack-rename logic + inline editor
   Used by both the Rack Overview grid tiles and the detail drawer so the
   behaviour (Enter saves / Escape cancels, duplicate-name alert) stays in one
   place.
   ════════════════════════════════════════════════════════════════════════ */
const useRackRename = (rack: Rack) => {
  const toast = useToast();
  const updateRack = useUpdateRack();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(rack.rack);

  const trimmed = label.trim();
  const canSave = trimmed.length > 0 && trimmed !== rack.rack && !updateRack.isPending;

  const startEdit = () => { setLabel(rack.rack); setEditing(true); };
  const cancelEdit = () => { setEditing(false); setLabel(rack.rack); };
  const saveEdit = () => {
    if (!canSave) return;
    updateRack.mutate(
      { id: rack.id, rack: trimmed },
      {
        onSuccess: () => setEditing(false),
        onError: (err) => {
          const msg = err instanceof Error ? err.message : String(err);
          toast.error(
            msg.includes('duplicate_rack')
              ? `A rack named "${trimmed}" already exists in this warehouse.`
              : msg,
          );
        },
      },
    );
  };

  return {
    editing, label, setLabel,
    canSave, isPending: updateRack.isPending,
    startEdit, cancelEdit, saveEdit,
  };
};

type RackRenameState = ReturnType<typeof useRackRename>;

const RackRenameEditor = ({
  rename, inputStyle, stopPropagation = false,
}: {
  rename: RackRenameState;
  inputStyle?: React.CSSProperties;
  stopPropagation?: boolean;
}) => (
  <div
    style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1 }}
    {...(stopPropagation ? { onClick: (e: React.MouseEvent) => e.stopPropagation() } : {})}
  >
    <input
      className={styles.input}
      style={inputStyle}
      value={rename.label}
      autoFocus
      onChange={(e) => rename.setLabel(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') rename.saveEdit();
        else if (e.key === 'Escape') rename.cancelEdit();
      }}
    />
    <Button variant="primary" size="sm" disabled={!rename.canSave} onClick={rename.saveEdit}>
      <Check {...ICON} />
      <span>{rename.isPending ? 'Saving…' : 'Save'}</span>
    </Button>
    <Button variant="ghost" size="sm" disabled={rename.isPending} onClick={rename.cancelEdit}>
      <span>Cancel</span>
    </Button>
  </div>
);

/* ════════════════════════════════════════════════════════════════════════
   Rack grid — flat tiles, 3 items visible + "+N more"
   ════════════════════════════════════════════════════════════════════════ */
const RackGrid = ({
  racks, loading, warehouses, selectedWarehouseId, onOpenOccupied, onStockInEmpty,
}: {
  racks: Rack[];
  loading: boolean;
  warehouses: { id: string; code: string; name: string }[];
  selectedWarehouseId: string | null;
  onOpenOccupied: (rack: Rack) => void;
  onStockInEmpty: (rack: Rack) => void;
}) => {
  const create = useCreateRack();
  const [seedCount, setSeedCount] = useState(10);

  // Seed target: the selected warehouse, else the first available one.
  const seedWarehouseId = selectedWarehouseId ?? warehouses[0]?.id ?? null;

  const VISIBLE = 3;

  return (
    <div className={styles.sectionCard}>
      <div className={styles.legend}>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.swatchOccupied}`} />
          Occupied
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.swatchEmpty}`} />
          Empty
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.swatchReserved}`} />
          Reserved
        </span>
      </div>

      {loading && <p className={styles.eyebrow}>Loading racks…</p>}

      {!loading && racks.length === 0 && (
        <div style={{ textAlign: 'center', padding: 'var(--space-6)' }}>
          <WarehouseIcon size={32} strokeWidth={1.5} />
          <div style={{ marginTop: 8, color: 'var(--fg-muted)' }}>No racks yet.</div>
          {seedWarehouseId && (
            <div style={{ marginTop: 'var(--space-4)', display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <input
                type="number" min={1} max={200}
                className={styles.input} style={{ width: 90 }}
                value={seedCount}
                onChange={(e) => setSeedCount(Math.max(1, Number(e.target.value) || 1))}
              />
              <Button variant="primary" size="md" disabled={create.isPending}
                onClick={() => create.mutate({ warehouseId: seedWarehouseId, count: seedCount })}>
                <Plus {...ICON_MD} />
                <span>{create.isPending ? 'Creating…' : `Create ${seedCount} racks`}</span>
              </Button>
            </div>
          )}
        </div>
      )}

      {!loading && racks.length > 0 && (
        <div className={styles.rackGrid}>
          {racks.map((rack) => (
            <RackTile
              key={rack.id}
              rack={rack}
              visibleCount={VISIBLE}
              onOpenOccupied={onOpenOccupied}
              onStockInEmpty={onStockInEmpty}
            />
          ))}
        </div>
      )}
    </div>
  );
};

/* ── Single rack tile (grid) — carries its own inline rename editor ──────── */
const RackTile = ({
  rack, visibleCount, onOpenOccupied, onStockInEmpty,
}: {
  rack: Rack;
  visibleCount: number;
  onOpenOccupied: (rack: Rack) => void;
  onStockInEmpty: (rack: Rack) => void;
}) => {
  const rename = useRackRename(rack);
  const items = rack.items ?? [];
  const visible = items.slice(0, visibleCount);
  const extra = Math.max(0, items.length - visibleCount);
  const tileClass =
    rack.status === 'OCCUPIED' ? styles.rackTileOccupied
    : rack.status === 'RESERVED' ? styles.rackTileReserved
    : styles.rackTileEmpty;

  // While renaming, the tile must not react to its own click (Stock In / drawer).
  const handleTileClick = () => {
    if (rename.editing) return;
    if (rack.status === 'OCCUPIED') onOpenOccupied(rack);
    else if (rack.status === 'EMPTY') onStockInEmpty(rack);
  };

  return (
    <div
      className={`${styles.rackTile} ${tileClass}`}
      style={rename.editing ? { cursor: 'default' } : undefined}
      onClick={handleTileClick}
    >
      <div className={styles.rackTileHead}>
        {rename.editing ? (
          <RackRenameEditor rename={rename} stopPropagation />
        ) : (
          <>
            <span className={styles.rackName}>{rack.rack}</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {rack.status === 'OCCUPIED' && (
                <span className={styles.rackCount}>
                  {items.length} item{items.length === 1 ? '' : 's'}
                </span>
              )}
              <button
                type="button"
                className={styles.rackRenameBtn}
                title="Rename rack"
                aria-label="Rename rack"
                onClick={(e) => { e.stopPropagation(); rename.startEdit(); }}
              >
                <Pencil {...ICON} />
              </button>
            </div>
          </>
        )}
      </div>
      {!rename.editing && (
        <>
          {rack.status === 'OCCUPIED' && (
            <div>
              {visible.map((it) => (
                <div key={it.id} className={styles.rackItemLine}>
                  <div className={styles.rackItemCode}>{it.product_code}</div>
                  {it.customer_name && <div className={styles.rackItemSub}>{it.customer_name}</div>}
                </div>
              ))}
              {extra > 0 && <div className={styles.rackMore}>+{extra} more</div>}
            </div>
          )}
          {rack.status === 'RESERVED' && <div className={styles.rackEmptyLabel}>Reserved</div>}
          {rack.status === 'EMPTY' && <div className={styles.rackEmptyLabel}>Empty</div>}
        </>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Stock In / Stock Out forms
   ════════════════════════════════════════════════════════════════════════ */
const StockInOutTab = ({
  racks, stockInRackId, setStockInRackId, stockOutItemId, setStockOutItemId,
}: {
  racks: Rack[];
  stockInRackId: string;
  setStockInRackId: (v: string) => void;
  stockOutItemId: string;
  setStockOutItemId: (v: string) => void;
}) => {
  const stockIn = useStockIn();
  const stockOut = useStockOut();

  // Stock In form fields.
  const [productCode, setProductCode] = useState('');
  const [productName, setProductName] = useState('');
  const [sizeLabel, setSizeLabel] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [sourceDocNo, setSourceDocNo] = useState('');
  const [qty, setQty] = useState(1);
  const [stockInNote, setStockInNote] = useState('');

  // Stock Out form fields.
  const [stockOutReason, setStockOutReason] = useState('');

  // Racks eligible for stock-in: anything not reserved (occupied racks still
  // accept more items, matching the source system).
  const eligibleRacks = racks.filter((r) => r.status !== 'RESERVED');
  // All currently-stored items across occupied racks, for the stock-out picker.
  const allItems = useMemo(
    () => racks.flatMap((r) => (r.items ?? []).map((it) => ({ rack: r, item: it }))),
    [racks],
  );
  const selectedOut = allItems.find((x) => x.item.id === stockOutItemId);

  const resetStockIn = () => {
    setProductCode(''); setProductName(''); setSizeLabel('');
    setCustomerName(''); setSourceDocNo(''); setQty(1); setStockInNote('');
    setStockInRackId('');
  };

  const submitStockIn = () => {
    if (!stockInRackId || !productCode.trim()) return;
    stockIn.mutate({
      rackId: stockInRackId,
      productCode: productCode.trim(),
      productName: productName.trim() || undefined,
      sizeLabel: sizeLabel.trim() || undefined,
      customerName: customerName.trim() || undefined,
      sourceDocNo: sourceDocNo.trim() || undefined,
      qty,
      notes: stockInNote.trim() || undefined,
    }, { onSuccess: resetStockIn });
  };

  const submitStockOut = () => {
    if (!stockOutItemId || !stockOutReason.trim()) return;
    stockOut.mutate({
      itemId: stockOutItemId,
      reason: stockOutReason.trim(),
    }, { onSuccess: () => { setStockOutItemId(''); setStockOutReason(''); } });
  };

  return (
    <div className={styles.formGrid}>
      {/* Stock In */}
      <div className={styles.formCard}>
        <span className={`${styles.formCardTitle} ${styles.titleIn}`}>
          <ArrowDownToLine {...ICON_MD} /> Stock In
        </span>

        <div className={styles.field}>
          <span className={styles.label}>Rack *</span>
          <select className={styles.select} value={stockInRackId}
            onChange={(e) => setStockInRackId(e.target.value)}>
            <option value="">Select rack…</option>
            {eligibleRacks.map((r) => (
              <option key={r.id} value={r.id}>
                {r.rack} ({(r.items ?? []).length} item{(r.items ?? []).length === 1 ? '' : 's'})
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <span className={styles.label}>Product Code *</span>
          <input className={styles.input} value={productCode}
            placeholder="e.g. BF-2990-Q" onChange={(e) => setProductCode(e.target.value)} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Product Name</span>
          <input className={styles.input} value={productName}
            placeholder="Description" onChange={(e) => setProductName(e.target.value)} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Size</span>
          <input className={styles.input} value={sizeLabel}
            placeholder="Queen / King…" onChange={(e) => setSizeLabel(e.target.value)} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Customer / Reserved For</span>
          <input className={styles.input} value={customerName}
            onChange={(e) => setCustomerName(e.target.value)} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Source Doc (SO / DO no.)</span>
          <input className={styles.input} value={sourceDocNo}
            placeholder="SO-2045" onChange={(e) => setSourceDocNo(e.target.value)} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Quantity</span>
          <input className={styles.input} type="number" min={1} value={qty}
            onChange={(e) => setQty(Math.max(1, Number(e.target.value) || 1))} />
        </div>
        <div className={styles.field}>
          <span className={styles.label}>Notes</span>
          <input className={styles.input} value={stockInNote}
            onChange={(e) => setStockInNote(e.target.value)} />
        </div>

        <Button variant="primary" size="md"
          disabled={!stockInRackId || !productCode.trim() || stockIn.isPending}
          onClick={submitStockIn}>
          <ArrowDownToLine {...ICON_MD} />
          <span>{stockIn.isPending ? 'Stocking in…' : 'Confirm Stock In'}</span>
        </Button>
      </div>

      {/* Stock Out */}
      <div className={styles.formCard}>
        <span className={`${styles.formCardTitle} ${styles.titleOut}`}>
          <ArrowUpFromLine {...ICON_MD} /> Stock Out
        </span>

        <div className={styles.field}>
          <span className={styles.label}>Item to Release *</span>
          <select className={styles.select} value={stockOutItemId}
            onChange={(e) => setStockOutItemId(e.target.value)}>
            <option value="">Select an item…</option>
            {allItems.map(({ rack, item }) => (
              <option key={item.id} value={item.id}>
                {rack.rack} · {item.product_code}
                {item.size_label ? ` ${item.size_label}` : ''}
                {item.customer_name ? ` (${item.customer_name})` : ''}
              </option>
            ))}
          </select>
        </div>

        {selectedOut && (
          <div className={styles.detailBox}>
            <span>Rack: {selectedOut.rack.rack}</span>
            <span>Product: {selectedOut.item.product_code}
              {selectedOut.item.product_name ? ` · ${selectedOut.item.product_name}` : ''}</span>
            {selectedOut.item.customer_name && <span>Customer: {selectedOut.item.customer_name}</span>}
            <span>Qty: {selectedOut.item.qty}</span>
            <span>Stocked In: {selectedOut.item.stocked_in_date}</span>
          </div>
        )}

        <div className={styles.field}>
          <span className={styles.label}>Reason *</span>
          <input className={styles.input} value={stockOutReason}
            placeholder="Delivered to customer / Transferred / Damaged…"
            onChange={(e) => setStockOutReason(e.target.value)} />
        </div>

        <Button variant="primary" size="md"
          disabled={!stockOutItemId || !stockOutReason.trim() || stockOut.isPending}
          onClick={submitStockOut}>
          <ArrowUpFromLine {...ICON_MD} />
          <span>{stockOut.isPending ? 'Stocking out…' : 'Confirm Stock Out'}</span>
        </Button>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Movement history
   ════════════════════════════════════════════════════════════════════════ */
const MovementHistoryTab = ({ warehouseId }: { warehouseId: string | null }) => {
  const [type, setType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const { data, isLoading } = useRackMovements({
    type: type || undefined,
    from: from || undefined,
    to: to || undefined,
    warehouseId: warehouseId ?? undefined,
  });
  const movements: RackMovement[] = data ?? [];

  return (
    <div className={styles.sectionCard} style={{ padding: 0 }}>
      <div className={styles.filterRow} style={{ padding: 'var(--space-4) var(--space-5)', justifyContent: 'space-between' }}>
        <span className={styles.eyebrow}>
          {isLoading ? 'Loading…' : `${movements.length} movements (latest first)`}
        </span>
        <div className={styles.filterRow}>
          <select className={styles.select} style={{ width: 'auto' }}
            value={type} onChange={(e) => setType(e.target.value)}>
            <option value="">All Types</option>
            <option value="STOCK_IN">Stock In</option>
            <option value="STOCK_OUT">Stock Out</option>
            <option value="TRANSFER">Transfer</option>
          </select>
          <input className={styles.input} style={{ width: 'auto' }} type="date"
            value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className={styles.input} style={{ width: 'auto' }} type="date"
            value={to} onChange={(e) => setTo(e.target.value)} />
          {(type || from || to) && (
            <Button variant="ghost" size="sm"
              onClick={() => { setType(''); setFrom(''); setTo(''); }}>
              Clear
            </Button>
          )}
        </div>
      </div>

      <div className={styles.tableScroll}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Rack</th>
              <th>Product</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th>Source Doc</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className={styles.emptyRow}>Loading…</td></tr>}
            {!isLoading && movements.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyRow}>
                <History size={32} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>No movements found.</div>
              </td></tr>
            )}
            {!isLoading && movements.map((m) => (
              <tr key={m.id}>
                <td style={{ color: 'var(--fg-soft)' }}>{fmtDateTime(m.created_at)}</td>
                <td>
                  <span className={`${styles.movementPill} ${
                    m.movement_type === 'STOCK_IN' ? styles.movementIn
                    : m.movement_type === 'STOCK_OUT' ? styles.movementOut
                    : styles.movementXfer}`}>
                    {m.movement_type === 'STOCK_IN' ? 'IN'
                      : m.movement_type === 'STOCK_OUT' ? 'OUT' : 'TRANSFER'}
                  </span>
                </td>
                <td style={{ fontWeight: 600 }}>{m.rack_label ?? '—'}</td>
                <td>
                  <span className={styles.codeChip}>{m.product_code ?? '—'}</span>
                  {m.product_name && (
                    <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-soft)' }}>{m.product_name}</div>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>{m.quantity}</td>
                <td style={{ color: 'var(--fg-soft)' }}>{m.source_doc_no ?? '—'}</td>
                <td style={{ color: 'var(--fg-soft)' }}>{m.reason ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Occupied-rack detail drawer
   ════════════════════════════════════════════════════════════════════════ */
const RackDetailDrawer = ({
  rack, onClose, onStockOut,
}: {
  rack: Rack;
  onClose: () => void;
  onStockOut: (itemId: string) => void;
}) => {
  const items: RackItem[] = rack.items ?? [];
  const rename = useRackRename(rack);

  return (
    <div className={styles.drawerScrim} onClick={onClose}>
      <div className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <div className={styles.headerRow}>
          {rename.editing ? (
            <RackRenameEditor
              rename={rename}
              inputStyle={{ fontSize: 'var(--fs-22)', fontWeight: 600 }}
            />
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flex: 1 }}>
              <h2 className={styles.title} style={{ fontSize: 'var(--fs-22)' }}>{rack.rack}</h2>
              <Button variant="ghost" size="sm" onClick={rename.startEdit}>
                <Pencil {...ICON} />
                <span>Rename</span>
              </Button>
            </div>
          )}
          <button type="button" className={styles.chip} onClick={onClose}>
            <X {...ICON} />
          </button>
        </div>

        <div className={styles.detailBox} style={{ marginTop: 'var(--space-3)' }}>
          <span>Status: <StatusBadge status={rack.status} /></span>
          <span>Items on this rack: {items.length}</span>
        </div>

        {items.map((it) => (
          <div key={it.id} className={styles.itemCard}>
            <div className={styles.itemCardHead}>
              <span className={styles.codeChip}>{it.product_code}</span>
              <span className={styles.itemMeta}>Qty: {it.qty}</span>
            </div>
            {it.product_name && (
              <span className={styles.itemMeta}>{it.product_name}{it.size_label ? ` · ${it.size_label}` : ''}</span>
            )}
            {it.customer_name && <span className={styles.itemMeta}>Customer: {it.customer_name}</span>}
            {it.source_doc_no && <span className={styles.itemMeta}>Source: {it.source_doc_no}</span>}
            {it.stocked_in_date && <span className={styles.itemMeta}>Stocked In: {it.stocked_in_date}</span>}
            <div style={{ marginTop: 'var(--space-2)' }}>
              <Button variant="ghost" size="sm" onClick={() => onStockOut(it.id)}>
                <ArrowUpFromLine {...ICON} />
                <span>Stock Out</span>
              </Button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

const StatusBadge = ({ status }: { status: RackStatus }) => (
  <span className={`${styles.movementPill} ${
    status === 'OCCUPIED' ? styles.movementIn
    : status === 'RESERVED' ? styles.movementXfer
    : styles.movementOut}`}>
    {status}
  </span>
);
