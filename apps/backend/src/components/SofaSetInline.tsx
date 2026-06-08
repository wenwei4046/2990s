// ----------------------------------------------------------------------------
// SofaSetInline — inline (no-modal) picker for adding a Sofa Set.
//
// PR #145 — Commander 2026-05-26: "我的点选 Multiple Select Product Code
// 怎么跟我的 Hookka 那边不一样呢". HOOKKA places the Model + Modules picker
// directly in the SO form (apps/(dashboard)/sales/create/page.tsx — Category
// → Model dropdown → Module multi-select dropdown, all inline in the line
// entry grid). Our previous SofaSetDialog (PR #142) put the same picker
// behind a modal popup, which felt heavier than HOOKKA's.
//
// This inline version sits at the top of the LINES section as a quick-add
// bar:
//   Model: [ANNSA ▾]   Modules: [▾ check N]   [Add 3 modules]
//
// On "Add", calls onAdd with the picked SKUs — parent splices them as new
// draft lines (price + code + name pre-filled, variants empty so the
// post-add cascade can fan LINE 1's seat/leg/fabric to lines 2…N).
// ----------------------------------------------------------------------------

import { useMemo, useRef, useState, useEffect } from 'react';
import { Check, ChevronDown, Sofa } from 'lucide-react';
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

export type SofaSetModule = {
  itemCode:       string;
  description:    string;
  unitPriceCenti: number;
};

export const SofaSetInline = ({
  onAdd,
}: {
  onAdd: (modules: SofaSetModule[]) => void;
}) => {
  const productsQuery = useMfgProducts({ category: 'SOFA' });
  const sofaProducts: MfgProductRow[] = useMemo(() => productsQuery.data ?? [], [productsQuery.data]);

  const models = useMemo(() => {
    const set = new Set<string>();
    for (const p of sofaProducts) {
      if (p.base_model) set.add(p.base_model);
    }
    return [...set].sort();
  }, [sofaProducts]);

  const [model, setModel] = useState<string>('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [showModules, setShowModules] = useState(false);
  const moduleRef = useRef<HTMLDivElement>(null);

  // Close module dropdown when clicking outside.
  useEffect(() => {
    if (!showModules) return;
    const onDocClick = (e: MouseEvent) => {
      if (moduleRef.current && !moduleRef.current.contains(e.target as Node)) {
        setShowModules(false);
      }
    };
    document.addEventListener('mousedown', onDocClick);
    return () => document.removeEventListener('mousedown', onDocClick);
  }, [showModules]);

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
    setPicked(new Set());
    setModel('');
    setShowModules(false);
  };

  const triggerLabel =
    picked.size > 0
      ? `${picked.size} module${picked.size === 1 ? '' : 's'} selected`
      : model
        ? 'Select modules…'
        : 'Pick model first';

  return (
    <div
      style={{
        background: 'var(--c-cream)',
        border: '1px dashed var(--c-burnt)',
        borderRadius: 'var(--radius-md)',
        padding: 'var(--space-3)',
        display: 'flex',
        alignItems: 'flex-end',
        gap: 'var(--space-3)',
        flexWrap: 'wrap',
      }}
    >
      <Sofa {...ICON} style={{ color: 'var(--c-burnt)', marginBottom: 8 }} />

      {/* Model picker */}
      <label className={styles.field} style={{ minWidth: 160 }}>
        <span className={styles.fieldLabel}>Sofa Set · Model</span>
        <select
          className={styles.fieldSelect}
          value={model}
          onChange={(e) => { setModel(e.target.value); setPicked(new Set()); }}
        >
          <option value="">— Pick model —</option>
          {models.map((m) => (
            <option key={m} value={m}>{m}</option>
          ))}
        </select>
      </label>

      {/* Module multi-select dropdown */}
      <div ref={moduleRef} style={{ position: 'relative', flex: 1, minWidth: 220 }}>
        <span className={styles.fieldLabel} style={{ display: 'block', marginBottom: 4 }}>Modules</span>
        <button
          type="button"
          disabled={!model}
          onClick={() => setShowModules((s) => !s)}
          className={styles.fieldSelect}
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'var(--c-paper)',
            cursor: model ? 'pointer' : 'not-allowed',
            opacity: model ? 1 : 0.6,
            textAlign: 'left',
          }}
        >
          <span style={{
            color: picked.size > 0 ? 'var(--c-ink)' : 'var(--fg-muted)',
            fontSize: 'var(--fs-13)',
          }}>
            {triggerLabel}
          </span>
          <ChevronDown size={14} strokeWidth={1.75} />
        </button>
        {showModules && (
          <div
            style={{
              position: 'absolute',
              top: 'calc(100% + 4px)',
              left: 0,
              right: 0,
              maxHeight: 280,
              overflowY: 'auto',
              background: 'var(--c-paper)',
              border: '1px solid var(--line-strong)',
              borderRadius: 'var(--radius-md)',
              boxShadow: 'var(--shadow-2)',
              zIndex: 30,
            }}
          >
            {modules.length === 0 ? (
              <p style={{
                margin: 0, padding: 'var(--space-3)',
                fontSize: 'var(--fs-12)', color: 'var(--fg-muted)',
              }}>
                No modules under <strong>{model}</strong>.
              </p>
            ) : (
              <>
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
                        cursor: 'pointer',
                        fontSize: 'var(--fs-13)',
                        background: isPicked ? 'rgba(232, 107, 58, 0.10)' : 'transparent',
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
                      <span style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 'var(--fs-12)',
                        color: 'var(--fg-muted)',
                      }}>
                        {fmtRm(m.base_price_sen)}
                      </span>
                    </label>
                  );
                })}
                <div style={{
                  borderTop: '1px solid var(--line)',
                  padding: '6px 10px',
                  background: 'var(--c-cream)',
                }}>
                  <button
                    type="button"
                    onClick={toggleAll}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--c-orange)',
                      fontFamily: 'var(--font-sans)',
                      fontSize: 'var(--fs-12)', fontWeight: 600,
                      cursor: 'pointer', padding: 0,
                    }}
                  >
                    {allPicked ? 'Deselect All' : 'Select All'}
                  </button>
                </div>
              </>
            )}
          </div>
        )}
      </div>

      {/* Add button */}
      <Button
        variant="primary"
        size="md"
        onClick={onConfirm}
        disabled={picked.size === 0}
      >
        <Check {...ICON} />
        Add {picked.size > 0 ? `${picked.size} module${picked.size === 1 ? '' : 's'}` : 'Set'}
      </Button>
    </div>
  );
};
