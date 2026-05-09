import { useEffect, useState } from 'react';
import { Check, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../lib/auth';
import { useAddons, type AddonRow } from '../lib/queries';
import { supabase } from '../lib/supabase';
import styles from './Addons.module.css';

interface AddonPatch {
  price?: number;
  perFloorItem?: number | null;
  enabled?: boolean;
}

export const Addons = () => {
  const { staff } = useAuth();
  const addons = useAddons();
  const isAdmin = staff?.role === 'admin';

  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: AddonPatch }) => {
      const update: Record<string, unknown> = {};
      if (patch.price !== undefined) update.price = patch.price;
      if (patch.perFloorItem !== undefined) update.per_floor_item = patch.perFloorItem;
      if (patch.enabled !== undefined) update.enabled = patch.enabled;
      update.updated_at = new Date().toISOString();
      const { error } = await supabase.from('addons').update(update).eq('id', id);
      if (error) throw error;
    },
    // Optimistic: write to cache immediately, roll back on error.
    onMutate: async ({ id, patch }) => {
      await qc.cancelQueries({ queryKey: ['addons'] });
      const prev = qc.getQueryData<AddonRow[]>(['addons']);
      qc.setQueryData<AddonRow[]>(['addons'], (rows) =>
        (rows ?? []).map((r) =>
          r.id === id
            ? {
                ...r,
                ...(patch.price !== undefined ? { price: patch.price } : {}),
                ...(patch.perFloorItem !== undefined ? { perFloorItem: patch.perFloorItem } : {}),
                ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
              }
            : r,
        ),
      );
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(['addons'], ctx.prev);
    },
    onSettled: () => {
      void qc.invalidateQueries({ queryKey: ['addons'] });
    },
  });

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <div className="t-eyebrow">Delivery extras · per addon</div>
          <h2 className={styles.title}>Add-ons</h2>
          <p className={`t-body fg-muted ${styles.lede}`}>
            The 6 seeded delivery add-ons. Sales staff attach these at checkout — disable an add-on
            here and it disappears from POS immediately. Lift access uses per-floor·item pricing;
            the rest are flat per piece.
          </p>
        </div>
      </header>

      {!isAdmin && (
        <div className={styles.readOnlyBanner}>
          <strong>Read-only view.</strong> Add-on editing is admin-only. Ask Loo for access if you
          need to change pricing or visibility.
        </div>
      )}

      <div className={styles.tableCard}>
        {addons.isLoading ? (
          <div className={styles.empty}>Loading add-ons…</div>
        ) : addons.error ? (
          <div className={styles.empty}>Failed to load add-ons: {String(addons.error)}</div>
        ) : (addons.data?.length ?? 0) === 0 ? (
          <div className={styles.empty}>No add-ons seeded yet.</div>
        ) : (
          <table className={styles.table}>
            <thead>
              <tr>
                <th>Add-on</th>
                <th>ID</th>
                <th>Pricing</th>
                <th className={styles.priceCol}>Base price (RM)</th>
                <th className={styles.priceCol}>Per floor·item (RM)</th>
                <th>Enabled</th>
              </tr>
            </thead>
            <tbody>
              {addons.data!.map((a) => (
                <AddonRowView
                  key={a.id}
                  addon={a}
                  isAdmin={isAdmin}
                  onSave={(patch) => mutation.mutate({ id: a.id, patch })}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

interface AddonRowViewProps {
  addon: AddonRow;
  isAdmin: boolean;
  onSave: (patch: AddonPatch) => void;
}

const AddonRowView = ({ addon, isAdmin, onSave }: AddonRowViewProps) => {
  // Local draft state for inline number inputs. We commit on blur or Enter
  // so admins can scrub a value without spamming the API on every keystroke.
  const [priceDraft, setPriceDraft] = useState(String(addon.price));
  const [floorDraft, setFloorDraft] = useState(
    addon.perFloorItem == null ? '' : String(addon.perFloorItem),
  );

  // Re-sync when query data changes (e.g. after invalidation following mutation).
  useEffect(() => {
    setPriceDraft(String(addon.price));
  }, [addon.price]);
  useEffect(() => {
    setFloorDraft(addon.perFloorItem == null ? '' : String(addon.perFloorItem));
  }, [addon.perFloorItem]);

  const commitPrice = () => {
    const next = Number(priceDraft);
    if (!Number.isFinite(next) || next < 0) {
      setPriceDraft(String(addon.price));
      return;
    }
    const rounded = Math.round(next);
    if (rounded !== addon.price) onSave({ price: rounded });
    setPriceDraft(String(rounded));
  };

  const commitFloor = () => {
    if (addon.kind !== 'floors_items') return;
    const trimmed = floorDraft.trim();
    if (trimmed === '') {
      if (addon.perFloorItem != null) onSave({ perFloorItem: null });
      return;
    }
    const next = Number(trimmed);
    if (!Number.isFinite(next) || next < 0) {
      setFloorDraft(addon.perFloorItem == null ? '' : String(addon.perFloorItem));
      return;
    }
    const rounded = Math.round(next);
    if (rounded !== addon.perFloorItem) onSave({ perFloorItem: rounded });
    setFloorDraft(String(rounded));
  };

  const onPriceKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      setPriceDraft(String(addon.price));
      (e.currentTarget as HTMLInputElement).blur();
    }
  };
  const onFloorKey = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
    if (e.key === 'Escape') {
      setFloorDraft(addon.perFloorItem == null ? '' : String(addon.perFloorItem));
      (e.currentTarget as HTMLInputElement).blur();
    }
  };

  return (
    <tr className={addon.enabled ? '' : styles.rowDisabled}>
      <td>
        <div className={styles.addonCell}>
          <span className={styles.addonName}>{addon.label}</span>
          {addon.description && <span className={styles.addonDesc}>{addon.description}</span>}
        </div>
      </td>
      <td><code className={styles.idCode}>{addon.id}</code></td>
      <td>
        <span className={styles.kindPill}>
          {addon.kind === 'floors_items' ? 'per floor·item' : `per ${addon.unit ?? 'piece'}`}
        </span>
      </td>
      <td className={styles.priceCol}>
        {isAdmin ? (
          <input
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            className={styles.priceInput}
            value={priceDraft}
            onChange={(e) => setPriceDraft(e.target.value)}
            onBlur={commitPrice}
            onKeyDown={onPriceKey}
            aria-label={`${addon.label} base price`}
          />
        ) : (
          <span className={styles.priceLabel}>RM {addon.price.toLocaleString('en-MY')}</span>
        )}
      </td>
      <td className={styles.priceCol}>
        {addon.kind === 'floors_items' ? (
          isAdmin ? (
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              className={styles.priceInput}
              value={floorDraft}
              onChange={(e) => setFloorDraft(e.target.value)}
              onBlur={commitFloor}
              onKeyDown={onFloorKey}
              aria-label={`${addon.label} per floor·item price`}
            />
          ) : (
            <span className={styles.priceLabel}>
              {addon.perFloorItem == null
                ? '—'
                : `RM ${addon.perFloorItem.toLocaleString('en-MY')}`}
            </span>
          )
        ) : (
          <span className={styles.priceLabel}>—</span>
        )}
      </td>
      <td>
        {isAdmin ? (
          <button
            type="button"
            role="switch"
            aria-checked={addon.enabled}
            aria-label={`${addon.enabled ? 'Disable' : 'Enable'} ${addon.label}`}
            className={`${styles.toggle} ${addon.enabled ? styles.toggleOn : ''}`}
            onClick={() => onSave({ enabled: !addon.enabled })}
          >
            <span className={styles.toggleKnob} />
          </button>
        ) : addon.enabled ? (
          <span className={styles.statYes}><Check size={14} strokeWidth={1.75} /> Enabled</span>
        ) : (
          <span className={styles.statNo}><X size={14} strokeWidth={1.75} /> Disabled</span>
        )}
      </td>
    </tr>
  );
};
