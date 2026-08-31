// ----------------------------------------------------------------------------
// OPEX ▸ Setup ▸ KPI items.
//
// A KPI item is a FIXED amount earned per unit sold — "sell this fabric series,
// earn RM 50" — as opposed to the percentage the rest of the scheme pays. The
// things it can target all come from the POS library, so the picker below is the
// live catalogue, not a typed-in code:
//   Product   → one SKU                     (mfg_products.code)
//   Category  → every item in a category    (SOFA / BEDFRAME / MATTRESS / …)
//   Fabric    → a fabric SERIES, not a colour (fabric_library)
//   Special   → a special-order add-on code  (special_addons)
//
// TWO RULES THAT DECIDE MONEY, both enforced server-side and both stated on
// screen because neither is guessable from the form:
//
//  1. NO DOUBLE COMMISSION. The flagged amount earns the fixed KPI amount
//     INSTEAD of the percentage on that amount, never both. A fabric or special
//     rule drops only its own add-on (the item's base price still earns
//     commission); a product or category rule drops the whole item.
//
//  2. PRODUCT BEATS CATEGORY. If a SKU is named by a product rule AND covered by
//     a category rule, only the product rule pays. Naming one SKU is a
//     deliberate override of the blanket rate.
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Plus, Tag, Trash2 } from 'lucide-react';
import {
  useCreateHrItemKpi, useDeleteHrItemKpi, useHrItemKpi, useHrPickers, useUpdateHrItemKpi,
  type HrFlagType, type HrPickerRef,
} from '../../lib/hr-commission-queries';
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

export const SetupKpiItems = ({ canManage }: { canManage: boolean }) => {
  const { data: items, isLoading, error } = useHrItemKpi();
  /* Fetched for EVERY viewer, not just writers: /hr/pickers needs only
     scm.hr.read (which everyone on this page holds), and without it a read-only
     viewer sees raw UUIDs and SKU codes where the names should be. Cached five
     minutes, shared with the Salespeople card below. */
  const { data: pickers, isLoading: pickersLoading } = useHrPickers();
  const create = useCreateHrItemKpi();
  const update = useUpdateHrItemKpi();
  const remove = useDeleteHrItemKpi();

  const [flagType, setFlagType] = useState<HrFlagType>('fabric');
  const [ref, setRef] = useState('');
  const [bonusRm, setBonusRm] = useState('50');
  const [addError, setAddError] = useState<string | null>(null);

  const options: HrPickerRef[] = useMemo(() => {
    if (!pickers) return [];
    if (flagType === 'product') return pickers.products;
    if (flagType === 'category') return pickers.categories;
    if (flagType === 'fabric') return pickers.fabrics;
    return pickers.specials;
  }, [pickers, flagType]);

  /* A flagged thing that is no longer in the catalogue still has a rule, and
     that rule still pays. Showing the raw ref rather than a blank is the honest
     rendering — it is what the engine matches on. */
  const labelFor = (type: HrFlagType, r: string): string | null => {
    if (!pickers) return null;
    const list = type === 'product' ? pickers.products
      : type === 'category' ? pickers.categories
      : type === 'fabric' ? pickers.fabrics
      : pickers.specials;
    return list.find((o) => o.ref === r)?.label ?? null;
  };

  const add = async () => {
    setAddError(null);
    if (!ref) { setAddError('Pick what this KPI item applies to.'); return; }
    const bonusSen = rmToSen(Number(bonusRm));
    if (!Number.isFinite(bonusSen) || bonusSen <= 0) {
      setAddError('Enter the amount earned per unit sold — a KPI item paying RM 0 earns nothing.');
      return;
    }
    try {
      await create.mutateAsync({
        flagType,
        ref,
        label: options.find((o) => o.ref === ref)?.label ?? ref,
        bonusSen,
      });
      setRef('');
    } catch (e) {
      setAddError(hrErrorMessage(e));
    }
  };

  if (isLoading) return <p className={styles.muted}>Loading…</p>;
  if (error) return <p className={styles.error}>{hrErrorMessage(error)}</p>;

  const rows = items ?? [];

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
                    {!live && pickers && (
                      <>
                        {' '}<span className={styles.chip}>not in catalogue</span>
                      </>
                    )}
                  </td>
                  <td className={styles.num}>{fmtSen(it.bonusSen)}</td>
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
                            /* Deleting a rule removes it from FUTURE open periods
                               too, which is why this asks. Closed periods keep
                               their frozen figures either way. */
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
                <td colSpan={canManage ? 5 : 4}>— No KPI items. Only the percentage scheme pays.</td>
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
        <span className={styles.noticeTitle}>How a KPI item affects the percentage</span><br />
        A KPI item pays its fixed amount <em>instead of</em> the percentage on the amount it covers —
        never both. A <strong>fabric</strong> or <strong>special add-on</strong> rule removes only its
        own surcharge, so the item&rsquo;s base price still earns commission: a RM 3,000 sofa with a
        RM 125 fabric upgrade flagged at RM 50 keeps RM 3,000 of product sales, earns the RM 50, and
        the RM 125 drops out. A <strong>product</strong> or <strong>category</strong> rule removes the
        whole item instead. Where a product rule and a category rule cover the same item, only the
        product rule pays.
      </p>
    </div>
  );
};
