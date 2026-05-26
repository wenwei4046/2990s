// ----------------------------------------------------------------------------
// SofaSetDialog — pick a Sofa Model, then multi-select the modules.
//
// PR #142 — Commander 2026-05-26: "正常我的沙发是一整套… 根据它的 model，
// 给我自己做 multiselect，给我自己点完那个 code". Mirrors HOOKKA's sales
// create page §"Sofa: Model selector → Module multi-select".
//
// Flow:
//   1. Commander clicks "+ Add Sofa Set" on the SO form
//   2. Dialog opens, showing a list of distinct base_models for sofa SKUs
//   3. Pick a model (e.g. ANNSA) → modules grid populates with all SKUs
//      whose base_model === ANNSA (e.g. ANNSA-1S, ANNSA-2S, ANNSA-3S, OT, RC)
//   4. Multi-select the modules to include
//   5. "Add N modules" → caller appends N lines (one per picked module);
//      each line has itemCode + name + price pre-filled, variants left
//      empty (commander fills variants on line 1, the post-add cascade
//      effect in SalesOrderNew propagates them to lines 2…N).
// ----------------------------------------------------------------------------

import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { useMfgProducts, type MfgProductRow } from '../lib/mfg-products-queries';
import styles from '../pages/SalesOrderDetail.module.css';

const ICON = { size: 16, strokeWidth: 1.75 } as const;

const fmtRm = (centi: number | null | undefined): string => {
  const v = centi ?? 0;
  return `MYR ${(v / 100).toLocaleString('en-MY', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  })}`;
};

/** Shape returned to the caller for each picked module. Matches the
 *  SoLineDraft subset that SalesOrderNew can splice into its lines array. */
export type SofaSetModule = {
  itemCode:       string;
  description:    string;
  unitPriceCenti: number;
};

export const SofaSetDialog = ({
  onClose,
  onAdd,
}: {
  onClose: () => void;
  onAdd:   (modules: SofaSetModule[]) => void;
}) => {
  const productsQuery = useMfgProducts({ category: 'SOFA' });
  const sofaProducts: MfgProductRow[] = productsQuery.data ?? [];

  // Distinct, sorted base_model list — feeds the model picker.
  const models = useMemo(() => {
    const set = new Set<string>();
    for (const p of sofaProducts) {
      if (p.base_model) set.add(p.base_model);
    }
    return [...set].sort();
  }, [sofaProducts]);

  const [model, setModel] = useState<string>('');
  const [picked, setPicked] = useState<Set<string>>(new Set());

  // Modules under the picked model.
  const modules = useMemo(
    () => sofaProducts.filter((p) => p.base_model === model),
    [sofaProducts, model],
  );

  const allPicked = modules.length > 0 && modules.every((m) => picked.has(m.id));
  const toggleAll = () => {
    if (allPicked) setPicked(new Set());
    else setPicked(new Set(modules.map((m) => m.id)));
  };

  const toggleOne = (id: string) =>
    setPicked((prev) => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });

  const onConfirm = () => {
    const out: SofaSetModule[] = modules
      .filter((m) => picked.has(m.id))
      .map((m) => ({
        itemCode:       m.code,
        description:    m.name,
        unitPriceCenti: m.base_price_sen ?? 0,
      }));
    if (out.length === 0) return;
    onAdd(out);
  };

  return (
    <div className={styles.modalBackdrop} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()} style={{ maxWidth: 720 }}>
        <header className={styles.modalHeader}>
          <h3 className={styles.modalTitle}>Add Sofa Set</h3>
          <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
            <X {...ICON} />
          </button>
        </header>

        <div className={styles.modalBody}>
          {/* Step 1: Pick model */}
          <div>
            <p className={styles.subHead}>1 · Pick Model</p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 'var(--space-2)' }}>
              {models.length === 0 && (
                <span style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)' }}>
                  No sofa models found.
                </span>
              )}
              {models.map((m) => (
                <button
                  type="button"
                  key={m}
                  onClick={() => { setModel(m); setPicked(new Set()); }}
                  style={{
                    fontFamily: 'var(--font-sans)',
                    fontSize: 'var(--fs-13)',
                    fontWeight: 600,
                    padding: '4px 12px',
                    borderRadius: 'var(--radius-pill)',
                    border: '1px solid ' + (model === m ? 'var(--c-orange)' : 'var(--line)'),
                    background: model === m ? 'rgba(232, 107, 58, 0.12)' : 'var(--c-paper)',
                    color: model === m ? 'var(--c-burnt)' : 'var(--c-ink)',
                    cursor: 'pointer',
                  }}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {/* Step 2: Multi-select modules */}
          {model && (
            <div>
              <p className={styles.subHead}>
                2 · Pick Modules
                <span style={{ marginLeft: 8, fontSize: 'var(--fs-11)', color: 'var(--fg-muted)' }}>
                  {modules.length} module{modules.length === 1 ? '' : 's'} under <strong>{model}</strong>
                </span>
              </p>
              {modules.length === 0 ? (
                <p style={{ fontSize: 'var(--fs-13)', color: 'var(--fg-muted)', margin: 0 }}>
                  No SKUs found under model <strong>{model}</strong>.
                </p>
              ) : (
                <>
                  <div style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                    maxHeight: 320,
                    overflowY: 'auto',
                    border: '1px solid var(--line)',
                    borderRadius: 'var(--radius-md)',
                    padding: 'var(--space-2)',
                    background: 'var(--c-cream)',
                  }}>
                    {modules.map((m) => {
                      const isPicked = picked.has(m.id);
                      return (
                        <label
                          key={m.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            padding: '6px 10px',
                            borderRadius: 'var(--radius-sm)',
                            background: isPicked ? 'rgba(232, 107, 58, 0.10)' : 'transparent',
                            cursor: 'pointer',
                            fontSize: 'var(--fs-13)',
                          }}
                        >
                          <input
                            type="checkbox"
                            checked={isPicked}
                            onChange={() => toggleOne(m.id)}
                          />
                          <span className={styles.codeCell} style={{ minWidth: 110 }}>
                            {m.code}
                          </span>
                          <span style={{ flex: 1 }}>{m.name}</span>
                          <span className={styles.previewPrice}>
                            {fmtRm(m.base_price_sen)}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    onClick={toggleAll}
                    style={{
                      marginTop: 8,
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--c-orange)',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--fs-12)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    {allPicked ? 'Deselect All' : 'Select All'}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <footer className={styles.modalFooter}>
          <Button variant="ghost"   size="md" onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            size="md"
            onClick={onConfirm}
            disabled={picked.size === 0}
          >
            <Check {...ICON} />
            Add {picked.size} module{picked.size === 1 ? '' : 's'}
          </Button>
        </footer>
      </div>
    </div>
  );
};
