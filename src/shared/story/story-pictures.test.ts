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
