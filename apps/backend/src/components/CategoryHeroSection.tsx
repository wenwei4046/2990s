// Task 18 — category hero photos section for SKU Master.
//
// Lets admins/coordinators upload one hero image per category. Images are
// stored at category-heroes/<id>.<ext> in the 2990s-public R2 bucket and the
// Confirmed page (Task 16) picks the dominant-category image for the hero.
//
// Renders read-only when the caller's role is not admin/coordinator — the
// API enforces this independently; the UI gating is just to avoid showing
// dead buttons.

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useAuth } from '../lib/auth';
import { CategoryHeroUploader } from './CategoryHeroUploader';
import styles from './CategoryHeroSection.module.css';

interface CategoryHeroRow {
  id: string;
  label: string;
  heroImageKey: string | null;
  sortOrder: number;
}

const useCategoryHeroes = () =>
  useQuery({
    queryKey: ['category-heroes'],
    queryFn: async (): Promise<CategoryHeroRow[]> => {
      const { data, error } = await supabase
        .from('categories')
        .select('id, label, hero_image_key, sort_order')
        .order('sort_order');
      if (error) throw error;
      return (data ?? []).map((r) => ({
        id: r.id,
        label: r.label,
        heroImageKey: r.hero_image_key,
        sortOrder: r.sort_order,
      }));
    },
    staleTime: 60_000,
  });

const ADMIN_ROLES = new Set(['admin', 'coordinator']);

export const CategoryHeroSection = () => {
  const { staff } = useAuth();
  const qc = useQueryClient();
  const heroes = useCategoryHeroes();

  const canEdit = !!staff && ADMIN_ROLES.has(staff.role);

  // After upload/remove, the API has already persisted the new key — refetch
  // to keep this page's data fresh and invalidate any other consumer of
  // categories (e.g. the existing useCategories() in queries.ts so future
  // reads also pick up the change).
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['category-heroes'] });
    void qc.invalidateQueries({ queryKey: ['library', 'categories'] });
  };

  const rows = heroes.data ?? [];

  return (
    <section className={styles.section}>
      <header className={styles.head}>
        <div>
          <div className="t-eyebrow">Visual customisation · per category</div>
          <h3 className={styles.title}>Category hero photos</h3>
          <p className={`t-body fg-muted ${styles.lede}`}>
            The Confirmed page hero uses the photo of the dominant category in
            the order. JPEG or PNG, up to 4 MB.
          </p>
        </div>
      </header>

      {heroes.isLoading ? (
        <div className={styles.empty}>Loading categories…</div>
      ) : heroes.error ? (
        <div className={styles.empty}>Failed to load: {String(heroes.error)}</div>
      ) : rows.length === 0 ? (
        <div className={styles.empty}>No categories yet.</div>
      ) : (
        <div className={styles.grid}>
          {rows.map((c) => (
            <div key={c.id} className={styles.row}>
              <div className={styles.label}>{c.label}</div>
              {canEdit ? (
                <CategoryHeroUploader
                  categoryId={c.id}
                  currentKey={c.heroImageKey}
                  onChange={invalidate}
                />
              ) : (
                <div className={styles.readOnly}>
                  {c.heroImageKey ? 'Image set' : 'No image'}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
