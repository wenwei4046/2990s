// ----------------------------------------------------------------------------
// StockTransferDetail — header + lines at /inventory/transfers/:id.
//
// DRAFT: editable (Save / Post / Cancel / Delete).
// POSTED: read-only with status pill; movements already wrote.
// CANCELLED: read-only.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import {
  ArrowLeft, ArrowRight, Save, X, Plus, Trash2, Send, Ban, AlertTriangle,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useWarehouses,
  useInventoryBalances,
} from '../lib/inventory-queries';
import { useMfgProducts } from '../lib/mfg-products-queries';
import {
  useStockTransferDetail,
  useUpdateStockTransfer,
  usePostStockTransfer,
  useCancelStockTransfer,
  useDeleteStockTransfer,
  type StockTransferItemInput,
  type StockTransferStatus,
} from '../lib/stock-transfers-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

type LineDraft = StockTransferItemInput & { _key: string };

const newKey = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const STATUS_TONE: Record<StockTransferStatus, { bg: string; fg: string; label: string }> = {
  DRAFT:     { bg: 'rgba(34, 31, 32, 0.08)',  fg: 'var(--fg-muted)',                label: 'Draft' },
  POSTED:    { bg: 'rgba(47, 93, 79, 0.16)',  fg: 'var(--c-secondary-a, #2F5D4F)',  label: 'Posted' },
  CANCELLED: { bg: 'rgba(184, 51, 31, 0.10)', fg: 'var(--c-festive-b, #B8331F)',    label: 'Cancelled' },
};

const fmtDateTime = (iso: string | null): string => {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return iso;
  return d.toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
};

export const StockTransferDetail = () => {
  const { id }   = useParams<{ id: string }>();
  const navigate = useNavigate();

  const detail   = useStockTransferDetail(id ?? null);
  const update   = useUpdateStockTransfer();
  const post     = usePostStockTransfer();
  const cancel   = useCancelStockTransfer();
  const del      = useDeleteStockTransfer();

  const warehouses = useWarehouses();
  const allSkus    = useMfgProducts();

  // ── Draft state mirrored from server ─────────────────────────────────
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId,   setToWarehouseId]   = useState('');
  const [transferDate,    setTransferDate]    = useState('');
  const [notes,           setNotes]           = useState('');
  const [lines,           setLines]           = useState<LineDraft[]>([]);
  const [dirty,           setDirty]           = useState(false);

  // Hydrate when detail loads / refreshes.
  useEffect(() => {
    if (!detail.data) return;
    const t = detail.data.transfer;
    setFromWarehouseId(t.from_warehouse_id);
    setToWarehouseId(t.to_warehouse_id);
    setTransferDate(t.transfer_date);
    setNotes(t.notes ?? '');
    setLines(detail.data.lines.map((l) => ({
      _key:        newKey(),
      productCode: l.product_code,
      productName: l.product_name ?? '',
      qty:         l.qty,
      notes:       l.notes ?? '',
    })));
    setDirty(false);
  }, [detail.data]);

  const status: StockTransferStatus | undefined = detail.data?.transfer.status;
  const isDraft = status === 'DRAFT';
  const tone    = status ? STATUS_TONE[status] : null;

  // Live "available" balance against the source warehouse — only useful for DRAFT.
  const balances = useInventoryBalances({
    warehouseId: fromWarehouseId || undefined,
    showAll:     true,
  });
  const balanceMap = useMemo(() => {
    const m = new Map<string, number>();
    for (const b of (balances.data?.balances ?? [])) m.set(b.product_code, b.qty);
    return m;
  }, [balances.data]);

  const skuByCode = useMemo(
    () => new Map((allSkus.data ?? []).map((p) => [p.code, p])),
    [allSkus.data],
  );

  const setLine = (key: string, patch: Partial<LineDraft>) => {
    setLines((cur) => cur.map((l) => (l._key === key ? { ...l, ...patch } : l)));
    setDirty(true);
  };
  const onPickCode = (key: string, code: string) => {
    const sku = skuByCode.get(code);
    setLine(key, { productCode: code, productName: sku?.name ?? '' });
  };
  const addLine = () => {
    setLines((cur) => [...cur, { _key: newKey(), productCode: '', productName: '', qty: 1, notes: '' }]);
    setDirty(true);
  };
  const removeLine = (key: string) => {
    setLines((cur) => cur.filter((l) => l._key !== key));
    setDirty(true);
  };

  const sameWarehouse = Boolean(
    fromWarehouseId && toWarehouseId && fromWarehouseId === toWarehouseId,
  );
  const validLines = lines.filter((l) => l.productCode.trim() && l.qty > 0);
  const overdrawn  = validLines.filter((l) => {
    const a = balanceMap.get(l.productCode);
    return a != null && l.qty > a;
  });

  // ── Mutations ────────────────────────────────────────────────────────
  const onSave = () => {
    if (!id) return;
    if (sameWarehouse) { window.alert('Source and destination must differ.'); return; }
    if (validLines.length === 0) { window.alert('Add at least one valid line.'); return; }
    update.mutate(
      {
        id,
        fromWarehouseId,
        toWarehouseId,
        transferDate,
        notes: notes.trim() || null,
        items: validLines.map(({ _key: _ignored, ...rest }) => ({
          ...rest,
          productName: rest.productName?.trim() || undefined,
          notes:       rest.notes?.trim()       || undefined,
        })),
      },
      {
        onSuccess: () => { setDirty(false); detail.refetch(); },
        onError:   (err) => window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  const onPost = () => {
    if (!id) return;
    if (dirty) { window.alert('Save your changes before posting.'); return; }
    const baseMsg = overdrawn.length > 0
      ? `Warning: ${overdrawn.length} line${overdrawn.length === 1 ? '' : 's'} exceed available stock at source — posting will push the source balance negative.\n\n`
      : '';
    const proceed = window.confirm(
      `${baseMsg}Post this transfer? Inventory movements (OUT @source + IN @destination) will be written and cannot be unwound automatically.`,
    );
    if (!proceed) return;
    post.mutate(id, {
      onSuccess: (res) => {
        detail.refetch();
        if (res.movementErrors && res.movementErrors.length > 0) {
          window.alert(
            `Transfer posted, but some movements failed:\n\n${res.movementErrors.join('\n')}\n\nFix manually via Stock Adjustments.`,
          );
        }
      },
      onError: (err) => window.alert(`Post failed: ${err instanceof Error ? err.message : String(err)}`),
    });
  };

  const onCancel = () => {
    if (!id) return;
    const proceed = window.confirm('Cancel this DRAFT transfer? It will be marked cancelled and locked.');
    if (!proceed) return;
    cancel.mutate(id, {
      onSuccess: () => detail.refetch(),
      onError: (err) => window.alert(`Cancel failed: ${err instanceof Error ? err.message : String(err)}`),
    });
  };

  const onDelete = () => {
    if (!id) return;
    const proceed = window.confirm('Delete this DRAFT transfer permanently?');
    if (!proceed) return;
    del.mutate(id, {
      onSuccess: () => navigate('/inventory/transfers'),
      onError: (err) => window.alert(`Delete failed: ${err instanceof Error ? err.message : String(err)}`),
    });
  };

  // ── Render ───────────────────────────────────────────────────────────
  if (detail.isLoading) {
    return <div className={styles.page}><p className={styles.subtitle}>Loading…</p></div>;
  }
  if (detail.error || !detail.data) {
    return (
      <div className={styles.page}>
        <p className={styles.subtitle}>
          {detail.error instanceof Error ? detail.error.message : 'Transfer not found.'}
        </p>
        <Link to="/inventory/transfers">Back to Stock Transfers</Link>
      </div>
    );
  }

  const t = detail.data.transfer;

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/inventory/transfers" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Stock Transfers</span>
          </Link>
          <h1 className={styles.title}>
            {t.transfer_no}
            {tone && (
              <span style={{
                marginLeft: 'var(--space-3)',
                display: 'inline-flex', alignItems: 'center',
                padding: '4px 10px', borderRadius: 'var(--radius-pill)',
                fontFamily: 'var(--font-button)', fontSize: 'var(--fs-12)', fontWeight: 600,
                background: tone.bg, color: tone.fg, letterSpacing: '0.04em',
                verticalAlign: 'middle',
              }}>
                {tone.label}
              </span>
            )}
          </h1>
          <p className={styles.subtitle}>
            Created {fmtDateTime(t.created_at)}
            {t.posted_at    ? ` · Posted ${fmtDateTime(t.posted_at)}`       : ''}
            {t.cancelled_at ? ` · Cancelled ${fmtDateTime(t.cancelled_at)}` : ''}
          </p>
        </div>
        <div className={styles.actions}>
          {isDraft && (
            <>
              <Button variant="ghost" size="md" onClick={onDelete} disabled={del.isPending}>
                <Trash2 {...ICON} /> Delete
              </Button>
              <Button variant="ghost" size="md" onClick={onCancel} disabled={cancel.isPending}>
                <Ban {...ICON} /> Cancel
              </Button>
              <Button variant="ghost" size="md" onClick={onSave} disabled={!dirty || update.isPending}>
                <Save {...ICON} /> {update.isPending ? 'Saving…' : 'Save'}
              </Button>
              <Button variant="primary" size="md" onClick={onPost} disabled={post.isPending || dirty}>
                <Send {...ICON} /> {post.isPending ? 'Posting…' : 'Post'}
              </Button>
            </>
          )}
          {!isDraft && (
            <Button variant="ghost" size="md" onClick={() => navigate('/inventory/transfers')}>
              <X {...ICON} /> Close
            </Button>
          )}
        </div>
      </div>

      {/* ── Header card ─────────────────────────────────────────────── */}
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
                onChange={(e) => { setFromWarehouseId(e.target.value); setDirty(true); }}
                className={styles.fieldSelect}
                disabled={!isDraft}
              >
                <option value="">— Pick source —</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                <ArrowRight size={11} strokeWidth={1.75} style={{ verticalAlign: 'middle', marginRight: 4 }} />
                To Warehouse *
              </span>
              <select
                value={toWarehouseId}
                onChange={(e) => { setToWarehouseId(e.target.value); setDirty(true); }}
                className={styles.fieldSelect}
                disabled={!isDraft}
              >
                <option value="">— Pick destination —</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id} disabled={w.id === fromWarehouseId}>
                    {w.code} · {w.name}{w.id === fromWarehouseId ? ' (source)' : ''}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Transfer Date *</span>
              <input
                type="date"
                value={transferDate}
                onChange={(e) => { setTransferDate(e.target.value); setDirty(true); }}
                className={styles.fieldInput}
                disabled={!isDraft}
              />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Notes</span>
              <input
                type="text"
                value={notes}
                onChange={(e) => { setNotes(e.target.value); setDirty(true); }}
                placeholder="(optional)"
                className={styles.fieldInput}
                disabled={!isDraft}
              />
            </label>
          </div>

          {sameWarehouse && isDraft && (
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
        </div>
      </section>

      {/* ── Lines card ──────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Items</h2>
          {isDraft && (
            <Button variant="ghost" size="sm" onClick={addLine}>
              <Plus size={14} strokeWidth={1.75} /> Add line
            </Button>
          )}
        </div>
        <div className={styles.cardBody}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: '20%' }}>SKU</th>
                <th>Description</th>
                {isDraft && <th style={{ width: 110, textAlign: 'right' }}>Available</th>}
                <th style={{ width: 110, textAlign: 'right' }}>Qty</th>
                {isDraft && <th style={{ width: 40 }} />}
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr><td colSpan={isDraft ? 5 : 3} className={styles.emptyRow}>
                  No lines yet.
                </td></tr>
              )}
              {lines.map((ln) => {
                const avail = ln.productCode ? balanceMap.get(ln.productCode) : undefined;
                const isOverdrawn = avail != null && ln.qty > avail;
                if (!isDraft) {
                  return (
                    <tr key={ln._key}>
                      <td><span className={styles.codeCell}>{ln.productCode}</span></td>
                      <td>{ln.productName || <span className={styles.muted}>—</span>}</td>
                      <td className={styles.tableRight} style={{ fontFamily: 'var(--font-mono)' }}>
                        {ln.qty.toLocaleString('en-MY')}
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={ln._key}>
                    <td>
                      <input
                        type="text"
                        list={`xfer-detail-skus-${ln._key}`}
                        value={ln.productCode}
                        onChange={(e) => onPickCode(ln._key, e.target.value)}
                        placeholder="Type code…"
                        className={styles.fieldInput}
                        style={{ fontFamily: 'var(--font-mono)' }}
                      />
                      <datalist id={`xfer-detail-skus-${ln._key}`}>
                        {(allSkus.data ?? []).map((p) => (
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
                              <span style={{ color: (avail ?? 0) > 0 ? 'var(--c-ink)' : 'var(--fg-muted)' }}>
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
                    <td className={styles.actionsCell}>
                      <button
                        type="button"
                        onClick={() => removeLine(ln._key)}
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
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

          {isDraft && (
            <div className={styles.addLineRow}>
              <Button variant="ghost" size="sm" onClick={addLine}>
                <Plus size={14} strokeWidth={1.75} /> Add line
              </Button>
            </div>
          )}

          {isDraft && overdrawn.length > 0 && (
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
                {' '}Posting will push the source balance negative.
              </span>
            </div>
          )}
        </div>
      </section>
    </div>
  );
};
