// ----------------------------------------------------------------------------
// VariantsPills — per-line variant summary pills.
// Extracted from SalesOrderDetail.tsx (task #61).
// ----------------------------------------------------------------------------

import { memo } from 'react';
import styles from '../SalesOrderDetail.module.css';

/* PR #168 — Commander 2026-05-27: "字体统一". Pill keys were rendering as
   camelCase variable names which read like debug output. Map known keys to
   human Title Case labels, fall back to camelCase → "Camel Case" splitter. */
const VARIANT_KEY_LABELS: Record<string, string> = {
  gap:          'Gap',
  legHeight:    'Leg Height',
  fabricCode:   'Fabric Code',
  divanHeight:  'Divan Height',
  totalHeight:  'Total Height',
  seatHeight:   'Seat Height',
  specials:     'Specials',
};

const camelCaseToTitle = (s: string): string => {
  if (!s) return s;
  const spaced = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const formatVariantValue = (v: unknown): string => {
  if (Array.isArray(v)) return v.map((x) => String(x)).join(', ');
  return String(v);
};

export const VariantsPills = memo(({ variants }: { variants: Record<string, unknown> | null }) => {
  if (!variants || typeof variants !== 'object') return null;
  const entries = Object.entries(variants).filter(([, v]) => {
    if (v == null || v === '') return false;
    if (Array.isArray(v) && v.length === 0) return false;
    return true;
  });
  if (entries.length === 0) return null;
  return (
    <div className={styles.variantBlock}>
      {entries.map(([k, v]) => (
        <span key={k} className={styles.variantPill}>
          {VARIANT_KEY_LABELS[k] ?? camelCaseToTitle(k)}: {formatVariantValue(v)}
        </span>
      ))}
    </div>
  );
});
VariantsPills.displayName = 'VariantsPills';
