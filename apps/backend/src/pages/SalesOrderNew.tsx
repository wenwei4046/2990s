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

import { useMemo, useState } from 'react';
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

  const subtotalCenti = useMemo(
    () => lines.reduce(
      (s, l) => s + Math.max(0, l.qty * l.unitPriceCenti - l.discountCenti),
      0,
    ),
    [lines],
  );

  // ── Locality cascades ──────────────────────────────────────────────
  const locRows = loc.data ?? [];
  const states  = useMemo(() => distinctStates(locRows), [locRows]);
  const cities  = useMemo(() => state ? citiesInState(locRows, state) : [], [locRows, state]);
  const postcodes = useMemo(
    () => (state && city) ? postcodesInCity(locRows, state, city) : [],
    [locRows, state, city],
  );

  const canSave = debtorName.trim().length > 0;

  const onSave = () => {
    if (!canSave) {
      window.alert('Customer name is required.');
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
        // Address — only sent when "fill later" isn't checked
        ...(fillAddressLater ? {} : {
          address1: address1 || undefined,
          address2: address2 || undefined,
          customerState: state || undefined,
          city: city || undefined,
          postcode: postcode || undefined,
          buildingType: buildingType || undefined,
        }),
        emergencyContactName:         emergencyName  || undefined,
        emergencyContactRelationship: emergencyRel   || undefined,
        emergencyContactPhone:        emergencyPhone || undefined,
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
            disabled={create.isPending || !canSave}
          >
            <Save {...ICON} />
            {create.isPending ? 'Saving…' : 'Save SO (Draft)'}
          </Button>
        </div>
      </div>

      {/* ── PR #121 — Order Details (POS layout) ─────────────────────
           Commander 2026-05-26: "Order Details 那边就跟着我的 POS System
           的一模一样". Single tight card with Customer autocomplete +
           Delivery Hub + PO/SO No + Reference + dates + notes. Sits
           ABOVE the deeper Customer / Address / Emergency cards so the
           common-case "existing customer" flow stays one card. */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Order Details</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer *</span>
              <input
                type="text"
                list="so-debtor-list"
                value={debtorName}
                onChange={(e) => {
                  const v = e.target.value;
                  setDebtorName(v);
                  // If the typed value matches a known debtor (picked from datalist),
                  // adopt its code + phone + addresses so the deeper Customer card
                  // shows the snapshot — saves commander typing the same info twice.
                  const picked = (debtors.data?.debtors ?? []).find((d) => d.debtor_name === v);
                  if (picked) {
                    if (picked.debtor_code) setDebtorCode(picked.debtor_code);
                    if (picked.phone && !phone) setPhone(picked.phone);
                    if (picked.address1 && !address1) setAddress1(picked.address1);
                    if (picked.address2 && !address2) setAddress2(picked.address2);
                  }
                }}
                placeholder="Type 2+ chars to search prior customers…"
                className={styles.fieldInput}
                required
              />
              <datalist id="so-debtor-list">
                {(debtors.data?.debtors ?? []).map((d, i) => (
                  <option key={`${d.debtor_code ?? 'nc'}-${i}`} value={d.debtor_name ?? ''}>
                    {[d.debtor_code, d.phone].filter(Boolean).join(' · ')}
                  </option>
                ))}
              </datalist>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Delivery Hub *</span>
              <select value={hubId} onChange={(e) => setHubId(e.target.value)} className={styles.fieldInput} required>
                <option value="">— Pick a hub / warehouse —</option>
                {(warehouses.data ?? []).map((w) => (
                  <option key={w.id} value={w.id}>{w.code} · {w.name}</option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer PO No.</span>
              <input type="text" value={customerPo} onChange={(e) => setCustomerPo(e.target.value)} className={styles.fieldInput} placeholder="e.g. PO-AK-2026-001" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer SO No.</span>
              <input type="text" value={customerSoNo} onChange={(e) => setCustomerSoNo(e.target.value)} className={styles.fieldInput} placeholder="Customer's own SO# (from their ERP)" />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Reference</span>
              <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} className={styles.fieldInput} placeholder="Optional free-text ref" />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Company SO Date</span>
              <input type="date" value={soDate} onChange={(e) => setSoDate(e.target.value)} className={styles.fieldInput} />
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer Delivery Date</span>
              <input type="date" value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} className={styles.fieldInput} />
            </label>
            <label className={`${styles.field} ${styles.fieldSpan2 ?? ''}`} style={{ gridColumn: '1 / -1' }}>
              <span className={styles.fieldLabel}>Notes</span>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Internal notes — visible on the SO detail page"
                className={styles.fieldInput}
                rows={3}
                style={{ resize: 'vertical', minHeight: 80 }}
              />
            </label>
          </div>
        </div>
      </section>

      {/* ── Customer ────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Customer</h2>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Full Name *</span>
              <input
                type="text"
                value={debtorName}
                onChange={(e) => setDebtorName(e.target.value)}
                className={styles.fieldInput}
                placeholder="e.g. Lim Mei Hua"
                required
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Phone</span>
              <input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+60 12 345 6789"
                className={styles.fieldInput}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.fieldLabel}>Email</span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com — for receipt & order updates"
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Salesperson</span>
              <select
                value={salespersonId}
                onChange={(e) => setSalespersonId(e.target.value)}
                className={styles.fieldInput}
              >
                <option value="">—</option>
                {(staff.data ?? []).filter((s) => s.active).map((s) => (
                  <option key={s.id} value={s.id}>{s.staffCode} · {s.name}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer Type</span>
              <select
                value={customerType}
                onChange={(e) => setCustomerType(e.target.value as typeof customerType)}
                className={styles.fieldInput}
              >
                <option value="">—</option>
                {CUSTOMER_TYPES.map((t) => <option key={t} value={t}>{t === 'NEW' ? 'New' : 'Existing'}</option>)}
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* ── Delivery Address ────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Delivery Address</h2>
        </div>
        <div className={styles.cardBody}>
          {/* "Fill in address later" — defers full address capture until
              dispatch. POS uses the same checkbox so commander can take an
              order without making the customer wait. */}
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

          <div className={styles.formGrid2} style={{ opacity: fillAddressLater ? 0.4 : 1, pointerEvents: fillAddressLater ? 'none' : 'auto' }}>
            <label className={`${styles.field} ${styles.fieldFull}`}>
              <span className={styles.fieldLabel}>Address Line 1</span>
              <input
                type="text"
                value={address1}
                onChange={(e) => setAddress1(e.target.value)}
                placeholder="Unit, street, area"
                className={styles.fieldInput}
              />
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
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
                className={styles.fieldInput}
              >
                <option value="">—</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>City</span>
              <select
                value={city}
                onChange={(e) => { setCity(e.target.value); setPostcode(''); }}
                className={styles.fieldInput}
                disabled={!state}
              >
                <option value="">{state ? '—' : '(Pick state first)'}</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>

            <label className={styles.field}>
              <span className={styles.fieldLabel}>Postcode</span>
              <select
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                className={styles.fieldInput}
                disabled={!state || !city}
              >
                <option value="">{(state && city) ? '—' : '(Pick city first)'}</option>
                {postcodes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Building Type</span>
              <select
                value={buildingType}
                onChange={(e) => setBuildingType(e.target.value as typeof buildingType)}
                className={styles.fieldInput}
              >
                <option value="">—</option>
                {BUILDING_TYPES.map((b) => <option key={b} value={b}>{b}</option>)}
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* ── Emergency Contact ───────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Emergency Contact</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            Used only if we cannot reach the customer on delivery day
          </span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
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
                className={styles.fieldInput}
              >
                <option value="">—</option>
                {RELATIONSHIP_OPTIONS.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </label>
            <label className={`${styles.field} ${styles.fieldFull}`}>
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
        </div>
      </section>

      {/* ── Processing + Delivery Dates ────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Dates</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            Processing Date = when we start production · Delivery Date = customer's expected delivery
          </span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Processing Date</span>
              <input
                type="date"
                value={processingDate}
                onChange={(e) => setProcessingDate(e.target.value)}
                className={styles.fieldInput}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Delivery Date</span>
              <input
                type="date"
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                className={styles.fieldInput}
              />
            </label>
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
          {lines.map((line, idx) => (
            <SoLineCard
              key={line.rid}
              index={idx}
              draft={line}
              onChange={(patch) => updateLine(line.rid, patch)}
              onRemove={() => dropLine(line.rid)}
              canRemove={lines.length > 1}
            />
          ))}

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

      {/* PR #121 — bottom Notes section removed; Notes now lives inside the
          top Order Details card (POS layout). */}
    </div>
  );
};
