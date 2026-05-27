// ----------------------------------------------------------------------------
// SalesOrderNew — full-page Create SO at /mfg-sales-orders/new.
//
// Task #105 — Commander 2026-05-27: "Edit SO 和 New SO 界面一定要一样的啊
// 为什么一直不一样 sales 怎么会习惯呢 payment 你只改了 edit SO 没有改 new SO".
// This page is now restructured to render the SAME 4 customer cards + the
// SAME Houzs PaymentsTable as SalesOrderDetail.tsx, so the Create flow and
// the Edit flow are visually identical (only the page title differs).
//
// Card order (matches Detail):
//   1. CUSTOMER         — Name * / Phone * / Email * / Customer Type /
//                         Salesperson / Customer SO Ref
//   2. ORDER INFO       — Building Type / Venue / Processing Date /
//                         Delivery Date (XOR validation) / Note
//   3. EMERGENCY        — Contact Name / Relationship / Phone
//   4. DELIVERY ADDRESS — "Fill in address later" affordance (New-SO only) /
//                         Address Line 1 / Address Line 2 / State / City /
//                         Postcode  (Sales Location is Detail-only)
//   5. LINE ITEMS       — SoLineCard list (already shared with Detail)
//   6. PAYMENTS         — <PaymentsTable docNo={null} /> draft mode. After
//                         POST /mfg-sales-orders succeeds, batch POST every
//                         draft to /:docNo/payments before navigating.
// ----------------------------------------------------------------------------

import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowLeft, Plus, Save, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { PhoneInput } from '../components/PhoneInput';
import {
  useCreateMfgSalesOrder, useDebtorSearch, useAddSalesOrderPayment,
  useUploadSoItemPhoto,
  type DebtorSuggestion,
} from '../lib/flow-queries';
import { supabase } from '../lib/supabase';
import { useStaff } from '../lib/admin-queries';
import {
  useLocalities, distinctStates, citiesInState, postcodesInCity,
  countryForState,
} from '../lib/localities-queries';
import {
  useSoDropdownOptions, optionsOrFallback,
} from '../lib/so-dropdown-options-queries';
import { SoLineCard, emptySoLine, type SoLineDraft } from '../components/SoLineCard';
import {
  PaymentsTable, labelToApi, parseInstallmentMonths, type PaymentDraft,
} from '../components/PaymentsTable';
import { formatPhone } from '@2990s/shared/phone';
import styles from './SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

/* PR #114/#125 — Draft line shape mirrors SoLineDraft from SoLineCard but
   adds a stable React id so the local list can re-order / edit inline. */
type DraftLine = SoLineDraft & { rid: string };

/* PR-E — New lines inherit the SO header's delivery date by default.
   The header date isn't persisted until the SO is saved, so we seed the
   line client-side; once the SO exists, the server-side cascade in
   PATCH /:docNo takes over. */
const newLine = (deliveryDate: string | null = null): DraftLine => ({
  ...emptySoLine(),
  lineDeliveryDate: deliveryDate,
  lineDeliveryDateOverridden: false,
  rid: `l${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
});

const fmtRm = (centi: number, currency = 'MYR'): string =>
  `${currency} ${(centi / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;

export const SalesOrderNew = () => {
  const navigate = useNavigate();
  const create   = useCreateMfgSalesOrder();
  const addPayment = useAddSalesOrderPayment();
  const uploadPhoto = useUploadSoItemPhoto();
  const staffQ   = useStaff();
  const loc      = useLocalities();

  /* Task #118 — these 3 dropdowns used to be `as const` arrays in this
     file. Now sourced from so_dropdown_options via TanStack. Each call
     falls back to the migration 0081 seed list during loading + when
     the DB row count is 0 so the user never sees an empty select. */
  const customerTypeOptsQ  = useSoDropdownOptions('customer_type');
  const buildingTypeOptsQ  = useSoDropdownOptions('building_type');
  const relationshipOptsQ  = useSoDropdownOptions('relationship');
  const customerTypeOpts = optionsOrFallback('customer_type', customerTypeOptsQ.data);
  const buildingTypeOpts = optionsOrFallback('building_type', buildingTypeOptsQ.data);
  const relationshipOpts = optionsOrFallback('relationship',  relationshipOptsQ.data);

  // ── Customer fields ────────────────────────────────────────────────
  const [debtorCode,    setDebtorCode]    = useState('');
  const [debtorName,    setDebtorName]    = useState('');
  const [phone,         setPhone]         = useState('');
  const [email,         setEmail]         = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [customerType,  setCustomerType]  = useState<string>('');
  /* PR-A on Detail exposed Customer SO Ref inside the Customer card —
     mirror that here so the two pages line up. */
  const [customerSoNo,  setCustomerSoNo]  = useState('');

  // ── Order Info fields (Building Type / Venue / Dates / Note) ───────
  const [buildingType,   setBuildingType] = useState<string>('');
  /* PR #156 — Commander 2026-05-27: "开单的 venue 呢也没有". Detail page
     keeps Venue as a free-text field separate from Building Type — match
     that here so the two layouts line up. */
  const [venue,          setVenue]         = useState('');
  const [processingDate, setProcessingDate] = useState('');
  const [deliveryDate,   setDeliveryDate]   = useState('');
  const [note,           setNote]           = useState('');

  // ── Delivery address ───────────────────────────────────────────────
  /* "Fill in address later" affordance: New-SO only (the address can be
     unknown at quote time). Detail doesn't need it because by the time
     someone is editing a saved SO, the address can be left blank without
     a special toggle. */
  const [fillAddressLater, setFillAddressLater] = useState(false);
  const [address1,    setAddress1]    = useState('');
  const [address2,    setAddress2]    = useState('');
  const [state,       setState]       = useState('');
  const [city,        setCity]        = useState('');
  const [postcode,    setPostcode]    = useState('');

  // ── Emergency contact ──────────────────────────────────────────────
  const [emergencyName,  setEmergencyName]   = useState('');
  const [emergencyRel,   setEmergencyRel]    = useState<string>('');
  const [emergencyPhone, setEmergencyPhone]  = useState('');

  // ── Items state ────────────────────────────────────────────────────
  /* HOOKKA pattern — each line is an inline editable card. First card is
     seeded on mount so commander immediately sees the variant editor
     instead of needing to click "+ Add line item" first. */
  const [lines, setLines] = useState<DraftLine[]>(() => [newLine()]);

  // ── Payments draft state ───────────────────────────────────────────
  /* Task #105 — Same Houzs PaymentsTable used on Detail, but in DRAFT mode
     since the SO doesn't have a docNo yet. We hold the rows here, then
     batch POST them to /:docNo/payments after create succeeds. */
  const [paymentDrafts, setPaymentDrafts] = useState<PaymentDraft[]>([]);

  // ── Debtor autocomplete + warehouse lookup ─────────────────────────
  const debtors = useDebtorSearch(debtorName.trim().length >= 2 ? debtorName.trim() : '');
  const [showDebtorSuggest, setShowDebtorSuggest] = useState(false);
  const debtorSuggestions: DebtorSuggestion[] = (debtors.data?.debtors ?? []).filter(
    (d) => (d.debtor_name ?? '').toLowerCase() !== debtorName.trim().toLowerCase(),
  );
  const applyDebtorSuggestion = (d: DebtorSuggestion) => {
    setDebtorCode(d.debtor_code ?? '');
    setDebtorName(d.debtor_name ?? '');
    setPhone(d.phone ?? '');
    setAddress1(d.address1 ?? '');
    setAddress2(d.address2 ?? '');
    setCity(d.address3 ?? '');
    setPostcode(d.address4 ?? '');
    setShowDebtorSuggest(false);
  };

  const updateLine = (rid: string, patch: Partial<SoLineDraft>) =>
    setLines((prev) => prev.map((l) => (l.rid === rid ? { ...l, ...patch } : l)));

  /* PR-E — New lines seed their lineDeliveryDate from the current header
     deliveryDate (null until the user fills it in). The cascade effect
     below keeps non-overridden lines in sync with subsequent header
     changes. */
  const addLine  = () => setLines((prev) => [...prev, newLine(deliveryDate || null)]);
  const dropLine = (rid: string) => setLines((prev) => prev.filter((l) => l.rid !== rid));

  /* PR-E — Client-side master-follower cascade for delivery date. Mirrors
     the server-side cascade in PATCH /mfg-sales-orders/:docNo. */
  useEffect(() => {
    setLines((prev) => {
      let didUpdate = false;
      const target = deliveryDate || null;
      const next = prev.map((l) => {
        if (l.lineDeliveryDateOverridden) return l;
        if ((l.lineDeliveryDate ?? null) === target) return l;
        didUpdate = true;
        return { ...l, lineDeliveryDate: target };
      });
      return didUpdate ? next : prev;
    });
  }, [deliveryDate]);

  /* PR #142 / #145 / #147 — Master-follower cascade for line variants.
     LINE 1 of each category drives variant changes on subsequent lines,
     unless a follower has manually overridden a key. */
  useEffect(() => {
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
      if (masterIdx[l.itemGroup] === idx) return l;
      const masterVariants = masterByCategory[l.itemGroup];
      if (!masterVariants) return l;
      const cur = (l.variants ?? {}) as Record<string, unknown>;
      const overridden = new Set(l.overriddenKeys ?? []);
      const patch: Record<string, unknown> = {};
      let hasChange = false;
      for (const k of Object.keys(masterVariants)) {
        if (overridden.has(k)) continue;
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
     category that has any variants set. */
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
  /* Task #121 — country derives from the picked state. Display-only on the
     SO form; the API re-derives + snapshots it on POST/PATCH. Falls back
     to 'Malaysia' when no state is picked yet so the field doesn't sit
     visibly blank before the cascade fires. */
  const country = useMemo(
    () => (state ? countryForState(locRows, state) : null) ?? 'Malaysia',
    [locRows, state],
  );

  const canSave = debtorName.trim().length > 0;

  /* Mirror Detail's XOR rule (PR #156): Processing Date and Delivery Date
     must both be filled in or both empty. */
  const datesXor = (processingDate.trim() !== '') !== (deliveryDate.trim() !== '');

  /* Task #105 — After POST /mfg-sales-orders succeeds, replay every payment
     draft through POST /:docNo/payments in parallel via the existing mutation
     hook (useAddSalesOrderPayment.mutateAsync). Failures don't roll the SO
     back (the SO is already created), but we surface them so commander can
     re-enter the affected rows on the Detail page. */
  /* Line-card-redesign (Commander 2026-05-27) — Photos can now be staged
     on a brand-new line BEFORE the SO is saved. The SoLineCard component
     stages them as File objects on `draft.pendingPhotoFiles`. After
     POST /mfg-sales-orders succeeds we GET /:docNo to read back the saved
     item IDs, match each saved item to a draft line by index, then upload
     every staged File via the existing per-item /photos endpoint.

     Item ordering: the API inserts items in the order we send them and
     returns them ordered by created_at, so positional matching is safe.
     If the counts ever drift (server-side filtering of bad rows, etc.)
     we surface a soft warning and skip the mismatched lines rather than
     guess. The SO is already created so we don't roll back. */
  const flushPendingPhotos = async (
    docNo: string,
    draftLines: DraftLine[],
  ): Promise<{ failed: number; skipped: number }> => {
    const linesWithPending = draftLines.filter(
      (l) => (l.pendingPhotoFiles?.length ?? 0) > 0,
    );
    if (linesWithPending.length === 0) return { failed: 0, skipped: 0 };

    // Fetch saved item IDs. We bypass the TanStack cache because the
    // freshly-created detail may not be in the cache yet.
    const { data: sess } = await supabase.auth.getSession();
    const token = sess.session?.access_token;
    const API_URL = import.meta.env.VITE_API_URL;
    if (!token || !API_URL) return { failed: linesWithPending.length, skipped: 0 };

    let savedItems: Array<{ id: string; item_code: string }> = [];
    try {
      const res = await fetch(`${API_URL}/mfg-sales-orders/${docNo}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const body = (await res.json()) as { items: Array<{ id: string; item_code: string }> };
      savedItems = body.items ?? [];
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error('[so-line-photos] could not load saved item IDs:', e);
      return { failed: linesWithPending.length, skipped: 0 };
    }

    /* Positional match — `validLines` is the same slice we sent to
       POST /mfg-sales-orders so `savedItems[i]` corresponds to
       `validLines[i]`. We only iterate over validLines so cancelled
       drafts (no itemCode) are skipped without breaking the index. */
    const validLines = draftLines.filter((l) => l.itemCode.trim() && l.qty > 0);
    let failed = 0;
    let skipped = 0;
    for (let i = 0; i < validLines.length; i++) {
      const line = validLines[i]!;
      const files = line.pendingPhotoFiles ?? [];
      if (files.length === 0) continue;
      const saved = savedItems[i];
      if (!saved || saved.item_code !== line.itemCode) {
        // Mismatch — log + skip rather than upload to the wrong line.
        // eslint-disable-next-line no-console
        console.warn('[so-line-photos] index/item_code mismatch — skipping pending uploads', {
          index: i, expected: line.itemCode, got: saved?.item_code,
        });
        skipped += files.length;
        continue;
      }
      for (const f of files) {
        try {
          await uploadPhoto.mutateAsync({ docNo, itemId: saved.id, file: f });
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[so-line-photos] upload failed', { file: f.name, err });
          failed++;
        }
      }
    }
    return { failed, skipped };
  };

  const flushPaymentDrafts = async (docNo: string): Promise<{ failed: number }> => {
    if (paymentDrafts.length === 0) return { failed: 0 };
    const tasks = paymentDrafts
      .filter((d) => d.amountCenti > 0)
      .map(async (d) => {
        const { method } = labelToApi(d.methodLabel);
        const body: { docNo: string } & Record<string, unknown> = {
          docNo,
          paidAt:       d.paidAt,
          method,
          amountCenti:  d.amountCenti,
          accountSheet: d.accountSheet || null,
          approvalCode: d.approvalCode || null,
          collectedBy:  d.collectedBy  || null,
        };
        /* Task #122 (cascade) — replay the L2 picks per method so the
           created payment row carries the bank + plan / sub-type that
           commander entered during the draft. */
        if (method === 'merchant') {
          body.merchantProvider  = d.merchantProvider || null;
          body.installmentMonths = parseInstallmentMonths(d.installmentMonthsLabel);
        } else if (method === 'transfer') {
          body.onlineType = d.onlineType || null;
        }
        try {
          await addPayment.mutateAsync(body);
          return true;
        } catch (e) {
          // eslint-disable-next-line no-console
          console.error('[payment] post failed for new SO:', e);
          return false;
        }
      });
    const results = await Promise.all(tasks);
    return { failed: results.filter((ok) => !ok).length };
  };

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
        customerSoNo: customerSoNo || undefined,
        venue: venue || undefined,
        /* Address handling: address1/2 skipped when fill-later is on, but
           State/City/Postcode/BuildingType always submit. */
        address1: fillAddressLater ? undefined : (address1 || undefined),
        address2: fillAddressLater ? undefined : (address2 || undefined),
        customerState: state || undefined,
        city: city || undefined,
        postcode: postcode || undefined,
        buildingType: buildingType || undefined,
        emergencyContactName:         emergencyName  || undefined,
        emergencyContactRelationship: emergencyRel   || undefined,
        emergencyContactPhone:        emergencyPhone || undefined,
        /* PR #121 — Processing Date → internal_expected_dd, Delivery Date →
           customer_delivery_date. */
        internalExpectedDd:   processingDate || undefined,
        customerDeliveryDate: deliveryDate   || undefined,
        note: note || undefined,
        /* PR #114 — full variant payload preserved end-to-end. */
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
          /* PR-E — per-item delivery date + cascade override flag. */
          lineDeliveryDate:           l.lineDeliveryDate ?? null,
          lineDeliveryDateOverridden: l.lineDeliveryDateOverridden ?? false,
        })),
      },
      {
        onSuccess: async (res: { docNo: string }) => {
          /* Task #105 — Fire the queued payment drafts as follow-up POSTs.
             We don't gate navigation on success — if a payment fails the
             SO still exists, so we navigate to the Detail page where
             commander can re-enter the affected row. */
          const { failed } = await flushPaymentDrafts(res.docNo);
          /* Line-card-redesign — Drain pendingPhotoFiles for every line
             after the SO + items exist. Same non-blocking pattern as
             payments: a photo failure leaves the SO intact and we
             surface a warning rather than rolling back. */
          const { failed: photoFailed, skipped: photoSkipped } =
            await flushPendingPhotos(res.docNo, validLines);
          if (failed > 0) {
            window.alert(
              `Sales order ${res.docNo} was created, but ${failed} ` +
              `payment row${failed === 1 ? '' : 's'} failed to save. ` +
              `Please re-enter ${failed === 1 ? 'it' : 'them'} on the Detail page.`,
            );
          }
          if (photoFailed > 0 || photoSkipped > 0) {
            window.alert(
              `Sales order ${res.docNo} was created, but ${photoFailed + photoSkipped} ` +
              `staged photo${(photoFailed + photoSkipped) === 1 ? '' : 's'} could not be ` +
              `uploaded. Please re-attach on the Detail page.`,
            );
          }
          navigate(`/mfg-sales-orders/${res.docNo}`);
        },
        onError:   (err) => window.alert(`Save failed: ${err instanceof Error ? err.message : String(err)}`),
      },
    );
  };

  const staffList = (staffQ.data ?? []).filter((s) => s.active);

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

      {/* ── CUSTOMER ──────────────────────────────────────────────────
          Matches SalesOrderDetail's Customer card: Name * / Phone * /
          Email * / Customer Type / Salesperson / Customer SO Ref.
          Same .formGrid4 column layout (1 wide + 1 + 1 + 1 + 1 + 1) so
          fields line up visually between the two pages. */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Customer</h2>
        </header>
        <div className={styles.cardBody}>
          <div className={styles.formGrid4}>
            <label className={styles.field} style={{ gridColumn: 'span 3' }}>
              <span className={styles.fieldLabel}>Customer Name *</span>
              <input
                className={styles.fieldInput}
                value={debtorName}
                onChange={(e) => { setDebtorName(e.target.value); setShowDebtorSuggest(true); }}
                onFocus={() => setShowDebtorSuggest(true)}
                onBlur={() => setTimeout(() => setShowDebtorSuggest(false), 150)}
                placeholder="e.g. Lim Mei Hua"
                required
              />
              {showDebtorSuggest && debtorSuggestions.length > 0 && (
                <ul className={styles.suggestList}>
                  {debtorSuggestions.slice(0, 8).map((d, i) => (
                    <li
                      key={`${d.debtor_code ?? ''}-${i}`}
                      className={styles.suggestItem}
                      onMouseDown={() => applyDebtorSuggestion(d)}
                    >
                      <div>{d.debtor_name}</div>
                      {(d.debtor_code || d.phone) && (
                        <div className={styles.suggestCode}>
                          {d.debtor_code ?? ''}{d.debtor_code && d.phone ? ' · ' : ''}{formatPhone(d.phone) || ''}
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer SO Ref</span>
              <input
                className={styles.fieldInput}
                value={customerSoNo}
                placeholder="Their PO / SO number"
                onChange={(e) => setCustomerSoNo(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Phone *</span>
              <PhoneInput
                className={styles.fieldInput}
                value={phone}
                onChange={setPhone}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Email *</span>
              <input
                type="email"
                className={styles.fieldInput}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="customer@example.com"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Customer Type</span>
              <select
                className={styles.fieldSelect}
                value={customerType}
                onChange={(e) => setCustomerType(e.target.value)}
              >
                <option value="">—</option>
                {customerTypeOpts.map((t) => (
                  <option key={t.id} value={t.value}>{t.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Salesperson</span>
              <select
                className={styles.fieldSelect}
                value={salespersonId}
                onChange={(e) => setSalespersonId(e.target.value)}
              >
                <option value="">— Pick staff —</option>
                {staffList.map((s) => (
                  <option key={s.id} value={s.id}>{s.name} ({s.staffCode})</option>
                ))}
              </select>
            </label>
          </div>
        </div>
      </section>

      {/* ── ORDER INFO (Building Type / Venue / Dates / Note) ────────
          Same card + same field layout as Detail's Order Info. */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Order Info</h2>
        </header>
        <div className={styles.cardBody}>
          <div className={styles.formGrid4}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Building Type</span>
              <select
                className={styles.fieldSelect}
                value={buildingType}
                onChange={(e) => setBuildingType(e.target.value)}
              >
                <option value="">—</option>
                {buildingTypeOpts.map((b) => (
                  <option key={b.id} value={b.value}>{b.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Venue</span>
              <input
                className={styles.fieldInput}
                value={venue}
                placeholder="e.g. KL Showroom, Penang Branch"
                onChange={(e) => setVenue(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Processing Date</span>
              <input
                type="date"
                className={styles.fieldInput}
                value={processingDate}
                onChange={(e) => setProcessingDate(e.target.value)}
                style={datesXor && !processingDate ? { borderColor: 'var(--c-festive-b, #B8331F)' } : undefined}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Delivery Date</span>
              <input
                type="date"
                className={styles.fieldInput}
                value={deliveryDate}
                onChange={(e) => setDeliveryDate(e.target.value)}
                style={datesXor && !deliveryDate ? { borderColor: 'var(--c-festive-b, #B8331F)' } : undefined}
              />
            </label>
            <label className={styles.field} style={{ gridColumn: 'span 4' }}>
              <span className={styles.fieldLabel}>Note</span>
              <input
                className={styles.fieldInput}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Internal notes — visible on the SO detail page only"
              />
            </label>
          </div>
          {datesXor && (
            <div
              style={{
                background: 'rgba(184, 51, 31, 0.08)',
                border: '1px solid var(--c-festive-b, #B8331F)',
                color: 'var(--c-festive-b, #B8331F)',
                padding: '4px var(--space-2)',
                borderRadius: 'var(--radius-sm)',
                fontSize: 'var(--fs-11)',
                fontWeight: 600,
                marginTop: 'var(--space-2)',
              }}
            >
              ⚠ Processing Date and Delivery Date must be set together — Save is blocked.
            </div>
          )}
        </div>
      </section>

      {/* ── EMERGENCY CONTACT ─────────────────────────────────────────
          Mirrors Detail's Emergency Contact card field-for-field. */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Emergency Contact</h2>
          <span style={{ fontSize: 'var(--fs-12)', color: 'var(--fg-muted)' }}>
            Used only if we cannot reach the customer on delivery day
          </span>
        </header>
        <div className={styles.cardBody}>
          <div className={styles.formGrid4}>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Contact Name</span>
              <input
                className={styles.fieldInput}
                value={emergencyName}
                placeholder="e.g. Lim Mei Hua"
                onChange={(e) => setEmergencyName(e.target.value)}
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Relationship</span>
              <select
                className={styles.fieldSelect}
                value={emergencyRel}
                onChange={(e) => setEmergencyRel(e.target.value)}
              >
                <option value="">—</option>
                {relationshipOpts.map((r) => (
                  <option key={r.id} value={r.value}>{r.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field} style={{ gridColumn: 'span 2' }}>
              <span className={styles.fieldLabel}>Phone</span>
              <PhoneInput
                className={styles.fieldInput}
                value={emergencyPhone}
                onChange={setEmergencyPhone}
              />
            </label>
          </div>
        </div>
      </section>

      {/* ── DELIVERY ADDRESS ──────────────────────────────────────────
          Matches Detail's Delivery Address card. The one Detail-only
          field (Sales Location, read from auth) is omitted here. The
          one New-SO-only affordance ("Fill in address later") sits at
          the top of the card so commander can defer the address. */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Delivery Address</h2>
        </header>
        <div className={styles.cardBody}>
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

          {/* Address fields — only Address 1/2 dim when fill-later is on. */}
          <div className={styles.formGrid4}>
            <label
              className={styles.field}
              style={{
                gridColumn: 'span 4',
                opacity: fillAddressLater ? 0.4 : 1,
                pointerEvents: fillAddressLater ? 'none' : 'auto',
              }}
            >
              <span className={styles.fieldLabel}>Address Line 1</span>
              <input
                className={styles.fieldInput}
                value={address1}
                onChange={(e) => setAddress1(e.target.value)}
                placeholder="Unit, street, area"
              />
            </label>
            <label
              className={styles.field}
              style={{
                gridColumn: 'span 4',
                opacity: fillAddressLater ? 0.4 : 1,
                pointerEvents: fillAddressLater ? 'none' : 'auto',
              }}
            >
              <span className={styles.fieldLabel}>Address Line 2</span>
              <input
                className={styles.fieldInput}
                value={address2}
                onChange={(e) => setAddress2(e.target.value)}
                placeholder="Apt, floor, building (optional)"
              />
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>State</span>
              <select
                className={styles.fieldSelect}
                value={state}
                onChange={(e) => { setState(e.target.value); setCity(''); setPostcode(''); }}
                disabled={loc.isLoading}
              >
                <option value="">{loc.isLoading ? 'Loading…' : 'Pick state'}</option>
                {states.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>City</span>
              <select
                className={styles.fieldSelect}
                value={city}
                onChange={(e) => { setCity(e.target.value); setPostcode(''); }}
                disabled={!state}
              >
                <option value="">{state ? 'Pick city' : '— pick state first'}</option>
                {cities.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.fieldLabel}>Postcode</span>
              <select
                className={styles.fieldSelect}
                value={postcode}
                onChange={(e) => setPostcode(e.target.value)}
                disabled={!state || !city}
              >
                <option value="">{(state && city) ? 'Pick postcode' : '— pick city first'}</option>
                {postcodes.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
            {/* Task #121 — Country is auto-derived from the picked state via
                my_localities. Read-only display; the API re-derives + snaps
                it onto the SO header on POST. */}
            <div className={styles.field}>
              <span className={styles.fieldLabel}>Country</span>
              <span className={styles.fieldInput} style={{
                display: 'inline-flex', alignItems: 'center', height: 26,
                color: 'var(--fg-muted)',
              }}>
                {country}
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* ── LINE ITEMS ──────────────────────────────────────────────
          Same SoLineCard component Edit SO uses inline. Each line on
          New SO is already in inline-edit mode (no saved row exists
          yet), and "+ Add Line Item" appends a fresh card. Card header
          mirrors Detail — "Line Items ({n})" with no subtitle. */}
      <section className={styles.card}>
        <header className={styles.cardHeader}>
          <h2 className={styles.cardTitle}>Line Items ({lines.length})</h2>
        </header>
        <div className={styles.cardBody} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
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
            <Plus {...ICON} /> Add Line Item
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

      {/* ── PAYMENTS (shared with Detail) ─────────────────────────────
          Task #105 — Same Houzs PaymentsTable rendered on Detail. In
          DRAFT mode it holds rows in local state; onSave (above) batches
          POST /:docNo/payments calls in parallel after the SO has been
          created and before navigating to the Detail page. */}
      <PaymentsTable
        docNo={null}
        payments={paymentDrafts}
        onChange={setPaymentDrafts}
        grandTotalCenti={subtotalCenti}
        currency="MYR"
      />

    </div>
  );
};
