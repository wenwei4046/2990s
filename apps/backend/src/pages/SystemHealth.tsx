// ----------------------------------------------------------------------------
// System Health — admin observability dashboard (Commander 2026-05-29).
//
// Ported from the HOOKKA ERP /admin/health page and re-skinned to 2990s
// tokens. Like HOOKKA's, the latency/throughput numbers are deterministic
// DEMO data (seeded by the UTC hour) until live request telemetry
// (Cloudflare Analytics Engine SQL) is wired — the banner says so plainly.
// Structure: a status banner, 5 KPI cards, an hourly request-volume
// sparkline, and a P50/P95 latency trend.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Activity, AlertTriangle, Clock, Gauge, TrendingUp, RefreshCw, Trash2, ShieldCheck } from 'lucide-react';
import { useAuth } from '../lib/auth';
import { useResetTestData, useResetTestDataKeepSo, useLedgerHealth } from '../lib/admin-queries';
import styles from './SystemHealth.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

type Kpis = {
  p50: number; p75: number; p95: number;
  longTaskCount: number; serverErrors: number; cacheHitRatio: number;
  volume: number[]; p50Trend: number[]; p95Trend: number[];
};

/* Deterministic mock seeded by the UTC hour — two loads within the same hour
   return identical numbers (no flicker) until live telemetry lands. */
function mockKpis(seedOffset = 0): Kpis {
  const seed = Math.floor(Date.now() / 3_600_000) + seedOffset;
  let s = (seed * 9301 + 49297) % 233280;
  const rand = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const p50 = Math.round(40 + rand() * 30);
  const p75 = Math.round(p50 + 30 + rand() * 60);
  const p95 = Math.round(p75 + 80 + rand() * 200);
  const longTaskCount = Math.round(50 + rand() * 200);
  const serverErrors = Math.round(rand() * 6);
  const cacheHitRatio = Math.round((0.55 + rand() * 0.4) * 100) / 100;
  const volume: number[] = [];
  const p50Trend: number[] = [];
  const p95Trend: number[] = [];
  for (let i = 0; i < 24; i++) {
    volume.push(Math.round(40 + rand() * 200));
    const a = Math.round(40 + rand() * 40);
    p50Trend.push(a);
    p95Trend.push(a + Math.round(80 + rand() * 220));
  }
  return { p50, p75, p95, longTaskCount, serverErrors, cacheHitRatio, volume, p50Trend, p95Trend };
}

/* Inline SVG line — 24 points, no chart lib needed. */
function Spark({ series, stroke }: { series: number[]; stroke: string }) {
  const points = useMemo(() => {
    if (!series.length) return '';
    const w = 600, h = 90, max = Math.max(...series, 1);
    const stepX = w / Math.max(1, series.length - 1);
    return series.map((v, i) => `${(i * stepX).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`).join(' ');
  }, [series]);
  return (
    <svg viewBox="0 0 600 90" preserveAspectRatio="none" className={styles.spark} aria-hidden>
      <polyline fill="none" stroke={stroke} strokeWidth={2.5} points={points} />
    </svg>
  );
}

const KpiCard = ({ label, value, unit, icon: Icon, warn }: {
  label: string; value: number | string; unit?: string; icon: typeof Activity; warn?: boolean;
}) => (
  <div className={`${styles.kpi} ${warn ? styles.kpiWarn : ''}`}>
    <div className={styles.kpiHead}>
      <span className={styles.kpiLabel}>{label}</span>
      <Icon {...ICON} className={styles.kpiIcon} />
    </div>
    <div className={`${styles.kpiValue} ${warn ? styles.kpiValueWarn : ''}`}>
      {value}{unit && <span className={styles.kpiUnit}>{unit}</span>}
    </div>
  </div>
);

/* TEMPORARY testing helper (Commander 2026-05-31) — one-key wipe of all
   transactional documents so the team can re-test from a clean slate. Only
   rendered for super_admin; the API double-checks the same gate. Requires
   typing CLEAR to arm the button. Remove this block before the pilot. */
const ResetTestDataCard = () => {
  const reset = useResetTestData();
  const [confirmText, setConfirmText] = useState('');
  const [done, setDone] = useState(false);
  const armed = confirmText.trim().toUpperCase() === 'CLEAR';

  return (
    <div className={styles.chartCard} style={{ borderColor: 'var(--c-orange)' }}>
      <h2 className={styles.chartTitle} style={{ color: 'var(--c-orange)' }}>
        <Trash2 {...ICON} /> Clear test data — danger zone (temporary)
      </h2>
      <p style={{ fontSize: 'var(--fs-13)', color: 'var(--c-fg-muted)', margin: '0 0 var(--space-3)' }}>
        Wipes <strong>all</strong> transactional documents — purchasing (PO / GRN / invoices /
        returns), sales (SO / DO / invoices / returns), inventory (movements / lots / transfers /
        stock takes), their journal entries, and refund credits. Master &amp; config data
        (suppliers, warehouses, products, pricing, staff, customers, chart of accounts) is kept.
        Document numbers reset; SO restarts at 2990, PO at this year&apos;s 0001.
        <strong> This is irreversible.</strong>
      </p>
      {done ? (
        <div style={{ fontSize: 'var(--fs-14)', color: 'var(--c-fg)', fontWeight: 600 }}>
          ✓ Test data cleared. Reload any open list to see the empty state.
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input
            value={confirmText}
            placeholder='Type CLEAR to confirm'
            onChange={(e) => setConfirmText(e.target.value)}
            style={{
              padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--line)', fontSize: 'var(--fs-13)', minWidth: 220,
            }}
          />
          <button
            type="button"
            disabled={!armed || reset.isPending}
            onClick={() => reset.mutate(undefined, { onSuccess: () => setDone(true) })}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-md)',
              border: 'none', fontSize: 'var(--fs-13)', fontWeight: 700,
              cursor: armed && !reset.isPending ? 'pointer' : 'not-allowed',
              background: armed ? 'var(--c-orange)' : 'var(--c-fg-faint, #ccc)',
              color: '#fff', opacity: reset.isPending ? 0.7 : 1,
            }}
          >
            <Trash2 {...ICON} />
            {reset.isPending ? 'Clearing…' : 'Clear all test data'}
          </button>
          {reset.isError && (
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--c-orange)' }}>
              Failed: {(reset.error as Error).message}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/* TEMPORARY testing helper (Commander 2026-06-01) — wipe everything EXCEPT
   Sales Orders, then reset the kept SOs to a fresh re-testable state so the
   team can re-drive the same batch of SOs through the full flow again. Only
   rendered for super_admin; the API double-checks the same gate. Requires
   typing CONFIRM to arm. Remove this block before the pilot. */
const ResetKeepSoCard = () => {
  const reset = useResetTestDataKeepSo();
  const [confirmText, setConfirmText] = useState('');
  const [done, setDone] = useState(false);
  const armed = confirmText.trim().toUpperCase() === 'CONFIRM';

  return (
    <div className={styles.chartCard} style={{ borderColor: 'var(--c-orange)' }}>
      <h2 className={styles.chartTitle} style={{ color: 'var(--c-orange)' }}>
        <Trash2 {...ICON} /> Clear test data — keep Sales Orders (temporary)
      </h2>
      <p style={{ fontSize: 'var(--fs-13)', color: 'var(--c-fg-muted)', margin: '0 0 var(--space-3)' }}>
        Keeps <strong>every Sales Order</strong> (header, lines, payments, history) and wipes
        everything downstream — purchasing (PO / GRN / invoices / returns), deliveries
        (DO / DR), sales invoices, inventory (movements / lots / transfers / stock takes),
        journal entries, legacy POS docs, and refund credits. The kept SOs are reset to a
        fresh state (all lines back to <strong>Pending</strong>, shipped / delivered / invoiced
        orders rolled back to <strong>Confirmed</strong>) so you can re-drive the same orders
        through the whole flow again. SO numbers are unchanged; PO counter resets to 0001.
        <strong> This is irreversible.</strong>
      </p>
      {done ? (
        <div style={{ fontSize: 'var(--fs-14)', color: 'var(--c-fg)', fontWeight: 600 }}>
          ✓ Cleared — Sales Orders kept &amp; reset to Pending. Reload any open list to see the new state.
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
          <input
            value={confirmText}
            placeholder='Type CONFIRM to confirm'
            onChange={(e) => setConfirmText(e.target.value)}
            style={{
              padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-md)',
              border: '1px solid var(--line)', fontSize: 'var(--fs-13)', minWidth: 220,
            }}
          />
          <button
            type="button"
            disabled={!armed || reset.isPending}
            onClick={() => reset.mutate(undefined, { onSuccess: () => setDone(true) })}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: 'var(--space-2) var(--space-4)', borderRadius: 'var(--radius-md)',
              border: 'none', fontSize: 'var(--fs-13)', fontWeight: 700,
              cursor: armed && !reset.isPending ? 'pointer' : 'not-allowed',
              background: armed ? 'var(--c-orange)' : 'var(--c-fg-faint, #ccc)',
              color: '#fff', opacity: reset.isPending ? 0.7 : 1,
            }}
          >
            <Trash2 {...ICON} />
            {reset.isPending ? 'Clearing…' : 'Clear all but Sales Orders'}
          </button>
          {reset.isError && (
            <span style={{ fontSize: 'var(--fs-12)', color: 'var(--c-orange)' }}>
              Failed: {(reset.error as Error).message}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/* Inventory ledger integrity — REAL data. Calls GET /health/ledger, which runs
   the read-only ledger reconcile sweep over all 9 stock-moving doc types and
   flags any posted/shipped document that silently wrote ZERO inventory
   movements (a best-effort-write failure). Green when clean; orange WARN with
   the count + the first issues when something drifted. */
const LedgerIntegrityPanel = () => {
  const { data, isLoading, isError, error, refetch, isFetching } = useLedgerHealth();

  const status = isError ? 'unknown' : (data?.status ?? 'unknown');
  const statusClass =
    status === 'ok' ? '' : status === 'warn' ? styles.warn : styles.unknown;
  const headline =
    isLoading ? 'Checking…'
    : isError ? 'Check failed'
    : status === 'ok' ? 'Healthy — every posted document moved stock'
    : status === 'warn' ? `${data?.issueCount ?? 0} document${(data?.issueCount ?? 0) === 1 ? '' : 's'} moved stock on paper but wrote no inventory movement`
    : 'Unknown';
  const sub =
    isError ? (error as Error).message
    : data?.error ? data.error
    : data?.asOf ? `As of ${new Date(data.asOf).toLocaleString()}`
    : '';

  return (
    <div className={styles.chartCard}>
      <h2 className={styles.chartTitle}>
        <ShieldCheck {...ICON} /> Inventory ledger integrity
        <button
          type="button"
          className={styles.ghostBtn}
          style={{ marginLeft: 'auto' }}
          onClick={() => void refetch()}
          disabled={isFetching}
        >
          <RefreshCw {...ICON} /> {isFetching ? 'Checking…' : 'Re-check'}
        </button>
      </h2>

      <div className={`${styles.ledgerStatus} ${statusClass}`}>
        <span className={styles.ledgerDot} />
        <div>
          <strong>{headline}</strong>
          {sub && <div className={styles.ledgerSub}>{sub}</div>}
        </div>
      </div>

      {data && data.issues.length > 0 && (
        <table className={styles.ledgerTable}>
          <thead>
            <tr>
              <th>Document</th>
              <th>Number</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {data.issues.map((iss) => (
              <tr key={`${iss.docType}-${iss.id}`}>
                <td>{iss.docType}</td>
                <td>{iss.docNo}</td>
                <td>{iss.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {data && data.status === 'warn' && data.issueCount > data.issues.length && (
        <div className={styles.ledgerSub} style={{ marginTop: 'var(--space-2)' }}>
          Showing first {data.issues.length} of {data.issueCount}. Drill into
          GET /inventory/reconcile for the full list.
        </div>
      )}
    </div>
  );
};

export const SystemHealth = () => {
  const { staff } = useAuth();
  const [k, setK] = useState<Kpis>(() => mockKpis());
  const critical = k.p95 >= 2000 || k.serverErrors > 0 || k.longTaskCount > 5000;

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>System Health</h1>
        </div>
        <button type="button" className={styles.ghostBtn} onClick={() => setK(mockKpis(Math.floor(Math.random() * 10000)))}>
          <RefreshCw {...ICON} /> Refresh
        </button>
      </div>

      {/* Honest banner — these are demo numbers until telemetry is wired. */}
      <div className={styles.demoBanner}>
        <strong>Demo telemetry.</strong> Live request metrics (Cloudflare Analytics
        Engine) aren&apos;t wired yet, so the figures below are deterministic
        placeholders — the dashboard layout is real and ready for the live feed.
      </div>

      <div className={critical ? styles.statusCrit : styles.statusOk}>
        <span className={styles.statusDot} />
        <div>
          <strong>{critical ? 'Critical — investigate' : 'Healthy'}</strong>
          <div className={styles.statusSub}>
            P95 {k.p95}ms · {k.longTaskCount} long tasks · {k.serverErrors} server errors
          </div>
        </div>
      </div>

      <div className={styles.kpiGrid}>
        <KpiCard label="P50 latency" value={k.p50} unit="ms" icon={Clock} />
        <KpiCard label="P75 latency" value={k.p75} unit="ms" icon={Clock} />
        <KpiCard label="P95 latency" value={k.p95} unit="ms" icon={Gauge} warn={k.p95 >= 1000} />
        <KpiCard label="Long tasks (≥200ms)" value={k.longTaskCount} icon={AlertTriangle} warn={k.longTaskCount > 1000} />
        <KpiCard label="Cache hit ratio" value={`${Math.round(k.cacheHitRatio * 100)}%`} icon={TrendingUp} />
      </div>

      <div className={styles.chartCard}>
        <h2 className={styles.chartTitle}><Activity {...ICON} /> Hourly request volume (last 24h)</h2>
        <Spark series={k.volume} stroke="var(--c-orange)" />
        <div className={styles.axis}><span>24h ago</span><span>now</span></div>
      </div>

      <div className={styles.chartCard}>
        <h2 className={styles.chartTitle}><Gauge {...ICON} /> Latency trend (last 24h) — P50 + P95 per hour</h2>
        <div className={styles.trendWrap}>
          <Spark series={k.p95Trend} stroke="var(--c-orange)" />
          <Spark series={k.p50Trend} stroke="#2f5fb3" />
        </div>
        <div className={styles.axis}>
          <span><span className={styles.legendP95} /> P95 &nbsp; <span className={styles.legendP50} /> P50</span>
          <span>now</span>
        </div>
      </div>

      <LedgerIntegrityPanel />

      {staff?.role === 'super_admin' && <ResetKeepSoCard />}
      {staff?.role === 'super_admin' && <ResetTestDataCard />}
    </div>
  );
};
