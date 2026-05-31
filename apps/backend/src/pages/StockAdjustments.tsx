// ----------------------------------------------------------------------------
// StockAdjustments — list of past manual stock adjustments (write-offs,
// found stock, damage, recount fixes). Read-only ledger view at
// /inventory/adjustments. + New Adjustment button routes to /inventory/adjustments/new.
//
// Filter row: Warehouse · SKU search · Date range.
// Data source: useInventoryMovements({ docType: 'ADJUSTMENT' }).
// The API filters by source_doc_type; the adjustments POST always sets that
// to 'ADJUSTMENT' (apps/api/src/routes/inventory.ts §POST /adjustments),
// so this narrows correctly without any API changes.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useWarehouses,
  useInventoryMovements,
  type InventoryMovement,
} from '../lib/inventory-queries';
import styles from './Inventory.module.css';

const ICON    = { size: 14, strokeWidth: 1.75 } as const;
const ICON_MD = { size: 16, strokeWidth: 1.75 } as const;

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

export const StockAdjustments = () => {
  const navigate = useNavigate();
  const [warehouseId, setWarehouseId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');

  const warehouses = useWarehouses();
  // Server filters by warehouse + date; SKU search is client-side because the
  // API's productCode filter is exact-match (eq), not ilike — and commander
  // is likely to type a partial code/name.
  const { data, isLoading, error } = useInventoryMovements({
    docType: 'ADJUSTMENT',
    warehouseId: warehouseId ?? undefined,
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
  });

  const wmap = useMemo(
    () => new Map((warehouses.data ?? []).map((w) => [w.id, w])),
    [warehouses.data],
  );

  const rows: InventoryMovement[] = useMemo(() => {
    const all = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((m) =>
      m.product_code.toLowerCase().includes(q) ||
      (m.product_name ?? '').toLowerCase().includes(q),
    );
  }, [data, search]);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <Link to="/inventory" className={styles.chip} style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4, marginBottom: 'var(--space-2)' }}>
            <ArrowLeft {...ICON} /> <span>Inventory</span>
          </Link>
          <h1 className={styles.title}>Stock Adjustments</h1>
        </div>
        <Button variant="primary" size="md" onClick={() => navigate('/inventory/adjustments/new')}>
          <Plus {...ICON_MD} />
          <span>New Adjustment</span>
        </Button>
      </div>

      {/* Filter row — Warehouse chips + Search + Date range */}
      <div className={styles.filterRow}>
        <div className={styles.warehouseChips}>
          <button type="button" className={styles.chip}
            data-active={warehouseId === null} onClick={() => setWarehouseId(null)}>
            All warehouses
          </button>
          {warehouses.data?.map((w) => (
            <button key={w.id} type="button" className={styles.chip}
              data-active={warehouseId === w.id} onClick={() => setWarehouseId(w.id)}>
              {w.code} · {w.name}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.searchBox}>
          <Search {...ICON} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search SKU code / description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          <SlidersHorizontal size={12} strokeWidth={1.75} />
          From
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            style={{
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)',
              background: 'var(--c-paper)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--c-ink)',
            }} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          To
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            style={{
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)',
              background: 'var(--c-paper)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--c-ink)',
            }} />
        </label>
        {(dateFrom || dateTo || search || warehouseId) && (
          <button
            type="button"
            className={styles.chip}
            onClick={() => { setDateFrom(''); setDateTo(''); setSearch(''); setWarehouseId(null); }}
          >
            Clear filters
          </button>
        )}
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading…' : `${rows.length} adjustment${rows.length === 1 ? '' : 's'} (latest first)`}
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
              <th>Date</th>
              <th>Warehouse</th>
              <th>SKU</th>
              <th>Product Name</th>
              <th style={{ textAlign: 'right' }}>Qty Delta</th>
              <th>Notes</th>
              <th>Performed By</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={7} className={styles.emptyRow}>Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={7} className={styles.emptyRow}>
                <div>No stock adjustments yet.</div>
                <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                  Click "+ New Adjustment" to create one.
                </div>
              </td></tr>
            )}
            {!isLoading && rows.map((m) => {
              const w = wmap.get(m.warehouse_id);
              const qtyClass = m.qty > 0 ? styles.numCellPos : m.qty < 0 ? styles.numCellNeg : styles.numCellZero;
              const sign = m.qty > 0 ? '+' : '';
              return (
                <tr key={m.id}>
                  <td className={styles.numCellZero}>{fmtDateTime(m.created_at)}</td>
                  <td>{w ? `${w.code} · ${w.name}` : '—'}</td>
                  <td><span className={styles.codeChip}>{m.product_code}</span></td>
                  <td>{m.product_name ?? '—'}</td>
                  <td className={`${styles.numCell} ${qtyClass}`}>
                    {sign}{m.qty.toLocaleString('en-MY')}
                  </td>
                  <td className={styles.numCellZero}>{m.notes ?? '—'}</td>
                  <td className={styles.numCellZero} style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-11)' }}>
                    {m.performed_by ? m.performed_by.slice(0, 8) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
