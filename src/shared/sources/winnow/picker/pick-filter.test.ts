import { describe, expect, it } from 'vitest';
import type { WinnowAssetRow } from '../client';
import {
  activeFacets,
  bucketOf,
  DEFAULT_FACETS,
  drawn,
  facetCounts,
  facetValues,
  hiddenTicked,
  idsFor,
  inverted,
  openingTicks,
  passes,
  pickItem,
  pilesOf,
  rangeTicked,
  readFacets,
  SHOW_ALL,
  shown,
  surfaced,
  toggled,
  withAll,
  withNoneShown,
  type PickFacets,
  type PickItem,
} from './pick-filter';

function row(id: number, over: Partial<WinnowAssetRow> = {}): WinnowAssetRow {
  return {
    id,
    filename: `DSC0${id}.HIF`,
    session_id: 7,
    ext: 'hif',
    media_type: 'photo',
    captured_at: null,
    capture_date: '2026-09-13',
    width: 7008,
    height: 4672,
    duration_s: null,
    file_size: 11e6,
    content_hash: null,
    gps_lat: null,
    gps_lon: null,
    camera_model: 'ILCE-7CM2',
    lens: null,
    iso: null,
    shutter: null,
    aperture: null,
    focal_length: null,
    relative_altitude: null,
    absolute_altitude: null,
    derivative_status: 'ready',
    has_telemetry: false,
    sidecars: [],
    verdict: 'unrated',
    star: 0,
    color_label: null,
    device: 'Sony A7C II',
    tags: [],
    ...over,
  };
}

const items = (rows: WinnowAssetRow[], held: number[] = []) => rows.map((r) => pickItem(r, held.includes(r.id)));
const ids = (list: readonly PickItem[]) => list.map((it) => it.id);
const f = (over: Partial<PickFacets> = {}): PickFacets => ({ ...DEFAULT_FACETS, ...over });

describe('bucketOf / pickItem', () => {
  it('puts a flag before a star, and a star alone in its own bucket', () => {
    expect(bucketOf({ verdict: 'pick', star: 5, color: null })).toBe('pick');
    expect(bucketOf({ verdict: 'unrated', star: 3, color: null })).toBe('star');
    expect(bucketOf({ verdict: 'reject', star: 2, color: null })).toBe('reject');
    expect(bucketOf({ verdict: 'skip', star: 0, color: null })).toBe('skip');
  });

  it('reads a row that says nothing of its culling as unrated', () => {
    const it = pickItem(row(1, { verdict: undefined, star: undefined, color_label: undefined }), false);
    expect(it.culling).toBeNull();
    expect(it.bucket).toBe('unrated');
  });

  it('reads the pair, the device, the tags and the final from the row', () => {
    const it = pickItem(row(1, { group_kind: 'raw_jpeg', companion_ext: 'ARW', tags: ['reef', ''], edit_count: 1 }), true);
    expect(it.pairExt).toBe('arw');
    expect(it.device).toBe('Sony A7C II');
    expect(it.tags).toEqual(['reef']);
    expect(it.hasFinal).toBe(true);
    expect(it.held).toBe(true);
    // A Live Photo's companion is not a RAW, so it is not a pair here.
    expect(pickItem(row(2, { group_kind: 'live_photo', companion_ext: 'mov' }), false).pairExt).toBeNull();
    // A linked final is itself "in the Gallery".
    expect(pickItem(row(3, { original_asset_id: 1 }), false).hasFinal).toBe(true);
  });

  it('falls back on the camera model when the row carries no device', () => {
    expect(pickItem(row(1, { device: null }), false).device).toBe('ILCE-7CM2');
  });
});

describe('piles', () => {
  // Pile 9: cover 10, frame 12 picked, frame 11 untouched. Row 20 is no pile.
  const rows = [
    row(10, { burst_id: 9, burst_cover_id: 10, burst_count: 3 }),
    row(11, { burst_id: 9, burst_cover_id: 10, burst_count: 3 }),
    row(12, { burst_id: 9, burst_cover_id: 10, burst_count: 3, verdict: 'pick', star: 5 }),
    row(20),
  ];
  const list = items(rows);
  const piles = pilesOf(list);

  it('groups the frames under the stored cover', () => {
    expect(piles.get(9)).toEqual({ id: 9, coverId: 10, frameIds: [10, 11, 12], size: 3 });
  });

  it('falls back on the first listed frame when the cover was trashed', () => {
    const p = pilesOf(items([row(11, { burst_id: 9, burst_cover_id: 10, burst_count: 2 }), row(12, { burst_id: 9, burst_cover_id: 10, burst_count: 2 })]));
    expect(p.get(9)?.coverId).toBe(11);
  });

  it('keeps the live size when only the cover was listed (collapse=1)', () => {
    const p = pilesOf(items([row(10, { burst_id: 9, burst_cover_id: 10, burst_count: 12 })]));
    expect(p.get(9)).toEqual({ id: 9, coverId: 10, frameIds: [10], size: 12 });
  });

  it('shows the cover and the frame Winnow said yes to, folded', () => {
    expect(ids(surfaced(list, piles, new Set()))).toEqual([10, 12, 20]);
  });

  it('draws an unfolded pile in its own row, under the cover, never twice', () => {
    const s = surfaced(list, piles, new Set([9]));
    expect(ids(s)).toEqual([10, 20]);
    expect(ids(drawn(s, list, piles, new Set([9])))).toEqual([10, 11, 12, 20]);
  });

  it('is no pile when Winnow counts one frame', () => {
    expect(pickItem(row(1, { burst_id: 4, burst_count: 1 }), false).pileId).toBeNull();
  });
});

describe('facets', () => {
  const list = items([
    row(1, { verdict: 'pick', star: 5 }),
    row(2, { verdict: 'reject' }),
    row(3, { verdict: 'unrated', star: 4, device: 'DJI Mini 4 Pro', ext: 'jpg', tags: ['reef'] }),
    row(4, { media_type: 'video', ext: 'mp4', device: 'DJI Mini 4 Pro', edit_count: 2 }),
  ], [4]);

  it('hides the rejects by default and shows them on request', () => {
    expect(ids(list.filter((it) => passes(it, DEFAULT_FACETS)))).toEqual([1, 3, 4]);
    expect(ids(list.filter((it) => passes(it, SHOW_ALL)))).toEqual([1, 2, 3, 4]);
  });

  it('narrows by stars, type, extension, device, tag, final and held', () => {
    const pass = (over: Partial<PickFacets>) => ids(list.filter((it) => passes(it, f(over))));
    expect(pass({ minStar: 4 })).toEqual([1, 3]);
    expect(pass({ kinds: ['video'] })).toEqual([4]);
    expect(pass({ exts: ['jpg', 'hif'] })).toEqual([1, 3]);
    expect(pass({ devices: ['DJI Mini 4 Pro'] })).toEqual([3, 4]);
    expect(pass({ tags: ['reef'] })).toEqual([3]);
    expect(pass({ noFinal: true })).toEqual([1, 3]);
    expect(pass({ notHeld: true })).toEqual([1, 3]);
  });

  it('counts the scope, filters ignored', () => {
    const c = facetCounts(list);
    expect(c.buckets).toEqual({ pick: 1, star: 1, unrated: 1, skip: 0, reject: 1 });
    expect(c.starsAtLeast).toEqual([4, 2, 2, 2, 2, 1]);
    expect(c.devices.get('DJI Mini 4 Pro')).toBe(2);
    expect(c.exts.get('hif')).toEqual({ count: 2, pair: null });
    expect(c.tags.get('reef')).toBe(1);
    expect(c.noFinal).toBe(3);
    expect(c.notHeld).toBe(3);
  });

  it('lists a facet by count and keeps a ticked value the scope lost, at zero', () => {
    expect(facetValues(new Map([['b', 1], ['a', 1], ['c', 3]]), ['z'])).toEqual([['c', 3], ['a', 1], ['b', 1], ['z', 0]]);
  });

  it('counts what narrows, and toggles a value', () => {
    expect(activeFacets(DEFAULT_FACETS)).toBe(0);
    expect(activeFacets(f({ buckets: ['pick'], devices: ['x', 'y'], noFinal: true }))).toBe(4);
    expect(toggled(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggled(['a', 'b'], 'a')).toEqual(['b']);
  });

  it('reads back only what it writes', () => {
    expect(readFacets(null)).toEqual(DEFAULT_FACETS);
    expect(readFacets({ buckets: [] })).toEqual(DEFAULT_FACETS);
    expect(readFacets({ buckets: ['pick', 'nope'], minStar: 9, kinds: ['video', 'raw'], devices: ['Sony A7C II', 3], notHeld: true })).toEqual({
      ...DEFAULT_FACETS,
      buckets: ['pick'],
      minStar: 5,
      kinds: ['video'],
      devices: ['Sony A7C II'],
      notHeld: true,
    });
  });

  it('sorts by stars, keeping the capture order within a count', () => {
    expect(ids(shown(list, SHOW_ALL, 'stars'))).toEqual([1, 3, 2, 4]);
    expect(ids(shown(list, SHOW_ALL, 'time'))).toEqual([1, 2, 3, 4]);
  });
});

describe('ticking', () => {
  const list = items([
    row(1, { verdict: 'pick', star: 3 }),
    row(2, { verdict: 'pick', star: 5 }),
    row(3, { verdict: 'unrated', star: 5 }),
    row(4, { verdict: 'reject' }),
    row(5, { verdict: 'pick', star: 4 }),
  ], [5]);

  it('ticks among what is drawn, never what is held', () => {
    expect(idsFor('picks', list)).toEqual([1, 2]);
    expect(idsFor('stars5', list)).toEqual([2, 3]);
    expect(idsFor('stars4', list)).toEqual([2, 3]);
    expect(idsFor('stars3', list)).toEqual([1, 2, 3]);
  });

  it('opens a culled scope on its picks, an unculled one on everything but the rejects', () => {
    expect([...openingTicks('picks', list)]).toEqual([1, 2]);
    const unculled = items([row(1), row(2, { verdict: 'reject' }), row(3)]);
    expect([...openingTicks('picks', unculled)]).toEqual([1, 3]);
    expect([...openingTicks('none', list)]).toEqual([]);
    expect([...openingTicks('all', list)]).toEqual([1, 2, 3]);
  });

  it('All, None and Invert act on what is drawn and keep the rest', () => {
    const outside = new Set([99]);
    expect([...withAll(outside, list)].sort()).toEqual([1, 2, 3, 4, 99]);
    expect([...withNoneShown(new Set([1, 99]), list)]).toEqual([99]);
    expect([...inverted(new Set([1, 99]), list)].sort()).toEqual([2, 3, 4, 99]);
  });

  it('ticks a range on ⇧-click, to the state of the row clicked', () => {
    expect([...rangeTicked(new Set(), list, 1, 4)].sort()).toEqual([1, 2, 3, 4]);
    expect([...rangeTicked(new Set([1, 2, 3, 4]), list, 1, 3)]).toEqual([4]);
    // An anchor no longer drawn toggles the one row.
    expect([...rangeTicked(new Set(), list, 42, 2)]).toEqual([2]);
  });

  it('counts the ticked rows nothing draws', () => {
    expect(hiddenTicked(new Set([1, 99, 100]), list)).toBe(2);
  });
});
