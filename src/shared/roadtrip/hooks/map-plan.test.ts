import { describe, expect, it } from 'vitest';
import type { HookPickedPicture, HookStage } from './hook-variant';
import {
  MAP_DEFAULTS,
  MAP_MAX_STOPS,
  addStop,
  arcControl,
  assignPictures,
  drawnFractions,
  drawnKm,
  fitProjection,
  formatDistance,
  haversineKm,
  hopKms,
  mapBox,
  mapOptions,
  mapScore,
  mapTiming,
  mapWants,
  mediaAt,
  moveStop,
  otherPlaces,
  patchStop,
  penAt,
  pinAlphaAt,
  planarHops,
  quadAt,
  quadSplit,
  quadTail,
  readStops,
  removeStop,
  stopsFromPlaces,
  tripPlaces,
  wantsLabel,
  type MapStop,
} from './map-plan';
import { TICK_KITS } from './tick-kits';

const picture = (name: string): HookPickedPicture => ({
  ref: { name, size: 1000, lastModified: 1_741_046_400_000 },
  date: '2025-03-04',
});

/** Perth → Kalbarri → Coral Bay, west coast of Australia. */
const STOPS: MapStop[] = [
  { id: 'a', name: 'Perth', lat: -31.95, lon: 115.86 },
  { id: 'b', name: 'Kalbarri', lat: -27.71, lon: 114.16 },
  { id: 'c', name: 'Coral Bay', lat: -23.14, lon: 113.77 },
];

const STAGES: HookStage[] = [
  {
    startDate: '2025-03-01',
    endDate: '2025-03-10',
    label: 'Perth → Kalbarri',
    places: [
      { name: 'Perth', lat: -31.95, lon: 115.86 },
      { name: 'Kalbarri', lat: -27.71, lon: 114.16 },
    ],
  },
  {
    startDate: '2025-03-11',
    endDate: '2025-03-15',
    label: 'Exmouth',
    // The same place twice, and one with no coordinates at all upstream.
    places: [
      { name: 'Exmouth', lat: -21.93, lon: 114.12 },
      { name: 'Exmouth again', lat: -21.93, lon: 114.12 },
    ],
  },
];

describe('mapOptions', () => {
  it('falls back on every unreadable value rather than throwing', () => {
    const o = mapOptions({
      media: 'hologram',
      easing: 'bounce',
      pathColor: 'red',
      size: 'big',
      curve: 99,
      dwellSeconds: -4,
      kit: 'orchestra',
    });
    expect(o.media).toBe(MAP_DEFAULTS.media);
    expect(o.easing).toBe(MAP_DEFAULTS.easing);
    expect(o.pathColor).toBe(MAP_DEFAULTS.pathColor);
    expect(o.size).toBe(MAP_DEFAULTS.size);
    expect(o.curve).toBe(0.6);
    expect(o.dwellSeconds).toBe(0);
    expect(o.kit).toBe(MAP_DEFAULTS.kit);
  });

  it('keeps a colour it can paint, lower-cased', () => {
    expect(mapOptions({ pathColor: '#AABBCC' }).pathColor).toBe('#aabbcc');
  });

  it('reads the stops through the same discipline', () => {
    const o = mapOptions({ stops: [{ id: 'a', name: 'Perth', lat: -31.95, lon: 115.86 }] });
    expect(o.stops).toHaveLength(1);
    expect(o.stops[0].name).toBe('Perth');
  });
});

describe('readStops', () => {
  it('drops anything that cannot be a point on a map', () => {
    const stops = readStops([
      { id: 'ok', name: 'Perth', lat: -31.95, lon: 115.86 },
      { id: 'no-coords', name: 'A place typed by hand' },
      { id: 'off-world', name: 'Nowhere', lat: 120, lon: 0 },
      'not an object',
      null,
    ]);
    expect(stops.map((stop) => stop.id)).toEqual(['ok']);
  });

  it('keeps a stop’s picture, and drops one that cannot name a file', () => {
    const stops = readStops([
      { id: 'a', lat: 0, lon: 0, picture: { ref: { name: 'DJI_0042.JPG', size: 12 }, date: '2025-03-04' } },
      { id: 'b', lat: 1, lon: 1, picture: { ref: { size: 12 } } },
      { id: 'c', lat: 2, lon: 2, picture: 'a picture' },
    ]);
    expect(stops[0].picture?.ref.name).toBe('DJI_0042.JPG');
    expect(stops[1].picture).toBeUndefined();
    expect(stops[2].picture).toBeUndefined();
  });

  it('never reads more stops than one opener draws', () => {
    const many = Array.from({ length: MAP_MAX_STOPS + 8 }, (_, i) => ({ id: `s${i}`, lat: i * 0.1, lon: 0 }));
    expect(readStops(many)).toHaveLength(MAP_MAX_STOPS);
  });

  it('is empty for anything that is not a list', () => {
    expect(readStops(undefined)).toEqual([]);
    expect(readStops({ a: 1 })).toEqual([]);
  });
});

describe('fitProjection', () => {
  const box = mapBox(1080, 1920, 'middle', 'center', 1);

  it('fits every point inside the box', () => {
    const { project } = fitProjection(STOPS, box, 8);
    for (const stop of STOPS) {
      const at = project(stop);
      expect(at.x).toBeGreaterThanOrEqual(box.x);
      expect(at.x).toBeLessThanOrEqual(box.x + box.width);
      expect(at.y).toBeGreaterThanOrEqual(box.y);
      expect(at.y).toBeLessThanOrEqual(box.y + box.height);
    }
  });

  it('runs backwards: a projected point unprojects to itself', () => {
    const { project, unproject } = fitProjection(STOPS, box, 8);
    for (const stop of STOPS) {
      const back = unproject(project(stop));
      expect(back.lat).toBeCloseTo(stop.lat, 6);
      expect(back.lon).toBeCloseTo(stop.lon, 6);
    }
  });

  it('puts north up', () => {
    const { project } = fitProjection(STOPS, box, 8);
    // Coral Bay is the northernmost of the three.
    expect(project(STOPS[2]).y).toBeLessThan(project(STOPS[0]).y);
  });

  it('shows the whole world when there is nothing to fit', () => {
    const { unproject } = fitProjection([], box, 0);
    // Sampled just inside the two edges: the box's own edges sit on the
    // antimeridian, where +180 and −180 name the same line.
    const left = unproject({ x: box.x + box.width * 0.02, y: box.y + box.height / 2 });
    const right = unproject({ x: box.x + box.width * 0.98, y: box.y + box.height / 2 });
    expect(left.lon).toBeLessThan(-100);
    expect(right.lon).toBeGreaterThan(100);
    const middle = unproject({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
    expect(middle.lat).toBeCloseTo(0, 9);
    expect(middle.lon).toBeCloseTo(0, 9);
  });

  it('centres a single point without collapsing its scale', () => {
    const { project, unproject } = fitProjection([{ lat: -31.95, lon: 115.86 }], box, 0);
    const at = project({ lat: -31.95, lon: 115.86 });
    expect(at.x).toBeCloseTo(box.x + box.width / 2, 6);
    expect(at.y).toBeCloseTo(box.y + box.height / 2, 6);
    // A first pin dropped beside it still lands somewhere real.
    const beside = unproject({ x: at.x + 40, y: at.y });
    expect(Number.isFinite(beside.lat)).toBe(true);
    expect(beside.lon).not.toBeCloseTo(115.86, 3);
  });
});

describe('arcs', () => {
  const a = { x: 0, y: 0 };
  const b = { x: 100, y: 0 };

  it('is the straight midpoint with no bow', () => {
    expect(arcControl(a, b, 0)).toEqual({ x: 50, y: 0 });
  });

  it('bows to one side, so a there-and-back draws two arcs', () => {
    const there = arcControl(a, b, 0.2);
    const back = arcControl(b, a, 0.2);
    expect(there.y).not.toBeCloseTo(back.y, 3);
    expect(Math.sign(there.y - 0)).toBe(-Math.sign(back.y - 0));
  });

  it('splits into a curve that ends exactly where the whole one is at s', () => {
    const control = arcControl(a, b, 0.25);
    for (const s of [0.1, 0.5, 0.87]) {
      const part = quadSplit(a, control, b, s);
      const whole = quadAt(a, control, b, s);
      expect(part.end.x).toBeCloseTo(whole.x, 9);
      expect(part.end.y).toBeCloseTo(whole.y, 9);
    }
  });

  it('is the whole curve at s = 1', () => {
    const control = arcControl(a, b, 0.3);
    const part = quadSplit(a, control, b, 1);
    expect(part.control).toEqual(control);
    expect(part.end.x).toBeCloseTo(b.x, 9);
  });

  it('the tail starts where the drawn part ends, and lands on the same curve', () => {
    const control = arcControl(a, b, 0.25);
    for (const s of [0.15, 0.5, 0.9]) {
      const drawn = quadSplit(a, control, b, s);
      const tail = quadTail(a, control, b, s);
      // The two halves meet exactly — the pen's tip is one point, not a seam.
      expect(tail.start.x).toBeCloseTo(drawn.end.x, 9);
      expect(tail.start.y).toBeCloseTo(drawn.end.y, 9);
      expect(tail.end).toEqual(b);
      // And the tail IS the rest of the same arc: its own midpoint sits on the
      // whole curve, which is what makes the line ahead a bed the pen fills.
      const mid = quadAt(tail.start, tail.control, tail.end, 0.5);
      const onWhole = quadAt(a, control, b, s + (1 - s) * 0.5);
      expect(mid.x).toBeCloseTo(onWhole.x, 9);
      expect(mid.y).toBeCloseTo(onWhole.y, 9);
    }
  });

  it('the tail is the whole curve when nothing is drawn yet', () => {
    const control = arcControl(a, b, 0.3);
    const tail = quadTail(a, control, b, 0);
    expect(tail.start).toEqual(a);
    expect(tail.control).toEqual(control);
    expect(tail.end).toEqual(b);
  });
});

describe('mapTiming', () => {
  const o = mapOptions({ drawSeconds: 3, dwellSeconds: 0.5, delaySeconds: 0.2 });

  it('shares the travelling out by distance', () => {
    // Two hops, the first three times the second.
    const timing = mapTiming([300, 100], o);
    expect(timing.hops[0].travel).toBeCloseTo(2.25, 6);
    expect(timing.hops[1].travel).toBeCloseTo(0.75, 6);
  });

  it('arrives after the hold, and waits at every stop including the last', () => {
    const timing = mapTiming([300, 100], o);
    expect(timing.arrivals[0]).toBeCloseTo(0.2, 6);
    expect(timing.arrivals[1]).toBeCloseTo(0.2 + 2.25, 6);
    expect(timing.arrivals[2]).toBeCloseTo(0.2 + 2.25 + 0.5 + 0.75, 6);
    expect(timing.total).toBeCloseTo(timing.arrivals[2] + 0.5, 6);
  });

  it('still advances when every stop is on one spot', () => {
    const timing = mapTiming([0, 0], o);
    expect(timing.hops[0].travel).toBeCloseTo(1.5, 6);
    expect(timing.total).toBeGreaterThan(0);
  });

  it('takes no time at all with the travelling off, and is wholly arrived', () => {
    const timing = mapTiming([300, 100], mapOptions({ draw: false }));
    expect(timing.total).toBe(0);
    // Every stop reached at zero: the whole path drawn, every pin up, the last
    // stop the one showing — no reader downstream branches on "is it moving".
    expect(timing.arrivals).toEqual([0, 0, 0]);
    expect(penAt(timing, 'linear', 0)).toMatchObject({ stop: 2, hop: null });
    expect(drawnFractions(timing, 'linear', 0, 2)).toEqual([1, 1]);
    expect(mediaAt(timing, 0, 0.25)).toMatchObject({ current: 2, mix: 1 });
    expect(pinAlphaAt(timing, 0, 1, 0.25)).toBe(1);
  });
});

describe('penAt', () => {
  const o = mapOptions({ drawSeconds: 2, dwellSeconds: 0.5, delaySeconds: 0.2, easing: 'linear' });
  const timing = mapTiming([100, 100], o);

  it('waits on the first stop through the hold', () => {
    expect(penAt(timing, 'linear', 0.1)).toMatchObject({ hop: null, stop: 0, moving: false });
  });

  it('travels the first hop', () => {
    const pen = penAt(timing, 'linear', 0.2 + 0.5);
    expect(pen.hop).toBe(0);
    expect(pen.fraction).toBeCloseTo(0.5, 6);
    expect(pen.moving).toBe(true);
  });

  it('is still, on the stop, through the dwell', () => {
    const pen = penAt(timing, 'linear', 0.2 + 1 + 0.2);
    expect(pen).toMatchObject({ hop: null, stop: 1, moving: false });
  });

  it('rests on the last stop past the end', () => {
    expect(penAt(timing, 'linear', 99)).toMatchObject({ hop: null, stop: 2, moving: false });
  });

  it('has nowhere to go with one stop', () => {
    expect(penAt(mapTiming([], o), 'linear', 5)).toMatchObject({ hop: null, stop: 0 });
  });
});

describe('drawnFractions', () => {
  const o = mapOptions({ drawSeconds: 2, dwellSeconds: 0, delaySeconds: 0, easing: 'linear' });
  const timing = mapTiming([100, 100], o);

  it('draws the hops behind the pen whole and the ones ahead not at all', () => {
    expect(drawnFractions(timing, 'linear', 1.5, 2)).toEqual([1, 0.5]);
  });

  it('is the whole path once the pen has arrived', () => {
    expect(drawnFractions(timing, 'linear', 9, 2)).toEqual([1, 1]);
  });
});

describe('mediaAt', () => {
  const o = mapOptions({ drawSeconds: 2, dwellSeconds: 0, delaySeconds: 0.4, easing: 'linear' });
  const timing = mapTiming([100, 100], o);

  it('shows the first stop’s picture from the first frame, hold included', () => {
    expect(mediaAt(timing, 0, 0.25)).toEqual({ current: 0, previous: null, mix: 1 });
    expect(mediaAt(timing, 0.3, 0.25)).toEqual({ current: 0, previous: null, mix: 1 });
  });

  it('cross-fades from the stop before as the pen lands', () => {
    const at = mediaAt(timing, timing.arrivals[1] + 0.125, 0.25);
    expect(at.current).toBe(1);
    expect(at.previous).toBe(0);
    expect(at.mix).toBeCloseTo(0.5, 6);
  });

  it('arrives at once with no fade', () => {
    expect(mediaAt(timing, timing.arrivals[1], 0)).toEqual({ current: 1, previous: null, mix: 1 });
  });

  it('holds the last picture past the end', () => {
    expect(mediaAt(timing, 99, 0.25)).toMatchObject({ current: 2, mix: 1 });
  });
});

describe('pinAlphaAt', () => {
  const timing = mapTiming([100, 100], mapOptions({ drawSeconds: 2, dwellSeconds: 0, delaySeconds: 0 }));

  it('is nothing before the stop is reached and whole after the fade', () => {
    expect(pinAlphaAt(timing, timing.arrivals[1] - 0.01, 1, 0.2)).toBe(0);
    expect(pinAlphaAt(timing, timing.arrivals[1] + 0.1, 1, 0.2)).toBeCloseTo(0.5, 6);
    expect(pinAlphaAt(timing, timing.arrivals[1] + 0.3, 1, 0.2)).toBeCloseTo(1, 6);
  });

  it('shows the first stop’s pin from the first frame, like the backdrop', () => {
    expect(pinAlphaAt(timing, 0, 0, 0.2)).toBe(1);
    expect(mediaAt(timing, 0, 0.2).mix).toBe(1);
  });
});

describe('mapScore', () => {
  const timing = mapTiming([100, 100], mapOptions({ drawSeconds: 2, dwellSeconds: 0.3, delaySeconds: 0.2 }));

  it('ticks at every arrival, and seats on the last', () => {
    const score = mapScore(timing, { kit: 'ratchet', pitch: 1 }, 1);
    expect(score).toHaveLength(3);
    expect(score.map((event) => event.at)).toEqual(timing.arrivals);
    expect(score[2].voice).toBe(TICK_KITS.ratchet.seat);
    expect(score[1].voice).toBe(TICK_KITS.ratchet.tick);
    expect(score[0].voice).toBe(TICK_KITS.ratchet.leg.voice);
  });

  it('writes no bed at all at volume 0, or with nowhere to travel', () => {
    expect(mapScore(timing, { kit: 'ratchet', pitch: 1 }, 0)).toEqual([]);
    expect(mapScore(mapTiming([], MAP_DEFAULTS), { kit: 'ratchet', pitch: 1 }, 1)).toEqual([]);
  });

  it('transposes every event by the pitch', () => {
    const score = mapScore(timing, { kit: 'wood', pitch: 2 }, 1);
    expect(score[1].rate).toBe(2);
    expect(score[0].rate).toBeCloseTo(2 * TICK_KITS.wood.leg.rate, 6);
  });
});

describe('mapWants', () => {
  const stops: MapStop[] = [
    { ...STOPS[0], picture: picture('one.jpg') },
    { ...STOPS[1] },
    { ...STOPS[2], picture: picture('one.jpg') },
  ];

  it('asks for each picture once, and only the ones a stop holds', () => {
    const wants = mapWants(mapOptions({ stops, media: 'pin' }));
    expect(wants).toHaveLength(1);
    expect(wants[0].ref.name).toBe('one.jpg');
  });

  it('asks for nothing at all with the pictures off', () => {
    expect(mapWants(mapOptions({ stops, media: 'off' }))).toEqual([]);
  });
});

describe('editing the itinerary', () => {
  it('adds at the end, up to the cap', () => {
    const one = addStop([], { lat: 1, lon: 2, name: 'Here' }, 'x');
    expect(one).toEqual([{ id: 'x', name: 'Here', lat: 1, lon: 2 }]);
    const full = Array.from({ length: MAP_MAX_STOPS }, (_, i) => ({ id: `s${i}`, name: '', lat: i, lon: 0 }));
    expect(addStop(full, { lat: 0, lon: 0 }, 'over')).toHaveLength(MAP_MAX_STOPS);
  });

  it('patches one stop and keeps its picture', () => {
    const stops = [{ ...STOPS[0], picture: picture('one.jpg') }];
    const patched = patchStop(stops, 'a', { lat: -30 });
    expect(patched[0].lat).toBe(-30);
    expect(patched[0].picture?.ref.name).toBe('one.jpg');
    expect(patchStop(stops, 'missing', { lat: 0 })[0].lat).toBe(STOPS[0].lat);
  });

  it('moves a stop one place, and refuses to wrap', () => {
    expect(moveStop(STOPS, 'c', -1).map((s) => s.id)).toEqual(['a', 'c', 'b']);
    expect(moveStop(STOPS, 'a', -1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
    expect(moveStop(STOPS, 'c', 1).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('removes one', () => {
    expect(removeStop(STOPS, 'b').map((s) => s.id)).toEqual(['a', 'c']);
  });

  it('takes the trip’s places as an itinerary', () => {
    const stops = stopsFromPlaces(tripPlaces(STAGES), (i) => `id${i}`);
    expect(stops.map((s) => s.name)).toEqual(['Perth', 'Kalbarri', 'Exmouth']);
  });
});

describe('assignPictures', () => {
  it('puts the first on the stop it was asked from', () => {
    const { stops, used } = assignPictures(STOPS, 1, [picture('one.jpg')]);
    expect(stops[1].picture?.ref.name).toBe('one.jpg');
    expect(stops[0].picture).toBeUndefined();
    expect(used).toBe(1);
  });

  it('fills the stops AFTER it that have none, and never one that has', () => {
    const held: MapStop[] = [STOPS[0], STOPS[1], { ...STOPS[2], picture: picture('kept.jpg') }];
    const { stops, used } = assignPictures(held, 0, [picture('a.jpg'), picture('b.jpg')]);
    expect(stops[0].picture?.ref.name).toBe('a.jpg');
    expect(stops[1].picture?.ref.name).toBe('b.jpg');
    expect(stops[2].picture?.ref.name).toBe('kept.jpg');
    expect(used).toBe(2);
  });

  it('reports what had nowhere to go rather than dropping it in silence', () => {
    const { used } = assignPictures(STOPS, 2, [picture('a.jpg'), picture('b.jpg')]);
    expect(used).toBe(1);
  });

  it('takes the picture off the stop when nothing was kept', () => {
    const held = [{ ...STOPS[0], picture: picture('one.jpg') }];
    expect(assignPictures(held, 0, []).stops[0].picture).toBeUndefined();
  });

  it('changes nothing for a stop that is not there', () => {
    expect(assignPictures(STOPS, 9, [picture('a.jpg')]).stops).toEqual(STOPS);
  });
});

describe('the trip’s own places', () => {
  it('lists each located spot once, in the order it was lived', () => {
    expect(tripPlaces(STAGES).map((p) => p.name)).toEqual(['Perth', 'Kalbarri', 'Exmouth']);
  });

  it('leaves out the ones already on the itinerary', () => {
    expect(otherPlaces(STAGES, [STOPS[0]]).map((p) => p.name)).toEqual(['Kalbarri', 'Exmouth']);
  });

  it('is empty with no legs at all', () => {
    expect(tripPlaces(undefined)).toEqual([]);
    expect(otherPlaces(undefined, STOPS)).toEqual([]);
  });
});

describe('distance', () => {
  it('measures the great circle between the stops', () => {
    // Perth → Kalbarri is about 490 km as the crow flies.
    expect(haversineKm(STOPS[0], STOPS[1])).toBeGreaterThan(460);
    expect(haversineKm(STOPS[0], STOPS[1])).toBeLessThan(520);
    expect(hopKms(STOPS)).toHaveLength(2);
  });

  it('a hop of no length is no distance', () => {
    expect(haversineKm(STOPS[0], STOPS[0])).toBe(0);
  });

  it('counts only what the pen has drawn', () => {
    expect(drawnKm([100, 100], [1, 0.5])).toBeCloseTo(150, 6);
    expect(drawnKm([100, 100], [0, 0])).toBe(0);
  });

  it('writes a readable figure', () => {
    expect(formatDistance(1240, 'km')).toBe('1 240 km');
    expect(formatDistance(1240, 'mi')).toBe('771 mi');
    expect(formatDistance(4.2, 'km')).toBe('4.2 km');
    expect(formatDistance(1240, 'off')).toBe('');
  });

  it('measures the hops in the projection’s own units, in the same order as the kilometres', () => {
    const hops = planarHops(STOPS);
    const kms = hopKms(STOPS);
    expect(hops).toHaveLength(2);
    // The projection is one uniform scale, so the ratio between two hops is
    // the ratio between their real lengths — which is what lets the travel
    // time be shared out by planar length and still keep one pace.
    expect(hops[0] / hops[1]).toBeCloseTo(kms[0] / kms[1], 1);
  });
});

describe('wantsLabel', () => {
  it('names what each setting says it names', () => {
    expect(wantsLabel('none', 0, 3, 0)).toBe(false);
    expect(wantsLabel('all', 1, 3, 0)).toBe(true);
    expect(wantsLabel('ends', 0, 3, 0)).toBe(true);
    expect(wantsLabel('ends', 1, 3, 0)).toBe(false);
    expect(wantsLabel('ends', 2, 3, 0)).toBe(true);
    expect(wantsLabel('current', 2, 3, 2)).toBe(true);
    expect(wantsLabel('current', 1, 3, 2)).toBe(false);
  });

  it('keeps every name behind the pen under `passed`, and none ahead of it', () => {
    expect(wantsLabel('passed', 0, 4, 2)).toBe(true);
    expect(wantsLabel('passed', 2, 4, 2)).toBe(true);
    expect(wantsLabel('passed', 3, 4, 2)).toBe(false);
    // On the first stop it says one name, where `all` would already say four.
    expect(wantsLabel('passed', 1, 4, 0)).toBe(false);
  });

  it('is a stored value like any other — an unknown one falls back', () => {
    expect(mapOptions({ labels: 'passed' }).labels).toBe('passed');
    expect(mapOptions({ labels: 'shouty' }).labels).toBe(MAP_DEFAULTS.labels);
  });
});
