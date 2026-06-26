import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { fmtCenti, fmtQty } from '@2990s/shared';
import { Topbar } from '../components/Topbar';
import { useSalesAnalysis } from '../lib/sales-analysis-queries';
import { CustomerDataTab } from '../components/sales-analysis/CustomerDataTab';
import { ProductsTab } from '../components/sales-analysis/ProductsTab';
import styles from './SalesAnalysis.module.css';

const MIN_SAMPLE = 10; // below this, rates are noise — flag them.

const pct = (v: number | null): string => (v == null ? '—' : `${v.toFixed(1)}%`);

export const SalesAnalysis = () => {
  const [period, setPeriod] = useState('all');
  const [includeTest, setIncludeTest] = useState(false);
  const [tab, setTab] = useState<'overview' | 'customers' | 'products'>('overview');
  const { data, isLoading, error } = useSalesAnalysis(period, includeTest);

  // Period options derive from the (always-full) monthly trend.
  const monthOptions = useMemo(() => (data?.monthly ?? []).map((m) => m.month).reverse(), [data]);
  const maxRevenue = useMemo(
    () => Math.max(1, ...(data?.monthly ?? []).map((m) => m.revenueCenti)),
    [data],
  );

  const ov = data?.overview;
  const thin = !!ov && ov.n < MIN_SAMPLE;

  return (
    <>
      <Topbar />
      <div className={styles.page}>
        <div className={styles.headerRow}>
          <div className={styles.titleBlock}>
            <Link to="/catalog" className={styles.backBtn}>
              <ArrowLeft size={16} strokeWidth={1.75} /> <span>Catalog</span>
            </Link>
            <h1 className={styles.title}>Sales analysis</h1>
          </div>
          <div className={styles.controls}>
            <select value={period} onChange={(e) => setPeriod(e.target.value)}>
              <option value="all">All time</option>
              {monthOptions.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <label className={styles.toggle}>
              <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
              Include test orders
            </label>
          </div>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'overview' ? styles.tabActive : ''}`}
            onClick={() => setTab('overview')}
          >Overview</button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'customers' ? styles.tabActive : ''}`}
            onClick={() => setTab('customers')}
          >Customer Data</button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'products' ? styles.tabActive : ''}`}
            onClick={() => setTab('products')}
          >Products</button>
        </div>

        {isLoading && <p className={styles.muted}>Loading…</p>}
        {error && <p className={styles.note}>Could not load analytics: {(error as Error).message}</p>}

        {tab === 'overview' && ov && (
          <>
            {thin && (
              <p className={styles.note}>
                Only {ov.n} order{ov.n === 1 ? '' : 's'} in this view — figures are directional, not a stable trend.
              </p>
            )}

            <div className={styles.cards}>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Orders</span>
                <span className={styles.cardValue}>{fmtQty(ov.orderCount.bySo)}</span>
                <span className={styles.cardSub}>{fmtQty(ov.orderCount.byPurchase)} physical purchases (cross-category merged)</span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>AOV (per order)</span>
                <span className={styles.cardValue}>{fmtCenti(ov.aovCenti.perSo.full)}</span>
                <span className={styles.cardSub}>
                  {fmtCenti(ov.aovCenti.perSo.product)} goods only · {fmtCenti(ov.aovCenti.perPurchase.full)}/purchase
                </span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Avg delivery fee</span>
                <span className={styles.cardValue}>{fmtCenti(ov.deliveryCenti.avgAll)}</span>
                <span className={styles.cardSub}>
                  {fmtCenti(ov.deliveryCenti.avgCharged)} when charged ({fmtQty(ov.deliveryCenti.chargedCount)} orders)
                </span>
              </div>
              <div className={styles.card}>
                <span className={styles.cardLabel}>Gross margin</span>
                <span className={styles.cardValue}>{pct(ov.grossMarginPct)}</span>
                <span className={styles.cardSub}>n = {fmtQty(ov.n)} orders</span>
              </div>
            </div>

            <div className={styles.section}>
              <h2 className={styles.sectionTitle}>Monthly trend (revenue)</h2>
              {(data?.monthly ?? []).length === 0 && <p className={styles.muted}>No orders yet.</p>}
              {(data?.monthly ?? []).map((m) => (
                <div key={m.month} className={styles.trendRow}>
                  <span className={styles.cardSub}>{m.month}</span>
                  <span className={styles.barTrack}>
                    <span
                      className={styles.bar}
                      style={{ width: `${Math.round((m.revenueCenti / maxRevenue) * 100)}%` }}
                    />
                  </span>
                  <span className={styles.cardSub}>{fmtCenti(m.revenueCenti)} · {fmtQty(m.orders)} ord</span>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'customers' && data && <CustomerDataTab customers={data.customers} targets={data.targets} />}

        {tab === 'products' && data && <ProductsTab products={data.products} />}
      </div>
    </>
  );
};
