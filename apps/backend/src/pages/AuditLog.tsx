import { useMemo, useState } from 'react';
import { FileSpreadsheet, Download, Receipt } from 'lucide-react';
import { fmtRM } from '@2990s/shared';
import {
  useAuditLog, useAuditLogRealtime,
  type AuditLogFilters, type AuditLogRow,
} from '../lib/audit-log-queries';
import { useShowrooms, useStaff } from '../lib/admin-queries';
import { AuditLogFilterBar } from '../components/AuditLogFilterBar';
import { SlipPreviewModal } from '../components/SlipPreviewModal';
import {
  exportCsv, exportXlsx, downloadBlob,
  type AuditExportRow,
} from '../lib/audit-export';
import styles from './AuditLog.module.css';

const todayMinusDays = (n: number): string => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
};

const defaultFilters: AuditLogFilters = {
  from: todayMinusDays(30),
  to:   todayMinusDays(0),
  slipUploaded: 'any',
};

const fmtDateCell = (iso: string): string => {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${dd} ${months[d.getMonth()]} ${d.getFullYear()} ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
};

export const AuditLog = () => {
  const [filters, setFilters] = useState<AuditLogFilters>(defaultFilters);
  const [slipModal, setSlipModal] = useState<{ orderId: string; slipKey: string } | null>(null);

  const query = useAuditLog(filters);
  useAuditLogRealtime();
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

  const rows = query.data?.rows ?? [];

  const toExportRows = (input: AuditLogRow[]): AuditExportRow[] =>
    input.map((r) => ({
      id: r.id,
      placedAt: r.placedAt,
      showroomName: showroomName(r.showroomId),
      customerName: r.customerName,
      total: r.total,
      paymentMethod: r.paymentMethod,
      approvalCode: r.approvalCode,
      salespersonName: staffName(r.salespersonId),
      keyedByName: staffName(r.staffId),
      slipUploaded: r.slipUploaded,
    }));

  const today = new Date().toISOString().slice(0, 10);

  const onExportXlsx = async () => {
    const bytes = await exportXlsx(toExportRows(rows));
    downloadBlob(
      bytes,
      `2990s-audit-log-${today}.xlsx`,
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    );
  };

  const onExportCsv = () => {
    const csv = exportCsv(toExportRows(rows));
    downloadBlob(csv, `2990s-audit-log-${today}.csv`, 'text/csv;charset=utf-8');
  };

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerText}>
          <div className="t-eyebrow">Finance reports</div>
          <h2 className={styles.title}>Payment audit log</h2>
          <p className={`t-body fg-muted ${styles.lede}`}>
            Every recorded payment. Filter, then export to .xlsx or .csv for
            bank-statement reconciliation.
          </p>
        </div>
        <div className={styles.exportButtons}>
          <button
            type="button"
            className={styles.exportBtn}
            disabled={rows.length === 0}
            onClick={() => void onExportXlsx()}
          >
            <FileSpreadsheet size={16} strokeWidth={1.75} />
            Export .xlsx
          </button>
          <button
            type="button"
            className={`${styles.exportBtn} ${styles.exportBtnGhost}`}
            disabled={rows.length === 0}
            onClick={onExportCsv}
          >
            <Download size={16} strokeWidth={1.75} />
            Export .csv
          </button>
        </div>
      </header>

      <AuditLogFilterBar
        filters={filters}
        onChange={setFilters}
        onReset={() => setFilters(defaultFilters)}
      />

      <div className={styles.tableWrap}>
        {query.isLoading && <div className={styles.empty}>Loading…</div>}
        {query.error && (
          <div className={styles.empty}>Failed to load: {String(query.error)}</div>
        )}
        {!query.isLoading && !query.error && rows.length === 0 && (
          <div className={styles.empty}>
            No payments match these filters. Try widening the date range or
            clearing a filter.
          </div>
        )}
        {!query.isLoading && !query.error && rows.length > 0 && (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>SO#</th>
                <th>Date</th>
                <th>Showroom</th>
                <th>Customer</th>
                <th className={styles.numCell}>Amount</th>
                <th>Method</th>
                <th>Approval code</th>
                <th>Salesperson</th>
                <th>Keyed by</th>
                <th>Slip</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={styles.monoCell}>{r.id}</td>
                  <td>{fmtDateCell(r.placedAt)}</td>
                  <td>{showroomName(r.showroomId)}</td>
                  <td>{r.customerName}</td>
                  <td className={styles.numCell}>{fmtRM(r.total)}</td>
                  <td>{r.paymentMethod}</td>
                  <td className={styles.monoCell}>{r.approvalCode ?? '—'}</td>
                  <td>{staffName(r.salespersonId)}</td>
                  <td>{staffName(r.staffId)}</td>
                  <td>
                    {r.slipKey ? (
                      <button
                        type="button"
                        className={styles.slipBtn}
                        onClick={() => setSlipModal({ orderId: r.id, slipKey: r.slipKey! })}
                        aria-label={`View slip for ${r.id}`}
                      >
                        <Receipt size={16} strokeWidth={1.75} />
                        View
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {slipModal && (
        <SlipPreviewModal
          orderId={slipModal.orderId}
          slipKey={slipModal.slipKey}
          onClose={() => setSlipModal(null)}
        />
      )}
    </div>
  );
};
