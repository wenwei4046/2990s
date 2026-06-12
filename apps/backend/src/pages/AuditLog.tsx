import { todayMyt } from '../lib/dates';
import { useCallback, useMemo, useState } from 'react';
import {
  Receipt, Download, FileSpreadsheet, ChevronsDown, ChevronsUp,
  CreditCard, CalendarClock, QrCode, Banknote,
} from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import {
  useAuditLog,
  type AuditLogFilters, type AuditLogRow,
} from '../lib/audit-log-queries';
import {
  rangeForPreset, presetForRange, amountBadge, matchesSearch,
  methodLabel, methodDetail, initials, type QuickRange,
} from '../lib/audit-log-view';
import { useShowrooms, useStaff } from '../lib/admin-queries';
import { AuditLogFilterBar } from '../components/AuditLogFilterBar';
import {
  exportCsv, exportXlsx, downloadBlob, type AuditExportRow,
} from '../lib/audit-export';
import { DataGrid, type DataGridColumn } from '../components/DataGrid';
import styles from './AuditLog.module.css';

const defaultFilters = (): AuditLogFilters => ({ ...rangeForPreset('last30') });

const QUICK_RANGES: { key: QuickRange; label: string }[] = [
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'last7', label: 'Last 7 days' },
  { key: 'last30', label: 'Last 30 days' },
  { key: 'last90', label: 'Last 90 days' },
];

const RANGE_SUBTITLE: Record<QuickRange, string> = {
  today: 'today', yesterday: 'yesterday',
  last7: 'last 7 days', last30: 'last 30 days', last90: 'last 90 days',
};

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
};
const fmtClock = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

const METHOD_ICON: Record<string, typeof CreditCard> = {
  credit: CreditCard, debit: CreditCard, installment: CalendarClock, transfer: QrCode,
  merchant: CreditCard, cash: Banknote,
};
const METHOD_TILE: Record<string, string | undefined> = {
  credit: styles.tileCredit, debit: styles.tileDebit,
  installment: styles.tileInstallment, transfer: styles.tileTransfer,
  merchant: styles.tileMerchant, cash: styles.tileCash,
};

export const AuditLog = () => {
  const [filters, setFilters] = useState<AuditLogFilters>(defaultFilters);
  const [search, setSearch] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [exportOpen, setExportOpen] = useState(false);

  const query = useAuditLog(filters);
  // No realtime channel — page falls back to staleTime-driven refetch on
  // focus / manual refresh. (The legacy orders-table subscription went away
  // with the /orders route cleanup, 2026-06-12.)
  const showrooms = useShowrooms();
  const staff = useStaff();

  const showroomName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of showrooms.data ?? []) m.set(s.id, s.name);
    return (id: string) => m.get(id) ?? '—';
  }, [showrooms.data]);
  const staffName = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of staff.data ?? []) m.set(s.id, s.name);
    return (id: string | null) => (id ? m.get(id) ?? '—' : '—');
  }, [staff.data]);

  const serverRows = useMemo(() => query.data?.rows ?? [], [query.data]);
  const rows = useMemo(
    () => serverRows.filter((r) => matchesSearch(r, search)),
    [serverRows, search],
  );

  const totalPaid = useMemo(() => rows.reduce((s, r) => s + r.paid, 0), [rows]);
  const activePreset = presetForRange(filters.from, filters.to);
  const rangeSubtitle = activePreset ? RANGE_SUBTITLE[activePreset] : 'custom range';

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));
  const toggleOne = useCallback((id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    }), []);

  const setPreset = (key: QuickRange) => setFilters({ ...filters, ...rangeForPreset(key) });

  const toExportRows = (input: AuditLogRow[]): AuditExportRow[] =>
    input.map((r) => ({
      id: r.id, placedAt: r.placedAt, showroomName: showroomName(r.showroomId),
      customerName: r.customerName, total: r.total, paid: r.paid,
      paymentMethod: r.paymentMethod, merchantProvider: r.merchantProvider, installmentMonths: r.installmentMonths,
      approvalCode: r.approvalCode, salespersonName: staffName(r.salespersonId),
      keyedByName: staffName(r.staffId), slipUploaded: r.slipUploaded,
    }));

  const rowsToExport = () =>
    selected.size > 0 ? rows.filter((r) => selected.has(r.id)) : rows;
  const today = todayMyt();

  const onExportXlsx = async () => {
    setExportOpen(false);
    const bytes = await exportXlsx(toExportRows(rowsToExport()));
    downloadBlob(bytes, `2990s-audit-log-${today}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  };
  const onExportCsv = () => {
    setExportOpen(false);
    downloadBlob(exportCsv(toExportRows(rowsToExport())),
      `2990s-audit-log-${today}.csv`, 'text/csv;charset=utf-8');
  };

  /* Shared DataGrid conversion (2026-06-12). Hero / stats / quick-range
     chips / AuditLogFilterBar stay as-is (they drive the server query +
     the `rows` pre-filter); the grid adds sort, per-column filters, column
     show-hide / reorder / pin + its own free-text search. Bulk select for
     export keeps the external Set; checkboxes stopPropagation. Approval
     code ships default-hidden (low-value) — Columns popover re-enables. */
  const columns = useMemo<DataGridColumn<AuditLogRow>[]>(() => [
    {
      key: 'sel',
      label: '',
      width: 40,
      minWidth: 36,
      sortable: false,
      groupable: false,
      accessor: (r) => (
        <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex' }}>
          <input type="checkbox" checked={selected.has(r.id)}
            onChange={() => toggleOne(r.id)} aria-label={`Select ${r.id}`} />
        </span>
      ),
      searchValue: () => '',
    },
    {
      key: 'when',
      label: 'Date / time',
      width: 110,
      accessor: (r) => (
        <>
          <div className={styles.day}>{fmtDay(r.placedAt)}</div>
          <div className={styles.clock}>{fmtClock(r.placedAt)}</div>
        </>
      ),
      searchValue: (r) => `${fmtDay(r.placedAt)} ${fmtClock(r.placedAt)}`,
      filterValue: (r) => fmtDay(r.placedAt),
      sortFn: (a, b) => a.placedAt.localeCompare(b.placedAt),
    },
    {
      key: 'so',
      label: 'SO#',
      width: 130,
      accessor: (r) => <span className={styles.soPill}>{r.id}</span>,
      searchValue: (r) => r.id,
      filterValue: (r) => r.id,
      sortFn: (a, b) => a.id.localeCompare(b.id),
    },
    {
      key: 'customer',
      label: 'Customer',
      width: 180,
      accessor: (r) => (
        <>
          <div className={styles.custName}>{r.customerName}</div>
          {r.customerPhone && <div className={styles.custPhone}>{r.customerPhone}</div>}
        </>
      ),
      searchValue: (r) => `${r.customerName} ${r.customerPhone ?? ''}`,
      filterValue: (r) => r.customerName,
      sortFn: (a, b) => a.customerName.localeCompare(b.customerName),
    },
    {
      key: 'amount',
      label: 'Amount',
      width: 180,
      align: 'right',
      accessor: (r) => {
        const badge = amountBadge(r.paid, r.total);
        return (
          <>
            <div className={styles.amount}><sup>RM</sup>{fmtRM(r.paid).replace(/^RM\s?/, '')}</div>
            {badge.kind === 'full'
              ? <span className={`${styles.badge} ${styles.badgeFull}`}>Full payment</span>
              : <span className={`${styles.badge} ${styles.badgeDeposit}`}>
                  Deposit · {badge.pct}% of {badge.total.toLocaleString('en-MY')}
                </span>}
          </>
        );
      },
      searchValue: (r) => String(r.paid),
      filterValue: (r) => fmtRM(r.paid),
      sortFn: (a, b) => a.paid - b.paid,
    },
    {
      key: 'method',
      label: 'Method · details',
      width: 200,
      accessor: (r) => {
        const Icon = METHOD_ICON[r.paymentMethod] ?? CreditCard;
        const detail = methodDetail(r);
        return (
          <div className={styles.method}>
            <span className={`${styles.tile} ${METHOD_TILE[r.paymentMethod] ?? ''}`}>
              <Icon size={18} strokeWidth={1.75} />
            </span>
            <span>
              <strong className={styles.methodName}>{methodLabel(r.paymentMethod)}</strong>
              {detail && <span className={styles.methodDetail}>{detail}</span>}
            </span>
          </div>
        );
      },
      searchValue: (r) => `${methodLabel(r.paymentMethod)} ${methodDetail(r) ?? ''}`,
      filterValue: (r) => methodLabel(r.paymentMethod),
    },
    {
      key: 'approval',
      label: 'Approval code',
      width: 130,
      accessor: (r) => <span className={styles.approvalCell}>{r.approvalCode ?? '—'}</span>,
      searchValue: (r) => r.approvalCode ?? '',
      filterValue: (r) => r.approvalCode ?? '—',
      defaultHidden: true,
    },
    {
      key: 'salesperson',
      label: 'Salesperson',
      width: 160,
      accessor: (r) => (
        <span className={styles.sp}>
          <span className={styles.avatar}>{initials(staffName(r.salespersonId))}</span>
          {staffName(r.salespersonId)}
        </span>
      ),
      searchValue: (r) => staffName(r.salespersonId),
      filterValue: (r) => staffName(r.salespersonId),
    },
  ], [selected, toggleOne, staffName]);

  /* Selected-row tint — same look as the legacy .rowSelected class. */
  const rowStyle = useCallback(
    (r: AuditLogRow) => (selected.has(r.id)
      ? { background: 'rgba(166,71,30,0.05)' }
      : undefined),
    [selected],
  );

  return (
    <div className={styles.page}>
      <section className={styles.hero}>
        <span className={styles.heroIcon}><Receipt size={24} strokeWidth={1.75} /></span>
        <div className={styles.heroText}>
          <h2 className={styles.heroTitle}>Payment audit log</h2>
          <p className={styles.heroLede}>
            Every recorded payment, with full audit trail. Filter, search, and export
            to .xlsx or .csv for bank-statement reconciliation.
          </p>
        </div>
        <div className={styles.exportWrap}>
          <button type="button" className={styles.exportBtn} disabled={rows.length === 0}
            onClick={() => setExportOpen((v) => !v)}>
            <Download size={18} strokeWidth={1.75} /> Export &amp; tools
            <ChevronsDown size={16} strokeWidth={1.75} />
          </button>
          {exportOpen && (
            <div className={styles.exportMenu} role="menu">
              <button type="button" role="menuitem" onClick={() => void onExportXlsx()}>
                <FileSpreadsheet size={16} strokeWidth={1.75} /> Export .xlsx
              </button>
              <button type="button" role="menuitem" onClick={onExportCsv}>
                <Download size={16} strokeWidth={1.75} /> Export .csv
              </button>
              <span className={styles.exportHint}>
                {selected.size > 0 ? `${selected.size} selected` : `all ${rows.length} shown`}
              </span>
            </div>
          )}
        </div>
      </section>

      <div className={styles.stats}>
        <div className={`${styles.statCard} ${styles.statTotal}`}>
          <span className={styles.statLabel}>Total recorded</span>
          <span className={styles.statValue}><sup>RM</sup>{totalPaid.toLocaleString('en-MY')}</span>
          <span className={styles.statSub}>{rangeSubtitle}</span>
        </div>
        <div className={styles.statCard}>
          <span className={styles.statHash}>#</span>
          <span className={styles.statCount}>{rows.length}</span>
          <span className={styles.statLabel}>Payments</span>
        </div>
      </div>

      <div className={styles.quickRow}>
        <span className={styles.quickLabel}>Quick range</span>
        <div className={styles.quickChips}>
          {QUICK_RANGES.map(({ key, label }) => (
            <button key={key} type="button"
              className={`${styles.quickChip} ${activePreset === key ? styles.quickChipActive : ''}`}
              onClick={() => setPreset(key)}>{label}</button>
          ))}
        </div>
        <button type="button" className={styles.toggleBtn} onClick={() => setFiltersOpen((v) => !v)}>
          {filtersOpen
            ? <><ChevronsUp size={18} strokeWidth={1.75} /> Hide filters</>
            : <><ChevronsDown size={18} strokeWidth={1.75} /> Show filters</>}
        </button>
      </div>

      {filtersOpen && (
        <AuditLogFilterBar
          filters={filters}
          onChange={setFilters}
          onReset={() => { setFilters(defaultFilters()); setSearch(''); }}
          search={search}
          onSearchChange={setSearch}
          matchCount={rows.length}
          totalCount={serverRows.length}
        />
      )}

      {query.error ? (
        <div className={styles.tableWrap}>
          <div className={styles.empty}>Failed to load: {String(query.error)}</div>
        </div>
      ) : (
        <DataGrid
          rows={rows}
          columns={columns}
          storageKey="dg-audit-log"
          rowKey={(r) => r.id}
          searchPlaceholder="Filter visible payments…"
          groupBanner={false}
          isLoading={query.isLoading}
          emptyMessage="No payments match these filters. Try widening the date range, clearing a filter, or changing your search."
          rowStyle={rowStyle}
          toolbar={
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', cursor: 'pointer',
            }}>
              <input type="checkbox" checked={allSelected} onChange={toggleAll}
                aria-label="Select all" />
              <span>Select all{selected.size > 0 ? ` (${selected.size})` : ''}</span>
            </label>
          }
        />
      )}
    </div>
  );
};
