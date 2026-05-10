import { useEffect, useState } from 'react';
import {
  Plus,
  PlusCircle,
  History,
  Pencil,
  Recycle,
  ArrowUpFromLine,
  Wrench,
  Package,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
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

const ICON_MAP: Record<string, LucideIcon> = {
  recycle: Recycle,
  'arrow-up-from-line': ArrowUpFromLine,
  wrench: Wrench,
  package: Package,
  sparkles: Sparkles,
};

const iconFor = (name: string): LucideIcon => ICON_MAP[name] ?? Package;

const fmtStock = (stock: number | null): string =>
  stock == null ? '∞' : stock.toLocaleString('en-MY');

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
      <div className={styles.banner}>
        <div className={styles.bannerIcon} style={{ background: 'var(--c-secondary-a)' }}>
          <PlusCircle size={18} strokeWidth={1.75} />
        </div>
        <div className={styles.bannerCopy}>
          <div className={styles.bannerTitle}>Add-on products &amp; services</div>
          <div className={styles.bannerSub}>
            Edit pricing, units and availability for things sold alongside furniture — disposal,
            lift access, assembly, accessories.
          </div>
        </div>
        <button type="button" className={styles.btnPrimary} disabled={!isAdmin} title={isAdmin ? 'Add a new add-on' : 'Admin only'}>
          <Plus size={14} strokeWidth={2} />
          New add-on
        </button>
      </div>

      {!isAdmin && (
        <div className={styles.readOnlyBanner}>
          <strong>Read-only view.</strong> Add-on editing is admin-only. Ask Loo for access if you
          need to change pricing or visibility.
        </div>
      )}

      {addons.isLoading ? (
        <div className={styles.empty}>Loading add-ons…</div>
      ) : addons.error ? (
        <div className={styles.empty}>Failed to load add-ons: {String(addons.error)}</div>
      ) : (addons.data?.length ?? 0) === 0 ? (
        <div className={styles.empty}>No add-ons seeded yet.</div>
      ) : (
        <div className={styles.grid}>
          {addons.data!.map((a) => (
            <AddonCard
              key={a.id}
              addon={a}
              isAdmin={isAdmin}
              onSave={(patch) => mutation.mutate({ id: a.id, patch })}
            />
          ))}

          <button type="button" className={styles.cardPlaceholder} disabled={!isAdmin} title={isAdmin ? 'Add a new add-on' : 'Admin only'}>
            <span className={styles.placeholderIcon}>
              <Plus size={18} strokeWidth={1.75} />
            </span>
            <span className={styles.placeholderName}>Add a new add-on</span>
            <span className={styles.placeholderDesc}>
              Disposal, lift access, assembly — anything sold alongside.
            </span>
          </button>
        </div>
      )}
    </div>
  );
};

interface AddonCardProps {
  addon: AddonRow;
  isAdmin: boolean;
  onSave: (patch: AddonPatch) => void;
}

const AddonCard = ({ addon, isAdmin, onSave }: AddonCardProps) => {
  const Icon = iconFor(addon.icon);
  const [priceDraft, setPriceDraft] = useState(String(addon.price));
  const [floorDraft, setFloorDraft] = useState(
    addon.perFloorItem == null ? '' : String(addon.perFloorItem),
  );

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

  // Lift uses the per-floor·item rate as its primary price knob; everything
  // else uses base price. Show the right one inline so the card stays compact.
  const isFloors = addon.kind === 'floors_items';
  const primaryDraft = isFloors ? floorDraft : priceDraft;
  const setPrimaryDraft = isFloors ? setFloorDraft : setPriceDraft;
  const commitPrimary = isFloors ? commitFloor : commitPrice;
  const onPrimaryKey = isFloors ? onFloorKey : onPriceKey;
  const primaryValue = isFloors ? addon.perFloorItem ?? 0 : addon.price;
  const unitLabel = isFloors ? `per floor·${addon.unit ?? 'item'}` : `per ${addon.unit ?? 'piece'}`;

  return (
    <div className={`${styles.card} ${addon.enabled ? '' : styles.cardDisabled}`}>
      <div className={styles.head}>
        <span className={styles.icon}>
          <Icon size={18} strokeWidth={1.75} />
        </span>
        <div className={styles.headCopy}>
          <div className={styles.name}>{addon.label}</div>
          {addon.description && <div className={styles.desc}>{addon.description}</div>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={addon.enabled}
          aria-label={`${addon.enabled ? 'Disable' : 'Enable'} ${addon.label}`}
          disabled={!isAdmin}
          className={`${styles.toggle} ${addon.enabled ? styles.toggleOn : ''} ${!isAdmin ? styles.toggleReadonly : ''}`}
          onClick={() => isAdmin && onSave({ enabled: !addon.enabled })}
        />
      </div>

      <div className={styles.priceRow}>
        {isAdmin ? (
          <div className={styles.priceInput}>
            <span>RM</span>
            <input
              type="number"
              inputMode="numeric"
              min={0}
              step={1}
              value={primaryDraft}
              onChange={(e) => setPrimaryDraft(e.target.value)}
              onBlur={commitPrimary}
              onKeyDown={onPrimaryKey}
              aria-label={`${addon.label} price`}
            />
          </div>
        ) : (
          <span className={styles.priceLabel}>RM {primaryValue.toLocaleString('en-MY')}</span>
        )}
        <span className={styles.unit}>{unitLabel}</span>
      </div>

      <div className={styles.foot}>
        <span className={styles.stock}>
          Stock · <strong>{fmtStock(addon.stock)}</strong>
        </span>
        <span className={styles.actions}>
          <button type="button" className={styles.iconBtn} aria-label="History" title="History">
            <History size={14} strokeWidth={1.75} />
          </button>
          <button type="button" className={styles.iconBtn} aria-label="Edit" title="Edit" disabled={!isAdmin}>
            <Pencil size={14} strokeWidth={1.75} />
          </button>
        </span>
      </div>
    </div>
  );
};
