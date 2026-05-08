import { useEffect, useMemo } from 'react';
import { useForm, FormProvider, Controller } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useQueryClient } from '@tanstack/react-query';
import { X, Save, Plus, Trash2 } from 'lucide-react';
import { Button } from '@2990s/design-system';
import { productSchema } from '@2990s/shared/schemas';
import { supabase } from '../lib/supabase';
import {
  useBundleLibrary,
  useCategories,
  useCompartmentLibrary,
  useProductPricing,
  useSeries,
  useSizeLibrary,
  type ProductRow,
} from '../lib/queries';
import { PricingEditor } from './PricingEditor';
import styles from './SkuDrawer.module.css';

type PricingKind = ProductRow['pricingKind'];

interface SkuFormData {
  pricingKind: PricingKind;
  sku: string;
  categoryId: string;
  seriesId: string | null;
  name: string;
  detail: string | null;
  sizeDisplay: string | null;
  imgKey: string | null;
  thumbKey: string | null;
  stock: number;
  lowAt: number;
  visible: boolean;
  reclinerUpgradePrice?: number;
  compartments?: { compartmentId: string; active: boolean; price: number }[];
  bundles?: { bundleId: string; active: boolean; price: number }[];
  sizes?: { sizeId: string; active: boolean; price: number }[];
  flatPrice?: number;
}

const SKU_PREFIX: Record<string, string> = {
  sofa: 'SOF',
  mattress: 'MAT',
  bedframe: 'BED',
  dining: 'DIN',
  bathroom: 'BTH',
  kids: 'KID',
  accessory: 'ACC',
};

const pricingKindFor = (categoryId: string): PricingKind => {
  if (categoryId === 'sofa') return 'sofa_build';
  if (categoryId === 'mattress' || categoryId === 'bedframe') return 'size_variants';
  return 'tbc';
};

export interface SkuDrawerProps {
  mode: 'create' | 'edit';
  product: ProductRow | null;
  onClose: () => void;
}

export const SkuDrawer = ({ mode, product, onClose }: SkuDrawerProps) => {
  const qc = useQueryClient();
  const categories = useCategories();
  const seriesQ = useSeries();
  const compLib = useCompartmentLibrary();
  const bundleLib = useBundleLibrary();
  const sizeLib = useSizeLibrary();
  const existingPricing = useProductPricing(
    product?.id ?? null,
    product?.pricingKind ?? null,
  );

  // Default form values vary by mode + category. Computed once libraries are ready.
  const defaults = useMemo<SkuFormData | null>(() => {
    if (!compLib.data || !bundleLib.data || !sizeLib.data || !categories.data) return null;
    if (mode === 'edit' && !product) return null;
    if (mode === 'edit' && existingPricing.isLoading) return null;

    const baseCategory = product?.categoryId ?? 'mattress';
    const kind = product?.pricingKind ?? pricingKindFor(baseCategory);

    const seedCompartments = compLib.data
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({ compartmentId: l.id, active: true, price: l.defaultPrice }));
    const seedBundles = bundleLib.data
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({ bundleId: l.id, active: true, price: l.defaultPrice }));
    const seedSizes = sizeLib.data
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((l) => ({ sizeId: l.id, active: true, price: 0 }));

    // Existing edit: hydrate pricing rows from DB; missing rows fall back to seed defaults.
    // Extract narrowed views so TS doesn't lose discrimination inside the .map closures.
    const sofa = existingPricing.data?.kind === 'sofa_build' ? existingPricing.data : null;
    const sized = existingPricing.data?.kind === 'size_variants' ? existingPricing.data : null;
    const editComps = sofa
      ? seedCompartments.map((seed) =>
          sofa.compartments.find((r) => r.compartmentId === seed.compartmentId) ?? seed,
        )
      : seedCompartments;
    const editBundles = sofa
      ? seedBundles.map((seed) =>
          sofa.bundles.find((r) => r.bundleId === seed.bundleId) ?? seed,
        )
      : seedBundles;
    const editSizes = sized
      ? seedSizes.map((seed) =>
          sized.sizes.find((r) => r.sizeId === seed.sizeId) ?? seed,
        )
      : seedSizes;

    return {
      pricingKind: kind,
      sku: product?.sku ?? '',
      categoryId: baseCategory,
      seriesId: product?.seriesId ?? null,
      name: product?.name ?? '',
      detail: product?.detail ?? '',
      sizeDisplay: product?.sizeDisplay ?? '',
      imgKey: product?.imgKey ?? null,
      thumbKey: product?.thumbKey ?? null,
      stock: product?.stock ?? 0,
      lowAt: product?.lowAt ?? 5,
      visible: product?.visible ?? true,
      reclinerUpgradePrice: product?.reclinerUpgradePrice ?? 0,
      compartments: editComps,
      bundles: editBundles,
      sizes: editSizes,
      flatPrice: product?.flatPrice ?? 0,
    };
  }, [
    mode, product, existingPricing.data, existingPricing.isLoading,
    compLib.data, bundleLib.data, sizeLib.data, categories.data,
  ]);

  if (!defaults) {
    return (
      <div className={styles.scrim} onClick={onClose}>
        <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
          <div className={styles.loading}>Loading library…</div>
        </aside>
      </div>
    );
  }

  return <SkuDrawerForm defaults={defaults} mode={mode} product={product} onClose={onClose} qc={qc} categories={categories.data ?? []} seriesList={seriesQ.data ?? []} />;
};

interface SkuDrawerFormProps {
  defaults: SkuFormData;
  mode: 'create' | 'edit';
  product: ProductRow | null;
  onClose: () => void;
  qc: ReturnType<typeof useQueryClient>;
  categories: { id: string; label: string; tbc: boolean }[];
  seriesList: { id: string; label: string; active: boolean }[];
}

const SkuDrawerForm = ({ defaults, mode, product, onClose, qc, categories, seriesList }: SkuDrawerFormProps) => {
  const methods = useForm<SkuFormData>({
    defaultValues: defaults,
    resolver: zodResolver(productSchema) as never, // wider RHF type, narrower Zod
    mode: 'onSubmit',
  });
  const {
    control, register, handleSubmit, setValue, watch,
    formState: { isSubmitting, errors },
  } = methods;

  const categoryId = watch('categoryId');
  const sku = watch('sku');
  const name = watch('name');

  // When category changes during create, re-key pricingKind + auto-suggest SKU.
  useEffect(() => {
    if (mode !== 'create') return;
    const kind = pricingKindFor(categoryId);
    setValue('pricingKind', kind, { shouldDirty: true });
  }, [categoryId, mode, setValue]);

  // Auto-suggest SKU code in create mode when category changes (and only if user hasn't typed).
  useEffect(() => {
    if (mode !== 'create') return;
    const prefix = SKU_PREFIX[categoryId] ?? 'SKU';
    // Only autopopulate if current sku is empty or matches a previous prefix pattern.
    if (sku === '' || /^[A-Z]+-\d+$/.test(sku)) {
      setValue('sku', `${prefix}-001`, { shouldDirty: false });
    }
  }, [categoryId, mode, sku, setValue]);

  const onSubmit = handleSubmit(async (raw) => {
    // Strip irrelevant pricing arrays based on pricingKind so Zod's discriminated
    // union accepts the payload.
    const cleaned: Record<string, unknown> = {
      pricingKind: raw.pricingKind,
      sku: raw.sku,
      categoryId: raw.categoryId,
      seriesId: raw.seriesId || null,
      name: raw.name,
      detail: raw.detail || null,
      sizeDisplay: raw.sizeDisplay || null,
      imgKey: raw.imgKey,
      thumbKey: raw.thumbKey,
      stock: raw.stock,
      lowAt: raw.lowAt,
      visible: raw.visible,
    };
    if (raw.pricingKind === 'sofa_build') {
      cleaned.reclinerUpgradePrice = raw.reclinerUpgradePrice ?? 0;
      cleaned.compartments = raw.compartments;
      cleaned.bundles = raw.bundles;
    } else if (raw.pricingKind === 'size_variants') {
      cleaned.sizes = raw.sizes;
    } else if (raw.pricingKind === 'flat') {
      cleaned.flatPrice = raw.flatPrice ?? 0;
    }

    const valid = productSchema.parse(cleaned);

    // Step 3 of Phase 1 will move this into POST /api/products. For step 2,
    // we write directly via Supabase — admin RLS already gates this.
    let productId = product?.id ?? null;

    const productRow = {
      sku: valid.sku,
      category_id: valid.categoryId,
      series_id: valid.seriesId,
      pricing_kind: valid.pricingKind,
      name: valid.name,
      detail: valid.detail,
      size_display: valid.sizeDisplay,
      img_key: valid.imgKey,
      thumb_key: valid.thumbKey,
      stock: valid.stock,
      low_at: valid.lowAt,
      visible: valid.visible,
      flat_price: valid.pricingKind === 'flat' ? valid.flatPrice : null,
      recliner_upgrade_price: valid.pricingKind === 'sofa_build' ? valid.reclinerUpgradePrice : null,
    };

    if (mode === 'create') {
      const { data, error } = await supabase
        .from('products')
        .insert(productRow)
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      productId = data.id;
    } else if (productId) {
      const { error } = await supabase.from('products').update(productRow).eq('id', productId);
      if (error) throw new Error(error.message);
    }

    if (!productId) throw new Error('No product id after upsert');

    // Per-product pricing rows
    if (valid.pricingKind === 'sofa_build') {
      const comps = valid.compartments.map((c) => ({
        product_id: productId,
        compartment_id: c.compartmentId,
        active: c.active,
        price: c.price,
      }));
      const bundles = valid.bundles.map((b) => ({
        product_id: productId,
        bundle_id: b.bundleId,
        active: b.active,
        price: b.price,
      }));
      const [r1, r2] = await Promise.all([
        supabase.from('product_compartments').upsert(comps, { onConflict: 'product_id,compartment_id' }),
        supabase.from('product_bundles').upsert(bundles, { onConflict: 'product_id,bundle_id' }),
      ]);
      if (r1.error) throw new Error(r1.error.message);
      if (r2.error) throw new Error(r2.error.message);
    } else if (valid.pricingKind === 'size_variants') {
      const sizes = valid.sizes.map((s) => ({
        product_id: productId,
        size_id: s.sizeId,
        active: s.active,
        price: s.price,
      }));
      const r = await supabase
        .from('product_size_variants')
        .upsert(sizes, { onConflict: 'product_id,size_id' });
      if (r.error) throw new Error(r.error.message);
    }

    await qc.invalidateQueries({ queryKey: ['products'] });
    onClose();
  });

  const onRemove = async () => {
    if (!product) return;
    if (!confirm(`Remove SKU ${product.sku}? This cannot be undone.`)) return;
    const { error } = await supabase.from('products').delete().eq('id', product.id);
    if (error) {
      alert(`Failed to remove: ${error.message}`);
      return;
    }
    await qc.invalidateQueries({ queryKey: ['products'] });
    onClose();
  };

  return (
    <FormProvider {...methods}>
      <div className={styles.scrim} onClick={onClose}>
        <aside className={styles.drawer} onClick={(e) => e.stopPropagation()}>
          <header className={styles.head}>
            <div style={{ flex: 1 }}>
              <div className="t-eyebrow">{mode === 'create' ? 'New SKU' : 'Edit SKU'}</div>
              <h2 className={styles.title}>{name || (mode === 'create' ? 'Untitled piece' : 'Untitled')}</h2>
              {mode === 'edit' && product && (
                <div className={styles.sub}>
                  {product.sku} · last updated {new Date(product.updatedAt).toLocaleString()}
                </div>
              )}
            </div>
            <button type="button" className={styles.iconBtn} onClick={onClose} aria-label="Close">
              <X size={20} strokeWidth={1.75} />
            </button>
          </header>

          <form onSubmit={onSubmit} className={styles.body} noValidate>
            {/* Identity */}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Identity</h3>
              <div className={styles.grid}>
                <label className={`${styles.field} ${styles.span2}`}>
                  <span className="t-eyebrow">Display name *</span>
                  <input {...register('name')} placeholder="e.g. Cloud Series Mattress" />
                  {errors.name && <small className={styles.err}>{errors.name.message}</small>}
                </label>
                <label className={styles.field}>
                  <span className="t-eyebrow">Category *</span>
                  <select {...register('categoryId')}>
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.label}{c.tbc ? ' · TBC' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className="t-eyebrow">SKU code *</span>
                  <input
                    {...register('sku', {
                      onBlur: (e) => setValue('sku', e.target.value.toUpperCase(), { shouldDirty: true }),
                    })}
                    placeholder="SOF-001"
                    style={{ fontFamily: 'var(--font-mono)', letterSpacing: '0.04em' }}
                  />
                  {errors.sku && <small className={styles.err}>{errors.sku.message}</small>}
                </label>
                <label className={styles.field}>
                  <span className="t-eyebrow">Series</span>
                  <select {...register('seriesId')}>
                    <option value="">—</option>
                    {seriesList.filter((s) => s.active).map((s) => (
                      <option key={s.id} value={s.id}>{s.label}</option>
                    ))}
                  </select>
                </label>
                <label className={styles.field}>
                  <span className="t-eyebrow">Size / dimensions</span>
                  <input {...register('sizeDisplay')} placeholder="Queen · 152×190" />
                </label>
                <label className={`${styles.field} ${styles.span2}`}>
                  <span className="t-eyebrow">Short detail</span>
                  <input {...register('detail')} placeholder="Pocket spring · gel-infused memory foam" />
                </label>
              </div>
            </section>

            {/* Inventory */}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Inventory</h3>
              <div className={styles.grid}>
                <label className={styles.field}>
                  <span className="t-eyebrow">On-hand stock</span>
                  <input
                    type="number"
                    min={0}
                    {...register('stock', { valueAsNumber: true })}
                  />
                </label>
                <label className={styles.field}>
                  <span className="t-eyebrow">Low-stock alert at</span>
                  <input
                    type="number"
                    min={0}
                    {...register('lowAt', { valueAsNumber: true })}
                  />
                </label>
              </div>
            </section>

            {/* Pricing — category-aware */}
            <PricingEditor />

            {/* Visibility */}
            <section className={styles.section}>
              <h3 className={styles.sectionTitle}>Showroom visibility</h3>
              <Controller
                control={control}
                name="visible"
                render={({ field }) => (
                  <div className={styles.visibilityRow}>
                    <div>
                      <div className={styles.visibilityTitle}>
                        {field.value ? 'Live on showroom POS' : 'Hidden from showroom'}
                      </div>
                      <div className={styles.visibilitySub}>
                        {field.value
                          ? 'Sales staff can add this piece to baskets right now.'
                          : 'Coordinator-only — staff cannot add this to baskets until you turn it back on.'}
                      </div>
                    </div>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={field.value}
                      className={`${styles.bigToggle} ${field.value ? styles.bigToggleOn : ''}`}
                      onClick={() => field.onChange(!field.value)}
                    >
                      <span className={styles.bigToggleKnob} />
                    </button>
                  </div>
                )}
              />
            </section>

            {/* Footer */}
            <footer className={styles.foot}>
              {mode === 'edit' && (
                <button type="button" className={styles.removeBtn} onClick={onRemove}>
                  <Trash2 size={16} strokeWidth={1.75} />
                  Remove SKU
                </button>
              )}
              <div style={{ flex: 1 }} />
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button type="submit" variant="primary" disabled={isSubmitting}>
                {mode === 'create'
                  ? <><Plus size={16} strokeWidth={1.75} />{isSubmitting ? 'Creating…' : 'Create SKU'}</>
                  : <><Save size={16} strokeWidth={1.75} />{isSubmitting ? 'Saving…' : 'Save changes'}</>}
              </Button>
            </footer>
          </form>
        </aside>
      </div>
    </FormProvider>
  );
};
