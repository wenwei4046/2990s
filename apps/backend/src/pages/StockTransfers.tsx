// ----------------------------------------------------------------------------
// StockTransfers — list at /inventory/transfers.
//
// Doc-style list of all stock transfers (POSTED / CANCELLED). Each
// transfer moves qty between two warehouses with a paired OUT+IN movement
// posted via the API. + New Transfer routes to /inventory/transfers/new.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Plus, SlidersHorizontal, ArrowRight } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useWarehouses } from '../lib/inventory-queries';
import {
  useStockTransfers,
  type StockTransferStatus,
} from '../lib/stock-transfers-queries';
import styles from './Inventory.module.css';

const ICON    = { size: 14, strokeWidth: 1.75 } as const;
const ICON_MD = { size: 16, strokeWidth: 1.75 } as const;

// PR-DRAFT-removal — DRAFT dropped (migration 0078). Transfers post on create.
const STATUS_OPTIONS: Array<StockTransferStatus | 'ALL'> = ['ALL', 'POSTED', 'CANCELLED'];

const STATUS_TONE: Record<StockTransferStatus, { bg: string; fg: string; label: string }> = {
  POSTED:    { bg: 'rgba(47, 93, 79, 0.16)',  fg: 'var(--c-secondary-a, #2F5D4F)', label: 'Posted' },
  CANCELLED: { bg: 'rgba(184, 51, 31, 0.10)', fg: 'var(--c-festive-b, #B8331F)',   label: 'Cancelled' },
};

const fmtDate = (iso: string): string => {
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

export const StockTransfers = () => {
  const navigate = useNavigate();
  const [status, setStatus]               = useState<StockTransferStatus | 'ALL'>('ALL');
  const [fromWarehouseId, setFromWarehouseId] = useState<string>('');
  const [toWarehouseId,   setToWarehouseId]   = useState<string>('');
  const [dateFrom, setDateFrom]           = useState<string>('');
  const [dateTo,   setDateTo]             = useState<string>('');

  const warehouses = useWarehouses();
  const wmap = useMemo(
    () => new Map((warehouses.data ?? []).map((w) => [w.id, w])),
    [warehouses.data],
  );

  const { data: transfers, isLoading, error } = useStockTransfers({
    status:           status === 'ALL' ? undefined : status,
    fromWarehouseId:  fromWarehouseId || undefined,
    toWarehouseId:    toWarehouseId   || undefined,
    dateFrom:         dateFrom || undefined,
    dateTo:           dateTo   || undefined,
  });

  const rows = transfers ?? [];

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <Link to="/inventory" className={styles.chip} style={{
            textDecoration: 'none', display: 'inline-flex', alignItems: 'center',
            gap: 4, marginBottom: 'var(--space-2)',
          }}>
            <ArrowLeft {...ICON} /> <span>Inventory</span>
          </Link>
          <h1 className={styles.title}>Stock Transfers</h1>
        </div>
        <Button variant="primary" size="md" onClick={() => navigate('/inventory/transfers/new')}>
          <Plus {...ICON_MD} />
          <span>New Transfer</span>
        </Button>
      </div>

      {/* Status pills */}
      <div className={styles.filterRow}>
        <div className={styles.warehouseChips}>
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              type="button"
              className={styles.chip}
              data-active={status === s}
              onClick={() => setStatus(s)}
            >
              {s === 'ALL' ? 'All status' : STATUS_TONE[s].label}
            </button>
          ))}
        </div>
      </div>

      {/* From / To warehouse + date range */}
      <div className={styles.filterRow}>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          <SlidersHorizontal size={12} strokeWidth={1.75} />
          From
          <select
            value={fromWarehouseId}
            onChange={(e) => setFromWarehouseId(e.target.value)}
            style={{
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)',
              background: 'var(--c-paper)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--c-ink)',
            }}
          >
            <option value="">Any warehouse</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          To
          <select
            value={toWarehouseId}
            onChange={(e) => setToWarehouseId(e.target.value)}
            style={{
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)',
              background: 'var(--c-paper)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--c-ink)',
            }}
          >
            <option value="">Any warehouse</option>
            {(warehouses.data ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </select>
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          Date from
          <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
            style={{
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)',
              background: 'var(--c-paper)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--c-ink)',
            }} />
        </label>
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          to
          <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
            style={{
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)',
              background: 'var(--c-paper)', border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)', padding: '6px 8px', color: 'var(--c-ink)',
            }} />
        </label>
        {(fromWarehouseId || toWarehouseId || dateFrom || dateTo || status !== 'ALL') && (
          <button
            type="button"
            className={styles.chip}
            onClick={() => {
              setStatus('ALL'); setFromWarehouseId(''); setToWarehouseId('');
              setDateFrom(''); setDateTo('');
            }}
          >
            Clear filters
          </button>
        )}
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading…' : `${rows.length} transfer${rows.length === 1 ? '' : 's'} (latest first)`}
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
              <th>ST #</th>
              <th>Date</th>
              <th>From → To</th>
              <th>Status</th>
              <th style={{ textAlign: 'right' }}>Lines</th>
              <th>Created By</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className={styles.emptyRow}>Loading…</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className={styles.emptyRow}>
                <div>No stock transfers yet.</div>
                <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                  Click "+ New Transfer" to create one.
                </div>
              </td></tr>
            )}
            {!isLoading && rows.map((t) => {
              const tone = STATUS_TONE[t.status];
              const fromW = t.from_warehouse ?? wmap.get(t.from_warehouse_id);
              const toW   = t.to_warehouse   ?? wmap.get(t.to_warehouse_id);
              return (
                <tr key={t.id} style={{ cursor: 'pointer' }}
                    onClick={() => navigate(`/inventory/transfers/${t.id}`)}>
                  <td>
                    <span className={styles.codeChip}>{t.transfer_no}</span>
                  </td>
                  <td className={styles.numCellZero}>{fmtDate(t.transfer_date)}</td>
                  <td>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <strong>{fromW ? fromW.code : '—'}</strong>
                      <ArrowRight size={12} strokeWidth={1.75} style={{ color: 'var(--fg-muted)' }} />
                      <strong>{toW ? toW.code : '—'}</strong>
                    </span>
                  </td>
                  <td>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center',
                      padding: '2px 8px', borderRadius: 'var(--radius-pill)',
                      fontFamily: 'var(--font-button)', fontSize: 'var(--fs-11)', fontWeight: 600,
                      background: tone.bg, color: tone.fg, letterSpacing: '0.02em',
                    }}>
                      {tone.label}
                    </span>
                  </td>
                  <td className={`${styles.numCell} ${styles.numCellZero}`}>
                    {(t.line_count ?? 0).toLocaleString('en-MY')}
                  </td>
                  <td className={styles.numCellZero}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-11)' }}>
                    {t.created_by ? t.created_by.slice(0, 8) : '—'}
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
