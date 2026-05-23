// Silhouette-bbox measurement for sofa-module PNGs. All module art is 1024×1024
// with the drawn silhouette padded inside; to tile modules tightly (console,
// corner presets) we measure each silhouette's alpha bbox once and scale/offset
// the img so the silhouette fills its cm footprint. Mirrors the technique in
// CustomBuilder's drag canvas; kept here so SofaCellsPreview can compose preset
// shapes from module art with NO dedicated composite PNG.

/** Silhouette bbox within a PNG, as fractions (0..1) of the PNG's width/height. */
export interface ArtBbox { l: number; t: number; r: number; b: number }

const ART_BBOX_FALLBACK: ArtBbox = { l: 0.1, t: 0.2, r: 0.9, b: 0.8 };
const bboxCache = new Map<string, ArtBbox>();
const bboxPending = new Map<string, Promise<ArtBbox>>();

/** Synchronous cache read — undefined until measureArtBbox(src) has resolved. */
export const getCachedArtBbox = (src: string): ArtBbox | undefined => bboxCache.get(src);

/** Measure (and cache) a module PNG's silhouette bbox. Idempotent per src. */
export const measureArtBbox = (src: string): Promise<ArtBbox> => {
  const cached = bboxCache.get(src);
  if (cached) return Promise.resolve(cached);
  const pending = bboxPending.get(src);
  if (pending) return pending;
  const p = new Promise<ArtBbox>((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      try {
        const c = document.createElement('canvas');
        c.width = img.width;
        c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) { bboxCache.set(src, ART_BBOX_FALLBACK); resolve(ART_BBOX_FALLBACK); return; }
        ctx.drawImage(img, 0, 0);
        const d = ctx.getImageData(0, 0, img.width, img.height).data;
        let minX = img.width, minY = img.height, maxX = 0, maxY = 0;
        for (let y = 0; y < img.height; y += 2) {
          for (let x = 0; x < img.width; x += 2) {
            if (d[(y * img.width + x) * 4 + 3]! > 16) {
              if (x < minX) minX = x;
              if (y < minY) minY = y;
              if (x > maxX) maxX = x;
              if (y > maxY) maxY = y;
            }
          }
        }
        const bbox: ArtBbox = maxX < minX || maxY < minY
          ? ART_BBOX_FALLBACK
          : { l: minX / img.width, t: minY / img.height, r: maxX / img.width, b: maxY / img.height };
        bboxCache.set(src, bbox);
        resolve(bbox);
      } catch {
        bboxCache.set(src, ART_BBOX_FALLBACK);
        resolve(ART_BBOX_FALLBACK);
      }
    };
    img.onerror = () => { bboxCache.set(src, ART_BBOX_FALLBACK); resolve(ART_BBOX_FALLBACK); };
    img.src = src;
  });
  bboxPending.set(src, p);
  return p;
};
