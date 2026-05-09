const DO_KEY_RE = /^dos\/\d{4}\/\d{2}\/[A-Za-z0-9._-]+\.(jpg|jpeg|png|webp|pdf)$/;

export function isValidDoKey(key: string): boolean {
  if (key.includes('..')) return false;
  return DO_KEY_RE.test(key);
}

export type Lane = 'received' | 'proceed' | 'logistics' | 'ready' | 'dispatched' | 'delivered' | 'cancelled';

const FORWARD_ORDER: Lane[] = ['received', 'proceed', 'logistics', 'ready', 'dispatched', 'delivered'];

/**
 * Valid transitions:
 *   - from ≠ to
 *   - Forward: exactly +1 in FORWARD_ORDER
 *   - Backward: any earlier in FORWARD_ORDER (coord step-back override)
 *   - to=cancelled: from any non-cancelled
 *   - from=cancelled: to any lane (un-cancel)
 *
 * Lane gate enforcement (driver_id, do_key) is separate (in route handler).
 */
export function isValidLaneTransition(from: Lane, to: Lane): boolean {
  if (from === to) return false;
  if (to === 'cancelled') return from !== 'cancelled';
  if (from === 'cancelled') return true;

  const fromIdx = FORWARD_ORDER.indexOf(from);
  const toIdx = FORWARD_ORDER.indexOf(to);
  if (fromIdx === -1 || toIdx === -1) return false;

  if (toIdx > fromIdx) return toIdx === fromIdx + 1;
  return true;
}
