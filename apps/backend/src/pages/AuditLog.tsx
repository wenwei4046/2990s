import { useMemo, useState } from 'react';
import {
  Receipt, Download, FileSpreadsheet, ChevronsDown, ChevronsUp,
  ChevronRight, CreditCard, CalendarClock, QrCode, Banknote,
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
import { OrderDrawer } from '../components/OrderDrawer';
import {
  exportCsv, exportXlsx, downloadBlob, type AuditExportRow,
} from '../lib/audit-export';
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
  const [drawerOrderId, setDrawerOrderId] = useState<string | null>(null);

  const query = useAuditLog(filters);
  // Audit-log realtime channel removed (perf-router-realtime-sidebar) — it
  // duplicated useOrdersRealtime's `orders` subscription. Page falls back to
  // staleTime-driven refetch on focus / manual refresh; opening Orders or
  // Dashboard already keeps the cache fresh via the surviving channel.
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
  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });

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
  const today = new Date().toISOString().slice(0, 10);

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

      <div className={styles.tableWrap}>
        {query.isLoading && <div className={styles.empty}>Loading…</div>}
        {query.error && <div className={styles.empty}>Failed to load: {String(query.error)}</div>}
        {!query.isLoading && !query.error && rows.length === 0 && (
          <div className={styles.empty}>
            No payments match these filters. Try widening the date range, clearing a
            filter, or changing your search.
          </div>
        )}
        {!query.isLoading && !query.error && rows.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.checkCol}>
                  <input type="checkbox" checked={allSelected} onChange={toggleAll}
                    aria-label="Select all" />
                </th>
                <th>Date / time</th>
                <th>SO#</th>
                <th>Customer</th>
                <th className={styles.numCol}>Amount</th>
                <th>Method · details</th>
                <th>Approval code</th>
                <th>Salesperson</th>
                <th aria-label="Open" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const badge = amountBadge(r.paid, r.total);
                const Icon = METHOD_ICON[r.paymentMethod] ?? CreditCard;
                const detail = methodDetail(r);
                return (
                  <tr key={r.id} className={selected.has(r.id) ? styles.rowSelected : ''}>
                    <td className={styles.checkCol}>
                      <input type="checkbox" checked={selected.has(r.id)}
                        onChange={() => toggleOne(r.id)} aria-label={`Select ${r.id}`} />
                    </td>
                    <td><div className={styles.day}>{fmtDay(r.placedAt)}</div>
                        <div className={styles.clock}>{fmtClock(r.placedAt)}</div></td>
                    <td><span className={styles.soPill}>{r.id}</span></td>
                    <td><div className={styles.custName}>{r.customerName}</div>
                        {r.customerPhone && <div className={styles.custPhone}>{r.customerPhone}</div>}</td>
                    <td className={styles.numCol}>
                      <div className={styles.amount}><sup>RM</sup>{fmtRM(r.paid).replace(/^RM\s?/, '')}</div>
                      {badge.kind === 'full'
                        ? <span className={`${styles.badge} ${styles.badgeFull}`}>Full payment</span>
                        : <span className={`${styles.badge} ${styles.badgeDeposit}`}>
                            Deposit · {badge.pct}% of {badge.total.toLocaleString('en-MY')}
                          </span>}
                    </td>
                    <td>
                      <div className={styles.method}>
                        <span className={`${styles.tile} ${METHOD_TILE[r.paymentMethod] ?? ''}`}>
                          <Icon size={18} strokeWidth={1.75} />
                        </span>
                        <span>
                          <strong className={styles.methodName}>{methodLabel(r.paymentMethod)}</strong>
                          {detail && <span className={styles.methodDetail}>{detail}</span>}
                        </span>
                      </div>
                    </td>
                    <td className={styles.approvalCell}>{r.approvalCode ?? '—'}</td>
                    <td>
                      <span className={styles.sp}>
                        <span className={styles.avatar}>{initials(staffName(r.salespersonId))}</span>
                        {staffName(r.salespersonId)}
                      </span>
                    </td>
                    <td>
                      <button type="button" className={styles.openBtn}
                        onClick={() => setDrawerOrderId(r.id)} aria-label={`Open ${r.id}`}>
                        <ChevronRight size={18} strokeWidth={1.75} />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <OrderDrawer orderId={drawerOrderId} onClose={() => setDrawerOrderId(null)} />
    </div>
  );
};
