// ----------------------------------------------------------------------------
// ConsignmentList — Sales Consignment order list at /consignment.
//
// A Consignment Order is an agreement to place our goods at a customer's branch
// to sell (goods stay ours). This list shows every order; "+ New Consignment"
// opens the create form, a row click opens the detail page.
//
// Layout mirrors the list pages built on Suppliers.module.css (page / title /
// searchBox / table / statusPill).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { fmtDateOrDash } from '@2990s/shared';
import { useConsignmentOrders, type ConsignmentOrder } from '../lib/consignment-queries';
import styles from './Suppliers.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

// Tints follow the shared lifecycle palette used elsewhere (active=green,
// cancelled/closed=red/grey). Unknown statuses fall back to the neutral pill.
const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  OPEN:      { bg: 'rgba(166, 71, 30, 0.12)', fg: 'var(--c-burnt)' },
  ACTIVE:    { bg: 'rgba(47, 93, 79, 0.12)',  fg: 'var(--c-secondary-a, #2F5D4F)' },
  CLOSED:    { bg: 'rgba(34, 31, 32, 0.18)',  fg: 'var(--c-ink)' },
  CANCELLED: { bg: 'rgba(184, 51, 31, 0.10)', fg: 'var(--c-festive-b, #B8331F)' },
};

const titleCase = (s: string) =>
  s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const ConsignmentList = () => {
  const navigate = useNavigate();
  const { data, isLoading, error } = useConsignmentOrders();
  const [search, setSearch] = useState('');

  const rows = useMemo<ConsignmentOrder[]>(() => {
    const all = data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((o) =>
      [o.consignment_number, o.debtor_name, o.debtor_code, o.branch_location, o.status]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q)),
    );
  }, [data, search]);

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>Sales Consignment</h1>
          <p className={styles.subtitle}>
            Goods placed at a customer's branch to sell — stock stays ours until sold.
          </p>
        </div>
        <Button variant="primary" size="sm" onClick={() => navigate('/consignment/new')}>
          <Plus {...ICON} />
          <span>New Consignment</span>
        </Button>
      </div>

      <div className={styles.actionsRow}>
        <div className={styles.searchBox}>
          <Search size={16} strokeWidth={1.75} className={styles.searchIcon} />
          <input
            className={styles.searchInput}
            placeholder="Search consignments…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading ? 'Loading consignments…' : `${rows.length} consignment${rows.length === 1 ? '' : 's'}`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load consignments.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Consignment No.</th>
              <th>Debtor</th>
              <th>Branch</th>
              <th>Placed Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {!isLoading && rows.length === 0 && (
              <tr>
                <td className={styles.emptyRow} colSpan={5}>
                  {search
                    ? 'No consignments match your search.'
                    : 'No consignments yet — create one with “New Consignment”.'}
                </td>
              </tr>
            )}
            {rows.map((o) => {
              const tint = STATUS_COLOR[o.status] ?? { bg: 'rgba(34, 31, 32, 0.08)', fg: 'var(--fg-muted)' };
              return (
                <tr key={o.id} onClick={() => navigate(`/consignment/${o.id}`)}>
                  <td>
                    <span style={{ fontWeight: 700, color: 'var(--c-burnt)', fontVariantNumeric: 'tabular-nums' }}>
                      {o.consignment_number}
                    </span>
                  </td>
                  <td>
                    {o.debtor_name}
                    {o.debtor_code && (
                      <span className={styles.bindingName} style={{ marginLeft: 6 }}>{o.debtor_code}</span>
                    )}
                  </td>
                  <td>{o.branch_location || <span className={styles.bindingName}>—</span>}</td>
                  <td style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtDateOrDash(o.placed_at)}</td>
                  <td>
                    <span className={styles.statusPill} style={{ background: tint.bg, color: tint.fg }}>
                      {titleCase(o.status)}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};
