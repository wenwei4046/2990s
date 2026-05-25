// ----------------------------------------------------------------------------
// Fabric Tracking — minimal master view.
//
// 5 columns only (commander, 2026-05-24): Fabric Code · Description ·
// Supplier Code (inline editable) · Sofa Tier · Bedframe Tier.
//
// The actual table is shared with Products → Maintenance → Fabrics via
// components/FabricsTable.tsx.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import {
  useFabricTrackings,
  type FabricCategoryValue,
} from '../lib/fabric-queries';
import { FabricsTable } from '../components/FabricsTable';
import styles from './FabricTracking.module.css';

const CATEGORY_OPTIONS: { value: 'all' | FabricCategoryValue; label: string }[] = [
  { value: 'all', label: 'All Categories' },
  { value: 'B.M-FABR', label: 'B.M-FABR · Bedframe Main' },
  { value: 'S-FABR', label: 'S-FABR · Secondary' },
  { value: 'S.M-FABR', label: 'S.M-FABR · Sofa Main' },
  { value: 'LINING', label: 'LINING' },
  { value: 'WEBBING', label: 'WEBBING' },
];

export const FabricTracking = () => {
  const [category, setCategory] = useState<'all' | FabricCategoryValue>('all');
  const [search, setSearch] = useState('');

  const { data: fabrics, isLoading, error } = useFabricTrackings({
    category: category === 'all' ? undefined : category,
    search: search.trim() || undefined,
  });

  const rows = useMemo(() => fabrics ?? [], [fabrics]);

  return (
    <div className={styles.page}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>Fabric Tracking</h1>
        <p className={styles.subtitle}>Fabric master — drives sofa + bedframe pricing tier and the supplier code printed on POs.</p>
      </div>

      <div className={styles.filterRow}>
        <div className={styles.searchBox}>
          <Search size={16} strokeWidth={1.75} className={styles.searchIcon} />
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search by code or description…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <select
          className={styles.categorySelect}
          value={category}
          onChange={(e) => setCategory(e.target.value as 'all' | FabricCategoryValue)}
        >
          {CATEGORY_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <FabricsTable rows={rows} isLoading={isLoading} error={error} />
    </div>
  );
};
