// ----------------------------------------------------------------------------
// VoucherPicker — apply a Campaign Promo (fixed-value voucher) at handover.
//
// Sits in the Confirm-payment step because the deposit presets (50% / 70% /
// full) must be computed AFTER the deduction, or the salesperson collects a
// deposit on a total the customer isn't paying.
//
// Every rule lives in planVoucher(); this component only renders its verdict.
// Applied-chip vs entry-state pattern is lifted from the PWP rail in
// Configurator.tsx so the two read the same way.
// ----------------------------------------------------------------------------
import { useMemo } from 'react';
import { Ticket } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useCampaignPromos, type CampaignPromo } from '../../lib/products/campaign-promo-queries';
import { planVoucher, type VoucherCartLine } from '../../lib/voucher-apply';
import styles from '../../pages/Handover.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

export interface AppliedVoucher {
  campaign: CampaignPromo;
  /** Sen per cart line key — goes straight into the SO payload. */
  discountByLineKey: Record<string, number>;
  appliedCenti: number;
}

export const VoucherPicker = ({
  lines,
  applied,
  onChange,
}: {
  lines: VoucherCartLine[];
  applied: AppliedVoucher | null;
  onChange: (v: AppliedVoucher | null) => void;
}) => {
  const { data: campaigns = [], isLoading } = useCampaignPromos(true);

  /* Pre-compute every campaign's verdict so the list can show WHY a voucher is
     unavailable instead of hiding it — "needs 2 items" is actionable, a missing
     row is not. */
  const options = useMemo(
    () => campaigns.map((c) => ({
      campaign: c,
      plan: planVoucher(
        {
          id: c.id, name: c.name, valueCenti: c.valueCenti,
          remaining: c.remaining, minPurchaseQty: c.minPurchaseQty, active: c.active,
        },
        lines,
      ),
    })),
    [campaigns, lines],
  );

  // Nothing configured, or none active — stay out of the way entirely.
  if (!isLoading && campaigns.length === 0) return null;

  if (applied) {
    return (
      <div className={styles.voucherBox}>
        <div>
          <span className={styles.voucherName}>
            <Ticket {...ICON} /> {applied.campaign.name}
          </span>
          <span className={styles.voucherNote}>
            Applied · −RM {(applied.appliedCenti / 100).toFixed(2)} across{' '}
            {Object.keys(applied.discountByLineKey).length} item(s)
          </span>
        </div>
        <Button variant="ghost" onClick={() => onChange(null)}>Remove</Button>
      </div>
    );
  }

  return (
    <div className={styles.voucherBox}>
      <div style={{ width: '100%' }}>
        <span className={styles.voucherName}><Ticket {...ICON} /> Home voucher</span>
        {isLoading && <span className={styles.voucherNote}>Loading…</span>}
        {options.map(({ campaign, plan }) => (
          <div key={campaign.id} className={styles.voucherRow}>
            <div>
              <div style={{ fontSize: 'var(--fs-13)' }}>
                {campaign.name}
                <span className={styles.voucherNote} style={{ display: 'inline', marginLeft: 8 }}>
                  {campaign.remaining} left
                </span>
              </div>
              {!plan.ok && <div className={styles.voucherWhy}>{plan.message}</div>}
            </div>
            <Button
              variant="secondary"
              disabled={!plan.ok}
              onClick={() => {
                if (!plan.ok) return;
                onChange({
                  campaign,
                  discountByLineKey: plan.discountByLineKey,
                  appliedCenti: plan.appliedCenti,
                });
              }}
            >
              Apply
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
};
