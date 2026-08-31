// ----------------------------------------------------------------------------
// OPEX ▸ Setup ▸ KPI items.
//
// A KPI item is a FIXED amount earned per unit sold — "sell this fabric series,
// earn RM 50" — as opposed to the percentage the rest of the scheme pays. What
// it can target all comes from the live POS library, so the picker is the
// catalogue, not a typed-in code:
//   Product   → one SKU
//   Category  → every item in a category (SOFA / BEDFRAME / MATTRESS / …)
//   Fabric    → a fabric SERIES, not a colour
//   Special   → a special-order add-on code
//
// ── THE OPTION THIS SCREEN EXISTS FOR (Loo 2026-08-31) ──────────────────────
// "有一些 KPI item 它有一个 option，就是它可以同时算 product revenue …
//  product revenue 也会拿到 commission，但同样的，它 KPI item 那边也会拿到
//  special 的 KPI amount".
//
// OFF (the default, and every rule written before today): the fixed amount is
// earned INSTEAD of the percentage on the flagged portion, and that portion
// leaves the goods the percentage runs on.
// ON: earn BOTH — the fixed amount, and the portion stays in goods.
//
// ⚠️ Turning it on does not only change one line. The kept amount also counts
// toward the RM 100k personal and RM 400k showroom targets, so it can lift a
// salesperson into the higher tier — and lift the WHOLE showroom, which raises
// everyone in that room. The screen says so, because the form cannot show it.
//
// One more rule, enforced server-side and stated here because it is not
// guessable: PRODUCT BEATS CATEGORY. A SKU named by a product rule ignores any
// category rule covering it, so one purchase never collects two bonuses.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { AlertTriangle, Plus, Tag, Trash2 } from 'lucide-react';
import {
  useCommissionKpiItems, useCreateCommissionKpiItem, useDeleteCommissionKpiItem,
  useUpdateCommissionKpiItem, type HrFlagType,
} from '../../lib/commission-api';
import { useFabricLibrary, useMfgCatalog, useSpecialAddons } from '../../lib/queries';
import { hrErrorMessage } from '../../lib/hr-wire';
import { fmtSen, rmToSen } from '../../lib/commission-format';
import styles from './Opex.module.css';

const FLAG_LABEL: Record<HrFlagType, string> = {
  product: 'Product',
  category: 'Category',
  fabric: 'Fabric series',
  special: 'Special add-on',
};
const FLAG_ORDER: HrFlagType[] = ['product', 'category', 'fabric', 'special'];

interface PickerRef { ref: string; label: string }

export const SetupKpiItems = ({ canManage }: { canManage: boolean }) => {
  const { data: items, isLoading, error } = useCommissionKpiItems();
  const create = useCreateCommissionKpiItem();
  const update = useUpdateCommissionKpiItem();
  const remove = useDeleteCommissionKpiItem();

  /* The four pickers come from the POS's OWN catalogue queries, already cached
     for the rest of the app — not from a bespoke endpoint. That also means this
     screen survives the Houzs HR module being retired. */
  const catalogQ = useMfgCatalog();
  const fabricsQ = useFabricLibrary();
  const specialsQ = useSpecialAddons();

  const [flagType, setFlagType] = useState<HrFlagType>('fabric');
  const [ref, setRef] = useState('');
  const [bonusRm, setBonusRm] = useState('50');
  const [countsAsRevenue, setCountsAsRevenue] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const pickers = useMemo(() => {
    const catalog = catalogQ.data ?? [];
    const products: PickerRef[] = catalog
      .map((p) => ({ ref: p.code, label: `${p.code} — ${p.name}` }))
      .sort((a, b) => a.ref.localeCompare(b.ref));
    /* Categories are an enum on the product, not a table — derived from what the
       catalogue actually contains so the picker can never offer a value no item
       could carry. SERVICE is excluded: service lines are not goods and never
       become KPI units. */
    const categories: PickerRef[] = [...new Set(catalog.map((p) => p.category))]
      .filter((cat) => cat !== 'SERVICE')
      .sort()
      .map((cat) => ({ ref: cat, label: cat }));
    const fabrics: PickerRef[] = (fabricsQ.data ?? [])
      .map((f) => ({ ref: f.id, label: f.label }));
    const specials: PickerRef[] = (specialsQ.data ?? [])
      .filter((s) => s.active)
      .map((s) => ({ ref: s.code, label: s.label }));
    return { product: products, category: categories, fabric: fabrics, special: specials };
  }, [catalogQ.data, fabricsQ.data, specialsQ.data]);

  const pickersLoading = catalogQ.isLoading || fabricsQ.isLoading || specialsQ.isLoading;
  const options = pickers[flagType];

  /* A flagged thing that has left the catalogue still has a rule, and that rule
     still pays. Showing the stored label (and flagging it) is the honest
     rendering — the raw ref is what the engine matches on. */
  const labelFor = (type: HrFlagType, r: string): string | null =>
    pickers[type].find((o) => o.ref === r)?.label ?? null;

  const add = async () => {
    setAddError(null);
    if (!ref) { setAddError('Pick what this KPI item applies to.'); return; }
    const bonusCenti = rmToSen(Number(bonusRm));
    if (!Number.isFinite(bonusCenti) || bonusCenti <= 0) {
      setAddError('Enter the amount earned per unit sold — a KPI item paying RM 0 earns nothing.');
      return;
    }
    try {
      await create.mutateAsync({
        flagType, ref,
        label: options.find((o) => o.ref === ref)?.label ?? ref,
        bonusCenti, countsAsRevenue,
      });
      setRef('');
      setCountsAsRevenue(false);
    } catch (e) {
      setAddError(hrErrorMessage(e));
    }
  };

  if (isLoading) return <p className={styles.muted}>Loading…</p>;
  if (error) return <p className={styles.error}>{hrErrorMessage(error)}</p>;

  const rows = items ?? [];
  const bothCount = rows.filter((r) => r.active && r.countsAsRevenue).length;

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <h2 className={styles.cardTitle}>
          <Tag size={16} strokeWidth={1.75} /> KPI items
        </h2>
        <span className={styles.chip}>{rows.filter((r) => r.active).length} active</span>
      </div>
      <p className={styles.cardHint}>
        A fixed amount earned for each unit sold, on top of the percentage scheme. A split sofa
        counts once per built sofa, not once per module.
      </p>

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Type</th>
              <th>Applies to</th>
              <th className={styles.num}>Amount each</th>
              <th>Also counts as product revenue</th>
              <th>Status</th>
              {canManage && <th />}
            </tr>
          </thead>
          <tbody>
            {rows.map((it) => {
              const live = labelFor(it.flagType, it.ref);
              return (
                <tr key={it.id} className={it.active ? undefined : styles.rowMuted}>
                  <td>{FLAG_LABEL[it.flagType]}</td>
                  <td>
                    {live ?? it.label ?? <span className={styles.code}>{it.ref}</span>}
                    {!live && !pickersLoading && (
                      <> <span className={styles.chip}>not in catalogue</span></>
                    )}
                  </td>
                  <td className={styles.num}>{fmtSen(it.bonusCenti)}</td>
                  <td>
                    {canManage ? (
                      <label className={styles.toggleCell}>
                        <input
                          type="checkbox"
                          checked={it.countsAsRevenue}
                          disabled={update.isPending}
                          onChange={(e) => void update.mutateAsync({
                            id: it.id, countsAsRevenue: e.target.checked,
                          })}
                        />
                        <span>{it.countsAsRevenue ? 'Earns both' : 'Instead of %'}</span>
                      </label>
                    ) : (
                      <span className={`${styles.chip} ${it.countsAsRevenue ? styles.chipHit : styles.chipOff}`}>
                        {it.countsAsRevenue ? 'Earns both' : 'Instead of %'}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className={`${styles.chip} ${it.active ? styles.chipHit : styles.chipOff}`}>
                      {it.active ? 'Active' : 'Off'}
                    </span>
                  </td>
                  {canManage && (
                    <td className={styles.num}>
                      <div className={styles.actions}>
                        <button
                          type="button" className={styles.btn}
                          disabled={update.isPending}
                          onClick={() => void update.mutateAsync({ id: it.id, active: !it.active })}
                        >
                          {it.active ? 'Turn off' : 'Turn on'}
                        </button>
                        <button
                          type="button" className={styles.iconBtn}
                          aria-label={`Delete ${it.label || it.ref}`}
                          disabled={remove.isPending}
                          onClick={() => {
                            /* Deleting stops it paying in every OPEN period too.
                               Closed periods keep their frozen figures. */
                            if (window.confirm(
                              `Delete the KPI item for "${it.label || it.ref}"?\n\nOpen periods will stop paying it. Turning it off instead keeps the record.`,
                            )) void remove.mutateAsync(it.id);
                          }}
                        >
                          <Trash2 size={16} strokeWidth={1.75} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr className={styles.rowMuted}>
                <td colSpan={canManage ? 6 : 5}>— No KPI items. Only the percentage scheme pays.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {canManage && (
        <>
          {addError && <p className={styles.error}>{addError}</p>}
          <div className={styles.fieldGrid}>
            <label className={styles.field}>
              <span className={styles.label}>Type</span>
              <select
                value={flagType}
                onChange={(e) => { setFlagType(e.target.value as HrFlagType); setRef(''); }}
              >
                {FLAG_ORDER.map((f) => (
                  <option key={f} value={f}>{FLAG_LABEL[f]}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Applies to</span>
              <select value={ref} onChange={(e) => setRef(e.target.value)} disabled={pickersLoading}>
                <option value="">{pickersLoading ? 'Loading…' : '— select —'}</option>
                {options.map((o) => (
                  <option key={o.ref} value={o.ref}>{o.label}</option>
                ))}
              </select>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Amount earned each</span>
              <span className={styles.suffixField}>
                <span className={styles.suffix}>RM</span>
                <input
                  type="number" min={0} step={10} inputMode="decimal"
                  value={bonusRm} onChange={(e) => setBonusRm(e.target.value)}
                />
              </span>
            </label>
            <label className={styles.field}>
              <span className={styles.label}>Also counts as product revenue</span>
              <label className={styles.toggleCell}>
                <input
                  type="checkbox"
                  checked={countsAsRevenue}
                  onChange={(e) => setCountsAsRevenue(e.target.checked)}
                />
                <span>{countsAsRevenue ? 'Earns both' : 'Instead of %'}</span>
              </label>
            </label>
            <div className={styles.field}>
              <span className={styles.label}>&nbsp;</span>
              <div className={styles.actions}>
                <button
                  type="button" className={styles.btn}
                  disabled={create.isPending} onClick={() => void add()}
                >
                  <Plus size={16} strokeWidth={1.75} /> Add KPI item
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      <p className={styles.notice}>
        <span className={styles.noticeTitle}>What &ldquo;also counts as product revenue&rdquo; does</span>
        <br />
        <strong>Off</strong> — the default, and how every rule behaved before this option existed.
        The fixed amount is earned <em>instead of</em> the percentage on the portion it covers, and
        that portion leaves product sales. A RM 3,000 sofa with a RM 125 fabric upgrade flagged at
        RM 50: product sales keeps RM 3,000, the salesperson earns the RM 50, the RM 125 drops out.
        <br />
        <strong>On</strong> — earns <em>both</em>. Same RM 50, and the RM 125 stays in product sales,
        so it also earns the percentage.
      </p>

      {bothCount > 0 && (
        <p className={styles.notice}>
          <span className={styles.noticeTitle}>
            <AlertTriangle size={14} strokeWidth={1.75} /> {bothCount} rule
            {bothCount === 1 ? '' : 's'} currently earns both
          </span>
          <br />
          The amount those keep in product sales also counts toward the RM 100k personal target and
          the showroom target — so it can move someone into the higher tier, and can lift the whole
          showroom, which raises the rate for everyone in that room. Worth a look at the Commission
          tab before a payout.
        </p>
      )}

      <p className={styles.notice}>
        <span className={styles.noticeTitle}>Where two rules cover the same item</span><br />
        A <strong>product</strong> rule beats a <strong>category</strong> rule — naming one SKU is
        treated as a deliberate override of the blanket rate, so one purchase never collects both.
        Fabric and special add-on rules target a different part of the same purchase and do stack.
      </p>
    </div>
  );
};
