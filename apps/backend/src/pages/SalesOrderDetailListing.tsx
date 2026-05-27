// ----------------------------------------------------------------------------
// SalesOrderDetailListing — AutoCount-style "Print Sales Order Detail Listing"
// report page at /reports/sales-order-detail-listing.
//
// One row per Sales Order LINE ITEM (with SO header info repeated). Mirrors
// the AutoCount column set the commander uses as canonical for ERP listing
// reports: 36 columns total covering doc header + line + payment + remarks.
//
// Layout:
//   1. Header: back + title
//   2. Two filter cards (side-by-side):
//      - Basic Filter (Document Date range, Doc No, Debtor Code, Item Code, Delivery Date range)
//      - Report Options (Group By, Sort By, Show Criteria, More Options, Advanced Filter)
//   3. Action bar: Inquiry · Preview · Print · Hide Options · Criteria · Close
//   4. Optional criteria summary
//   5. Search Result panel: Check All / Uncheck All / Uncheck In Selection /
//      Clear Unchecked / global search · drag-zone for grouping · wide table.
//
// The "Group By" zone follows AutoCount: drag a column header onto the zone
// to group rows; click the chip to remove it. The header can also be set via
// the Group By dropdown in the Report Options card.
//
// ── Temporary placeholders (Task #86 follow-up) ────────────────────────────
// Malaysia is currently in a no-SST regime, so `tax_centi` is always 0 across
// every SO row. Until SST returns (and the codebase wires a real tax-code
// source) the following columns render constants:
//   - Inclusive?       → "Yes"  (a zero-tax doc is, by AutoCount convention,
//                                 "tax-inclusive at 0%")
//   - Tax (header/line) → "0.00"
//   - Detail Tax Code  → "SR"   (AutoCount's Standard-Rated 0% code)
//
// Likewise, cross-doc linking from SO line → supplier PO isn't tracked in our
// schema yet, so the following columns render "—":
//   - Creditor Code
//   - Post to PO
// Future work: add a `linked_po_doc_no` (or similar) FK on
// mfg_sales_order_items if the commander wants these populated. The PAYEMENT
// column (note: AutoCount preserved the typo) reads `paid_total_centi`,
// derived server-side from mfg_sales_order_payments (PR-C dropped the legacy
// header column).
// ----------------------------------------------------------------------------

import { useMemo, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import {
  ArrowLeft, ClipboardList, Printer, Eye, Filter, X, ChevronRight,
  SlidersHorizontal, FileSearch,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  useSalesOrderDetailListing,
  type SoDetailListingFilters,
  type SoDetailListingRow,
} from '../lib/flow-queries';
import styles from './SalesOrderDetailListing.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;
const SM_ICON = { size: 14, strokeWidth: 1.75 } as const;

type DateMode = 'range' | 'none';
type GroupBy = NonNullable<SoDetailListingFilters['groupBy']>;
type SortBy  = NonNullable<SoDetailListingFilters['sortBy']>;

const fmtRm = (centi: number | null | undefined, currency = 'MYR'): string => {
  const c = Number(centi ?? 0);
  return `${currency} ${(c / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

// 36-column AutoCount layout. Each entry: { key, label, render }. `key` doubles
// as the column-id used for grouping + DnD payload.
type ColDef = {
  key: string;
  label: string;
  align?: 'left' | 'right' | 'center';
  render: (r: SoDetailListingRow) => ReactNode;
};

const COLS: ColDef[] = [
  { key: 'doc_no',          label: 'Doc. No.',      render: (r) => <span className={styles.codeCell}>{r.doc_no}</span> },
  { key: 'so_date',         label: 'Date',          render: (r) => (r.so_date ?? r.line_date ?? '—') as string },
  { key: 'debtor_code',     label: 'Debtor Code',   render: (r) => r.debtor_code ?? '—' },
  { key: 'debtor_name',     label: 'Debtor Name',   render: (r) => r.debtor_name ?? '—' },
  { key: 'agent',           label: 'Agent',         render: (r) => r.agent ?? '—' },
  { key: 'currency',        label: 'Curr. Code',    render: (r) => r.currency ?? 'MYR' },
  // Inclusive? — see top-of-file note: constant "Yes" while Malaysia is in
  // the no-SST regime (every doc is effectively tax-inclusive at 0%).
  { key: 'inclusive',       label: 'Inclusive?',    align: 'center',
    render: () => 'Yes' },
  { key: 'subtotal_ex',     label: 'SubTotal (Ex)', align: 'right',
    render: (r) => fmtRm((r.total_centi ?? 0) - (r.tax_centi ?? 0), r.currency) },
  // Tax (header) — constant 0.00 placeholder while no-SST regime is in effect.
  { key: 'tax_header',      label: 'Tax',           align: 'right',
    render: (r) => fmtRm(0, r.currency) },
  { key: 'header_total',    label: 'Total',         align: 'right',
    render: (r) => fmtRm(r.local_total_centi ?? 0, r.currency) },
  { key: 'local_total',     label: 'Local Total',   align: 'right',
    render: (r) => fmtRm(r.local_total_centi ?? 0, r.currency) },
  { key: 'cancelled',       label: 'Cancelled',     align: 'center',
    render: (r) => (r.cancelled ? 'Y' : 'N') },
  { key: 'remark4',         label: 'Remark 4',      render: (r) => (r.remark4 ?? '—') as string },
  { key: 'sales_exemption_expiry', label: 'Sales Exemption Expiry',
    render: (r) => (r.sales_exemption_expiry ?? '—') as string },
  { key: 'processing_date', label: 'Processing Date',
    render: (r) => (r.processing_date ?? '—') as string },
  { key: 'item_group',      label: 'Item Group',    render: (r) => r.item_group ?? '—' },
  { key: 'item_code',       label: 'Item Code',     render: (r) => <span className={styles.codeCell}>{r.item_code}</span> },
  { key: 'description',     label: 'Detail Description',
    render: (r) => (r.description ?? '—') as string },
  { key: 'uom',             label: 'UOM',           render: (r) => r.uom ?? '—' },
  { key: 'location',        label: 'Location',      render: (r) => (r.location ?? '—') as string },
  { key: 'description2',    label: 'Detail Description 2',
    render: (r) => (r.description2 ?? '—') as string },
  { key: 'qty',             label: 'Qty',           align: 'right', render: (r) => String(r.qty ?? 0) },
  { key: 'unit_price',      label: 'Unit Price',    align: 'right',
    render: (r) => fmtRm(r.unit_price_centi, r.currency) },
  { key: 'discount',        label: 'Discount',      align: 'right',
    render: (r) => fmtRm(r.discount_centi, r.currency) },
  // Detail Tax Code — constant "SR" (Standard-Rated 0%) placeholder while
  // the no-SST regime is in effect. See top-of-file note.
  { key: 'detail_tax_code', label: 'Detail Tax Code',
    render: () => 'SR' },
  { key: 'line_total',      label: 'Total',         align: 'right',
    render: (r) => fmtRm(r.total_centi, r.currency) },
  // Tax (line) — constant 0.00 placeholder while no-SST regime is in effect.
  { key: 'line_tax',        label: 'Tax',           align: 'right',
    render: (r) => fmtRm(0, r.currency) },
  { key: 'total_ex',        label: 'Total (Ex)',    align: 'right',
    render: (r) => fmtRm((r.total_centi ?? 0) - (r.tax_centi ?? 0), r.currency) },
  { key: 'total_inc',       label: 'Total (Inc)',   align: 'right',
    render: (r) => fmtRm(r.total_inc_centi ?? r.total_centi ?? 0, r.currency) },
  // Creditor Code / Post to PO — cross-doc linking from SO line to supplier
  // PO isn't tracked in our schema yet. See top-of-file note.
  { key: 'creditor_code',   label: 'Creditor Code', render: () => '—' },
  { key: 'post_to_po',      label: 'Post to PO',    align: 'center', render: () => '—' },
  { key: 'balance',         label: 'BALANCE',       align: 'right',
    render: (r) => fmtRm(r.balance_centi ?? 0, r.currency) },
  // PAYEMENT — AutoCount preserves the typo. Sums mfg_sales_order_payments
  // server-side (paid_total_centi); the legacy header column paid_centi was
  // dropped by PR-C.
  { key: 'payment',         label: 'PAYEMENT',      align: 'right',
    render: (r) => fmtRm(r.paid_total_centi ?? 0, r.currency) },
  { key: 'remark5',         label: 'Remark5',       render: (r) => (r.remark2 ?? '—') as string },
  { key: 'remark6',         label: 'Remark6',       render: (r) => (r.remark3 ?? '—') as string },
];

const COL_LOOKUP: Record<string, ColDef> = Object.fromEntries(COLS.map((c) => [c.key, c]));

export const SalesOrderDetailListing = () => {
  const navigate = useNavigate();

  // ── Filter state ─────────────────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const yearAgo = new Date(Date.now() - 365 * 86400 * 1000).toISOString().slice(0, 10);
  const [docDateMode, setDocDateMode] = useState<DateMode>('range');
  const [dateFrom, setDateFrom] = useState(yearAgo);
  const [dateTo,   setDateTo]   = useState(today);
  const [docNo,       setDocNo]       = useState('');
  const [debtorCode,  setDebtorCode]  = useState('');
  const [itemCode,    setItemCode]    = useState('');
  const [deliveryDateMode, setDeliveryDateMode] = useState<DateMode>('none');
  const [deliveryFrom, setDeliveryFrom] = useState('');
  const [deliveryTo,   setDeliveryTo]   = useState('');
  const [groupBy, setGroupBy] = useState<GroupBy>('none');
  const [sortBy,  setSortBy]  = useState<SortBy>('date');
  const [showCriteria, setShowCriteria] = useState(false);

  // ── UI state ────────────────────────────────────────────────────
  const [optionsVisible, setOptionsVisible] = useState(true);
  const [hasRunQuery,    setHasRunQuery]    = useState(false);
  const [criteriaPanel,  setCriteriaPanel]  = useState(false);
  const [search,         setSearch]         = useState('');
  const [checked,        setChecked]        = useState<Record<string, boolean>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});

  // ── Inquiry query — only fires after the user clicks "Inquiry". ──
  // We compute filters lazily so the URL stays clean and the user can edit
  // values without triggering re-fetches every keystroke.
  const [committed, setCommitted] = useState<SoDetailListingFilters>({});
  const query = useSalesOrderDetailListing(hasRunQuery ? committed : {});
  const rawRows = useMemo(
    () => (hasRunQuery ? (query.data?.rows ?? []) : []),
    [hasRunQuery, query.data],
  );

  // Apply global search client-side (across a handful of meaningful fields)
  const rows = useMemo(() => {
    if (!search.trim()) return rawRows;
    const needle = search.trim().toLowerCase();
    return rawRows.filter((r) => {
      const blob = [
        r.doc_no, r.debtor_code, r.debtor_name, r.agent, r.branding,
        r.item_code, r.item_group, r.description, r.description2,
        r.uom, r.location,
      ].map((v) => String(v ?? '').toLowerCase()).join(' | ');
      return blob.includes(needle);
    });
  }, [rawRows, search]);

  // ── Grouping ────────────────────────────────────────────────────
  const groupKey: string | null = groupBy === 'none' ? null
    : groupBy === 'item_group' ? 'item_group'
    : groupBy === 'debtor'     ? 'debtor_code'
    : groupBy;
  const grouped = useMemo(() => {
    if (!groupKey) return null;
    const map = new Map<string, SoDetailListingRow[]>();
    for (const r of rows) {
      const k = String((r as Record<string, unknown>)[groupKey] ?? '—');
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [rows, groupKey]);

  // ── Action handlers ─────────────────────────────────────────────
  const runInquiry = () => {
    setCommitted({
      dateFrom:         docDateMode === 'range' ? dateFrom : undefined,
      dateTo:           docDateMode === 'range' ? dateTo   : undefined,
      docNo:            docNo.trim()      || undefined,
      debtorCode:       debtorCode.trim() || undefined,
      itemCode:         itemCode.trim()   || undefined,
      deliveryDateFrom: deliveryDateMode === 'range' ? deliveryFrom : undefined,
      deliveryDateTo:   deliveryDateMode === 'range' ? deliveryTo   : undefined,
      groupBy,
      sortBy,
    });
    setHasRunQuery(true);
  };

  const runPrint = () => {
    if (!hasRunQuery) runInquiry();
    // Defer so the dataset is in the DOM before the dialog opens.
    setTimeout(() => window.print(), 60);
  };

  // Use the same dynamic-import jspdf pattern as sales-order-pdf.ts.
  const generatePreviewPdf = async (data: SoDetailListingRow[]) => {
    try {
      const { jsPDF } = await import('jspdf');
      const autoTable = (await import('jspdf-autotable')).default;
      const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
      const margin = 10;
      let y = margin;
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(13);
      doc.text("Sales Order Detail Listing", margin, y);
      y += 5;
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.text(
        `Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} · ${data.length} rows`,
        margin, y,
      );
      y += 4;
      // A representative subset of cols — A4 landscape can't show all 36.
      const previewCols: ColDef[] = COLS.filter((c) =>
        ['doc_no', 'so_date', 'debtor_name', 'agent', 'item_code',
         'description', 'qty', 'unit_price', 'discount', 'line_total'].includes(c.key),
      );
      autoTable(doc, {
        startY: y + 2,
        head: [previewCols.map((c) => c.label)],
        body: data.map((r) =>
          previewCols.map((c) => {
            const v = c.render(r);
            return typeof v === 'string' || typeof v === 'number' ? String(v)
                 : (r as Record<string, unknown>)[c.key] != null
                   ? String((r as Record<string, unknown>)[c.key])
                   : '';
          })
        ),
        theme: 'striped',
        styles: { fontSize: 7, cellPadding: 1.5 },
        headStyles: { fillColor: [34, 31, 32], textColor: 250, fontStyle: 'bold' },
        margin: { left: margin, right: margin },
      });
      doc.save(`sales-order-detail-listing-${new Date().toISOString().slice(0, 10)}.pdf`);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('PDF preview failed', e);
      alert(`PDF preview failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const runPreview = async () => {
    if (!hasRunQuery) {
      runInquiry();
      // Fetch will run in next tick — generate after.
      setTimeout(() => { void generatePreviewPdf(rows); }, 250);
      return;
    }
    await generatePreviewPdf(rows);
  };

  // ── Selection helpers ──────────────────────────────────────────
  const [hideUnchecked, setHideUnchecked] = useState(false);
  const checkAll = () => {
    const next: Record<string, boolean> = {};
    for (const r of rows) next[r.id] = true;
    setChecked(next);
  };
  const uncheckAll = () => setChecked({});
  const uncheckInSelection = () => {
    const next = { ...checked };
    for (const r of rows) if (next[r.id]) next[r.id] = false;
    setChecked(next);
  };
  const clearUnchecked = () => {
    // "Clear Unchecked" hides rows that aren't checked from the visible result.
    // We implement it by toggling the hideUnchecked flag (re-click restores).
    setHideUnchecked((p) => !p);
  };

  const visibleRows = useMemo(() => {
    if (!hideUnchecked) return rows;
    return rows.filter((r) => checked[r.id]);
  }, [rows, checked, hideUnchecked]);

  // ── Group-by drag-zone ─────────────────────────────────────────
  const onDropGroupZone = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const key = e.dataTransfer.getData('text/col-key');
    if (!key) return;
    // Map the dropped column key to one of the supported groupBy values.
    const map: Record<string, GroupBy> = {
      item_group: 'item_group', debtor_code: 'debtor', debtor_name: 'debtor',
      branding: 'branding', agent: 'agent',
    };
    if (map[key]) setGroupBy(map[key]);
  };
  const onDragOverGroupZone = (e: React.DragEvent<HTMLDivElement>) => {
    if (e.dataTransfer.types.includes('text/col-key')) e.preventDefault();
  };
  const onDragStartColumn = (e: React.DragEvent<HTMLTableCellElement>, key: string) => {
    e.dataTransfer.setData('text/col-key', key);
    e.dataTransfer.effectAllowed = 'copy';
  };

  // ── Render ─────────────────────────────────────────────────────
  return (
    <div className={`${styles.page} ${optionsVisible ? '' : styles.optionsHidden}`}>
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <button type="button" className={styles.backBtn} onClick={() => navigate(-1)}>
            <ArrowLeft {...ICON} />
            <span>Back</span>
          </button>
          <div>
            <h1 className={styles.title}>
              <ClipboardList size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
              Sales Order Detail Listing
            </h1>
            <p className={styles.subtitle}>
              AutoCount-style report · one row per Sales Order line item
            </p>
          </div>
        </div>
      </div>

      {/* ── Filter cards (top) ──────────────────────────────────── */}
      {optionsVisible && (
        <div className={styles.filterRow}>
          {/* Basic Filter */}
          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Basic Filter</h2>
            </header>
            <div className={styles.cardBody}>
              <div className={styles.filterGrid}>
                {/* Document Date */}
                <div className={`${styles.field} ${styles.filterGridSpan2}`}>
                  <label className={styles.fieldLabel}>Document Date</label>
                  <div className={styles.dateRangeRow}>
                    <select
                      className={styles.fieldSelect}
                      value={docDateMode}
                      onChange={(e) => setDocDateMode(e.target.value as DateMode)}
                    >
                      <option value="range">Filter by range</option>
                      <option value="none">No filter</option>
                    </select>
                    <input
                      type="date"
                      className={styles.fieldInput}
                      value={dateFrom}
                      onChange={(e) => setDateFrom(e.target.value)}
                      disabled={docDateMode !== 'range'}
                    />
                    <input
                      type="date"
                      className={styles.fieldInput}
                      value={dateTo}
                      onChange={(e) => setDateTo(e.target.value)}
                      disabled={docDateMode !== 'range'}
                    />
                  </div>
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Document No</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={docNo}
                    onChange={(e) => setDocNo(e.target.value)}
                    placeholder="SO-009001"
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Debtor Code</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={debtorCode}
                    onChange={(e) => setDebtorCode(e.target.value)}
                  />
                </div>

                <div className={styles.field}>
                  <label className={styles.fieldLabel}>Item Code</label>
                  <input
                    type="text"
                    className={styles.fieldInput}
                    value={itemCode}
                    onChange={(e) => setItemCode(e.target.value)}
                  />
                </div>

                {/* Delivery Date */}
                <div className={`${styles.field} ${styles.filterGridSpan2}`}>
                  <label className={styles.fieldLabel}>Delivery Date</label>
                  <div className={styles.dateRangeRow}>
                    <select
                      className={styles.fieldSelect}
                      value={deliveryDateMode}
                      onChange={(e) => setDeliveryDateMode(e.target.value as DateMode)}
                    >
                      <option value="none">No filter</option>
                      <option value="range">Filter by range</option>
                    </select>
                    <input
                      type="date"
                      className={styles.fieldInput}
                      value={deliveryFrom}
                      onChange={(e) => setDeliveryFrom(e.target.value)}
                      disabled={deliveryDateMode !== 'range'}
                    />
                    <input
                      type="date"
                      className={styles.fieldInput}
                      value={deliveryTo}
                      onChange={(e) => setDeliveryTo(e.target.value)}
                      disabled={deliveryDateMode !== 'range'}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Report Options */}
          <section className={styles.card}>
            <header className={styles.cardHeader}>
              <h2 className={styles.cardTitle}>Report Options</h2>
            </header>
            <div className={`${styles.cardBody} ${styles.optionsBody}`}>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Group By</label>
                <select
                  className={styles.fieldSelect}
                  value={groupBy}
                  onChange={(e) => setGroupBy(e.target.value as GroupBy)}
                >
                  <option value="none">None</option>
                  <option value="branding">Branding</option>
                  <option value="agent">Agent</option>
                  <option value="debtor">Debtor</option>
                  <option value="item_group">Item Group</option>
                </select>
              </div>
              <div className={styles.field}>
                <label className={styles.fieldLabel}>Sort By</label>
                <select
                  className={styles.fieldSelect}
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value as SortBy)}
                >
                  <option value="date">Date</option>
                  <option value="doc_no">Doc No</option>
                  <option value="item_code">Item Code</option>
                </select>
              </div>
              <label className={styles.checkboxRow}>
                <input
                  type="checkbox"
                  checked={showCriteria}
                  onChange={(e) => setShowCriteria(e.target.checked)}
                />
                <span>Show Criteria In Report</span>
              </label>
              <div className={styles.optionsButtonRow}>
                <Button variant="ghost" size="sm" onClick={() => alert('More Options — coming soon')}>
                  <SlidersHorizontal {...SM_ICON} />
                  <span>More Options</span>
                </Button>
                <Button variant="ghost" size="sm" onClick={() => alert('Advanced Filter — coming soon')}>
                  <Filter {...SM_ICON} />
                  <span>Advanced Filter</span>
                </Button>
              </div>
            </div>
          </section>
        </div>
      )}

      {/* ── Action bar ─────────────────────────────────────────── */}
      <div className={styles.actionBar}>
        <Button variant="primary" size="sm" onClick={runInquiry}>
          <FileSearch {...SM_ICON} />
          <span>Inquiry</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={runPreview}>
          <Eye {...SM_ICON} />
          <span>Preview</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={runPrint}>
          <Printer {...SM_ICON} />
          <span>Print</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setOptionsVisible((v) => !v)}
        >
          <span>{optionsVisible ? 'Hide Options' : 'Show Options'}</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setCriteriaPanel((p) => !p)}>
          <span>Criteria</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
          <X {...SM_ICON} />
          <span>Close</span>
        </Button>
        <span style={{ marginLeft: 'auto', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          {query.isFetching ? 'Loading…' : hasRunQuery ? `${rawRows.length} line items` : 'Set filters and press Inquiry'}
        </span>
      </div>

      {/* ── Criteria summary (toggleable + always shown if Show Criteria) */}
      {(criteriaPanel || showCriteria) && (
        <div className={styles.criteriaBox}>
          <div>
            <div className={styles.criteriaKey}>Document Date</div>
            <div>{docDateMode === 'range' ? `${dateFrom} → ${dateTo}` : 'No filter'}</div>
          </div>
          <div>
            <div className={styles.criteriaKey}>Doc No</div>
            <div>{docNo || '—'}</div>
          </div>
          <div>
            <div className={styles.criteriaKey}>Debtor Code</div>
            <div>{debtorCode || '—'}</div>
          </div>
          <div>
            <div className={styles.criteriaKey}>Item Code</div>
            <div>{itemCode || '—'}</div>
          </div>
          <div>
            <div className={styles.criteriaKey}>Delivery Date</div>
            <div>{deliveryDateMode === 'range' ? `${deliveryFrom || '—'} → ${deliveryTo || '—'}` : 'No filter'}</div>
          </div>
          <div>
            <div className={styles.criteriaKey}>Group / Sort</div>
            <div>{groupBy} · {sortBy}</div>
          </div>
        </div>
      )}

      {/* ── Search Result ──────────────────────────────────────── */}
      <section className={styles.resultCard}>
        <header className={styles.resultHeader}>
          <h2 className={styles.resultTitle}>
            <ClipboardList size={14} strokeWidth={1.75} />
            Search Result
          </h2>
          <div className={styles.checkboxButtonRow}>
            <Button variant="ghost" size="sm" onClick={checkAll}>Check All</Button>
            <Button variant="ghost" size="sm" onClick={uncheckAll}>Uncheck All</Button>
            <Button variant="ghost" size="sm" onClick={uncheckInSelection}>Uncheck In Selection</Button>
            <Button variant="ghost" size="sm" onClick={clearUnchecked}>
              {hideUnchecked ? 'Show All' : 'Clear Unchecked'}
            </Button>
          </div>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search rows…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </header>

        {/* Group-by drag zone */}
        <div
          className={styles.groupZone}
          onDrop={onDropGroupZone}
          onDragOver={onDragOverGroupZone}
        >
          {groupBy === 'none' ? (
            <span>Drag a column header here to group by that column</span>
          ) : (
            <span className={styles.groupChip}>
              <span>{groupBy.replace('_', ' ')}</span>
              <button type="button" onClick={() => setGroupBy('none')} aria-label="Remove grouping">
                <X size={11} strokeWidth={1.75} />
              </button>
            </span>
          )}
        </div>

        <div className={styles.tableScroll}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th style={{ width: 28 }}>
                  <input
                    type="checkbox"
                    aria-label="Toggle all"
                    checked={rows.length > 0 && rows.every((r) => checked[r.id])}
                    onChange={(e) => (e.target.checked ? checkAll() : uncheckAll())}
                  />
                </th>
                {COLS.map((c) => (
                  <th
                    key={c.key}
                    draggable
                    onDragStart={(e) => onDragStartColumn(e, c.key)}
                    className={c.align === 'right' ? styles.tableRight : c.align === 'center' ? styles.tableCenter : undefined}
                    title="Drag onto the group zone above to group by this column"
                  >
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {!hasRunQuery && (
                <tr><td colSpan={COLS.length + 1} className={styles.emptyRow}>
                  Press <strong>Inquiry</strong> to run the report.
                </td></tr>
              )}
              {hasRunQuery && query.isFetching && rawRows.length === 0 && (
                <tr><td colSpan={COLS.length + 1} className={styles.emptyRow}>Loading…</td></tr>
              )}
              {hasRunQuery && !query.isFetching && visibleRows.length === 0 && (
                <tr><td colSpan={COLS.length + 1} className={styles.emptyRow}>No rows match the current filters.</td></tr>
              )}
              {hasRunQuery && !grouped && visibleRows.map((r) => (
                <DataRow key={r.id} row={r} checked={!!checked[r.id]} onToggle={() => setChecked((p) => ({ ...p, [r.id]: !p[r.id] }))} />
              ))}
              {hasRunQuery && grouped && grouped.map(([key, groupRows]) => {
                const visible = hideUnchecked ? groupRows.filter((r) => checked[r.id]) : groupRows;
                if (visible.length === 0) return null;
                const isOpen = !collapsedGroups[key];
                return (
                  <GroupBlock
                    key={key}
                    label={key}
                    rows={visible}
                    open={isOpen}
                    onToggle={() => setCollapsedGroups((p) => ({ ...p, [key]: !p[key] }))}
                    checked={checked}
                    setChecked={setChecked}
                  />
                );
              })}
            </tbody>
            {hasRunQuery && visibleRows.length > 0 && (
              <tfoot>
                <tr className={styles.footerRow}>
                  <td colSpan={COLS.length + 1} style={{ textAlign: 'right' }}>
                    {visibleRows.length} rows · {COLS.length} columns ·
                    Total {fmtRm(
                      visibleRows.reduce((s, r) => s + (Number(r.total_centi ?? 0)), 0),
                      visibleRows[0]?.currency ?? 'MYR',
                    )}
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>
    </div>
  );
};

// ── Row primitives ──────────────────────────────────────────────

const DataRow = ({ row, checked, onToggle }: {
  row: SoDetailListingRow; checked: boolean; onToggle: () => void;
}) => (
  <tr>
    <td>
      <input type="checkbox" checked={checked} onChange={onToggle} aria-label={`Toggle ${row.doc_no} / ${row.item_code}`} />
    </td>
    {COLS.map((c) => (
      <td
        key={c.key}
        className={c.align === 'right' ? styles.tableRight : c.align === 'center' ? styles.tableCenter : undefined}
      >
        {c.render(row)}
      </td>
    ))}
  </tr>
);

const GroupBlock = ({ label, rows, open, onToggle, checked, setChecked }: {
  label: string;
  rows: SoDetailListingRow[];
  open: boolean;
  onToggle: () => void;
  checked: Record<string, boolean>;
  setChecked: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
}) => (
  <>
    <tr className={styles.groupRow} onClick={onToggle}>
      <td colSpan={COLS.length + 1}>
        <span className={`${styles.caret} ${open ? styles.caretOpen : ''}`}>
          <ChevronRight size={12} strokeWidth={1.75} />
        </span>
        {label || '—'} · {rows.length}
      </td>
    </tr>
    {open && rows.map((r) => (
      <DataRow
        key={r.id}
        row={r}
        checked={!!checked[r.id]}
        onToggle={() => setChecked((p) => ({ ...p, [r.id]: !p[r.id] }))}
      />
    ))}
  </>
);

// Re-export the column lookup (for tests / debug)
export { COL_LOOKUP };
