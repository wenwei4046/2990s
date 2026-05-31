// ----------------------------------------------------------------------------
// sofa-batch-match — atomic batch → Sales-Order matching for colour-matched
// sofa sets (Stage 3, Commander 2026-05-31).
//
// Sofa is produced as a SET on ONE PO = ONE dye lot = ONE batch. To ship a set
// without colour difference the WHOLE set must leave from ONE batch. This pure
// function decides which batch covers which SO under the LOCKED rules:
//
//   • EXACT match — a batch matches an SO's sofa set ONLY when the batch's
//     surviving component multiset EQUALS the SO's sofa-need multiset (same
//     SKUs+variants, same quantities). No partial, no leftover.
//   • Atomic + one-to-one — a batch is assigned WHOLLY to one SO; an SO's set is
//     either fully covered by one batch or not at all.
//   • Pure made-to-stock — a batch may serve ANY variant-matching SO, NOT only
//     its origin SO. Earlier-delivery SOs claim first (FIFO by delivery date);
//     oldest batches are spent first (FIFO by received_at).
//   • Strictly per-warehouse — stock never crosses warehouses, so needs and
//     batches are matched within one warehouse only.
//
// Deterministic: same inputs → same assignment (stable sort + greedy walk), so
// the allocator can re-run it idempotently on every inventory change.
// ----------------------------------------------------------------------------

/** A component line within a set or batch: a SKU+variant and how many. */
export type ComponentTally = Map<string, number>; // key = `${itemCode}|${variantKey}`

/** One SO's sofa set demand within a single warehouse. */
export type SofaSetNeed = {
  /** Stable identity — used for assignment output + FIFO tie-break. */
  soDocNo: string;
  warehouseId: string;
  /** Earliest customer delivery date across the set's lines (NULL → far future). */
  deliveryDate: string | null;
  /** The multiset of components this set still needs (deliverable_remaining). */
  components: ComponentTally;
};

/** One inbound batch's surviving components within a single warehouse. */
export type BatchSupply = {
  batchNo: string;
  warehouseId: string;
  /** Earliest received_at across the batch's lots (NULL → far future). */
  receivedAt: string | null;
  /** The multiset of components still on hand in this batch (qty_remaining). */
  components: ComponentTally;
};

export type SofaBatchAssignment = {
  soDocNo: string;
  warehouseId: string;
  batchNo: string;
};

const FAR_FUTURE = '9999-12-31';

/** True iff two component multisets are identical (same keys, same quantities). */
function talliesEqual(a: ComponentTally, b: ComponentTally): boolean {
  if (a.size !== b.size) return false;
  for (const [k, v] of a) {
    if (b.get(k) !== v) return false;
  }
  return true;
}

/**
 * Greedily assign batches to sofa-set needs, EXACT-match + atomic + FIFO.
 * Returns one assignment per matched (warehouse, SO). Unmatched needs simply
 * don't appear in the result.
 */
export function matchSofaBatches(
  needs: SofaSetNeed[],
  batches: BatchSupply[],
): SofaBatchAssignment[] {
  // Group by warehouse — matching is strictly within one warehouse.
  const needsByWh = new Map<string, SofaSetNeed[]>();
  for (const n of needs) {
    if (n.components.size === 0) continue;
    const arr = needsByWh.get(n.warehouseId) ?? [];
    arr.push(n);
    needsByWh.set(n.warehouseId, arr);
  }
  const batchesByWh = new Map<string, BatchSupply[]>();
  for (const b of batches) {
    if (b.components.size === 0) continue;
    const arr = batchesByWh.get(b.warehouseId) ?? [];
    arr.push(b);
    batchesByWh.set(b.warehouseId, arr);
  }

  const out: SofaBatchAssignment[] = [];
  for (const [whId, whNeeds] of needsByWh) {
    const whBatches = (batchesByWh.get(whId) ?? []).slice();
    if (whBatches.length === 0) continue;

    // Earlier-delivery SO claims first; tie-break by SO doc number.
    whNeeds.sort((a, b) => {
      const ad = a.deliveryDate ?? FAR_FUTURE;
      const bd = b.deliveryDate ?? FAR_FUTURE;
      if (ad !== bd) return ad.localeCompare(bd);
      return a.soDocNo.localeCompare(b.soDocNo);
    });
    // Oldest batch spent first (FIFO); tie-break by batch number.
    whBatches.sort((a, b) => {
      const ar = a.receivedAt ?? FAR_FUTURE;
      const br = b.receivedAt ?? FAR_FUTURE;
      if (ar !== br) return ar.localeCompare(br);
      return a.batchNo.localeCompare(b.batchNo);
    });

    const usedBatch = new Set<number>(); // indices into whBatches
    for (const need of whNeeds) {
      for (let i = 0; i < whBatches.length; i++) {
        if (usedBatch.has(i)) continue;
        const batch = whBatches[i]!;
        if (talliesEqual(need.components, batch.components)) {
          usedBatch.add(i);
          out.push({ soDocNo: need.soDocNo, warehouseId: whId, batchNo: batch.batchNo });
          break;
        }
      }
    }
  }
  return out;
}
