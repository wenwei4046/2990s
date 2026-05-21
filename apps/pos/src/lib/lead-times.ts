import { useMemo } from 'react';
import { useCart } from '../state/cart';
import { useCatalog, useDeliveryFeeConfig } from './queries';

// Rules locked 2026-05-22 with Loo:
//   * Sofa in cart → sofaLeadDays minimum from order date.
//   * Mattress or bed frame in cart → mattressBedframeLeadDays minimum.
//   * Mixed cart → the larger of the two wins.
// Editable in Backend Settings → Delivery.
//
// `days` is the minimum number of calendar days between today and the earliest
// allowed delivery date. `reasonLabel` is a human-readable tag of which rule
// is currently driving the floor (so the UI can show "Sofa adds 30 days").

export interface CartLeadDays {
  days:        number;
  reasonLabel: string;
  hasSofa:     boolean;
  hasMattressOrBedframe: boolean;
}

const SOFA_CATS  = new Set(['sofa']);
const MATBF_CATS = new Set(['mattress', 'bedframe']);

export function useCartLeadDays(): CartLeadDays {
  const cfg     = useDeliveryFeeConfig();
  const catalog = useCatalog();
  const lines   = useCart((s) => s.lines);

  return useMemo(() => {
    const sofaLead  = cfg.data?.sofaLeadDays ?? 30;
    const matBfLead = cfg.data?.mattressBedframeLeadDays ?? 20;

    if (!catalog.data || lines.length === 0) {
      return {
        days: sofaLead,
        reasonLabel: 'standard',
        hasSofa: false,
        hasMattressOrBedframe: false,
      };
    }

    const productMap = new Map(catalog.data.map((p) => [p.id, p]));

    let hasSofa = false;
    let hasMatBf = false;
    for (const line of lines) {
      const product = productMap.get(line.config.productId);
      const catId   = product?.category?.id;
      if (!catId) continue;
      if (SOFA_CATS.has(catId))  hasSofa  = true;
      if (MATBF_CATS.has(catId)) hasMatBf = true;
    }

    const sofaContribution  = hasSofa  ? sofaLead  : 0;
    const matBfContribution = hasMatBf ? matBfLead : 0;
    const days = Math.max(sofaContribution, matBfContribution, 0);

    let reasonLabel: string;
    if (hasSofa && hasMatBf) {
      reasonLabel = days === sofaLead ? 'sofa' : 'mattress / bed frame';
    } else if (hasSofa) {
      reasonLabel = 'sofa';
    } else if (hasMatBf) {
      reasonLabel = 'mattress / bed frame';
    } else {
      reasonLabel = 'standard';
    }

    return { days, reasonLabel, hasSofa, hasMattressOrBedframe: hasMatBf };
  }, [cfg.data, catalog.data, lines]);
}
