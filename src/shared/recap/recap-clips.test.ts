import { describe, expect, it } from 'vitest';
import { createRecapDoc, withPictures, type RecapPicture } from './recap-doc';
import { backgroundChoices, dragBand, dragEdge, isLiveClip, liveClipOf, loopBand } from './recap-clips';

const clip = (name: string, day: string | null, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key: `l:${name}`, origin: 'local', name, kind: 'video', day, ...extra });
const photo = (name: string, day: string, extra: Partial<RecapPicture> = {}): RecapPicture => ({ key: `l:${name}`, origin: 'local', name, kind: 'photo', day, ...extra });

describe('the background clip drawer', () => {
  it('offers the days’ clips first, Live Photos last, then the kept and the rest', () => {
    const live: RecapPicture = { key: 'w:nas:7', origin: 'winnow', instance: 'nas', asset: 7, name: 'IMG_0007.HEIC', kind: 'photo', day: '2026-10-03', motion: 8, width: 3024, height: 4032 };
    let doc = createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 });
    doc = withPictures(doc, [
      clip('IMG_0001.MOV', '2026-10-02', { duration: 2.6 }),
      photo('IMG_0001.HEIC', '2026-10-02'),
      clip('DJI_0002.MP4', '2026-10-05', { duration: 41, width: 3840, height: 2160 }),
      clip('SKY.MP4', '2026-10-09', { loose: true, duration: 12 }),
      clip('OLD.MP4', '2026-09-20', { duration: 8 }),
      live,
    ]);
    const g = backgroundChoices(doc);
    expect(g.days.map((c) => [c.clip.name, c.live])).toEqual([
      ['DJI_0002.MP4', false],
      ['IMG_0001.MOV', true],
      ['IMG_0007.MOV', true],
    ]);
    expect(g.days[1].still?.name).toBe('IMG_0001.HEIC');
    const motion = g.days[2];
    expect(motion.still?.key).toBe('w:nas:7');
    expect(motion.added).toBe(true);
    expect(motion.key).toBe('w:nas:8');
    expect(motion.portrait).toBe(true);
    expect(g.kept.map((c) => c.clip.name)).toEqual(['SKY.MP4']);
    expect(g.elsewhere.map((c) => c.clip.name)).toEqual(['OLD.MP4']);
  });

  it('turns a Live Photo still into the loose clip of its motion', () => {
    const c = liveClipOf({ key: 'w:nas:7', origin: 'winnow', instance: 'nas', asset: 7, name: 'IMG_0007.HEIC', kind: 'photo', day: '2026-10-03', motion: 8 });
    expect(c).toMatchObject({ key: 'w:nas:8', asset: 8, kind: 'video', loose: true, liveStill: 7 });
    expect(liveClipOf(photo('a.jpg', '2026-10-03'))).toBeNull();
    // A long .mov is a clip, whatever still shares its name.
    expect(isLiveClip(clip('IMG_1.MOV', null, { duration: 30 }), new Set(['img_1']))).toBe(false);
  });
});

describe('the loop band', () => {
  it('reads an open out as the clip’s end', () => {
    expect(loopBand({ loopIn: 2, loopOut: null }, 10)).toEqual({ a: 2, b: 10 });
  });

  it('drags whole, its length kept, held inside the clip', () => {
    expect(dragBand({ loopIn: 2, loopOut: 5 }, 10, 3)).toEqual({ loopIn: 5, loopOut: 8 });
    // Past the end: the band stops there, and the out reads «its end».
    expect(dragBand({ loopIn: 2, loopOut: 5 }, 10, 99)).toEqual({ loopIn: 7, loopOut: null });
    expect(dragBand({ loopIn: 2, loopOut: 5 }, 10, -99)).toEqual({ loopIn: 0, loopOut: 3 });
  });

  it('moves one handle, never past the other', () => {
    expect(dragEdge({ loopIn: 2, loopOut: 5 }, 10, 'in', 4)).toEqual({ loopIn: 4, loopOut: 5 });
    expect(dragEdge({ loopIn: 2, loopOut: 5 }, 10, 'in', 6)).toEqual({ loopIn: 4.7, loopOut: 5 });
    expect(dragEdge({ loopIn: 2, loopOut: 5 }, 10, 'out', 12)).toEqual({ loopIn: 2, loopOut: null });
  });
});
