// ----------------------------------------------------------------------------
// so-readiness — SO header status + "stock remark" derivation, Commander
// 2026-05-30. B2C semantics: an SO ships once every MAIN product (SOFA /
// BEDFRAME / MATTRESS) is in stock — accessories pending DO NOT block ship.
//
// Used by:
//   - recomputeSoStockAllocation (auto-advance / regress header on stock change)
//   - PATCH /:docNo/items/:itemId/stock-status (manual READY toggle)
//   - GET /mfg-sales-orders (list aggregate — emits stock_remark per row)
//
// Remark output (mirrors operator's existing ERP "Remark 2" column):
//   ""               — empty SO or non-shipping status
//   "READY"          — every line (main + ACC) READY
//   "READY (PARTIAL)" — every MAIN line READY, some ACC line PENDING
//   "BEDFRAME"       — at least one BEDFRAME line PENDING
//   "MATTRESS/ACC"   — MATTRESS line(s) PENDING + accessory pending too
//   …joined-by-slash list of missing categories when main is not yet ready.
// ----------------------------------------------------------------------------

export const MAIN_CATEGORIES = new Set(['SOFA', 'BEDFRAME', 'MATTRESS']);

/** Normalise a free-text item_group to one of the known buckets. */
export function normCategory(raw: string | null | undefined): string {
  const g = (raw ?? '').trim().toUpperCase();
  if (g.includes('BEDFRAME')) return 'BEDFRAME';
  if (g.includes('SOFA'))     return 'SOFA';
  if (g.includes('MATTRESS')) return 'MATTRESS';
  if (g.includes('ACCESSOR')) return 'ACCESSORY';
  if (g.includes('SERVICE'))  return 'SERVICE';
  return 'OTHERS';
}

export type ReadinessLine = {
  item_group: string | null;
  stock_status: 'PENDING' | 'READY' | string;
  cancelled?: boolean | null;
};

export type ReadinessSummary = {
  mainCount:    number;
  mainReady:    number;
  accCount:     number;
  accReady:     number;
  /** True when every MAIN line is READY (regardless of accessories). */
  isMainReady:  boolean;
  /** True when EVERY non-cancelled line — incl. accessories — is READY. */
  isFullyReady: boolean;
  /** UI label per the contract above (empty string when SO has no lines). */
  stockRemark:  string;
  /** Category labels still PENDING, dedup'd + sorted. ACC collapses to one
   *  "ACC" entry to match operator-existing convention. */
  pendingCategories: string[];
};

/**
 * Roll up per-line stock_status into the SO-header readiness story.
 * Cancelled lines are filtered. Empty input → no-flag default.
 */
export function summariseReadiness(lines: ReadinessLine[]): ReadinessSummary {
  const live = lines.filter((l) => !l.cancelled);
  let mainCount = 0, mainReady = 0, accCount = 0, accReady = 0;
  const pendingMainCats = new Set<string>();
  let anyAccPending = false;

  for (const l of live) {
    const cat = normCategory(l.item_group);
    const isMain = MAIN_CATEGORIES.has(cat);
    const isReady = l.stock_status === 'READY';
    if (isMain) {
      mainCount += 1;
      if (isReady) mainReady += 1;
      else pendingMainCats.add(cat);
    } else {
      accCount += 1;
      if (isReady) accReady += 1;
      else anyAccPending = true;
    }
  }

  const isMainReady  = mainCount > 0 ? mainReady === mainCount : true;  // no-main SO = main-ready by convention
  const isFullyReady = (mainCount + accCount) > 0 && mainReady === mainCount && accReady === accCount;

  // Build the remark label.
  let stockRemark = '';
  if (mainCount + accCount === 0) {
    stockRemark = '';
  } else if (isFullyReady) {
    stockRemark = 'READY';
  } else if (isMainReady) {
    stockRemark = 'READY (PARTIAL)';
  } else {
    // Some MAIN still pending — list which categories. Append "ACC" too when
    // any accessory line is pending (matches the operator's "MATTRESS/ACC"
    // convention from the existing ERP).
    const parts = [...pendingMainCats].sort();
    if (anyAccPending) parts.push('ACC');
    stockRemark = parts.join('/');
  }

  // pendingCategories — collapse ACC entries into one.
  const pc = [...pendingMainCats].sort();
  if (anyAccPending) pc.push('ACC');

  return { mainCount, mainReady, accCount, accReady, isMainReady, isFullyReady, stockRemark, pendingCategories: pc };
}
