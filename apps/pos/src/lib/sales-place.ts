/* ─── My orders: the "showroom or roadshow event" pick ────────────────────
 *
 * Owner 2026-10-30: the board and its two KPI cards pooled every showroom and
 * every roadshow into one figure, "difficult to manage" — he wants to pick a
 * showroom, or a roadshow and which event.
 *
 * Houzs splits the period's orders two ways (its scm/lib/pos-sales-place.ts):
 * an order linked to a roadshow event (its PMS project) counts under that
 * event; every other order counts under the venue it was sold at — a showroom,
 * normally. Each order lands in exactly one entry, so the entries add up to the
 * card. GET /pos/sales-stats answers the list (`places`) and narrows both cards
 * by `?project=` / `?venue=`; GET /mfg-sales-orders/mine narrows the board by
 * the same rule, so the board shows the orders the cards count.
 *
 * An API without the pick (an older Houzs build, or the 2990 API) answers no
 * `places`: the picker stays hidden, because such an API would ignore the pick
 * and the cards would show every place under one place's name.
 * ------------------------------------------------------------------------ */

/** `?venue=` asking for the orders with no venue recorded. */
export const NO_VENUE = '__none__';

export type SalesPlaceEntry =
  | {
      kind: 'venue';
      /** As stored; null for the orders with no venue recorded. */
      venue: string | null;
      count: number;
    }
  | {
      kind: 'event';
      projectId: number;
      /** All null when Houzs could not read the project; its orders still count. */
      venue: string | null;
      organizer: string | null;
      /** A solo roadshow — no organizer worth naming. */
      solo: boolean;
      brand: string | null;
      /** YYYY-MM-DD, end inclusive; null end = a one-day event. */
      startDate: string | null;
      endDate: string | null;
      count: number;
    };

/** A pick as the picker holds it — kept whole, so a pick still reads right in a
 *  period where it sold nothing (and so is not listed). */
export interface SalesPlacePick {
  value: string;
  /** The picker's text: an event with its dates, so two runs at one venue differ. */
  label: string;
  /** The cards' heading: an event without its dates — the period shows them. */
  title: string;
  /** An event's own days (YYYY-MM-DD, `to` inclusive). Picking an event shows
   *  its whole run, so the board's period moves to them. null = not an event,
   *  or one with no dates. */
  range: { from: string; to: string } | null;
}

/** The select value of an entry: `event:<projectId>` or `venue:<name>`. */
export const placeValue = (e: SalesPlaceEntry): string =>
  e.kind === 'event' ? `event:${e.projectId}` : `venue:${e.venue ?? NO_VENUE}`;

/** The query parameters a pick sends — the same to the cards and the board. */
export const placeParams = (value: string | null): Record<string, string> => {
  if (!value) return {};
  if (value.startsWith('event:')) return { project: value.slice('event:'.length) };
  if (value.startsWith('venue:')) return { venue: value.slice('venue:'.length) };
  return {};
};

/* The month as the order tiles on this page write it ("1 Dec", en-MY). */
const MONTH = new Intl.DateTimeFormat('en-MY', { month: 'short', timeZone: 'UTC' });

const ymd = (s: string | null): { y: number; m: number; d: number } | null => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  if (!m) return null;
  const month = Number(m[2]);
  return month >= 1 && month <= 12 ? { y: Number(m[1]), m: month, d: Number(m[3]) } : null;
};

/** An event's days, day first: "3 – 12 Oct", "28 Sept – 5 Oct", "5 Oct". The
 *  year shows only when the two ends differ in it. The month is spelled out:
 *  Houzs sends dates in its MM/DD house shape, and "10/03" reads as 10 March
 *  here. */
export const fmtEventDates = (start: string | null, end: string | null): string => {
  const a = ymd(start);
  if (!a) return '';
  const b = ymd(end);
  const day = (x: { y: number; m: number; d: number }) => `${x.d} ${MONTH.format(new Date(Date.UTC(x.y, x.m - 1, 1)))}`;
  if (!b || (a.y === b.y && a.m === b.m && a.d === b.d)) return day(a);
  if (a.y !== b.y) return `${day(a)} ${a.y} – ${day(b)} ${b.y}`;
  if (a.m !== b.m) return `${day(a)} – ${day(b)}`;
  return `${a.d} – ${day(b)}`;
};

/** What an entry is called: a venue, or an event's venue and organizer. */
export const placeTitle = (e: SalesPlaceEntry): string => {
  if (e.kind === 'venue') return e.venue ?? 'No venue recorded';
  if (!e.venue) return `Event ${e.projectId}`;
  return e.organizer && !e.solo ? `${e.venue} — ${e.organizer}` : e.venue;
};

/** What an entry reads as in the picker: an event with its dates. */
export const placeLabel = (e: SalesPlaceEntry): string => {
  const when = e.kind === 'event' && e.venue ? fmtEventDates(e.startDate, e.endDate) : '';
  return when ? `${placeTitle(e)} · ${when}` : placeTitle(e);
};

/** An event's own days, as a board period. */
const eventRange = (e: SalesPlaceEntry): SalesPlacePick['range'] => {
  if (e.kind !== 'event' || !ymd(e.startDate)) return null;
  const from = e.startDate!.slice(0, 10);
  const to = ymd(e.endDate) && e.endDate!.slice(0, 10) >= from ? e.endDate!.slice(0, 10) : from;
  return { from, to };
};

export interface PlaceOptionGroups {
  showrooms: SalesPlacePick[];
  events: SalesPlacePick[];
  /** "No venue recorded" — not a showroom, so outside both groups. */
  other: SalesPlacePick[];
}

/**
 * The picker's options: showrooms, then roadshow events, then the orders with
 * no venue. Two booths of one event (two brands) would read the same, so a
 * shared label is told apart by brand. A pick the period has no orders for is
 * kept in its group, so the select still shows what is picked.
 */
export function placeOptionGroups(
  places: readonly SalesPlaceEntry[],
  pick: SalesPlacePick | null,
): PlaceOptionGroups {
  const labels = places.map(placeLabel);
  const uses = new Map<string, number>();
  for (const l of labels) uses.set(l, (uses.get(l) ?? 0) + 1);
  const groups: PlaceOptionGroups = { showrooms: [], events: [], other: [] };
  places.forEach((e, i) => {
    let label = labels[i]!;
    let title = placeTitle(e);
    if (e.kind === 'event' && (uses.get(label) ?? 0) > 1 && e.brand) {
      label = `${label} · ${e.brand}`;
      title = `${title} · ${e.brand}`;
    }
    const option: SalesPlacePick = { value: placeValue(e), label, title, range: eventRange(e) };
    if (e.kind === 'event') groups.events.push(option);
    else if (e.venue === null) groups.other.push(option);
    else groups.showrooms.push(option);
  });
  if (pick && ![...groups.showrooms, ...groups.events, ...groups.other].some((o) => o.value === pick.value)) {
    if (pick.value.startsWith('event:')) groups.events.push(pick);
    else if (pick.value === `venue:${NO_VENUE}`) groups.other.push(pick);
    else groups.showrooms.push(pick);
  }
  return groups;
}
