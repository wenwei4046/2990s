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
import { Activity, AlertTriangle, Clock, Gauge, TrendingUp, RefreshCw } from 'lucide-react';
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

export const SystemHealth = () => {
  const [k, setK] = useState<Kpis>(() => mockKpis());
  const critical = k.p95 >= 2000 || k.serverErrors > 0 || k.longTaskCount > 5000;

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>System Health</h1>
          <p className={styles.subtitle}>Last 24h · Cloudflare edge + Supabase Postgres</p>
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
    </div>
  );
};
