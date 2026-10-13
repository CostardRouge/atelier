import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HOOK_VARIANTS } from './registry';
import { DRIVE_CHAPTERS } from './opener-chapter-specs';
import { driveOptions, DRIVE_DEFAULTS } from './drive-plan';
import { chapterChanged, chapterSummary, numbered, resetChapter, searchChapters } from './opener-chapters';

const road = DRIVE_CHAPTERS.find((c) => c.id === 'road')!;

describe('opener chapters', () => {
  it('numbers chapters by their place in the declaration', () => {
    expect(numbered(DRIVE_CHAPTERS).map(({ n, chapter }) => `${n} ${chapter.title}`)).toEqual([
      '1 Stops', '2 Road', '3 Pictures', '4 Vehicle', '5 Map', '6 Motion', '7 Camera', '8 Recap', '9 Sound',
    ]);
  });

  it('says a chapter in a few words, from the normalised options', () => {
    expect(chapterSummary(road, driveOptions({}))).toBe('Curved · dashed ahead · trail');
    expect(chapterSummary(road, driveOptions({ path: 'straight', ahead: 'hidden', trail: false }))).toBe('Straight · nothing ahead');
  });

  it('leaves out a fact that does not hold — no voice named for a silent tick', () => {
    const sound = DRIVE_CHAPTERS.find((c) => c.id === 'sound')!;
    expect(chapterSummary(sound, driveOptions({ sound: false, kit: 'ratchet' }))).toBe('Silent');
    expect(chapterSummary(sound, driveOptions({ sound: true, kit: 'ratchet' }))).toBe('Tick · Ratchet');
  });

  it('marks a chapter that departs from the defaults, a missing key reading as its default', () => {
    expect(chapterChanged(road, {}, DRIVE_DEFAULTS as never)).toBe(false);
    expect(chapterChanged(road, { path: 'curved' }, DRIVE_DEFAULTS as never)).toBe(false);
    expect(chapterChanged(road, { path: 'straight' }, DRIVE_DEFAULTS as never)).toBe(true);
  });

  it('resets its own keys and nothing else', () => {
    const next = resetChapter(road, { path: 'straight', ahead: 'faint', stops: [{ name: 'Cairns' }], ground: 'tiles' }, DRIVE_DEFAULTS as never);
    expect(next.path).toBe('curved');
    expect(next.ahead).toBe('dashed');
    expect(next.stops).toEqual([{ name: 'Cairns' }]);
    expect(next.ground).toBe('tiles');
  });

  it('finds chapters by their rows’ words, accents and case ignored', () => {
    expect(searchChapters(DRIVE_CHAPTERS, 'colour').map((h) => h.chapter.id)).toEqual(['road', 'vehicle', 'map']);
    expect(searchChapters(DRIVE_CHAPTERS, 'VÉHICLE').map((h) => h.chapter.id)).toContain('vehicle');
    expect(searchChapters(DRIVE_CHAPTERS, 'dashed')[0]).toMatchObject({ n: 2, words: ['Dashed'] });
    expect(searchChapters(DRIVE_CHAPTERS, '   ')).toEqual([]);
    expect(searchChapters(DRIVE_CHAPTERS, 'zzz')).toEqual([]);
  });

  describe.each(HOOK_VARIANTS.filter((v) => v.chapters).map((v) => [v.id, v] as const))('%s', (_id, variant) => {
    const chapters = variant.chapters!;

    it('declares each chapter once', () => {
      expect(new Set(chapters.map((c) => c.id)).size).toBe(chapters.length);
    });

    it('never resets what the author gave the piece', () => {
      const content = new Set(variant.contentKeys ?? []);
      for (const c of chapters) expect(c.keys.filter((k) => content.has(k)), c.id).toEqual([]);
    });

    it('only names options the variant has', () => {
      for (const c of chapters) {
        expect(c.keys.filter((k) => !(k in variant.defaults)), c.id).toEqual([]);
      }
    });
  });

  // The panel's groups and the declaration must agree, or a chapter opens empty.
  it.each([
    ['drive', 'drive.tsx'],
    ['map', 'map.tsx'],
    ['scrub', 'scrub.tsx'],
    ['card', 'card.tsx'],
    ['showcase', 'showcase.tsx'],
  ])('%s: every group of the panel names a declared chapter, and every chapter has a group', (id, file) => {
    const source = readFileSync(new URL(`./${file}`, import.meta.url), 'utf8');
    const groups = [...source.matchAll(/<Group title="[^"]+"( chapter="([^"]+)")?/g)];
    const named = new Set(groups.map((m) => m[2]));
    const declared = HOOK_VARIANTS.find((v) => v.id === id)!.chapters!.map((c) => c.id);
    expect(groups.every((m) => m[2])).toBe(true);
    expect([...named].sort()).toEqual([...declared].sort());
  });
});

describe('opener pins', () => {
  const frame = { width: 1080, height: 1350 };
  const places = [
    { name: 'Cairns', lat: -16.92, lon: 145.77 },
    { name: 'Port Douglas', lat: -16.48, lon: 145.46 },
    { name: 'Cooktown', lat: -15.47, lon: 145.25 },
  ];
  const ctx = {
    aspect: 0.8,
    date: '2026-07-14',
    calendar: ['2026-07-12', '2026-07-13', '2026-07-14'],
    stages: [{ id: 's1', name: 'North', start: '2026-07-12', end: '2026-07-14', places }],
  } as never;

  it.each([
    ['drive', {}],
    ['map', { stops: places, compass: true }],
  ])('%s pins only declared chapters, inside the frame', (id, options) => {
    const variant = HOOK_VARIANTS.find((v) => v.id === id)!;
    const parts = variant.parts!(options, ctx, frame);
    const declared = new Set(variant.chapters!.map((c) => c.id));
    expect(parts.length).toBeGreaterThan(2);
    for (const part of parts) {
      expect(declared.has(part.chapter), part.chapter).toBe(true);
      expect(part.x).toBeGreaterThanOrEqual(0);
      expect(part.x).toBeLessThanOrEqual(frame.width);
      expect(part.y).toBeGreaterThanOrEqual(0);
      expect(part.y).toBeLessThanOrEqual(frame.height);
    }
    expect(parts.map((p) => p.chapter)).toContain('stops');
  });

  it('pins only the corners while Virée’s camera follows', () => {
    const drive = HOOK_VARIANTS.find((v) => v.id === 'drive')!;
    expect(drive.parts!({ camera: 'follow' }, ctx, frame).map((p) => p.chapter)).toEqual(['map', 'camera']);
  });
});
