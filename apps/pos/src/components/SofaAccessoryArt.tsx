import type { SofaAccessoryRole } from '../lib/sofa-accessories';

/* Plan-view tile for a Sofa Accessory in the Custom build palette (owner
   2026-10-16) — drawn in the module art's language: line #2C2C2A, and softer
   cushion tones than the seat (#F0E6D6) / backrest (#D9C2A0) / arm (#B89972)
   so it reads as a loose piece. The canvas draws the same shapes in CSS
   (CustomBuilder.module.css .accessory*). */

const INK = '#2C2C2A';
const CUSHION = '#E9DAC1';
const SUPPORT = '#DCC7A6';
const ARM = '#CDB38D';
const SEAM = { fill: 'none', stroke: INK, strokeWidth: 0.7, strokeDasharray: '2 1.6', opacity: 0.55 } as const;

export const SofaAccessoryArt = ({ role, size = 44 }: { role: SofaAccessoryRole; size?: number }) => {
  if (role === 'arm') {
    return (
      <svg viewBox="0 0 40 60" width={(size * 2) / 3} height={size} aria-hidden>
        <rect x="12" y="3" width="16" height="54" rx="5" fill={ARM} stroke={INK} strokeWidth="1.3" />
        <rect x="15" y="7" width="10" height="46" rx="3" {...SEAM} />
      </svg>
    );
  }
  if (role === 'back-support') {
    return (
      <svg viewBox="0 0 60 40" width={size} height={(size * 2) / 3} aria-hidden>
        <rect x="3" y="6" width="54" height="9" rx="3" fill={SUPPORT} stroke={INK} strokeWidth="1.3" />
        <rect x="3" y="18" width="54" height="17" rx="6" fill="none" stroke={INK} strokeWidth="0.9" strokeDasharray="2.5 2" opacity="0.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 60 40" width={size} height={(size * 2) / 3} aria-hidden>
      <rect x="3" y="9" width="54" height="22" rx="6" fill={CUSHION} stroke={INK} strokeWidth="1.3" />
      <rect x="7" y="13" width="46" height="14" rx="4" {...SEAM} />
    </svg>
  );
};
