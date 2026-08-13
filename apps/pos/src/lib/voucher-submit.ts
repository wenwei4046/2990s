// ----------------------------------------------------------------------------
// The claim → submit → confirm/release bracket around an order submission.
//
// Isolated from Handover.tsx because the failure paths are where the money goes
// wrong, and they are impossible to exercise through the page. Three rules, all
// tested:
//
//   1. CLAIM FIRST, and abort if it fails. The claim is the atomic stock
//      decrement — if the campaign is sold out we must not submit an order
//      carrying a discount the voucher no longer covers.
//   2. A FAILED ORDER ALWAYS RELEASES. Otherwise a network blip silently burns
//      a voucher out of a stock of two.
//   3. A FAILED CONFIRM NEVER FAILS THE ORDER. By then the SO exists in Houzs.
//      Throwing here would show the salesperson an error for an order that was
//      actually created, and they would submit it again. The redemption is left
//      RESERVED instead — recoverable by sweeping, unlike a duplicate order.
//
// The asymmetry in 2 vs 3 is the whole point: before the order exists, failures
// must undo; after it exists, failures must not.
// ----------------------------------------------------------------------------
import {
  claimCampaignPromo,
  confirmCampaignPromo,
  releaseCampaignPromo,
} from './products/campaign-promo-queries';

export interface VoucherSubmitIntent {
  campaignId: string;
  /** Sen coming off, from planVoucher(). Clamped server-side to the campaign's
   *  own value, so this is a request rather than an instruction. */
  appliedCenti: number;
  redeemedBy?: string;
  redeemedByName?: string;
  customerName?: string;
  customerPhone?: string;
}

export interface VoucherSubmitDeps {
  claim: typeof claimCampaignPromo;
  confirm: typeof confirmCampaignPromo;
  release: typeof releaseCampaignPromo;
  /** Non-fatal problems worth knowing about but not worth failing an order for. */
  onWarn?: (message: string) => void;
}

const defaults: VoucherSubmitDeps = {
  claim: claimCampaignPromo,
  confirm: confirmCampaignPromo,
  release: releaseCampaignPromo,
};

/**
 * Run `submit` with a voucher claimed around it.
 *
 * With `intent` null this is just `submit()` — no extra calls, no behaviour
 * change, which is the path every order takes today.
 *
 * Rethrows whatever `submit` threw, unchanged, so the caller's existing
 * PosHandoffApiError handling still works.
 */
export const submitWithVoucher = async <T extends { docNo: string }>(
  intent: VoucherSubmitIntent | null,
  submit: () => Promise<T>,
  deps: Partial<VoucherSubmitDeps> = {},
): Promise<T> => {
  const { claim, confirm, release, onWarn } = { ...defaults, ...deps };

  if (!intent) return submit();

  // 1. Claim. A failure here means the voucher is gone — surface it and do NOT
  //    submit, because the payload already carries the discount.
  const claimed = await claim(intent.campaignId, {
    appliedCenti: intent.appliedCenti,
    ...(intent.redeemedBy ? { redeemedBy: intent.redeemedBy } : {}),
    ...(intent.redeemedByName ? { redeemedByName: intent.redeemedByName } : {}),
  });

  let result: T;
  try {
    result = await submit();
  } catch (err) {
    // 2. The order did not land. Give the voucher back. A release failure must
    //    not mask why the order failed — that is what the operator needs.
    try {
      await release(claimed.redemptionId, 'order submission failed');
    } catch {
      onWarn?.(
        `Voucher ${intent.campaignId} stayed reserved after a failed order — release it manually (redemption ${claimed.redemptionId}).`,
      );
    }
    throw err;
  }

  // 3. The order exists. From here nothing may throw.
  try {
    await confirm(claimed.redemptionId, {
      soDocNo: result.docNo,
      ...(intent.customerName ? { customerName: intent.customerName } : {}),
      ...(intent.customerPhone ? { customerPhone: intent.customerPhone } : {}),
    });
  } catch {
    onWarn?.(
      `Order ${result.docNo} was created, but its voucher redemption is still RESERVED (${claimed.redemptionId}). The stock is counted; only the order link is missing.`,
    );
  }

  return result;
};
