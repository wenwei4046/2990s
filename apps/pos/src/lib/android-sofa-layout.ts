/**
 * Selects the sofa layout only; a simulation override does not emulate Android.
 * Android's desktop-site mode can advertise Linux instead of Android, so touch
 * Linux devices share this correction. This is not exact platform identification.
 */
export function usesAndroidSofaLayout(userAgent: string, simulation: boolean, search: string, maxTouchPoints = 0): boolean {
  if (simulation) {
    const device = new URLSearchParams(search).get('layoutDevice');
    if (device === 'android') return true;
    if (device === 'apple') return false;
  }
  if (/Android/i.test(userAgent)) return true;
  if (/iPhone|iPad|iPod|Macintosh/i.test(userAgent)) return false;
  return /Linux/i.test(userAgent) && maxTouchPoints > 0;
}
