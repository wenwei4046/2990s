// Marketing — the POS Marketing section (owner 2026-10-08, design
// "Marketing 展厅陈列系统"). One page, three tabs, picked by ?tab=:
//   display — what is on the floor in every showroom
//   launch  — the Management → Marketing hand-off for new products
//   sales   — sales analysis (moved here from Maintain, redesigned)
// The shell follows the design's recipe: Topbar → ← Catalog + title +
// per-tab subtitle → per-tab controls on the right → tab bar.

import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowLeft, Plus } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { useStaff } from '../lib/staff';
import { useMarketingAccess } from '../lib/houzs-perms';
import { useMarketingState } from '../lib/marketing-api';
import { useSalesLines } from '../lib/sales-lines-queries';
import { blankRequest, type LaunchRequest } from '../components/marketing/marketing-model';
import { ShowroomDisplayTab } from '../components/marketing/ShowroomDisplayTab';
import { ProductLaunchTab } from '../components/marketing/ProductLaunchTab';
import { SalesAnalysisTab } from '../components/marketing/SalesAnalysisTab';
import { DateRangePicker } from '../components/marketing/DateRangePicker';
import { Toast, useToast } from '../components/marketing/Toast';
import s from '../components/marketing/marketing.module.css';

type TabId = 'display' | 'launch' | 'sales';
const TABS: Array<[TabId, string]> = [['display', 'Showroom display'], ['launch', 'Product launching'], ['sales', 'Sales analysis']];
const SUBTITLE: Record<TabId, string> = {
  display: 'What is on the floor at each showroom',
  launch: 'New products from Management to Marketing',
  sales: 'Product performance and customer profile',
};

const asTab = (v: string | null): TabId => (v === 'launch' || v === 'sales' ? v : 'display');

/** How a person is labelled on a request they file: the marketing account is
 *  "Marketing"; anyone else by their POS role, as the Topbar shows it. */
const roleLabel = (isMarketing: boolean, role: string | undefined): string => {
  if (isMarketing) return 'Marketing';
  const r = (role ?? 'staff').replace(/_/g, ' ');
  return r.charAt(0).toUpperCase() + r.slice(1);
};

export const Marketing = () => {
  const [params, setParams] = useSearchParams();
  const tab = asTab(params.get('tab'));
  const setTab = (t: TabId) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    next.set('tab', t);
    return next;
  }, { replace: true });

  const { data: staff } = useStaff();
  const { isMarketing } = useMarketingAccess();
  const me = useMemo(() => ({ name: staff?.name ?? 'Staff', role: roleLabel(isMarketing, staff?.role) }), [staff?.name, staff?.role, isMarketing]);

  const state = useMarketingState();
  const completed = (state.data?.requests ?? []).filter((r) => r.status === 'completed').length;

  const { toast, show } = useToast();
  const [draft, setDraft] = useState<LaunchRequest | null>(null);

  /* Sales analysis: the range lives here because its picker sits in the page
     header, beside the tab bar, as in the design. */
  const [includeTest, setIncludeTest] = useState(false);
  const lines = useSalesLines(includeTest, tab === 'sales');
  const dataset = lines.data ?? null;
  const [range, setRange] = useState<{ d0: number; d1: number } | null>(null);
  // A new dataset (first load, or real data replacing the sample) opens on All time.
  useEffect(() => {
    if (dataset) setRange({ d0: dataset.d0, d1: dataset.d1 });
  }, [dataset]);

  return (
    <>
      <Topbar />
      <div className={`${s.root} ${s.page}`}>
        <div className={s.headerRow}>
          <div className={s.titleBlock}>
            <Link to="/catalog" className={s.backLink}>
              <ArrowLeft size={16} strokeWidth={1.75} className={s.icon} /><span>Catalog</span>
            </Link>
            <div className={s.titleText}>
              <h1 className={s.title}>Marketing</h1>
              <p className={s.subtitle}>{SUBTITLE[tab]}</p>
            </div>
          </div>
          <div className={s.controls}>
            {tab === 'sales' && dataset && range && (
              <>
                <DateRangePicker dataset={dataset} value={range} onApply={setRange} />
                <label className={s.testToggle}>
                  <input type="checkbox" checked={includeTest} onChange={(e) => setIncludeTest(e.target.checked)} />
                  Include test orders
                </label>
              </>
            )}
            {tab === 'launch' && (
              <button type="button" className={s.primaryPill} onClick={() => setDraft(blankRequest(me.name, me.role))}>
                <Plus size={16} strokeWidth={1.75} className={s.icon} />New product
              </button>
            )}
          </div>
        </div>

        <div className={s.tabs} role="tablist" aria-label="Marketing sections">
          {TABS.map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              className={`${s.tab} ${tab === id ? s.tabActive : ''}`}
              onClick={() => setTab(id)}
            >
              {label}
              {id === 'launch' && completed > 0 && <span className={s.tabBadge}>{completed}</span>}
            </button>
          ))}
        </div>

        {tab !== 'sales' && state.isLoading && <p className={s.loading}>Loading…</p>}
        {tab !== 'sales' && state.error && (
          <p className={s.errorNote}>Could not load Marketing: {(state.error as Error).message}</p>
        )}

        {tab === 'display' && state.data && <ShowroomDisplayTab state={state.data} toast={show} />}
        {tab === 'launch' && state.data && (
          <ProductLaunchTab state={state.data} draft={draft} setDraft={setDraft} toast={show} />
        )}
        {tab === 'sales' && (
          <>
            {lines.isLoading && <p className={s.loading}>Loading…</p>}
            {lines.error && <p className={s.errorNote}>Could not load sales: {(lines.error as Error).message}</p>}
            {dataset && range && <SalesAnalysisTab dataset={dataset} range={range} />}
          </>
        )}
      </div>
      <Toast message={toast} />
    </>
  );
};
