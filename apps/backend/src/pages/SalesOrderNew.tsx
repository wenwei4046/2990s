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
import { ArrowLeft, Plus, Save, Trash2, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useCreateMfgSalesOrder } from '../lib/flow-queries';
import { useStaff } from '../lib/admin-queries';
import {
  useLocalities, distinctStates, citiesInState, postcodesInCity,
  BUILDING_TYPES,
} from '../lib/localities-queries';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const SO_GROUPS = ['bedframe', 'sofa', 'mattress', 'accessory', 'others'] as const;

/* PR #113 — Customer type matches the POS handover dropdown. The column is
   free-text on the schema, but we constrain to two values here so the SO
   list filters stay clean. */
const CUSTOMER_TYPES = ['NEW', 'EXISTING'] as const;

/* PR #113 — Relationship dropdown for emergency contact. Mirrors POS list. */
const RELATIONSHIP_OPTIONS = [
  'Spouse', 'Parent', 'Child', 'Sibling', 'Relative', 'Friend', 'Colleague', 'Other',
] as const;

type DraftLine = {
  rid: string;
  itemGroup:      (typeof SO_GROUPS)[number];
  itemCode:       string;
  description:    string;
  qty:            number;
  unitPriceCenti: number;
  discountCenti:  number;
  unitCostCenti:  number;
};

const newLine = (group: (typeof SO_GROUPS)[number] = 'bedframe'): DraftLine => ({
  rid: `l${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
  itemGroup: group, itemCode: '', description: '',
  qty: 1, unitPriceCenti: 0, discountCenti: 0, unitCostCenti: 0,
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
  const [debtorName,    setDebtorName]    = useState('');
  const [phone,         setPhone]         = useState('');
  const [email,         setEmail]         = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [customerType,  setCustomerType]  = useState<'NEW' | 'EXISTING' | ''>('');

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

  // ── Target date ────────────────────────────────────────────────────
  const [targetDate, setTargetDate] = useState('');

  // ── Notes ──────────────────────────────────────────────────────────
  const [note, setNote] = useState('');

  // ── Items state ────────────────────────────────────────────────────
  const [lines, setLines] = useState<DraftLine[]>([newLine()]);

  const setLine  = (rid: string, patch: Partial<DraftLine>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));
  const addLine  = () => setLines((prev) => [...prev, newLine('others')]);
  const dropLine = (rid: string) => setLines((prev) =>
    prev.length === 1 ? [newLine()] : prev.filter((l) => l.rid !== rid),
  );

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
      window.alert('Add at least one item with code + qty.');
      return;
    }

    create.mutate(
      {
        debtorName,
        phone: phone || undefined,
        email: email || undefined,
        salespersonId: salespersonId || undefined,
        customerType: customerType || undefined,
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
        targetDate: targetDate || undefined,
        note: note || undefined,
        items: validLines.map((l) => ({
          itemGroup:      l.itemGroup,
          itemCode:       l.itemCode,
          description:    l.description,
          qty:            l.qty,
          unitPriceCenti: l.unitPriceCenti,
          discountCenti:  l.discountCenti,
          unitCostCenti:  l.unitCostCenti,
        })),
      },
      {
        onSuccess: (res: { docNo: string }) => navigate(`/mfg-sales-orders/${res.docNo}`),
        onError:   (err) => window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  const gridTemplate = '110px minmax(160px, 1.2fr) minmax(180px, 1.6fr) 70px 110px 120px 32px';
  const cellPad = 'var(--space-2) var(--space-2)';

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

      {/* ── Target Date ─────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Target Date</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            Customer's preferred install / use date — drives schedule planning
          </span>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.formGrid2}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Target Date</span>
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                className={styles.fieldInput}
              />
            </label>
          </div>
        </div>
      </section>

      {/* ── Items / Lines ───────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Lines</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            {lines.length} line{lines.length === 1 ? '' : 's'} · subtotal {fmtRm(subtotalCenti)}
          </span>
        </div>
        <div className={styles.cardBody}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: gridTemplate,
            gap: 'var(--space-2)',
            padding: cellPad,
            fontFamily: 'var(--font-button)',
            fontSize: 'var(--fs-11)',
            fontWeight: 600,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: 'var(--fg-soft)',
            borderBottom: '1px solid var(--line)',
          }}>
            <div>Group</div>
            <div>Item Code</div>
            <div>Description</div>
            <div style={{ textAlign: 'right' }}>Qty</div>
            <div style={{ textAlign: 'right' }}>Unit Price</div>
            <div style={{ textAlign: 'right' }}>Total</div>
            <div></div>
          </div>

          {lines.map((l) => {
            const lineTotalCenti = Math.max(0, l.qty * l.unitPriceCenti - l.discountCenti);
            return (
              <div
                key={l.rid}
                style={{
                  display: 'grid',
                  gridTemplateColumns: gridTemplate,
                  gap: 'var(--space-2)',
                  padding: cellPad,
                  alignItems: 'center',
                  borderBottom: '1px solid var(--line)',
                }}
              >
                <select
                  value={l.itemGroup}
                  onChange={(e) => setLine(l.rid, { itemGroup: e.target.value as DraftLine['itemGroup'] })}
                  className={styles.fieldInput}
                >
                  {SO_GROUPS.map((g) => <option key={g} value={g}>{g}</option>)}
                </select>
                <input
                  type="text"
                  placeholder="Item code"
                  value={l.itemCode}
                  onChange={(e) => setLine(l.rid, { itemCode: e.target.value })}
                  className={styles.fieldInput}
                />
                <input
                  type="text"
                  placeholder="Description"
                  value={l.description}
                  onChange={(e) => setLine(l.rid, { description: e.target.value })}
                  className={styles.fieldInput}
                />
                <input
                  type="number"
                  min={1}
                  value={l.qty}
                  onChange={(e) => setLine(l.rid, { qty: Number(e.target.value) || 1 })}
                  className={styles.fieldInput}
                  style={{ textAlign: 'right' }}
                />
                <input
                  type="number"
                  step="0.01"
                  value={(l.unitPriceCenti / 100).toFixed(2)}
                  onChange={(e) => setLine(l.rid, { unitPriceCenti: Math.round(Number(e.target.value) * 100) || 0 })}
                  className={styles.fieldInput}
                  style={{ textAlign: 'right' }}
                />
                <div style={{
                  textAlign: 'right',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 'var(--fs-13)',
                }}>
                  {fmtRm(lineTotalCenti)}
                </div>
                <button
                  type="button"
                  onClick={() => dropLine(l.rid)}
                  title="Remove line"
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--fg-muted)',
                    cursor: 'pointer',
                    padding: 4,
                  }}
                >
                  <Trash2 {...ICON} />
                </button>
              </div>
            );
          })}

          <button
            type="button"
            onClick={addLine}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              marginTop: 'var(--space-3)',
              padding: '8px 12px',
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
            <Plus {...ICON} /> Add line
          </button>

          <div style={{
            display: 'flex',
            justifyContent: 'flex-end',
            marginTop: 'var(--space-4)',
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

      {/* ── Note ────────────────────────────────────────────────────── */}
      <section className={styles.card}>
        <div className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Note</h2>
        </div>
        <div className={styles.cardBody}>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Internal notes — visible on the SO detail page only"
            className={styles.fieldInput}
            rows={3}
            style={{ minHeight: 80, resize: 'vertical', width: '100%' }}
          />
        </div>
      </section>
    </div>
  );
};
