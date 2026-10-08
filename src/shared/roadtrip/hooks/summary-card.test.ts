import { describe, expect, it } from 'vitest';
import type { HookDay, HookStage } from './hook-variant';
import { DRIVE_DEFAULTS, REVEAL_SECONDS, SUMMARY_SECONDS, driveOptions, drivePlan, driveRoute, type DriveOptions } from './drive-plan';
import { themeFromPreset } from '../../overlay/title-styles';
import {
  BADGE_BEFORE_SECONDS,
  CARD_DEFAULTS,
  badgeMoment,
  badgeWindowFor,
  cardCells,
  cardDays,
  cardFacts,
  cardInk,
  cardLabels,
  cardScene,
  cardTheme,
  cardWantsTowns,
  cellAt,
  cityCode,
  labelText,
  readCardOptions,
} from './summary-card';
import { driveVariant } from './drive';
import { cardVariant } from './card';
import { windowedBadge } from './hook-elements';
import { foldHook } from './hook-variant';

/** Four legs down the east coast of Australia, with their states. */
const P = (name: string, lat: number, lon: number, stateCode: string) => ({ name, lat, lon, state: stateCode, stateCode });
const STAGES: HookStage[] = [
  { startDate: '2025-03-01', endDate: '2025-03-10', label: '', places: [P('Cairns', -16.92, 145.77, 'QLD'), P('Port Douglas', -16.48, 145.46, 'QLD'), P('Townsville', -19.26, 146.82, 'QLD')] },
  { startDate: '2025-03-11', endDate: '2025-03-20', label: '', places: [P('Brisbane', -27.47, 153.03, 'QLD'), P('Gold Coast', -28.02, 153.4, 'QLD')] },
  { startDate: '2025-03-21', endDate: '2025-04-04', label: '', places: [P('Byron Bay', -28.64, 153.61, 'NSW'), P('Sydney', -33.87, 151.21, 'NSW')] },
  { startDate: '2025-04-05', endDate: '2025-04-09', label: '', places: [P('Melbourne', -37.81, 144.96, 'VIC')] },
];
const CAL: HookDay[] = Array.from({ length: 40 }, (_, i) => ({
  date: new Date(Date.UTC(2025, 2, 1 + i)).toISOString().slice(0, 10),
  dayNumber: i + 1,
  told: false,
  legStart: [1, 11, 21, 36].includes(i + 1),
  pieces: [],
}));
const LAST = CAL[CAL.length - 1].date;
const quiet = (patch: Partial<DriveOptions> = {}) => driveOptions({ ...DRIVE_DEFAULTS, pictures: 'none', delaySeconds: 0, ...patch });
const recap = (patch: Partial<DriveOptions> = {}) => {
  const o = quiet(patch);
  return { o, plan: drivePlan(driveRoute(STAGES, CAL, LAST, o), o, true)! };
};
const WORDS = { day: 'Day', days: 'days', stop: 'Stop', stops: 'stops' };

describe('the card’s options', () => {
  it('a recap stored before the card was configurable keeps its stamp; a new Virée starts on the trace', () => {
    expect(readCardOptions({})).toEqual(CARD_DEFAULTS);
    expect(readCardOptions({}).cardFace).toBe('stamp');
    expect(driveOptions(driveVariant.defaults).cardFace).toBe('trace');
  });

  it('refuses what it cannot draw, keeps four facts at most, clamps the radius', () => {
    const c = readCardOptions({
      cardFace: 'poster',
      cardLook: 'no-such-look',
      cardFacts: ['days', 'days', 'weather', 'states', 'photos', 'longest', 'places'],
      cardLabelKm: 5,
      cardFrom: 'cns!x',
      badgeWhen: 'sometimes',
    });
    expect(c.cardFace).toBe('stamp');
    expect(c.cardLook).toBe('trip');
    expect(c.cardFacts).toEqual(['days', 'states', 'photos', 'longest']);
    expect(c.cardLabelKm).toBe(10);
    expect(c.cardFrom).toBe('CNS');
    expect(c.badgeWhen).toBe('auto');
    expect(readCardOptions({ cardLook: 'or-cine' }).cardLook).toBe('or-cine');
  });

  it('asks for the town index only where a road face names its groups by town', () => {
    expect(cardWantsTowns({ cardFace: 'trace' })).toBe(true);
    expect(cardWantsTowns({ cardFace: 'trace', cardLabelName: 'first' })).toBe(false);
    expect(cardWantsTowns({ cardFace: 'passport' })).toBe(false);
    expect(cardWantsTowns({ cardFace: 'trace', summary: false })).toBe(false);
  });
});

describe('the facts, measured off the drive', () => {
  it('says the days the clock ran, the road’s length, the places, the states crossed and the longest stay', () => {
    const { plan } = recap();
    const facts = cardFacts(plan);
    expect(facts.days).toBe(40);
    expect(facts.km).toBeCloseTo(plan.kmAtStop[plan.kmAtStop.length - 1], 9);
    expect(facts.places).toBe(8);
    expect(facts.states).toEqual(['QLD', 'NSW', 'VIC']);
    expect(facts.first).toBe('Cairns');
    expect(facts.last).toBe('Melbourne');
    // Byron Bay and Sydney share 15 days, the longest of the trip.
    expect(facts.longest).toEqual({ name: 'Byron Bay', days: 8 });
  });

  it('writes the cells in the author’s order and leaves out what the drive cannot measure', () => {
    const { plan } = recap();
    const facts = cardFacts(plan);
    const cells = cardCells({ ...facts, photos: 0 }, ['photos', 'distance', 'days', 'states'], WORDS, 'km');
    expect(cells.map((c) => c.fact)).toEqual(['distance', 'days', 'states']);
    expect(cells[1]).toMatchObject({ text: '40', word: 'days' });
    expect(cells[2]).toMatchObject({ text: '3', word: 'states' });
    expect(cardCells({ ...facts, days: null }, ['days', 'places'], WORDS, 'km').map((c) => c.fact)).toEqual(['places']);
  });

  it('counts a number up to its value, eased, and lands on its own text', () => {
    const cell = { fact: 'days' as const, value: 90, text: '90', word: 'days' };
    expect(cellAt(cell, 0, 'km')).toBe('0');
    expect(Number(cellAt(cell, 0.5, 'km'))).toBeGreaterThan(45);
    expect(cellAt(cell, 1, 'km')).toBe('90');
    const km = { fact: 'distance' as const, value: 3820, text: '3 820', word: 'km' };
    expect(cellAt(km, 1, 'km')).toBe('3 820');
    expect(cellAt(km, 0.999, 'km')).toMatch(/^3 8\d\d$/);
  });
});

describe('the names on the road', () => {
  it('names the ends, every place, or the places the author chose', () => {
    const { plan } = recap();
    const card = { ...CARD_DEFAULTS };
    expect(cardLabels(plan, { ...card, cardLabels: 'none' })).toEqual([]);
    expect(cardLabels(plan, { ...card, cardLabels: 'ends' }).map((l) => l.name)).toEqual(['Cairns', 'Melbourne']);
    expect(cardLabels(plan, { ...card, cardLabels: 'all' })).toHaveLength(8);
    expect(cardLabels(plan, { ...card, cardLabels: 'chosen', cardChosen: ['sydney', 'Nowhere'] }).map((l) => l.name)).toEqual(['Sydney']);
  });

  it('groups the trip at the card’s own radius, one name per group with the places it stands for', () => {
    const { plan } = recap();
    const labels = cardLabels(plan, { ...CARD_DEFAULTS, cardLabels: 'groups', cardLabelKm: 120, cardLabelName: 'first' });
    // Byron Bay sits within 120 km of the Brisbane group's centre.
    expect(labels.map(labelText)).toEqual(['Cairns +1', 'Townsville', 'Brisbane +2', 'Sydney', 'Melbourne']);
    // The ends rank first, so they win a collision.
    expect(labels[0].rank).toBe(0);
    expect(labels[labels.length - 1].rank).toBe(0);
    expect(labels[1].rank).toBeGreaterThan(0);
  });

  it('names a group by its longest stay when asked', () => {
    const { plan } = recap();
    // Brisbane and the Gold Coast share ten days, Byron Bay half of fifteen.
    const labels = cardLabels(plan, { ...CARD_DEFAULTS, cardLabels: 'groups', cardLabelKm: 120, cardLabelName: 'stay' });
    expect(labels.map(labelText)).toContain('Byron Bay +2');
    expect(plan.route.stops[labels.find((l) => l.name === 'Byron Bay')!.stop].place).toBe('Byron Bay');
  });

  it('prints three letters for a place, the author’s own first', () => {
    expect(cityCode('Cairns')).toBe('CAI');
    expect(cityCode('Île-de-Ré')).toBe('ILE');
    expect(cityCode('Adelaide', 'adl')).toBe('ADL');
  });

  it('reads the trip’s days as the ticket’s barcode: a long tick at a leg, a darker one where a picture was shot', () => {
    const days = cardDays(CAL, { route: { stops: [{ pictures: [{ day: 3 }, { day: 12 }] }] } } as never);
    expect(days).toHaveLength(40);
    expect(days[0]).toEqual({ day: 1, legStart: true, photo: false });
    expect(days[2].photo).toBe(true);
    expect(days[11].photo).toBe(true);
  });
});

describe('the card’s look', () => {
  it('follows the trip, or a preset for the card alone', () => {
    const trip = themeFromPreset('pixel-crt');
    expect(cardTheme('trip', trip)?.presetId).toBe('pixel-crt');
    expect(cardTheme('or-cine', trip)?.presetId).toBe('or-cine');
    expect(cardTheme('trip', null)?.presetId).toBe('neutral');
  });

  it('on the map’s paper takes the map’s ink, and the look’s colour for the road where it reads', () => {
    const paper = { paperColor: '#e8e2d4', inkColor: '#3a332a' };
    expect(cardInk('paper', themeFromPreset('plein-cadre'), paper)).toMatchObject({ ground: '#e8e2d4', ink: '#3a332a', accent: '#f01d0e' });
    // The neutral white is invisible on cream: the road takes the ink.
    expect(cardInk('paper', themeFromPreset('neutral'), paper).accent).toBe('#3a332a');
    // A flat of the look's own red: the words in white.
    expect(cardInk('solid', themeFromPreset('plein-cadre'), paper)).toMatchObject({ ground: '#f01d0e', ink: '#fff6ea' });
    expect(cardInk('solid', themeFromPreset('pixel-crt'), paper).texture).toBe('scan');
    expect(cardInk('photo', themeFromPreset('or-cine'), paper).ink).toBeUndefined();
  });
});

describe('the badge and the card are never on screen together', () => {
  it('during the drive by default: the badge leaves as the card comes, and the card is the drive’s end', () => {
    const { plan } = recap();
    expect(badgeMoment('auto')).toBe('during');
    expect(plan.schedule.reveals).toBe(false);
    expect(plan.schedule.phases.map((p) => p.kind).at(-1)).toBe('summary');
    expect(plan.at(plan.seconds + 1).mapAlpha).toBe(1);
    expect(badgeWindowFor('during', plan.schedule)).toEqual({ start: 0, end: plan.schedule.summaryAt });
  });

  it('before the drive: the car waits for it, and it leaves as the car starts', () => {
    const plain = recap();
    const { plan } = recap({ badgeWhen: 'before' });
    expect(plan.schedule.lead).toBe(BADGE_BEFORE_SECONDS);
    expect(plan.schedule.phases[0]).toMatchObject({ kind: 'hold', start: 0, end: BADGE_BEFORE_SECONDS });
    expect(plan.seconds).toBeCloseTo(plain.plan.seconds + BADGE_BEFORE_SECONDS, 9);
    expect(badgeWindowFor('before', plan.schedule)).toEqual({ start: 0, end: BADGE_BEFORE_SECONDS });
  });

  it('at the end, in the card’s place: no card, the map fades and the badge comes as it does', () => {
    const { plan } = recap({ badgeWhen: 'end' });
    expect(plan.schedule.summaryAt).toBeNull();
    expect(plan.schedule.reveals).toBe(true);
    expect(plan.seconds).toBeCloseTo(plan.schedule.revealAt + REVEAL_SECONDS, 9);
    expect(badgeWindowFor('end', plan.schedule)).toEqual({ start: plan.schedule.revealAt, end: null });
  });

  it('never: a window that is already shut', () => {
    const { plan } = recap({ badgeWhen: 'never' });
    expect(plan.schedule.summaryAt).not.toBeNull();
    expect(badgeWindowFor('never', plan.schedule)).toEqual({ start: 0, end: 0 });
  });

  it('a plain drive and a recap without its card keep the reveal they had', () => {
    const o = quiet();
    expect(drivePlan(driveRoute(STAGES, CAL, LAST, o), o, false)!.schedule.reveals).toBe(true);
    const off = recap({ summary: false });
    expect(off.plan.schedule.reveals).toBe(true);
    expect(off.plan.schedule.summaryAt).toBeNull();
    expect(recap().plan.seconds).toBeCloseTo(off.plan.seconds - REVEAL_SECONDS + SUMMARY_SECONDS, 9);
  });
});

describe('the badge takes the window its opener gives it', () => {
  it('moves the badge’s pieces only, an exit landing on the window’s end', () => {
    const piece = { id: 'piece:headline', kind: 'text', window: { start: 0, end: 9 }, animation: { in: null, out: { preset: 'fade', duration: 0.4, easing: 'linear' } } };
    const open = { id: 'piece:label', kind: 'text' };
    const free = { id: 'free-1', kind: 'text', window: { start: 1, end: 2 } };
    const out = windowedBadge([piece, open, free] as never, { start: 0, end: 4 });
    expect(out[0].window).toEqual({ start: 0, end: 4 });
    expect(out[1].window).toEqual({ start: 0, end: 4 });
    expect(out[2]).toBe(free);
    // An open window keeps a piece's own end, where its exit was laid.
    expect(windowedBadge([piece] as never, { start: 6, end: null })[0].window).toEqual({ start: 6, end: 9 });
    expect(windowedBadge([piece] as never, null)[0]).toBe(piece);
  });

  it('is set by a recap whose card is on, and folded through the stack', () => {
    const { o, plan } = recap();
    const hook = foldHook([{ seconds: plan.seconds, badgeWindow: badgeWindowFor(badgeMoment(o.badgeWhen), plan.schedule) }], true);
    expect(hook.badgeWindow).toEqual({ start: 0, end: plan.schedule.summaryAt });
    expect(foldHook([{ seconds: 1 }], false).badgeWindow).toBeNull();
  });
});

describe('the card on a slide of its own', () => {
  const ctx = { aspect: 9 / 16, durationSeconds: 3, date: LAST, content: null, calendar: CAL, stages: STAGES, tripName: 'East coast' };

  it('tells the same road and numbers as Virée’s card, and hides the badge on its slide', () => {
    const render = cardVariant.prepare(cardVariant.defaults, ctx);
    expect(render.badgeWindow).toEqual({ start: 0, end: 0 });
    expect(render.seconds).toBeGreaterThan(1);
    expect(cardVariant.prepare({ ...cardVariant.defaults, cardEntrance: 'cut' }, ctx).seconds).toBe(0);
    expect(driveOptions(cardVariant.defaults).cardFace).toBe('trace');
  });

  it('draws nothing where its source gives fewer than two places, the badge still hidden', () => {
    const empty = cardVariant.prepare(cardVariant.defaults, { ...ctx, stages: [] });
    expect(empty.seconds).toBe(0);
    expect(empty.badgeWindow).toEqual({ start: 0, end: 0 });
  });

  it('takes its stops from your own map too, and prints their pictures on the contact sheet only', () => {
    const stops = [
      { id: 'a', name: 'Cairns', lat: -16.92, lon: 145.77, picture: { ref: { name: 'a.jpg', size: 1, lastModified: 0 }, date: '2025-03-02' } },
      { id: 'b', name: 'Sydney', lat: -33.87, lon: 151.21 },
    ];
    const own = { ...cardVariant.defaults, stopsOn: 'custom', stops };
    expect(cardVariant.prepare(own, ctx).seconds).toBeGreaterThan(0);
    expect(cardVariant.wantsPictures!(own, ctx)).toEqual([]);
    expect(cardVariant.wantsPictures!({ ...own, cardFace: 'sheet' }, ctx).map((w) => w.key)).toEqual(['name:a.jpg:1']);
  });

  it('puts the slide’s own picture under a photo ground, veiled', () => {
    const { plan } = recap();
    const scene = cardScene({ plan, o: { ...quiet(), cardGround: 'photo' }, theme: null, tripName: 'X', words: WORDS, calendar: CAL, towns: null, vehicle: '', below: true });
    expect(scene.card.cardGround).toBe('photo');
    expect(cardScene({ plan, o: { ...quiet(), cardGround: 'photo' }, theme: null, tripName: 'X', words: WORDS, calendar: CAL, towns: null, vehicle: '' }).card.cardGround).toBe('solid');
  });
});
