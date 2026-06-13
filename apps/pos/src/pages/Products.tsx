// ----------------------------------------------------------------------------
// POS Products — mirror of apps/backend/src/pages/Products.tsx, role-gated.
//
// Commander 2026-05-28 — "把 Backend 的 Products 整个模块 port 到 POS 这边".
// Commander 2026-05-28 (tightening) — "POS 前面让他们全部不能 edit 先,只有
// sales director 可以添加,不能 edit". Three-tier role gate (matches the
// SO Maintenance page):
//   - sales / sales_executive / outlet_manager  → VIEW   (readonly display)
//   - sales_director                            → ADD-ONLY (+ buttons visible,
//                                                           edit / delete hidden)
//   - admin                                     → FULL   (everything,
//                                                           identical to Backend)
//
// Cost columns are stripped UNCONDITIONALLY here regardless of role; on POS
// what looks like "price" is the SELLING price. The raw-material COST that
// Backend exposes on Maintenance PricedOption rows (PR #216) is purchase
// cost — never shown to sales-side users.
//
// DATA LEAK FIX (Commander 2026-05-28): commander's mental model treats the
// Backend `priceSen` field on PricedOption rows as COST too — "拍卖价" /
// purchase reference. Showing it on POS leaks costing info to sales staff.
// POS now reads / writes a parallel `sellingPriceSen` field; priceSen never
// renders on POS. See SellingPriceCell below + MaintenanceList row render.
//
// Writes (when sales_director edits) hit the SAME API endpoints + Supabase
// tables the Backend Products uses, via the copied queries under
// apps/pos/src/lib/products/. No new schema, no new endpoints.
//
// Ported from HOOKKA src/pages/products/index.tsx (~2839 LOC). 2990s
// version uses the existing design tokens (PORT_DESIGN.md §2 + UI_REFERENCE
// non-negotiables in CLAUDE.md):
//   - cream canvas (--c-cream), paper card (--c-paper)
//   - Merriweather title, Poppins body, Raleway eyebrow + caps tracking-loud
//   - Archivo Black for the price column (--font-mark, 80% stretch, burnt)
//   - Lucide icons stroke 1.75, no emoji
//   - exactly ONE primary orange CTA per screen (Edit Prices / Save)
//   - rounded-only tokens (no literal px on border-radius)
//
// Tabs:
//   [SKU Master]      — list of mfg_products, filterable by category
//   [Modular]         — Model list (readonly stub on POS; deep editor on
//                       Backend only — would balloon scope to port)
//   [Maintenance]     — left-rail of sub-tabs grouped Bedframe / Sofa / Common
//   [Combo Pricing]   — sofa combo deals (per-customer override prices)
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useState, type CSSProperties, type HTMLAttributes, type ReactNode } from 'react';
import {
  Download,
  Upload,
  Edit3,
  Search,
  History,
  Package,
  Trash2,
  Plus,
  X,
  Truck,
  Star,
  ChevronDown,
  Layers,
  ImageOff,
  Gift,
} from 'lucide-react';
import { Button } from '@2990s/design-system';
import {
  maintValues,
  maintActiveValues,
  maintEntryValue,
  maintEntryActive,
  maintEntryWithValue,
  type MaintPoolEntry,
  SOFA_MODULES,
  resolveSofaQuickPresets,
  type SofaQuickPreset,
} from '@2990s/shared';
import {
  useMfgProducts,
  useUpdateMfgProductPrices,
  useUpdateMfgProductGifts,
  useCreateMfgProduct,
  useDeleteMfgProduct,
  useMaintenanceConfig,
  useMaintenanceConfigHistory,
  useSaveMaintenanceConfig,
  useRenameSofaCompartment,
  useMfgProductSuppliers,
  useUploadSofaCompartmentPhoto,
  useDeleteSofaCompartmentPhoto,
  type MfgCategory,
  type MfgProductRow,
  type MaintenanceConfig,
  type PricedOption,
  type SeatHeightPrice,
  type SofaPriceTier,
  type ProductSupplierRow,
} from '../lib/products/mfg-products-queries';
import { useFabricTrackings } from '../lib/products/fabric-queries';
import { useDeliveryFeeConfig, useUpdateDeliveryFeeConfig, useSpecialDeliveryFees, useUpsertSpecialDeliveryFee, useDeleteSpecialDeliveryFee, useFabricLibrary, useFabricColours, useFabricTierAddonConfig, useUpdateFabricTierAddonConfig, useUpdateFabricLibraryTier, useAddons, type AddonRow, type FabricLibraryRow, useSpecialAddons, useCreateSpecialAddon, useUpdateSpecialAddon, useDeleteSpecialAddon, type SpecialAddonRow, type SpecialAddonGroup, type SpecialAddonInput, useAllAddons, useUpdateAddon, useCreateAddon, useDeleteAddon, type AdminAddonRow } from '../lib/queries';
import {
  useProductModels,
  useProductModel,
  useUpdateProductModel,
  type AllowedOptions,
} from '../lib/products/product-models-queries';
import { FabricsTable } from '../components/products/FabricsTable';
import { SofaComboTab } from '../components/products/SofaComboTab';
import { PwpRulesTab } from '../components/products/PwpRulesTab';
import { formatSizeRich, formatSizeRichWithCfg, resolveSizeInfo } from '../lib/products/size-info';
import { useStaff } from '../lib/staff';
import { useQueryClient } from '@tanstack/react-query';
import styles from './Products.module.css';

/* ════════════════════════════════════════════════════════════════════════
   POS Role gate — three-tier (view / add-only / full).

   Commander 2026-05-28 tightening: stripped sales_director down from full
   edit to "add new entries only". Existing rows are display-only for them;
   only admin can edit / delete / toggle. Sales-side staff (sales /
   sales_executive / outlet_manager) stay view-only.

   `mode` is threaded through to every sub-component, drawer, dialog, and
   table. The legacy `readonly` boolean is kept as a derived alias so the
   sub-components that only care about "can this user enter free-form
   edit mode?" don't need to change shape: readonly = mode !== 'full'.
   Components that need to distinguish 'view' from 'add-only' read `mode`
   directly.
   ════════════════════════════════════════════════════════════════════════ */
export type ProductsMode = 'view' | 'add-only' | 'full';

function productsMode(role: string | undefined): ProductsMode {
  // master_account = POS-only selling editor (D1). super_admin is an additive
  // superset of admin (was previously falling through to 'view' — a bug).
  if (role === 'admin' || role === 'super_admin' || role === 'master_account') return 'full';
  if (role === 'sales_director') return 'add-only';
  return 'view'; // sales / sales_executive / outlet_manager / coordinator / finance / anything else
}

function useProductsMode(): ProductsMode {
  const { data: staff } = useStaff();
  if (!staff) return 'view'; // default to safest tier until staff row resolves
  return productsMode(staff.role);
}

/* Modal shell shown when a POS user clicks into a flow the POS port
   intentionally deferred (New Model dialog, CSV import). Acts as a soft
   pointer back to the Backend portal — where sales_director has the
   full editor. */
const ScopeDeferredNotice = ({
  title,
  onClose,
}: {
  title: string;
  onClose: () => void;
}) => (
  <div
    role="dialog"
    aria-modal="true"
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0,0,0,0.32)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 100,
    }}
    onClick={onClose}
  >
    <div
      style={{
        background: 'var(--c-paper)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-5) var(--space-6)',
        maxWidth: 420,
        boxShadow: '0 12px 32px rgba(0,0,0,0.16)',
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <h3
        style={{
          margin: 0,
          fontFamily: 'var(--font-display)',
          fontSize: 'var(--fs-18)',
          color: 'var(--c-ink)',
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--fs-13)',
          color: 'var(--fg-soft)',
          marginTop: 8,
          marginBottom: 16,
        }}
      >
        This editor lives on the Backend portal. POS Products is read-mostly —
        the deep Model / CSV editors are reserved for the desktop admin.
      </p>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Button variant="primary" onClick={onClose}>OK</Button>
      </div>
    </div>
  </div>
);

const ICON_PROPS = { size: 16, strokeWidth: 1.75 } as const;

/* PR — Commander 2026-05-28 (PHOTO FIX): product_models.photo_url is stored
   as a relative proxy path (`/product-models/{id}/photo/{key}`) — see
   apps/api/src/routes/product-models.ts. Rendering it raw in an <img src>
   resolves against the POS origin (which doesn't host that route) → 404 →
   broken image / first-letter placeholder. Prefix VITE_API_URL so the URL
   points at the Worker's public photo proxy. Absolute URLs (http(s)://)
   pass through untouched. Sister function to resolvePhotoUrl() in
   lib/queries.ts which the Catalog grid already uses; both branches must
   stay in sync. */
const API_URL = import.meta.env.VITE_API_URL as string | undefined;
const resolveModelPhotoUrl = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw)) return raw;
  if (!API_URL) return raw; // local dev — best effort, let it break visibly
  return raw.startsWith('/') ? `${API_URL}${raw}` : `${API_URL}/${raw}`;
};

type TopTab = 'sku' | 'modular' | 'specialAddons' | 'fabrics' | 'maintenance' | 'combos' | 'delivery' | 'pwp';


export const Products = () => {
  const [topTab, setTopTab] = useState<TopTab>('sku');
  const mode = useProductsMode();
  // Legacy alias: every non-'full' role had the old readonly affordances
  // (no inline cell edit, no delete). add-only roles still see add buttons
  // — those branches read `mode` directly.
  const readonly = mode !== 'full';

  /* Chip next to the page title — same style as SO Maintenance so the gate
     is visible at a glance. */
  const modeChip =
    mode === 'view'     ? { label: 'View only', tone: 'muted' as const } :
    mode === 'add-only' ? { label: 'Add-only · Cannot edit existing', tone: 'warn' as const } :
                          null;

  return (
    <div className={styles.page}>
      <header className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <h1 className={styles.title}>
            Products
            {modeChip && (
              <span
                style={{
                  display: 'inline-block',
                  marginLeft: 'var(--space-3)',
                  padding: '4px 10px',
                  borderRadius: 999,
                  fontSize: 'var(--fs-12)',
                  fontFamily: 'var(--font-button)',
                  fontWeight: 600,
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  verticalAlign: 'middle',
                  background:
                    modeChip.tone === 'warn'
                      ? 'rgba(232, 107, 58, 0.12)'
                      : 'rgba(34, 31, 32, 0.06)',
                  color:
                    modeChip.tone === 'warn'
                      ? 'var(--c-burnt, #A6471E)'
                      : 'var(--fg-muted)',
                }}
              >
                {modeChip.label}
              </span>
            )}
          </h1>
          <div className={styles.tabSwitch} role="tablist">
            <button
              type="button"
              role="tab"
              data-active={topTab === 'sku'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('sku')}
            >
              SKU Master
            </button>
            {/* PR #84 — Commander 2026-05-26 wanted a dedicated place to
                manage per-Model specs (allowed options, thickness, etc.)
                separately from "create code" and SKU adjustments. The
                Modular tab routes into the same ProductModels list that
                used to live under /product-models — restoring an entry
                point (PR #73 removed the old Models tab; this is its
                replacement with a clearer name). */}
            <button
              type="button"
              role="tab"
              data-active={topTab === 'modular'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('modular')}
            >
              Modular
            </button>
            {/* Special Add-ons (Chairman 2026-06-02) — the 加钱 home: bedframe +
                sofa surcharge pools + the new per-Model Product Add-ons (Right
                Drawer etc.). Order Add-ons (Dispose/Lift) join here in PR-2b. */}
            <button
              type="button"
              role="tab"
              data-active={topTab === 'specialAddons'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('specialAddons')}
            >
              Special Add-ons
            </button>
            {/* Fabrics (Chairman 2026-06-02) — the former Maintenance "Common"
                section (Fabrics + Fabric Pricing) lifted to its own top tab. */}
            <button
              type="button"
              role="tab"
              data-active={topTab === 'fabrics'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('fabrics')}
            >
              Fabrics
            </button>
            <button
              type="button"
              role="tab"
              data-active={topTab === 'maintenance'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('maintenance')}
            >
              Maintenance
            </button>
            {/* PR #237 — Sofa Combo Pricing (Commander 2026-05-28
                "去查看 hookka 的 combo module 把整个 copy 过来"). Module-set
                combo deals that OVERRIDE per-Model compartment pricing. */}
            <button
              type="button"
              role="tab"
              data-active={topTab === 'combos'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('combos')}
            >
              Combo Pricing
            </button>
            {/* Cost/sell split Phase 2 — delivery fee moved here from the
                Backend Settings → Delivery tab (Master Account owns it). */}
            <button
              type="button"
              role="tab"
              data-active={topTab === 'delivery'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('delivery')}
            >
              Delivery fee
            </button>
            {/* Purchase-with-purchase + Promo (换购优惠) — Chairman 2026-06-02/03.
                Global rules: buy a trigger → redeem a reward at its PWP price, or
                free for a Promo rule (migration 0145). */}
            <button
              type="button"
              role="tab"
              data-active={topTab === 'pwp'}
              className={styles.tabSwitchBtn}
              onClick={() => setTopTab('pwp')}
            >
              PWP &amp; Promo
            </button>
          </div>
        </div>
      </header>

      {topTab === 'sku' && <SkuMasterTab mode={mode} />}
      {topTab === 'modular' && <ProductModelsReadonlyList mode={mode} />}
      {topTab === 'specialAddons' && <MaintenanceTab mode={mode} sectionFilter={['Bedframe', 'Sofa', 'Product Add-ons', 'Order Add-ons']} />}
      {topTab === 'fabrics' && <MaintenanceTab mode={mode} sectionFilter={['Common']} />}
      {topTab === 'maintenance' && <MaintenanceTab mode={mode} sectionFilter={['Products Maintenance']} />}
      {topTab === 'combos' && <SofaComboTab mode={mode} />}
      {topTab === 'delivery' && <DeliveryFeeTab mode={mode} />}
      {topTab === 'pwp' && <PwpRulesTab mode={mode} />}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Delivery fee tab — Master Account (cost/sell split Phase 2). The whole
   delivery-fee block (base fee + cross-category surcharge + the two lead-day
   fields) moved here from the Backend Settings → Delivery tab. Editing is gated
   on mode === 'full' (admin / super_admin / master_account). Fees are whole RM.
   NOTE (Phase 4): the fee is not yet re-derived server-side on the live mfg-SO
   path, and the Handover consumer reads categories from the empty retail
   catalog — so changing this number does not yet change what live orders are
   charged. That charging fix is tracked separately.
   ════════════════════════════════════════════════════════════════════════ */
// Brand-consistent field styling for the Delivery tab. White inputs on the
// cream page (the old cream-on-cream inputs were invisible); ink text, a clear
// strong border, brand radius.
const DF_INPUT: CSSProperties = {
  width: '100%', padding: '10px 12px', fontSize: 'var(--fs-14)', fontFamily: 'var(--font-sans)',
  border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)',
  background: '#fff', color: 'var(--c-ink)', outline: 'none',
};
const DF_INPUT_DISABLED: CSSProperties = { ...DF_INPUT, background: 'rgba(34,31,32,0.04)', color: 'var(--fg-muted)' };
const DF_LABEL: CSSProperties = {
  display: 'block', fontFamily: 'var(--font-button)', fontSize: 'var(--fs-11)', fontWeight: 600,
  letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-soft)', marginBottom: '6px',
};
const DF_HINT: CSSProperties = { display: 'block', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: '6px' };
const DF_CARD: CSSProperties = {
  background: 'var(--c-paper)', border: '1px solid var(--line)', borderRadius: 'var(--radius-lg)',
  boxShadow: 'var(--shadow-2)', padding: 'var(--space-5)',
};
const DF_SECTION_TITLE: CSSProperties = {
  display: 'flex', alignItems: 'center', gap: '8px',
  fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-16)', fontWeight: 800, color: 'var(--c-ink)', margin: 0,
};

const DeliveryFeeTab = ({ mode }: { mode: ProductsMode }) => {
  const canEdit = mode === 'full';
  const cfg = useDeliveryFeeConfig();
  const update = useUpdateDeliveryFeeConfig();

  const [baseFee, setBaseFee] = useState<number | ''>('');
  const [crossCategoryFee, setCrossCategoryFee] = useState<number | ''>('');
  const [mattressDays, setMattressDays] = useState<number | ''>('');
  const [sofaDays, setSofaDays] = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Hydrate inputs once the GET resolves.
  useEffect(() => {
    if (cfg.data) {
      setBaseFee(cfg.data.baseFee);
      setCrossCategoryFee(cfg.data.crossCategoryFee);
      setMattressDays(cfg.data.mattressBedframeLeadDays);
      setSofaDays(cfg.data.sofaLeadDays);
    }
  }, [cfg.data]);

  const onSave = async () => {
    setError(null);
    setSuccess(false);
    if (
      typeof baseFee !== 'number' || typeof crossCategoryFee !== 'number' ||
      typeof mattressDays !== 'number' || typeof sofaDays !== 'number'
    ) {
      setError('All four fields must be whole-number integers.');
      return;
    }
    if (baseFee < 0 || crossCategoryFee < 0 || mattressDays < 0 || sofaDays < 0) {
      setError('Values cannot be negative.');
      return;
    }
    try {
      await update.mutateAsync({
        baseFee,
        crossCategoryFee,
        mattressBedframeLeadDays: mattressDays,
        sofaLeadDays: sofaDays,
      });
      setSuccess(true);
    } catch (err) {
      setError(String((err as Error).message ?? err));
    }
  };

  if (cfg.isLoading) {
    return <div style={{ padding: 'var(--space-5)', color: 'var(--fg-muted)' }}>Loading delivery fees…</div>;
  }
  if (cfg.error) {
    return <div style={{ padding: 'var(--space-5)', color: 'var(--fg-muted)' }}>Failed to load: {String(cfg.error)}</div>;
  }

  const numberField = (
    id: string,
    label: string,
    hint: string,
    value: number | '',
    setValue: (v: number | '') => void,
  ) => (
    <div>
      <label htmlFor={id} style={DF_LABEL}>{label}</label>
      <input
        id={id}
        type="number"
        min={0}
        step={1}
        value={value}
        disabled={!canEdit}
        onChange={(e) => setValue(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
        style={canEdit ? DF_INPUT : DF_INPUT_DISABLED}
      />
      <span style={DF_HINT}>{hint}</span>
    </div>
  );

  return (
    <div style={{ padding: 'var(--space-5)', maxWidth: 760, display: 'flex', flexDirection: 'column', gap: 'var(--space-6)' }}>
      {/* ── Base fees card ── */}
      <section style={DF_CARD}>
        <h2 style={{ ...DF_SECTION_TITLE, marginBottom: 'var(--space-2)' }}>
          <Truck size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
          Delivery fees
        </h2>
        <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', margin: '0 0 var(--space-5)', maxWidth: 560, lineHeight: 1.5 }}>
          Every order is charged the base fee. Orders mixing a sofa with a mattress
          or bed frame also pay the cross-category surcharge — flat, once. Mattress
          + bed frame count as one category (no surcharge between them).
          Lead times set the minimum days before a delivery date can be picked.
          Changes apply to NEW orders only.
        </p>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(220px, 1fr))', gap: 'var(--space-5)' }}>
          {numberField('df-base', 'Base fee (RM)', 'Charged on every order. Whole RM (no sen).', baseFee, setBaseFee)}
          {numberField('df-cross', 'Cross-category surcharge (RM)', 'Added once, flat, when an order mixes a sofa with a mattress / bed frame. Mattress + bed frame = one category.', crossCategoryFee, setCrossCategoryFee)}
          {numberField('df-mattress', 'Mattress + bed frame lead time (days)', 'Min days before a delivery date when the cart has a mattress or bed frame.', mattressDays, setMattressDays)}
          {numberField('df-sofa', 'Sofa lead time (days)', 'Min days when the cart has a sofa. Mixed carts use the larger lead time.', sofaDays, setSofaDays)}
        </div>

        {error && <div style={{ color: 'var(--c-festive-b)', fontSize: 'var(--fs-13)', marginTop: 'var(--space-4)' }} role="alert">{error}</div>}
        {success && <div style={{ color: 'var(--c-secondary-a)', fontSize: 'var(--fs-13)', fontWeight: 600, marginTop: 'var(--space-4)' }}>Saved.</div>}

        {canEdit && (
          <div style={{ marginTop: 'var(--space-5)' }}>
            <Button variant="primary" onClick={() => void onSave()} disabled={update.isPending}>
              {update.isPending ? 'Saving…' : 'Save'}
            </Button>
          </div>
        )}
      </section>

      <SpecialDeliveryFeesSection canEdit={canEdit} />
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Special-model delivery fees (migration 0140). Some Models cost more to
   transport (e.g. full-latex mattresses, a special sofa). A Model listed here
   has its standalone fee OVERRIDE the base; when its SO is a cross-category
   follow-up linked to an earlier SO, the cross-category price applies instead.
   There is no auto "latex" signal — a row here IS the manual tag. Fees whole RM.
   ════════════════════════════════════════════════════════════════════════ */
const SpecialDeliveryFeesSection = ({ canEdit }: { canEdit: boolean }) => {
  const list   = useSpecialDeliveryFees();
  const upsert = useUpsertSpecialDeliveryFee();
  const del    = useDeleteSpecialDeliveryFee();
  const models = useProductModels();

  const [modelId, setModelId]     = useState('');
  const [standalone, setStandalone] = useState<number | ''>('');
  const [crossFee, setCrossFee]   = useState<number | ''>('');
  const [err, setErr]             = useState<string | null>(null);

  const onAdd = async () => {
    setErr(null);
    if (!modelId) { setErr('Pick a Model.'); return; }
    if (typeof standalone !== 'number' || typeof crossFee !== 'number') {
      setErr('Enter both fees as whole-RM numbers.'); return;
    }
    try {
      await upsert.mutateAsync({ modelId, standaloneFee: standalone, crossCatFollowupFee: crossFee });
      setModelId(''); setStandalone(''); setCrossFee('');
    } catch (e) { setErr(String((e as Error).message ?? e)); }
  };

  const rows = list.data ?? [];

  return (
    <section style={DF_CARD}>
      <h2 style={{ ...DF_SECTION_TITLE, marginBottom: 'var(--space-2)' }}>
        <Star size={20} strokeWidth={1.75} style={{ color: 'var(--c-burnt)' }} />
        Special-model delivery fees
      </h2>
      <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', margin: '0 0 var(--space-5)', maxWidth: 560, lineHeight: 1.5 }}>
        Pick a Model that costs more to transport (e.g. a full-latex mattress).
        Its standalone fee replaces the base fee. The cross-category price is
        charged instead when this Model is bought as a linked follow-up to an
        earlier order. Whole RM.
      </p>

      <div style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Model</th>
              <th style={{ textAlign: 'right' }}>Standalone (RM)</th>
              <th style={{ textAlign: 'right' }}>Cross-category (RM)</th>
              {canEdit && <th style={{ width: 56 }} aria-label="Actions" />}
            </tr>
          </thead>
          <tbody>
            {list.isLoading ? (
              <tr><td colSpan={canEdit ? 4 : 3} style={{ color: 'var(--fg-muted)' }}>Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={canEdit ? 4 : 3} style={{ color: 'var(--fg-muted)' }}>No special models yet. Add one below.</td></tr>
            ) : rows.map((r) => (
              <tr key={r.modelId}>
                <td>
                  <div style={{ fontWeight: 700, color: 'var(--c-ink)' }}>{r.modelName}</div>
                  {(r.modelCode || r.category) && (
                    <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 2 }}>
                      {[r.modelCode, r.category].filter(Boolean).join(' · ')}
                    </div>
                  )}
                </td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)', fontWeight: 600 }}>RM {r.standaloneFee}</td>
                <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--c-ink)', fontWeight: 600 }}>RM {r.crossCatFollowupFee}</td>
                {canEdit && (
                  <td style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      title="Remove"
                      aria-label={`Remove ${r.modelName}`}
                      onClick={() => void del.mutate(r.modelId)}
                      style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 32, height: 32, border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', background: '#fff', color: 'var(--c-festive-b)', cursor: 'pointer' }}
                    >
                      <Trash2 size={16} strokeWidth={1.75} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canEdit && (
        <div style={{ marginTop: 'var(--space-5)', paddingTop: 'var(--space-5)', borderTop: '1px solid var(--line)' }}>
          <div style={{ ...DF_LABEL, marginBottom: 'var(--space-3)' }}>Add a special model</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(200px, 2fr) 1fr 1fr auto', gap: 'var(--space-3)', alignItems: 'end' }}>
            <div>
              <label style={DF_LABEL}>Model</label>
              <select value={modelId} onChange={(e) => setModelId(e.target.value)} style={DF_INPUT}>
                <option value="">Pick a Model…</option>
                {(models.data ?? []).map((m) => (
                  <option key={m.id} value={m.id}>{m.name} ({m.category})</option>
                ))}
              </select>
            </div>
            {numberInputCell('Standalone (RM)', standalone, setStandalone)}
            {numberInputCell('Cross-category (RM)', crossFee, setCrossFee)}
            <Button variant="primary" onClick={() => void onAdd()} disabled={upsert.isPending}>
              <Plus size={16} strokeWidth={1.75} />
              {upsert.isPending ? 'Saving…' : 'Add'}
            </Button>
          </div>
          {err && <div style={{ color: 'var(--c-festive-b)', fontSize: 'var(--fs-13)', marginTop: 'var(--space-3)' }} role="alert">{err}</div>}
        </div>
      )}
    </section>
  );
};

const numberInputCell = (label: string, value: number | '', setValue: (v: number | '') => void) => (
  <div>
    <label style={DF_LABEL}>{label}</label>
    <input
      type="number"
      min={0}
      step={1}
      value={value}
      onChange={(e) => setValue(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
      style={DF_INPUT}
    />
  </div>
);

/* ════════════════════════════════════════════════════════════════════════
   Modular tab — POS list of Models.

   PR — Commander 2026-05-28: cards are clickable for sales_director to
   open a minimal-viable Allowed Options drawer (compartments / sizes /
   leg heights / specials chips). Other roles see the card as readonly.

   Backend's ProductModels page is still the canonical editor (photos,
   SKU generators, supplier multi-pickers). POS only exposes the chip
   ticking the commander asked for; deeper editing lives on Backend.
   ════════════════════════════════════════════════════════════════════════ */
const ProductModelsReadonlyList = ({ mode }: { mode: ProductsMode }) => {
  const canEditAllowed = mode === 'add-only' || mode === 'full';
  const [editingModelId, setEditingModelId] = useState<string | null>(null);
  const [filter, setFilter] = useState<MfgCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const { data: models, isLoading } = useProductModels({
    category: filter === 'all' ? undefined : filter,
  });

  /* Per-Model SKU counts — derived from mfg_products.base_model. Backend
     has its own server-side count via the rich endpoint; POS does a single
     pass over the SKU list for the same view to avoid porting that. */
  const { data: products } = useMfgProducts({
    category: filter === 'all' ? undefined : filter,
  });
  const skuCountByModelName = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products ?? []) {
      const k = p.base_model ?? '';
      if (!k) continue;
      map.set(k, (map.get(k) ?? 0) + 1);
    }
    return map;
  }, [products]);

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase();
    const arr = (models ?? []).filter((m) => m.active);
    if (!q) return arr;
    return arr.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        (m.model_code ?? '').toLowerCase().includes(q),
    );
  }, [models, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof rows>();
    for (const r of rows) {
      const arr = map.get(r.category) ?? [];
      arr.push(r);
      map.set(r.category, arr);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [rows]);

  return (
    <>
      <div className={styles.headerRow}>
        <div className={styles.categoryChips}>
          {(['all', 'SOFA', 'BEDFRAME', 'MATTRESS', 'ACCESSORY', 'SERVICE'] as const).map((c) => (
            <CategoryChip
              key={c}
              active={filter === c}
              onClick={() => setFilter(c as MfgCategory | 'all')}
            >
              {c === 'all' ? 'All' : c.charAt(0) + c.slice(1).toLowerCase()}
            </CategoryChip>
          ))}
        </div>
        <div className={styles.actionsRow}>
          <div className={styles.searchBox}>
            <Search {...ICON_PROPS} className={styles.searchIcon} />
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search models..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      </div>

      <p className={styles.eyebrow}>
        {isLoading
          ? 'Loading models…'
          : canEditAllowed
            ? `${rows.length} active model${rows.length === 1 ? '' : 's'} · Click a card to edit Allowed Options`
            : `${rows.length} active model${rows.length === 1 ? '' : 's'} · Model-level allowed options & specs are managed from the Backend portal`}
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
        {grouped.map(([cat, list]) => (
          <section
            key={cat}
            style={{ background: 'var(--c-paper)', borderRadius: 'var(--radius-md)', padding: 'var(--space-4)' }}
          >
            <h3
              style={{
                margin: 0,
                marginBottom: 'var(--space-3)',
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-15)',
                fontWeight: 600,
                color: 'var(--c-ink)',
              }}
            >
              <span className={styles.catPill} style={{ marginRight: 8 }}>{cat}</span>
              <span style={{ color: 'var(--fg-muted)', fontWeight: 400 }}>
                {list.length} {list.length === 1 ? 'model' : 'models'}
              </span>
            </h3>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 'var(--space-3)',
              }}
            >
              {list.map((m) => (
                <div
                  key={m.id}
                  /* PR — Commander 2026-05-28: card is clickable for
                     sales_director (+ admin) so they can edit the Model's
                     Allowed Options pool without leaving POS. View-only
                     roles see a static card with no hover state. */
                  role={canEditAllowed ? 'button' : undefined}
                  tabIndex={canEditAllowed ? 0 : undefined}
                  onClick={canEditAllowed ? () => setEditingModelId(m.id) : undefined}
                  onKeyDown={canEditAllowed ? (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setEditingModelId(m.id);
                    }
                  } : undefined}
                  style={{
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-3)',
                    background: 'var(--c-cream)',
                    display: 'flex',
                    gap: 'var(--space-3)',
                    alignItems: 'flex-start',
                    cursor: canEditAllowed ? 'pointer' : 'default',
                    transition: canEditAllowed ? 'border-color 120ms ease, transform 120ms ease' : undefined,
                  }}
                  onMouseEnter={canEditAllowed ? (e) => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--c-orange)';
                  } : undefined}
                  onMouseLeave={canEditAllowed ? (e) => {
                    (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--line)';
                  } : undefined}
                >
                  <div
                    style={{
                      width: 56,
                      height: 56,
                      flexShrink: 0,
                      borderRadius: 'var(--radius-sm)',
                      background: 'var(--c-paper)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      overflow: 'hidden',
                    }}
                  >
                    {m.photo_url ? (
                      <img
                        /* PR — Commander 2026-05-28: photo_url is a relative
                           proxy path; prefix VITE_API_URL so the browser
                           can fetch it from the Worker public photo endpoint
                           (apps/api/src/routes/product-models.ts). */
                        src={resolveModelPhotoUrl(m.photo_url) ?? ''}
                        alt={`${m.name} photo`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <ImageOff size={20} strokeWidth={1.5} color="var(--fg-muted)" />
                    )}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--fs-13)',
                        fontWeight: 600,
                        color: 'var(--c-ink)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {m.name}
                    </div>
                    {m.model_code && (
                      <div
                        style={{
                          fontFamily: 'var(--font-mono)',
                          fontSize: 'var(--fs-11)',
                          color: 'var(--fg-muted)',
                          marginTop: 2,
                        }}
                      >
                        {m.model_code}
                      </div>
                    )}
                    <div
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--fs-11)',
                        color: 'var(--fg-soft)',
                        marginTop: 4,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Layers size={11} strokeWidth={1.75} />
                      {(() => {
                        const n = skuCountByModelName.get(m.name) ?? 0;
                        return `${n} SKU${n === 1 ? '' : 's'}`;
                      })()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        ))}
        {!isLoading && rows.length === 0 && (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              background: 'var(--c-paper)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--fg-muted)',
              border: '1px dashed var(--line)',
            }}
          >
            No models found.
          </div>
        )}
      </div>

      {/* PR — Commander 2026-05-28: Allowed Options drawer for sales_director.
          Minimal-viable: read current allowed_options from the row, render 4
          chip-pickers (Compartments / Sizes / Leg Heights / Specials), Save
          PATCHes /product-models/:id. Per-category visibility (mattress
          doesn't need compartments etc.) is handled inside the drawer. */}
      {editingModelId && (
        <ModelAllowedOptionsDrawer
          modelId={editingModelId}
          onClose={() => setEditingModelId(null)}
        />
      )}
    </>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   ModelAllowedOptionsDrawer (PR — Commander 2026-05-28)

   POS-side editor for product_models.allowed_options. Sales_director ticks
   which compartments / sizes / leg heights / specials should surface on the
   POS Configurator for this Model. Reads master pools from MaintenanceConfig
   (so commander's "+ Add Code" wizard pool is the universe), intersects with
   the Model's current allowed_options, lets the user tick/untick, then
   PATCHes /product-models/:id.

   This is the minimum-viable replacement for the Backend's full Model editor.
   Doesn't surface photos, descriptions, SKU generators, or supplier mapping
   — those stay on Backend.
   ════════════════════════════════════════════════════════════════════════ */
const ModelAllowedOptionsDrawer = ({
  modelId,
  onClose,
}: {
  modelId: string;
  onClose: () => void;
}) => {
  const model = useProductModel(modelId);
  const updateModel = useUpdateProductModel();
  const masterCfg = useMaintenanceConfig('master');
  // Fabric pool for the FABRICS section (sofa + bedframe). Synced from the
  // Backend Fabric Converter (migration 0127): series = fabric_library, colours
  // = fabric_colours. On/off is per colour, stored as allowed_options.fabrics.
  const fabricLib = useFabricLibrary();
  const fabricColours = useFabricColours();
  // Special Add-ons pool for the per-Model on/off section (migration 0134).
  // MUST stay above the early-return guards below (hooks order — a hook placed
  // after `if (model.isLoading) return` causes a "Rendered more hooks" crash
  // that tsc/vite don't catch).
  const specialAddons = useSpecialAddons();
  const coloursBySeries = useMemo(() => {
    const mp = new Map<string, { colourId: string; label: string }[]>();
    for (const c of (fabricColours.data ?? [])) {
      const arr = mp.get(c.fabricId) ?? [];
      arr.push({ colourId: c.colourId, label: c.label });
      mp.set(c.fabricId, arr);
    }
    return mp;
  }, [fabricColours.data]);

  /* Draft of the allowed_options under edit. Initialised once when the row
     resolves; the chip toggles mutate this draft, Save writes it back. */
  const [draft, setDraft] = useState<AllowedOptions | null>(null);
  useEffect(() => {
    if (model.data?.model && draft == null) {
      setDraft(JSON.parse(JSON.stringify(model.data.model.allowed_options ?? {})) as AllowedOptions);
    }
  }, [model.data, draft]);

  const m = model.data?.model;
  const cfg = masterCfg.data?.data;

  if (model.isLoading || masterCfg.isLoading) {
    return (
      <DrawerShell title="Loading…" onClose={onClose}>
        <p className={styles.eyebrow}>Loading model data…</p>
      </DrawerShell>
    );
  }
  if (!m || !cfg) {
    return (
      <DrawerShell title="Model not found" onClose={onClose}>
        <p className={styles.eyebrow}>Could not load this model.</p>
      </DrawerShell>
    );
  }

  /* Per-category section visibility — mattress only needs sizes, sofa only
     needs sizes + compartments + leg heights + specials, etc. Hidden sections
     stay absent from the patched allowed_options on save. */
  const isSofa     = m.category === 'SOFA';
  const isBedframe = m.category === 'BEDFRAME';
  const isMattress = m.category === 'MATTRESS';
  // Flat categories have no variants — they're sold straight at the SKU Master
  // price, so the option pickers (sizes/compartments/etc.) don't apply.
  const isFlatCategory = m.category === 'ACCESSORY' || m.category === 'SERVICE';

  /* Master pool sources (drawn from MaintenanceConfig). For lists keyed as
     PricedOption[], we project just the .value field for the chip text. */
  const pricedValues = (arr: PricedOption[] | undefined): string[] =>
    (arr ?? []).map((p) => p.value);

  // ACTIVE toggles (owner spec 2026-06-12) — Modular chips offer ACTIVE
  // values only; already-ticked inactive values still render via the
  // allowed_options union downstream.
  const sizePool: string[] = isSofa
    ? (cfg.sofaSizes ? maintActiveValues(cfg.sofaSizes) : ['24', '26', '28', '30', '32', '35'])
    : isMattress
      ? maintActiveValues(cfg.mattressSizes)
      : maintActiveValues(cfg.bedframeSizes);
  const compartmentPool: string[] = isSofa ? maintActiveValues(cfg.sofaCompartments) : [];
  const legHeightPool: string[]   = isSofa
    ? pricedValues(cfg.sofaLegHeights)
    : isBedframe
      ? pricedValues(cfg.legHeights)
      : [];
  // Special Add-ons (migration 0134) — per-Model on/off sources from the
  // special_addons table filtered by this Model's category, replacing the old
  // flat cfg.specials / cfg.sofaSpecials pools. Ticks still write
  // allowed_options.specials by CODE (special_addons.code == the old value), so
  // every Model's existing on/off is preserved and the server gate is unchanged.
  // Now also works for MATTRESS Models (the old pools were bedframe/sofa only).
  const specialAddonPool: string[] = (specialAddons.data ?? [])
    .filter((a) => a.active && a.categories.includes(m.category))
    .map((a) => a.code);

  const d = draft ?? {};
  const isTicked = (pool: keyof AllowedOptions, v: string): boolean => {
    const arr = d[pool] as string[] | undefined;
    return Array.isArray(arr) && arr.includes(v);
  };
  const toggle = (pool: keyof AllowedOptions, v: string) => {
    setDraft((prev) => {
      const next: AllowedOptions = JSON.parse(JSON.stringify(prev ?? {}));
      const arr = (next[pool] as string[] | undefined) ?? [];
      const idx = arr.indexOf(v);
      if (idx >= 0) arr.splice(idx, 1);
      else arr.push(v);
      (next as Record<string, unknown>)[pool] = arr;
      return next;
    });
  };
  // Bulk on/off for the FABRICS section (All on / All off).
  const setFabricsBulk = (codes: string[], on: boolean) => {
    setDraft((prev) => {
      const next: AllowedOptions = JSON.parse(JSON.stringify(prev ?? {}));
      const cur = new Set((next.fabrics as string[] | undefined) ?? []);
      if (on) codes.forEach((c) => cur.add(c));
      else codes.forEach((c) => cur.delete(c));
      next.fabrics = [...cur];
      return next;
    });
  };

  const onSave = () => {
    if (!draft) return;
    updateModel.mutate({ id: modelId, allowedOptions: draft }, { onSuccess: () => onClose() });
  };

  return (
    <DrawerShell title={`Allowed Options · ${m.name}`} onClose={onClose}>
      <p className={styles.eyebrow} style={{ marginBottom: 'var(--space-3)' }}>
        Tick the options POS staff can pick from when configuring this Model.
        Master pools live under Maintenance — ask admin to add new codes there
        first if you don't see what you need.
      </p>

      {isFlatCategory ? (
        <p className={styles.eyebrow}>
          No configurable options for {m.category.toLowerCase()} models — SKU rows
          track everything directly.
        </p>
      ) : (
        <>
          {sizePool.length > 0 && (
            <AllowedOptionsSection
              label={isSofa ? 'Seat sizes (inches)' : 'Sizes'}
              pool={sizePool}
              isTicked={(v) => isTicked('sizes', v)}
              onToggle={(v) => toggle('sizes', v)}
            />
          )}
          {isSofa && compartmentPool.length > 0 && (
            <AllowedOptionsSection
              label="Compartments"
              pool={compartmentPool}
              isTicked={(v) => isTicked('compartments', v)}
              onToggle={(v) => toggle('compartments', v)}
            />
          )}
          {legHeightPool.length > 0 && (
            <AllowedOptionsSection
              label="Leg heights"
              pool={legHeightPool}
              isTicked={(v) => isTicked('leg_heights', v)}
              onToggle={(v) => toggle('leg_heights', v)}
            />
          )}
          {specialAddonPool.length > 0 && (
            <AllowedOptionsSection
              label="Special Add-ons"
              pool={specialAddonPool}
              isTicked={(v) => isTicked('specials', v)}
              onToggle={(v) => toggle('specials', v)}
            />
          )}

          {(isSofa || isBedframe) && (
            <FabricAllowedSection
              series={(fabricLib.data ?? []).map((f) => ({ id: f.id, label: f.label }))}
              coloursBySeries={coloursBySeries}
              isTicked={(code) => isTicked('fabrics', code)}
              onToggle={(code) => toggle('fabrics', code)}
              onSetAll={setFabricsBulk}
            />
          )}
        </>
      )}

      <div style={{ display: 'flex', gap: 'var(--space-2)', justifyContent: 'flex-end', marginTop: 'var(--space-5)' }}>
        <Button variant="ghost" size="md" onClick={onClose}>
          <span>Cancel</span>
        </Button>
        <Button variant="primary" size="md" onClick={onSave} disabled={updateModel.isPending}>
          <span>{updateModel.isPending ? 'Saving…' : 'Save'}</span>
        </Button>
      </div>
    </DrawerShell>
  );
};

/** Minimal drawer-shell wrapper. Right-slide panel with backdrop. */
const DrawerShell = ({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) => (
  <div
    role="dialog"
    aria-label={title}
    style={{
      position: 'fixed',
      inset: 0,
      background: 'rgba(0, 0, 0, 0.32)',
      zIndex: 80,
      display: 'flex',
      justifyContent: 'flex-end',
    }}
    onClick={onClose}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        width: 'min(520px, 100vw)',
        height: '100%',
        background: 'var(--c-paper)',
        boxShadow: '-12px 0 32px rgba(0, 0, 0, 0.18)',
        padding: 'var(--space-5)',
        overflowY: 'auto',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
        <h2 style={{
          margin: 0,
          fontFamily: 'var(--font-title)',
          fontSize: 'var(--fs-20)',
          fontWeight: 700,
          color: 'var(--c-ink)',
        }}>{title}</h2>
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className={styles.maintRowIcon}
          style={{ color: 'var(--fg-muted)' }}
        >
          <X {...ICON_PROPS} />
        </button>
      </header>
      <div style={{ flex: 1, minHeight: 0 }}>{children}</div>
    </div>
  </div>
);

/** Chip-picker row used by ModelAllowedOptionsDrawer. */
const AllowedOptionsSection = ({
  label,
  pool,
  isTicked,
  onToggle,
}: {
  label: string;
  pool: string[];
  isTicked: (v: string) => boolean;
  onToggle: (v: string) => void;
}) => (
  <div style={{ marginBottom: 'var(--space-4)' }}>
    <div style={{
      fontFamily: 'var(--font-button)',
      fontSize: 'var(--fs-12)',
      fontWeight: 600,
      letterSpacing: '0.08em',
      textTransform: 'uppercase',
      color: 'var(--fg-muted)',
      marginBottom: 'var(--space-2)',
    }}>{label}</div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
      {pool.map((v) => {
        const on = isTicked(v);
        return (
          <button
            key={v}
            type="button"
            onClick={() => onToggle(v)}
            style={{
              padding: '4px 12px',
              borderRadius: 999,
              border: `1px solid ${on ? 'var(--c-orange)' : 'var(--line)'}`,
              background: on ? 'var(--c-orange)' : 'var(--c-cream)',
              color: on ? 'var(--c-paper)' : 'var(--c-ink)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              cursor: 'pointer',
              transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
            }}
          >
            {v}
          </button>
        );
      })}
    </div>
  </div>
);

/* FABRICS section for the Modular drawer (Chairman 2026-06-01). On/off is per
   COLOUR (the single authority), grouped under its SERIES header. The chip text
   is the colour NAME (e.g. "Sand"); the toggle value is the colour CODE
   (fabric_colours.colour_id, e.g. "CG-002") stored in allowed_options.fabrics. */
const FabricAllowedSection = ({
  series,
  coloursBySeries,
  isTicked,
  onToggle,
  onSetAll,
}: {
  series: { id: string; label: string }[];
  coloursBySeries: Map<string, { colourId: string; label: string }[]>;
  isTicked: (code: string) => boolean;
  onToggle: (code: string) => void;
  onSetAll: (codes: string[], on: boolean) => void;
}) => {
  const withColours = series.filter((s) => (coloursBySeries.get(s.id) ?? []).length > 0);
  // Per-series "All on / All off" — bulk-toggle just that series' colour codes.
  const bulkBtn = (codes: string[], label: string, on: boolean) => (
    <button
      type="button"
      onClick={() => onSetAll(codes, on)}
      style={{
        padding: '2px 10px', borderRadius: 999, border: '1px solid var(--line)',
        background: 'transparent', color: 'var(--c-ink)', cursor: 'pointer',
        fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', fontWeight: 600,
      }}
    >{label}</button>
  );
  return (
    <div style={{ marginBottom: 'var(--space-4)' }}>
      <div style={{
        fontFamily: 'var(--font-button)', fontSize: 'var(--fs-12)', fontWeight: 600,
        letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--fg-muted)',
        marginBottom: 'var(--space-2)',
      }}>Fabrics</div>
      {withColours.length === 0 ? (
        <div style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
          No fabrics yet — add them in the Backend Fabric Converter.
        </div>
      ) : withColours.map((s) => (
        <div key={s.id} style={{ marginBottom: 'var(--space-3)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-1)' }}>
            <span style={{ fontSize: 'var(--fs-12)', fontWeight: 600, color: 'var(--c-ink)' }}>{s.label}</span>
            <span style={{ display: 'inline-flex', gap: 'var(--space-1)', marginLeft: 'auto' }}>
              {bulkBtn((coloursBySeries.get(s.id) ?? []).map((c) => c.colourId), 'All on', true)}
              {bulkBtn((coloursBySeries.get(s.id) ?? []).map((c) => c.colourId), 'All off', false)}
            </span>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
            {(coloursBySeries.get(s.id) ?? []).map((c) => {
              const on = isTicked(c.colourId);
              return (
                <button
                  key={c.colourId}
                  type="button"
                  onClick={() => onToggle(c.colourId)}
                  title={c.colourId}
                  style={{
                    padding: '4px 12px', borderRadius: 999,
                    border: `1px solid ${on ? 'var(--c-orange)' : 'var(--line)'}`,
                    background: on ? 'var(--c-orange)' : 'var(--c-cream)',
                    color: on ? 'var(--c-paper)' : 'var(--c-ink)',
                    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)', fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 120ms ease, color 120ms ease, border-color 120ms ease',
                  }}
                >
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   SKU Master tab
   ════════════════════════════════════════════════════════════════════════ */

const CATEGORIES: { value: MfgCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ACCESSORY', label: 'Accessory' },
  { value: 'BEDFRAME', label: 'Bedframe' },
  { value: 'SOFA', label: 'Sofa' },
  { value: 'MATTRESS', label: 'Mattress' },
  { value: 'SERVICE', label: 'Service' },
];

const fmtRm = (sen: number | null): string => {
  if (sen == null) return '—';
  return `RM ${(sen / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const fmtUnit = (milli: number): string =>
  (milli / 1000).toFixed(3);

// The POS sofa Edit-Price grid authors the buyer SELLING price at the default
// (P1) tier (Chairman 2026-06-01: run at P1; the per-fabric P2/P3 upcharge is a
// later GLOBAL change, like delivery fee, so it is NOT a per-size grid cell).
// Cost (priceSen) stays Backend-owned — these helpers only touch sellingPriceSen
// and PRESERVE any cost already on the entry.
const SOFA_SELL_TIER: SofaPriceTier = 'PRICE_1';

// Read the SELLING price (sellingPriceSen) for a (height, tier) slot.
const sellingForHeightTier = (
  arr: SeatHeightPrice[] | null | undefined,
  height: string,
  tier: SofaPriceTier,
): number | null => {
  if (!Array.isArray(arr)) return null;
  const hit = arr.find((p) => p.height === height && (p.tier ?? 'PRICE_2') === tier);
  return hit?.sellingPriceSen ?? null;
};

// Set the SELLING price for one (height × tier) slot, MERGING onto any existing
// entry so the Backend-owned cost priceSen survives. Clearing the selling price
// keeps a slot that still carries a cost; only a slot with neither cost nor
// selling is dropped. A brand-new slot is created selling-only (no priceSen) so
// the cost path falls back to base_price_sen (resolveSeatHeightSen skips it).
const upsertHeightTierSelling = (
  arr: SeatHeightPrice[] | null | undefined,
  height: string,
  tier: SofaPriceTier,
  sellingPriceSen: number | null,
): SeatHeightPrice[] => {
  const next = Array.isArray(arr) ? [...arr] : [];
  const idx = next.findIndex((p) => p.height === height && (p.tier ?? 'PRICE_2') === tier);
  const cleared = sellingPriceSen == null || sellingPriceSen === 0;
  if (idx >= 0) {
    const existing = next[idx]!;
    if (cleared) {
      if (existing.priceSen != null && existing.priceSen !== 0) {
        next[idx] = { height: existing.height, priceSen: existing.priceSen, tier: existing.tier };
      } else {
        next.splice(idx, 1);
      }
    } else {
      next[idx] = { ...existing, sellingPriceSen };
    }
    return next;
  }
  if (cleared) return next;
  next.push({ height, tier, sellingPriceSen });
  return next;
};

const SkuMasterTab = ({ mode = 'view' }: { mode?: ProductsMode }) => {
  const [category, setCategory] = useState<MfgCategory | 'all'>('all');
  const [search, setSearch] = useState('');
  const [editModeRaw, setEditMode] = useState(false);
  /* Only 'full' (admin) can flip the Edit Prices toggle on. add-only +
     view tiers hard-clamp edit mode off so the inline-edit cells in
     ProductRow never accept input — even if some other code path tried
     to flip it.

     'add-only' (sales_director) still gets the "+ New SKU" / "Import SKUs"
     buttons + the Suppliers drawer (read-only inside, but useful for
     confirming who carries a SKU). They never enter edit mode. */
  const canAdd  = mode !== 'view';
  const canEdit = mode === 'full';
  const editMode = canEdit ? editModeRaw : false;
  // PR #39 — Model filter chip row (visible only on Sofa view).
  // Distinct base_model values pulled from current rows. 'all' = no filter.
  const [modelFilter, setModelFilter] = useState<string>('all');

  const { data: products, isLoading, error } = useMfgProducts({
    category: category === 'all' ? undefined : category,
    search: search.trim() || undefined,
  });
  const config = useMaintenanceConfig('master');

  const allRows = useMemo(() => products ?? [], [products]);
  const isSofaView = category === 'SOFA';
  const isMattressView = category === 'MATTRESS';
  const sofaSizes = config.data?.data?.sofaSizes
    ? maintValues(config.data.data.sofaSizes)
    : ['24', '26', '28', '30', '32', '35'];

  // PR #39 + #107 — distinct base_model values for the current category.
  // Commander 2026-05-26: "为什么 bedframe 没有像 sofa 那样". Extended from
  // SOFA-only to BEDFRAME + MATTRESS too so commander can narrow the SKU
  // list to a single Model (Hilton bedframes, Purezone mattresses, etc.).
  // ACCESSORY + SERVICE skip the filter — they don't carry a base_model.
  const supportsModelFilter = category === 'SOFA' || category === 'BEDFRAME' || category === 'MATTRESS';
  const categoryModels = useMemo<string[]>(() => {
    if (!supportsModelFilter) return [];
    const s = new Set<string>();
    for (const r of allRows) if (r.base_model) s.add(r.base_model);
    return Array.from(s).sort();
  }, [allRows, supportsModelFilter]);

  // Apply Model filter (only when current category supports it + a specific
  // model is picked).
  const rows = useMemo(() => {
    if (!supportsModelFilter || modelFilter === 'all') return allRows;
    return allRows.filter((r) => r.base_model === modelFilter);
  }, [allRows, supportsModelFilter, modelFilter]);

  // Reset Model filter when leaving a category that doesn't support it
  useEffect(() => {
    if (!supportsModelFilter && modelFilter !== 'all') setModelFilter('all');
  }, [supportsModelFilter, modelFilter]);

  // Drawer + modal state
  const [newSkuOpen, setNewSkuOpen] = useState(false);
  const [suppliersRow, setSuppliersRow] = useState<MfgProductRow | null>(null);
  const [giftsRow, setGiftsRow] = useState<MfgProductRow | null>(null);
  const [importing, setImporting] = useState(false);
  // PR #73 — "+ New SKU" now opens the Model creation dialog (with the
  // active category filter pre-filled). The legacy single-SKU drawer
  // stays around in `newSkuOpen` for the ACCESSORY / SERVICE fall-back
  // where a Model template isn't useful.
  const [newModelOpen, setNewModelOpen] = useState(false);
  /* POS port: NewModelDialog isn't ported — the ScopeDeferredNotice replaces
     it. qc is no longer referenced from the SKU Master tab on POS. */

  // PR #82 (Commander 2026-05-26) — multi-select delete. Set<id> tracks
  // ticked rows; select-all checkbox toggles every visible row.
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const deleteMut = useDeleteMfgProduct();
  const visibleIds = useMemo(() => rows.map((r) => r.id), [rows]);
  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = !allSelected && visibleIds.some((id) => selectedIds.has(id));
  const toggleRow = (id: string) =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  const toggleAllVisible = () =>
    setSelectedIds((prev) => {
      const n = new Set(prev);
      if (allSelected) {
        for (const id of visibleIds) n.delete(id);
      } else {
        for (const id of visibleIds) n.add(id);
      }
      return n;
    });
  // Drop selections that disappeared from the visible list (category /
  // search change). Prevents "Delete 3" claiming rows that aren't on
  // screen.
  useEffect(() => {
    setSelectedIds((prev) => {
      if (prev.size === 0) return prev;
      const vis = new Set(visibleIds);
      const next = new Set<string>();
      for (const id of prev) if (vis.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [visibleIds]);
  const bulkDelete = async () => {
    if (selectedIds.size === 0) return;
    // eslint-disable-next-line no-alert
    if (!confirm(`Delete ${selectedIds.size} SKU${selectedIds.size === 1 ? '' : 's'}? This cannot be undone.`)) return;
    setDeleting(true);
    const ids = Array.from(selectedIds);
    const results = await Promise.all(ids.map((id) =>
      deleteMut.mutateAsync(id).then(() => ({ id, ok: true as const })).catch((e) => ({ id, ok: false as const, err: e instanceof Error ? e.message : String(e) })),
    ));
    setDeleting(false);
    const failed = results.filter((r): r is { id: string; ok: false; err: string } => !r.ok);
    setSelectedIds(new Set());
    if (failed.length === 0) return;

    // PR #94 — Commander 2026-05-26: the "Deleted 0 / 6. 6 failed" alert
    // hid the actual reason behind a generic message. Surface per-row
    // errors so commander can see WHAT is blocking (inventory lot,
    // supplier binding, etc.) and offer Force delete as a follow-up.
    const blockedByRef = failed.filter((f) => /product_in_use|23503|references/i.test(f.err));
    const sample = failed.slice(0, 3).map((f) => `· ${f.err.slice(0, 160)}`).join('\n');
    const overflow = failed.length > 3 ? `\n…and ${failed.length - 3} more.` : '';
    // eslint-disable-next-line no-alert
    const wantForce = blockedByRef.length > 0 && confirm(
      `Deleted ${results.length - failed.length} / ${results.length}. ${failed.length} failed:\n${sample}${overflow}\n\n`
      + `${blockedByRef.length} of the failures look like inventory / supplier bindings.\n`
      + `Force delete will wipe those side-table rows first then drop the SKU. Continue?`,
    );
    if (!wantForce) {
      // eslint-disable-next-line no-alert
      alert(`Deleted ${results.length - failed.length} / ${results.length}. ${failed.length} failed.\n${sample}${overflow}`);
      return;
    }
    setDeleting(true);
    const retry = await Promise.all(failed.map((f) =>
      deleteMut.mutateAsync({ id: f.id, force: true }).then(() => ({ id: f.id, ok: true as const })).catch((e) => ({ id: f.id, ok: false as const, err: e instanceof Error ? e.message : String(e) })),
    ));
    setDeleting(false);
    const stillFailed = retry.filter((r) => !r.ok);
    if (stillFailed.length === 0) {
      // eslint-disable-next-line no-alert
      alert(`Force delete cleaned up the remaining ${retry.length} SKU${retry.length === 1 ? '' : 's'}.`);
    } else {
      const stillSample = stillFailed.slice(0, 3).map((r) => `· ${r.ok ? '' : r.err.slice(0, 160)}`).join('\n');
      // eslint-disable-next-line no-alert
      alert(`Force delete: ${retry.length - stillFailed.length} / ${retry.length} succeeded. ${stillFailed.length} still failed:\n${stillSample}`);
    }
  };

  // Total column count (header colspan for loading/empty states):
  //   PR #82 — leading checkbox column added (+1, only in full mode).
  //   PR #38 — Configure + History columns removed. Double-click a row to
  //   open the Suppliers drawer.
  //   Visibility is now controlled solely in Modular (Chairman 2026-06-01) —
  //   the per-SKU "Visible" column was removed from SKU Master.
  //   - Sofa: [select?] + code + desc + model + N sizes + unit
  //   - Mattress: [select?] + code + desc + branding + size + price + unit
  //   - Other: [select?] + code + desc + category + size + base price + unit
  const colCount = (canEdit ? 1 : 0) + (isSofaView
    ? 3 + sofaSizes.length + 1
    : isMattressView
      ? 7    // + PWP Price column (0128)
      : 7);  // Price 1 removed (0124); + PWP Price column (0128)

  return (
    <>
      <div className={styles.headerRow}>
        <div className={styles.categoryChips}>
          {CATEGORIES.map((c) => (
            <CategoryChip
              key={c.value}
              active={category === c.value}
              onClick={() => setCategory(c.value)}
            >
              {c.label}
            </CategoryChip>
          ))}
        </div>

        <div className={styles.actionsRow}>
          <div className={styles.searchBox}>
            <Search {...ICON_PROPS} className={styles.searchIcon} />
            <input
              type="search"
              className={styles.searchInput}
              placeholder="Search all products..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {/* Export is allowed for everyone — useful audit trail / quote
              reference. Add affordances (Import + New SKU) gate on canAdd
              (sales_director + admin). Bulk Delete + Edit Prices gate on
              canEdit (admin only). */}
          <Button variant="ghost" size="md" onClick={() => exportSkusCsv(rows)}>
            <Download {...ICON_PROPS} />
            <span>Export SKUs</span>
          </Button>
          {canAdd && (
            <>
              <Button variant="ghost" size="md" onClick={() => setImporting(true)}>
                <Upload {...ICON_PROPS} />
                <span>Import SKUs</span>
              </Button>
              <Button variant="ghost" size="md" onClick={() => setNewModelOpen(true)}>
                <Plus {...ICON_PROPS} />
                <span>New SKU</span>
              </Button>
            </>
          )}
          {canEdit && (
            <>
              {/* PR #82 — only render the bulk Delete button when at least one row
                  is ticked, so the toolbar stays compact in normal use. */}
              {selectedIds.size > 0 && (
                <Button
                  variant="secondary"
                  size="md"
                  onClick={bulkDelete}
                  disabled={deleting}
                  style={{ color: 'var(--c-festive-b, #B8331F)' }}
                >
                  <Trash2 {...ICON_PROPS} />
                  <span>{deleting ? 'Deleting…' : `Delete ${selectedIds.size}`}</span>
                </Button>
              )}
              <Button
                variant={editMode ? 'secondary' : 'primary'}
                size="md"
                onClick={() => setEditMode(!editMode)}
              >
                <Edit3 {...ICON_PROPS} />
                <span>{editMode ? 'Cancel' : 'Edit Prices'}</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {/* PR #39 + #107 — Model filter chips, available on SOFA / BEDFRAME /
          MATTRESS. ACCESSORY + SERVICE skip — no base_model on those rows.
          PR — Commander 2026-05-28 ("100个 model 不是排到尾巴去了吗"): when
          the Model count exceeds MODEL_PILLS_VISIBLE_LIMIT we collapse the
          extras behind a "More (N) ▼" pill that opens a searchable popover.
          The currently-selected Model is always promoted into the visible
          row so commander can see the active filter without opening the
          popover. */}
      {supportsModelFilter && categoryModels.length > 1 && (
        <ModelFilterRail
          models={categoryModels}
          activeModel={modelFilter}
          onChange={setModelFilter}
        />
      )}

      <p className={styles.eyebrow}>
        {isLoading
          ? 'Loading products…'
          : `${rows.length} products · Production configs from SKU sheet`}
      </p>

      {error && !isLoading && (
        <div className={styles.bannerWarn}>
          <strong>Failed to load products.</strong>{' '}
          {error instanceof Error ? error.message : String(error)}
          <div style={{ marginTop: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            If this keeps happening, sign out and back in — your session may
            have expired — or let IT know.
          </div>
        </div>
      )}

      <div className={styles.tableCard}>
        <table className={`${styles.table} ${styles.tableCompact}`}>
          <thead>
            <tr>
              {/* PR #82 — leading select-all checkbox. Indeterminate when
                  partial selection on visible rows. Only admin (canEdit)
                  sees the bulk-delete checkbox column. */}
              {canEdit && (
                <th style={{ width: 32 }}>
                  <input
                    type="checkbox"
                    aria-label="Select all visible SKUs"
                    checked={allSelected}
                    ref={(el) => { if (el) el.indeterminate = someSelected; }}
                    onChange={toggleAllVisible}
                    style={{ cursor: 'pointer' }}
                  />
                </th>
              )}
              <th>Product Code</th>
              <th>Description</th>
              {isSofaView ? (
                <>
                  <th>Model</th>
                  {sofaSizes.map((s) => (
                    <th key={s} style={{ textAlign: 'right' }}>{s}</th>
                  ))}
                </>
              ) : isMattressView ? (
                <>
                  <th>Branding</th>
                  <th>Size</th>
                  <th style={{ textAlign: 'right' }}>Price</th>
                  <th style={{ textAlign: 'right' }}>PWP Price</th>
                </>
              ) : (
                <>
                  <th>Category</th>
                  <th>Size</th>
                  <th style={{ textAlign: 'right' }}>Base Price</th>
                  <th style={{ textAlign: 'right' }}>PWP Price</th>
                </>
              )}
              <th style={{ textAlign: 'right' }}>Unit (m³)</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={colCount} style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: 'var(--space-7)' }}>
                  Loading products…
                </td>
              </tr>
            )}
            {!isLoading && rows.map((row) => (
              <ProductRow
                key={row.id}
                row={row}
                editMode={editMode}
                isSofaView={isSofaView}
                isMattressView={isMattressView}
                sofaSizes={sofaSizes}
                /* Suppliers drawer + bulk-delete checkbox + truck icon are
                   admin-only (canEdit). sales_director / view roles see
                   selling prices but never the supplier purchase-cost data. */
                onOpenSuppliers={canEdit ? setSuppliersRow : undefined}
                onOpenGifts={canEdit ? setGiftsRow : undefined}
                showSelectCol={canEdit}
                selected={selectedIds.has(row.id)}
                onToggleSelected={() => toggleRow(row.id)}
              />
            ))}
            {!isLoading && !error && rows.length === 0 && (
              <tr>
                <td colSpan={colCount} style={{ textAlign: 'center', color: 'var(--fg-muted)', padding: 'var(--space-7)' }}>
                  <Package size={32} strokeWidth={1.5} />
                  <div style={{ marginTop: 8 }}>No products yet.</div>
                  <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                    Run the seed import if you just migrated the schema.
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
        {!isLoading && !error && (
          <div className={styles.tableFoot}>
            <span className={styles.eyebrow}>
              Record 1 of {rows.length}
            </span>
            <span className={styles.eyebrow}>{rows.length} total products</span>
          </div>
        )}
      </div>

      {newSkuOpen && <NewSkuDrawer onClose={() => setNewSkuOpen(false)} />}
      {/* New Model dialog + Import deferred from the POS port — they pull in
          the supplier multi-picker + CSV parser dependency trees that aren't
          worth duplicating on the tablet side. sales_director can still
          create new Models / import SKUs from the Backend portal. The
          New SKU + Import buttons are also hidden on POS, so these states
          only ever flip via legacy refs (defense-in-depth). */}
      {newModelOpen && (
        <ScopeDeferredNotice
          title="New Model from POS — open Backend"
          onClose={() => setNewModelOpen(false)}
        />
      )}
      {suppliersRow && <ProductSuppliersDrawer row={suppliersRow} onClose={() => setSuppliersRow(null)} />}
      {giftsRow && <ProductGiftsDrawer row={giftsRow} onClose={() => setGiftsRow(null)} />}
      {importing && (
        <ScopeDeferredNotice
          title="Import SKUs from POS — open Backend"
          onClose={() => setImporting(false)}
        />
      )}
    </>
  );
};

const ProductRow = ({
  row, editMode, isSofaView, isMattressView, sofaSizes, onOpenSuppliers, onOpenGifts,
  showSelectCol = true, selected, onToggleSelected,
}: {
  row: MfgProductRow;
  editMode: boolean;
  isSofaView: boolean;
  isMattressView: boolean;
  sofaSizes: string[];
  onOpenSuppliers?: (row: MfgProductRow) => void;
  /** D7 (Phase 3) — open the free-gifts editor for this SKU (full mode only). */
  onOpenGifts?: (row: MfgProductRow) => void;
  /** Render the leading select checkbox column (admin/full mode only).
      add-only + view tiers don't have a bulk-delete affordance so the
      column is suppressed entirely. */
  showSelectCol?:   boolean;
  /** PR #82 — multi-select state lives on SkuMasterTab; row just renders
      the checkbox + reports clicks. */
  selected:         boolean;
  onToggleSelected: () => void;
}) => {
  // Per-SKU catalog visibility is no longer toggled here — it follows the
  // Master Admin's Modular ON/OFF (allowed_options), which the server mirrors
  // onto pos_active (Chairman 2026-06-01). The standalone "Visible" toggle was
  // removed so Modular is the single source of truth.
  // Local draft of the seat_height_prices array — buffers user edits before
  // committing on blur. Reset whenever the row's data changes upstream.
  const [draftSeat, setDraftSeat] = useState<SeatHeightPrice[] | null>(null);
  const [draftSell, setDraftSell] = useState<number | null>(null);
  const [draftPwp, setDraftPwp] = useState<number | null>(null);
  const [draftBranding, setDraftBranding] = useState<string | null>(null);
  const update = useUpdateMfgProductPrices();

  // The effective array we read from — draft if mid-edit, else the server row.
  const seatArr = draftSeat ?? row.seat_height_prices ?? [];

  // POS writes the buyer SELLING price at the default (P1) tier, preserving any
  // Backend-owned cost on the entry (Chairman 2026-06-01: run at P1).
  const updateSofaCell = (size: string, newSellingSen: number | null) => {
    const next = upsertHeightTierSelling(seatArr, size, SOFA_SELL_TIER, newSellingSen);
    setDraftSeat(next);
    update.mutate({ id: row.id, seatHeightPrices: next });
  };

  // SELLING price (sell_price_sen). The mattress + base-price cells write this;
  // base_price_sen / price1_sen are COST and not editable from the POS side.
  const flushSellPrice = (val: number | null) => {
    update.mutate({ id: row.id, sellPriceSen: val });
  };

  // PWP (换购) SELLING base price (0128). Parallel to sell price; mattress +
  // bedframe only (sofa column reserved/unused). NOT NULL column → cleared = 0.
  const flushPwpPrice = (val: number | null) => {
    update.mutate({ id: row.id, pwpPriceSen: val ?? 0 });
  };

  return (
    <tr
      className={styles.rowCompact}
      onDoubleClick={() => !editMode && onOpenSuppliers?.(row)}
      title={editMode
        ? 'Click the truck icon to see suppliers (double-click is disabled in Edit Prices mode)'
        : 'Double-click row — or click the truck icon — to see suppliers for this product'}
      style={{ cursor: editMode ? 'default' : 'pointer' }}
    >
      {/* PR #82 — row checkbox. stopPropagation so clicking the box
          doesn't bubble into the double-click "open suppliers" handler.
          Hidden entirely in add-only / view modes (no bulk delete there). */}
      {showSelectCol && (
        <td style={{ width: 32 }} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
          <input
            type="checkbox"
            aria-label={`Select ${row.code}`}
            checked={selected}
            onChange={onToggleSelected}
            style={{ cursor: 'pointer' }}
          />
        </td>
      )}
      {/* PR #89 — click code chip to edit.
          PR #95 — Commander 2026-05-26: "容易不小心点到 Edit，你应该点 Edit
          Price 那边就可以进来修改了". Gate click-to-edit behind editMode so
          the chip is read-only until commander explicitly hits "Edit Prices".
          When editMode is off the cell stops bubble propagation but stays
          a plain text/chip, so accidental clicks during row drilldown can't
          drop into the input.
          PR — Commander 2026-05-28 ("双击点不进去，看得到里面的 supplier
          是谁"): add an explicit Truck icon next to the code chip that ALWAYS
          opens the Suppliers drawer (including during edit-mode where the
          row-level double-click is intentionally disabled). */}
      <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          {/* POS port: Truck icon only renders when supplier drawer is wired
              (i.e. NOT readonly). Sales side doesn't see purchase-cost data. */}
          {onOpenSuppliers && (
          <button
            type="button"
            aria-label={`View suppliers for ${row.code}`}
            title="View suppliers carrying this SKU"
            onClick={() => onOpenSuppliers?.(row)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              color: 'var(--fg-muted)',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <Truck size={13} strokeWidth={1.75} />
          </button>
          )}
          {onOpenGifts && (
          <button
            type="button"
            aria-label={`Edit free gifts for ${row.code}`}
            title="Free gifts included with this SKU"
            onClick={() => onOpenGifts?.(row)}
            style={{
              background: 'transparent',
              border: 'none',
              padding: 0,
              margin: 0,
              cursor: 'pointer',
              color: (row.included_addons?.length ?? 0) > 0 ? 'var(--c-orange)' : 'var(--fg-muted)',
              display: 'inline-flex',
              alignItems: 'center',
            }}
          >
            <Gift size={13} strokeWidth={1.75} />
          </button>
          )}
          <EditableTextCell
            value={row.code}
            chipClassName={styles.codeChip}
            ariaLabel="Edit product code"
            editable={editMode}
            onSave={(val) => update.mutate({ id: row.id, code: val })}
          />
        </span>
      </td>
      {/* PR #89 — click description to edit. Description stored in the
          `name` column on mfg_products (commander calls it "description"
          in the UI). */}
      <td onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
        <EditableTextCell
          value={row.name}
          chipClassName={styles.nameCompact}
          inline
          ariaLabel="Edit description"
          editable={editMode}
          onSave={(val) => update.mutate({ id: row.id, name: val })}
        />
        {row.description && <div className={styles.nameSubCompact}>{row.description}</div>}
      </td>
      {isSofaView ? (
        <>
          <td className={styles.numCellMuted} style={{ textAlign: 'left' }}>
            {row.base_model ?? '—'}
          </td>
          {sofaSizes.map((s) => {
            // Buyer SELLING price at the default (P1) tier — what the POS grid
            // authors and the configurator/server charge (Chairman 2026-06-01).
            const sen = sellingForHeightTier(seatArr, s, SOFA_SELL_TIER);
            return (
              <td key={s} className={sen ? styles.price : styles.priceEmpty}>
                {editMode ? (
                  <PriceInput
                    valueSen={sen}
                    onCommit={(v) => updateSofaCell(s, v)}
                  />
                ) : (
                  fmtRm(sen)
                )}
              </td>
            );
          })}
        </>
      ) : isMattressView ? (
        <>
          {/* Branding cell — editable text input in edit mode. */}
          <td>
            {editMode ? (
              <BrandingInput
                value={draftBranding ?? row.branding ?? ''}
                onCommit={(v) => {
                  setDraftBranding(v);
                  update.mutate({ id: row.id, branding: v });
                }}
              />
            ) : (
              row.branding
                ? <span className={styles.catPill}>{row.branding}</span>
                : <span className={styles.priceEmpty}>—</span>
            )}
          </td>
          <td>{row.size_label ?? '—'}</td>
          {/* Single Price column for mattress — SELLING (sell_price_sen).
              0109 split: base_price_sen is COST; this editor writes the
              customer-facing selling price. Display falls back to base_price_sen
              only until the first sell edit (matches the POS catalog read). */}
          <td className={(draftSell ?? row.sell_price_sen ?? row.base_price_sen) ? styles.price : styles.priceEmpty}>
            {editMode ? (
              <PriceInput
                valueSen={draftSell ?? row.sell_price_sen ?? row.base_price_sen}
                onCommit={(v) => {
                  setDraftSell(v);
                  flushSellPrice(v);
                }}
              />
            ) : (
              fmtRm(row.sell_price_sen ?? row.base_price_sen)
            )}
          </td>
          {/* PWP (换购) price — selling-side, parallel to the price above.
              0 = not set → shows "—". NOT NULL column so cleared commits 0. */}
          <td className={(draftPwp ?? row.pwp_price_sen) ? styles.price : styles.priceEmpty}>
            {editMode ? (
              <PriceInput
                valueSen={draftPwp ?? (row.pwp_price_sen || null)}
                onCommit={(v) => {
                  setDraftPwp(v);
                  flushPwpPrice(v);
                }}
              />
            ) : (
              row.pwp_price_sen ? fmtRm(row.pwp_price_sen) : '—'
            )}
          </td>
        </>
      ) : (
        <>
          <td><span className={styles.catPill}>{row.category}</span></td>
          <td>{row.size_label ?? '—'}</td>
          {/* "Price 2" column for bedframe/accessory/service — SELLING
              (sell_price_sen). base_price_sen is COST (0109 split); display
              falls back to it until the first sell edit. */}
          <td className={(draftSell ?? row.sell_price_sen ?? row.base_price_sen) ? styles.price : styles.priceEmpty}>
            {editMode ? (
              <PriceInput
                valueSen={draftSell ?? row.sell_price_sen ?? row.base_price_sen}
                onCommit={(v) => {
                  setDraftSell(v);
                  flushSellPrice(v);
                }}
              />
            ) : (
              fmtRm(row.sell_price_sen ?? row.base_price_sen)
            )}
          </td>
          {/* PWP (换购) price — selling-side, parallel to Base Price. 0 = not
              set → shows "—". NOT NULL column so cleared commits 0. */}
          <td className={(draftPwp ?? row.pwp_price_sen) ? styles.price : styles.priceEmpty}>
            {editMode ? (
              <PriceInput
                valueSen={draftPwp ?? (row.pwp_price_sen || null)}
                onCommit={(v) => {
                  setDraftPwp(v);
                  flushPwpPrice(v);
                }}
              />
            ) : (
              row.pwp_price_sen ? fmtRm(row.pwp_price_sen) : '—'
            )}
          </td>
        </>
      )}
      <td className={styles.numCell}>{fmtUnit(row.unit_m3_milli)}</td>
    </tr>
  );
};

/* Free-text branding input for Mattress rows. Commits on blur or Enter. */
const BrandingInput = ({
  value,
  onCommit,
}: {
  value: string;
  onCommit: (v: string | null) => void;
}) => {
  const [local, setLocal] = useState<string>(value);
  const commit = () => {
    const t = local.trim();
    if (t === value.trim()) return;
    onCommit(t.length ? t : null);
  };
  return (
    <input
      type="text"
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      placeholder="e.g. Sealy"
      style={{
        width: 140,
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--fs-13)',
        background: 'var(--c-cream)',
        border: '1px solid var(--c-orange)',
        borderRadius: 'var(--radius-sm)',
        padding: '3px 8px',
        outline: 'none',
      }}
    />
  );
};

/* Compact RM input — accepts blank (= clear). Commits on blur or Enter. */
const PriceInput = ({
  valueSen,
  onCommit,
  baselineSen,
}: {
  valueSen: number | null;
  onCommit: (v: number | null) => void;
  /** P2-tier baseline to surface as placeholder when P1/P3 cell is empty —
      shows what the default price would be so user knows the reference. */
  baselineSen?: number | null;
}) => {
  const [local, setLocal] = useState<string>(
    valueSen == null ? '' : (valueSen / 100).toFixed(2),
  );

  const commit = () => {
    const trimmed = local.trim();
    if (trimmed === '') {
      onCommit(null);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) return;
    onCommit(Math.round(parsed * 100));
  };

  const placeholder = baselineSen && baselineSen > 0
    ? `P2: ${(baselineSen / 100).toFixed(2)}`
    : undefined;

  return (
    <input
      type="number"
      step="0.01"
      value={local}
      placeholder={placeholder}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      style={{
        width: 84,
        textAlign: 'right',
        fontFamily: 'var(--font-mono)',
        fontSize: 'var(--fs-13)',
        background: 'var(--c-cream)',
        border: '1px solid var(--c-orange)',
        borderRadius: 'var(--radius-sm)',
        padding: '3px 6px',
        outline: 'none',
      }}
    />
  );
};

const CategoryChip = ({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) => (
  <button
    type="button"
    onClick={onClick}
    style={{
      fontFamily: 'var(--font-button)',
      fontSize: 'var(--fs-13)',
      fontWeight: 600,
      letterSpacing: '0.02em',
      padding: 'var(--space-2) var(--space-4)',
      borderRadius: 'var(--radius-pill)',
      border: active ? '1px solid var(--c-ink)' : '1px solid var(--line)',
      background: active ? 'var(--c-ink)' : 'var(--c-paper)',
      color: active ? 'var(--c-cream)' : 'var(--c-ink)',
      cursor: 'pointer',
      transition: 'all 200ms cubic-bezier(0.22, 1, 0.36, 1)',
    }}
  >
    {children}
  </button>
);

/* ════════════════════════════════════════════════════════════════════════
   ModelFilterRail — visible pills + "More (N) ▼" popover with search.

   PR — Commander 2026-05-28 ("100个 model 不是排到尾巴去了吗"). At 4 Models
   the row reads fine. At 100 the pills overflow horizontally off the page.
   This wrapper keeps the first MODEL_PILLS_VISIBLE_LIMIT pills inline; the
   rest hide behind a popover with a search input + scrolling list. The
   active Model is always promoted into the visible row so commander can
   see what's filtering without opening the popover.

   Implementation notes:
     - Click-outside closes the popover (mousedown listener on document).
     - Esc also closes; search input autofocuses on open.
     - No portal — popover positions absolutely under the "More" pill via
       the wrapper's `position: relative`. Good enough at this density.
   ════════════════════════════════════════════════════════════════════════ */

const MODEL_PILLS_VISIBLE_LIMIT = 12;

const ModelFilterRail = ({
  models,
  activeModel,
  onChange,
}: {
  models: string[];
  activeModel: string;
  onChange: (m: string) => void;
}) => {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const wrapperRef = useRef<HTMLDivElement | null>(null);

  // Decide which pills go inline vs into the "More" popover. The active
  // Model (non-"all") is always promoted into the inline set.
  const { inline, overflow } = useMemo(() => {
    if (models.length <= MODEL_PILLS_VISIBLE_LIMIT) {
      return { inline: models, overflow: [] as string[] };
    }
    const head = models.slice(0, MODEL_PILLS_VISIBLE_LIMIT);
    const tail = models.slice(MODEL_PILLS_VISIBLE_LIMIT);
    if (activeModel !== 'all' && tail.includes(activeModel)) {
      // Promote the active model into the visible row — swap with the last
      // inline pill so the inline count stays stable.
      const promoted = [...head.slice(0, -1), activeModel];
      const demoted = [head[head.length - 1]!, ...tail.filter((m) => m !== activeModel)];
      return { inline: promoted, overflow: demoted };
    }
    return { inline: head, overflow: tail };
  }, [models, activeModel]);

  // Close popover on click outside + Esc.
  useEffect(() => {
    if (!open) return;
    const onDocMouseDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (e.target instanceof Node && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDocMouseDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocMouseDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const filteredOverflow = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return overflow;
    return overflow.filter((m) => m.toLowerCase().includes(q));
  }, [overflow, search]);

  return (
    <div
      ref={wrapperRef}
      className={styles.categoryChips}
      style={{
        marginTop: 'var(--space-2)',
        flexWrap: 'wrap',
        position: 'relative',
        rowGap: 'var(--space-2)',
      }}
    >
      <CategoryChip
        active={activeModel === 'all'}
        onClick={() => onChange('all')}
      >
        All Models
      </CategoryChip>
      {inline.map((m) => (
        <CategoryChip
          key={m}
          active={activeModel === m}
          onClick={() => onChange(m)}
        >
          {m}
        </CategoryChip>
      ))}
      {overflow.length > 0 && (
        <>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-haspopup="listbox"
            style={{
              fontFamily: 'var(--font-button)',
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              letterSpacing: '0.02em',
              padding: 'var(--space-2) var(--space-3)',
              borderRadius: 'var(--radius-pill)',
              border: '1px solid var(--line)',
              background: 'var(--c-paper)',
              color: 'var(--c-ink)',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <span>More ({overflow.length})</span>
            <ChevronDown size={12} strokeWidth={1.75} />
          </button>
          {open && (
            <div
              role="listbox"
              style={{
                position: 'absolute',
                top: 'calc(100% + 4px)',
                right: 0,
                zIndex: 50,
                width: 280,
                maxHeight: 360,
                display: 'flex',
                flexDirection: 'column',
                background: 'var(--c-paper)',
                border: '1px solid var(--line-strong)',
                borderRadius: 'var(--radius-md)',
                boxShadow: 'var(--shadow-2)',
                padding: 'var(--space-2)',
              }}
            >
              <input
                autoFocus
                type="search"
                value={search}
                placeholder="Search models…"
                onChange={(e) => setSearch(e.target.value)}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-13)',
                  background: 'var(--c-cream)',
                  border: '1px solid var(--line)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  outline: 'none',
                  marginBottom: 'var(--space-2)',
                }}
              />
              <div style={{ overflowY: 'auto', flex: 1 }}>
                {filteredOverflow.length === 0 && (
                  <p style={{
                    fontSize: 'var(--fs-12)',
                    color: 'var(--fg-muted)',
                    padding: 'var(--space-2)',
                    textAlign: 'center',
                  }}>
                    No models match “{search}”.
                  </p>
                )}
                {filteredOverflow.map((m) => (
                  <button
                    key={m}
                    type="button"
                    role="option"
                    aria-selected={activeModel === m}
                    onClick={() => {
                      onChange(m);
                      setOpen(false);
                      setSearch('');
                    }}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--fs-13)',
                      padding: '4px var(--space-2)',
                      background: activeModel === m ? 'var(--c-cream)' : 'transparent',
                      border: 'none',
                      borderRadius: 'var(--radius-sm)',
                      color: 'var(--c-ink)',
                      cursor: 'pointer',
                    }}
                  >
                    {m}
                  </button>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Maintenance tab
   ════════════════════════════════════════════════════════════════════════ */

type MaintenanceListKey =
  | 'bedframeSizes'    // PR #50 — Bedframe size pool (K/Q/S/SS/SK/SP)
  | 'divanHeights'
  | 'totalHeights'
  | 'gaps'
  | 'legHeights'
  | 'specials'
  | 'sofaCompartments' // PR #50 — Sofa compartment pool (1A(LHF), 1A(RHF), 1NA, ...)
  | 'sofaSizes'
  | 'sofaLegHeights'
  | 'sofaSpecials'
  | 'sofaQuickPresets' // PR (Commander 2026-05-28) — module-composition presets
  | 'mattressSizes'    // PR #50 — Mattress size pool (K/Q/S/SS)
  | 'brandings'        // Branding pool (HILTON/SEALY/2990S/...) — mirror of Backend pool
  | 'supplierCategories' // Supply Category pool — mirror of Backend pool (parity)
  | 'fabrics'
  | 'fabricPricing'    // migration 0124 — POS selling fabric-tier add-on editor
  | 'productAddons'    // migration 0134 — Special Add-ons (Product) manager
  | 'orderAddons';     // order-level add-ons (Dispose/Lift) — editor moved from Backend

// PR #208 — exported so SupplierDetail can pass a `sectionFilter` prop to
// the reused MaintenanceTab.
export type MaintenanceSection = 'Bedframe' | 'Sofa' | 'Common' | 'Products Maintenance' | 'Product Add-ons' | 'Order Add-ons';

const MAINTENANCE_TABS: {
  key: MaintenanceListKey;
  label: string;
  description: string;
  priced: boolean;
  section: MaintenanceSection;
}[] = [
  // ── Bedframe (commander-edited variant pools) ───────────────────────────
  { key: 'divanHeights', label: 'Divan Heights', description: 'Bedframe divan height options with surcharge pricing', priced: true, section: 'Bedframe' },
  { key: 'totalHeights', label: 'Total Heights', description: 'Total height (Divan + Gap + Leg) surcharge pricing', priced: true, section: 'Bedframe' },
  { key: 'gaps', label: 'Gaps', description: 'Bedframe gap height options (inches)', priced: false, section: 'Bedframe' },
  { key: 'legHeights', label: 'Leg Heights', description: 'Bedframe leg height options with surcharge pricing', priced: true, section: 'Bedframe' },
  // NOTE (Special Add-ons reorg, 2026-06-02): the old flat 'specials' /
  // 'sofaSpecials' editor entries + 'sofaQuickPresets' are intentionally NOT
  // listed here anymore. Bedframe/Sofa specials are taken over by the new
  // Product Add-ons manager (section below, migration 0134); Quick Presets was
  // retired (Chairman). Their MaintenanceListKey union members + the underlying
  // maintenance_config data are kept so the Modular allowed-options drawer and
  // the server price source keep working until PR-3 switches the source.

  // ── Sofa (commander-edited variant pools) ───────────────────────────────
  { key: 'sofaSizes', label: 'Sizes', description: 'Available sofa seat height sizes (inches)', priced: false, section: 'Sofa' },
  { key: 'sofaLegHeights', label: 'Leg Heights', description: 'Sofa leg height options with surcharge pricing', priced: true, section: 'Sofa' },

  // ── Product Add-ons (Special Add-ons tab, migration 0134) ───────────────
  // The grown-up "Specials": per-Model product add-on with a selling surcharge
  // + 0..N follow-up choice groups, shown as an SO line description (not a SKU).
  // Edits the special_addons table via /special-addons (own panel below).
  { key: 'productAddons', label: 'Product Add-ons', description: 'Per-Model add-ons (e.g. Right Drawer → 10″/8″) priced on top of the product, shown as an SO description. Not a SKU.', priced: false, section: 'Product Add-ons' },

  // ── Order Add-ons (whole-order one-time fees; editor moved from Backend) ──
  // Dispose old mattress/bedframe, Lift access. Picked at checkout (handover),
  // not bound to a Model. Edits the `addons` table directly (RLS admin write).
  { key: 'orderAddons', label: 'Order Add-ons', description: 'Whole-order one-time fees (Dispose old mattress/bedframe, Lift access). Picked at checkout, not bound to a Model.', priced: false, section: 'Order Add-ons' },

  // ── Common (cross-category single pool) ─────────────────────────────────
  { key: 'fabrics', label: 'Fabrics', description: 'Procurement fabric tiers (cost side, read-only reference).', priced: false, section: 'Common' },
  { key: 'fabricPricing', label: 'Fabric Pricing', description: 'POS selling fabric-tier add-on — set the +RM for Price 2 / Price 3 (sofa & bedframe) and assign each fabric its tier.', priced: false, section: 'Common' },

  // ── Products Maintenance (cross-category, drives Model "+ Add Codes") ──
  // PR #74 (Commander 2026-05-26): bedframeSizes / mattressSizes / sofaCompartments
  // live here because they're shared by multiple Models and back the bulk
  // SKU generator — they're conceptually "Products Maintenance" rather than
  // per-category variant config.
  { key: 'bedframeSizes',    label: 'Bedframe Sizes',    description: 'Bedframe sizes — edit code · label · dimensions (e.g. K · 6FT · 183X190CM). Used in generated SKU names.', priced: false, section: 'Products Maintenance' },
  { key: 'mattressSizes',    label: 'Mattress Sizes',    description: 'Mattress sizes — edit code · label · dimensions. Used in generated SKU names + width/length placeholders.', priced: false, section: 'Products Maintenance' },
  { key: 'sofaCompartments', label: 'Sofa Compartments', description: 'Sofa compartment pool (1A(LHF), 1A(RHF), 1NA, 2A(LHF), ...). Models tick which they offer.', priced: false, section: 'Products Maintenance' },
  // Brandings + Supplier Categories — mirror of the Backend Products Maintenance
  // group (owner spec 2026-06-12). Same maintenance_config blob, rendered here
  // as plain string pools so the POS Maintenance tab matches Backend's rail.
  { key: 'brandings',        label: 'Brandings',         description: 'Branding pool (e.g. HILTON, SEALY, 2990S). Feeds every Branding input — New SKU, bulk New Models rows, SKU Master inline edit, Model detail.', priced: false, section: 'Products Maintenance' },
  { key: 'supplierCategories', label: 'Supplier Categories', description: 'Supply Category pool (e.g. Sofa, Bedframe, Mattress). Feeds the Suppliers list filter chips + the supplier form’s Supply Category toggles. Empty = default five (Sofa / Bedframe / Mattress / Accessory / Service).', priced: false, section: 'Products Maintenance' },
];

/**
 * Maintenance tab.
 *
 * PR #208 (Commander 2026-05-27) — exported + parameterised so SupplierDetail
 * can mount the same UI scoped to a specific supplier. Defaults preserve
 * the original Products-page behaviour: scope='master' and every section
 * is visible.
 *
 *   scope          — maintenance_config_history.scope to read + write.
 *   sectionFilter  — optional allow-list of MaintenanceSection labels. Omit
 *                    to show every section.
 *   emptyHint      — optional message rendered when this scope has no row
 *                    yet AND the master fallback also has none. Supplier
 *                    Detail uses this to nudge "Click Edit to seed".
 */
export const MaintenanceTab = ({
  scope = 'master',
  sectionFilter,
  emptyHint,
  readonly,
  mode,
}: {
  scope?: string;
  sectionFilter?: MaintenanceSection[];
  emptyHint?: ReactNode;
  /** Legacy boolean — `readonly: true` hides every write affordance.
      Prefer `mode` for the three-tier gate. */
  readonly?: boolean;
  /** Three-tier role gate (commander 2026-05-28 tightening). Overrides
      `readonly` when both are supplied. */
  mode?: ProductsMode;
} = {}) => {
  /* Resolve effective mode. If caller supplied `mode`, use it. Otherwise
     fall back to the legacy boolean (readonly=true → 'view', else 'full'). */
  const effectiveMode: ProductsMode =
    mode ?? (readonly ? 'view' : 'full');
  const canAdd  = effectiveMode !== 'view';
  const canEdit = effectiveMode === 'full';
  const resolved = useMaintenanceConfig(scope);
  const history = useMaintenanceConfigHistory(scope);
  const save = useSaveMaintenanceConfig();
  const renameCompartment = useRenameSofaCompartment();

  // Brandings empty-state suggestions — mirror of the Backend useBrandingPool
  // `distinct`: DISTINCT non-null branding across mfg_products + product_models
  // (case-insensitive dedupe, first-seen casing wins, A→Z). Shown read-only when
  // the Brandings pool is empty (parity with Backend) and one-click seeded into
  // the Edit draft (startEdit) so a single admin Save adopts them. The pool is
  // never written without an explicit Save.
  const brandingProducts = useMfgProducts();
  const brandingModels = useProductModels();
  const brandingDistinct = useMemo(() => {
    const seen = new Map<string, string>(); // UPPER → first-seen original casing
    const collect = (b: string | null | undefined) => {
      const t = (b ?? '').trim();
      if (!t) return;
      const k = t.toUpperCase();
      if (!seen.has(k)) seen.set(k, t);
    };
    for (const p of brandingProducts.data ?? []) collect(p.branding);
    for (const m of brandingModels.data ?? []) collect(m.branding);
    return Array.from(seen.values()).sort((a, b) => a.localeCompare(b));
  }, [brandingProducts.data, brandingModels.data]);

  // PR #208 — when the supplier scope has no row yet, fall through to the
  // master config so commander can see what's there before deciding to
  // override. Save still writes back to the prop scope, never to master —
  // the fallback never silently mutates the global config.
  const masterFallback = useMaintenanceConfig('master', {
    enabled: scope !== 'master' && !resolved.data?.data && !resolved.isLoading,
  });

  // PR #208 — sectionFilter restricts which sections show on the left rail.
  // BEDFRAME-only supplier hides Sofa sub-tabs entirely so commander only
  // edits surcharges that actually apply to what this supplier supplies.
  const allSections: MaintenanceSection[] = ['Bedframe', 'Sofa', 'Product Add-ons', 'Order Add-ons', 'Common', 'Products Maintenance'];
  const sections: MaintenanceSection[] = sectionFilter ?? allSections;
  const visibleTabs = useMemo(
    () => MAINTENANCE_TABS.filter((t) => sections.includes(t.section)),
    [sections],
  );

  // First visible tab — the section filter may have hidden 'divanHeights'.
  const defaultActiveKey: MaintenanceListKey = visibleTabs[0]?.key ?? 'divanHeights';

  const [activeKey, setActiveKey] = useState<MaintenanceListKey>(defaultActiveKey);

  // Keep activeKey valid when the section filter changes (e.g. supplier
  // category switched). Pin to the first visible tab if the current one
  // got filtered out.
  useEffect(() => {
    if (!visibleTabs.find((t) => t.key === activeKey)) {
      setActiveKey(defaultActiveKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabs]);

  const [editModeRaw, setEditMode] = useState(false);
  /* Only canEdit (admin in POS, or readonly=false on Backend) can flip
     edit mode on. add-only + view tiers hard-clamp it off. */
  const editMode = canEdit ? editModeRaw : false;
  const [draft, setDraft] = useState<MaintenanceConfig | null>(null);
  const [showMaintHistory, setShowMaintHistory] = useState(false);

  // Count fabric_trackings rows for the left-rail "Fabrics (N)" badge.
  // Lightweight query (cached 30s) — uses the same hook as the panel itself.
  const fabricsList = useFabricTrackings();
  const fabricsCount = fabricsList.data?.length ?? 0;

  // PR #208 — draft beats supplier-scope-resolved beats master-fallback.
  // Any of those three can be null (commander hasn't seeded yet).
  const config =
    draft ?? resolved.data?.data ?? masterFallback.data?.data ?? null;
  const active = MAINTENANCE_TABS.find((t) => t.key === activeKey) ?? visibleTabs[0];

  const startEdit = () => {
    // Seed the draft from whichever config we're currently showing — could
    // be the supplier-scope row or the master fallback. Either way commander
    // edits a copy; save writes back to `scope`.
    const seed = resolved.data?.data ?? masterFallback.data?.data ?? null;
    if (!seed) return;
    const copy = JSON.parse(JSON.stringify(seed)) as MaintenanceConfig;
    // Brandings one-click seed — mirror of Backend: when the master pool is
    // empty, pre-fill the EDIT DRAFT from the DISTINCT branding values so a
    // single Save adopts them. Editor-only; config is never written until the
    // explicit Save. Master scope only (supplier scopes never author brandings).
    if (
      scope === 'master'
      && maintValues(copy.brandings).filter((b) => b.trim().length > 0).length === 0
      && brandingDistinct.length > 0
    ) {
      copy.brandings = [...brandingDistinct];
    }
    setDraft(copy);
    setEditMode(true);
  };

  const cancelEdit = () => {
    setDraft(null);
    setEditMode(false);
  };

  const handleSave = async () => {
    if (!draft) return;
    const effectiveFrom = window.prompt('Effective from (YYYY-MM-DD)?', new Date().toISOString().slice(0, 10));
    if (!effectiveFrom) return;
    // Maintenance-is-master cascade (Loo 2026-06-04: "what maintenance change
    // all will follow"). Detect in-place compartment code RENAMES (same row,
    // new text, old code gone from the list, new code not previously there)
    // and run the atomic cascade BEFORE appending the new config row, so the
    // SKU master, every doc snapshot, Modular ticks, combos and quick picks
    // all carry the new name the moment the save lands. Master scope only —
    // supplier scopes are surcharge overlays, never the code authority.
    if (scope === 'master') {
      // ACTIVE toggles — entries may be { value, active } objects; the rename
      // cascade compares VALUES only (an active flip is not a rename).
      const baseline = maintValues(
        resolved.data?.data?.sofaCompartments ?? masterFallback.data?.data?.sofaCompartments,
      );
      const next = maintValues(draft.sofaCompartments);
      const renames: Array<{ from: string; to: string }> = [];
      const len = Math.min(baseline.length, next.length);
      for (let i = 0; i < len; i++) {
        const from = (baseline[i] ?? '').trim();
        const to = (next[i] ?? '').trim();
        if (!from || !to || from === to) continue;
        if (!next.includes(from) && !baseline.includes(to)) renames.push({ from, to });
      }
      if (renames.length > 0) {
        const summary = renames.map((r) => `${r.from} → ${r.to}`).join('\n');
        // eslint-disable-next-line no-alert
        const ok = confirm(
          `Rename compartment code${renames.length > 1 ? 's' : ''}?\n\n${summary}\n\n` +
          `This cascades EVERYWHERE: SKU codes + names, sales orders (incl. history), ` +
          `delivery orders, invoices, GRN/PO lines, Modular ticks, Combos and Quick Picks.`,
        );
        if (!ok) return;
        for (const r of renames) {
          try {
            await renameCompartment.mutateAsync(r);
          } catch (e) {
            // eslint-disable-next-line no-alert
            alert(`Rename ${r.from} → ${r.to} failed: ${e instanceof Error ? e.message : String(e)}\nNothing was partially renamed for this pair; fix and retry.`);
            return;
          }
        }
      }
    }
    // PR #208 — write back to the same scope this tab was mounted with.
    // Supplier scope (e.g. 'supplier:abc-123') gets its own append-only row;
    // master scope is unchanged for the SO / selling-price flow.
    save.mutate(
      { scope, config: draft, effectiveFrom },
      {
        onSuccess: () => {
          setDraft(null);
          setEditMode(false);
        },
      },
    );
  };

  /* Add-only quick-add path (commander 2026-05-28 tightening):
     sales_director appends one option to a list and we POST immediately.
     No draft, no Edit-Save dance, no effective-date prompt — just an
     append that lands as today's effective row. The MaintenanceList
     calls this with the post-mutation config (existing + the new item).
     Falls back to noop if there's no config to start from. */
  const handleQuickAdd = (next: MaintenanceConfig) => {
    const today = new Date().toISOString().slice(0, 10);
    save.mutate(
      { scope, config: next, effectiveFrom: today },
      {
        // Refetch will pull the new row; nothing else to reset since we
        // never entered edit mode.
      },
    );
  };

  if (resolved.isLoading) {
    return <p className={styles.eyebrow}>Loading maintenance config…</p>;
  }

  if (resolved.isError) {
    return (
      <div className={styles.bannerWarn}>
        <strong>Failed to load maintenance config.</strong>{' '}
        {resolved.error instanceof Error ? resolved.error.message : String(resolved.error)}
        <div style={{ marginTop: 6, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          The <code>maintenance_config_history</code> table likely doesn't exist
          yet. Run migration <code>0039_hookka_products_port.sql</code> against
          Supabase, then refresh.
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className={styles.bannerWarn}>
        {emptyHint ?? (
          <>
            No maintenance config baseline found. The migration ran but the master
            baseline row is missing — re-apply migration 0039 to seed it.
          </>
        )}
      </div>
    );
  }

  // active falls through to the first visible tab when the section filter
  // hides the previously-active key. Should never be null when config is set,
  // but guard anyway.
  if (!active) {
    return (
      <div className={styles.bannerWarn}>
        No maintenance sections visible for this scope.
      </div>
    );
  }

  // PR #208 — show "using fallback" hint when the supplier scope is empty
  // but the master fallback is rendering. Encourages commander to hit Edit
  // → Save which seeds this supplier's own row.
  const showingMasterFallback =
    scope !== 'master' && !resolved.data?.data && Boolean(masterFallback.data?.data);

  return (
    <div className={styles.maintLayout}>
      <aside className={styles.maintNav}>
        {sections.map((section) => (
          <div key={section}>
            <div className={styles.maintSection}>{section}</div>
            {MAINTENANCE_TABS.filter((t) => t.section === section).map((t) => {
              // productAddons is backed by the special_addons table, not the
              // maintenance_config JSON, so countItems can't see it — skip the
              // badge rather than show a misleading "(0)".
              const count = t.key === 'fabrics' ? fabricsCount
                : (t.key === 'productAddons' || t.key === 'orderAddons') ? null
                : countItems(config, t.key);
              return (
                <button
                  key={t.key}
                  type="button"
                  data-active={activeKey === t.key}
                  className={styles.maintNavItem}
                  onClick={() => setActiveKey(t.key)}
                >
                  <span>{t.label}</span>
                  {count !== null && <span className={styles.maintCount}>({count})</span>}
                </button>
              );
            })}
          </div>
        ))}
      </aside>

      <section className={styles.maintPanel}>
        <header className={styles.maintHeader}>
          <div>
            <h2 className={styles.maintTitle}>{active.label}</h2>
            <p className={styles.maintSubtitle}>{active.description}</p>
            {resolved.data?.effectiveFrom && (
              <p className={styles.stateInfo} style={{ marginTop: 8 }}>
                Effective from {resolved.data.effectiveFrom}
                {resolved.data.hasPendingPriceChange && (
                  <span style={{ color: 'var(--c-burnt)', fontWeight: 600 }}>
                    · Pending change on {resolved.data.pendingEffectiveFrom}
                  </span>
                )}
              </p>
            )}
            {showingMasterFallback && (
              <p className={styles.stateInfo} style={{ marginTop: 8, color: 'var(--c-burnt)' }}>
                No supplier-specific pricing yet — showing the master baseline.
                Hit Edit + Save to override.
              </p>
            )}
          </div>
          <div className={styles.actionsRow}>
            {/* Edit toggle is admin-only (canEdit). add-only roles add via
                the inline "+ Add new" row at the bottom of each section
                (handled inside MaintenanceList) — no Edit button surfaces
                for them. */}
            {canEdit && (!editMode ? (
              <Button variant="ghost" size="sm" onClick={startEdit}>
                <Edit3 {...ICON_PROPS} />
                <span>Edit</span>
              </Button>
            ) : (
              <>
                <Button variant="ghost" size="sm" onClick={cancelEdit}>
                  <span>Cancel</span>
                </Button>
                <Button variant="primary" size="sm" onClick={handleSave} disabled={save.isPending}>
                  <span>{save.isPending ? 'Saving…' : 'Save'}</span>
                </Button>
              </>
            ))}
            <Button variant="ghost" size="sm" onClick={() => setShowMaintHistory(true)}>
              <History {...ICON_PROPS} />
              <span>History</span>
            </Button>
          </div>
        </header>

        <MaintenanceList
          listKey={active.key}
          config={config}
          editMode={editMode}
          /* add-only mode: render the bottom "+ Add new" row even when
             editMode is false, and commit each add immediately via the
             quick-add path. Hides all per-row edit/delete affordances
             so sales_director can append-but-not-modify. */
          addOnly={!canEdit && canAdd}
          onChange={(next) => setDraft(next)}
          onQuickAdd={handleQuickAdd}
          priced={active.priced}
          /* Brandings empty-state DISTINCT suggestions (parity with Backend);
             only consumed by the 'brandings' string-pool branch. */
          brandingSuggestions={brandingDistinct}
        />
      </section>

      {showMaintHistory && (
        <MaintenanceHistoryDialog
          activeLabel={active.label}
          activeKey={activeKey}
          history={history.data?.history ?? []}
          onClose={() => setShowMaintHistory(false)}
        />
      )}
    </div>
  );
};

const countItems = (cfg: MaintenanceConfig, key: MaintenanceListKey): number => {
  if (key === 'fabrics') return 0; // populated from fabric_trackings, not the JSON blob
  // Quick Presets falls back to DEFAULT_SOFA_QUICK_PRESETS when the
  // maintenance row hasn't been migrated yet — show the resolved count
  // so the left-rail badge isn't misleadingly "0".
  if (key === 'sofaQuickPresets') {
    return resolveSofaQuickPresets(cfg.sofaQuickPresets).length;
  }
  // PR #74 — Code Format tabs removed (Commander 2026-05-26: preset only,
  // not commander-editable). The cfg.{category}CodeFormat / NameFormat
  // columns still exist on the JSONB blob but no longer surface in the UI;
  // the API falls back to its hardcoded templates when those fields are
  // empty (see apps/api/src/routes/product-models.ts §generate).
  const v = cfg[key as keyof MaintenanceConfig];
  return Array.isArray(v) ? v.length : 0;
};

/* ─── Sofa Compartments — POS module catalogue port (PR #220) ─────────
   Commander 2026-05-27: "把我在 POS System 设计好的模块放进 Maintenance Sofa
   Compartments." Each compartment row gets an image + description +
   default price. The compartment-code list (config.sofaCompartments)
   stays a `string[]` so existing readers (ProductModelDetail allowed
   options, SKU generator) keep working untouched. Per-compartment meta
   lives in a parallel `sofaCompartmentMeta` map keyed by code.

   Code-format note: SOFA_MODULES ids, the pool and the meta map all share
   the ONE canonical parens vocabulary (`1A(LHF)`, 2026-06-04).
   normalizeCompartmentCode canonicalizes a stray legacy dash entry so the
   lookup still hits. */

type CompartmentMeta = {
  imageKey?: string;
  description?: string;
  defaultPriceCenti?: number;
};

// Canonicalize any compartment input to the parens form (mirror of the
// shared normalizeCompartmentCode — kept local so this page stays light).
const normalizeCompartmentCode = (raw: string): string => {
  const dash = raw.trim().replace(/\(([^)]*)\)/g, '-$1').replace(/-+$/, '');
  const parts = dash.split('-').filter(Boolean);
  if (parts.length <= 1) return dash;
  return (parts[0] ?? '') + parts.slice(1).map((p) => `(${p})`).join('');
};

const SOFA_MODULE_BY_NORM_ID = new Map(
  SOFA_MODULES.map((m) => [normalizeCompartmentCode(m.id), m]),
);

// Commander 2026-05-27 definitive taxonomy (CORRECTED):
//
//   nS  = N seats with arms on BOTH sides (1S = 1 seat + 2 arms)
//   nA  = N seats with arm on ONE side (LHF/RHF says which side has arm)
//   nB  = N seats — the LHF/RHF side's "arm position" is a Seat Cushion
//         (bench) instead of a real arm. Commander rule: "Left 就是左边是
//         坐垫的意思" — 1B(LHF) means LEFT is bench, RIGHT has the arm.
//   nNA = N seats, NO arms
//   (P) suffix = Power Recliner (electric)
//   (R) suffix = Manual Recliner
//   CNR = Corner piece (90° L-shape connector — NOT a console)
//   WC-45 = Wood Console (45cm) — divider/storage between two seats
// Keys are the canonical parens codes (lookups go through
// normalizeCompartmentCode first, so a stray legacy dash entry still hits).
const COMPARTMENT_DESCRIPTION_OVERRIDE: Record<string, string> = {
  // ── 1-Seaters ──────────────────────────────────────────────────────
  '1S':     '1 seat, arms on BOTH sides',
  '1A(LHF)': '1 seat, ONE arm (left)',
  '1A(RHF)': '1 seat, ONE arm (right)',
  '1B(LHF)': '1 seat — LEFT is Seat Cushion (bench), no arm on the right',
  '1B(RHF)': '1 seat — RIGHT is Seat Cushion (bench), no arm on the left',
  '1NA':    '1 seat, NO arms',

  // ── 1-Seater Recliners ────────────────────────────────────────────
  // (P) = Power Recliner (electric) · (R) = Manual Recliner
  '1A(P)(LHF)': '1 seat + ONE arm (left) — Power Recliner (electric)',
  '1A(P)(RHF)': '1 seat + ONE arm (right) — Power Recliner (electric)',
  '1A(R)(LHF)': '1 seat + ONE arm (left) — Manual Recliner',
  '1A(R)(RHF)': '1 seat + ONE arm (right) — Manual Recliner',
  '1NA(P)':     '1 seat, NO arms — Power Recliner (electric)',
  '1NA(R)':     '1 seat, NO arms — Manual Recliner',
  // ── Console variants ────────────────────────────────────────────────
  // Commander 2026-05-28: "console 包布的就叫 Console；上面是木的盖那个叫
  // Console/WC". Two distinct codes with different art.
  Console:         'Console — fabric-wrapped console with cup holders',
  'Console/WC':    'Console/WC — wood lid + fabric body, with cup holders',

  // ── 2-Seaters ──────────────────────────────────────────────────────
  '2S':     '2 seats, arms on BOTH sides',
  '2A(LHF)': '2 seats, ONE arm (left)',
  '2A(RHF)': '2 seats, ONE arm (right)',
  '2B(LHF)': '2 seats — LEFT is Seat Cushion (bench), no arm on the right',
  '2B(RHF)': '2 seats — RIGHT is Seat Cushion (bench), no arm on the left',
  '2NA':    '2 seats, NO arms',

  // ── Corner + Accessories ──────────────────────────────────────────
  CNR:     'Corner piece — 90° L-shape connector',
  'WC-45': 'Console (Wood, 45cm) — divider/storage between two seats',
  STOOL:   'Ottoman / stool',
};

// Extra modules NOT in SOFA_MODULES (the Console/WC alias the POS shared
// lib doesn't model directly). Hand-mapped here so the Maintenance UI gets
// full coverage. Keys are the CANONICAL code (parens form); the value is
// the SVG filename stem under public/sofa-modules/.
const EXTRA_MODULE_IMAGE_BY_NORM: Record<string, string> = {
  // Console = fabric-wrapped (no wood lid). Console/WC = wood lid + fabric body.
  // Commander 2026-05-28 split the original "Console" into 2 codes — the
  // existing SVG (wood lid + fabric) reads as wood at a glance, so it moves
  // to Console-WC; a new fabric-only design lives at Console.
  Console:       'Console',
  // Legacy dash input 'Console-WC' canonicalizes to 'Console(WC)'.
  'Console(WC)': 'Console-WC',
  // normalizeCompartmentCode doesn't touch '/' so commander's raw "Console/WC"
  // input falls through to this key directly (not via canonicalization).
  'Console/WC':  'Console-WC',
};

// Resolve the seeded default for one compartment code. UI surfaces this
// when the stored meta has no value of its own — commander overrides
// land in sofaCompartmentMeta on Save.
const seedCompartmentMeta = (code: string): CompartmentMeta => {
  const norm = normalizeCompartmentCode(code);
  const mod  = SOFA_MODULE_BY_NORM_ID.get(norm);
  // Every sofa module now has a unified hand-drawn SVG plan view
  // (commander 2026-05-27 "你没有统一怎么行呢"). The previous mix of POS PNGs
  // + bespoke SVGs for 1B/2B/CNR was visually inconsistent at the size the
  // Maintenance list renders them — all module + preset designs were
  // redrawn to the same 3-tone flat style (cream body / medium-tan
  // backrest / darkest-tan armrest, dashed seat seams, no labels).
  if (mod) {
    return {
      imageKey:    `sofa-modules/${mod.id}.svg`,
      description: COMPARTMENT_DESCRIPTION_OVERRIDE[mod.id] ?? mod.label,
      // SOFA_MODULES carries no base price — POS reads pricing from
      // product_compartments per Model. Default to 0 here; commander can
      // type the back-office default into the input.
      defaultPriceCenti: 0,
    };
  }
  // Fallback for codes NOT in SOFA_MODULES (the Console/WC alias). These
  // have bespoke SVGs hand-drawn to the same style.
  const extraStem = EXTRA_MODULE_IMAGE_BY_NORM[code.trim()] ?? EXTRA_MODULE_IMAGE_BY_NORM[norm];
  if (extraStem) {
    const desc =
      COMPARTMENT_DESCRIPTION_OVERRIDE[code] ??
      COMPARTMENT_DESCRIPTION_OVERRIDE[norm] ??
      undefined;
    return {
      imageKey:    `sofa-modules/${extraStem}.svg`,
      description: desc,
      defaultPriceCenti: 0,
    };
  }
  return {};
};

// Merge stored override on top of the seed. Empty/undefined fields on
// the override fall back to the seed value.
const resolveCompartmentMeta = (
  code: string,
  stored: CompartmentMeta | undefined,
): CompartmentMeta => {
  const seed = seedCompartmentMeta(code);
  return {
    imageKey:          stored?.imageKey          ?? seed.imageKey,
    description:       stored?.description       ?? seed.description,
    defaultPriceCenti: stored?.defaultPriceCenti ?? seed.defaultPriceCenti,
  };
};

const formatRmFromCenti = (centi: number | undefined): string => {
  const n = centi ?? 0;
  return (n / 100).toFixed(2);
};

const parseRmToCenti = (rm: string): number => {
  const n = Number(rm);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
};

/* PR — Commander 2026-05-28: resolve the per-compartment image source.
 * Three cases:
 *   1) imageKey starts with `sofa-compartments/` — uploaded via the API.
 *      Render via the Worker proxy (`{API}/maintenance-config/sofa-compartments/{code}/photo/{key}`)
 *      so the auth-free public route streams the R2 object.
 *   2) imageKey starts with `sofa-modules/` — legacy bundled SVG, render
 *      from /public.
 *   3) imageKey is an http(s) URL — render directly. */
const SOFA_COMPARTMENT_API_PREFIX = 'sofa-compartments/';
const resolveCompartmentImageSrc = (
  code: string,
  imageKey: string | undefined,
): string | null => {
  if (!imageKey) return null;
  if (/^https?:\/\//i.test(imageKey)) return imageKey;
  if (imageKey.startsWith(SOFA_COMPARTMENT_API_PREFIX)) {
    const API = (import.meta.env.VITE_API_URL ?? '') as string;
    return `${API}/maintenance-config/sofa-compartments/${encodeURIComponent(code)}/photo/${encodeURIComponent(imageKey)}`;
  }
  // Legacy bundled SVG / PNG from /public.
  return `/${imageKey}`;
};

const SofaCompartmentsList = ({
  config,
  editMode,
  addOnly = false,
  onChange,
  onQuickAdd,
  dragRowProps,
  draftValue,
  setDraftValue,
}: {
  config: MaintenanceConfig;
  editMode: boolean;
  addOnly?: boolean;
  onChange: (next: MaintenanceConfig) => void;
  onQuickAdd?: (next: MaintenanceConfig) => void;
  dragRowProps: (i: number) => HTMLAttributes<HTMLDivElement>;
  draftValue: string;
  setDraftValue: (v: string) => void;
}) => {
  const showAddRow = editMode || addOnly;
  const items = config.sofaCompartments ?? [];
  const meta  = config.sofaCompartmentMeta ?? {};
  /* PR — Commander 2026-05-28: per-row photo upload + delete. Always
   * available (not gated by edit mode) because the API writes the imageKey
   * directly to maintenance_config_history without going through the draft
   * → save cycle. uploadingCode tracks which row is mid-upload so we can
   * show a "saving…" hint on the right thumbnail. */
  const uploadPhoto = useUploadSofaCompartmentPhoto();
  const deletePhoto = useDeleteSofaCompartmentPhoto();
  const [uploadingCode, setUploadingCode] = useState<string | null>(null);

  const writeMeta = (code: string, patch: Partial<CompartmentMeta>) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const m    = next.sofaCompartmentMeta ?? {};
    const cur  = m[code] ?? {};
    m[code] = { ...cur, ...patch };
    next.sofaCompartmentMeta = m;
    onChange(next);
  };

  const removeAt = (idx: number) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr  = next.sofaCompartments ?? [];
    arr.splice(idx, 1);
    next.sofaCompartments = arr;
    onChange(next);
  };

  const addItem = () => {
    const v = draftValue.trim();
    if (!v) return;
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr  = next.sofaCompartments ?? [];
    arr.push(v);
    next.sofaCompartments = arr;
    if (addOnly && onQuickAdd) onQuickAdd(next);
    else onChange(next);
    setDraftValue('');
  };

  const updateCode = (idx: number, newVal: string) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr  = next.sofaCompartments ?? [];
    // ACTIVE toggles (owner spec 2026-06-12) — entries may be { value,
    // active } objects; edits rewrite the value but preserve the flag.
    const old  = arr[idx] != null ? maintEntryValue(arr[idx]!) : undefined;
    if (arr[idx] != null) arr[idx] = maintEntryWithValue(arr[idx]!, newVal);
    next.sofaCompartments = arr;
    // Migrate the meta key alongside the code rename so the override
    // doesn't get orphaned. If the new code already has meta, leave it.
    if (old && old !== newVal) {
      const m = next.sofaCompartmentMeta ?? {};
      if (m[old] && !m[newVal]) {
        m[newVal] = m[old]!;
        delete m[old];
        next.sofaCompartmentMeta = m;
      }
    }
    onChange(next);
  };

  return (
    <div className={styles.maintList}>
      {items.map((entry, i) => {
        const code = maintEntryValue(entry);
        const resolved = resolveCompartmentMeta(code, meta[code]);
        const stored   = meta[code];
        const hasImage = Boolean(resolved.imageKey);
        return (
          <div
            key={`${code}-${i}`}
            className={styles.maintRow}
            {...dragRowProps(i)}
            style={{
              ...(dragRowProps(i).style ?? {}),
              gridTemplateColumns: '32px 32px 56px 1fr auto auto',
              gap: 'var(--space-3)',
              alignItems: 'center',
            }}
          >
            <button type="button" className={styles.maintRowIcon} title="History">
              <History {...ICON_PROPS} />
            </button>
            <span className={styles.maintRowIdx} style={editMode ? { cursor: 'grab' } : undefined}>
              {i + 1}
            </span>
            {/* 48px thumbnail — click to upload, × to delete (when uploaded).
                Uploads land in maintenance_config_history.config.sofaCompartmentMeta
                via the Worker (no draft/save cycle — direct mutation). The
                legacy bundled SVGs (imageKey starts with `sofa-modules/`) are
                not deletable since they're shipped in /public; commander
                replaces them by uploading a new R2 photo, which the resolver
                prefers automatically. */}
            {(() => {
              const isUploaded = (resolved.imageKey ?? '').startsWith(SOFA_COMPARTMENT_API_PREFIX);
              const isUploading = uploadingCode === code;
              const src = resolveCompartmentImageSrc(code, resolved.imageKey);
              return (
                <div
                  style={{
                    width: 48,
                    height: 48,
                    background: hasImage ? 'var(--c-paper)' : 'var(--c-cream-2, #EFEAE0)',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-sm)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                    position: 'relative',
                    opacity: isUploading ? 0.5 : 1,
                  }}
                  title={
                    isUploading
                      ? 'Uploading…'
                      : hasImage
                        ? `${resolved.imageKey} — click to replace${isUploaded ? ' · right-click / × to remove' : ''}`
                        : 'Click to upload a photo'
                  }
                  onContextMenu={(e) => {
                    // Right-click on an uploaded photo = delete (matches
                    // commander's "Right-click or × → delete" spec).
                    if (!isUploaded || isUploading) return;
                    e.preventDefault();
                    // eslint-disable-next-line no-alert
                    if (!confirm(`Remove uploaded photo for ${code}?`)) return;
                    deletePhoto.mutate(code);
                  }}
                >
                  <label
                    style={{
                      width: '100%',
                      height: '100%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: isUploading ? 'wait' : 'pointer',
                    }}
                  >
                    {hasImage && src ? (
                      <img
                        src={src}
                        alt={code}
                        style={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                      />
                    ) : (
                      <span style={{ fontSize: 'var(--fs-10)', color: 'var(--fg-muted)' }}>+ photo</span>
                    )}
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/svg+xml"
                      style={{ display: 'none' }}
                      disabled={isUploading}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        // Reset the input so re-selecting the same file fires onChange.
                        e.target.value = '';
                        if (!file) return;
                        setUploadingCode(code);
                        uploadPhoto.mutate({ code, file }, {
                          onSettled: () => setUploadingCode(null),
                          onError: (err) => {
                            // eslint-disable-next-line no-alert
                            alert(`Upload failed: ${err instanceof Error ? err.message : String(err)}`);
                          },
                        });
                      }}
                    />
                  </label>
                  {isUploaded && !isUploading && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        // eslint-disable-next-line no-alert
                        if (!confirm(`Remove uploaded photo for ${code}?`)) return;
                        deletePhoto.mutate(code);
                      }}
                      title="Remove uploaded photo"
                      aria-label={`Remove photo for ${code}`}
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -6,
                        width: 16,
                        height: 16,
                        borderRadius: '50%',
                        background: 'var(--c-festive-b, #B8331F)',
                        color: 'white',
                        border: '1px solid var(--c-paper)',
                        fontSize: 10,
                        lineHeight: '14px',
                        padding: 0,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <X size={10} strokeWidth={2.5} />
                    </button>
                  )}
                </div>
              );
            })()}
            {/* Code + description column */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
              {editMode ? (
                <>
                  <input
                    type="text"
                    value={code}
                    onChange={(e) => updateCode(i, e.target.value)}
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--fs-14)',
                      fontWeight: 600,
                      background: 'var(--c-cream)',
                      border: '1px solid var(--c-orange)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 8px',
                      outline: 'none',
                      width: 110,
                    }}
                    title="Compartment code (e.g. 1A(LHF))"
                  />
                  <input
                    type="text"
                    placeholder="Description (e.g. 1-Sitter Left-hand facing)"
                    value={stored?.description ?? resolved.description ?? ''}
                    onChange={(e) => writeMeta(code, { description: e.target.value })}
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--fs-13)',
                      background: 'var(--c-cream)',
                      border: '1px solid var(--line-strong)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 8px',
                      outline: 'none',
                      width: '100%',
                      maxWidth: 360,
                    }}
                  />
                </>
              ) : (
                <>
                  <span
                    style={{
                      fontFamily: 'var(--font-mono)',
                      fontSize: 'var(--fs-14)',
                      fontWeight: 600,
                      color: 'var(--c-ink)',
                    }}
                  >
                    {code}
                  </span>
                  <span
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--fs-13)',
                      color: resolved.description ? 'var(--fg-soft)' : 'var(--fg-muted)',
                    }}
                  >
                    {resolved.description ?? '(no design — leave blank)'}
                  </span>
                </>
              )}
            </div>
            {/* Default price column (RM, edits in centi) */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                minWidth: 120,
                justifyContent: 'flex-end',
              }}
            >
              <span className={styles.maintRowRmPrefix}>RM</span>
              {editMode ? (
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formatRmFromCenti(stored?.defaultPriceCenti ?? resolved.defaultPriceCenti)}
                  onChange={(e) => writeMeta(code, { defaultPriceCenti: parseRmToCenti(e.target.value) })}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-14)',
                    background: 'var(--c-cream)',
                    border: '1px solid var(--line-strong)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '4px 8px',
                    outline: 'none',
                    width: 90,
                    textAlign: 'right',
                  }}
                />
              ) : (
                <span
                  className={`${styles.maintRowPrice} ${
                    (resolved.defaultPriceCenti ?? 0) === 0 ? styles.maintRowPriceMuted : ''
                  }`}
                  style={{ minWidth: 0 }}
                >
                  {formatRmFromCenti(resolved.defaultPriceCenti)}
                </span>
              )}
            </div>
            {editMode ? (
              <button
                type="button"
                className={styles.maintRowIcon}
                title="Remove"
                onClick={() => removeAt(i)}
                style={{ color: 'var(--c-festive-b, #B8331F)' }}
              >
                <Trash2 {...ICON_PROPS} />
              </button>
            ) : (
              <span />
            )}
          </div>
        );
      })}

      {showAddRow && (
        <div
          className={styles.maintRow}
          style={{
            background: 'var(--c-paper)',
            borderColor: 'var(--c-orange)',
            gridTemplateColumns: '32px 32px 1fr auto',
          }}
        >
          <span className={styles.maintRowIcon}><Plus {...ICON_PROPS} /></span>
          <span className={styles.maintRowIdx}>+</span>
          <input
            type="text"
            placeholder="New compartment code (e.g. 1A(LHF))"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-14)',
              background: 'var(--c-cream)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              outline: 'none',
            }}
          />
          <Button variant="primary" size="sm" onClick={addItem}>
            <Plus {...ICON_PROPS} />
            <span>Add</span>
          </Button>
        </div>
      )}
    </div>
  );
};

/* ─── Sofa Quick Presets — module-composition shortcuts (Commander 2026-05-28)
 *
 * POS mirror of the Backend editor. Three-tier role gate matches the rest of
 * POS Maintenance:
 *   - admin (editMode=true): full edit (label, modules, tier, active, delete)
 *   - sales_director (addOnly=true): can append a new preset row; existing
 *     rows render readonly (no edit, no delete)
 *   - everyone else: pure readonly display (label · modules · tier)
 *
 * Add-only mutations post immediately via onQuickAdd (same posture as the
 * other addOnly sub-tabs — no draft-Save dance for sales_director). */
const SofaQuickPresetsList = ({
  config,
  editMode,
  addOnly = false,
  onChange,
  onQuickAdd,
  dragRowProps,
}: {
  config: MaintenanceConfig;
  editMode: boolean;
  addOnly?: boolean;
  onChange: (next: MaintenanceConfig) => void;
  onQuickAdd?: (next: MaintenanceConfig) => void;
  dragRowProps: (i: number) => HTMLAttributes<HTMLDivElement>;
}) => {
  const stored = config.sofaQuickPresets;
  const items: SofaQuickPreset[] = stored && stored.length > 0
    ? stored
    : resolveSofaQuickPresets(undefined);
  const isUsingFallback = !stored || stored.length === 0;

  const compartmentPool: string[] = (config.sofaCompartments && config.sofaCompartments.length > 0)
    ? maintActiveValues(config.sofaCompartments)
    : SOFA_MODULES.map((m) => m.id);

  const writeAll = (next: SofaQuickPreset[]) => {
    const cfg = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    cfg.sofaQuickPresets = next;
    onChange(cfg);
  };

  const updateAt = (idx: number, patch: Partial<SofaQuickPreset>) => {
    const next = items.map((p, i) => i === idx ? { ...p, ...patch } : p);
    writeAll(next);
  };

  const removeAt = (idx: number) => {
    if (!confirm(`Remove preset "${items[idx]?.label ?? '?'}"? (Existing combos with this preset_id keep working.)`)) return;
    writeAll(items.filter((_, i) => i !== idx));
  };

  const toggleModule = (idx: number, code: string) => {
    const cur = items[idx]?.modules ?? [];
    const next = cur.includes(code) ? cur.filter((c) => c !== code) : [...cur, code];
    updateAt(idx, { modules: next });
  };

  const addPreset = () => {
    const usedIds = new Set(items.map((p) => p.id));
    let n = items.length + 1;
    while (usedIds.has(`P${n}`)) n += 1;
    const newRow: SofaQuickPreset = {
      id: `P${n}`,
      label: 'New preset',
      modules: [],
      active: true,
    };
    /* add-only path (sales_director): when the maintenance row hasn't been
       lifted off the fallback yet, snapshot the resolved defaults so the
       POST carries the full canonical list + the new entry. Otherwise the
       quick-add would persist ONLY the new row, dropping the historical 11. */
    const base = isUsingFallback ? resolveSofaQuickPresets(undefined) : items;
    const next = [...base, newRow];
    if (addOnly && onQuickAdd) {
      const cfg = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      cfg.sofaQuickPresets = next;
      onQuickAdd(cfg);
    } else {
      writeAll(next);
    }
  };

  const showAddRow = editMode || addOnly;

  return (
    <div className={styles.maintList}>
      {isUsingFallback && (editMode || addOnly) && (
        <div className={styles.bannerWarn} style={{ marginBottom: 8 }}>
          Showing the default 11-entry list. {editMode
            ? 'Hit Save to lift these into the stored config and start customising'
            : 'Adding a new preset will lift the defaults into the stored config'}
          {' '}— existing combos that reference preset_id keep resolving against the same ids.
        </div>
      )}
      {items.map((p, i) => (
        <div
          key={`${p.id}-${i}`}
          className={styles.maintRow}
          {...dragRowProps(i)}
          style={{
            ...(dragRowProps(i).style ?? {}),
            gridTemplateColumns: '32px 32px 100px 1fr 110px auto auto',
            gap: 'var(--space-3)',
            alignItems: 'center',
          }}
        >
          <button type="button" className={styles.maintRowIcon} title="History">
            <History {...ICON_PROPS} />
          </button>
          <span className={styles.maintRowIdx} style={editMode ? { cursor: 'grab' } : undefined}>
            {i + 1}
          </span>
          {editMode ? (
            <input
              type="text"
              value={p.id}
              onChange={(e) => updateAt(i, { id: e.target.value })}
              placeholder="ID"
              title="Stable key — referenced by combo rules. Don't rename after combos exist."
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-12)',
                fontWeight: 600,
                background: 'var(--c-cream)',
                border: '1px solid var(--c-orange)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 6px',
                outline: 'none',
                width: '100%',
              }}
            />
          ) : (
            <span style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-12)',
              color: 'var(--fg-soft)',
            }}>
              {p.id}
            </span>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
            {editMode ? (
              <input
                type="text"
                value={p.label}
                onChange={(e) => updateAt(i, { label: e.target.value })}
                placeholder="Label (e.g. 1-Seater)"
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-14)',
                  fontWeight: 600,
                  background: 'var(--c-cream)',
                  border: '1px solid var(--c-orange)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  outline: 'none',
                  width: '100%',
                  maxWidth: 280,
                }}
              />
            ) : (
              <span style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-14)',
                fontWeight: 600,
                color: 'var(--c-ink)',
              }}>
                {p.label}
              </span>
            )}
            <div style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 'var(--fs-11)',
              color: 'var(--fg-soft)',
            }}>
              {p.modules.length === 0 ? (
                <span style={{ color: 'var(--fg-muted)', fontStyle: 'italic' }}>
                  No modules selected
                </span>
              ) : (
                p.modules.join(' + ')
              )}
            </div>
            {editMode && (
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 4,
                padding: 6,
                background: 'var(--c-paper)',
                border: '1px dashed var(--line)',
                borderRadius: 'var(--radius-sm)',
              }}>
                {compartmentPool.map((code) => {
                  const on = p.modules.includes(code);
                  return (
                    <button
                      type="button"
                      key={code}
                      onClick={() => toggleModule(i, code)}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-11)',
                        fontWeight: 600,
                        background: on ? 'var(--c-orange, #c47b2f)' : 'var(--c-paper)',
                        color: on ? 'var(--c-paper, #fff)' : 'var(--c-ink)',
                        border: `1px solid ${on ? 'var(--c-orange, #c47b2f)' : 'var(--line-strong)'}`,
                        borderRadius: 'var(--radius-sm)',
                        padding: '2px 8px',
                        cursor: 'pointer',
                      }}
                      title={on ? 'Click to remove' : 'Click to add'}
                    >
                      {code}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          {editMode ? (
            <select
              value={p.defaultTier ?? ''}
              onChange={(e) => updateAt(i, { defaultTier: (e.target.value || undefined) as SofaPriceTier | undefined })}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-12)',
                background: 'var(--c-cream)',
                border: '1px solid var(--line-strong)',
                borderRadius: 'var(--radius-sm)',
                padding: '4px 6px',
                outline: 'none',
              }}
              title="Default tier applied when this preset is used in the New Combo dialog"
            >
              <option value="">— Any tier —</option>
              <option value="PRICE_1">PRICE_1</option>
              <option value="PRICE_2">PRICE_2</option>
              <option value="PRICE_3">PRICE_3</option>
            </select>
          ) : (
            <span style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-11)',
              color: 'var(--fg-soft)',
            }}>
              {p.defaultTier ?? '—'}
            </span>
          )}
          {editMode ? (
            <label style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-11)',
              color: 'var(--fg-soft)', cursor: 'pointer',
            }}>
              <input
                type="checkbox"
                checked={p.active !== false}
                onChange={(e) => updateAt(i, { active: e.target.checked })}
                title="Inactive presets stay in history but don't show in pickers"
              />
              Active
            </label>
          ) : (
            <span style={{
              fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-11)',
              color: p.active === false ? 'var(--fg-muted)' : 'var(--c-green, #1a7a3a)',
            }}>
              {p.active === false ? 'Inactive' : 'Active'}
            </span>
          )}
          {editMode ? (
            <button
              type="button"
              className={styles.maintRowIcon}
              title="Remove preset"
              onClick={() => removeAt(i)}
              style={{ color: 'var(--c-festive-b, #B8331F)' }}
            >
              <Trash2 {...ICON_PROPS} />
            </button>
          ) : (
            <span />
          )}
        </div>
      ))}

      {showAddRow && (
        <div
          className={styles.maintRow}
          style={{
            background: 'var(--c-paper)',
            borderColor: 'var(--c-orange)',
            gridTemplateColumns: '32px 32px 1fr auto',
          }}
        >
          <span className={styles.maintRowIcon}><Plus {...ICON_PROPS} /></span>
          <span className={styles.maintRowIdx}>+</span>
          <span style={{
            fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-13)',
            color: 'var(--fg-soft)',
          }}>
            {addOnly
              ? 'Append a blank preset (sales_director: add-only — admin edits modules + tier).'
              : 'Append a blank preset row — fill in ID, label, and pick modules from the chip rail.'}
          </span>
          <Button variant="primary" size="sm" onClick={addPreset}>
            <Plus {...ICON_PROPS} />
            <span>Add preset</span>
          </Button>
        </div>
      )}
    </div>
  );
};

/* PR — Commander 2026-05-28 (DATA LEAK FIX): selling-price cell on POS
   Maintenance PricedOption rows. Reads `sellingPriceSen` (the POS-authored
   selling price); never displays `priceSen` (cost benchmark from Backend).
   Editable when the caller has rights (admin in editMode or sales_director
   in add-only mode); display-only otherwise. Empty selling-price shows as
   "—" so commander can see at-a-glance which rows still need a price set
   on the POS side. Commits on blur or Enter to avoid spamming POSTs.

   Numeric input is buffered locally so typing "1" → "10" doesn't fire a
   POST mid-keystroke; commit happens on blur or when the user hits Enter
   (which blurs the input). null commit clears the field (deletes the
   sellingPriceSen key from the row so it round-trips back to "—"). */
const SellingPriceCell = ({
  opt,
  editable,
  onCommit,
}: {
  opt: PricedOption;
  editable: boolean;
  onCommit: (sellingPriceSen: number | null) => void;
}) => {
  const initial = opt.sellingPriceSen != null
    ? (opt.sellingPriceSen / 100).toFixed(2)
    : '';
  const [local, setLocal] = useState<string>(initial);

  // Sync local state when the row's persisted value changes (e.g. after a
  // refetch from the server). Without this, the cell would freeze on the
  // user's last typed value across reloads.
  useEffect(() => { setLocal(initial); }, [initial]);

  const commit = () => {
    const trimmed = local.trim();
    if (trimmed === '') {
      // empty input clears the selling price
      if (opt.sellingPriceSen != null) onCommit(null);
      return;
    }
    const sen = Math.round(Number(trimmed) * 100);
    if (Number.isNaN(sen)) {
      setLocal(initial); // bad input — revert
      return;
    }
    if (sen === (opt.sellingPriceSen ?? -1)) return; // no-op
    onCommit(sen);
  };

  if (!editable) {
    /* View-only branch — sales_executive / outlet_manager / sales.
       Displays the selling price authored by sales_director, or "—" when
       unset. NEVER falls back to opt.priceSen (which is commander's cost
       benchmark on Backend). */
    return (
      <span className={styles.maintRowPrice}>
        {opt.sellingPriceSen != null ? (
          <>
            <span className={styles.maintRowRmPrefix}>RM</span>
            <span>{(opt.sellingPriceSen / 100).toFixed(2)}</span>
          </>
        ) : (
          <span className={styles.maintRowPriceMuted}>—</span>
        )}
      </span>
    );
  }

  return (
    <span className={styles.maintRowPrice}>
      <span className={styles.maintRowRmPrefix}>RM</span>
      <input
        type="number"
        step="0.01"
        placeholder="—"
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
          if (e.key === 'Escape') { setLocal(initial); (e.target as HTMLInputElement).blur(); }
        }}
        style={{
          width: 90,
          textAlign: 'right',
          fontFamily: 'var(--font-mono)',
          fontSize: 'var(--fs-14)',
          background: 'var(--c-cream)',
          border: '1px solid var(--c-orange)',
          borderRadius: 'var(--radius-sm)',
          padding: '4px 8px',
          outline: 'none',
        }}
      />
    </span>
  );
};

const MaintenanceList = ({
  listKey,
  config,
  editMode,
  addOnly = false,
  onChange,
  onQuickAdd,
  priced,
  brandingSuggestions,
}: {
  listKey: MaintenanceListKey;
  config: MaintenanceConfig;
  editMode: boolean;
  /** Commander 2026-05-28 tightening: sales_director sees the "+ Add new"
      row at the bottom even when editMode is false. Existing rows render
      as static display; only the bottom add row accepts input. */
  addOnly?: boolean;
  /** Called when the user commits a row in add-only mode. The page-level
      handler POSTs immediately with today as effective_from. */
  onQuickAdd?: (next: MaintenanceConfig) => void;
  onChange: (next: MaintenanceConfig) => void;
  priced: boolean;
  /** DISTINCT branding values (products + models) shown read-only when the
      Brandings pool is empty. Parity with the Backend Maintenance editor. */
  brandingSuggestions?: string[];
}) => {
  /* When the bottom add row is visible — either because admin is in
     editMode or because sales_director is in add-only mode. */
  const showAddRow = editMode || addOnly;
  // Empty draft state for the "add new" row at the bottom of the list when
  // edit mode is on. Kept local so toggling tabs cancels in-flight adds.
  const [draftValue, setDraftValue] = useState('');
  const [draftPrice, setDraftPrice] = useState('0.00');
  /* PR #216 — Commander 2026-05-27: parallel cost-side input. Operation
     enters the estimated raw cost alongside the selling price; the value
     persists into PricedOption.costSen and feeds computeMfgLineCost(). */
  const [draftCost, setDraftCost] = useState('0.00');

  /* Commander 2026-05-27: "Maintenance 也要有 Sort 的功能" — drag-and-drop
     row reorder when editMode. Uses native HTML5 drag API (no library).
     dragIdx tracks the row currently being dragged; on drop we splice it
     to the new index and emit onChange so the parent's draft sees the
     new order. Save persists the array order naturally. */
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const moveAt = (from: number, to: number) => {
    if (from === to) return;
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr = ((next as unknown as Record<string, unknown>)[listKey] as unknown[] | undefined) ?? [];
    if (from < 0 || from >= arr.length || to < 0 || to >= arr.length) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    (next as Record<string, unknown>)[listKey] = arr;
    onChange(next);
  };
  /* Per-row props factory — returns the draggable handlers + visual hint.
     Only active in edit mode; otherwise rows are static. */
  const dragRowProps = (i: number): HTMLAttributes<HTMLDivElement> => {
    if (!editMode) return {};
    return {
      draggable: true,
      onDragStart: (e) => {
        setDragIdx(i);
        e.dataTransfer.effectAllowed = 'move';
        // Firefox requires data to start a drag
        try { e.dataTransfer.setData('text/plain', String(i)); } catch { /* noop */ }
      },
      onDragOver: (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; },
      onDrop: (e) => {
        e.preventDefault();
        if (dragIdx === null) return;
        moveAt(dragIdx, i);
        setDragIdx(null);
      },
      onDragEnd: () => setDragIdx(null),
      style: dragIdx === i ? { opacity: 0.5 } : undefined,
      title: 'Drag to reorder',
    };
  };

  if (listKey === 'fabrics') {
    return <FabricsMaintenancePanel />;
  }

  if (listKey === 'fabricPricing') {
    return <FabricPricingPanel />;
  }

  if (listKey === 'productAddons') {
    return <SpecialAddonsManager />;
  }

  if (listKey === 'orderAddons') {
    return <OrderAddonsManager />;
  }

  // PR #74 — Code Format tab removed (Commander 2026-05-26: preset only).
  // The CodeFormatPanel component is kept in the file dead-code below in
  // case we ever want to re-expose it; the API's hardcoded templates take
  // over when the cfg.{category}CodeFormat / NameFormat fields are blank.

  // ── String[] tabs (gaps, sofaSizes, + PR #50 pool keys) ──────────────
  // Defaulting to [] avoids the "Cannot read properties of undefined
  // (reading 'map')" crash when an older maintenance_config row doesn't
  // carry the new pool keys yet. Editing then saving will materialise the
  // key in the JSONB blob.
  // PR #220 (Commander 2026-05-27) — Sofa Compartments gets its own renderer
  // with image preview + description + default price, ported from the POS
  // module catalogue (SOFA_MODULES). Falls through to the generic string[]
  // branch below for every other pool key.
  if (listKey === 'sofaCompartments') {
    return (
      <SofaCompartmentsList
        config={config}
        editMode={editMode}
        addOnly={addOnly}
        onChange={onChange}
        onQuickAdd={onQuickAdd}
        dragRowProps={dragRowProps}
        draftValue={draftValue}
        setDraftValue={setDraftValue}
      />
    );
  }

  if (listKey === 'sofaQuickPresets') {
    return (
      <SofaQuickPresetsList
        config={config}
        editMode={editMode}
        addOnly={addOnly}
        onChange={onChange}
        onQuickAdd={onQuickAdd}
        dragRowProps={dragRowProps}
      />
    );
  }

  if (
    listKey === 'gaps'
    || listKey === 'sofaSizes'
    || listKey === 'bedframeSizes'
    || listKey === 'mattressSizes'
    || listKey === 'brandings'
    || listKey === 'supplierCategories'
  ) {
    // ACTIVE toggles (owner spec 2026-06-12) — entries may be plain strings
    // (= active) or { value, active: false } once toggled off on the Backend
    // Maintenance tab. POS renders the VALUE and preserves the flag on edit;
    // the Active checkbox itself lives on the Backend editor.
    const items = (config[listKey] as MaintPoolEntry[] | undefined) ?? [];

    // Brandings seed/fallback (parity with Backend): pool empty + not editing →
    // surface the DISTINCT branding values across products + models as a
    // read-only suggestion. Hitting Edit seeds them into the draft (see
    // MaintenanceTab.startEdit) so one Save adopts them — nothing is silently
    // written to config.
    const showBrandingSuggestions =
      listKey === 'brandings'
      && !editMode
      && maintValues(items).filter((b) => b.trim().length > 0).length === 0
      && (brandingSuggestions?.length ?? 0) > 0;

    const removeAt = (idx: number) => {
      const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      const arr = (next[listKey] as MaintPoolEntry[] | undefined) ?? [];
      arr.splice(idx, 1);
      (next as Record<string, unknown>)[listKey] = arr;
      onChange(next);
    };

    const addItem = () => {
      const v = draftValue.trim();
      if (!v) return;
      const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      // Same defaulting story — the new pool keys (PR #50) may not exist on
      // old maintenance_config rows yet.
      const arr = (next[listKey] as MaintPoolEntry[] | undefined) ?? [];
      arr.push(v);
      (next as Record<string, unknown>)[listKey] = arr;
      // add-only mode: POST immediately. editMode: stash in draft for the
      // page-level Save button.
      if (addOnly && onQuickAdd) onQuickAdd(next);
      else onChange(next);
      setDraftValue('');
    };

    /* PR #40 — Commander 2026-05-26: existing rows must be editable, not
       just deletable. The string[] flow (gaps / sofaSizes) was missing
       inline edit — added below. */
    const updateAt = (idx: number, newVal: string) => {
      const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      const arr = (next[listKey] as MaintPoolEntry[] | undefined) ?? [];
      if (arr[idx] != null) arr[idx] = maintEntryWithValue(arr[idx]!, newVal);
      (next as Record<string, unknown>)[listKey] = arr;
      onChange(next);
    };

    // PR #92 — Commander 2026-05-26: "King, 6FT, 183 那些，如果我要改的话，
    // 怎么样去改呢？" For bedframe/mattress sizes, editMode now exposes 3
    // columns: code | label | dimensions. The code stays in the
    // bedframeSizes string[]; label + dimensions land in a parallel
    // sizeLabels override keyed by code. Read path goes through
    // resolveSizeInfo() so the rest of the app picks the override up.
    const isSizeRow = listKey === 'bedframeSizes' || listKey === 'mattressSizes';
    const updateLabel = (code: string, field: 'label' | 'dimensions', val: string) => {
      const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
      const labels = (next.sizeLabels ?? {}) as Record<string, { label?: string; dimensions?: string }>;
      const cur    = labels[code] ?? {};
      labels[code] = { ...cur, [field]: val };
      next.sizeLabels = labels;
      onChange(next);
    };
    return (
      <div className={styles.maintList}>
        {showBrandingSuggestions && (
          <>
            <p className={styles.stateInfo} style={{ marginBottom: 8 }}>
              Pool is empty — showing {brandingSuggestions!.length} suggested
              value{brandingSuggestions!.length === 1 ? '' : 's'} found on existing
              products + models. Hit <strong>Edit</strong> then <strong>Save</strong> to
              adopt them into the pool.
            </p>
            {brandingSuggestions!.map((v, i) => (
              <div key={v} className={styles.maintRow} style={{ opacity: 0.7 }}>
                <span className={styles.maintRowIcon} />
                <span className={styles.maintRowIdx}>{i + 1}</span>
                <span className={styles.maintRowValue}>{v}</span>
                <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)', fontWeight: 600 }}>
                  suggested
                </span>
              </div>
            ))}
          </>
        )}
        {items.map((entry, i) => {
          const v = maintEntryValue(entry);
          const labelOv = config.sizeLabels?.[v];
          const resolved = isSizeRow ? resolveSizeInfo(v, config) : null;
          return (
          <div key={`${v}-${i}`} className={styles.maintRow} {...dragRowProps(i)}>
            <button type="button" className={styles.maintRowIcon} title="History">
              <History {...ICON_PROPS} />
            </button>
            <span className={styles.maintRowIdx} style={editMode ? { cursor: 'grab' } : undefined}>{i + 1}</span>
            <span className={styles.maintRowValue}>
              {editMode ? (
                isSizeRow ? (
                  // PR #92 — Inline 3-input editor (code · label · dimensions)
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                    <input
                      type="text"
                      value={v}
                      onChange={(e) => updateAt(i, e.target.value)}
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-14)',
                        fontWeight: 600,
                        background: 'var(--c-cream)',
                        border: '1px solid var(--c-orange)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px',
                        outline: 'none',
                        width: 80,
                      }}
                      title="Size code (e.g. K)"
                    />
                    <span style={{ color: 'var(--fg-muted)', fontWeight: 700 }}>·</span>
                    <input
                      type="text"
                      placeholder="Label e.g. 6FT"
                      value={labelOv?.label ?? resolved?.label ?? ''}
                      onChange={(e) => updateLabel(v, 'label', e.target.value)}
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--fs-14)',
                        background: 'var(--c-cream)',
                        border: '1px solid var(--line-strong)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px',
                        outline: 'none',
                        width: 110,
                      }}
                    />
                    <span style={{ color: 'var(--fg-muted)', fontWeight: 700 }}>·</span>
                    <input
                      type="text"
                      placeholder="Dimensions e.g. 183X190CM"
                      value={labelOv?.dimensions ?? resolved?.dim ?? ''}
                      onChange={(e) => updateLabel(v, 'dimensions', e.target.value)}
                      style={{
                        fontFamily: 'var(--font-sans)',
                        fontSize: 'var(--fs-14)',
                        background: 'var(--c-cream)',
                        border: '1px solid var(--line-strong)',
                        borderRadius: 'var(--radius-sm)',
                        padding: '4px 8px',
                        outline: 'none',
                        width: 170,
                      }}
                    />
                  </div>
                ) : (
                  <input
                    type="text"
                    value={v}
                    onChange={(e) => updateAt(i, e.target.value)}
                    style={{
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--fs-16)',
                      fontWeight: 600,
                      background: 'var(--c-cream)',
                      border: '1px solid var(--c-orange)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '4px 8px',
                      outline: 'none',
                      width: '100%',
                      maxWidth: 280,
                    }}
                  />
                )
              ) : (
                /* PR #77 — enrich bedframe/mattress size codes with their
                   imperial label + cm dimensions so the bare "K" row reads
                   as "K · 6FT · 183x190CM". String stored unchanged — only
                   display is enriched. Other list types (gaps, sofa
                   compartments, sofa seat sizes) fall back to raw value.
                   PR #92 — display path now consults sizeLabels override. */
                isSizeRow
                  ? formatSizeRichWithCfg(v, config)
                  : v
              )}
            </span>
            {editMode ? (
              <button
                type="button"
                className={styles.maintRowIcon}
                title="Remove"
                onClick={() => removeAt(i)}
                style={{ color: 'var(--c-festive-b, #B8331F)' }}
              >
                <Trash2 {...ICON_PROPS} />
              </button>
            ) : (
              <span />
            )}
          </div>
          );
        })}

        {showAddRow && (
          <div
            className={styles.maintRow}
            style={{
              background: 'var(--c-paper)',
              borderColor: 'var(--c-orange)',
              gridTemplateColumns: '32px 32px 1fr auto',
            }}
          >
            <span className={styles.maintRowIcon}><Plus {...ICON_PROPS} /></span>
            <span className={styles.maintRowIdx}>+</span>
            <input
              type="text"
              placeholder="New value (e.g. 28)"
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
              style={{
                fontFamily: 'var(--font-sans)',
                fontSize: 'var(--fs-14)',
                background: 'var(--c-cream)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 10px',
                outline: 'none',
              }}
            />
            <Button variant="primary" size="sm" onClick={addItem}>
              <Plus {...ICON_PROPS} />
              <span>Add</span>
            </Button>
          </div>
        )}
      </div>
    );
  }

  // ── PricedOption[] tabs (the rest) ────────────────────────────────────
  // Same defaulting as the string[] branch — old maintenance_config rows
  // may not yet carry every key the UI now lists.
  const items = (config[listKey] as PricedOption[] | undefined) ?? [];

  const removeAt = (idx: number) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr = (next[listKey] as PricedOption[] | undefined) ?? [];
    arr.splice(idx, 1);
    (next as Record<string, unknown>)[listKey] = arr;
    onChange(next);
  };

  const addItem = () => {
    const v = draftValue.trim();
    if (!v) return;
    /* PR — Commander 2026-05-28: POS authors `sellingPriceSen` (the value
       customers see) NOT priceSen (which Backend treats as cost). New rows
       added on POS start with priceSen=0 to mark "no cost benchmark yet on
       Backend" — commander on Backend can fill that in later if needed.
       The draftPrice input collects the selling price. */
    const sellingPriceSen = Math.round((Number(draftPrice) || 0) * 100);
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    const arr = (next[listKey] as PricedOption[] | undefined) ?? [];
    // priceSen stays 0 on POS-authored rows (no cost benchmark) — Backend
    // commander can fill it later. costSen left absent. sellingPriceSen is
    // the selling price the customer pays, set here by sales_director.
    const row: PricedOption = sellingPriceSen > 0
      ? { value: v, priceSen: 0, sellingPriceSen }
      : { value: v, priceSen: 0 };
    arr.push(row);
    (next as Record<string, unknown>)[listKey] = arr;
    // add-only mode: POST immediately. editMode: stash in draft for the
    // page-level Save button.
    if (addOnly && onQuickAdd) onQuickAdd(next);
    else onChange(next);
    setDraftValue('');
    setDraftPrice('0.00');
    setDraftCost('0.00');
  };

  return (
    <div className={styles.maintList}>
      {items.map((opt, i) => (
        <div key={`${opt.value}-${i}`} className={styles.maintRow} {...dragRowProps(i)}>
          <button type="button" className={styles.maintRowIcon} title="History">
            <History {...ICON_PROPS} />
          </button>
          <span className={styles.maintRowIdx} style={editMode ? { cursor: 'grab' } : undefined}>{i + 1}</span>
          <span className={styles.maintRowValue}>
            {editMode ? (
              <input
                type="text"
                value={opt.value}
                onChange={(e) => {
                  const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
                  (next[listKey] as PricedOption[])[i]!.value = e.target.value;
                  onChange(next);
                }}
                style={{
                  fontFamily: 'var(--font-sans)',
                  fontSize: 'var(--fs-16)',
                  fontWeight: 600,
                  background: 'var(--c-cream)',
                  border: '1px solid var(--c-orange)',
                  borderRadius: 'var(--radius-sm)',
                  padding: '4px 8px',
                  outline: 'none',
                  width: '100%',
                  maxWidth: 280,
                }}
              />
            ) : (
              opt.value
            )}
          </span>
          <span style={{ display: 'inline-flex', gap: 'var(--space-3)', alignItems: 'center', justifyContent: 'flex-end' }}>
            {/* PR — Commander 2026-05-28 (DATA LEAK FIX): the legacy
                priceSen column is now treated as COST on POS — never
                displayed. Sales_director authors a parallel
                sellingPriceSen value here, surfaced through this column.
                view-only roles see the read-only value (or "—" when
                unset). add-only roles (sales_director) get an inline
                input + onBlur POSTs immediately. editMode (admin only)
                keeps the same inline editor with Save-on-blur. */}
            <SellingPriceCell
              opt={opt}
              editable={editMode || addOnly}
              onCommit={(newSellSen) => {
                const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
                const list = next[listKey] as PricedOption[];
                if (newSellSen == null) {
                  delete (list[i] as PricedOption).sellingPriceSen;
                } else {
                  list[i]!.sellingPriceSen = newSellSen;
                }
                // add-only mode: POST immediately (special-case edit per
                // commander's explicit ask — selling price is the only field
                // sales_director can mutate without entering full edit mode).
                // editMode: stash in the parent draft for the Save button.
                if (addOnly && onQuickAdd) onQuickAdd(next);
                else onChange(next);
              }}
            />
            {/* POS port: parallel COST column (Backend PR #216) is stripped
                unconditionally on POS — sales-side never sees purchase cost.
                The legacy priceSen + costSen fields still persist on the row
                untouched; commander on Backend keeps using them as cost
                benchmark. POS reads/writes ONLY sellingPriceSen. */}
            {editMode && (
              <button
                type="button"
                className={styles.maintRowIcon}
                title="Remove"
                onClick={() => removeAt(i)}
                style={{ color: 'var(--c-festive-b, #B8331F)' }}
              >
                <Trash2 {...ICON_PROPS} />
              </button>
            )}
          </span>
        </div>
      ))}

      {showAddRow && (
        <div
          className={styles.maintRow}
          style={{
            background: 'var(--c-paper)',
            borderColor: 'var(--c-orange)',
            gridTemplateColumns: '32px 32px 1fr auto',
          }}
        >
          <span className={styles.maintRowIcon}><Plus {...ICON_PROPS} /></span>
          <span className={styles.maintRowIdx}>+</span>
          <input
            type="text"
            placeholder="New value"
            value={draftValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
            style={{
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-14)',
              background: 'var(--c-cream)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-sm)',
              padding: '6px 10px',
              outline: 'none',
            }}
          />
          <span style={{ display: 'inline-flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            {/* PR — Commander 2026-05-28: this is the SELLING price (what
                customer pays). priceSen (cost benchmark on Backend) stays at
                0 for POS-authored rows. */}
            <span className={styles.maintRowRmPrefix} title="Selling price">RM</span>
            <input
              type="number"
              step="0.01"
              value={draftPrice}
              onChange={(e) => setDraftPrice(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addItem(); }}
              placeholder="Selling price"
              title="Selling price (what the customer pays)"
              style={{
                width: 90,
                textAlign: 'right',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--fs-14)',
                background: 'var(--c-cream)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                padding: '6px 8px',
                outline: 'none',
              }}
            />
            {/* POS port: Operation-side cost input (Backend PR #216) is
                stripped here. The `draftCost` state still exists upstream
                to keep the addItem() handler signature stable; on POS we
                never surface a non-zero cost. */}
            <Button variant="primary" size="sm" onClick={addItem}>
              <Plus {...ICON_PROPS} />
              <span>Add</span>
            </Button>
          </span>
        </div>
      )}

      {!priced && !editMode && <p className={styles.eyebrow}>No surcharge pricing for this list.</p>}
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Fabrics sub-tab body — embeds the shared FabricsTable so the same editor
   shows up on /fabric-tracking and Products → Maintenance → Common → Fabrics.
   Has its own slim search bar so the 122-row list stays usable in-place.
   ════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════
   PR #72 — Per-category code/name format editor (DEAD CODE as of PR #74).
   Commander 2026-05-26: revert to preset-only templates — the hardcoded
   ones in apps/api/src/routes/product-models.ts §generate are the source
   of truth. UI editor below kept as dead code in case we re-expose it;
   sidebar no longer routes to it (see MaintenanceList). The
   {category}CodeFormat / NameFormat columns on the JSONB blob are now
   always read as blank → API template fallback kicks in.
   ════════════════════════════════════════════════════════════════════════ */

type CodeFormatKey = 'bedframeFormat' | 'sofaFormat' | 'mattressFormat';

interface FormatFieldMap {
  codeKey:    keyof MaintenanceConfig;
  nameKey:    keyof MaintenanceConfig;
  codeDefault: string;
  nameDefault: string;
  sample:     Record<string, string>;
  placeholderHint: string;
}

const FORMAT_FIELDS: Record<CodeFormatKey, FormatFieldMap> = {
  bedframeFormat: {
    codeKey:     'bedframeCodeFormat',
    nameKey:     'bedframeNameFormat',
    codeDefault: '{model_code}-({size})',
    // PR #100 — include {model_name} so output matches mattress convention
    // (e.g. "TRION BEDFRAME (6FT) (183X190CM)"). Mirrors DEFAULT_FORMATS
    // in ProductModelDetail.tsx and API §BEDFRAME branch.
    nameDefault: '{branding} {model_name} BEDFRAME ({size_label}) ({dimensions})',
    sample: {
      branding:    'HILTON',
      model_code:  '1003',
      model_name:  'TRION',
      size:        'K',
      size_label:  '6FT',
      dimensions:  '183X190CM',
    },
    placeholderHint: '{branding}, {model_code}, {model_name}, {size}, {size_label}, {dimensions}',
  },
  sofaFormat: {
    codeKey:     'sofaCodeFormat',
    nameKey:     'sofaNameFormat',
    codeDefault: '{model_code}-{compartment}',
    nameDefault: '{model_name} {compartment}',
    sample: {
      branding:    'HOUZS',
      model_code:  '5530',
      model_name:  'SOFA 5530',
      compartment: '1A(LHF)',
    },
    placeholderHint: '{branding}, {model_code}, {model_name}, {compartment}',
  },
  mattressFormat: {
    codeKey:     'mattressCodeFormat',
    nameKey:     'mattressNameFormat',
    codeDefault: '{model_code} MATT ({size})',
    nameDefault: '{model_name} ({width}x{length}x{thickness}CM)',
    sample: {
      branding:    '2990S',
      model_code:  '2990-NF AKKA-FIRM',
      model_name:  '2990 AKKA-FIRM MATTRESS',
      size:        'K',
      size_label:  '6FT',
      width:       '183',
      length:      '190',
      thickness:   '31',
    },
    placeholderHint: '{branding}, {model_code}, {model_name}, {size}, {size_label}, {width}, {length}, {thickness}',
  },
};

function substitute(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_match, k) => vars[k] ?? '');
}

const CodeFormatPanel = ({
  listKey, config, editMode, onChange,
}: {
  listKey: CodeFormatKey;
  config: MaintenanceConfig;
  editMode: boolean;
  onChange: (next: MaintenanceConfig) => void;
}) => {
  const f = FORMAT_FIELDS[listKey];
  const codeVal = (config[f.codeKey] as string | undefined) ?? '';
  const nameVal = (config[f.nameKey] as string | undefined) ?? '';

  const codeEffective = codeVal.trim() || f.codeDefault;
  const nameEffective = nameVal.trim() || f.nameDefault;

  const exampleCode = substitute(codeEffective, f.sample);
  const exampleName = substitute(nameEffective, f.sample);

  const update = (key: keyof MaintenanceConfig, value: string) => {
    const next = JSON.parse(JSON.stringify(config)) as MaintenanceConfig;
    (next as Record<string, unknown>)[key] = value;
    onChange(next);
  };

  const inputStyle = {
    fontFamily: 'var(--font-mono)',
    fontSize: 'var(--fs-13)',
    padding: 'var(--space-3) var(--space-4)',
    border: '1px solid var(--line-strong)',
    borderRadius: 'var(--radius-sm)',
    background: editMode ? 'var(--c-paper)' : 'var(--c-cream)',
    color: 'var(--fg)',
    width: '100%',
    outline: 'none',
  } as const;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
      <div>
        <div className="t-eyebrow" style={{ marginBottom: 4 }}>Code template</div>
        <input
          type="text"
          readOnly={!editMode}
          value={codeVal}
          placeholder={f.codeDefault}
          onChange={(e) => update(f.codeKey, e.target.value)}
          style={inputStyle}
        />
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          Default if blank: <code>{f.codeDefault}</code>
        </p>
      </div>

      <div>
        <div className="t-eyebrow" style={{ marginBottom: 4 }}>Name template</div>
        <input
          type="text"
          readOnly={!editMode}
          value={nameVal}
          placeholder={f.nameDefault}
          onChange={(e) => update(f.nameKey, e.target.value)}
          style={inputStyle}
        />
        <p style={{ margin: '6px 0 0', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
          Default if blank: <code>{f.nameDefault}</code>
        </p>
      </div>

      <div style={{
        background: 'var(--c-cream)',
        border: '1px solid var(--line)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-4)',
      }}>
        <div className="t-eyebrow" style={{ marginBottom: 8 }}>Live preview · sample row</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            code
            <code style={{ marginLeft: 12, background: 'var(--c-orange)', color: 'var(--bg)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              {exampleCode}
            </code>
          </div>
          <div style={{ fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            name
            <code style={{ marginLeft: 12, background: 'var(--c-orange)', color: 'var(--bg)', padding: '2px 8px', borderRadius: 4, fontWeight: 600 }}>
              {exampleName}
            </code>
          </div>
        </div>
      </div>

      <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
        <strong>Available placeholders:</strong> {f.placeholderHint}
      </div>
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   Fabric Pricing (migration 0124) — POS selling fabric-tier add-on.
   Master Admin sets the 4 tier Δ amounts (sofa P2/P3, bedframe P2/P3) + assigns
   each fabric's SELLING tier. The Δ is added per item to the order total (like
   the delivery fee); the cost/procurement side (fabric_trackings) is untouched.
   ════════════════════════════════════════════════════════════════════════ */
const FABRIC_TIER_NEXT: Record<string, 'PRICE_1' | 'PRICE_2' | 'PRICE_3'> = {
  PRICE_1: 'PRICE_2', PRICE_2: 'PRICE_3', PRICE_3: 'PRICE_1',
};
const fabricTierShort = (t: string | null | undefined): string =>
  t ? `Price ${t.replace('PRICE_', '')}` : 'Price 1';

const FabricPricingPanel = () => {
  const canEdit   = useProductsMode() === 'full';
  const cfg       = useFabricTierAddonConfig();
  const updateCfg = useUpdateFabricTierAddonConfig();
  const fabrics   = useFabricLibrary();
  const updateTier = useUpdateFabricLibraryTier();

  const [sofa2, setSofa2] = useState<number | ''>('');
  const [sofa3, setSofa3] = useState<number | ''>('');
  const [bed2, setBed2]   = useState<number | ''>('');
  const [bed3, setBed3]   = useState<number | ''>('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (cfg.data) {
      setSofa2(cfg.data.sofaTier2Delta);
      setSofa3(cfg.data.sofaTier3Delta);
      setBed2(cfg.data.bedframeTier2Delta);
      setBed3(cfg.data.bedframeTier3Delta);
    }
  }, [cfg.data]);

  const onSave = async () => {
    setError(null); setSuccess(false);
    if ([sofa2, sofa3, bed2, bed3].some((v) => typeof v !== 'number')) {
      setError('All four amounts must be whole-number RM.'); return;
    }
    try {
      await updateCfg.mutateAsync({
        sofaTier2Delta: sofa2 as number, sofaTier3Delta: sofa3 as number,
        bedframeTier2Delta: bed2 as number, bedframeTier3Delta: bed3 as number,
      });
      setSuccess(true);
    } catch (err) { setError(String((err as Error).message ?? err)); }
  };

  const cycle = (row: FabricLibraryRow, field: 'sofaTier' | 'bedframeTier') => {
    if (!canEdit) return;
    const current = (field === 'sofaTier' ? row.sofaTier : row.bedframeTier) ?? 'PRICE_1';
    updateTier.mutate({ id: row.id, field, tier: FABRIC_TIER_NEXT[current] ?? 'PRICE_2' });
  };

  const numField = (
    id: string, label: string, hint: string, value: number | '', setValue: (v: number | '') => void,
  ) => (
    <div style={{ marginBottom: 'var(--space-4)', minWidth: 180, flex: '1 1 180px' }}>
      <label htmlFor={id} style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 'var(--space-1)' }}>{label}</label>
      <input
        id={id} type="number" min={0} step={1} value={value} disabled={!canEdit}
        onChange={(e) => setValue(e.target.value === '' ? '' : Math.max(0, Math.floor(Number(e.target.value))))}
        style={{ width: '100%', padding: '8px 10px', fontSize: 'var(--fs-14)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)', background: canEdit ? 'var(--c-cream)' : 'rgba(34, 31, 32, 0.04)' }}
      />
      <span style={{ display: 'block', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 'var(--space-1)' }}>{hint}</span>
    </div>
  );

  const tierBtn = (row: FabricLibraryRow, field: 'sofaTier' | 'bedframeTier') => {
    const t = field === 'sofaTier' ? row.sofaTier : row.bedframeTier;
    return (
      <button
        type="button" disabled={!canEdit} onClick={() => cycle(row, field)}
        title={canEdit ? 'Click to cycle Price 1 → 2 → 3' : undefined}
        style={{
          padding: '4px 10px', fontSize: 'var(--fs-13)', borderRadius: 'var(--radius-md)',
          border: '1px solid var(--line)', cursor: canEdit ? 'pointer' : 'default',
          background: (t && t !== 'PRICE_1') ? 'var(--c-cream)' : 'transparent',
          fontWeight: (t && t !== 'PRICE_1') ? 600 : 400,
        }}
      >
        {fabricTierShort(t)}
      </button>
    );
  };

  return (
    <div style={{ padding: 'var(--space-5)', maxWidth: 820 }}>
      <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginBottom: 'var(--space-4)' }}>
        每件 sofa / bedframe 选到高一级的布，整单 on-top 加这里设定的金额（每件各加一次，像 delivery fee）。
        Price 1 = base（加 0）。改这里只动 POS 卖价，不动成本 / 采购。
      </p>

      <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap' }}>
        {numField('ft-s2', 'Sofa · Price 2 (+RM)', 'Added once when a sofa uses a Price-2 fabric.', sofa2, setSofa2)}
        {numField('ft-s3', 'Sofa · Price 3 (+RM)', 'Added once when a sofa uses a Price-3 fabric.', sofa3, setSofa3)}
        {numField('ft-b2', 'Bedframe · Price 2 (+RM)', 'Added once when a bedframe uses a Price-2 fabric.', bed2, setBed2)}
        {numField('ft-b3', 'Bedframe · Price 3 (+RM)', 'Added once when a bedframe uses a Price-3 fabric.', bed3, setBed3)}
      </div>

      {error && <div style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginBottom: 'var(--space-3)' }} role="alert">{error}</div>}
      {success && <div style={{ color: 'var(--fg-muted)', fontSize: 'var(--fs-13)', marginBottom: 'var(--space-3)' }}>Saved.</div>}
      {canEdit && (
        <Button variant="primary" onClick={() => void onSave()} disabled={updateCfg.isPending}>
          {updateCfg.isPending ? 'Saving…' : 'Save amounts'}
        </Button>
      )}

      <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 600, margin: 'var(--space-6) 0 var(--space-1)' }}>Fabric tiers</h3>
      <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginBottom: 'var(--space-3)' }}>
        {canEdit ? 'Click a tier to cycle Price 1 → 2 → 3. Sofa and bedframe are independent.' : 'Read-only — only Master Admin can change fabric tiers.'}
      </p>
      {updateTier.isError && (
        <div role="alert" style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', marginBottom: 'var(--space-3)' }}>
          Tier change failed: {String((updateTier.error as Error)?.message ?? updateTier.error)}
        </div>
      )}
      {fabrics.isLoading ? (
        <div style={{ color: 'var(--fg-muted)' }}>Loading fabrics…</div>
      ) : (fabrics.data ?? []).length === 0 ? (
        <div style={{ color: 'var(--fg-muted)' }}>No fabrics yet — add them in the Backend Fabric Converter.</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', maxWidth: 560 }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              <th style={{ padding: '6px 8px' }}>Fabric</th>
              <th style={{ padding: '6px 8px' }}>Sofa tier</th>
              <th style={{ padding: '6px 8px' }}>Bedframe tier</th>
            </tr>
          </thead>
          <tbody>
            {(fabrics.data ?? []).map((row) => (
              <tr key={row.id} style={{ borderTop: '1px solid var(--line)' }}>
                <td style={{ padding: '6px 8px', fontSize: 'var(--fs-14)' }}>{row.label}</td>
                <td style={{ padding: '6px 8px' }}>{tierBtn(row, 'sofaTier')}</td>
                <td style={{ padding: '6px 8px' }}>{tierBtn(row, 'bedframeTier')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

/* ─── Product Add-ons manager (migration 0134) ────────────────────────────
   The grown-up "Specials": per-Model product add-on with a selling surcharge
   + 0..N follow-up choice groups (e.g. Right Drawer → Thickness 10″/8″), shown
   as an SO line description, not a SKU. Edits the special_addons table via
   /special-addons. Self-contained (own queries + role gate), mounted by the
   MaintenanceList dispatch under the Special Add-ons tab. */
const SA_CATEGORIES = ['BEDFRAME', 'MATTRESS', 'SOFA'] as const;
const senToRm = (sen: number): number => Math.round(sen) / 100;
const rmToSen = (rm: number): number => Math.round(rm * 100);

const emptySpecialAddon = (): SpecialAddonInput => ({
  code: '', label: '', soDescription: '', categories: [],
  sellingPriceSen: 0, costPriceSen: 0, optionGroups: [], active: true, sortOrder: 0,
});

const SpecialAddonsManager = () => {
  const canEdit = useProductsMode() === 'full';
  const list    = useSpecialAddons();
  const create  = useCreateSpecialAddon();
  const update  = useUpdateSpecialAddon();
  const del     = useDeleteSpecialAddon();

  const [editing, setEditing] = useState<{ id: string | null; draft: SpecialAddonInput } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const startNew = () => { setError(null); setEditing({ id: null, draft: emptySpecialAddon() }); };
  const startEdit = (row: SpecialAddonRow) => {
    setError(null);
    setEditing({ id: row.id, draft: {
      code: row.code, label: row.label, soDescription: row.soDescription,
      categories: [...row.categories], sellingPriceSen: row.sellingPriceSen,
      costPriceSen: row.costPriceSen, optionGroups: JSON.parse(JSON.stringify(row.optionGroups)),
      active: row.active, sortOrder: row.sortOrder,
    } });
  };

  const patch = (p: Partial<SpecialAddonInput>) =>
    setEditing((e) => (e ? { ...e, draft: { ...e.draft, ...p } } : e));

  const toggleCat = (cat: string) => {
    if (!editing) return;
    const has = editing.draft.categories.includes(cat);
    patch({ categories: has ? editing.draft.categories.filter((c) => c !== cat) : [...editing.draft.categories, cat] });
  };

  // ── option_groups (追问) editing ────────────────────────────────────────
  const setGroups = (groups: SpecialAddonGroup[]) => patch({ optionGroups: groups });
  const addGroup = () => editing && setGroups([...editing.draft.optionGroups, { label: '', required: true, choices: [{ label: '', extraSen: 0 }] }]);
  const removeGroup = (gi: number) => editing && setGroups(editing.draft.optionGroups.filter((_, i) => i !== gi));
  const patchGroup = (gi: number, p: Partial<SpecialAddonGroup>) =>
    editing && setGroups(editing.draft.optionGroups.map((g, i) => (i === gi ? { ...g, ...p } : g)));
  const addChoice = (gi: number) =>
    editing && patchGroup(gi, { choices: [...editing.draft.optionGroups[gi]!.choices, { label: '', extraSen: 0 }] });
  const patchChoice = (gi: number, ci: number, p: Partial<{ label: string; extraSen: number }>) =>
    editing && patchGroup(gi, { choices: editing.draft.optionGroups[gi]!.choices.map((c, i) => (i === ci ? { ...c, ...p } : c)) });
  const removeChoice = (gi: number, ci: number) =>
    editing && patchGroup(gi, { choices: editing.draft.optionGroups[gi]!.choices.filter((_, i) => i !== ci) });

  const save = async () => {
    if (!editing) return;
    setError(null);
    const d = editing.draft;
    if (!d.code.trim() || !d.label.trim()) { setError('Code and label are required.'); return; }
    if (d.categories.length === 0) { setError('Pick at least one category.'); return; }
    for (const g of d.optionGroups) {
      if (!g.label.trim()) { setError('Every follow-up question needs a label.'); return; }
      if (g.choices.length === 0 || g.choices.some((c) => !c.label.trim())) { setError(`"${g.label || 'question'}" needs at least one named choice.`); return; }
    }
    try {
      if (editing.id) await update.mutateAsync({ id: editing.id, patch: d });
      else await create.mutateAsync(d);
      setEditing(null);
    } catch (err) { setError(String((err as Error).message ?? err)); }
  };

  const remove = async (row: SpecialAddonRow) => {
    if (!window.confirm(`Delete "${row.label}"? This removes the add-on definition (existing orders keep their saved text).`)) return;
    setError(null);
    try { await del.mutateAsync(row.id); if (editing?.id === row.id) setEditing(null); }
    catch (err) { setError(String((err as Error).message ?? err)); }
  };

  const rm = (sen: number) => `${sen < 0 ? '−' : '+'}RM ${Math.abs(senToRm(sen)).toLocaleString('en-MY')}`;
  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 'var(--fs-14)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)', background: 'var(--c-cream)' };

  return (
    <div style={{ padding: 'var(--space-5)', maxWidth: 860 }}>
      <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginBottom: 'var(--space-4)' }}>
        每个 add-on = 名字 + SO 描述 + 适用 Category + 加价（可为负 = 减价）+ 0~多个追问（如 Right Drawer → 10″/8″，每个选项可各带价）。
        勾哪个 Model 用，在 <strong>Modular</strong> tab 决定。只动 POS 卖价，不开新 SKU、不动成本。
      </p>

      {canEdit && !editing && (
        <Button variant="primary" size="sm" onClick={startNew}>+ New add-on</Button>
      )}
      {error && <div style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', margin: 'var(--space-3) 0' }} role="alert">{error}</div>}

      {/* ── Editor ── */}
      {editing && (
        <div style={{ border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', margin: 'var(--space-3) 0', background: 'var(--c-paper, #fff)' }}>
          <h3 style={{ fontSize: 'var(--fs-15)', fontWeight: 600, marginBottom: 'var(--space-3)' }}>
            {editing.id ? `Edit · ${editing.draft.label || editing.draft.code}` : 'New special add-on'}
          </h3>
          <div style={{ display: 'flex', gap: 'var(--space-4)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            <label style={{ flex: '1 1 220px' }}>
              <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>Code (stable key)</span>
              <input style={inputStyle} value={editing.draft.code} disabled={!!editing.id}
                onChange={(e) => patch({ code: e.target.value })} placeholder="Right Drawer" />
              {editing.id && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>Code can't change after creation (it's the Model/order key).</span>}
            </label>
            <label style={{ flex: '1 1 220px' }}>
              <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>Label</span>
              <input style={inputStyle} value={editing.draft.label} onChange={(e) => patch({ label: e.target.value })} placeholder="Right Drawer" />
            </label>
          </div>
          <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}>
            <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>SO description (prints under the product)</span>
            <input style={inputStyle} value={editing.draft.soDescription} onChange={(e) => patch({ soDescription: e.target.value })} placeholder="Right pull-out drawer" />
          </label>

          <div style={{ display: 'flex', gap: 'var(--space-5)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            <div>
              <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>Categories</span>
              <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                {SA_CATEGORIES.map((cat) => (
                  <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-13)' }}>
                    <input type="checkbox" checked={editing.draft.categories.includes(cat)} onChange={() => toggleCat(cat)} />
                    {cat}
                  </label>
                ))}
              </div>
            </div>
            <label>
              <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>Base price (RM, can be −)</span>
              <input type="number" step={1} style={{ ...inputStyle, width: 140 }}
                value={senToRm(editing.draft.sellingPriceSen)}
                onChange={(e) => patch({ sellingPriceSen: rmToSen(Number(e.target.value) || 0) })} />
            </label>
            <label style={{ display: 'flex', alignItems: 'flex-end', gap: 6, fontSize: 'var(--fs-13)' }}>
              <input type="checkbox" checked={editing.draft.active} onChange={(e) => patch({ active: e.target.checked })} />
              Active
            </label>
          </div>

          {/* option_groups */}
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 'var(--space-3)', marginBottom: 'var(--space-3)' }}>
            <span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 6 }}>Follow-up questions (optional)</span>
            {editing.draft.optionGroups.map((g, gi) => (
              <div key={gi} style={{ border: '1px solid var(--line)', borderRadius: 'var(--radius-md)', padding: 'var(--space-3)', marginBottom: 'var(--space-2)' }}>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center', marginBottom: 6 }}>
                  <input style={{ ...inputStyle, flex: '1 1 160px' }} placeholder="Question (e.g. Thickness)" value={g.label} onChange={(e) => patchGroup(gi, { label: e.target.value })} />
                  <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 'var(--fs-12)' }}>
                    <input type="checkbox" checked={g.required} onChange={(e) => patchGroup(gi, { required: e.target.checked })} /> required
                  </label>
                  <button type="button" onClick={() => removeGroup(gi)} style={{ fontSize: 'var(--fs-12)', color: 'var(--c-burnt, #A6471E)', background: 'none', border: 'none', cursor: 'pointer' }}>remove ✕</button>
                </div>
                {g.choices.map((c, ci) => (
                  <div key={ci} style={{ display: 'flex', gap: 'var(--space-2)', marginBottom: 4, paddingLeft: 'var(--space-3)' }}>
                    <input style={{ ...inputStyle, flex: '1 1 120px' }} placeholder={'Choice (e.g. 10")'} value={c.label} onChange={(e) => patchChoice(gi, ci, { label: e.target.value })} />
                    <input type="number" step={1} style={{ ...inputStyle, width: 120 }} title="Extra RM (can be −)" value={senToRm(c.extraSen)} onChange={(e) => patchChoice(gi, ci, { extraSen: rmToSen(Number(e.target.value) || 0) })} />
                    <button type="button" onClick={() => removeChoice(gi, ci)} style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', background: 'none', border: 'none', cursor: 'pointer' }}>✕</button>
                  </div>
                ))}
                <button type="button" onClick={() => addChoice(gi)} style={{ fontSize: 'var(--fs-12)', marginLeft: 'var(--space-3)', background: 'none', border: '1px dashed var(--line-strong)', borderRadius: 'var(--radius-sm)', padding: '2px 8px', cursor: 'pointer' }}>+ choice</button>
              </div>
            ))}
            <button type="button" onClick={addGroup} style={{ fontSize: 'var(--fs-13)', background: 'none', border: '1px dashed var(--line-strong)', borderRadius: 'var(--radius-md)', padding: '4px 10px', cursor: 'pointer' }}>+ Add question</button>
          </div>

          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <Button variant="primary" size="sm" onClick={() => void save()} disabled={create.isPending || update.isPending}>
              {create.isPending || update.isPending ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => { setEditing(null); setError(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {/* ── List ── */}
      {list.isLoading ? (
        <div style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-3)' }}>Loading add-ons…</div>
      ) : list.error ? (
        <div style={{ color: 'var(--c-burnt, #A6471E)', marginTop: 'var(--space-3)' }}>Failed to load: {String(list.error)}</div>
      ) : (list.data ?? []).length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-3)' }}>No special add-ons yet.</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 'var(--space-3)' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              <th style={{ padding: '6px 8px' }}>Add-on</th>
              <th style={{ padding: '6px 8px' }}>Categories</th>
              <th style={{ padding: '6px 8px' }}>Base</th>
              <th style={{ padding: '6px 8px' }}>Follow-up</th>
              <th style={{ padding: '6px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((row) => (
              <tr key={row.id} style={{ borderTop: '1px solid var(--line)', opacity: row.active ? 1 : 0.5 }}>
                <td style={{ padding: '6px 8px', fontSize: 'var(--fs-14)' }}>
                  <div style={{ fontWeight: 600 }}>{row.label}</div>
                  <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{row.soDescription || row.code}</div>
                </td>
                <td style={{ padding: '6px 8px', fontSize: 'var(--fs-12)' }}>{row.categories.join(', ') || '—'}</td>
                <td style={{ padding: '6px 8px', fontSize: 'var(--fs-13)', fontWeight: 600, whiteSpace: 'nowrap' }}>{rm(row.sellingPriceSen)}</td>
                <td style={{ padding: '6px 8px', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                  {row.optionGroups.length === 0 ? '—' : row.optionGroups.map((g) => `${g.label} (${g.choices.length})`).join(' · ')}
                </td>
                <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {canEdit && (
                    <>
                      <button type="button" onClick={() => startEdit(row)} style={{ fontSize: 'var(--fs-12)', background: 'none', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '3px 10px', cursor: 'pointer', marginRight: 6 }}>Edit</button>
                      <button type="button" onClick={() => void remove(row)} style={{ fontSize: 'var(--fs-12)', background: 'none', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '3px 10px', cursor: 'pointer', color: 'var(--c-burnt, #A6471E)' }}>Delete</button>
                    </>
                  )}
                  {!row.active && <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginLeft: 6 }}>off</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
};

/* ─── Order Add-ons manager (editor moved from Backend, 2026-06-02) ────────
   Whole-order one-time fees (Dispose old mattress/bedframe, Lift access).
   Picked at checkout (handover), not bound to a Model. Edits the `addons`
   table directly (RLS write = is_admin). Ported from the retired Backend
   Add-ons page; same fields (kind / per-floor / stock). */
const OA_ICONS = ['recycle', 'arrow-up-from-line', 'wrench', 'package', 'sparkles'];
const OA_KINDS: { value: 'qty' | 'flat' | 'floors_items'; label: string }[] = [
  { value: 'qty', label: 'Per piece (RM × qty)' },
  { value: 'flat', label: 'Flat fee (one-shot)' },
  { value: 'floors_items', label: 'Per floor · item (lift)' },
];
const oaSlugify = (s: string): string =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50);

const OrderAddonsManager = () => {
  const canEdit = useProductsMode() === 'full';
  const list    = useAllAddons();
  const update  = useUpdateAddon();
  const create  = useCreateAddon();
  const del     = useDeleteAddon();

  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const remove = async (row: AdminAddonRow) => {
    if (!window.confirm(`Delete "${row.label}"? This permanently removes the add-on. If it's already on existing orders the delete is blocked — use the Off switch to retire it instead.`)) return;
    setError(null);
    try {
      await del.mutateAsync(row.id);
    } catch (e) {
      const msg = String((e as { message?: string }).message ?? e);
      setError(/foreign key|23503|still referenced/i.test(msg)
        ? `"${row.label}" is used on existing orders — can't delete. Use the Off switch to retire it.`
        : msg);
    }
  };
  const [draft, setDraft] = useState({
    label: '', id: '', description: '', icon: 'package',
    kind: 'qty' as 'qty' | 'flat' | 'floors_items', category: '',
    price: '', perFloorItem: '', unit: '', serviceSku: '', enabled: true,
  });
  const setD = (p: Partial<typeof draft>) => setDraft((d) => ({ ...d, ...p }));

  /* Per-add-on SERVICE SKU (migration 0160). A custom SVC-* code books the
     add-on under its own SERVICE line instead of the generic SVC-ADDON
     bucket. The SO-create Edge #4 gate requires the code to exist in
     mfg_products, so saving a code mints the SERVICE catalog row through the
     same POST /mfg-products the SKU Master uses — its duplicate_code 409
     just means the row is already there (idempotent). */
  const mintSvc = useCreateMfgProduct();
  const SVC_RE = /^SVC-[A-Z0-9-]+$/;
  const SVC_FORMAT_MSG = 'SKU code must look like SVC-DISPOSE-WARDROBE (SVC- then capitals, digits, dashes).';
  const ensureSvcCatalogRow = async (code: string, label: string): Promise<void> => {
    try {
      await mintSvc.mutateAsync({ code, name: label, category: 'SERVICE' });
    } catch (e) {
      const msg = String((e as Error).message ?? e);
      if (!msg.includes('duplicate_code')) throw e; // already in the catalog = fine
    }
  };
  const commitSku = async (row: AdminAddonRow, raw: string): Promise<void> => {
    setError(null);
    const svc = raw.trim().toUpperCase();
    if ((svc || null) === (row.serviceSku ?? null)) return;
    if (svc && !SVC_RE.test(svc)) { setError(SVC_FORMAT_MSG); return; }
    try {
      if (svc) await ensureSvcCatalogRow(svc, row.label);
      update.mutate({ id: row.id, patch: { serviceSku: svc || null } }, { onError: (e) => setError(String((e as Error).message ?? e)) });
    } catch (e) { setError(String((e as Error).message ?? e)); }
  };

  /* Loo 2026-06-06 — ONE switch: Enabled and show_at_handover always move
     together (On = saleable AND shown at handover; Off = fully off). The two
     DB flags stay (the handover screen filters on showAtHandover && enabled),
     this editor just never lets them diverge. */
  const commitField = (row: AdminAddonRow, patch: { price?: number; perFloorItem?: number | null; enabled?: boolean }) => {
    setError(null);
    const synced = patch.enabled !== undefined ? { ...patch, showAtHandover: patch.enabled } : patch;
    update.mutate({ id: row.id, patch: synced }, { onError: (e) => setError(String((e as Error).message ?? e)) });
  };

  const submitNew = async () => {
    setError(null);
    const id = (draft.id || oaSlugify(draft.label)).trim();
    if (!draft.label.trim()) { setError('Label is required.'); return; }
    if (!/^[a-z0-9-]+$/.test(id)) { setError('ID must be lowercase letters, digits, dashes.'); return; }
    if ((list.data ?? []).some((a) => a.id === id)) { setError(`ID "${id}" already exists.`); return; }
    const isFloors = draft.kind === 'floors_items';
    const rate = Math.round(Number(isFloors ? draft.perFloorItem : draft.price) || 0);
    /* > 0, not ≥ 0 — a 0 rate stores fine but computeAddonServiceLines skips
       the line at SO create (unitSen <= 0 guard), so the charge would vanish
       from the SO with no error: a silent undercharge. */
    if (rate <= 0) {
      setError(isFloors
        ? 'Per floor·item rate must be above 0 — a 0 rate books nothing on the SO.'
        : 'Price must be above 0 — a RM0 add-on books nothing on the SO.');
      return;
    }
    const svc = draft.serviceSku.trim().toUpperCase();
    if (svc && !SVC_RE.test(svc)) { setError(SVC_FORMAT_MSG); return; }
    const maxSort = (list.data ?? []).reduce((m, a) => Math.max(m, a.sortOrder), 0);
    try {
      if (svc) await ensureSvcCatalogRow(svc, draft.label.trim());
      await create.mutateAsync({
        id, label: draft.label.trim(), description: draft.description.trim() || null,
        icon: draft.icon, kind: draft.kind, category: draft.category.trim() || null,
        price: isFloors ? 0 : rate, perFloorItem: isFloors ? rate : null,
        // flat = charged once per order; a per-unit label would be misleading.
        unit: draft.kind === 'flat' ? null : (draft.unit.trim() || null),
        stock: null, enabled: draft.enabled,
        // ONE switch (Loo 2026-06-06): handover visibility follows Enabled.
        showAtHandover: draft.enabled, serviceSku: svc || null, sortOrder: maxSort + 1,
      });
      setCreating(false);
      setDraft({ label: '', id: '', description: '', icon: 'package', kind: 'qty', category: '', price: '', perFloorItem: '', unit: '', serviceSku: '', enabled: true });
    } catch (e) { setError(String((e as Error).message ?? e)); }
  };

  const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 10px', fontSize: 'var(--fs-14)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-md)', background: 'var(--c-cream)' };

  return (
    <div style={{ padding: 'var(--space-5)', maxWidth: 820 }}>
      <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', marginBottom: 'var(--space-4)' }}>
        整单一次性费用（处理旧床垫/床架、Lift 上楼）。结账时选，不绑 Model。这里设价钱 / 开关 / 新增。
        （从 Backend 的 Add-ons 页搬过来；编辑限 Master Admin。）
      </p>

      {canEdit && !creating && <Button variant="primary" size="sm" onClick={() => { setError(null); setCreating(true); }}>+ New order add-on</Button>}
      {error && <div style={{ color: 'var(--c-burnt, #A6471E)', fontSize: 'var(--fs-13)', margin: 'var(--space-3) 0' }} role="alert">{error}</div>}

      {creating && (
        <div style={{ border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-lg)', padding: 'var(--space-4)', margin: 'var(--space-3) 0' }}>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            <label style={{ flex: '1 1 200px' }}><span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>Label</span>
              <input style={inputStyle} value={draft.label} onChange={(e) => setD({ label: e.target.value, id: oaSlugify(e.target.value) })} placeholder="Dispose old wardrobe" /></label>
            <label style={{ flex: '1 1 160px' }}><span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>ID slug</span>
              <input style={inputStyle} value={draft.id} onChange={(e) => setD({ id: e.target.value })} placeholder="auto from label" /></label>
          </div>
          <label style={{ display: 'block', marginBottom: 'var(--space-3)' }}><span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>Description</span>
            <input style={inputStyle} value={draft.description} onChange={(e) => setD({ description: e.target.value })} placeholder="Short tagline (optional)" /></label>
          <div style={{ display: 'flex', gap: 'var(--space-3)', flexWrap: 'wrap', marginBottom: 'var(--space-3)' }}>
            <label><span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>Kind</span>
              <select style={{ ...inputStyle, width: 200 }} value={draft.kind} onChange={(e) => setD({ kind: e.target.value as typeof draft.kind })}>
                {OA_KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}
              </select></label>
            <label><span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>{draft.kind === 'floors_items' ? 'Per floor·item (RM)' : 'Price (RM)'}</span>
              <input type="number" min={0} step={1} style={{ ...inputStyle, width: 140 }}
                value={draft.kind === 'floors_items' ? draft.perFloorItem : draft.price}
                onChange={(e) => draft.kind === 'floors_items' ? setD({ perFloorItem: e.target.value }) : setD({ price: e.target.value })} /></label>
            {/* flat = charged once per order; offering a per-unit label here
                produced "RM89 per pillow" cards that always billed ×1. */}
            {draft.kind !== 'flat' && (
              <label><span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>Unit</span>
                <input style={{ ...inputStyle, width: 120 }} value={draft.unit} onChange={(e) => setD({ unit: e.target.value })} placeholder="piece" /></label>
            )}
            <label><span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>SKU code</span>
              <input style={{ ...inputStyle, width: 200, textTransform: 'uppercase' }} value={draft.serviceSku}
                onChange={(e) => setD({ serviceSku: e.target.value.toUpperCase() })} placeholder="SVC-… (optional)" /></label>
            <label><span style={{ display: 'block', fontSize: 'var(--fs-13)', fontWeight: 600, marginBottom: 4 }}>Icon</span>
              <select style={{ ...inputStyle, width: 160 }} value={draft.icon} onChange={(e) => setD({ icon: e.target.value })}>
                {OA_ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select></label>
          </div>
          {draft.kind === 'flat' && (
            <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', margin: '0 0 var(--space-3)' }}>
              Flat fee is charged once per order — staff get no quantity field at checkout. Use “Per piece” for per-unit items.
            </p>
          )}
          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', margin: '0 0 var(--space-3)' }}>
            SKU code gives this add-on its own SVC-* line on the SO (reports aggregate per code). Leave blank to book under the generic SVC-ADDON.
          </p>
          <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
            <Button variant="primary" size="sm" onClick={() => void submitNew()} disabled={create.isPending}>{create.isPending ? 'Creating…' : 'Create'}</Button>
            <Button variant="ghost" size="sm" onClick={() => { setCreating(false); setError(null); }}>Cancel</Button>
          </div>
        </div>
      )}

      {list.isLoading ? (
        <div style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-3)' }}>Loading…</div>
      ) : list.error ? (
        <div style={{ color: 'var(--c-burnt, #A6471E)', marginTop: 'var(--space-3)' }}>Failed to load: {String(list.error)}</div>
      ) : (list.data ?? []).length === 0 ? (
        <div style={{ color: 'var(--fg-muted)', marginTop: 'var(--space-3)' }}>No order add-ons yet.</div>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: 'var(--space-3)' }}>
          <thead>
            <tr style={{ textAlign: 'left', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
              <th style={{ padding: '6px 8px' }}>Add-on</th>
              <th style={{ padding: '6px 8px' }}>Kind</th>
              <th style={{ padding: '6px 8px' }}>SKU code</th>
              <th style={{ padding: '6px 8px' }}>{'Price / rate (RM)'}</th>
              <th style={{ padding: '6px 8px' }}>Enabled</th>
              <th style={{ padding: '6px 8px' }}></th>
            </tr>
          </thead>
          <tbody>
            {(list.data ?? []).map((row) => {
              const isFloors = row.kind === 'floors_items';
              return (
                <tr key={row.id} style={{ borderTop: '1px solid var(--line)', opacity: row.enabled ? 1 : 0.55 }}>
                  <td style={{ padding: '6px 8px', fontSize: 'var(--fs-14)' }}>
                    <div style={{ fontWeight: 600 }}>{row.label}</div>
                    <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{row.description || row.id}</div>
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{isFloors ? 'floor·item' : row.kind}</td>
                  <td style={{ padding: '6px 8px' }}>
                    {canEdit ? (
                      <input style={{ width: 170, padding: '4px 8px', fontSize: 'var(--fs-12)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--c-cream)', textTransform: 'uppercase' }}
                        defaultValue={row.serviceSku ?? ''} placeholder="SVC-ADDON"
                        onBlur={(e) => { void commitSku(row, e.target.value); }} />
                    ) : (
                      <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>{row.serviceSku ?? 'SVC-ADDON'}</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {canEdit ? (
                      <input type="number" min={1} step={1} style={{ width: 100, padding: '4px 8px', fontSize: 'var(--fs-13)', border: '1px solid var(--line-strong)', borderRadius: 'var(--radius-sm)', background: 'var(--c-cream)' }}
                        defaultValue={isFloors ? (row.perFloorItem ?? 0) : row.price}
                        onBlur={(e) => {
                          const n = Math.max(0, Math.round(Number(e.target.value) || 0));
                          const current = isFloors ? (row.perFloorItem ?? 0) : row.price;
                          if (n === current) return;
                          /* Same > 0 rule as create — a 0 rate silently books
                             nothing on the SO. Retire an add-on with Off. */
                          if (n <= 0) { setError(`"${row.label}": rate must be above 0 — a 0 rate books nothing on the SO. Use the Off switch to retire it.`); return; }
                          if (isFloors) commitField(row, { perFloorItem: n });
                          else commitField(row, { price: n });
                        }} />
                    ) : (
                      <span style={{ fontSize: 'var(--fs-13)' }}>RM {(isFloors ? row.perFloorItem ?? 0 : row.price).toLocaleString('en-MY')}</span>
                    )}
                    <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginLeft: 6 }}>{isFloors ? `per floor·${row.unit ?? 'item'}` : row.kind === 'flat' ? 'charged once' : `per ${row.unit ?? 'piece'}`}</span>
                  </td>
                  <td style={{ padding: '6px 8px' }}>
                    {/* ONE switch (Loo 2026-06-06): On = saleable + shown at
                        handover; Off = fully off. commitField keeps the two
                        DB flags in lockstep. */}
                    <button type="button" role="switch" aria-checked={row.enabled} disabled={!canEdit}
                      onClick={() => canEdit && commitField(row, { enabled: !row.enabled })}
                      style={{ fontSize: 'var(--fs-12)', padding: '3px 10px', borderRadius: 999, border: '1px solid var(--line)', cursor: canEdit ? 'pointer' : 'default', background: row.enabled ? 'var(--c-cream)' : 'transparent', fontWeight: row.enabled ? 600 : 400 }}>
                      {row.enabled ? 'On' : 'Off'}
                    </button>
                  </td>
                  <td style={{ padding: '6px 8px', textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {canEdit && (
                      <button type="button" onClick={() => void remove(row)} disabled={del.isPending}
                        style={{ fontSize: 'var(--fs-12)', background: 'none', border: '1px solid var(--line)', borderRadius: 'var(--radius-sm)', padding: '3px 10px', cursor: 'pointer', color: 'var(--c-burnt, #A6471E)' }}>
                        Delete
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
};

const FabricsMaintenancePanel = () => {
  const [search, setSearch] = useState('');
  const { data, isLoading, error } = useFabricTrackings({
    search: search.trim() || undefined,
  });
  const rows = data ?? [];
  /* POS port: read the role here so the table renders inert when the user
     can't write. FabricsTable supports a readonly prop that wraps the
     whole card with pointer-events:none. Fabrics editing is admin-only
     in the tightened gate — sales_director cannot edit existing fabric
     tier mappings, so we collapse 'add-only' + 'view' down to readonly. */
  const readonly = useProductsMode() !== 'full';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 360 }}>
          <Search
            {...ICON_PROPS}
            style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--fg-muted)', pointerEvents: 'none' }}
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by code or description…"
            style={{
              width: '100%',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-14)',
              background: 'var(--c-paper)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              padding: 'var(--space-2) var(--space-3) var(--space-2) var(--space-7)',
              color: 'var(--c-ink)',
              outline: 'none',
            }}
          />
        </div>
        {/* /fabric-tracking lives on Backend — POS doesn't have it. Hide the
            link entirely to avoid 404s from sales-side staff who click. */}
      </div>
      <FabricsTable rows={rows} isLoading={isLoading} error={error} readonly={readonly} />
    </div>
  );
};

/* ════════════════════════════════════════════════════════════════════════
   New SKU drawer — create a fresh mfg_product. Category drives which
   fields are shown (mattress hides Price 1, sofa shows Base Model, etc.).
   ════════════════════════════════════════════════════════════════════════ */

const NewSkuDrawer = ({ onClose }: { onClose: () => void }) => {
  const create = useCreateMfgProduct();
  type Cat = 'BEDFRAME' | 'SOFA' | 'ACCESSORY' | 'MATTRESS' | 'SERVICE';
  /* 2990 is a trading company — no in-house manufacturing. Production-time
     tracking dropped (was HOOKKA legacy). DB column production_time_minutes
     stays for now but the UI no longer collects it. */
  const [form, setForm] = useState<{
    code: string; name: string; category: Cat;
    description: string; baseModel: string; sizeLabel: string;
    branding: string; fabricColor: string;
    basePrice: string; price1: string; costPrice: string;
    unitM3: string;
  }>({
    code: '', name: '', category: 'BEDFRAME',
    description: '', baseModel: '', sizeLabel: '',
    branding: '', fabricColor: '',
    basePrice: '', price1: '', costPrice: '',
    unitM3: '',
  });
  const set = <K extends keyof typeof form>(k: K, v: typeof form[K]) =>
    setForm((s) => ({ ...s, [k]: v }));

  const isMattress = form.category === 'MATTRESS';
  const isSofa = form.category === 'SOFA';
  const isService = form.category === 'SERVICE';

  const submit = () => {
    if (!form.code.trim()) { alert('Code is required.'); return; }
    if (!form.name.trim()) { alert('Name is required.'); return; }
    const toSen = (s: string): number | null => {
      const t = s.trim();
      if (!t) return null;
      const n = Number(t);
      return Number.isFinite(n) ? Math.round(n * 100) : null;
    };
    const toMilli = (s: string): number => {
      const t = s.trim();
      if (!t) return 0;
      const n = Number(t);
      return Number.isFinite(n) ? Math.round(n * 1000) : 0;
    };
    create.mutate({
      code: form.code.trim(),
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim() || undefined,
      baseModel: form.baseModel.trim() || undefined,
      sizeLabel: form.sizeLabel.trim() || undefined,
      branding: form.branding.trim() || undefined,
      fabricColor: form.fabricColor.trim() || undefined,
      basePriceSen: toSen(form.basePrice),
      price1Sen: isMattress || isService ? null : toSen(form.price1),
      costPriceSen: toSen(form.costPrice) ?? 0,
      unitM3Milli: toMilli(form.unitM3),
    }, { onSuccess: onClose });
  };

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
        <header className={styles.drawerHeader}>
          <h2 className={styles.drawerTitle}>New SKU</h2>
          <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON_PROPS} /></button>
        </header>
        <div className={styles.drawerBody}>
          <div className={styles.formGrid}>
            <Field label="Code *" value={form.code} onChange={(v) => set('code', v)} />
            <Field label="Name *" value={form.name} onChange={(v) => set('name', v)} />
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Category *</span>
              <select className={styles.fieldSelect} value={form.category}
                onChange={(e) => set('category', e.target.value as Cat)}>
                <option value="BEDFRAME">Bedframe</option>
                <option value="SOFA">Sofa</option>
                <option value="MATTRESS">Mattress</option>
                <option value="ACCESSORY">Accessory</option>
                <option value="SERVICE">Service</option>
              </select>
            </label>
            <Field label="Size Label" value={form.sizeLabel} onChange={(v) => set('sizeLabel', v)} />
            {isSofa && <Field label="Base Model" value={form.baseModel} onChange={(v) => set('baseModel', v)} />}
            {isMattress && <Field label="Branding" value={form.branding} onChange={(v) => set('branding', v)} placeholder="e.g. Sealy" />}
            {isSofa && <Field label="Fabric Color" value={form.fabricColor} onChange={(v) => set('fabricColor', v)} />}
            <Field label="Description" value={form.description} onChange={(v) => set('description', v)} fullWidth />

            <Field label={isMattress ? 'Price (RM)' : 'Base Price / Price 2 (RM)'}
              value={form.basePrice} onChange={(v) => set('basePrice', v)} type="number" />
            {!isMattress && !isService && (
              <Field label="Price 1 (RM)" value={form.price1} onChange={(v) => set('price1', v)} type="number" />
            )}
            {/* POS port: Cost Price field stripped — sales side doesn't
                set purchase cost. costPriceSen sent as 0; if commander
                wants to set it, they do it from Backend. */}
            <Field label="Unit (m³)" value={form.unitM3} onChange={(v) => set('unitM3', v)} type="number" step="0.001" />
            {/* Production Time field removed — 2990 is a trading company (PR-strip-production). */}
          </div>
        </div>
        <footer className={styles.drawerFooter}>
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={submit} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Create SKU'}
          </Button>
        </footer>
      </aside>
    </div>
  );
};

const Field = ({
  label, value, onChange, type, step, placeholder, fullWidth,
}: {
  label: string; value: string;
  onChange: (v: string) => void;
  type?: string; step?: string; placeholder?: string;
  fullWidth?: boolean;
}) => (
  <label className={`${styles.field} ${fullWidth ? styles.formGridFull : ''}`}>
    <span className={styles.fieldLabel}>{label}</span>
    <input
      type={type ?? 'text'}
      step={step}
      placeholder={placeholder}
      className={styles.fieldInput}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  </label>
);

/* ════════════════════════════════════════════════════════════════════════
   PR #38 — ProductSuppliersDrawer
   Double-click a product row to see every supplier that carries it,
   their supplier-side SKU + unit price + lead time. The MAIN supplier
   (used by default on POs) is starred and pinned to the top.
   ════════════════════════════════════════════════════════════════════════ */

const fmtDateTime = (iso: string): string => {
  const d = new Date(iso);
  return Number.isFinite(d.getTime())
    ? d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' })
    : iso;
};

const fmtRmCenti = (centi: number): string =>
  `RM ${(centi / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/* ────────────────────────────────────────────────────────────────────────
   D7 (Phase 3) — Free-gifts editor. Master Account sets the permanent free
   add-ons included with a SKU (e.g. a mattress ships with 2 pillows). Writes
   mfg_products.included_addons ({addonId, qty}[]); the POS Configurator renders
   "× N INCLUDED". DISPLAY-ONLY — no inventory or cost deduction (D7).
   ──────────────────────────────────────────────────────────────────────── */
const ProductGiftsDrawer = ({
  row, onClose,
}: { row: MfgProductRow; onClose: () => void }) => {
  const addons = useAddons();
  const update = useUpdateMfgProductGifts();
  const [gifts, setGifts] = useState<{ addonId: string; qty: number }[]>(row.included_addons ?? []);
  const [pickAddon, setPickAddon] = useState('');
  const [pickQty, setPickQty] = useState(1);

  const addonsById = useMemo(() => {
    const m = new Map<string, AddonRow>();
    for (const a of addons.data ?? []) m.set(a.id, a);
    return m;
  }, [addons.data]);

  const persist = (next: { addonId: string; qty: number }[]) => {
    setGifts(next);
    update.mutate({ id: row.id, includedAddons: next });
  };
  const addGift = () => {
    if (!pickAddon) return;
    const existing = gifts.find((g) => g.addonId === pickAddon);
    const next = existing
      ? gifts.map((g) => (g.addonId === pickAddon ? { ...g, qty: g.qty + pickQty } : g))
      : [...gifts, { addonId: pickAddon, qty: pickQty }];
    persist(next);
    setPickAddon('');
    setPickQty(1);
  };
  const removeGift = (addonId: string) => persist(gifts.filter((g) => g.addonId !== addonId));

  const inputStyle = {
    padding: '8px 10px',
    fontSize: 'var(--fs-14)',
    border: '1px solid var(--line-strong)',
    borderRadius: 'var(--radius-md)',
    background: 'var(--c-cream)',
  } as const;

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--c-cream)',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-3)',
          width: 'min(520px, 95vw)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header className={styles.drawerHeader}>
          <div>
            <h2 className={styles.drawerTitle}>
              <Gift {...ICON_PROPS} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Free gifts · <span className={styles.codeChip}>{row.code}</span>
            </h2>
            <p style={{ marginTop: 4, fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
              Included free with this SKU — shown as “× N INCLUDED” in the configurator.
              Display-only; no stock is deducted.
            </p>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose}>
            <X {...ICON_PROPS} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
          {gifts.length === 0 && (
            <div style={{ textAlign: 'center', padding: 'var(--space-5)', color: 'var(--fg-muted)' }}>
              <Gift size={32} strokeWidth={1.5} />
              <div style={{ marginTop: 8 }}>No free gifts on this SKU yet.</div>
            </div>
          )}
          {gifts.map((g) => {
            const a = addonsById.get(g.addonId);
            return (
              <div
                key={g.addonId}
                style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0', borderBottom: '1px solid var(--line-strong)' }}
              >
                <span style={{ flex: 1, fontWeight: 600 }}>{a?.label ?? g.addonId}</span>
                <span style={{ fontSize: 'var(--fs-12)', fontWeight: 700, color: 'var(--c-orange)', whiteSpace: 'nowrap' }}>× {g.qty} FREE</span>
                <button type="button" className={styles.iconBtn} onClick={() => removeGift(g.addonId)} aria-label={`Remove ${a?.label ?? 'gift'}`}>
                  <X size={14} strokeWidth={1.75} />
                </button>
              </div>
            );
          })}

          <div style={{ display: 'flex', gap: 8, marginTop: 'var(--space-4)', alignItems: 'center' }}>
            <select value={pickAddon} onChange={(e) => setPickAddon(e.target.value)} style={{ ...inputStyle, flex: 1 }}>
              <option value="">Pick an add-on…</option>
              {(addons.data ?? []).filter((a) => a.enabled).map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
            <input
              type="number"
              min={1}
              max={20}
              value={pickQty}
              onChange={(e) => setPickQty(Math.min(20, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
              style={{ ...inputStyle, width: 64 }}
              aria-label="Quantity"
            />
            <Button variant="primary" onClick={addGift} disabled={!pickAddon || update.isPending}>Add</Button>
          </div>
        </div>
      </div>
    </div>
  );
};

const ProductSuppliersDrawer = ({
  row, onClose,
}: { row: MfgProductRow; onClose: () => void }) => {
  const q = useMfgProductSuppliers(row.id);
  const suppliers = q.data?.suppliers ?? [];

  return (
    <div className={styles.drawerBackdrop} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--c-cream)',
          border: '1px solid var(--line-strong)',
          borderRadius: 'var(--radius-xl)',
          boxShadow: 'var(--shadow-3)',
          width: 'min(820px, 95vw)',
          maxHeight: '85vh',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <header className={styles.drawerHeader}>
          <div>
            <h2 className={styles.drawerTitle}>
              <Truck {...ICON_PROPS} style={{ verticalAlign: 'middle', marginRight: 6 }} />
              Suppliers · <span className={styles.codeChip}>{row.code}</span>
            </h2>
            <p style={{ marginTop: 4, fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
              {row.name}{row.description ? ` — ${row.description}` : ''}
            </p>
          </div>
          <button type="button" className={styles.iconBtn} onClick={onClose}>
            <X {...ICON_PROPS} />
          </button>
        </header>

        <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
          {q.isLoading && (
            <p style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>Loading suppliers…</p>
          )}
          {!q.isLoading && suppliers.length === 0 && (
            <div style={{ textAlign: 'center', padding: 'var(--space-6)', color: 'var(--fg-muted)' }}>
              <Truck size={32} strokeWidth={1.5} />
              <div style={{ marginTop: 8 }}>No suppliers carry this product yet.</div>
              <div style={{ marginTop: 4, fontSize: 'var(--fs-12)' }}>
                Go to Suppliers → Detail → Add Mapping to link a supplier to this SKU.
              </div>
            </div>
          )}
          {!q.isLoading && suppliers.length > 0 && (
            <table className={styles.table} style={{ width: '100%' }}>
              <thead>
                <tr>
                  <th style={{ width: 32 }}></th>
                  <th>Supplier</th>
                  <th>Supplier SKU</th>
                  <th style={{ textAlign: 'right' }}>Unit Price</th>
                  <th style={{ textAlign: 'right' }}>Lead (d)</th>
                  <th style={{ textAlign: 'right' }}>MOQ</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s: ProductSupplierRow) => (
                  <tr key={s.id} style={{
                    background: s.is_main_supplier ? 'rgba(232, 107, 58, 0.06)' : undefined,
                  }}>
                    <td style={{ textAlign: 'center' }}>
                      {s.is_main_supplier && (
                        <Star size={14} strokeWidth={2} style={{ color: 'var(--c-orange)', fill: 'var(--c-orange)' }} />
                      )}
                    </td>
                    <td>
                      <div style={{ fontWeight: s.is_main_supplier ? 700 : 400 }}>
                        {s.suppliers?.name ?? '—'}
                      </div>
                      <div style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                        {s.suppliers?.code ?? ''}{s.suppliers?.phone ? ` · ${s.suppliers.phone}` : ''}
                      </div>
                    </td>
                    <td>
                      {s.supplier_sku
                        ? <span className={styles.codeChip}>{s.supplier_sku}</span>
                        : <span style={{ color: 'var(--fg-muted)' }}>(same as our code)</span>}
                    </td>
                    <td className={styles.numCell}>
                      {fmtRmCenti(s.unit_price_centi)}{s.currency !== 'MYR' ? ` ${s.currency}` : ''}
                    </td>
                    <td className={styles.numCell}>{s.lead_time_days || '—'}</td>
                    <td className={styles.numCell}>{s.moq || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className={styles.drawerFooter}>
          <p style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginRight: 'auto' }}>
            <Star size={11} strokeWidth={2} style={{ verticalAlign: 'middle', color: 'var(--c-orange)', fill: 'var(--c-orange)' }} />
            {' '}Main supplier — used by default when generating POs.
          </p>
          <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
        </footer>
      </div>
    </div>
  );
};


/* ════════════════════════════════════════════════════════════════════════
   Maintenance History dialog — shows config snapshots over time
   ════════════════════════════════════════════════════════════════════════ */

const MaintenanceHistoryDialog = ({
  activeLabel,
  activeKey,
  history,
  onClose,
}: {
  activeLabel: string;
  activeKey: MaintenanceListKey;
  history: import('../lib/products/mfg-products-queries').MaintenanceHistoryRow[];
  onClose: () => void;
}) => (
  <div className={styles.drawerBackdrop} onClick={onClose}>
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'var(--c-cream)',
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-3)',
        width: 'min(720px, 95vw)',
        maxHeight: '85vh',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <header className={styles.drawerHeader}>
        <h2 className={styles.drawerTitle}>Maintenance history · {activeLabel}</h2>
        <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON_PROPS} /></button>
      </header>
      <div style={{ flex: 1, overflowY: 'auto', padding: 'var(--space-4)' }}>
        {history.length === 0 && (
          <p style={{ textAlign: 'center', color: 'var(--fg-muted)' }}>
            No maintenance changes yet — the baseline migration row is the only entry.
          </p>
        )}
        {history.map((entry) => {
          const sectionValue = (entry.config as unknown as Record<string, unknown>)[activeKey];
          return (
            <div key={entry.id} style={{
              padding: 'var(--space-3)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-3)',
              background: entry.isPending ? 'rgba(232, 107, 58, 0.06)' : 'var(--c-paper)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontFamily: 'var(--font-mark)', fontSize: 'var(--fs-16)', fontWeight: 700, color: 'var(--c-ink)' }}>
                  Effective from {entry.effectiveFrom}
                </span>
                {entry.isPending && (
                  <span style={{ background: 'rgba(232, 107, 58, 0.20)', color: 'var(--c-burnt)', padding: '2px 8px', borderRadius: 'var(--radius-pill)', fontSize: 'var(--fs-11)', fontWeight: 600 }}>
                    PENDING
                  </span>
                )}
              </div>
              <div style={{ marginTop: 4, fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
                Created {fmtDateTime(entry.createdAt)}{entry.createdBy ? ` by ${entry.createdBy.slice(0, 8)}` : ''}
              </div>
              {entry.notes && (
                <p style={{ marginTop: 6, fontSize: 'var(--fs-13)', color: 'var(--c-ink)' }}>Notes: {entry.notes}</p>
              )}
              <pre style={{
                marginTop: 8,
                padding: 'var(--space-2)',
                background: 'var(--c-cream)',
                border: '1px solid var(--line)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--fs-11)',
                overflow: 'auto',
                maxHeight: 200,
              }}>
                {JSON.stringify(sectionValue, null, 2)}
              </pre>
            </div>
          );
        })}
      </div>
      <footer className={styles.drawerFooter}>
        <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
      </footer>
    </div>
  </div>
);

/* ════════════════════════════════════════════════════════════════════════
   CSV Export + Import
   ════════════════════════════════════════════════════════════════════════ */

// PR #104 — Commander 2026-05-26: "fabric_usage_centi / production_time_minutes
// / fabric_color 全删 不需要这个功能". These manufacturing-specific fields
// were ported in from HOOKKA but don't apply to 2990's retail catalogue;
// dropping them from the CSV export so commander's spreadsheet stays focused.
// Schema columns + API field writers also stripped (apps/api/src/routes/
// mfg-products.ts) so future imports don't resurrect the data.
/* POS port: cost columns are kept OUT of the CSV. cost_price_sen was always
   dropped; post-0109 base_price_sen / price1_sen now mean COST too, so they
   are dropped as well — sales-side exports carry only the customer-facing
   SELLING price (sell_price_sen), never purchase cost. */
const CSV_COLUMNS = [
  'code', 'name', 'category', 'description', 'base_model', 'size_label',
  'sell_price_sen',
  'unit_m3_milli',
  'status', 'branding',
] as const;

function exportSkusCsv(rows: MfgProductRow[]): void {
  const lines: string[] = [CSV_COLUMNS.join(',')];
  for (const r of rows) {
    const cells = CSV_COLUMNS.map((col) => {
      const v = (r as unknown as Record<string, unknown>)[col];
      if (v == null) return '';
      const s = String(v);
      // RFC4180: quote if contains comma, quote, or newline
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    });
    lines.push(cells.join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `2990s-skus-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

const ImportSkusDialog = ({ onClose }: { onClose: () => void }) => (
  <div className={styles.drawerBackdrop} onClick={onClose}>
    <div
      onClick={(e) => e.stopPropagation()}
      style={{
        background: 'var(--c-cream)',
        border: '1px solid var(--line-strong)',
        borderRadius: 'var(--radius-xl)',
        boxShadow: 'var(--shadow-3)',
        width: 'min(560px, 95vw)',
        padding: 'var(--space-5)',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
        <h2 className={styles.drawerTitle}>Import SKUs</h2>
        <button type="button" className={styles.iconBtn} onClick={onClose}><X {...ICON_PROPS} /></button>
      </header>
      <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
        CSV import wires through the new POST /mfg-products endpoint one row at a time.
        For bulk seeding (200+ rows at once) keep using the SQL seed file —
        the row-by-row path here is meant for &lt;50 edits.
      </p>
      <input type="file" accept=".csv" style={{ marginTop: 'var(--space-3)' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          alert(`CSV upload received: ${f.name} (${f.size} bytes). Server-side batch import endpoint TODO — for now use seed SQL.`);
        }} />
      <footer style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
        <Button variant="ghost" size="md" onClick={onClose}>Close</Button>
      </footer>
    </div>
  </div>
);

/* ════════════════════════════════════════════════════════════════════════
   PR #89 — Click-to-edit cell for SKU Master code + name columns.
   Same UX as Fabric Converter DescriptionCell: chip → click → input,
   Enter / blur saves, Esc cancels. inline=true uses regular text styling
   (no chip pill); inline=false uses chipClassName for the resting state.
   ════════════════════════════════════════════════════════════════════════ */
const EditableTextCell = ({
  value, chipClassName, ariaLabel, onSave, inline = false, editable = true,
}: {
  value:          string;
  /** CSS-module class — typed loose so `styles.foo` (which TS treats as
      `string | undefined`) flows in without callers having to coalesce.
      PR #87 merge fix: PR #89 landed with this typed `string` which broke
      the build under `tsc -b --noEmit`. */
  chipClassName:  string | undefined;
  ariaLabel:      string;
  onSave:         (val: string) => void;
  inline?:        boolean;
  /** PR #95 — Commander 2026-05-26: gate click-to-edit behind the parent
      table's edit mode. When false, the cell renders as plain text/chip
      and any click is ignored. Defaults to true so existing callers
      (Fabric Converter description cell, etc.) keep working. */
  editable?:      boolean;
}) => {
  const [editing, setEditing] = useState(false);
  const [draft,   setDraft]   = useState(value);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === value.trim()) {
      setEditing(false);
      setDraft(value);
      return;
    }
    onSave(trimmed);
    setEditing(false);
  };
  const cancel = () => { setDraft(value); setEditing(false); };

  if (!editing) {
    // PR #95 — Read-only mode. Same visual chip / inline text but no
    // click target, no cursor pointer, no "Click to edit" tooltip.
    if (!editable) {
      return inline ? (
        <span className={chipClassName}>{value}</span>
      ) : (
        <span className={chipClassName}>{value}</span>
      );
    }
    return inline ? (
      <div
        role="button"
        tabIndex={0}
        className={chipClassName}
        title="Click to edit"
        onClick={() => { setDraft(value); setEditing(true); }}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setDraft(value); setEditing(true); } }}
        style={{ cursor: 'pointer' }}
      >
        {value}
      </div>
    ) : (
      <button
        type="button"
        className={chipClassName}
        title="Click to edit"
        aria-label={ariaLabel}
        onClick={() => { setDraft(value); setEditing(true); }}
        style={{ cursor: 'pointer' }}
      >
        {value}
      </button>
    );
  }
  return (
    <input
      autoFocus
      type="text"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter')      { e.preventDefault(); commit(); }
        else if (e.key === 'Escape') { e.preventDefault(); cancel(); }
      }}
      style={{
        fontFamily: inline ? 'var(--font-sans)' : 'var(--font-mono)',
        fontSize:   'var(--fs-13)',
        fontWeight: 600,
        padding:    '4px 8px',
        border:     '1px solid var(--c-orange)',
        borderRadius: 'var(--radius-sm)',
        background: 'var(--c-cream)',
        outline:    'none',
        width:      '100%',
        maxWidth:   320,
      }}
    />
  );
};
