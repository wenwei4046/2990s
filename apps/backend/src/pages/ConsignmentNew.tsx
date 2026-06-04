// ----------------------------------------------------------------------------
// ConsignmentNew — create a Sales Consignment order at /consignment/new.
//
// Full-page form mirroring StockAdjustmentNew / PurchaseOrderNew: back link +
// title + Cancel/Save in the headerRow, then a header card (debtor / branch /
// placed date / notes) and a line-items editor (Item Code via SKU datalist,
// Description auto-fill, Qty Placed, Unit Price).
//
// Debtor picker: mirrors SalesOrderNew — a free-text Debtor Name input with a
// type-ahead suggestion list backed by useDebtorSearch (fires at length >= 2).
// Picking a suggestion fills debtorCode; the field stays free-text so an ad-hoc
// consignee name can still be typed.
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Save, X, Plus, Trash2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useCreateConsignmentOrder } from '../lib/consignment-queries';
import { useDebtorSearch, type DebtorSuggestion } from '../lib/flow-queries';
import { useMfgProducts } from '../lib/mfg-products-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const todayIso = () => new Date().toISOString().slice(0, 10);

type LineDraft = {
  key: number;
  itemCode: string;
  description: string;
  qtyPlaced: number;
  unitPrice: string; // RM, free text — converted to centi on save
};

let lineKeySeq = 1;
const emptyLine = (): LineDraft => ({
  key: lineKeySeq++,
  itemCode: '',
  description: '',
  qtyPlaced: 1,
  unitPrice: '',
});

export const ConsignmentNew = () => {
  const navigate = useNavigate();
  const create = useCreateConsignmentOrder();

  // ── Header state ───────────────────────────────────────────────────
  const [debtorName, setDebtorName] = useState('');
  const [debtorCode, setDebtorCode] = useState('');
  const [branchLocation, setBranchLocation] = useState('');
  const [placedAt, setPlacedAt] = useState(todayIso());
  const [notes, setNotes] = useState('');

  // ── Debtor autocomplete ────────────────────────────────────────────
  const debtors = useDebtorSearch(debtorName.trim().length >= 2 ? debtorName.trim() : '');
  const [showDebtorSuggest, setShowDebtorSuggest] = useState(false);
  const debtorSuggestions: DebtorSuggestion[] = (debtors.data?.debtors ?? []).filter(
    (d) => (d.debtor_name ?? '').toLowerCase() !== debtorName.trim().toLowerCase(),
  );
  const applyDebtorSuggestion = (d: DebtorSuggestion) => {
    setDebtorCode(d.debtor_code ?? '');
    setDebtorName(d.debtor_name ?? '');
    setShowDebtorSuggest(false);
  };

  // ── Line items ─────────────────────────────────────────────────────
  const [lines, setLines] = useState<LineDraft[]>([emptyLine()]);
  const allSkus = useMfgProducts();

  const patchLine = (key: number, patch: Partial<LineDraft>) =>
    setLines((prev) => prev.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  const onPickSku = (key: number, code: string) => {
    const sku = (allSkus.data ?? []).find((p) => p.code === code);
    patchLine(key, sku ? { itemCode: code, description: sku.name } : { itemCode: code });
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);
  const removeLine = (key: number) =>
    setLines((prev) => (prev.length === 1 ? prev : prev.filter((l) => l.key !== key)));

  // ── Save ───────────────────────────────────────────────────────────
  const onSave = () => {
    const missing: string[] = [];
    if (!debtorName.trim()) missing.push('Debtor Name');

    const validLines = lines.filter((l) => l.itemCode.trim() && l.qtyPlaced > 0);
    if (validLines.length === 0) missing.push('at least one line with an Item Code and a positive Qty Placed');

    if (missing.length > 0) {
      window.alert(`Can't save yet — missing: ${missing.join(', ')}.`);
      return;
    }

    create.mutate(
      {
        debtorName: debtorName.trim(),
        debtorCode: debtorCode.trim() || undefined,
        branchLocation: branchLocation.trim() || undefined,
        placedAt: placedAt || undefined,
        notes: notes.trim() || undefined,
        items: validLines.map((l) => {
          const price = Number(l.unitPrice);
          const unitPriceCenti =
            l.unitPrice.trim() && Number.isFinite(price) ? Math.round(price * 100) : undefined;
          return {
            itemCode: l.itemCode.trim(),
            description: l.description.trim() || undefined,
            qtyPlaced: Math.floor(l.qtyPlaced),
            unitPriceCenti,
          };
        }),
      },
      {
        onSuccess: (res) => navigate(`/consignment/${res.order.id}`),
        onError: (err) =>
          window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/consignment" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Sales Consignment</span>
          </Link>
          <h1 className={styles.title}>New Consignment</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/consignment')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button variant="primary" size="md" onClick={onSave} disabled={create.isPending}>
            <Save {...ICON} />
            {create.isPending ? 'Saving…' : 'Create Consignment'}
          </Button>
        </div>
      </div>

      {/* ── Header card ──────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Consignment</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            {/* Debtor Name — free text + autocomplete */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Debtor Name *</span>
              <input
                type="text"
                className={styles.fieldInput}
                value={debtorName}
                placeholder="Type a customer name…"
                onChange={(e) => { setDebtorName(e.target.value); setShowDebtorSuggest(true); }}
                onFocus={() => setShowDebtorSuggest(true)}
                onBlur={() => setTimeout(() => setShowDebtorSuggest(false), 150)}
              />
              {showDebtorSuggest && debtorSuggestions.length > 0 && (
                <div className={styles.suggestList}>
                  {debtorSuggestions.slice(0, 8).map((d, i) => (
                    <div
                      key={`${d.debtor_code ?? ''}-${i}`}
                      className={styles.suggestItem}
                      onMouseDown={() => applyDebtorSuggestion(d)}
                    >
                      <div>{d.debtor_name}</div>
                      {(d.debtor_code || d.phone) && (
                        <div className={styles.suggestCode}>
                          {d.debtor_code ?? ''}{d.debtor_code && d.phone ? ' · ' : ''}{d.phone ?? ''}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </label>

            {/* Branch Location */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Branch Location</span>
              <input
                type="text"
                className={styles.fieldInput}
                value={branchLocation}
                placeholder="e.g. Klang outlet"
                onChange={(e) => setBranchLocation(e.target.value)}
              />
            </label>

            {/* Placed Date */}
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Placed Date</span>
              <input
                type="date"
                className={styles.fieldInput}
                value={placedAt}
                onChange={(e) => setPlacedAt(e.target.value)}
              />
            </label>

            {/* Notes */}
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.fieldLabel}>Notes</span>
              <textarea
                className={styles.fieldInput}
                value={notes}
                rows={2}
                placeholder="Optional — terms, contact, anything worth recording."
                onChange={(e) => setNotes(e.target.value)}
                style={{ minHeight: 48, resize: 'vertical' }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* ── Line items ───────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Items</h2>
        </div>
        <div className={styles.cardBody} style={{ padding: 0 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Item Code *</th>
                <th>Description</th>
                <th className={styles.tableRight}>Qty Placed *</th>
                <th className={styles.tableRight}>Unit Price (RM)</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.key}>
                  <td style={{ minWidth: 160 }}>
                    <input
                      type="text"
                      list="consignment-skus"
                      className={styles.fieldInput}
                      value={l.itemCode}
                      placeholder="Type or pick a SKU…"
                      onChange={(e) => onPickSku(l.key, e.target.value)}
                      style={{ fontFamily: 'var(--font-mono)' }}
                    />
                  </td>
                  <td style={{ minWidth: 220 }}>
                    <input
                      type="text"
                      className={styles.fieldInput}
                      value={l.description}
                      placeholder="(auto-filled from SKU — editable)"
                      onChange={(e) => patchLine(l.key, { description: e.target.value })}
                    />
                  </td>
                  <td className={styles.tableRight}>
                    <input
                      type="number"
                      min={1}
                      step={1}
                      className={styles.fieldInput}
                      value={l.qtyPlaced}
                      onChange={(e) =>
                        patchLine(l.key, { qtyPlaced: Math.max(0, Math.floor(Number(e.target.value) || 0)) })
                      }
                      style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                    />
                  </td>
                  <td className={styles.tableRight}>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      className={styles.fieldInput}
                      value={l.unitPrice}
                      placeholder="0.00"
                      onChange={(e) => patchLine(l.key, { unitPrice: e.target.value })}
                      style={{ textAlign: 'right', fontFamily: 'var(--font-mono)' }}
                    />
                  </td>
                  <td className={styles.tableRight} style={{ width: 48 }}>
                    <button
                      type="button"
                      className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                      onClick={() => removeLine(l.key)}
                      disabled={lines.length === 1}
                      title={lines.length === 1 ? 'At least one line is required' : 'Remove line'}
                    >
                      <Trash2 size={15} strokeWidth={1.75} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <datalist id="consignment-skus">
            {(allSkus.data ?? []).map((p) => (
              <option key={p.id} value={p.code}>{p.name} · {p.category}</option>
            ))}
          </datalist>
          <div className={styles.addLineRow}>
            <Button variant="ghost" size="sm" onClick={addLine}>
              <Plus {...ICON} /> Add item
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
};
