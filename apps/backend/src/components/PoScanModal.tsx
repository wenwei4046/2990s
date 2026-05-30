import { useMemo, useState } from 'react';
import { useSuppliers, type Supplier } from '../lib/queries';
import {
  createPO,
  openPrintWindow,
  buildWhatsAppShareUrl,
  buildMailtoUrl,
  type CreatePoInput,
} from '../lib/purchase-orders';
import styles from './PoScanModal.module.css';

interface OrderForScan {
  id: string;            // SO-9008
  customerName: string;
  cart: CartItem[];      // shape depends on existing OrderListItem; adapt as needed
}

interface CartItem {
  productId: string;
  productName: string;
  productCat: string;    // mattress | sofa | bedframe | dining | bathroom | kids | accessory
  supplierId: string | null;  // joined from products table; null falls to "uncategorized"
  sku: string;
  size: string | null;
  colour: string | null;
  qty: number;
}

interface RollupLine {
  sku: string;
  name: string;
  size: string | null;
  colour: string | null;
  qty: number;
  orderIds: Set<string>;
}

interface SupplierGroup {
  supplier: Supplier;
  items: Map<string, RollupLine>;  // dedup key: sku|colour
}

interface PostIssueState {
  poNumber: string;
  poId: string;
  lineCount: number;
  sourceOrderCount: number;
}

interface Props {
  orders: OrderForScan[];
  onClose: () => void;
  onIssued?: (orderIds: string[]) => void;  // notify parent so it refreshes lane
}

export function PoScanModal({ orders, onClose, onIssued }: Props) {
  const suppliersQuery = useSuppliers();
  const suppliersById = useMemo(() => {
    const map = new Map<string, Supplier>();
    (suppliersQuery.data ?? []).forEach((s) => map.set(s.id, s));
    return map;
  }, [suppliersQuery.data]);

  // Per-supplier post-issue state — set after a successful Generate PO call
  const [postIssue, setPostIssue] = useState<Record<string, PostIssueState>>({});
  const [loadingSupplier, setLoadingSupplier] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [view, setView] = useState<'rollup' | 'by-order'>('rollup');

  // Compute rollup-by-supplier (port of prototype's buildPoLines + aggregation logic)
  const rollup = useMemo<SupplierGroup[]>(() => {
    const map = new Map<string, SupplierGroup>();
    for (const order of orders) {
      for (const item of order.cart) {
        if (!item.supplierId) continue;
        const supplier = suppliersById.get(item.supplierId);
        if (!supplier) continue;
        let group = map.get(supplier.id);
        if (!group) {
          group = { supplier, items: new Map() };
          map.set(supplier.id, group);
        }
        const dedupKey = `${item.sku}|${item.colour ?? ''}`;
        const existing = group.items.get(dedupKey);
        if (existing) {
          existing.qty += item.qty;
          existing.orderIds.add(order.id);
        } else {
          group.items.set(dedupKey, {
            sku: item.sku,
            name: item.productName,
            size: item.size,
            colour: item.colour,
            qty: item.qty,
            orderIds: new Set([order.id]),
          });
        }
      }
    }
    return Array.from(map.values());
  }, [orders, suppliersById]);

  const stats = useMemo(() => {
    const supplierCount = rollup.length;
    let totalSkus = 0;
    let totalUnits = 0;
    for (const g of rollup) {
      totalSkus += g.items.size;
      for (const item of g.items.values()) totalUnits += item.qty;
    }
    return { orderCount: orders.length, totalSkus, totalUnits, supplierCount };
  }, [rollup, orders.length]);

  const handleGenerate = async (group: SupplierGroup) => {
    setLoadingSupplier(group.supplier.id);
    setErrors((e) => ({ ...e, [group.supplier.id]: '' }));
    try {
      const lineItems: CreatePoInput['lineItems'] = [];
      const sourceOrderIds = new Set<string>();
      for (const item of group.items.values()) {
        // For each rollup line, emit one line_item per source order_id
        for (const orderId of item.orderIds) {
          // Find the original cart item to get the per-order qty (instead of summed)
          const order = orders.find((o) => o.id === orderId);
          const cartItem = order?.cart.find(
            (c) => c.sku === item.sku && (c.colour ?? '') === (item.colour ?? ''),
          );
          if (!cartItem) continue;
          lineItems.push({
            orderId,
            sku: cartItem.sku,
            name: cartItem.productName,
            size: cartItem.size,
            colour: cartItem.colour,
            qty: cartItem.qty,
          });
          sourceOrderIds.add(orderId);
        }
      }

      const po = await createPO({ supplierId: group.supplier.id, lineItems });
      setPostIssue((prev) => ({
        ...prev,
        [group.supplier.id]: {
          poNumber: po.poNumber,
          poId: po.id,
          lineCount: lineItems.length,
          sourceOrderCount: sourceOrderIds.size,
        },
      }));
      // Open print view in new tab immediately (fetches with auth + writes HTML)
      try {
        const win = await openPrintWindow(po.id);
        if (!win) {
          setErrors((e) => ({
            ...e,
            [group.supplier.id]: 'Print window blocked. Click "Open print view" below.',
          }));
        }
      } catch (printErr) {
        const printMsg = printErr instanceof Error ? printErr.message : 'Print view failed';
        setErrors((e) => ({ ...e, [group.supplier.id]: printMsg }));
      }
      onIssued?.(Array.from(sourceOrderIds));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Generate PO failed';
      setErrors((e) => ({ ...e, [group.supplier.id]: msg }));
    } finally {
      setLoadingSupplier(null);
    }
  };

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className={styles.modal} onClick={handleBackdropClick}>
      <div className={styles.panel}>
        <div className={styles.head}>
          <div>
            <span className={styles.eyebrow}>Awaiting logistics · PO scan</span>
            <h2 className={styles.title}>Issue Purchase Orders</h2>
            <div className={styles.sub}>
              {stats.orderCount} orders · {stats.totalSkus} unique SKUs · {stats.totalUnits} units · {stats.supplierCount} suppliers
            </div>
          </div>
          <button className={styles.closeBtn} onClick={onClose} aria-label="Close">×</button>
        </div>

        <div className={styles.tabs}>
          <button
            className={`${styles.tab} ${view === 'rollup' ? styles.tabActive : ''}`}
            onClick={() => setView('rollup')}
          >
            Roll-up by supplier
          </button>
          <button
            className={`${styles.tab} ${view === 'by-order' ? styles.tabActive : ''}`}
            onClick={() => setView('by-order')}
          >
            Detail by order
          </button>
        </div>

        <div className={styles.body}>
          {suppliersQuery.isLoading && <div className={styles.muted}>Loading suppliers…</div>}

          {!suppliersQuery.isLoading && view === 'rollup' && rollup.length === 0 && (
            <div className={styles.empty}>
              All POs already issued — nothing to scan.
            </div>
          )}

          {!suppliersQuery.isLoading && view === 'rollup' && rollup.map((group) => {
            const issued = postIssue[group.supplier.id];
            const error = errors[group.supplier.id];
            const loading = loadingSupplier === group.supplier.id;
            return (
              <div key={group.supplier.id} className={styles.supplier}>
                <div className={styles.supplierHead}>
                  <div className={styles.supplierName}>
                    <span className={styles.supplierCode}>{group.supplier.code}</span>
                    {group.supplier.name}
                  </div>
                  {!issued && (
                    <button
                      className={styles.generateBtn}
                      onClick={() => handleGenerate(group)}
                      disabled={loading}
                    >
                      {loading ? 'Generating…' : 'Generate PO'}
                    </button>
                  )}
                </div>

                {issued && (
                  <div className={styles.issued}>
                    <div className={styles.issuedRow}>
                      <strong>{issued.poNumber}</strong> issued · {issued.lineCount} items · {issued.sourceOrderCount} source order{issued.sourceOrderCount !== 1 ? 's' : ''}
                    </div>
                    <div className={styles.issuedActions}>
                      <button
                        className={styles.actionBtn}
                        onClick={() => { void openPrintWindow(issued.poId); }}
                      >
                        Open print view
                      </button>
                      {group.supplier.whatsappNumber && (
                        <a
                          className={styles.actionBtn}
                          href={buildWhatsAppShareUrl(group.supplier.name, group.supplier.whatsappNumber, issued.poNumber)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          WhatsApp
                        </a>
                      )}
                      {group.supplier.email && (
                        <a
                          className={styles.actionBtn}
                          href={buildMailtoUrl(group.supplier.email, group.supplier.name, issued.poNumber)}
                        >
                          Email
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {error && <p className={styles.error}>{error}</p>}

                <table className={styles.table}>
                  <thead>
                    <tr>
                      <th>SKU</th>
                      <th>Item</th>
                      <th>Size</th>
                      {/* Commander 2026-05-28 — unify fabric/colour label → "Fabrics". */}
                      <th>Fabrics</th>
                      <th className={styles.colRight}>Qty</th>
                      <th>From orders</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(group.items.values()).map((it) => (
                      <tr key={it.sku + '|' + (it.colour ?? '')}>
                        <td><code>{it.sku}</code></td>
                        <td>{it.name}</td>
                        <td>{it.size ?? '—'}</td>
                        <td>{it.colour ?? '—'}</td>
                        <td className={styles.colRight}><strong>×{it.qty}</strong></td>
                        <td>
                          <span className={styles.orderPills}>
                            {Array.from(it.orderIds).slice(0, 2).map((id) => (
                              <span key={id} className={styles.orderPill}>{id}</span>
                            ))}
                            {it.orderIds.size > 2 && (
                              <span className={styles.orderPill}>+{it.orderIds.size - 2}</span>
                            )}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })}

          {!suppliersQuery.isLoading && view === 'by-order' && orders.length === 0 && (
            <div className={styles.empty}>
              No orders awaiting PO scan.
            </div>
          )}

          {!suppliersQuery.isLoading && view === 'by-order' && orders.map((order) => (
            <div key={order.id} className={styles.orderBlock}>
              <div className={styles.orderHead}>
                <span className={styles.orderId}>{order.id}</span>
                <span>{order.customerName}</span>
              </div>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Item</th>
                    <th>Supplier</th>
                    <th>Size</th>
                    {/* Commander 2026-05-28 — unify fabric/colour label → "Fabrics". */}
                    <th>Fabrics</th>
                    <th className={styles.colRight}>Qty</th>
                  </tr>
                </thead>
                <tbody>
                  {order.cart.map((it, idx) => {
                    const sup = it.supplierId ? suppliersById.get(it.supplierId) : null;
                    return (
                      <tr key={idx}>
                        <td><code>{it.sku}</code></td>
                        <td>{it.productName}</td>
                        <td>{sup ? `${sup.code} · ${sup.name}` : '—'}</td>
                        <td>{it.size ?? '—'}</td>
                        <td>{it.colour ?? '—'}</td>
                        <td className={styles.colRight}>×{it.qty}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
