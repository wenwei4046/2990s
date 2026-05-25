// ----------------------------------------------------------------------------
// Fabric Converter — minimal master view (renamed from Fabric Tracking 2026-05-26).
//
// 5 columns: Fabric Code · Description (editable) · Supplier Code (editable) ·
// Sofa Tier · Bedframe Tier. Tiers cycle PRICE_1 → 2 → 3 on click.
//
// Commander 2026-05-26: 1. drop the "All Categories" dropdown 2. function is
// "Fabric Converter" not "Fabric Tracking" 3. Description must be editable.
//
// The table is shared with Products → Maintenance → Fabrics via
// components/FabricsTable.tsx.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useFabricTrackings } from '../lib/fabric-queries';
import { FabricsTable } from '../components/FabricsTable';
import styles from './FabricTracking.module.css';

export const FabricTracking = () => {
  const [search, setSearch] = useState('');

  const { data: fabrics, isLoading, error } = useFabricTrackings({
    search: search.trim() || undefined,
  });

  const rows = useMemo(() => fabrics ?? [], [fabrics]);

  return (
    <div className={styles.page}>
      <div className={styles.titleBlock}>
        <h1 className={styles.title}>Fabric Converter</h1>
        <p className={styles.subtitle}>Fabric master — drives sofa + bedframe pricing tier and the supplier code printed on POs. Click Description to edit.</p>
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
      </div>

      <FabricsTable rows={rows} isLoading={isLoading} error={error} />
    </div>
  );
};
