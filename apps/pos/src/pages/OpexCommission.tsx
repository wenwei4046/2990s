// ----------------------------------------------------------------------------
// OPEX ▸ Commission — the POS home of the sales commission scheme.
//
// Two tabs, which are the two halves Loo asked for (2026-08-31): SET the targets,
// KPI items and thresholds; CALCULATE what that pays over a period, straight
// from the Sales Orders the POS wrote.
//
// ── WHERE THE NUMBERS COME FROM ─────────────────────────────────────────────
// Houzs `/api/scm/hr/*`, reached through the ordinary POS `authedFetch`. Since
// the 2026-07-21 cutover every POS order is written into Houzs company 2 and
// nothing syncs back, so that is where both the orders and the commission tables
// live, and the engine that computes a payout runs there. This page never
// re-derives a figure: it sets inputs and renders answers.
//
// ── WHO CAN OPEN IT ─────────────────────────────────────────────────────────
// The Houzs permission keys `scm.hr.read` (view) and `scm.hr.manage` (edit) —
// Loo: "跟 Houzs 权限键一致". NOT the POS role gate the other Maintain pages use:
// this screen shows every colleague's pay, and who may see that is a decision
// held in Houzs's Team > Positions, not mirrored here. `canManage` is threaded
// down so a read-only holder gets the figures with every control absent, rather
// than a button that 403s.
// ----------------------------------------------------------------------------

import { useState } from 'react';
import { Link } from 'react-router';
import { ArrowLeft } from 'lucide-react';
import { Topbar } from '../components/Topbar';
import { CommissionTab } from '../components/opex/CommissionTab';
import { SetupRates } from '../components/opex/SetupRates';
import { SetupKpiItems } from '../components/opex/SetupKpiItems';
import { SetupSalespeople } from '../components/opex/SetupSalespeople';
import { useHrAccess } from '../lib/houzs-perms';
import styles from '../components/opex/Opex.module.css';

export const OpexCommission = () => {
  const [tab, setTab] = useState<'commission' | 'setup'>('commission');
  const { canManage } = useHrAccess();

  return (
    <>
      <Topbar />
      <div className={styles.page}>
        <div className={styles.headerRow}>
          <div className={styles.titleBlock}>
            <Link to="/catalog" className={styles.backBtn}>
              <ArrowLeft size={16} strokeWidth={1.75} /> <span>Catalog</span>
            </Link>
            <div>
              <h1 className={styles.title}>Commission</h1>
              <p className={styles.subtitle}>
                Sales commission — targets, KPI items and what each period pays
                {canManage ? '' : ' · view only'}
              </p>
            </div>
          </div>
        </div>

        <div className={styles.tabs}>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'commission' ? styles.tabActive : ''}`}
            onClick={() => setTab('commission')}
          >Commission</button>
          <button
            type="button"
            className={`${styles.tab} ${tab === 'setup' ? styles.tabActive : ''}`}
            onClick={() => setTab('setup')}
          >Setup</button>
        </div>

        {tab === 'commission' && <CommissionTab canManage={canManage} />}
        {tab === 'setup' && (
          <div className={styles.stack}>
            <SetupRates canManage={canManage} />
            <SetupKpiItems canManage={canManage} />
            <SetupSalespeople canManage={canManage} />
          </div>
        )}
      </div>
    </>
  );
};
