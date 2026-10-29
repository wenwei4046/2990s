import { resolvePhotoUrl, type MfgCatalogRow } from './queries';

interface ModelPresentation {
  id: string;
  branding: string | null;
  name: string;
  photo_url: string | null;
  active: boolean;
}

/** The Model owns its brand, name and photo. Older SKUs retain the branding
 * copied when they were generated, so they cannot describe a later Model edit.
 * Join only by the canonical ID; names/codes may overlap or be renamed. */
export function withCatalogModelPresentation(
  rows: MfgCatalogRow[],
  models: ModelPresentation[],
): MfgCatalogRow[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  return rows.flatMap((row) => {
    const model = row.modelId ? byId.get(row.modelId) : undefined;
    if (!model) return [row];
    if (!model.active) return [];
    return [{
      ...row,
      // A cleared Model brand is intentional, just like a removed photo.
      branding: model.branding?.trim() || null,
      modelName: model.name.trim() || row.modelName,
      // A saved null means the photo was removed. Do not resurrect a cached one.
      photoUrl: resolvePhotoUrl(model.photo_url),
    }];
  });
}
