// SalesAnalysis — shell only: Topbar, header row, period select, include-test
// toggle, tabs, loading/error states. All content lives in the three tab
// components under components/sales-analysis/.

import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { useSalesAnalysis } from '../lib/sales-analysis-queries';
import { OverviewTab } from '../components/sales-analysis/OverviewTab';
import { CustomerDataTab } from '../components/sales-analysis/CustomerDataTab';
import { ProductsTab } from '../components/sales-analysis/ProductsTab';
import saShared from '../components/sales-analysis/SaShared.module.css';
import styles from './SalesAnalysis.module.css';

const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'customers', label: 'Customer Data' },
  { id: 'products', label: 'Products' },
] as const;

type TabId = (typeof TABS)[number]['id'];

/** A one-line statement of what the reader is looking at, under the title —
 *  the same subtitle device the OPEX & Commission page uses. The period was
 *  previously legible only from the select at the far right of the header. */
const scopeLine = (period: string, includeTest: boolean): string =>
  `${period === 'all' ? 'All time' : period}${includeTest ? ' · including test orders' : ''}`;

export const SalesAnalysis = () => {
  const [period, setPeriod] = useState('all');
  const [includeTest, setIncludeTest] = useState(false);
  const [tab, setTab] = useState<TabId>('overview');
  const { data, isLoading, error } = useSalesAnalysis(period, includeTest);

  // Period options derive from the (always-full) monthly trend.
  const monthOptions = useMemo(() => (data?.monthly ?? []).map((m) => m.month).reverse(), [data]);

  return (
    <>
      <Topbar />
      <div className={styles.page}>
        <div className={styles.headerRow}>
          <div className={styles.titleBlock}>
            <Link to="/catalog" className={styles.backBtn}>
              <ArrowLeft size={16} strokeWidth={1.75} /> <span>Catalog</span>
            </Link>
            <div className={styles.titleText}>
              <h1 className={styles.title}>Sales analysis</h1>
              <p className={styles.subtitle}>{scopeLine(period, includeTest)}</p>
            </div>
          </div>
          <div className={styles.controls}>
            <select
              value={period}
              aria-label="Period"
              onChange={(e) => setPeriod(e.target.value)}
            >
              <option value="all">All time</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <label className={styles.toggle}>
              <input
                type="checkbox"
                checked={includeTest}
                onChange={(e) => setIncludeTest(e.target.checked)}
              />
              Include test orders
            </label>
          </div>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Sales analysis sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={tab === t.id}
              className={`${styles.tab} ${tab === t.id ? styles.tabActive : ''}`}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {isLoading && <p className={styles.muted}>Loading…</p>}
        {error && <p className={styles.note}>Could not load analytics: {(error as Error).message}</p>}

        {data && (
          <div className={saShared.saRoot}>
            {tab === 'overview' && (
              <OverviewTab
                overview={data.overview}
                monthly={data.monthly}
                customers={data.customers}
                products={data.products}
                period={period}
                onNavigate={setTab}
              />
            )}
            {tab === 'customers' && <CustomerDataTab customers={data.customers} targets={data.targets} />}
            {tab === 'products' && <ProductsTab products={data.products} />}
          </div>
        )}
      </div>
    </>
  );
};
