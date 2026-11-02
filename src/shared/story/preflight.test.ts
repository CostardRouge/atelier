import { describe, expect, it } from 'vitest';
import { SAFE_ZONE_PRESETS } from '../overlay/guides';
import type { Episode } from './episode';
import { deadOverlap, faceSpecs, facesUsed, factsLeft, groundIssue, hookIssue, preflight, safeZoneIssues, uncountedFacts, wallIssue } from './preflight';

const reels = SAFE_ZONE_PRESETS.find((p) => p.id === 'reels')!;

const ep = (over: Partial<Episode> = {}): Episode => ({
  id: 'ep00',
  number: 'EP.00',
  title: 'A title',
  season: 1,
  next: null,
  closing: { series: 'S', handle: '@h', ask: 'Follow' },
  blocks: [
    { block: 'wall', len: 4, cap: { a: 0.5, b: 3.5, text: '{media.total} photos' }, params: { label: 'shot' } },
    { block: 'map-camera', len: 5, cap: null, params: { note: 'over {trip.km} km', n: 3 } },
  ],
  ...over,
});

describe('factsLeft', () => {
  it('finds every cited fact, dotted or not', () => {
    expect(factsLeft('{media.total} in {episodes} posts, not { this }')).toEqual(['media.total', 'episodes']);
  });
});

describe('uncountedFacts', () => {
  it('names each fact once, the caption pointing at its object', () => {
    const issues = uncountedFacts(ep(), [{ slot: 's1', at: 5.6 }, null]);
    expect(issues.map((i) => i.id)).toEqual(['fact:media.total', 'fact:trip.km']);
    expect(issues[0].level).toBe('stop');
    expect(issues[0].fix).toMatchObject({ kind: 'object', key: 'caption', slot: 's1', at: 5.6 });
    expect(issues[1].fix).toMatchObject({ kind: 'panel', id: 'sources' });
  });
  it('reads the hook and the title too', () => {
    const issues = uncountedFacts(ep({ blocks: [], title: '{season.days} days', hook: { lines: ['{media.total}!'] } }));
    expect(issues.map((i) => i.id)).toEqual(['fact:season.days', 'fact:media.total']);
  });
  it('says nothing once counted', () => {
    expect(uncountedFacts(ep({ blocks: [{ block: 'wall', len: 4, cap: { a: 0, b: 1, text: '98 412 photos' } }] }))).toEqual([]);
  });
});

describe('groundIssue', () => {
  it('only when tiles are asked and not here, on a post with a map', () => {
    expect(groundIssue({ asked: 'outline', state: 'off' }, true)).toBeNull();
    expect(groundIssue({ asked: 'tiles', state: 'ready' }, true)).toBeNull();
    expect(groundIssue({ asked: 'tiles', state: 'not-allowed' }, false)).toBeNull();
    expect(groundIssue({ asked: 'tiles', state: 'not-allowed' }, true)?.level).toBe('stop');
    expect(groundIssue({ asked: 'tiles', state: 'loading' }, true)?.level).toBe('warn');
    expect(groundIssue({ asked: 'tiles', state: 'failed', message: 'Offline.' }, true)?.detail).toContain('Offline');
  });
});

describe('wallIssue', () => {
  it('colour tiles, arriving, missing, or nothing', () => {
    expect(wallIssue(null)).toBeNull();
    expect(wallIssue({ counted: 0, here: 0, loading: false })?.title).toMatch(/colour tiles/);
    expect(wallIssue({ counted: 40, here: 12, loading: true })?.title).toMatch(/arriving/);
    expect(wallIssue({ counted: 40, here: 37, loading: false })?.title).toMatch(/^3 of/);
    expect(wallIssue({ counted: 40, here: 40, loading: false })).toBeNull();
  });
});

describe('safe zones', () => {
  it('measures the share of a box under a dead zone', () => {
    // Reels' caption band starts at 78 % of the height, on the left 84 %.
    const o = deadOverlap({ x: 100, y: 1400, w: 400, h: 200 }, reels);
    expect(o?.label).toBe('Caption');
    expect(o!.share).toBeCloseTo((1600 - 1497.6) / 200, 2);
    expect(deadOverlap({ x: 100, y: 600, w: 400, h: 200 }, reels)).toBeNull();
  });
  it('one issue an object, at its worst moment, a graze left alone', () => {
    const issues = safeZoneIssues(
      [
        { key: 'caption', slot: 's1', label: 'Caption', at: 1, box: { x: 100, y: 1450, w: 400, h: 100 } },
        { key: 'caption', slot: 's1', label: 'Caption', at: 2, box: { x: 100, y: 1500, w: 400, h: 100 } },
        { key: 'hud', slot: '', label: 'HUD', at: 1, box: { x: 100, y: 160, w: 200, h: 200 } },
      ],
      reels,
    );
    expect(issues).toHaveLength(1);
    expect(issues[0].fix).toMatchObject({ kind: 'object', at: 2 });
    expect(safeZoneIssues(issues.length ? [] : [], null)).toEqual([]);
  });
});

describe('hookIssue', () => {
  it('warns past a visible shrink only', () => {
    expect(hookIssue({ big: 0.95, second: null })).toBeNull();
    expect(hookIssue({ big: 1, second: 0.7 })?.title).toContain('70 %');
  });
});

describe('preflight', () => {
  it('puts what the file would show plainly first', () => {
    const issues = preflight({
      episode: ep(),
      wall: { counted: 0, here: 0, loading: false },
      missingFaces: ['Fraunces'],
      ground: { asked: 'tiles', state: 'loading' },
    });
    expect(issues.map((i) => i.level)).toEqual(['stop', 'stop', 'stop', 'warn', 'warn']);
    expect(issues.map((i) => i.id)).toEqual(['fact:media.total', 'fact:trip.km', 'faces', 'ground', 'wall']);
  });
});

describe('facesUsed', () => {
  it('the roles, then the faces objects name, a role read through the charte', () => {
    const used = facesUsed({ title: 'fraunces' }, { caption: { font: '@title' }, hud: { font: 'vt323' } }, { 'hook.big': { font: 'nope' } });
    expect(used.sort()).toEqual(['caveat', 'fraunces', 'geist', 'mono', 'vt323']);
    expect(faceSpecs('instrumentItalic')).toEqual(['italic 400 40px "Instrument Serif"']);
  });
});
