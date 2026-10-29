import { resolvePhotoUrl } from '../queries';

export const SOFA_COMPARTMENT_API_PREFIX = 'sofa-compartments/';

/** Uploaded compartment photos use the same active API as their upload/data
 *  endpoints. Bundled module art stays on the POS origin. */
export function resolveCompartmentImageSrc(
  code: string,
  imageKey: string | undefined,
): string | null {
  if (!imageKey) return null;
  if (/^https?:\/\//i.test(imageKey)) return resolvePhotoUrl(imageKey);
  if (imageKey.startsWith(SOFA_COMPARTMENT_API_PREFIX)) {
    return resolvePhotoUrl(
      `/maintenance-config/sofa-compartments/${encodeURIComponent(code)}/photo/${encodeURIComponent(imageKey)}`,
    );
  }
  // Legacy bundled SVG / PNG from /public.
  return `/${imageKey}`;
}
