// ----------------------------------------------------------------------------
// StockAdjustmentNew — manual stock correction form at /inventory/adjustments/new.
//
// Follows PurchaseOrderNew's full-page pattern: back link + title + Cancel/Save
// in the headerRow, header card with formGrid2 fields, soft hint rows for
// current/resulting balance, POST via useStockAdjustment.
//
// +/- UX decision: the qty input is always a positive integer; the sign comes
// from a segmented "Adjustment Type" control (Increase / Decrease). Commander
// types absolute values + picks intent — eliminates negative-typed mistakes
// and surfaces the audit reason (write-off vs found stock) up front.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save, X, Minus, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useWarehouses,
  useStockAdjustment,
  useInventoryProductBreakdown,
} from '../lib/inventory-queries';
import { useMfgProducts } from '../lib/mfg-products-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

type AdjustmentType = 'increase' | 'decrease';

export const StockAdjustmentNew = () => {
  const navigate = useNavigate();
  const adjust   = useStockAdjustment();

  // ── Form state ─────────────────────────────────────────────────────
  const [warehouseId, setWarehouseId] = useState<string>('');
  const [productCode, setProductCode] = useState<string>('');
  const [productName, setProductName] = useState<string>('');
  const [type, setType]               = useState<AdjustmentType>('decrease');
  const [qty, setQty]                 = useState<number>(1);
  const [notes, setNotes]             = useState<string>('');

  // ── Data ───────────────────────────────────────────────────────────
  const warehouses = useWarehouses();
  const allSkus    = useMfgProducts();
  // Drive the breakdown lookup off the picked code. The hook only fires
  // when productCode is non-empty (enabled guard inside the hook).
  const breakdown  = useInventoryProductBreakdown(productCode || null);

  // Current balance @ chosen warehouse. Pulls from showAll=true so even
  // zero-stock rows appear (commander needs to be able to adjust into
  // existence, e.g. recount up from 0).
  const currentBalance: number | null = useMemo(() => {
    if (!warehouseId || !productCode) return null;
    const balances = breakdown.data?.balances ?? [];
    const row = balances.find((b) =>
      b.warehouse_id === warehouseId && b.product_code === productCode,
    );
    if (!row) return breakdown.isLoading ? null : 0;
    return row.qty ?? 0;
  }, [warehouseId, productCode, breakdown.data, breakdown.isLoading]);

  const qtyDelta = type === 'increase' ? qty : -qty;
  const resultingBalance: number | null = currentBalance == null ? null : currentBalance + qtyDelta;
  const willGoNegative = resultingBalance != null && resultingBalance < 0;

  const canSave = Boolean(
    warehouseId &&
    productCode.trim() &&
    qty > 0 &&
    notes.trim(),
  );

  // SKU picker — when commander types/picks a code that matches an mfg
  // product, auto-fill product_name (kept editable for catalog-less SKUs).
  const onPickSku = (code: string) => {
    setProductCode(code);
    const sku = (allSkus.data ?? []).find((p) => p.code === code);
    if (sku) setProductName(sku.name);
  };

  const onSave = () => {
    if (!canSave) {
      window.alert('Fill Warehouse, SKU, Qty, and Reason / Notes before saving.');
      return;
    }
    if (willGoNegative) {
      const proceed = window.confirm(
        `This adjustment will push the balance to ${resultingBalance} (below zero). Continue?`,
      );
      if (!proceed) return;
    }
    adjust.mutate(
      {
        warehouseId,
        productCode: productCode.trim(),
        productName: productName.trim() || undefined,
        qtyDelta,
        notes: notes.trim(),
      },
      {
        onSuccess: () => navigate('/inventory/adjustments'),
        onError:   (err) => window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/inventory/adjustments" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Stock Adjustments</span>
          </Link>
          <h1 className={styles.title}>New Stock Adjustment</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/inventory/adjustments')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button variant="primary" size="md" onClick={onSave} disabled={adjust.isPending}>
            <Save {...ICON} />
            {adjust.isPending ? 'Saving…' : 'Save Adjustment'}
          </Button>
        </div>
      </div>

      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Adjustment</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            {/* Warehouse */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Warehouse *</span>
              <select
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className={styles.fieldInput}
              >
                <option value="">— Pick a warehouse —</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
            </label>

            {/* SKU */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>SKU *</span>
              <input
                type="text"
                list="stock-adjustment-skus"
                value={productCode}
                onChange={(e) => onPickSku(e.target.value)}
                placeholder="Type or pick a SKU code…"
                className={styles.fieldInput}
                style={{ fontFamily: 'var(--font-mono)' }}
              />
              <datalist id="stock-adjustment-skus">
                {(allSkus.data ?? []).map((p) => (
                  <option key={p.id} value={p.code}>{p.name} · {p.category}</option>
                ))}
              </datalist>
            </label>

            {/* Product name — read-only, auto-filled */}
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.fieldLabel}>Product Name</span>
              <input
                type="text"
                value={productName}
                onChange={(e) => setProductName(e.target.value)}
                placeholder="(auto-filled when SKU picked — editable for free-text adjustments)"
                className={styles.fieldInput}
                style={{ background: 'var(--c-cream)', color: 'var(--c-ink)' }}
              />
            </label>
          </div>

          {/* Current balance hint — appears once both warehouse + SKU are set */}
          {warehouseId && productCode && (
            <div style={{
              marginTop: 'var(--space-3)',
              background: 'var(--c-cream)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3)',
              fontSize: 'var(--fs-13)',
              color: 'var(--fg-muted)',
              display: 'flex',
              gap: 'var(--space-4)',
              flexWrap: 'wrap',
            }}>
              <span>
                Current balance:{' '}
                <strong style={{ color: 'var(--c-ink)', fontFamily: 'var(--font-mono)' }}>
                  {breakdown.isLoading ? '…' : (currentBalance ?? 0).toLocaleString('en-MY')} PCS
                </strong>
              </span>
              {resultingBalance != null && (
                <span>
                  Resulting balance:{' '}
                  <strong style={{
                    color: willGoNegative ? 'var(--c-festive-b, #B8331F)' : 'var(--c-ink)',
                    fontFamily: 'var(--font-mono)',
                  }}>
                    {(currentBalance ?? 0).toLocaleString('en-MY')}
                    {' '}{type === 'increase' ? '+' : '−'}{' '}{qty.toLocaleString('en-MY')}
                    {' = '}{resultingBalance.toLocaleString('en-MY')} PCS
                  </strong>
                </span>
              )}
            </div>
          )}

          {/* Adjustment type — segmented (+/−) */}
          <div style={{ marginTop: 'var(--space-4)' }}>
            <div className={styles.fieldLabel} style={{ marginBottom: 6 }}>Adjustment Type *</div>
            <div style={{ display: 'inline-flex', gap: 0, borderRadius: 'var(--radius-md)', overflow: 'hidden', border: '1px solid var(--line)' }}>
              <button
                type="button"
                onClick={() => setType('increase')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: 'var(--space-2) var(--space-4)',
                  fontFamily: 'var(--font-button)', fontSize: 'var(--fs-13)', fontWeight: 600,
                  background: type === 'increase' ? 'var(--c-secondary-a, #2F5D4F)' : 'var(--c-paper)',
                  color:      type === 'increase' ? 'var(--c-cream)' : 'var(--c-ink)',
                  border: 'none', cursor: 'pointer',
                }}
              >
                <Plus size={14} strokeWidth={2} /> Increase (found / recount up)
              </button>
              <button
                type="button"
                onClick={() => setType('decrease')}
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 6,
                  padding: 'var(--space-2) var(--space-4)',
                  fontFamily: 'var(--font-button)', fontSize: 'var(--fs-13)', fontWeight: 600,
                  background: type === 'decrease' ? 'var(--c-festive-b, #B8331F)' : 'var(--c-paper)',
                  color:      type === 'decrease' ? 'var(--c-cream)' : 'var(--c-ink)',
                  border: 'none', borderLeft: '1px solid var(--line)', cursor: 'pointer',
                }}
              >
                <Minus size={14} strokeWidth={2} /> Decrease (write-off / damage / loss)
              </button>
            </div>
          </div>

          <div className={styles.formGrid2} style={{ marginTop: 'var(--space-4)' }}>
            {/* Qty — absolute value */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Qty * (positive integer)</span>
              <input
                type="number"
                min={1}
                step={1}
                value={qty}
                onChange={(e) => {
                  const n = Math.max(0, Math.floor(Number(e.target.value) || 0));
                  setQty(n);
                }}
                className={styles.fieldInput}
                style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
              />
            </label>

            {/* Notes — required for audit trail */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Reason / Notes *</span>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Why this adjustment? e.g. 'Damaged in transit, lot #4', 'Found 2 PCS during recount on 27/05'"
                className={styles.fieldInput}
                rows={3}
                style={{ minHeight: 52, resize: 'vertical' }}
              />
            </label>
          </div>

          {/* Negative balance warning — non-blocking, commander can still save */}
          {willGoNegative && (
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
              <span>
                This will push the warehouse balance to <strong>{resultingBalance}</strong> (below zero).
                You'll be asked to confirm on Save — proceed at your discretion.
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
