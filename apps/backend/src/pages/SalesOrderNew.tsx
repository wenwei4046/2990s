// ----------------------------------------------------------------------------
// SalesOrderNew — full-page Create SO at /mfg-sales-orders/new.
//
// PR #113 — POS-aligned customer fields. Commander 2026-05-26 compared this
// page with the POS handover screen (Customer / Address / Emergency / Target
// date) and pointed out the backend form was missing every field beyond a
// debtor name + 4 generic address lines. The schema (migration 0060_so_pos_
// alignment) already carries email, customer_type, salesperson_id, city,
// postcode, building_type, emergency_contact_*, target_date — they just
// weren't exposed in this form.
//
// Layout:
//   CUSTOMER card        — Debtor Name * · Phone · Email · Salesperson · Customer Type
//   DELIVERY ADDRESS     — Address 1 · Address 2 · State (cascade) · City (cascade)
//                          · Postcode · Building Type · "fill later" checkbox
//   EMERGENCY CONTACT    — Name · Relationship · Phone
//   TARGET DATE          — single date picker (POS calls it "target install date")
//   LINES                — existing inline line-item table (PR 3 will swap the
//                          plain-text item code for a Product picker + per-
//                          category variant fields)
//   NOTE                 — internal notes
//
// Saves a single POST to /mfg-sales-orders with all fields filled in camelCase
// (API §POST handler maps each to its snake_case column).
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Plus, Save, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useCreateMfgSalesOrder, useDebtorSearch } from '../lib/flow-queries';
import { useStaff } from '../lib/admin-queries';
import { useWarehouses } from '../lib/inventory-queries';
import {
  useLocalities, distinctStates, citiesInState, postcodesInCity,
  BUILDING_TYPES,
} from '../lib/localities-queries';
import { SoLineCard, emptySoLine, type SoLineDraft } from '../components/SoLineCard';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/* PR #113 — Customer type matches the POS handover dropdown. The column is
   free-text on the schema, but we constrain to two values here so the SO
   list filters stay clean. */
const CUSTOMER_TYPES = ['NEW', 'EXISTING'] as const;

/* PR #113 — Relationship dropdown for emergency contact. Mirrors POS list. */
const RELATIONSHIP_OPTIONS = [
  'Spouse', 'Parent', 'Child', 'Sibling', 'Relative', 'Friend', 'Colleague', 'Other',
] as const;

/* PR #114/#125 — Draft line shape mirrors SoLineDraft from SoLineCard but
   adds a stable React id so the local list can re-order / edit inline. */
type DraftLine = SoLineDraft & { rid: string };

const newLine = (): DraftLine => ({
  ...emptySoLine(),
  rid: `l${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
});

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

export const SalesOrderNew = () => {
  const navigate = useNavigate();
  const create   = useCreateMfgSalesOrder();
  const staff    = useStaff();
  const loc      = useLocalities();

  // ── Customer fields ────────────────────────────────────────────────
  const [debtorCode,    setDebtorCode]    = useState('');
  const [debtorName,    setDebtorName]    = useState('');
  const [phone,         setPhone]         = useState('');
  const [email,         setEmail]         = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [customerType,  setCustomerType]  = useState<'NEW' | 'EXISTING' | ''>('');

  // ── PR #121 — POS-aligned Order Details fields ─────────────────────
  // Drawing from the POS handover layout (Customer · Delivery Hub ·
  // Customer PO No · Customer SO No · Reference · Company SO Date ·
  // Customer Delivery Date · Notes). soDate defaults to today.
  const [soDate,             setSoDate]             = useState(() => new Date().toISOString().slice(0, 10));
  // PR #121 owns `deliveryDate` state (below) — Order Details card binds to
  // that same state so both UIs stay in sync.
  const [customerPo,         setCustomerPo]         = useState('');
  const [customerSoNo,       setCustomerSoNo]       = useState('');
  const [ref,                setRef]                = useState('');
  const [hubId,              setHubId]              = useState('');
  const debtors = useDebtorSearch(debtorName.trim().length >= 2 ? debtorName.trim() : '');
  const warehouses = useWarehouses();
  const hubName = useMemo(() => (warehouses.data ?? []).find((w) => w.id === hubId)?.name ?? '', [warehouses.data, hubId]);

  // ── Delivery address ───────────────────────────────────────────────
  const [fillAddressLater, setFillAddressLater] = useState(false);
  const [address1,    setAddress1]    = useState('');
  const [address2,    setAddress2]    = useState('');
  const [state,       setState]       = useState('');
  const [city,        setCity]        = useState('');
  const [postcode,    setPostcode]    = useState('');
  const [buildingType, setBuildingType] = useState<typeof BUILDING_TYPES[number] | ''>('');

  // ── Emergency contact ──────────────────────────────────────────────
  const [emergencyName,  setEmergencyName]   = useState('');
  const [emergencyRel,   setEmergencyRel]    = useState<typeof RELATIONSHIP_OPTIONS[number] | ''>('');
  const [emergencyPhone, setEmergencyPhone]  = useState('');

  // ── Dates ──────────────────────────────────────────────────────────
  // PR #121 — Commander 2026-05-26: "应该是 processing date 和 delivery
  // date，而不是 target date". HOOKKA pattern (SO create page L703-707):
  //   Processing Date → when manufacturing starts (maps to internal_expected_dd)
  //   Delivery Date   → when customer expects delivery (maps to customer_delivery_date)
  // The target_date column stays on the schema for POS handover compatibility
  // but isn't surfaced here anymore.
  const [processingDate, setProcessingDate] = useState('');
  const [deliveryDate,   setDeliveryDate]   = useState('');

  // ── Payment (PR #148 / #150) ──────────────────────────────────────
  // Commander 2026-05-26: "event installment 也是 under merchant 的".
  // 3 top-level methods (merchant / transfer / cash); when merchant is
  // picked we further capture: provider, normal-vs-installment, term
  // (6/12 if installment), and an approval_code from the auth slip.
  type PaymentMethod = 'cash' | 'transfer' | 'merchant' | '';
  const [paymentMethod,     setPaymentMethod]     = useState<PaymentMethod>('');
  const [installmentMonths, setInstallmentMonths] = useState<number | null>(null);
  const [merchantProvider,  setMerchantProvider]  = useState<string>('');
  const [approvalCode,      setApprovalCode]      = useState<string>('');
  const [depositCenti,      setDepositCenti]      = useState<number>(0);
  const [paidCenti,         setPaidCenti]         = useState<number>(0);

  // ── Notes ──────────────────────────────────────────────────────────
  const [note, setNote] = useState('');

  // ── Items state ────────────────────────────────────────────────────
  // PR #125 — Each line is an inline editable card (HOOKKA pattern). First
  // card is seeded on mount so commander immediately sees the variant
  // editor instead of needing to click "+ Add line item" first.
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);

  const updateLine = (rid: string, patch: Partial<SoLineDraft>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));

  const addLine  = () => setLines((prev) => [...prev, newLine()]);
  const dropLine = (rid: string) => setLines((prev) => prev.filter((l) => l.rid !== rid));

  /* PR #148 — Commander 2026-05-26: "Hookka 是随着我选的第一个东西，自动
     detect 是不是 sofa、bed frame 还是 mattress". The standalone Sofa Set
     inline bar (PR #142 / #145) was a separate widget that didn't match
     HOOKKA — commander wants the line cards themselves to be the only
     entry point. Each SoLineCard already auto-detects category from the
     picked SKU, and the master-follower cascade (PR #147) keeps variants
     in sync, so the explicit Sofa Set picker was extra clutter. Removed. */

  /* PR #142 / #145 / #147 — Master-follower cascade.
     Commander 2026-05-26:
       "line1 改下面跟着改"
       "可是下面如果改动就会跟着最新改动"
     Behavior:
       - LINE 1 of each category is the MASTER. Its variants drive
         everything else in that category.
       - When master's variant key changes, every follower's same key
         tracks the new value — UNLESS the follower has manually
         overridden that key (tracked by `overriddenKeys`).
       - Once a follower clicks/types into a variant, that key is added
         to its overriddenKeys and never gets cascaded again.
       - Picking a fresh SKU on a line wipes overriddenKeys (clean slate). */
  useEffect(() => {
    // Find master line (and its variants) per category.
    const masterByCategory: Record<string, Record<string, unknown>> = {};
    const masterIdx: Record<string, number> = {};
    lines.forEach((l, idx) => {
      if (!l.itemGroup) return;
      if (masterIdx[l.itemGroup] !== undefined) return;
      masterIdx[l.itemGroup] = idx;
      if (l.variants) masterByCategory[l.itemGroup] = l.variants;
    });

    let didUpdate = false;
    const next = lines.map((l, idx) => {
      if (!l.itemGroup) return l;
      if (masterIdx[l.itemGroup] === idx) return l; // skip the master line itself
      const masterVariants = masterByCategory[l.itemGroup];
      if (!masterVariants) return l;
      const cur = (l.variants ?? {}) as Record<string, unknown>;
      const overridden = new Set(l.overriddenKeys ?? []);
      const patch: Record<string, unknown> = {};
      let hasChange = false;
      for (const k of Object.keys(masterVariants)) {
        if (overridden.has(k)) continue; // follower owns this key
        const masterVal = masterVariants[k];
        if (masterVal === undefined || masterVal === null || masterVal === '') continue;
        if (cur[k] !== masterVal) {
          patch[k] = masterVal;
          hasChange = true;
        }
      }
      if (!hasChange) return l;
      didUpdate = true;
      return { ...l, variants: { ...cur, ...patch } };
    });
    if (didUpdate) setLines(next);
  }, [lines]);

  const subtotalCenti = useMemo(
    () => lines.reduce(
      (s, l) => s + Math.max(0, l.qty * l.unitPriceCenti - l.discountCenti),
      0,
    ),
    [lines],
  );

  /* PR #141 — Per-category variants captured from the FIRST line of that
     category that has any variants set. Passed to every SoLineCard so when
     a subsequent line picks an SKU of the same category, it inherits the
     variants (commander: "正常我的沙发是一整套… 根据第一个 item 带下来"). */
  const inheritVariantsByCategory = useMemo(() => {
    const out: Record<string, Record<string, unknown>> = {};
    for (const l of lines) {
      const cat = l.itemGroup;
      if (!cat || out[cat]) continue;
      if (l.variants && Object.keys(l.variants).length > 0) {
        out[cat] = l.variants;
      }
    }
    return out;
  }, [lines]);

  // ── Locality cascades ──────────────────────────────────────────────
  const locRows = loc.data ?? [];
  const states  = useMemo(() => distinctStates(locRows), [locRows]);
  const cities  = useMemo(() => state ? citiesInState(locRows, state) : [], [locRows, state]);
  const postcodes = useMemo(
    () => (state && city) ? postcodesInCity(locRows, state, city) : [],
    [locRows, state, city],
  );

  const canSave = debtorName.trim().length > 0;

  /* PR #125 — Commander 2026-05-26: "Processing Date 跟 Delivery Date 可以
     两个都没有，或者两个都有，但不能一个有一个没有". XOR is rejected — a
     processing date with no delivery date (or vice versa) is incomplete data
     that breaks downstream production scheduling + customer comms. */
  const datesXor = (processingDate.trim() !== '') !== (deliveryDate.trim() !== '');

  const onSave = () => {
    if (!canSave) {
      window.alert('Customer name is required.');
      return;
    }
    if (datesXor) {
      window.alert(
        'Processing Date and Delivery Date must be set together.\n\n' +
        'Either fill in BOTH dates, or leave BOTH empty — partial dates ' +
        'cause scheduling issues.',
      );
      return;
    }
    const validLines = lines.filter((l) => l.itemCode.trim() && l.qty > 0);
    if (validLines.length === 0) {
      window.alert('Add at least one item via "+ Add line item".');
      return;
    }

    create.mutate(
      {
        debtorName,
        debtorCode: debtorCode || undefined,
        phone: phone || undefined,
        email: email || undefined,
        salespersonId: salespersonId || undefined,
        customerType: customerType || undefined,
        // PR #121 — POS-aligned Order Details fields. customerDeliveryDate
        // is sent below from the existing PR #121 `deliveryDate` state, so
        // it's intentionally omitted here.
        soDate: soDate || undefined,
        customerPo: customerPo || undefined,
        customerSoNo: customerSoNo || undefined,
        ref: ref || undefined,
        hubId: hubId || undefined,
        hubName: hubName || undefined,
        /* PR #148 — Address handling: address1/2 skipped when fill-later
           is on, but State/City/Postcode/BuildingType always submit.
           Commander: "Fill in Address Later 也只是 Address 1 跟 2 不需要
           填写而已. State, City, Postcode 还是需要填写的". */
        address1: fillAddressLater ? undefined : (address1 || undefined),
        address2: fillAddressLater ? undefined : (address2 || undefined),
        customerState: state || undefined,
        city: city || undefined,
        postcode: postcode || undefined,
        buildingType: buildingType || undefined,
        emergencyContactName:         emergencyName  || undefined,
        emergencyContactRelationship: emergencyRel   || undefined,
        emergencyContactPhone:        emergencyPhone || undefined,
        /* PR #148 + #150 — Payment fields. Mirror POS handover + Detail-page card. */
        paymentMethod:     paymentMethod || undefined,
        installmentMonths: installmentMonths ?? undefined,
        merchantProvider:  merchantProvider || undefined,
        approvalCode:      approvalCode || undefined,
        depositCenti:      depositCenti || undefined,
        paidCenti:         paidCenti || undefined,
        /* PR #121 — Processing Date → internal_expected_dd, Delivery Date →
           customer_delivery_date. The API maps these snake-case columns
           directly. */
        internalExpectedDd:   processingDate || undefined,
        customerDeliveryDate: deliveryDate   || undefined,
        note: note || undefined,
        /* PR #114 — full variant payload preserved end-to-end. The API
           handler maps every key (divanHeight / legHeight / gap / fabric
           code / color code / seat height / special / size) into the
           variants JSONB column on mfg_sales_order_items. */
        items: validLines.map((l) => ({
          itemGroup:      l.itemGroup,
          itemCode:       l.itemCode,
          description:    l.description,
          uom:            l.uom,
          qty:            l.qty,
          unitPriceCenti: l.unitPriceCenti,
          discountCenti:  l.discountCenti,
          unitCostCenti:  l.unitCostCenti,
          variants:       l.variants,
          remark:         l.remark,
        })),
      },
      {
        onSuccess: (res: { docNo: string }) => navigate(`/mfg-sales-orders/${res.docNo}`),
        onError:   (err) => window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  return (
    <div className={styles.page}>
      {/* Top bar */}
      <div className={styles.headerRow}>
        <div className={styles.titleBlock}>
          <Link to="/mfg-sales-orders" className={styles.backBtn}>
            <ArrowLeft {...ICON} /> <span>Sales Orders</span>
          </Link>
          <h1 className={styles.title}>New Sales Order</h1>
        </div>
        <div className={styles.actions}>
          <Button variant="ghost" size="md" onClick={() => navigate('/mfg-sales-orders')}>
            <X {...ICON} /> Cancel
          </Button>
          <Button
            variant="primary" size="md"
            onClick={onSave}
            disabled={create.isPending || !canSave || datesXor}
          >
            <Save {...ICON} />
            {create.isPending ? 'Saving…' : 'Create SO'}
          </Button>
        </div>
      </div>

      {/* PR #129 — Commander 2026-05-26: "order details 不需要 删掉".
          Dropped the PR #121 "Order Details" card entirely. State vars
          (debtorCode / customerPo / customerSoNo / ref / hubId / soDate)
          stay declared and are still sent on submit — the existing
          Customer / Address / Emergency / Dates cards below cover the
          common-case flow. Notes lives in its own card at the bottom
          again (restored). */}

      {/* ── Customer · Addresses (PR #154 — single combined card to match
           the SO Detail page layout. Commander 2026-05-27: "Why is my UI
           different when I am creating an SO compared to after the SO is
           created? They should look exactly the same.") ─────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Customer · Addresses</h2>
        </div>
        <div className={styles.cardBody}>
          {/* Customer row */}
          <p className={styles.subHead}>Customer</p>
          <div className={styles.formGrid4}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer Code</span>
              <input
                type="text"
                value={debtorCode}
                onChange={(e) => setDebtorCode(e.target.value)}
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field} style={{ gridColumn: 'span 3' }}>
              <span className={styles.fieldLabel}>Customer Name *</span>
              <input
                type="text"
                value={debtorName}
                onChange={(e) => setDebtorName(e.target.value)}
                placeholder="e.g. Lim Mei Hua"
                className={styles.fieldInput}
                required
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Phone *</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+60 12 345 6789"
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Email *</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer Type</span>
              <select
                value={customerType}
                onChange={(e) => setCustomerType(e.target.value as typeof customerType)}
                className={styles.fieldSelect}
              >
                <option value="">—</option>
                {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t === 'NEW' ? 'New' : 'Existing'}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Salesperson</span>
              <select
                value={salespersonId}
                onChange={(e) => setSalespersonId(e.target.value)}
                className={styles.fieldSelect}
              >
                <option value="">— Pick staff —</option>
                {(staff.data ?? []).filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.staffCode})</option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Building Type</span>
              <select
                value={buildingType}
                onChange={(e) => setBuildingType(e.target.value as typeof buildingType)}
                className={styles.fieldSelect}
              >
                <option value="">—</option>
                {BUILDING_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Processing Date</span>
              <input
                type="date"
                value={processingDate}
                onChange={(e) => setProcessingDate(e.target.value)}
                className={styles.fieldInput}
                style={datesXor && !processingDate ? { borderColor: 'var(--c-festive-b, #B8331F)' } : undefined}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Delivery Date</span>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className={styles.fieldInput}
                style={datesXor && !deliveryDate ? { borderColor: 'var(--c-festive-b, #B8331F)' } : undefined}
              />
            </label>
            <label className={styles.field} style={{ gridColumn: 'span 2' }}>
              <span className={styles.fieldLabel}>Note</span>
              <input
                className={styles.fieldInput}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
            </label>
          </div>
          {datesXor && (
            <div
              style={{
                background: 'rgba(184, 51, 31, 0.08)',
                border: '1px solid var(--c-festive-b, #B8331F)',
                color: 'var(--c-festive-b, #B8331F)',
                padding: 'var(--space-2) var(--space-3)',
                borderRadius: 'var(--radius-md)',
                fontSize: 'var(--fs-12)',
                fontWeight: 600,
                marginTop: 'var(--space-2)',
              }}
            >
              ⚠ Fill in BOTH Processing Date and Delivery Date, or leave BOTH empty.
            </div>
          )}

          {/* Emergency contact */}
          <p className={styles.subHead} style={{ marginTop: 'var(--space-3)' }}>
            Emergency Contact <span className={styles.muted} style={{ fontWeight: 400 }}>
              — used only if we can't reach the customer on delivery day
            </span>
          </p>
          <div className={styles.formGrid4}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Contact Name</span>
              <input
                type="text"
                value={emergencyName}
                onChange={(e) => setEmergencyName(e.target.value)}
                placeholder="e.g. Lim Mei Hua"
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Relationship</span>
              <select
                value={emergencyRel}
                onChange={(e) => setEmergencyRel(e.target.value as typeof emergencyRel)}
                className={styles.fieldSelect}
              >
                <option value="">—</option>
                {RELATIONSHIP_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className={styles.field} style={{ gridColumn: 'span 2' }}>
              <span className={styles.fieldLabel}>Phone</span>
              <input
                type="tel"
                value={emergencyPhone}
                onChange={(e) => setEmergencyPhone(e.target.value)}
                placeholder="+60 12 345 6789"
                className={styles.fieldInput}
              />
            </label>
          </div>

          {/* Delivery address */}
          <p className={styles.subHead} style={{ marginTop: 'var(--space-3)' }}>Delivery Address</p>
          <label
            style={{
              display: 'flex', alignItems: 'flex-start', gap: 'var(--space-3)',
              padding: 'var(--space-3)',
              background: fillAddressLater ? 'rgba(232, 107, 58, 0.08)' : 'var(--c-cream)',
              border: '1px solid ' + (fillAddressLater ? 'var(--c-orange)' : 'var(--line)'),
              borderRadius: 'var(--radius-md)',
              marginBottom: 'var(--space-3)',
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={fillAddressLater}
              onChange={(e) => setFillAddressLater(e.target.checked)}
              style={{ marginTop: 2 }}
            />
            <div>
              <div style={{ fontWeight: 600, fontSize: 'var(--fs-14)' }}>Fill in address later</div>
              <div style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)', marginTop: 2 }}>
                Customer hasn't confirmed delivery address yet — we'll capture it before dispatch.
              </div>
            </div>
          </label>
          <div className={styles.formGrid4}>
            <label
              className={`${styles.field}`}
              style={{ gridColumn: 'span 4', opacity: fillAddressLater ? 0.4 : 1, pointerEvents: fillAddressLater ? 'none' : 'auto' }}
            >
              <span className={styles.fieldLabel}>Address Line 1</span>
              <input
                type="text"
                value={address1}
                onChange={(e) => setAddress1(e.target.value)}
                placeholder="Unit, street, area"
                className={styles.fieldInput}
              />
            </label>
            <label
              className={`${styles.field}`}
              style={{ gridColumn: 'span 4', opacity: fillAddressLater ? 0.4 : 1, pointerEvents: fillAddressLater ? 'none' : 'auto' }}
            >
              <span className={styles.fieldLabel}>Address Line 2</span>
              <input
                type="text"
                value={address2}
                onChange={(e) => setAddress2(e.target.value)}
                placeholder="Apt, floor, building (optional)"
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>State</span>
              <select
                value={state}
                onChange={(e) => { setState(e.target.value); setCity(''); setPostcode(''); }}
                className={styles.fieldSelect}
              >
                <option value="">Pick state</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>City</span>
              <select
                value={city}
                onChange={(e) => { setCity(e.target.value); setPostcode(''); }}
                className={styles.fieldSelect}
                disabled={!state}
              >
                <option value="">{state ? 'Pick city' : '— pick state first'}</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Postcode</span>
              <select
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                className={styles.fieldSelect}
                disabled={!city}
              >
                <option value="">{city ? 'Pick postcode' : '— pick city first'}</option>
                {postcodes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Sales Location</span>
              <span className={styles.fieldInput} style={{
                display: 'inline-flex', alignItems: 'center', height: 32,
                color: 'var(--fg-muted)',
              }}>
                —
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── Items / Lines (PR #125: HOOKKA-pattern inline cards) ─────
           Commander 2026-05-26: "为什么我的 add line 需要这样子，而不是跟
           Hookka 一样". Each line is an inline editable card with product
           picker + per-category variants + pricing visible at once. The
           "+ Add another item" button below appends a fresh empty card. */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Lines</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {lines.length} line{lines.length === 1 ? '' : 's'} · subtotal {fmtRm(subtotalCenti)}
          </span>
        </div>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* PR #148 — Sofa Set bar removed. Each SoLineCard's product
              picker already auto-detects category from the picked SKU,
              and the master-follower cascade keeps variants in sync. */}
          {lines.map((line, idx) => (
            <SoLineCard
              key={line.rid}
              index={idx}
              draft={line}
              onChange={(patch) => updateLine(line.rid, patch)}
              onRemove={() => dropLine(line.rid)}
              canRemove={lines.length > 1}
              inheritVariantsByCategory={inheritVariantsByCategory}
            />
          ))}

          {/* "+ Add another item" stays as the generic single-line add */}
          <button
            type="button"
            onClick={addLine}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 6,
              width: '100%',
              padding: '12px 14px',
              background: 'transparent',
              border: '1px dashed var(--c-orange)',
              borderRadius: 'var(--radius-md)',
              color: 'var(--c-orange)',
              fontFamily: 'var(--font-sans)',
              fontSize: 'var(--fs-13)',
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <Plus {...ICON} /> Add another item
          </button>

          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 'var(--space-2)',
            paddingTop: 'var(--space-3)',
            borderTop: '1px solid var(--line)',
            fontFamily: 'var(--font-mark)',
            fontSize: 'var(--fs-20)',
            fontWeight: 800,
            color: 'var(--c-burnt)',
          }}>
            Subtotal: {fmtRm(subtotalCenti)}
          </div>
        </div>
      </section>

      {/* PR #148 — Payment card on the New SO form (mirrors POS handover +
          SO Detail). Commander 2026-05-26: "为什么我的 POS 里面的 Payment
          那个 Module 还没搬进来呢". */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Payment</h2>
        </div>
        <div className={styles.cardBody}>
          {/* Method buttons — 3 top-level methods. Installment lives under
              Merchant (PR #150). */}
          <p className={styles.subHead}>Method</p>
          <div className={styles.formGrid4} style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 'var(--space-2)' }}>
            {([
              ['merchant', 'Merchant',                  'Card via GHL / HLB / MBB / PBB'],
              ['transfer', 'Bank transfer / DuitNow',   'Slip required'],
              ['cash',     'Cash',                      'Cash received at counter'],
            ] as const).map(([m, label, hint]) => {
              const active = paymentMethod === m;
              return (
                <button
                  key={m}
                  type="button"
                  onClick={() => {
                    setPaymentMethod(m);
                    if (m !== 'merchant') {
                      setMerchantProvider('');
                      setInstallmentMonths(null);
                      setApprovalCode('');
                    } else if (!merchantProvider) {
                      setMerchantProvider('GHL');
                    }
                  }}
                  style={{
                    display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
                    gap: 2, padding: 'var(--space-3)', textAlign: 'left',
                    background: active ? 'rgba(232, 107, 58, 0.10)' : 'var(--c-paper)',
                    border: '1px solid ' + (active ? 'var(--c-orange)' : 'var(--line)'),
                    borderRadius: 'var(--radius-md)',
                    color: active ? 'var(--c-burnt)' : 'var(--c-ink)',
                    cursor: 'pointer', fontFamily: 'var(--font-sans)',
                  }}
                >
                  <strong style={{ fontSize: 'var(--fs-13)' }}>{label}</strong>
                  <span style={{ fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>{hint}</span>
                </button>
              );
            })}
          </div>

          {/* Merchant sub-section: provider + type (normal/installment) +
              term + approval code. All nested under merchant per PR #150. */}
          {paymentMethod === 'merchant' && (
            <div style={{
              marginTop: 'var(--space-3)',
              padding: 'var(--space-3)',
              background: 'var(--c-cream)',
              border: '1px solid var(--line)',
              borderRadius: 'var(--radius-md)',
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
            }}>
              {/* Provider pills */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <span className={styles.fieldLabel}>Merchant</span>
                {(['GHL', 'HLB', 'MBB', 'PBB'] as const).map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setMerchantProvider(p)}
                    style={{
                      fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', fontWeight: 600,
                      padding: '4px 12px', borderRadius: 'var(--radius-pill)',
                      border: '1px solid ' + (merchantProvider === p ? 'var(--c-orange)' : 'var(--line)'),
                      background: merchantProvider === p ? 'rgba(232, 107, 58, 0.12)' : 'var(--c-paper)',
                      color: merchantProvider === p ? 'var(--c-burnt)' : 'var(--c-ink)',
                      cursor: 'pointer',
                    }}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {/* Type: Normal vs Installment */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                <span className={styles.fieldLabel}>Type</span>
                <button
                  type="button"
                  onClick={() => setInstallmentMonths(null)}
                  style={{
                    fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', fontWeight: 600,
                    padding: '4px 12px', borderRadius: 'var(--radius-pill)',
                    border: '1px solid ' + (installmentMonths === null ? 'var(--c-orange)' : 'var(--line)'),
                    background: installmentMonths === null ? 'rgba(232, 107, 58, 0.12)' : 'var(--c-paper)',
                    color: installmentMonths === null ? 'var(--c-burnt)' : 'var(--c-ink)',
                    cursor: 'pointer',
                  }}
                >
                  Normal Swipe
                </button>
                {([6, 12] as const).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setInstallmentMonths(m)}
                    style={{
                      fontFamily: 'var(--font-sans)', fontSize: 'var(--fs-12)', fontWeight: 600,
                      padding: '4px 12px', borderRadius: 'var(--radius-pill)',
                      border: '1px solid ' + (installmentMonths === m ? 'var(--c-orange)' : 'var(--line)'),
                      background: installmentMonths === m ? 'rgba(232, 107, 58, 0.12)' : 'var(--c-paper)',
                      color: installmentMonths === m ? 'var(--c-burnt)' : 'var(--c-ink)',
                      cursor: 'pointer',
                    }}
                  >
                    Installment · {m} months
                  </button>
                ))}
              </div>

              {/* Approval code */}
              <label className={styles.field} style={{ maxWidth: 320 }}>
                <span className={styles.fieldLabel}>Approval Code</span>
                <input
                  type="text"
                  value={approvalCode}
                  onChange={(e) => setApprovalCode(e.target.value)}
                  placeholder="Auth code from terminal receipt"
                  className={styles.fieldInput}
                  style={{ fontFamily: 'var(--font-mono)' }}
                />
              </label>
            </div>
          )}

          {/* Amounts row */}
          <p className={styles.subHead} style={{ marginTop: 'var(--space-4)' }}>Amounts</p>
          <div className={styles.formGrid4}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Subtotal</span>
              <span className={styles.fieldInput} style={{
                display: 'inline-flex', alignItems: 'center', height: 32,
                fontFamily: 'var(--font-mono)', color: 'var(--c-ink)', fontWeight: 600,
              }}>
                {fmtRm(subtotalCenti)}
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>
                Deposit (RM)
                {depositCenti > 0 && depositCenti === Math.round(subtotalCenti / 2) && (
                  <span style={{ marginLeft: 6, fontSize: 'var(--fs-11)', color: 'var(--c-orange)' }}>· 50%</span>
                )}
              </span>
              <input
                type="number" step="0.01" min={0}
                className={styles.fieldInput}
                value={(depositCenti / 100).toFixed(2)}
                onChange={(e) => setDepositCenti(Math.round(Number(e.target.value) * 100) || 0)}
              />
              <button
                type="button"
                onClick={() => setDepositCenti(Math.round(subtotalCenti / 2))}
                disabled={subtotalCenti === 0}
                style={{
                  marginTop: 4,
                  background: 'transparent', border: 'none',
                  color: subtotalCenti === 0 ? 'var(--fg-muted)' : 'var(--c-orange)',
                  cursor: subtotalCenti === 0 ? 'not-allowed' : 'pointer',
                  fontSize: 'var(--fs-11)', fontWeight: 600, padding: 0, textAlign: 'left',
                }}
              >
                Set 50% deposit ({fmtRm(Math.round(subtotalCenti / 2))})
              </button>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Paid (RM)</span>
              <input
                type="number" step="0.01" min={0}
                className={styles.fieldInput}
                value={(paidCenti / 100).toFixed(2)}
                onChange={(e) => setPaidCenti(Math.round(Number(e.target.value) * 100) || 0)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Balance</span>
              <span className={styles.fieldInput} style={{
                display: 'inline-flex', alignItems: 'center', height: 32,
                fontFamily: 'var(--font-mono)',
                color: paidCenti >= subtotalCenti && subtotalCenti > 0
                  ? 'var(--c-secondary-a, #2F5D4F)'
                  : 'var(--c-ink)',
                fontWeight: 600,
              }}>
                {fmtRm(Math.max(0, subtotalCenti - paidCenti))}
              </span>
            </label>
          </div>
        </div>
      </section>

      {/* PR #154 — Standalone Notes card removed (Note now lives in the
          unified Customer · Addresses card to mirror the SO Detail page). */}

    </div>
  );
};
