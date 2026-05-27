// ----------------------------------------------------------------------------
// LineItemsSection — extracted from SalesOrderDetail.tsx (task #61).
//
// Owns:
//   - editingLineIds / editingDrafts (inline per-row SoLineCard editor)
//   - addingDraft (new line via "+ Add Line Item")
//   - overriding (price override modal target)
//   - per-row stable callbacks (rowCallbacks Map)
//
// The HUGE win from this extraction: typing in CustomerCard / OrderInfoCard /
// any header field no longer causes a re-render of the line items table, the
// SoLineCard tree (which carries useMfgProducts + useMaintenanceConfig +
// useFabricTrackings sub-trees), or the VariantsPills pill rows. Conversely,
// clicking Edit on a row or typing in an inline editor doesn't re-render the
// 4 header cards either — each has its own React.memo barrier.
// ----------------------------------------------------------------------------

import { lazy, memo, Suspense, useCallback, useMemo, useState } from 'react';
import { Pencil, Plus, Save, Trash2, DollarSign } from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useAddMfgSalesOrderItem,
  useUpdateMfgSalesOrderItem,
  useDeleteMfgSalesOrderItem,
  useUpdateSoItemStockStatus,
} from '../../lib/flow-queries';
import { SoLineCard, emptySoLine, type SoLineDraft } from '../../components/SoLineCard';
import { VariantsPills } from './VariantsPills';
import type { SoHeader, SoItem } from './types';
import { fmtRm, ICON, SM_ICON } from './types';
import styles from '../SalesOrderDetail.module.css';

/* React.lazy — the OverridePriceModal is only mounted when the dollar-icon
   action is clicked. Code-split keeps it out of the main SO Detail chunk. */
const OverridePriceModal = lazy(() =>
  import('./OverridePriceModal').then((m) => ({ default: m.OverridePriceModal })),
);

type Props = {
  header: SoHeader;
  items: SoItem[];
  isEditing: boolean;
  isLocked: boolean;
};

const LineItemsSectionInner = ({ header, items, isEditing, isLocked }: Props) => {
  const addItem = useAddMfgSalesOrderItem();
  const updateItem = useUpdateMfgSalesOrderItem();
  const deleteItem = useDeleteMfgSalesOrderItem();
  const updateStock = useUpdateSoItemStockStatus();

  const [editingLineIds, setEditingLineIds] = useState<Set<string>>(new Set());
  const [editingDrafts, setEditingDrafts] = useState<Record<string, SoLineDraft>>({});
  const [addingDraft, setAddingDraft] = useState<SoLineDraft | null>(null);
  const [overriding, setOverriding] = useState<SoItem | null>(null);

  const startEditLine = (it: SoItem) => {
    setEditingLineIds((prev) => {
      const next = new Set(prev);
      next.add(it.id);
      return next;
    });
    setEditingDrafts((prev) => ({
      ...prev,
      [it.id]: {
        itemCode:       it.item_code ?? '',
        itemGroup:      it.item_group ?? 'others',
        description:    it.description ?? '',
        uom:            it.uom ?? 'UNIT',
        qty:            it.qty ?? 1,
        unitPriceCenti: it.unit_price_centi ?? 0,
        discountCenti:  it.discount_centi ?? 0,
        unitCostCenti:  it.unit_cost_centi ?? 0,
        variants:       (it.variants as Record<string, unknown>) ?? {},
        remark:         it.remark ?? '',
        lineDeliveryDate:           it.line_delivery_date ?? null,
        lineDeliveryDateOverridden: it.line_delivery_date_overridden ?? false,
      },
    }));
  };

  const stopEditLine = useCallback((id: string) => {
    setEditingLineIds((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    setEditingDrafts((prev) => {
      if (!(id in prev)) return prev;
      const { [id]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  const patchEditingDraft = useCallback((id: string, patch: Partial<SoLineDraft>) => {
    setEditingDrafts((prev) => {
      const cur = prev[id];
      if (!cur) return prev;
      return { ...prev, [id]: { ...cur, ...patch } };
    });
  }, []);

  /* Task #103 — Per-row callback map. SoLineCard is React.memo'd; without
     stable callbacks every parent render busts shallow-equality on props. */
  const rowCallbacks = useMemo(() => {
    const map = new Map<string, {
      onChange: (patch: Partial<SoLineDraft>) => void;
      onRemove: () => void;
    }>();
    for (const id of editingLineIds) {
      map.set(id, {
        onChange: (patch) => patchEditingDraft(id, patch),
        onRemove: () => stopEditLine(id),
      });
    }
    return map;
  }, [editingLineIds, patchEditingDraft, stopEditLine]);

  const submitEditingDraft = (id: string) => {
    const d = editingDrafts[id];
    if (!d) return;
    if (!d.itemCode.trim()) { window.alert('Pick a product first.'); return; }
    updateItem.mutate(
      {
        docNo: header.doc_no,
        itemId: id,
        itemCode:       d.itemCode,
        itemGroup:      d.itemGroup,
        description:    d.description,
        uom:            d.uom,
        qty:            d.qty,
        unitPriceCenti: d.unitPriceCenti,
        discountCenti:  d.discountCenti,
        unitCostCenti:  d.unitCostCenti,
        variants:       d.variants,
        remark:         d.remark,
        lineDeliveryDate:           d.lineDeliveryDate ?? null,
        lineDeliveryDateOverridden: d.lineDeliveryDateOverridden ?? false,
      },
      { onSuccess: () => stopEditLine(id) },
    );
  };

  const startAddLine = () => {
    setAddingDraft({
      ...emptySoLine(),
      lineDeliveryDate: header.customer_delivery_date ?? null,
      lineDeliveryDateOverridden: false,
    });
  };

  const cancelAddLine = useCallback(() => setAddingDraft(null), []);

  const patchAddingDraft = useCallback(
    (patch: Partial<SoLineDraft>) =>
      setAddingDraft((prev) => prev ? { ...prev, ...patch } : prev),
    [],
  );

  const submitAddLine = () => {
    if (!addingDraft) return;
    if (!addingDraft.itemCode.trim()) { window.alert('Pick a product first.'); return; }
    addItem.mutate(
      {
        docNo: header.doc_no,
        itemCode:       addingDraft.itemCode,
        itemGroup:      addingDraft.itemGroup,
        description:    addingDraft.description,
        uom:            addingDraft.uom,
        qty:            addingDraft.qty,
        unitPriceCenti: addingDraft.unitPriceCenti,
        discountCenti:  addingDraft.discountCenti,
        unitCostCenti:  addingDraft.unitCostCenti,
        variants:       addingDraft.variants,
        remark:         addingDraft.remark,
        lineDeliveryDate:           addingDraft.lineDeliveryDate ?? null,
        lineDeliveryDateOverridden: addingDraft.lineDeliveryDateOverridden ?? false,
      },
      { onSuccess: () => setAddingDraft(null) },
    );
  };

  const closeOverride = useCallback(() => setOverriding(null), []);

  return (
    <>
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({items.length})</h2>
          {isEditing && !addingDraft && (
            <Button variant="primary" size="sm" onClick={startAddLine} disabled={isLocked}>
              <Plus {...ICON} />
              <span>Add Line Item</span>
            </Button>
          )}
        </header>

        {items.length === 0 && !addingDraft ? (
          <p className={styles.emptyRow}>No items yet — click "Add Line Item" to begin.</p>
        ) : items.length === 0 && addingDraft ? (
          <div style={{ padding: 'var(--space-3)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <SoLineCard
              index={0}
              draft={addingDraft}
              onChange={patchAddingDraft}
              onRemove={cancelAddLine}
              canRemove={true}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 'var(--space-2)',
            }}>
              <Button variant="ghost" size="sm"
                onClick={cancelAddLine}
                disabled={addItem.isPending}>
                <span>Cancel</span>
              </Button>
              <Button variant="primary" size="sm"
                onClick={submitAddLine}
                disabled={addItem.isPending}>
                <Save {...SM_ICON} />
                <span>{addItem.isPending ? 'Saving…' : 'Add Line Item'}</span>
              </Button>
            </div>
          </div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item</th>
                <th className={styles.tableRight}>Qty</th>
                <th className={styles.tableRight}>Unit</th>
                <th className={styles.tableRight}>Disc</th>
                <th className={styles.tableRight}>Delivery</th>
                <th className={styles.tableRight}>Total</th>
                <th className={styles.tableRight}>Unit Cost</th>
                <th className={styles.tableRight}>Line Cost</th>
                <th className={styles.tableRight}>Margin</th>
                <th className={styles.tableRight}>Stock</th>
                <th className={styles.tableRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) => {
                const displayDate = it.line_delivery_date
                  ?? (!it.line_delivery_date_overridden ? header.customer_delivery_date : null);
                const isAuto = !it.line_delivery_date_overridden;
                const inlineEditing = editingLineIds.has(it.id);
                const editDraft = editingDrafts[it.id];
                if (inlineEditing && editDraft) {
                  const cb = rowCallbacks.get(it.id);
                  return (
                    <tr key={it.id}>
                      <td colSpan={11} style={{ padding: 'var(--space-3)' }}>
                        <SoLineCard
                          index={items.indexOf(it)}
                          draft={editDraft}
                          onChange={cb?.onChange ?? ((patch) => patchEditingDraft(it.id, patch))}
                          onRemove={cb?.onRemove ?? (() => stopEditLine(it.id))}
                          canRemove={true}
                          docNo={header.doc_no}
                          itemId={it.id}
                          isEditing={isEditing}
                        />
                        <div style={{
                          display: 'flex',
                          justifyContent: 'flex-end',
                          gap: 'var(--space-2)',
                          marginTop: 'var(--space-2)',
                        }}>
                          <Button variant="ghost" size="sm"
                            onClick={() => stopEditLine(it.id)}
                            disabled={updateItem.isPending}>
                            <span>Cancel</span>
                          </Button>
                          <Button variant="primary" size="sm"
                            onClick={() => submitEditingDraft(it.id)}
                            disabled={updateItem.isPending}>
                            <Save {...SM_ICON} />
                            <span>{updateItem.isPending ? 'Saving…' : 'Save'}</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={it.id}>
                    <td>
                      <div className={styles.codeCell}>{it.item_code}</div>
                      {it.description && <div className={styles.muted}>{it.description}</div>}
                      <VariantsPills variants={it.variants} />
                    </td>
                    <td className={styles.tableRight}>{it.qty}</td>
                    <td className={styles.tableRight}>{fmtRm(it.unit_price_centi, header.currency)}</td>
                    <td className={styles.tableRight}>{it.discount_centi > 0 ? fmtRm(it.discount_centi, header.currency) : '—'}</td>
                    <td className={styles.tableRight}>
                      {displayDate ? (
                        <span style={isAuto ? { color: 'var(--fg-muted)' } : undefined}>
                          {displayDate}
                          {isAuto && (
                            <span style={{ marginLeft: 4, color: 'var(--c-orange)', fontSize: 'var(--fs-11)' }}>· auto</span>
                          )}
                        </span>
                      ) : '—'}
                    </td>
                    <td className={styles.priceCell}>{fmtRm(it.total_centi, header.currency)}</td>
                    <td className={styles.tableRight}>
                      <span className={styles.muted}>
                        {it.unit_cost_centi > 0 ? fmtRm(it.unit_cost_centi, header.currency) : '—'}
                      </span>
                    </td>
                    <td className={styles.tableRight}>
                      <span className={styles.muted}>
                        {it.line_cost_centi > 0 ? fmtRm(it.line_cost_centi, header.currency) : '—'}
                      </span>
                    </td>
                    <td className={styles.tableRight}>
                      {it.total_centi > 0 ? (
                        <span className={
                          it.line_margin_centi > 0 ? styles.marginGood
                          : it.line_margin_centi < 0 ? styles.marginBad
                          : styles.muted
                        } style={{ fontWeight: 600 }}>
                          {fmtRm(it.line_margin_centi, header.currency)}
                        </span>
                      ) : <span className={styles.muted}>—</span>}
                    </td>
                    {/* PR — Commander 2026-05-28: per-line stock toggle.
                        Click the pill to flip PENDING ↔ READY. When all lines
                        become READY, the SO status auto-advances to
                        READY_TO_SHIP (server-side; see PATCH /:docNo/items/
                        :itemId/stock-status). Eventually will be set
                        automatically from inventory allocation. */}
                    <td className={styles.tableRight}>
                      {(() => {
                        const cur = it.stock_status === 'READY' ? 'READY' : 'PENDING';
                        const next = cur === 'READY' ? 'PENDING' : 'READY';
                        const isReady = cur === 'READY';
                        return (
                          <button
                            type="button"
                            disabled={it.cancelled || updateStock.isPending}
                            onClick={() => {
                              if (it.cancelled) return;
                              updateStock.mutate({
                                docNo: header.doc_no,
                                itemId: it.id,
                                status: next,
                              });
                            }}
                            title={`Click to mark ${next}`}
                            style={{
                              fontFamily: 'var(--font-sans)',
                              fontSize: 'var(--fs-11)',
                              fontWeight: 700,
                              letterSpacing: 0.5,
                              padding: '2px 10px',
                              borderRadius: 'var(--radius-pill, 999px)',
                              cursor: it.cancelled ? 'not-allowed' : 'pointer',
                              border: '1px solid transparent',
                              background: isReady ? 'var(--c-mint, #d4edda)' : 'var(--c-paper)',
                              color: isReady ? 'var(--c-green, #1a7a3a)' : 'var(--fg-soft)',
                              borderColor: isReady ? 'transparent' : 'var(--line)',
                            }}
                          >
                            {cur}
                          </button>
                        );
                      })()}
                    </td>
                    <td>
                      {isEditing ? (
                        <span className={styles.actionsCell}>
                          <button type="button" className={styles.iconBtn} title="Edit" disabled={isLocked}
                            onClick={() => !isLocked && startEditLine(it)}>
                            <Pencil {...SM_ICON} />
                          </button>
                          <button type="button" className={styles.iconBtn} title="Override price"
                            disabled={isLocked}
                            onClick={() => !isLocked && setOverriding(it)}>
                            <DollarSign {...SM_ICON} />
                          </button>
                          <button
                            type="button"
                            className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                            title="Delete"
                            disabled={isLocked}
                            onClick={() => {
                              if (isLocked) return;
                              if (confirm(`Remove ${it.item_code} from this SO?`)) {
                                deleteItem.mutate({ docNo: header.doc_no, itemId: it.id });
                              }
                            }}
                          >
                            <Trash2 {...SM_ICON} />
                          </button>
                        </span>
                      ) : (
                        <span className={styles.muted}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {addingDraft && (
                <tr>
                  <td colSpan={10} style={{ padding: 'var(--space-3)' }}>
                    <SoLineCard
                      index={items.length}
                      draft={addingDraft}
                      onChange={patchAddingDraft}
                      onRemove={cancelAddLine}
                      canRemove={true}
                    />
                    <div style={{
                      display: 'flex',
                      justifyContent: 'flex-end',
                      gap: 'var(--space-2)',
                      marginTop: 'var(--space-2)',
                    }}>
                      <Button variant="ghost" size="sm"
                        onClick={cancelAddLine}
                        disabled={addItem.isPending}>
                        <span>Cancel</span>
                      </Button>
                      <Button variant="primary" size="sm"
                        onClick={submitAddLine}
                        disabled={addItem.isPending}>
                        <Save {...SM_ICON} />
                        <span>{addItem.isPending ? 'Saving…' : 'Add Line Item'}</span>
                      </Button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </section>

      {overriding && (
        <Suspense fallback={null}>
          <OverridePriceModal
            item={overriding}
            docNo={header.doc_no}
            currency={header.currency}
            onClose={closeOverride}
          />
        </Suspense>
      )}
    </>
  );
};

export const LineItemsSection = memo(LineItemsSectionInner);
