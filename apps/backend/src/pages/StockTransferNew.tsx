// ----------------------------------------------------------------------------
// StockTransferNew — full-page form at /inventory/transfers/new.
//
// Mirrors PurchaseOrderNew chrome: back link + title + Cancel/Save in the
// headerRow, header card with From/To/Date/Notes, items grid below with
// SKU picker + live current-balance lookup against the From warehouse.
// PR-DRAFT-removal (2026-05-27): Save creates as POSTED directly + writes
// inventory_movements inline; routes to /inventory/transfers/:id afterward.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, ArrowRight, Save, X, Plus, Trash2, AlertTriangle } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtCenti } from '@2990s/shared';
import { useConfirm } from '../components/ConfirmDialog';
import { useNotify } from '../components/NotifyDialog';
import {
  useWarehouses,
  useInventoryBalances,
  useInventoryValue,
} from '../lib/inventory-queries';
import { useMfgProducts } from '../lib/mfg-products-queries';
import {
  useCreateStockTransfer,
  type StockTransferItemInput,
} from '../lib/stock-transfers-queries';
import { DateField } from '../components/DateField';
import { sortByText } from '../lib/sort-options';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

type LineDraft = StockTransferItemInput & { _key: string };

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const blankLine = (): LineDraft => ({
  _key: newKey(),
  productCode: '',
  productName: '',
  qty: 1,
  notes: '',
});

const todayISO = () => {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const StockTransferNew = () => {
  const navigate = useNavigate();
  const create   = useCreateStockTransfer();

  const askConfirm = useConfirm();
  const notify = useNotify();

  // ── Header state ─────────────────────────────────────────────────────
  const [fromWarehouseId, setFromWarehouseId] = useState<string>('');
  const [toWarehouseId,   setToWarehouseId]   = useState<string>('');
  const [transferDate,    setTransferDate]    = useState<string>(todayISO());
  const [notes,           setNotes]           = useState<string>('');
  // Migration 0192 — sea-freight (MYR, a MY forwarder bill — no FX) that uplifts
  // the receiving lot cost (China → MY landed cost), + the allocation basis.
  // Entered in whole MYR for the operator; converted to sen on submit.
  const [freightMyr,        setFreightMyr]        = useState<string>('');
  const [allocationMethod,  setAllocationMethod]  = useState<'QTY' | 'VALUE' | 'CBM'>('QTY');

  // ── Lines ────────────────────────────────────────────────────────────
  const [lines, setLines] = useState<LineDraft[]>([blankLine()]);

  // ── Data ─────────────────────────────────────────────────────────────
  const warehouses = useWarehouses();
  const allSkus    = useMfgProducts();
  // Pull balances for the From warehouse so we can show "available" inline.
  const balances   = useInventoryBalances({
    warehouseId: fromWarehouseId || undefined,
    showAll:     true,
  });
  const balanceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of (balances.data?.balances ?? [])) {
      m.set(b.product_code, b.qty);
    }
    return m;
  }, [balances.data]);

  // Migration 0192 — average unit cost per SKU at the FROM warehouse, for the
  // landed-cost PREVIEW only. The authoritative per-line source cost is the FIFO
  // weighted-avg consumed on post (computed server-side); this avg is a close
  // proxy good enough to show the operator what the freight uplift will do.
  const valueQ = useInventoryValue({ warehouseId: fromWarehouseId || undefined });
  const costMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const v of (valueQ.data ?? [])) {
      if (v.product_code) m.set(v.product_code, Number(v.avg_unit_cost_sen ?? 0));
    }
    return m;
  }, [valueQ.data]);

  // ── Helpers ──────────────────────────────────────────────────────────
  const skuByCode = useMemo(
    () => new Map((allSkus.data ?? []).map((p) => [p.code, p])),
    [allSkus.data],
  );

  // Migration 0192 — surface the freight panel when the FROM warehouse is a
  // transit (overseas/China) warehouse. The owner can still toggle it open for
  // any source — a sea-freight uplift is allowed on any transfer.
  // Dual-read camelCase / snake_case: the pg driver can hand back either casing.
  const fromIsTransit = useMemo(
    () => (warehouses.data ?? []).some((w) => {
      const t = (w as { isTransit?: boolean }).isTransit ?? w.is_transit;
      return w.id === fromWarehouseId && Boolean(t);
    }),
    [warehouses.data, fromWarehouseId],
  );
  // For a transit source the sea-freight uplift is the EXPECTED path, so the
  // panel auto-expands prominently; for an ordinary domestic source it stays
  // collapsed behind a small "Add sea-freight" affordance (the owner can still
  // open it). 0 freight stays valid either way (cost-neutral transfer).
  const [freightOpen, setFreightOpen] = useState(false);
  const showFreight = fromIsTransit || freightOpen;

  // Sea-freight in MYR sen (centi). Blank / non-positive ⇒ 0 ⇒ cost-neutral.
  const freightCenti = useMemo(() => {
    const myr = Number(freightMyr);
    return Number.isFinite(myr) && myr > 0 ? Math.round(myr * 100) : 0;
  }, [freightMyr]);

  const setLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((cur) => cur.map((l) => (l._key === key ? { ...l, ...patch } : l)));
  };

  const onPickCode = (key: string, code: string) => {
    const sku = skuByCode.get(code);
    setLine(key, {
      productCode: code,
      productName: sku?.name ?? '',
    });
  };

  const addLine    = () => setLines((cur) => [...cur, blankLine()]);
  const removeLine = (key: string) =>
    setLines((cur) => (cur.length <= 1 ? cur : cur.filter((l) => l._key !== key)));

  // ── Validation ───────────────────────────────────────────────────────
  const sameWarehouse = Boolean(
    fromWarehouseId && toWarehouseId && fromWarehouseId === toWarehouseId,
  );
  const validLines = lines.filter((l) => l.productCode.trim() && l.qty > 0);
  const overdrawn = validLines.filter((l) => {
    const avail = balanceMap.get(l.productCode);
    if (avail == null) return false; // unknown — don't block
    return l.qty > avail;
  });

  const canSave = Boolean(
    fromWarehouseId &&
    toWarehouseId &&
    !sameWarehouse &&
    transferDate &&
    validLines.length > 0,
  );

  /* Migration 0192 — client-side landed-cost PREVIEW. Mirrors the server
     allocator (lib/landed-allocation.ts): pool freightCenti, split across the
     valid lines by QTY / VALUE (qty × avg source cost) / CBM (qty × unit_m3),
     last line absorbs the rounding remainder (Σ === pool), fall back to QTY when
     the chosen basis Σ ≤ 0. Source cost = the FROM-warehouse avg (a proxy for
     the FIFO weighted-avg the server consumes on post). freight 0 ⇒ landed ===
     source everywhere. Keyed by line _key. */
  const preview = useMemo(() => {
    const out = new Map<string, { sourceUnitSen: number; allocatedCenti: number; landedUnitSen: number }>();
    const rows = validLines.map((l) => {
      const sourceUnitSen = costMap.get(l.productCode) ?? 0;
      const m3 = skuByCode.get(l.productCode)?.unit_m3_milli ?? 0;
      return { key: l._key, qty: Math.max(0, l.qty), sourceUnitSen, m3 };
    });
    const basisOf = (m: 'QTY' | 'VALUE' | 'CBM', r: typeof rows[number]) =>
      m === 'VALUE' ? r.qty * r.sourceUnitSen
      : m === 'CBM' ? r.qty * Math.max(0, r.m3)
      : r.qty;
    let method = allocationMethod;
    let sumBasis = rows.reduce((s, r) => s + basisOf(method, r), 0);
    if (sumBasis <= 0 && method !== 'QTY') { method = 'QTY'; sumBasis = rows.reduce((s, r) => s + basisOf(method, r), 0); }
    let allocatedSoFar = 0;
    rows.forEach((r, i) => {
      const isLast = i === rows.length - 1;
      let alloc: number;
      if (freightCenti === 0 || sumBasis <= 0) alloc = 0;
      else if (isLast) alloc = freightCenti - allocatedSoFar;
      else { alloc = Math.round((freightCenti * basisOf(method, r)) / sumBasis); allocatedSoFar += alloc; }
      const perUnit = r.qty > 0 ? Math.round(alloc / r.qty) : 0;
      out.set(r.key, { sourceUnitSen: r.sourceUnitSen, allocatedCenti: alloc, landedUnitSen: r.sourceUnitSen + perUnit });
    });
    return out;
  }, [validLines, costMap, skuByCode, freightCenti, allocationMethod]);

  const onSave = async () => {
    if (!canSave) {
      notify({ title: 'Pick From + To warehouses (must differ), date, and at least one valid line.', tone: 'error' });
      return;
    }
    if (overdrawn.length > 0) {
      const proceed = await askConfirm({
        title: 'Some lines exceed available stock at the source warehouse',
        body:
          overdrawn.map((l) => `  ${l.productCode}: want ${l.qty}, have ${balanceMap.get(l.productCode) ?? 0}`).join('\n') +
          `\n\nSaving will post immediately and push the source balance negative. Continue?`,
        confirmLabel: 'Post anyway',
        danger: true,
      });
      if (!proceed) return;
    }

    create.mutate(
      {
        fromWarehouseId,
        toWarehouseId,
        transferDate,
        // Migration 0192 — only send freight when present, so a normal (no-
        // freight) transfer posts exactly as before (cost-neutral).
        ...(freightCenti > 0 ? { freightCenti, allocationMethod } : {}),
        notes: notes.trim() || undefined,
        items: validLines.map(({ _key: _ignored, ...rest }) => ({
          ...rest,
          productName: rest.productName?.trim() || undefined,
          notes:       rest.notes?.trim()       || undefined,
        })),
      },
      {
        onSuccess: (res) => navigate(`/inventory/transfers/${res.id}`),
        onError:   (err) => notify({ title: 'Save failed', body: err instanceof Error ? err.message : String(err), tone: 'error' }),
      },
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/inventory/transfers" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Stock Transfers</span>
          </Link>
          <h1 className={styles.title}>New Stock Transfer</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/inventory/transfers')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button variant="primary" size="md" onClick={onSave} disabled={create.isPending}>
            <Save {...ICON} />
            {create.isPending ? 'Posting…' : 'Post Transfer'}
          </Button>
        </div>
      </div>

      {/* ── Header card ──────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Transfer</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid4}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>From Warehouse *</span>
              <select
                value={fromWarehouseId}
                onChange={(e) => setFromWarehouseId(e.target.value)}
                className={styles.fieldSelect}
              >
                <option value="">— Pick source —</option>
                {/* Transit warehouses are tagged inline so the operator can spot
                    the overseas/China landing source (native <option> can't take
                    a styled pill). Dual-read camelCase / snake_case. */}
                {sortByText(warehouses.data ?? []).map((w) => {
                  const t = (w as { isTransit?: boolean }).isTransit ?? w.is_transit;
                  return (
                    <option key={w.id} value={w.id}>
                      {w.code} · {w.name}{t ? ' · Transit' : ''}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                <ArrowRight size={11} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                To Warehouse *
              </span>
              <select
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                className={styles.fieldSelect}
              >
                <option value="">— Pick destination —</option>
                {sortByText(warehouses.data ?? []).map((w) => {
                  const t = (w as { isTransit?: boolean }).isTransit ?? w.is_transit;
                  return (
                    <option key={w.id} value={w.id} disabled={w.id === fromWarehouseId}>
                      {w.code} · {w.name}{t ? ' · Transit' : ''}{w.id === fromWarehouseId ? ' (source)' : ''}
                    </option>
                  );
                })}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Transfer Date *</span>
              <DateField
                value={transferDate ?? ''}
                onChange={(iso) => setTransferDate(iso)}
                className={styles.fieldInput}
                fullWidth
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Notes</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="(optional)"
                className={styles.fieldInput}
              />
            </label>
          </div>

          {sameWarehouse && (
            <div style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              background: 'rgba(184, 51, 31, 0.08)',
              border: '1px solid var(--c-festive-b, #B8331F)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-13)',
              color: 'var(--c-festive-b, #B8331F)',
              display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
            }}>
              <AlertTriangle size={16} strokeWidth={1.75} />
              <span>Source and destination warehouses must be different.</span>
            </div>
          )}

          {/* ── Sea-freight (migration 0192) ──────────────────────────────
              When the FROM warehouse is a TRANSIT (overseas/China) warehouse the
              sea-freight uplift is the EXPECTED path, so the panel auto-expands
              and is styled prominently (the is_transit flag DRIVES this). For an
              ordinary domestic source it stays collapsed behind a small affordance
              (the owner can still open it). Freight is a MY forwarder bill in MYR
              (no FX) that lands the cost in the destination (MY) lot. */}
          <div style={{ marginTop: 'var(--space-3)' }}>
            {!showFreight && (
              <Button variant="ghost" size="sm" onClick={() => setFreightOpen(true)}>
                <Plus size={14} strokeWidth={1.75} /> Add sea-freight (landed cost)
              </Button>
            )}
            {showFreight && (
              <div style={{
                padding: 'var(--space-3) var(--space-4)',
                // Transit source → prominent (secondary-green tint + accent
                // border) so it reads as the expected step; ordinary source →
                // quiet cream panel.
                background: fromIsTransit ? 'rgba(47, 93, 79, 0.06)' : 'var(--c-cream, rgba(0,0,0,0.02))',
                border: fromIsTransit
                  ? '1px solid var(--c-secondary-a, #2F5D4F)'
                  : '1px solid var(--c-line, #E5E1DA)',
                borderRadius: 'var(--radius-md)',
              }}>
                <div style={{
                  fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 'var(--space-2)',
                  display: 'flex', alignItems: 'center', gap: 'var(--space-2)',
                }}>
                  <ArrowRight size={13} strokeWidth={1.75} />
                  {fromIsTransit ? 'Sea freight (transit → local)' : 'Sea-freight (landed cost)'}
                  {fromIsTransit && (
                    <span style={{
                      fontSize: 'var(--fs-11)', fontWeight: 600, letterSpacing: '0.02em',
                      padding: '1px 8px', borderRadius: 'var(--radius-pill, 999px)',
                      background: 'rgba(47, 93, 79, 0.16)', color: 'var(--c-secondary-a, #2F5D4F)',
                    }}>
                      Transit source
                    </span>
                  )}
                </div>
                <div className={styles.formGrid4}>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Sea-freight (MYR)</span>
                    <input
                      type="number" min={0} step="0.01"
                      value={freightMyr}
                      onChange={(e) => setFreightMyr(e.target.value)}
                      placeholder="0.00"
                      className={styles.fieldInput}
                      style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                    />
                  </label>
                  <label className={styles.field}>
                    <span className={styles.fieldLabel}>Allocation method</span>
                    <select
                      value={allocationMethod}
                      onChange={(e) => setAllocationMethod(e.target.value as 'QTY' | 'VALUE' | 'CBM')}
                      className={styles.fieldSelect}
                    >
                      <option value="QTY">By quantity</option>
                      <option value="VALUE">By value (cost)</option>
                      <option value="CBM">By volume (CBM)</option>
                    </select>
                  </label>
                </div>
                <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-soft)', marginTop: 'var(--space-2)' }}>
                  {fromIsTransit
                    ? 'Transit stock — add the sea-freight that lands the cost in the destination warehouse. Folded into each receiving lot so MY inventory carries the true landed cost. Leave 0 for a cost-neutral transfer.'
                    : "Folded into each receiving lot's cost so MY inventory carries the true landed cost. Leave 0 for a cost-neutral transfer."}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ── Items card ──────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Items</h2>
          <Button variant="ghost" size="sm" onClick={addLine}>
            <Plus size={14} strokeWidth={1.75} /> Add Line Item
          </Button>
        </div>
        <div className={styles.cardBody}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: '20%' }}>SKU *</th>
                <th>Description</th>
                <th style={{ width: 110, textAlign: 'right' }}>Available</th>
                <th style={{ width: 110, textAlign: 'right' }}>Qty *</th>
                {/* Migration 0192 — landed unit cost preview (when freight set). */}
                {showFreight && <th style={{ width: 140, textAlign: 'right' }}>Landed unit cost</th>}
                <th style={{ width: 40 }} />
              </tr>
            </thead>
            <tbody>
              {lines.map((ln) => {
                const avail = ln.productCode ? balanceMap.get(ln.productCode) : undefined;
                const isOverdrawn = avail != null && ln.qty > avail;
                return (
                  <tr key={ln._key}>
                    <td>
                      <input
                        type="text"
                        list={`xfer-skus-${ln._key}`}
                        value={ln.productCode}
                        onChange={(e) => onPickCode(ln._key, e.target.value)}
                        placeholder="Type code…"
                        className={styles.fieldInput}
                        style={{ fontFamily: 'var(--font-mono)' }}
                      />
                      <datalist id={`xfer-skus-${ln._key}`}>
                        {sortByText(allSkus.data ?? []).map((p) => (
                          <option key={p.id} value={p.code}>{p.name}</option>
                        ))}
                      </datalist>
                    </td>
                    <td>
                      <input
                        type="text"
                        value={ln.productName ?? ''}
                        onChange={(e) => setLine(ln._key, { productName: e.target.value })}
                        placeholder="(auto-filled when SKU picked)"
                        className={styles.fieldInput}
                        style={{ background: 'var(--c-cream)' }}
                      />
                    </td>
                    <td className={styles.tableRight}
                        style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>
                      {!fromWarehouseId
                        ? <span className={styles.muted}>—</span>
                        : !ln.productCode
                          ? <span className={styles.muted}>—</span>
                          : balances.isLoading
                            ? <span className={styles.muted}>…</span>
                            : (
                              <span style={{
                                color: (avail ?? 0) > 0 ? 'var(--c-ink)' : 'var(--fg-muted)',
                              }}>
                                {(avail ?? 0).toLocaleString('en-MY')}
                              </span>
                            )
                      }
                    </td>
                    <td className={styles.tableRight}>
                      <input
                        type="number"
                        min={1}
                        step={1}
                        value={ln.qty}
                        onChange={(e) => {
                          const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                          setLine(ln._key, { qty: n });
                        }}
                        className={styles.fieldInput}
                        style={{
                          textAlign: 'right',
                          fontFamily: 'var(--font-mono)',
                          color: isOverdrawn ? 'var(--c-festive-b, #B8331F)' : 'var(--c-ink)',
                        }}
                      />
                    </td>
                    {/* Migration 0192 — landed unit cost preview (source avg +
                        allocated freight per unit). Em-dash until a SKU/qty +
                        freight make it computable. */}
                    {showFreight && (
                      <td className={styles.tableRight}
                          style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-13)' }}>
                        {(() => {
                          const pv = preview.get(ln._key);
                          if (!ln.productCode.trim() || ln.qty <= 0 || !pv) return <span className={styles.muted}>—</span>;
                          const lifted = pv.landedUnitSen > pv.sourceUnitSen;
                          return (
                            <span title={`source ${fmtCenti(pv.sourceUnitSen)} + freight ${fmtCenti(pv.allocatedCenti)}`}
                              style={{ color: lifted ? 'var(--c-ink)' : 'var(--fg-soft)' }}>
                              {fmtCenti(pv.landedUnitSen)}
                            </span>
                          );
                        })()}
                      </td>
                    )}
                    <td className={styles.actionsCell}>
                      <button
                        type="button"
                        onClick={() => removeLine(ln._key)}
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        disabled={lines.length <= 1}
                        title="Remove line"
                      >
                        <Trash2 size={14} strokeWidth={1.75} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          <div className={styles.addLineRow}>
            <Button variant="ghost" size="sm" onClick={addLine}>
              <Plus size={14} strokeWidth={1.75} /> Add Line Item
            </Button>
          </div>

          {overdrawn.length > 0 && (
            <div style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-3) var(--space-4)',
              background: 'rgba(184, 51, 31, 0.08)',
              border: '1px solid var(--c-festive-b, #B8331F)',
              borderRadius: 'var(--radius-md)',
              fontSize: 'var(--fs-13)',
              color: 'var(--c-festive-b, #B8331F)',
              display: 'flex', alignItems: 'flex-start', gap: 'var(--space-2)',
            }}>
              <AlertTriangle size={16} strokeWidth={1.75} style={{ flexShrink: 0, marginTop: 2 }} />
              <span>
                <strong>{overdrawn.length} line{overdrawn.length === 1 ? '' : 's'} exceed available stock.</strong>
                {' '}Saving will post immediately and push the source balance negative.
                You'll be asked to confirm on Save.
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
