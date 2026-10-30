import { describe, expect, it } from 'vitest';
import {
  NO_VENUE,
  fmtEventDates,
  placeLabel,
  placeOptionGroups,
  placeParams,
  placeTitle,
  placeValue,
  type SalesPlaceEntry,
} from './sales-place';

const event = (over: Partial<Extract<SalesPlaceEntry, { kind: 'event' }>> = {}): SalesPlaceEntry => ({
  kind: 'event', projectId: 41, venue: 'SUNWAY PYRAMID', organizer: 'MEGAHOME', solo: false,
  brand: '2990', startDate: '2026-10-03', endDate: '2026-10-12', count: 2, ...over,
});
const venue = (name: string | null, count = 1): SalesPlaceEntry => ({ kind: 'venue', venue: name, count });

describe('fmtEventDates', () => {
  it('spells the days out, day first — "10/03" would read as 10 March', () => {
    expect(fmtEventDates('2026-10-03', '2026-10-12')).toBe('3 – 12 Oct');
    // The month as the order tiles write it (en-MY).
    expect(fmtEventDates('2026-09-28', '2026-10-05')).toBe('28 Sept – 5 Oct');
    expect(fmtEventDates('2026-12-28', '2027-01-03')).toBe('28 Dec 2026 – 3 Jan 2027');
  });

  it('reads a one-day event, or one with no end, as its day', () => {
    expect(fmtEventDates('2026-10-05', '2026-10-05')).toBe('5 Oct');
    expect(fmtEventDates('2026-10-05', null)).toBe('5 Oct');
  });

  it('says nothing for a date it cannot read', () => {
    expect(fmtEventDates(null, '2026-10-05')).toBe('');
    expect(fmtEventDates('soon', null)).toBe('');
  });
});

describe('placeLabel / placeTitle', () => {
  it('a showroom reads as its venue, a blank one as none recorded', () => {
    expect(placeLabel(venue('2990s PJ'))).toBe('2990s PJ');
    expect(placeLabel(venue(null))).toBe('No venue recorded');
    expect(placeTitle(venue('2990s PJ'))).toBe('2990s PJ');
  });

  it('an event reads as where, whose and when; a solo roadshow names no organizer', () => {
    expect(placeLabel(event())).toBe('SUNWAY PYRAMID — MEGAHOME · 3 – 12 Oct');
    expect(placeLabel(event({ solo: true }))).toBe('SUNWAY PYRAMID · 3 – 12 Oct');
    expect(placeLabel(event({ organizer: null, startDate: null }))).toBe('SUNWAY PYRAMID');
  });

  it('the cards title an event without its dates — the period beside it shows them', () => {
    expect(placeTitle(event())).toBe('SUNWAY PYRAMID — MEGAHOME');
    expect(placeTitle(event({ solo: true }))).toBe('SUNWAY PYRAMID');
  });

  it('an event Houzs could not read still has a name', () => {
    expect(placeLabel(event({ projectId: 77, venue: null }))).toBe('Event 77');
  });
});

describe('the pick travels as the same parameters to the cards and the board', () => {
  it('an event by its project, a venue by its name', () => {
    expect(placeParams(placeValue(event()))).toEqual({ project: '41' });
    expect(placeParams(placeValue(venue('2990s PJ')))).toEqual({ venue: '2990s PJ' });
    expect(placeParams(placeValue(venue(null)))).toEqual({ venue: NO_VENUE });
  });

  it('no pick sends nothing', () => {
    expect(placeParams(null)).toEqual({});
    expect(placeParams('')).toEqual({});
  });
});

describe('placeOptionGroups', () => {
  it('showrooms, then events, then the orders with no venue', () => {
    const groups = placeOptionGroups([venue('2990s PJ', 5), venue('Kelana Jaya', 3), venue(null, 2), event()], null);
    expect(groups).toEqual({
      showrooms: [
        { value: 'venue:2990s PJ', label: '2990s PJ', title: '2990s PJ', range: null },
        { value: 'venue:Kelana Jaya', label: 'Kelana Jaya', title: 'Kelana Jaya', range: null },
      ],
      events: [{
        value: 'event:41',
        label: 'SUNWAY PYRAMID — MEGAHOME · 3 – 12 Oct',
        title: 'SUNWAY PYRAMID — MEGAHOME',
        range: { from: '2026-10-03', to: '2026-10-12' },
      }],
      other: [{ value: `venue:${NO_VENUE}`, label: 'No venue recorded', title: 'No venue recorded', range: null }],
    });
  });

  it('an event carries its own days, so picking it can show the whole run', () => {
    const [one] = placeOptionGroups([event({ endDate: null })], null).events;
    expect(one!.range).toEqual({ from: '2026-10-03', to: '2026-10-03' });
    const [backwards] = placeOptionGroups([event({ endDate: '2026-10-01' })], null).events;
    expect(backwards!.range).toEqual({ from: '2026-10-03', to: '2026-10-03' });
    const [undated] = placeOptionGroups([event({ startDate: null })], null).events;
    expect(undated!.range).toBeNull();
  });

  it('two booths of one event are told apart by brand', () => {
    const groups = placeOptionGroups([event({ brand: '2990' }), event({ projectId: 43, brand: '2990 MATTRESS' })], null);
    expect(groups.events.map((o) => [o.label, o.title])).toEqual([
      ['SUNWAY PYRAMID — MEGAHOME · 3 – 12 Oct · 2990', 'SUNWAY PYRAMID — MEGAHOME · 2990'],
      ['SUNWAY PYRAMID — MEGAHOME · 3 – 12 Oct · 2990 MATTRESS', 'SUNWAY PYRAMID — MEGAHOME · 2990 MATTRESS'],
    ]);
  });

  it('keeps the pick listed in a period where it sold nothing', () => {
    const pick = {
      value: 'event:41', label: 'SUNWAY PYRAMID — MEGAHOME · 3 – 12 Oct',
      title: 'SUNWAY PYRAMID — MEGAHOME', range: { from: '2026-10-03', to: '2026-10-12' },
    };
    expect(placeOptionGroups([venue('2990s PJ')], pick).events).toEqual([pick]);
    const showroom = { value: 'venue:Kelana Jaya', label: 'Kelana Jaya', title: 'Kelana Jaya', range: null };
    expect(placeOptionGroups([], showroom).showrooms).toEqual([showroom]);
  });

  it('does not list a listed pick twice', () => {
    const pick = { value: 'venue:2990s PJ', label: '2990s PJ', title: '2990s PJ', range: null };
    expect(placeOptionGroups([venue('2990s PJ')], pick).showrooms).toEqual([pick]);
  });
});
