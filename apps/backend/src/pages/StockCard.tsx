// ----------------------------------------------------------------------------
// StockCard — per-SKU drilldown at /inventory/stock-card/:productCode
// (Inv PR2). Optional ?warehouseId=… scopes the ledger + lots to one
// warehouse; otherwise we sum across all warehouses.
//
// Read-only — no new tables, no new API endpoints. Reuses:
//   useInventoryMovements({ productCode, warehouseId? })
//   useInventoryLots(productCode, { warehouseId?, includeClosed? })
//   useInventoryProductBreakdown(productCode) — per-warehouse balances
//
// Layout (full page, PurchaseOrderDetail chrome):
//   1. Header + back link
//   2. Stats: Total Qty · Warehouses · Last Movement · FIFO Value
//   3. Warehouse filter pills (when no ?warehouseId param)
//   4. Per-Warehouse Balance card (All-mode only)
//   5. Movements ledger w/ running balance (computed client-side)
//   6. FIFO Lots card (collapsible, "Show closed lots" toggle)
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  ArrowLeft, Boxes, ArrowDownLeft, ArrowUpRight, ChevronDown, ChevronRight,
} from 'lucide-react';
import {
  useInventoryMovements,
  useInventoryLots,
  useInventoryProductBreakdown,
  useWarehouses,
  type InventoryMovement,
  type InventoryLot,
} from '../lib/inventory-queries';
import styles from './Inventory.module.css';
import chrome from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (sen: number | null | undefined): string => {
  if (sen == null) return '—';
  return `RM ${(sen / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

const fmtDateTime = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

const fmtDate = (iso: string | null | undefined): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
  });
};

/** Best-effort route for a source doc on the ledger row. Inventory writes
 *  carry source_doc_id (the UUID of the originating GRN/DO/etc) — when
 *  present we can deep-link straight to the detail page. */
const docHrefFor = (m: InventoryMovement): string | null => {
  if (!m.source_doc_id) return null;
  switch (m.source_doc_type) {
    case 'GRN':              return `/grns/${m.source_doc_id}`;
    case 'DO':               return `/mfg-delivery-orders/${m.source_doc_id}`;
    case 'PURCHASE_RETURN':  return `/purchase-returns/${m.source_doc_id}`;
    case 'CONSIGNMENT_NOTE': return `/consignment/${m.source_doc_id}`;
    default:                 return null;
  }
};

export const StockCard = () => {
  const { productCode = '' } = useParams<{ productCode: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const warehouseId = searchParams.get('warehouseId') || undefined;
  const [includeClosed, setIncludeClosed] = useState(false);
  const [lotsOpen, setLotsOpen] = useState(true);

  const warehousesQ = useWarehouses();
  const breakdownQ = useInventoryProductBreakdown(productCode || null);
  const movementsQ = useInventoryMovements({
    productCode: productCode || undefined,
    warehouseId,
  });
  const lotsQ = useInventoryLots(productCode || null, {
    warehouseId,
    includeClosed,
  });

  const warehouses = warehousesQ.data ?? [];
  const breakdownAll = (breakdownQ.data?.balances ?? []).filter((b) => b.product_code === productCode);
  // When filtered, only show the matching warehouse row in the summary stats.
  const breakdown = warehouseId
    ? breakdownAll.filter((b) => b.warehouse_id === warehouseId)
    : breakdownAll;

  // API returns DESC; reverse to ASC for running-balance accumulation, then
  // re-render DESC. Running balance is the cumulative qty *after* the row's
  // movement is applied. Reflects whatever scope the user is viewing (All
  // warehouses or one).
  const movementsDesc = movementsQ.data ?? [];
  const movementsWithBalance = useMemo(() => {
    const asc = [...movementsDesc].slice().reverse();
    let running = 0;
    const out: Array<InventoryMovement & { runningBalance: number }> = [];
    for (const m of asc) {
      running += m.qty;
      out.push({ ...m, runningBalance: running });
    }
    // newest-first render
    return out.reverse();
  }, [movementsDesc]);

  const lots: InventoryLot[] = lotsQ.data ?? [];

  // ── Stats (always reflect the active warehouse filter) ────────────────
  const productName =
    breakdownAll[0]?.product_name ?? movementsDesc.find((m) => m.product_name)?.product_name ?? null;
  const totalQty = breakdown.reduce((s, b) => s + (b.qty ?? 0), 0);
  const warehouseCount = breakdown.filter((b) => (b.qty ?? 0) !== 0).length;
  const lastMovementAt = movementsDesc[0]?.created_at ?? null;
  const fifoValue = lots.reduce(
    (s, l) => s + l.qty_remaining * l.unit_cost_sen, 0,
  );

  return (
    <div className={chrome.page}>
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className={chrome.headerRow}>
        <div className={chrome.titleBlock}>
          <Link to="/inventory" className={chrome.backBtn}>
            <ArrowLeft {...ICON} />
            <span>Inventory</span>
          </Link>
          <div>
            <h1 className={chrome.title}>
              <Boxes size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              Stock Card · <span className={styles.codeChip} style={{ fontSize: 'var(--fs-18)' }}>{productCode}</span>
            </h1>
            <p className={chrome.subtitle}>
              {productName ?? 'No movements yet for this SKU.'}
              {warehouseId && warehouses.length > 0 && (() => {
                const w = warehouses.find((x) => x.id === warehouseId);
                return w ? ` · scoped to ${w.code} · ${w.name}` : null;
              })()}
            </p>
          </div>
        </div>
      </div>

      {/* ── Stats ──────────────────────────────────────────────────────── */}
      <div className={styles.statGrid}>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Current Qty</span>
          <span className={styles.statValue}>{totalQty.toLocaleString('en-MY')}</span>
          <span className={styles.statCaption}>
            {warehouseId ? 'In selected warehouse' : 'Σ across all warehouses'}
          </span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Warehouses</span>
          <span className={styles.statValue}>{warehouseCount}</span>
          <span className={styles.statCaption}>Holding this SKU</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>Last Movement</span>
          <span className={styles.statValue} style={{ fontSize: 'var(--fs-16)' }}>
            {lastMovementAt ? fmtDate(lastMovementAt) : '—'}
          </span>
          <span className={styles.statCaption}>{lastMovementAt ? fmtDateTime(lastMovementAt) : 'No activity yet'}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statLabel}>FIFO Value</span>
          <span className={styles.statValue}>{fmtRm(fifoValue)}</span>
          <span className={styles.statCaption}>Open lots · qty × cost</span>
        </div>
      </div>

      {/* ── Warehouse filter pills (All-mode only — once a warehouse is
              picked, the per-warehouse breakdown card is hidden and the
              pills act as the navigation back to All). ────────────────── */}
      <div className={styles.warehouseChips}>
        <button
          type="button"
          className={styles.chip}
          data-active={!warehouseId}
          onClick={() => {
            const p = new URLSearchParams(searchParams);
            p.delete('warehouseId');
            setSearchParams(p, { replace: true });
          }}
        >
          All warehouses
        </button>
        {warehouses.map((w) => (
          <button
            key={w.id}
            type="button"
            className={styles.chip}
            data-active={warehouseId === w.id}
            onClick={() => {
              const p = new URLSearchParams(searchParams);
              p.set('warehouseId', w.id);
              setSearchParams(p, { replace: true });
            }}
          >
            {w.code} · {w.name}
          </button>
        ))}
      </div>

      {/* ── Per-Warehouse Balance card (only in All mode) ──────────────── */}
      {!warehouseId && (
        <section className={chrome.card}>
          <header className={chrome.cardHeader}>
            <h2 className={chrome.cardTitle}>Per-Warehouse Balance</h2>
          </header>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Warehouse Code</th>
                <th>Warehouse Name</th>
                <th style={{ textAlign: 'right' }}>Qty On Hand</th>
                <th style={{ textAlign: 'right' }}>Value</th>
              </tr>
            </thead>
            <tbody>
              {breakdownQ.isLoading && (
                <tr><td colSpan={4} className={styles.emptyRow}>Loading…</td></tr>
              )}
              {!breakdownQ.isLoading && breakdownAll.length === 0 && (
                <tr><td colSpan={4} className={styles.emptyRow}>No warehouse balances for this SKU.</td></tr>
              )}
              {!breakdownQ.isLoading && breakdownAll.map((b) => {
                const qtyClass = b.qty > 0 ? styles.numCellPos
                  : b.qty < 0 ? styles.numCellNeg
                  : styles.numCellZero;
                return (
                  <tr key={b.warehouse_id}>
                    <td><span className={styles.codeChip}>{b.warehouse_code ?? '—'}</span></td>
                    <td>{b.warehouse_name ?? '—'}</td>
                    <td className={`${styles.numCell} ${qtyClass}`}>
                      {b.qty.toLocaleString('en-MY')}
                    </td>
                    <td className={`${styles.numCell} ${styles.numCellZero}`}>
                      {b.value_sen && b.value_sen > 0 ? fmtRm(b.value_sen) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* ── Movements ledger ───────────────────────────────────────────── */}
      <section className={chrome.card}>
        <header className={chrome.cardHeader}>
          <h2 className={chrome.cardTitle}>
            Movements ({movementsWithBalance.length}{warehouseId ? ' · filtered' : ''})
          </h2>
        </header>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Date</th>
              <th>Type</th>
              <th>Source Doc</th>
              <th>Warehouse</th>
              <th style={{ textAlign: 'right' }}>Qty</th>
              <th style={{ textAlign: 'right' }}>Unit Cost</th>
              <th style={{ textAlign: 'right' }}>Running Balance</th>
              <th>Notes</th>
            </tr>
          </thead>
          <tbody>
            {movementsQ.isLoading && (
              <tr><td colSpan={8} className={styles.emptyRow}>Loading…</td></tr>
            )}
            {!movementsQ.isLoading && movementsQ.error && (
              <tr><td colSpan={8} className={styles.emptyRow}>
                <div className={styles.bannerWarn}>
                  <strong>Failed to load.</strong>{' '}
                  {movementsQ.error instanceof Error
                    ? movementsQ.error.message
                    : String(movementsQ.error)}
                </div>
              </td></tr>
            )}
            {!movementsQ.isLoading && !movementsQ.error && movementsWithBalance.length === 0 && (
              <tr><td colSpan={8} className={styles.emptyRow}>No movements for this SKU yet.</td></tr>
            )}
            {!movementsQ.isLoading && movementsWithBalance.map((m) => {
              const wh = warehouses.find((w) => w.id === m.warehouse_id);
              const href = docHrefFor(m);
              const qtySign = m.movement_type === 'IN'
                ? '+'
                : m.movement_type === 'OUT'
                  ? '−'
                  : m.qty > 0 ? '+' : m.qty < 0 ? '−' : '';
              const qtyClass = m.qty > 0 ? styles.numCellPos
                : m.qty < 0 ? styles.numCellNeg
                : styles.numCellZero;
              return (
                <tr key={m.id}>
                  <td className={styles.numCellZero}>{fmtDateTime(m.created_at)}</td>
                  <td>
                    <span className={`${styles.movementPill} ${
                      m.movement_type === 'IN' ? styles.movementIn
                      : m.movement_type === 'OUT' ? styles.movementOut
                      : styles.movementAdj
                    }`}>
                      {m.movement_type === 'IN' && (
                        <ArrowDownLeft size={11} strokeWidth={2} style={{ marginRight: 4 }} />
                      )}
                      {m.movement_type === 'OUT' && (
                        <ArrowUpRight size={11} strokeWidth={2} style={{ marginRight: 4 }} />
                      )}
                      {m.movement_type}
                    </span>
                  </td>
                  <td>
                    {m.source_doc_no ? (
                      href ? (
                        <Link to={href} className={styles.docLink}>{m.source_doc_no}</Link>
                      ) : (
                        <span className={styles.docLink}>{m.source_doc_no}</span>
                      )
                    ) : (
                      <span className={styles.numCellZero}>—</span>
                    )}
                  </td>
                  <td>{wh ? `${wh.code} · ${wh.name}` : '—'}</td>
                  <td className={`${styles.numCell} ${qtyClass}`}>
                    {qtySign}{Math.abs(m.qty).toLocaleString('en-MY')}
                  </td>
                  <td className={`${styles.numCell} ${styles.numCellZero}`}>
                    {m.unit_cost_sen && m.unit_cost_sen > 0 ? fmtRm(m.unit_cost_sen) : '—'}
                  </td>
                  <td className={`${styles.numCell}`} style={{ fontWeight: 700 }}>
                    {m.runningBalance.toLocaleString('en-MY')}
                  </td>
                  <td className={styles.numCellZero}>{m.notes ?? '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {/* ── FIFO Lots ──────────────────────────────────────────────────── */}
      <section className={chrome.card}>
        <header
          className={chrome.cardHeader}
          style={{ cursor: 'pointer' }}
          onClick={() => setLotsOpen((v) => !v)}
        >
          <h2 className={chrome.cardTitle} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {lotsOpen ? <ChevronDown size={14} strokeWidth={1.75} /> : <ChevronRight size={14} strokeWidth={1.75} />}
            FIFO Lots ({lots.length}{includeClosed ? ' · incl closed' : ' · open only'})
          </h2>
          <label
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 'var(--fs-13)', fontFamily: 'var(--font-sans)',
              color: 'var(--c-ink)', cursor: 'pointer',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="checkbox"
              checked={includeClosed}
              onChange={(e) => setIncludeClosed(e.target.checked)}
            />
            Show closed lots
          </label>
        </header>
        {lotsOpen && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Received At</th>
                <th>Source Doc</th>
                <th>Warehouse</th>
                <th style={{ textAlign: 'right' }}>Qty Received</th>
                <th style={{ textAlign: 'right' }}>Qty Remaining</th>
                <th style={{ textAlign: 'right' }}>Unit Cost</th>
                <th style={{ textAlign: 'right' }}>Remaining Value</th>
              </tr>
            </thead>
            <tbody>
              {lotsQ.isLoading && (
                <tr><td colSpan={7} className={styles.emptyRow}>Loading lots…</td></tr>
              )}
              {!lotsQ.isLoading && lots.length === 0 && (
                <tr><td colSpan={7} className={styles.emptyRow}>
                  {includeClosed ? 'No lots ever recorded for this SKU.' : 'No open lots — toggle "Show closed lots" to see consumed ones.'}
                </td></tr>
              )}
              {!lotsQ.isLoading && lots.map((l) => {
                const closed = l.qty_remaining === 0;
                const remainingValue =
                  l.remaining_value_sen ?? l.qty_remaining * l.unit_cost_sen;
                return (
                  <tr key={l.id} style={closed ? { opacity: 0.55 } : undefined}>
                    <td className={styles.numCellZero}>{fmtDateTime(l.received_at)}</td>
                    <td>
                      {l.source_doc_no
                        ? <span className={styles.docLink}>{l.source_doc_no}</span>
                        : <span className={styles.numCellZero}>—</span>}
                    </td>
                    <td>{l.warehouse_code ?? '—'}</td>
                    <td className={`${styles.numCell} ${styles.numCellZero}`}>
                      {l.qty_received.toLocaleString('en-MY')}
                    </td>
                    <td className={`${styles.numCell} ${closed ? styles.numCellZero : styles.numCellPos}`}>
                      {l.qty_remaining.toLocaleString('en-MY')}
                      {closed && (
                        <span style={{
                          marginLeft: 6, fontSize: 'var(--fs-11)',
                          color: 'var(--fg-muted)', fontWeight: 500,
                        }}>closed</span>
                      )}
                    </td>
                    <td className={`${styles.numCell} ${styles.numCellZero}`}>{fmtRm(l.unit_cost_sen)}</td>
                    <td className={`${styles.numCell}`} style={{ fontWeight: 700 }}>
                      {remainingValue > 0 ? fmtRm(remainingValue) : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
};
