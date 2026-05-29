// ----------------------------------------------------------------------------
// MRP · Stock Status Report (Commander 2026-05-28, redesigned 2026-05-29).
//
// Trading-company finished-goods MRP. Per SKU: how many units the open Sales
// Orders need (Qty Needed) vs what we can supply (Stock + outstanding PO),
// with the leftover = Shortage. Tagged with how each SO line is covered:
//   • stock        → allocated from on-hand
//   • PO-xxxx + ETA → covered by an outstanding PO (expected arrival)
//   • SHORT (orange) → uncovered → this is what you order next
//
// Two tabs (Commander 2026-05-29 — "MRP 分两个地方"):
//   • General — everything except sofa. 3-level hierarchy:
//       Model (e.g. "CODY Bedframe 6\"") → Variant (each fabric/colour) → SO orders.
//       Single-variant models (mattress, accessory) collapse to 2 levels.
//   • Sofa    — sofa is ordered as a colour-matched SET, not per-SKU. Until the
//       HOOKKA combo/set definitions are loaded, this shows the per-variant view
//       as a stop-gap (see banner).
//
// Read-only, recomputed server-side on every load (no persistence — v1).
// Backed by GET /mrp (apps/api/src/routes/mrp.ts).
// ----------------------------------------------------------------------------

import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { ChevronRight, ChevronDown, RefreshCw, AlertTriangle, PackageCheck, Truck, ShoppingCart, CalendarRange, Info } from 'lucide-react';
import { useMrp, type MrpSku, type MrpLine, type MrpResponse, type SofaSet } from '../lib/mrp-queries';
import { useCreatePosFromSoItems } from '../lib/suppliers-queries';
import { fmtDateOrDash, fmtDateTime } from '@2990s/shared';
import styles from './Mrp.module.css';

const ICON = { size: 14, strokeWidth: 1.75 } as const;

const CAT_LABELS: Record<string, string> = {
  SOFA: 'Sofa', BEDFRAME: 'Bedframe', MATTRESS: 'Mattress',
  ACCESSORY: 'Accessory', SERVICE: 'Service',
};

// Canonical date format (Commander 2026-05-29) — shared @2990s/shared helper.
const fmtDate = (iso: string | null): string => fmtDateOrDash(iso);

type View = 'general' | 'sofa';

/* A "Model" groups every variant that shares the same SKU code (item_code).
   Bedframe/sofa: one model, many fabric/colour variants. Mattress/accessory:
   one model, one (empty) variant → renders 2-level. */
type ModelGroup = {
  itemCode: string;
  description: string | null;
  category: string | null;
  variants: MrpSku[];
  qtyNeeded: number;
  stock: number;
  poOutstanding: number;
  shortage: number;
  suppliers: MrpSku['suppliers'];
  multiVariant: boolean;
};

const rowKey = (s: MrpSku) => `${s.itemCode}${s.variantKey}`;

function groupByModel(skus: MrpSku[]): ModelGroup[] {
  const map = new Map<string, ModelGroup>();
  for (const s of skus) {
    let g = map.get(s.itemCode);
    if (!g) {
      g = {
        itemCode: s.itemCode, description: s.description, category: s.category,
        variants: [], qtyNeeded: 0, stock: 0, poOutstanding: 0, shortage: 0,
        suppliers: s.suppliers, multiVariant: false,
      };
      map.set(s.itemCode, g);
    }
    g.variants.push(s);
    g.qtyNeeded += s.qtyNeeded;
    g.stock += s.stock;
    g.poOutstanding += s.poOutstanding;
    g.shortage += s.shortage;
  }
  const groups = [...map.values()];
  for (const g of groups) {
    g.multiVariant = g.variants.length > 1 || g.variants.some((v) => v.variantKey !== '');
    g.variants.sort((a, b) => (a.variantLabel ?? '') < (b.variantLabel ?? '') ? -1 : 1);
  }
  // Shortage models float to the top (the orange ones to act on), then by code.
  groups.sort((a, b) => {
    if ((b.shortage > 0 ? 1 : 0) !== (a.shortage > 0 ? 1 : 0)) {
      return (b.shortage > 0 ? 1 : 0) - (a.shortage > 0 ? 1 : 0);
    }
    return a.itemCode < b.itemCode ? -1 : 1;
  });
  return groups;
}

export const Mrp = () => {
  const navigate = useNavigate();
  const [view, setView] = useState<View>('general');
  const [category, setCategory] = useState<string>('all');
  const [warehouseId, setWarehouseId] = useState<string>('all');
  /* Two expand levels: models (itemCode) and variants (rowKey). The sofa flat
     view reuses expandedVariants (each sofa row is variant-level). */
  const [expandedModels, setExpandedModels] = useState<Set<string>>(new Set());
  const [expandedVariants, setExpandedVariants] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [poMode, setPoMode] = useState<'combined' | 'per-so'>('combined');
  /* Commander 2026-05-29 — turnover control: order by delivery-date window.
     Single date window with a switchable basis (like the convert page): filter
     by Delivery / Processing / SO date. Delivery basis = the turnover window. */
  const [dateBasis, setDateBasis] = useState<'delivery' | 'processing' | 'soDate' | 'orderBy'>('delivery');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [showUndated, setShowUndated] = useState<boolean>(false);
  /* Commander 2026-05-29 — focus view: hide everything that's fully covered and
     show ONLY the rows that still need ordering (shortage > 0), so the operator
     can go straight to Proceed PO without wading past the Ready ones. */
  const [onlyShort, setOnlyShort] = useState<boolean>(false);
  /* Commander 2026-05-29 — switch a SKU to an alternate supplier in-place
     (AutoCount Post-to-PO). { itemCode: supplierId }; wins over main binding. */
  const [supplierOverride, setSupplierOverride] = useState<Record<string, string>>({});
  const setRowSupplier = (itemCode: string, supplierId: string) =>
    setSupplierOverride((prev) => ({ ...prev, [itemCode]: supplierId }));
  /* In-app result dialog (Commander 2026-05-29: confirm INSIDE the page, not a
     browser window.confirm/alert). null = closed.
     'confirm' (Commander 2026-05-29) — Proceed PO first opens a confirm step so
     the operator can OPTIONALLY pick one Expected Delivery date for the whole
     batch; blank = keep each SO's own dates (today's behaviour). */
  const [dialog, setDialog] = useState<
    | { kind: 'info'; title: string; body: string }
    | { kind: 'created'; title: string; body: string }
    | { kind: 'confirm'; picks: Array<{ soItemId: string; qty: number }>; orderedCodes: Set<string>; count: number; units: number }
    | null
  >(null);
  /* The Expected Delivery date the operator typed into the confirm dialog
     (YYYY-MM-DD). Blank = send no override → server uses each SO's own date. */
  const [proceedExpectedAt, setProceedExpectedAt] = useState<string>('');

  // General tab can sub-filter by category (excl. sofa); sofa tab is locked to SOFA.
  const apiCategory = view === 'sofa' ? 'SOFA' : (category === 'all' ? 'all' : category);
  const q = useMrp({ category: apiCategory, warehouseId, includeUndated: showUndated });
  const data = q.data;
  const createPos = useCreatePosFromSoItems();

  /* Tab split (Commander 2026-05-29 — "MRP 分两个地方"): General = everything
     except sofa, Sofa = sofa only. Done client-side so a stray category in the
     payload can't leak across tabs. */
  const tabSkus = (data?.skus ?? []).filter((s) =>
    view === 'sofa' ? s.category === 'SOFA' : s.category !== 'SOFA');

  /* Delivery-date window: filter child lines + recompute the parent's Qty
     Needed / Shortage to the window. Stock/PO Outstanding stay SKU-level
     (supply isn't date-bucketed). shortageQty per line already reflects the
     date-priority allocation done server-side, so summing visible lines is
     correct. */
  const hasWindow = Boolean(dateFrom || dateTo);
  const lineDate = (l: MrpLine): string | null =>
    dateBasis === 'processing' ? l.processingDate
    : dateBasis === 'soDate' ? l.soDate
    : dateBasis === 'orderBy' ? l.orderByDate
    : l.deliveryDate;
  const lineInWindow = (l: MrpLine): boolean => {
    const d = lineDate(l);
    if (!d) return false;
    const x = d.slice(0, 10);
    if (dateFrom && x < dateFrom) return false;
    if (dateTo && x > dateTo) return false;
    return true;
  };
  const viewSkus: MrpSku[] = tabSkus
    .map((s) => {
      if (!hasWindow) return s;
      const lines = s.lines.filter(lineInWindow);
      const qtyNeeded = lines.reduce((a, l) => a + l.qty, 0);
      const shortage = lines.reduce((a, l) => a + (l.source === 'shortage' ? l.shortageQty : 0), 0);
      return { ...s, lines, qtyNeeded, shortage };
    })
    .filter((s) => !hasWindow || s.lines.length > 0);

  const models = view === 'general' ? groupByModel(viewSkus) : [];

  /* Sofa sets — one per SO line. Apply the same date-basis window as the
     General lines (each set has one date triple). */
  const setInWindow = (s: SofaSet): boolean => {
    if (!hasWindow) return true;
    const d = dateBasis === 'processing' ? s.processingDate : dateBasis === 'soDate' ? s.soDate : dateBasis === 'orderBy' ? s.orderByDate : s.deliveryDate;
    if (!d) return false;
    const x = d.slice(0, 10);
    if (dateFrom && x < dateFrom) return false;
    if (dateTo && x > dateTo) return false;
    return true;
  };
  const viewSets: SofaSet[] = view === 'sofa' ? (data?.sofaSets ?? []).filter(setInWindow) : [];

  /* Only-shortages focus filter (Commander 2026-05-29) — affects which ROWS
     render; the summary counts above stay on the full demand set so the
     operator still sees the totals. */
  const displayModels = onlyShort ? models.filter((m) => m.shortage > 0) : models;
  const displaySets = onlyShort ? viewSets.filter((s) => s.shortageQty > 0) : viewSets;

  const toggleModel = (code: string) =>
    setExpandedModels((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code); else next.add(code);
      return next;
    });
  const toggleVariant = (key: string) =>
    setExpandedVariants((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const toggleSelect = (key: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });

  const expandAll = () => {
    if (view === 'general') {
      setExpandedModels(new Set(models.map((m) => m.itemCode)));
      setExpandedVariants(new Set(viewSkus.map(rowKey)));
    } else {
      setExpandedVariants(new Set(viewSkus.map(rowKey)));
    }
  };
  const collapseAll = () => { setExpandedModels(new Set()); setExpandedVariants(new Set()); };

  const switchView = (v: View) => {
    setView(v);
    setCategory('all');
    setSelected(new Set());
    setExpandedModels(new Set());
    setExpandedVariants(new Set());
  };

  /* Fire the (mode-aware) convert-from-SO endpoint for the given picks. Shared
     by the General (per-variant shortage) and Sofa (per-set) order paths.
     `expectedAt` (Commander 2026-05-29) — when set, the server applies it as the
     PO header expected_at AND every PO line's delivery date for the whole batch;
     when blank we send nothing so it keeps using each SO's own dates. */
  const runCreatePos = (
    picks: Array<{ soItemId: string; qty: number }>,
    orderedCodes: Set<string>,
    expectedAt?: string,
  ) => {
    if (picks.length === 0) {
      setDialog({ kind: 'info', title: 'Nothing to order', body: 'No uncovered (shortage) lines in the current selection / window.' });
      return;
    }
    // Only send overrides for the SKUs actually being ordered.
    const supplierByCode: Record<string, string> = {};
    for (const [code, sup] of Object.entries(supplierOverride)) {
      if (orderedCodes.has(code) && sup) supplierByCode[code] = sup;
    }
    const body = { picks, mode: poMode, supplierByCode, ...(expectedAt ? { expectedAt } : {}) };
    createPos.mutate(body, {
      onSuccess: (res) => {
        if (!res.total) {
          setDialog({
            kind: 'info',
            title: 'No POs created',
            body: "These SKUs aren't bound to a supplier yet. Assign each shortage SKU a main supplier (the “— none —” rows), then proceed again.",
          });
          return;
        }
        // Refresh so coverage updates immediately; keep the result in an in-app
        // dialog (not a browser alert) per commander.
        setSelected(new Set());
        void q.refetch();
        setDialog({
          kind: 'created',
          title: `Created ${res.total} PO${res.total === 1 ? '' : 's'}`,
          body: (res.created ?? []).map((p) => p.poNumber).join(', '),
        });
      },
      onError: (err) => {
        const raw = err instanceof Error ? err.message : String(err);
        let codes: string[] = [];
        let errCode = '';
        try {
          const m = raw.match(/\{.*\}/);
          if (m) {
            const j = JSON.parse(m[0]);
            errCode = typeof j.error === 'string' ? j.error : '';
            if (j.error === 'missing_bindings' && Array.isArray(j.itemCodes)) codes = j.itemCodes;
          }
        } catch { /* generic */ }
        // A stale view can still try to order a line that was already PO'd in
        // another session/tab (server: qty_exceeds_remaining). Refresh so the
        // ordered line drops off, and tell the operator plainly instead of
        // showing the raw error (Commander 2026-05-29).
        if (errCode === 'qty_exceeds_remaining') {
          void q.refetch();
          setDialog({
            kind: 'info',
            title: 'Already ordered',
            body: 'Some of these lines were already put on a PO. The list has been refreshed — review what still needs ordering and proceed again.',
          });
          return;
        }
        setDialog(codes.length > 0
          ? { kind: 'info', title: "SKUs not bound to a supplier", body: 'Assign these to a supplier first, then proceed:\n' + codes.map((c) => `• ${c}`).join('\n') }
          : { kind: 'info', title: 'Order failed', body: raw });
      },
    });
  };

  /* General — picks (+ codes + unit count) for the SHORT lines of the given
     SKUs (shortage qty only). Pure gather; the confirm dialog fires the order. */
  const gatherShortages = (skus: MrpResponse['skus']) => {
    const picks = skus
      .filter((s) => s.shortage > 0)
      .flatMap((s) => s.lines
        .filter((l) => l.source === 'shortage' && l.shortageQty > 0)
        .map((l) => ({ soItemId: l.soItemId, qty: l.shortageQty })))
      .filter((p) => p.soItemId);
    const orderedCodes = new Set(skus.filter((s) => s.shortage > 0).map((s) => s.itemCode));
    const units = skus.filter((s) => s.shortage > 0).reduce((a, s) => a + s.shortage, 0);
    return { picks, orderedCodes, units };
  };

  /* Sofa — picks for the un-ordered units of each set as a whole (colour-
     matched). One pick per SO line; the convert endpoint groups them into POs
     per the PO mode (Combined = 1 PO/supplier, Per SO = 1 PO/SO). */
  const gatherSofaSets = (sets: SofaSet[]) => {
    const chosen = sets.filter((s) => s.shortageQty > 0);
    const picks = chosen
      .map((s) => ({ soItemId: s.soItemId, qty: s.shortageQty }))
      .filter((p) => p.soItemId);
    const orderedCodes = new Set(chosen.map((s) => s.itemCode));
    let units = chosen.reduce((a, s) => a + s.shortageQty, 0);

    /* Commander 2026-05-29 — "pillow 开在 sofa 里面就要跟 sofa 的 PO 一起". For
       every SO we're proceeding a sofa set on, ALSO pull that SO's accessory
       (pillow) shortage lines into the same /from-sos batch. The server groups
       by supplier, so same-supplier pillows land on the sofa's PO and a
       different-supplier pillow splits to its own PO automatically. Accessories
       live in the General tab's SKU list, so read them off the raw payload
       (`data.skus`) — `viewSkus` is sofa-only in this view. Respect the active
       date window so we don't drag in out-of-window pillows. */
    const setDocs = new Set(chosen.map((s) => s.soDocNo));
    const already = new Set(picks.map((p) => p.soItemId));
    const accessoryLines = (data?.skus ?? [])
      .filter((s) => (s.category ?? '').toUpperCase() === 'ACCESSORY')
      .flatMap((s) => s.lines.map((l) => ({ line: l, itemCode: s.itemCode })))
      .filter(({ line }) =>
        line.source === 'shortage' && line.shortageQty > 0 && line.soItemId
        && setDocs.has(line.soDocNo) && (!hasWindow || lineInWindow(line)));
    for (const { line, itemCode } of accessoryLines) {
      if (already.has(line.soItemId)) continue;
      already.add(line.soItemId);
      picks.push({ soItemId: line.soItemId, qty: line.shortageQty });
      orderedCodes.add(itemCode);
      units += line.shortageQty;
    }
    return { picks, orderedCodes, units };
  };

  // General (per-variant) shortage list.
  const shortageSkus = viewSkus.filter((s) => s.shortage > 0);
  const selectedShortageSkus = shortageSkus.filter((s) => selected.has(rowKey(s)));
  // Sofa (per-set) shortage list.
  const shortageSets = viewSets.filter((s) => s.shortageQty > 0);
  const selectedShortageSets = shortageSets.filter((s) => selected.has(s.soItemId));

  // View-agnostic counts the header / select-all / summary read from.
  const shortCount = view === 'sofa' ? shortageSets.length : shortageSkus.length;
  const selectedShortCount = view === 'sofa' ? selectedShortageSets.length : selectedShortageSkus.length;
  const shortageUnits = view === 'sofa'
    ? shortageSets.reduce((a, s) => a + s.shortageQty, 0)
    : shortageSkus.reduce((a, s) => a + s.shortage, 0);
  const inDemandCount = view === 'sofa' ? viewSets.length : viewSkus.length;

  const allShortSelected = shortCount > 0 && selectedShortCount === shortCount;
  const someShortSelected = selectedShortCount > 0 && !allShortSelected;
  const toggleSelectAll = () => {
    if (allShortSelected) { setSelected(new Set()); return; }
    setSelected(view === 'sofa'
      ? new Set(shortageSets.map((s) => s.soItemId))
      : new Set(shortageSkus.map(rowKey)));
  };
  /* Toggle every shortage variant under a model on/off as a unit. */
  const setModelSelected = (g: ModelGroup, on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const v of g.variants) {
        if (v.shortage > 0) { if (on) next.add(rowKey(v)); else next.delete(rowKey(v)); }
      }
      return next;
    });

  /* Proceed PO — gather the selected shortages (or all if none selected) and
     open the confirm dialog so the operator can OPTIONALLY pick one Expected
     Delivery date for the whole batch before the POs are generated. */
  const onProceed = () => {
    const { picks, orderedCodes, units } = view === 'sofa'
      ? gatherSofaSets(selectedShortageSets.length > 0 ? selectedShortageSets : shortageSets)
      : gatherShortages(selectedShortageSkus.length > 0 ? selectedShortageSkus : shortageSkus);
    if (picks.length === 0) {
      setDialog({ kind: 'info', title: 'Nothing to order', body: 'No uncovered (shortage) lines in the current selection / window.' });
      return;
    }
    setProceedExpectedAt('');
    setDialog({ kind: 'confirm', picks, orderedCodes, count: picks.length, units });
  };

  const basisLabel = dateBasis === 'processing' ? 'Processing' : dateBasis === 'soDate' ? 'SO Date' : dateBasis === 'orderBy' ? 'Order-by' : 'Delivery';
  const windowLabel = hasWindow ? `${basisLabel} ${dateFrom || '…'} → ${dateTo || '…'}` : '';
  const skuNoun = view === 'sofa' ? 'sets' : 'variants';

  return (
    <div className={styles.page}>
      <div className={styles.headerRow}>
        <div>
          <h1 className={styles.title}>MRP · Stock Status Report</h1>
          <p className={styles.subtitle}>
            Open Sales-Order demand vs stock + incoming POs. Orange rows still
            need ordering.
            {data && (<> · as of {fmtDateTime(data.asOf)}</>)}
          </p>
        </div>
        <div className={styles.actions}>
          {/* PO generation mode — same semantics as Create-PO-from-SO. */}
          <div className={styles.modeToggle} role="group" aria-label="PO generation mode">
            <button type="button" className={styles.modeBtn} data-active={poMode === 'combined'}
              onClick={() => setPoMode('combined')} title="One PO per supplier">Combined</button>
            <button type="button" className={styles.modeBtn} data-active={poMode === 'per-so'}
              onClick={() => setPoMode('per-so')} title="One PO per SO (sofa / bedframe)">Per SO</button>
          </div>
          {view === 'general' && (
            <>
              <button type="button" className={styles.ghostBtn} onClick={collapseAll}>Collapse</button>
              <button type="button" className={styles.ghostBtn} onClick={expandAll}>Expand</button>
            </>
          )}
          <button type="button" className={styles.ghostBtn} onClick={() => void q.refetch()} disabled={q.isFetching}>
            <RefreshCw {...ICON} className={q.isFetching ? styles.spin : undefined} /> Refresh
          </button>
          <button
            type="button"
            className={styles.primaryBtn}
            disabled={createPos.isPending || shortCount === 0}
            onClick={onProceed}
            title={
              selectedShortCount > 0 ? `Order the selected ${view === 'sofa' ? 'sets' : 'SKUs'}`
              : hasWindow ? `Order everything in ${windowLabel} as one batch`
              : view === 'sofa' ? 'Order all sofa sets still to order' : 'Order all shortage SKUs'
            }
          >
            <ShoppingCart {...ICON} />
            {createPos.isPending
              ? 'Processing…'
              : selectedShortCount > 0
                ? `Proceed PO (${selectedShortCount})`
                : hasWindow
                  ? `Proceed PO · window (${shortCount})`
                  : `Proceed PO (${shortCount})`}
          </button>
        </div>
      </div>

      {/* Tabs — Commander 2026-05-29: split MRP into two places (non-sofa / sofa). */}
      <div className={styles.tabBar} role="tablist">
        <button type="button" role="tab" aria-selected={view === 'general'}
          className={styles.tab} data-active={view === 'general'} onClick={() => switchView('general')}>
          General <span className={styles.tabHint}>· bedframe, mattress, etc.</span>
        </button>
        <button type="button" role="tab" aria-selected={view === 'sofa'}
          className={styles.tab} data-active={view === 'sofa'} onClick={() => switchView('sofa')}>
          Sofa <span className={styles.tabHint}>· ordered as a set</span>
        </button>
      </div>

      {/* Summary badges — reflect the active delivery-date window. */}
      {data && (
        <div className={styles.summaryRow}>
          <span className={styles.summaryChip}><PackageCheck {...ICON} /> {inDemandCount} {skuNoun} in demand</span>
          <span className={`${styles.summaryChip} ${shortCount > 0 ? styles.summaryChipWarn : ''}`}>
            <AlertTriangle {...ICON} /> {shortCount} {view === 'sofa' ? 'sets' : 'short'} · {shortageUnits} units to order
          </span>
          {hasWindow && (
            <span className={styles.summaryChip}><CalendarRange {...ICON} /> Window {windowLabel}</span>
          )}
        </div>
      )}

      {/* Sofa is ordered as a colour-matched SET, one per SO line. */}
      {view === 'sofa' && (
        <div className={styles.note}>
          <Info {...ICON} />
          <span>
            Each row is one SO's configured sofa <strong>set</strong> (its modules
            + colour), ordered whole so the colours match. Coverage tracks how much
            of the set is already on a PO; orange rows still need ordering.
          </span>
        </div>
      )}

      {/* Filters — switchable date basis drives the window; Warehouse over
          Category on the right. Category sub-filter only on the General tab. */}
      <div className={styles.filterRow}>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Date</span>
          <select className={styles.filterSelect} value={dateBasis}
            onChange={(e) => setDateBasis(e.target.value as typeof dateBasis)}
            title="Which date the From–To window filters on">
            <option value="delivery">Delivery date</option>
            <option value="orderBy">Order-by date</option>
            <option value="processing">Processing date</option>
            <option value="soDate">SO date</option>
          </select>
        </label>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>from</span>
          <input type="date" className={styles.filterSelect} value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)} />
        </label>
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>to</span>
          <input type="date" className={styles.filterSelect} value={dateTo}
            onChange={(e) => setDateTo(e.target.value)} />
        </label>
        {hasWindow && (
          <button type="button" className={styles.ghostBtn}
            onClick={() => { setDateFrom(''); setDateTo(''); }}>Clear window</button>
        )}
        <label className={styles.filterField} title="Show SO lines that have no delivery date (not ready to order)">
          <input type="checkbox" checked={showUndated} onChange={(e) => setShowUndated(e.target.checked)} />
          <span className={styles.filterLabel}>Show no-date</span>
        </label>
        <label className={styles.filterField} title="Hide fully-covered rows — show only what still needs ordering">
          <input type="checkbox" checked={onlyShort} onChange={(e) => setOnlyShort(e.target.checked)} />
          <span className={styles.filterLabel}>Only shortages</span>
        </label>
        {/* Commander 2026-05-29 — "排版整理一下": Warehouse + Category used to sit
            in a right-aligned vertical stack (pushed by a spacer), which read as
            mis-indented. Flattened into the same left-aligned wrapping row as the
            date/checkbox filters so everything lines up on one consistent grid. */}
        <label className={styles.filterField}>
          <span className={styles.filterLabel}>Warehouse</span>
          <select className={styles.filterSelect} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            <option value="all">All warehouses</option>
            {(data?.warehouses ?? []).map((w) => (
              <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
            ))}
          </select>
        </label>
        {view === 'general' && (
          <label className={styles.filterField}>
            <span className={styles.filterLabel}>Category</span>
            <select className={styles.filterSelect} value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All (non-sofa)</option>
              {(data?.categories ?? ['BEDFRAME', 'MATTRESS'])
                .filter((cat) => cat !== 'SOFA')
                .map((cat) => (
                  <option key={cat} value={cat}>{CAT_LABELS[cat] ?? cat}</option>
                ))}
            </select>
          </label>
        )}
      </div>

      {/* Table */}
      <div className={styles.tableWrap}>
        {view === 'general' ? (
          /* General — 3-level Model → Variant → orders. */
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colSelect}>
                  <input
                    type="checkbox"
                    aria-label="Select all shortage rows"
                    title="Select all shortage rows"
                    disabled={shortCount === 0}
                    checked={allShortSelected}
                    ref={(el) => { if (el) el.indeterminate = someShortSelected; }}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th className={styles.colCaret} />
                <th>Item Code</th>
                <th>Description</th>
                <th className={styles.num}>Qty Needed</th>
                <th className={styles.num}>Stock</th>
                <th className={styles.num}>PO Outstanding</th>
                <th className={styles.num}>Shortage</th>
                {/* Commander 2026-05-29 — soonest delivery date so the buyer
                    sees the nearest due date without expanding (Order-By column
                    dropped; lead time still drives the sort). */}
                <th>Delivery</th>
                <th>Main Supplier</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td colSpan={10} className={styles.stateCell}>Loading MRP…</td></tr>
              )}
              {q.isError && (
                <tr><td colSpan={10} className={styles.stateCell}>Failed to load: {(q.error as Error)?.message}</td></tr>
              )}
              {data && displayModels.length === 0 && (
                <tr><td colSpan={10} className={styles.stateCell}>
                  {onlyShort ? 'Nothing needs ordering — everything in view is covered.'
                    : hasWindow ? 'No demand delivering in this window.'
                    : 'No open Sales-Order demand for this filter.'}
                </td></tr>
              )}
              {displayModels.map((g) => (
                <ModelRows
                  key={g.itemCode}
                  group={g}
                  modelOpen={expandedModels.has(g.itemCode)}
                  onToggleModel={() => toggleModel(g.itemCode)}
                  expandedVariants={expandedVariants}
                  onToggleVariant={toggleVariant}
                  selected={selected}
                  onSelectVariant={toggleSelect}
                  onSelectModel={setModelSelected}
                  chosenSupplierId={supplierOverride[g.itemCode] ?? null}
                  onSupplierChange={(sid) => setRowSupplier(g.itemCode, sid)}
                />
              ))}
            </tbody>
          </table>
        ) : (
          /* Sofa — one row per SO line = one colour-matched set. */
          <table className={styles.table}>
            <thead>
              <tr>
                <th className={styles.colSelect}>
                  <input
                    type="checkbox"
                    aria-label="Select all sofa sets to order"
                    title="Select all sofa sets to order"
                    disabled={shortCount === 0}
                    checked={allShortSelected}
                    ref={(el) => { if (el) el.indeterminate = someShortSelected; }}
                    onChange={toggleSelectAll}
                  />
                </th>
                <th>SO No</th>
                <th>Customer</th>
                <th>Set (modules · colour)</th>
                <th>Delivery Date</th>
                <th className={styles.num}>Qty</th>
                <th className={styles.num}>To Order</th>
                <th>Supplier</th>
              </tr>
            </thead>
            <tbody>
              {q.isLoading && (
                <tr><td colSpan={8} className={styles.stateCell}>Loading MRP…</td></tr>
              )}
              {q.isError && (
                <tr><td colSpan={8} className={styles.stateCell}>Failed to load: {(q.error as Error)?.message}</td></tr>
              )}
              {data && displaySets.length === 0 && (
                <tr><td colSpan={8} className={styles.stateCell}>
                  {onlyShort ? 'No sofa sets need ordering — everything in view is covered.'
                    : hasWindow ? 'No sofa sets delivering in this window.'
                    : 'No open sofa Sales-Order demand for this filter.'}
                </td></tr>
              )}
              {displaySets.map((set) => (
                <SofaSetRow
                  key={set.soItemId}
                  set={set}
                  selected={selected.has(set.soItemId)}
                  onSelect={() => toggleSelect(set.soItemId)}
                  chosenSupplierId={supplierOverride[set.itemCode] ?? null}
                  onSupplierChange={(sid) => setRowSupplier(set.itemCode, sid)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* In-app result dialog — Commander 2026-05-29: confirm/result inside the
          page, not a browser alert. The 'confirm' kind is the Proceed-PO step
          that lets the operator OPTIONALLY pick one Expected Delivery date. */}
      {dialog && dialog.kind === 'confirm' && (
        <div className={styles.dialogBackdrop} onClick={() => setDialog(null)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className={styles.dialogTitle}>Proceed PO</h2>
            <p className={styles.dialogBody}>
              Generate purchase orders for {dialog.count} {dialog.count === 1 ? 'line' : 'lines'}
              {' '}({dialog.units} {dialog.units === 1 ? 'unit' : 'units'}) in{' '}
              {poMode === 'combined' ? 'Combined (one PO per supplier)' : 'Per SO (one PO per SO)'} mode.
            </p>
            <label className={styles.dialogField}>
              <span className={styles.filterLabel}>Expected Delivery (optional — leave blank to use each SO's own date)</span>
              <input
                type="date"
                className={styles.filterSelect}
                value={proceedExpectedAt}
                onChange={(e) => setProceedExpectedAt(e.target.value)}
                title="Apply one delivery date to the whole batch (PO header + every line). Leave blank to keep each SO's own date."
              />
            </label>
            <div className={styles.dialogActions}>
              <button type="button" className={styles.ghostBtn} onClick={() => setDialog(null)}>Cancel</button>
              <button
                type="button"
                className={styles.primaryBtn}
                disabled={createPos.isPending}
                onClick={() => {
                  const { picks, orderedCodes } = dialog;
                  setDialog(null);
                  runCreatePos(picks, orderedCodes, proceedExpectedAt || undefined);
                }}
              >
                {createPos.isPending ? 'Processing…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
      {dialog && dialog.kind !== 'confirm' && (
        <div className={styles.dialogBackdrop} onClick={() => setDialog(null)}>
          <div className={styles.dialog} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
            <h2 className={styles.dialogTitle}>{dialog.title}</h2>
            <p className={styles.dialogBody}>{dialog.body}</p>
            <div className={styles.dialogActions}>
              {dialog.kind === 'created' ? (
                <>
                  <button type="button" className={styles.ghostBtn} onClick={() => setDialog(null)}>Stay here</button>
                  <button type="button" className={styles.primaryBtn} onClick={() => { setDialog(null); navigate('/purchase-orders'); }}>
                    Open Purchase Orders
                  </button>
                </>
              ) : (
                <button type="button" className={styles.primaryBtn} onClick={() => setDialog(null)}>OK</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/* Supplier cell — shared by Model rows and the flat sofa rows. Single supplier
   shows the name (code as tooltip); multiple show a switch dropdown. */
const SupplierCell = ({ suppliers, chosenSupplierId, onSupplierChange }: {
  suppliers: MrpSku['suppliers']; chosenSupplierId: string | null;
  onSupplierChange: (supplierId: string) => void;
}) => {
  if (suppliers.length === 0) return <span className={styles.noSupplier}>— none —</span>;
  if (suppliers.length === 1) {
    return <span title={suppliers[0]!.code}><Truck {...ICON} /> {suppliers[0]!.name}</span>;
  }
  const defaultSupplierId = suppliers.find((s) => s.isMain)?.supplierId ?? suppliers[0]!.supplierId;
  return (
    <select
      className={styles.supplierSelect}
      value={chosenSupplierId ?? defaultSupplierId}
      onChange={(e) => onSupplierChange(e.target.value)}
      title="Switch supplier for this SKU before posting the PO"
    >
      {suppliers.map((s) => (
        <option key={s.supplierId} value={s.supplierId}>
          {s.name}{s.isMain ? ' ★' : ''} · {s.code}
        </option>
      ))}
    </select>
  );
};

/* Soonest delivery date across a set of SO lines, NULLs last. Lets a
   parent/variant row show the nearest due date at a glance. (Commander
   2026-05-29 — main row shows Delivery only; lead time still drives sort.) */
function earliestDelivery(lines: MrpLine[]): string | null {
  return lines.reduce<string | null>(
    (min, l) => (l.deliveryDate && (!min || l.deliveryDate < min) ? l.deliveryDate : min),
    null,
  );
}

/* General tab — one Model and its variants. Multi-variant models expand into
   variant sub-rows (each expandable to its SO orders). Single-variant models
   (mattress, accessory) expand straight to their SO orders. */
const ModelRows = ({
  group, modelOpen, onToggleModel, expandedVariants, onToggleVariant,
  selected, onSelectVariant, onSelectModel, chosenSupplierId, onSupplierChange,
}: {
  group: ModelGroup;
  modelOpen: boolean;
  onToggleModel: () => void;
  expandedVariants: Set<string>;
  onToggleVariant: (key: string) => void;
  selected: Set<string>;
  onSelectVariant: (key: string) => void;
  onSelectModel: (g: ModelGroup, on: boolean) => void;
  chosenSupplierId: string | null;
  onSupplierChange: (supplierId: string) => void;
}) => {
  const short = group.shortage > 0;
  const shortVariants = group.variants.filter((v) => v.shortage > 0);
  const selectedShort = shortVariants.filter((v) => selected.has(rowKey(v)));
  const allSel = shortVariants.length > 0 && selectedShort.length === shortVariants.length;
  const someSel = selectedShort.length > 0 && !allSel;
  const single = !group.multiVariant;
  const onlyVariant = group.variants[0]!;

  return (
    <>
      <tr className={`${styles.skuRow} ${short ? styles.skuRowShort : ''}`} onClick={onToggleModel}>
        <td className={styles.colSelect} onClick={(e) => e.stopPropagation()}>
          {short && (
            <input
              type="checkbox"
              checked={allSel}
              ref={(el) => { if (el) el.indeterminate = someSel; }}
              onChange={(e) => onSelectModel(group, e.target.checked)}
              aria-label={`Select all shortages under ${group.itemCode}`}
            />
          )}
        </td>
        <td className={styles.colCaret}>
          {modelOpen ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
        </td>
        <td className={styles.codeCell}>{group.itemCode}</td>
        <td className={styles.descCell}>
          {group.description ?? '—'}
          {group.multiVariant && (
            <span className={styles.countTag}>{group.variants.length} variants</span>
          )}
        </td>
        <td className={styles.num}>{group.qtyNeeded}</td>
        <td className={styles.num}>{group.stock}</td>
        <td className={styles.num}>{group.poOutstanding || '—'}</td>
        <td className={`${styles.num} ${short ? styles.shortNum : ''}`}>{short ? group.shortage : '—'}</td>
        <td className={styles.orderByCell}>{fmtDate(earliestDelivery(group.variants.flatMap((v) => v.lines)))}</td>
        <td className={styles.supplierCell} onClick={(e) => e.stopPropagation()}>
          <SupplierCell suppliers={group.suppliers} chosenSupplierId={chosenSupplierId} onSupplierChange={onSupplierChange} />
        </td>
      </tr>

      {/* Single-variant model (mattress/accessory) → orders directly (2-level). */}
      {modelOpen && single && (
        <tr className={styles.detailRow}>
          <td /><td />
          <td colSpan={8}><OrderLines lines={onlyVariant.lines} /></td>
        </tr>
      )}

      {/* Multi-variant model → variant sub-rows (each expandable to orders). */}
      {modelOpen && !single && group.variants.map((v) => {
        const k = rowKey(v);
        const vShort = v.shortage > 0;
        const vOpen = expandedVariants.has(k);
        return (
          <FragmentRow key={k}>
            <tr className={`${styles.variantRow} ${vShort ? styles.variantRowShort : ''}`} onClick={() => onToggleVariant(k)}>
              <td className={styles.colSelect} onClick={(e) => e.stopPropagation()}>
                {vShort && (
                  <input
                    type="checkbox"
                    checked={selected.has(k)}
                    onChange={() => onSelectVariant(k)}
                    aria-label={`Select ${v.variantLabel ?? v.itemCode} to order`}
                  />
                )}
              </td>
              <td className={styles.colCaret}>
                {vOpen ? <ChevronDown {...ICON} /> : <ChevronRight {...ICON} />}
              </td>
              <td />
              <td className={styles.variantDescCell}>
                <span className={styles.variantBranch}>↳</span>
                <span className={styles.variantTag}>{v.variantLabel ?? '(no variant)'}</span>
              </td>
              <td className={styles.num}>{v.qtyNeeded}</td>
              <td className={styles.num}>{v.stock}</td>
              <td className={styles.num}>{v.poOutstanding || '—'}</td>
              <td className={`${styles.num} ${vShort ? styles.shortNum : ''}`}>{vShort ? v.shortage : '—'}</td>
              <td className={styles.orderByCell}>{fmtDate(earliestDelivery(v.lines))}</td>
              <td />
            </tr>
            {vOpen && (
              <tr className={styles.detailRow}>
                <td /><td />
                <td colSpan={8}><OrderLines lines={v.lines} /></td>
              </tr>
            )}
          </FragmentRow>
        );
      })}
    </>
  );
};

/* Tiny helper so multi-element returns inside .map keep a single key. */
const FragmentRow = ({ children }: { children: ReactNode }) => <>{children}</>;

/* Sofa tab — one row per SO line = one colour-matched SET. Shows the set's
   module composition + colour; coverage tracks how much is already on a PO. */
const SofaSetRow = ({ set, selected, onSelect, chosenSupplierId, onSupplierChange }: {
  set: SofaSet; selected: boolean; onSelect: () => void;
  chosenSupplierId: string | null; onSupplierChange: (supplierId: string) => void;
}) => {
  const short = set.shortageQty > 0;
  return (
    <tr className={`${styles.skuRow} ${short ? styles.skuRowShort : ''}`}>
      <td className={styles.colSelect}>
        {short && (
          <input type="checkbox" checked={selected} onChange={onSelect}
            aria-label={`Select ${set.soDocNo} sofa set to order`} />
        )}
      </td>
      <td className={styles.codeCell}>{set.soDocNo}</td>
      <td>{set.debtorName ?? '—'}</td>
      <td className={styles.setCell}>
        {set.modules.length > 0 ? (
          <span className={styles.moduleChips}>
            {set.modules.map((m, i) => (
              <span key={`${m}-${i}`} className={styles.moduleChip}>{m}</span>
            ))}
          </span>
        ) : (
          <span className={styles.descCell}>{set.description ?? '—'}</span>
        )}
        {set.colour && <span className={styles.colourTag}>{set.colour}</span>}
      </td>
      <td>{fmtDate(set.deliveryDate)}</td>
      <td className={styles.num}>{set.qty}</td>
      <td className={`${styles.num} ${short ? styles.shortNum : ''}`}>
        {short ? set.shortageQty : <span className={`${styles.tag} ${styles.tagPo}`}>ordered</span>}
      </td>
      <td className={styles.supplierCell}>
        <SupplierCell suppliers={set.suppliers} chosenSupplierId={chosenSupplierId} onSupplierChange={onSupplierChange} />
      </td>
    </tr>
  );
};

/* The SO-order child table — shared by every leaf level. */
const OrderLines = ({ lines }: { lines: MrpLine[] }) => (
  <table className={styles.childTable}>
    <thead>
      <tr>
        <th>SO No</th>
        <th>Customer</th>
        <th>Processing</th>
        <th>Delivery Date</th>
        <th className={styles.num}>Qty</th>
        <th>Coverage</th>
      </tr>
    </thead>
    <tbody>
      {lines.map((ln, i) => <ChildLine key={`${ln.soDocNo}-${i}`} ln={ln} />)}
    </tbody>
  </table>
);

const ChildLine = ({ ln }: { ln: MrpLine }) => {
  const short = ln.source === 'shortage';
  return (
    <tr className={short ? styles.childShort : undefined}>
      <td className={styles.codeCell}>{ln.soDocNo}</td>
      <td>{ln.debtorName ?? '—'}</td>
      <td>{fmtDate(ln.processingDate)}</td>
      <td>{fmtDate(ln.deliveryDate)}</td>
      <td className={styles.num}>{ln.qty}</td>
      <td>
        {ln.source === 'stock' && <span className={`${styles.tag} ${styles.tagStock}`}>stock</span>}
        {ln.source === 'po' && (
          <span className={`${styles.tag} ${styles.tagPo}`}>
            {ln.poNumber
              ? `${ln.poNumber}${ln.poEta ? ` · ETA ${fmtDate(ln.poEta)}` : ''}`
              : 'ordered'}
          </span>
        )}
        {short && (
          <span className={`${styles.tag} ${styles.tagShort}`}>
            SHORT{ln.shortageQty > 1 ? ` ×${ln.shortageQty}` : ''}
          </span>
        )}
      </td>
    </tr>
  );
};
