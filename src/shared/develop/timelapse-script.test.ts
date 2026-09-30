import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { journalRoll } from './journal';
import { addPictures, createRollDoc, patchPicture, readRollDoc, setMakingOf, type RollDoc, type RollPicture } from './roll-types';
import { pictureChapters } from './timelapse-chapters';
import { DEFAULT_TIMELAPSE, readMakingOf, readTimelapseOptions, type TimelapseOptions } from './timelapse-options';
import { beatGrid, chapterAt, momentAt, momentLengths, onGrid, timelapseScript } from './timelapse-script';

let n = 0;
function roll(): RollDoc {
  return addPictures(createRollDoc('R', 'local', 1, 'r'), [{ name: 'a.jpg', size: 1, lastModified: 1 }], 2, () => `p${++n}`);
}
const exposure = (ev: number) => ({ ...DEFAULT_DEVELOP, exposure: ev });
const heal = (id: string, x: number, y: number) => ({ id, kind: 'heal' as const, x, y, radius: 0.02, feather: 0.5, dx: 0.03, dy: 0 });

function edited(writes: [number, Partial<RollPicture>][]): RollPicture {
  let doc = roll();
  const id = doc.pictures[0].id;
  for (const [at, patch] of writes) doc = journalRoll(doc, patchPicture(doc, id, patch as never, at), at);
  return doc.pictures[0];
}

const FIVE: [number, Partial<RollPicture>][] = [
  [1000, { develop: exposure(0.7) }],
  [3000, { aspect: '4:5' }],
  [5000, { repair: [heal('a', 0.66, 0.18)] }],
  [7000, { detail: { luminance: 0, colour: 0, defringe: 0, sharpen: 30, sharpenRadius: 1, sharpenDetail: 25, sharpenMasking: 0, texture: 0, clarity: 0, dehaze: 0 } as never }],
  [9000, { vignette: { amount: -30, midpoint: 50, roundness: 0, feather: 50, highlights: 0 } }],
];

const options = (o: Partial<TimelapseOptions> = {}): TimelapseOptions => ({ ...readTimelapseOptions(undefined), ...o });

describe('the script', () => {
  it('times the hook, the chapters by weight and the reveal onto the asked length', () => {
    const p = edited(FIVE);
    const script = timelapseScript(pictureChapters(p, 4 / 3), options());
    expect(script).toMatchObject({ width: 1080, height: 1920, fps: 30, recorded: true, empty: false });
    expect(script.hook).toEqual({ start: 0, dur: 1.8 });
    expect(script.chapters).toHaveLength(5);
    expect(script.reveal.dur).toBe(3);
    expect(script.seconds).toBeCloseTo(15, 6);
    // Chapters follow one another with no gap, the heaviest the longest.
    expect(script.chapters.every((c, i) => i === 0 || Math.abs(c.start - (script.chapters[i - 1].start + script.chapters[i - 1].dur)) < 1e-9)).toBe(true);
    const byDur = [...script.chapters].sort((a, b) => b.dur - a.dur).map((c) => c.chapter.section);
    expect(byDur[0]).toBe('crop');
    expect(script.states).toHaveLength(6);
    expect(script.states[0]).toBe(script.asShot);
    expect(script.final.vignette?.amount).toBe(-30);
    expect([momentLengths(15), momentLengths(30), momentLengths(60)]).toEqual([{ hook: 1.8, reveal: 3 }, { hook: 2.4, reveal: 4 }, { hook: 3, reveal: 5 }]);
  });

  it('reads the camera in the chapter and hands it from one chapter to the next', () => {
    const script = timelapseScript(pictureChapters(edited(FIVE), 4 / 3), options());
    const heal = script.chapters.find((c) => c.chapter.section === 'repair')!;
    expect(heal.camera.to.z).toBeGreaterThan(1);
    expect(heal.camera.from.z).toBe(1);
    const next = script.chapters[heal.index + 1];
    expect(next.camera.from).toBe(heal.camera.to);
    expect(next.camera.to.z).toBe(1);
    const still = timelapseScript(pictureChapters(edited(FIVE), 4 / 3), options({ camera: 'still' }));
    expect(still.chapters.every((c) => c.camera.to.z === 1)).toBe(true);
  });

  it('lands every cut on the beat, and says the length it reached', () => {
    expect(beatGrid(120)).toBe(1);
    expect(beatGrid(null)).toBeNull();
    expect(onGrid(1.3, 0.5)).toBe(1.5);
    expect(onGrid(0.1, 0.5)).toBe(0.5);
    const script = timelapseScript(pictureChapters(edited(FIVE)), options({ beat: 120 }));
    const grid = beatGrid(120)!;
    for (const m of [script.hook, ...script.chapters, script.reveal]) {
      expect(Math.abs(m.start / grid - Math.round(m.start / grid))).toBeLessThan(1e-9);
      expect(Math.abs(m.dur / grid - Math.round(m.dur / grid))).toBeLessThan(1e-9);
    }
    expect(Math.abs(script.seconds / grid - Math.round(script.seconds / grid))).toBeLessThan(1e-9);
    // A finer grid moves the length away from what was asked; the script says what it reached.
    const fine = timelapseScript(pictureChapters(edited(FIVE)), options({ beat: 170, seconds: 17 }));
    expect(fine.seconds).not.toBe(17);
    expect(Math.abs(fine.seconds / beatGrid(170)! - Math.round(fine.seconds / beatGrid(170)!))).toBeLessThan(1e-9);
  });

  it('builds the captions, the counter and the hook words as windowed elements', () => {
    const script = timelapseScript(pictureChapters(edited(FIVE)), options(), { plate: 'ƒ/1.7 · 1/500 · ISO 100', credit: 'Developed in Atelier' });
    const ids = script.overlays.map((e) => e.id);
    expect(ids.slice(0, 3)).toEqual(['hook-first', 'hook-second', 'hook-how']);
    expect(script.overlays[0]).toMatchObject({ text: 'This is the after.', window: { start: 0, end: 1.8 * 0.62 } });
    expect(script.overlays[1].window).toEqual({ start: 1.8 * 0.62, end: 1.8 });
    const first = script.chapters[0];
    const caption = script.overlays.find((e) => e.id === `caption-${first.chapter.id}`)!;
    expect(caption).toMatchObject({ text: '+0.7 EV', kind: 'text', anchor: 'bottom-center', window: { start: first.start, end: first.start + first.dur } });
    expect(script.overlays.find((e) => e.id === `counter-${first.chapter.id}`)?.text).toBe('1/5');
    expect(script.overlays.filter((e) => e.id === 'plate' || e.id === 'credit').map((e) => e.window?.start ?? 0)).toEqual([
      script.reveal.start + script.reveal.dur * 0.6,
      script.reveal.start + script.reveal.dur * 0.6 + 0.2,
    ]);
    const bare = timelapseScript(pictureChapters(edited(FIVE)), options({ overlays: { ...DEFAULT_TIMELAPSE.overlays, captions: false, counter: false } }));
    expect(bare.overlays).toEqual([]);
    const raw = timelapseScript(pictureChapters(edited(FIVE)), options({ hook: 'raw-first' }));
    expect(raw.overlays[0].text).toBe('This is the file as shot.');
    const flash = timelapseScript(pictureChapters(edited(FIVE)), options({ hook: 'flash' }));
    expect(flash.overlays[0]).toMatchObject({ id: 'hook-flash', text: 'BEFORE ↔ AFTER' });
  });

  it('takes the author’s own captions and hidden chapters, and finds the moment at a time', () => {
    const p = edited(FIVE);
    const chapters = pictureChapters(p);
    const hidden = new Set([chapters.chapters[3].id]);
    const script = timelapseScript(chapters, options(), { hidden, captions: { [chapters.chapters[0].id]: 'Light first' } });
    expect(script.chapters).toHaveLength(4);
    expect(script.chapters[0].caption).toBe('Light first');
    expect(script.chapters[3].chapter.absorbed).toEqual(['detail']);
    expect(momentAt(script, 0.5)).toBe('hook');
    expect(momentAt(script, script.chapters[1].start + 0.1)).toBe('chapter');
    expect(chapterAt(script, script.chapters[1].start + 0.1)).toBe(script.chapters[1]);
    expect(momentAt(script, script.reveal.start + 1)).toBe('reveal');
    expect(chapterAt(script, script.reveal.start + 1)).toBeNull();
    expect(momentAt(script, script.seconds)).toBe('done');
    // An unedited picture has nothing to tell.
    expect(timelapseScript(pictureChapters(roll().pictures[0]), options()).empty).toBe(true);
  });

  it('keeps a picture’s making-of edits on the roll, absent when they say nothing', () => {
    let doc = roll();
    const id = doc.pictures[0].id;
    doc = setMakingOf(doc, id, { hidden: ['1000'], captions: { '3000': '  Crop it  ' } }, 5);
    expect(doc.pictures[0].makingOf).toEqual({ hidden: ['1000'], captions: { '3000': 'Crop it' } });
    expect(doc.updatedAt).toBe(5);
    const same = setMakingOf(doc, id, { captions: { '3000': 'Crop it' } }, 6);
    expect(same).toBe(doc);
    const cleared = setMakingOf(doc, id, { hidden: [], captions: { '3000': '' } }, 7);
    expect('makingOf' in cleared.pictures[0]).toBe(false);
    expect(readMakingOf({ hidden: ['a', 'a', 3], captions: { x: ' ', y: 'kept' } })).toEqual({ hidden: ['a'], captions: { y: 'kept' } });
    const stored = readRollDoc(JSON.parse(JSON.stringify(doc)))!;
    expect(stored.pictures[0].makingOf).toEqual(doc.pictures[0].makingOf);
  });
});
