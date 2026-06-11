import { useMemo } from 'react';
import { orderSofaCellsLeftToRight } from '@2990s/shared/sofa-build';
import { useMfgCatalog, type MfgCatalogRow } from './queries';
import type { CartConfig } from '../state/cart';

/* ─── Cart-line display title (Loo 2026-06-05) ────────────────────────────
 *
 * Cart lines snapshot `productName` from the SKU the configurator was opened
 * with — the catalog card's LEAD per-module SKU (e.g. "SOFA ANNSA 1A(LHF)"),
 * whichever module code sorts first. That string is wrong as a display title:
 * it isn't the Model name, and its compartment code has nothing to do with
 * the build actually configured (a 1B+2A+CNR build still says "1A(LHF)").
 *
 * `cartLineTitle` re-derives the title at RENDER time, mirroring how
 * `cartSummary` re-derives the build label — so lines already sitting in
 * saved carts/quotes display correctly without a data backfill:
 *   - sofa with cells → "<Model> · <codes left-to-right>", the same
 *     vocabulary as the SO line description (pos-handover-so.ts):
 *     "Annsa · 1A(LHF) + 1A(RHF)"
 *   - any other mfg-backed line → the clean Model name (the catalog card's
 *     title; sizes/options live on the summary line below)
 *   - no Model resolved (legacy UUID line, orphan SKU, catalog still
 *     loading) → the stored productName, exactly as before
 */
export const cartLineTitle = (
  config: CartConfig,
  mfgRow: MfgCatalogRow | undefined,
): string => {
  const modelName = mfgRow?.modelName;
  if (!modelName) return config.productName;
  if (config.kind === 'sofa' && config.cells && config.cells.length > 0) {
    // Left-to-right WALK (Loo 2026-06-12), not a raw (x, y) sort — an
    // L-build reads chaise first, then the corner, then across to the
    // right arm, matching the SO line description + print surfaces.
    const codes = orderSofaCellsLeftToRight(config.cells, config.depth ?? '24')
      .map((c) => c.moduleId)
      .filter(Boolean);
    if (codes.length > 0) return `${modelName} · ${codes.join(' + ')}`;
  }
  return modelName;
};

/** Index the mfg catalog by SKU id (`mfg-<hex>` — what cart lines store as
 *  `config.productId`) so render surfaces can resolve the Model name + photo
 *  per line. Same cached ['mfg-catalog'] query the Catalog page uses; while
 *  it loads (or for SKUs since hidden from the catalog) lookups miss and
 *  callers fall back to the stored snapshot. */
export const useMfgCatalogIndex = (): Map<string, MfgCatalogRow> => {
  const mfg = useMfgCatalog();
  return useMemo(
    () => new Map((mfg.data ?? []).map((r) => [r.id, r])),
    [mfg.data],
  );
};
