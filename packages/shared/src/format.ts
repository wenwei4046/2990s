// Pure formatting helpers. Lifted from prototype per PORT_DESIGN.md §11.2 Issue 8.
// SOLE source of truth — no inline duplicates anywhere in client OR server.

/** Whole-MYR formatter. §10 Decision 9: integer RM only, never `.00`. */
export const fmtMoney = (n: number): string =>
  n.toLocaleString('en-MY', { maximumFractionDigits: 0 });

/** Returns "RM 2,990" — for inline copy where PriceTag is overkill. */
export const fmtRM = (n: number): string => `RM ${fmtMoney(n)}`;

/** "4 May 2026" — short, no day-of-week, no comma noise. */
export const fmtDate = (d: Date | string | number): string => {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleDateString('en-MY', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
};

/** "11:20 AM" — local 12h format. */
export const fmtTime = (d: Date | string | number): string => {
  const date = d instanceof Date ? d : new Date(d);
  return date.toLocaleTimeString('en-MY', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
};

/** "3 days ago" / "today" / "yesterday" / "in 2 days". */
export const daysAgo = (d: Date | string | number, now: Date = new Date()): string => {
  const date = d instanceof Date ? d : new Date(d);
  const ms = now.getTime() - date.getTime();
  const days = Math.round(ms / (24 * 60 * 60 * 1000));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days === -1) return 'tomorrow';
  if (days > 0) return `${days} days ago`;
  return `in ${-days} days`;
};

/** "RM 1,490 – 2,990" or "from RM 1,490" if max is missing. */
export const pricingRange = (min: number | null, max?: number | null): string => {
  if (min === null || min === undefined) return 'TBC';
  if (max === null || max === undefined || max === min) return `from RM ${fmtMoney(min)}`;
  return `RM ${fmtMoney(min)} – ${fmtMoney(max)}`;
};
