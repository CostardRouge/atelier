import { describe, expect, it } from 'vitest';
import { devicePictures, deviceKey } from './story-facts';
import { devicePicture, hasPictures, setStoryPictures, wallPicture } from './story-pictures';
import { parseScript } from './story-script';

const img = (w: number) => ({ width: w, height: w }) as unknown as CanvasImageSource;

describe('a picture each camera took', () => {
  it('is the cover of its busiest counted day', () => {
    const span = { from: '2025-01-01', to: '2025-01-31' };
    const cal = (days: [string, number, number][]) => ({ days: days.map(([date, count, cover_id]) => ({ date, count, cover_id })) }) as never;
    const pics = devicePictures(
      [
        ['ILCE-7CM2', cal([['2025-01-02', 10, 11], ['2025-01-05', 40, 12], ['2025-02-09', 99, 13]])],
        ['FC8482', cal([['2025-01-03', 0, 21]])],
      ],
      span,
    );
    expect(pics).toEqual({ [deviceKey('ILCE-7CM2')]: 12 });
  });
  it('travels in the script’s facts', () => {
    const parsed = parseScript({ kind: 'atelier.story-script', version: 1, posts: {}, facts: { at: '2025-01-01T00:00:00Z', values: {}, devicePics: { 'gear.ilce7cm2': 12, bad: 3, 'gear.x': -1 } } });
    expect(parsed.ok && parsed.script.facts?.devicePics).toEqual({ 'gear.ilce7cm2': 12 });
  });
});

describe('story pictures', () => {
  it('a block finds its camera’s picture and the wall’s in day order, or none', () => {
    setStoryPictures(null, null, null);
    expect(hasPictures()).toBe(false);
    expect(wallPicture(0, 4)).toBeNull();
    const a = img(1), b = img(2), cam = img(3);
    setStoryPictures(new Map([[12, cam]]), { [deviceKey('Sony A7C II')]: 12 }, [a, null, b]);
    expect(devicePicture('Sony A7C II')).toBe(cam);
    expect(devicePicture('Unknown')).toBeNull();
    expect(devicePicture('Unknown', 12)).toBe(cam);
    expect([0, 1, 2, 3].map((i) => wallPicture(i, 4))).toEqual([a, a, b, b]);
    setStoryPictures(null, null, null);
  });
});

describe('developed pictures (before/after)', () => {
  it('pairs each original with its latest final over the counted days, spread over the trip', async () => {
    const { editPairs } = await import('./story-facts');
    const span = { from: '2025-01-01', to: '2025-01-31' };
    const finals = [
      { id: 10, original_asset_id: 1, day: '2025-01-02' },
      { id: 11, original_asset_id: 1, day: '2025-01-02' },
      { id: 20, original_asset_id: 2, day: '2025-01-09' },
      { id: 30, original_asset_id: null, day: '2025-01-10' },
      { id: 40, original_asset_id: 4, day: '2025-03-01' },
    ];
    expect(editPairs(finals, span, 6)).toEqual([[1, 11], [2, 20]]);
    expect(editPairs(finals, span, 1)).toHaveLength(1);
  });
  it('a pair draws only when both pictures are here, and the facts keep it', async () => {
    const { setStoryPrints, editPicture } = await import('./story-pictures');
    const a = img(1), b = img(2);
    setStoryPrints(new Map([[1, a]]), [[1, 11]]);
    expect(editPicture(0)).toBeNull();
    setStoryPrints(new Map([[1, a], [11, b]]), [[1, 11]]);
    expect(editPicture(0)).toEqual({ before: a, after: b });
    expect(editPicture(3)).toEqual({ before: a, after: b });
    setStoryPrints(null, null);
    const parsed = parseScript({ kind: 'atelier.story-script', version: 1, posts: {}, facts: { at: '2025-01-01T00:00:00Z', values: {}, edits: [[1, 11], [2], [0, 3]] } });
    expect(parsed.ok && parsed.script.facts?.edits).toEqual([[1, 11]]);
  });
});
