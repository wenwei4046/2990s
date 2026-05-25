// ----------------------------------------------------------------------------
// Inventory — trading-company stock view.
//
// Two warehouses (KL + 2990 PJ). Two tabs:
//   1. Balances — current qty per (warehouse, product)
//   2. Movements — append-only ledger (every GRN/DO/Consignment/PR post)
//
// IN  events: GRN posted, Consignment RETURN note posted
// OUT events: DO dispatched, Purchase Return posted, Consignment OUT note posted
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Boxes, Search, ArrowUpRight, ArrowDownLeft } from 'lucide-react';
import {
  useWarehouses,
  useInventoryBalances,
  useInventoryMovements,
} from '../lib/inventory-queries';
import styles from './Inventory.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

type Tab = 'balances' | 'movements';

export const Inventory = () => {
  const [tab, setTab] = useState<Tab>('balances');
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  const warehouses = useWarehouses();

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Inventory</h1>
          <p className={styles.subtitle}>
            Stock balance + movement ledger across {warehouses.data?.length ?? 0} warehouses · GRN / Consignment-return = IN · DO / Purchase-return = OUT
          </p>
        </div>
        <div className={styles.tabRow}>
          <button type="button" className={styles.tab} data-active={tab === 'balances'} onClick={() => setTab('balances')}>
            Balances
          </button>
          <button type="button" className={styles.tab} data-active={tab === 'movements'} onClick={() => setTab('movements')}>
            Movements
          </button>
        </div>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.warehouseChips}>
          <button type="button" className={styles.chip} data-active={warehouseId === null} onClick={() => setWarehouseId(null)}>
            All warehouses
          </button>
          {warehouses.data?.map((w) => (
            <button key={w.id} type="button" className={styles.chip}
              data-active={warehouseId === w.id} onClick={() => setWarehouseId(w.id)}>
              {w.code} · {w.name}
            </button>
          ))}
        </div>
        <div className={styles.searchBox}>
          <Search {...ICON} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search code / description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {tab === 'balances'
        ? <BalancesTab warehouseId={warehouseId} search={search} warehouses={warehouses.data ?? []} />
        : <MovementsTab warehouseId={warehouseId} search={search} warehouses={warehouses.data ?? []} />}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Balances tab — per (warehouse, product) qty
   ════════════════════════════════════════════════════════════════════════ */

const BalancesTab = ({
  warehouseId, search, warehouses,
}: {
  warehouseId: string | null;
  search: string;
  warehouses: Array<{ id: string; code: string; name: string }>;
}) => {
  const { data, isLoading, error } = useInventoryBalances({
    warehouseId: warehouseId ?? undefined,
    search: search.trim() || undefined,
  });
  const balances = data?.balances ?? [];

  const totalQty = useMemo(() => balances.reduce((s, r) => s + r.qty, 0), [balances]);
  const distinctSku = useMemo(() => new Set(balances.map((r) => r.product_code)).size, [balances]);
  const wmap = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  return (
    <>
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Total Qty</span>
          <span className={styles.statValue}>{totalQty.toLocaleString('en-MY')}</span>
          <span className={styles.statCaption}>Across {warehouseId === null ? 'all' : '1'} warehouse{warehouseId === null && warehouses.length !== 1 ? 's' : ''}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Distinct SKUs</span>
          <span className={styles.statValue}>{distinctSku}</span>
          <span className={styles.statCaption}>With non-zero balance entries</span>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading balances…' : `${balances.length} balance rows`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Product Code</th>
              <th>Description</th>
              <th>Warehouse</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th>Last Movement</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={5} className={styles.emptyRow}>Loading…</td></tr>
            )}
            {!isLoading && balances.length === 0 && (
              <tr><td colSpan={5} className={styles.emptyRow}>
                <Boxes size={32} strokeWidth={1.5} />
                <div style={{ marginTop: 8 }}>No stock movements yet.</div>
                <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                  Post a GRN to bring stock in, dispatch a DO to take it out.
                </div>
              </td></tr>
            )}
            {!isLoading && balances.map((b) => {
              const w = wmap.get(b.warehouse_id);
              const qtyClass = b.qty > 0 ? styles.numCellPos : b.qty < 0 ? styles.numCellNeg : styles.numCellZero;
              return (
                <tr key={`${b.warehouse_id}-${b.product_code}`}>
                  <td><span className={styles.codeChip}>{b.product_code}</span></td>
                  <td>{b.product_name ?? '—'}</td>
                  <td>{w ? `${w.code} · ${w.name}` : '—'}</td>
                  <td className={`${styles.numCell} ${qtyClass}`}>{b.qty.toLocaleString('en-MY')}</td>
                  <td className={styles.numCellZero}>{b.last_movement_at ? fmtDateTime(b.last_movement_at) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Movements tab — append-only ledger
   ════════════════════════════════════════════════════════════════════════ */

const MovementsTab = ({
  warehouseId, search, warehouses,
}: {
  warehouseId: string | null;
  search: string;
  warehouses: Array<{ id: string; code: string; name: string }>;
}) => {
  const [docType, setDocType] = useState<string | null>(null);
  const { data, isLoading, error } = useInventoryMovements({
    warehouseId: warehouseId ?? undefined,
    productCode: search.trim() || undefined,
    docType: docType ?? undefined,
  });
  const movements = data ?? [];
  const wmap = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  const DOC_TYPES = [
    { value: null, label: 'All' },
    { value: 'GRN', label: 'GRN (IN)' },
    { value: 'DO', label: 'DO (OUT)' },
    { value: 'CONSIGNMENT_NOTE', label: 'Consignment' },
    { value: 'PURCHASE_RETURN', label: 'PR (OUT)' },
    { value: 'ADJUSTMENT', label: 'Adjustment' },
  ];

  return (
    <>
      <div className={styles.warehouseChips}>
        {DOC_TYPES.map((t) => (
          <button key={t.value ?? 'all'} type="button" className={styles.chip}
            data-active={docType === t.value}
            onClick={() => setDocType(t.value)}>
            {t.label}
          </button>
        ))}
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading…' : `${movements.length} movements (latest first)`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>When</th>
              <th>Type</th>
              <th>Warehouse</th>
              <th>Product</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th>Source Doc</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className={styles.emptyRow}>Loading…</td></tr>
            )}
            {!isLoading && movements.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyRow}>No movements match the filters.</td></tr>
            )}
            {!isLoading && movements.map((m) => {
              const w = wmap.get(m.warehouse_id);
              return (
                <tr key={m.id}>
                  <td className={styles.numCellZero}>{fmtDateTime(m.created_at)}</td>
                  <td>
                    <span className={`${styles.movementPill} ${
                      m.movement_type === 'IN' ? styles.movementIn
                      : m.movement_type === 'OUT' ? styles.movementOut
                      : styles.movementAdj}`}>
                      {m.movement_type === 'IN' && <ArrowDownLeft size={11} strokeWidth={2} style={{ marginRight: 4 }} />}
                      {m.movement_type === 'OUT' && <ArrowUpRight size={11} strokeWidth={2} style={{ marginRight: 4 }} />}
                      {m.movement_type}
                    </span>
                  </td>
                  <td>{w ? w.code : '—'}</td>
                  <td>
                    <div><span className={styles.codeChip}>{m.product_code}</span></div>
                    <div className={styles.numCellZero} style={{ fontSize: 'var(--fs-11)' }}>{m.product_name ?? '—'}</div>
                  </td>
                  <td className={`${styles.numCell} ${m.movement_type === 'IN' ? styles.numCellPos : styles.numCellNeg}`}>
                    {m.movement_type === 'IN' ? '+' : m.movement_type === 'OUT' ? '−' : ''}
                    {Math.abs(m.qty).toLocaleString('en-MY')}
                  </td>
                  <td>
                    {m.source_doc_no
                      ? <span className={styles.docLink}>{m.source_doc_no}</span>
                      : <span className={styles.numCellZero}>—</span>}
                  </td>
                  <td className={styles.numCellZero}>{m.notes ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
};

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};
