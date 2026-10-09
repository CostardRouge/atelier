import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { journalRoll } from './journal';
import { addPictures, createRollDoc, patchPicture, readRollDoc, setMakingOf, type RollDoc, type RollPicture } from './roll-types';
import { pictureChapters } from './timelapse-chapters';
import { DEFAULT_TIMELAPSE, DEFAULT_TIMELAPSE_STYLE, readMoment, readMakingOf, readTimelapseOptions, readTimelapseStyle, type TimelapseOptions } from './timelapse-options';
import { LOOP_SECONDS, lookFor, pairAt, progressSegments, TEXT_MAX_LINES, beatGrid, chapterAt, deepestZoom, fitText, makingOfName, momentAt, momentLengths, monoBudget, onGrid, packLines, timelapseScore, timelapseScript } from './timelapse-script';

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
    expect(script.hook).toEqual({ start: 0, dur: 1.8, turn: 1.8 * 0.62 });
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
    expect([momentLengths(10), momentLengths(15), momentLengths(30), momentLengths(60)]).toEqual([{ hook: 1.5, reveal: 2.5 }, { hook: 1.8, reveal: 3 }, { hook: 2.4, reveal: 4 }, { hook: 3, reveal: 5 }]);
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
    expect(deepestZoom(script)).toBe(heal.camera.to.z);
    expect(deepestZoom(still)).toBe(1);
    expect(makingOfName('DJI_0101.JPG')).toBe('DJI_0101-making-of.mp4');
    expect(makingOfName('')).toBe('picture-making-of.mp4');
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
    const raw = timelapseScript(pictureChapters(edited(FIVE)), options({ hook: { ...DEFAULT_TIMELAPSE.hook, order: 'before-first' } }));
    expect(raw.overlays[0].text).toBe('This is the file as shot.');
    const flash = timelapseScript(pictureChapters(edited(FIVE)), options({ hook: { ...DEFAULT_TIMELAPSE.hook, figure: 'flicker' } }));
    expect(flash.overlays[0]).toMatchObject({ id: 'hook-flash', text: 'BEFORE ↔ AFTER' });
  });

  it('wraps a long overlay like a flex row: whole facts first, then words, never off the frame', () => {
    expect(packLines('+0.7 EV · highlights −40 · vibrance +15', 20)).toEqual(['+0.7 EV', 'highlights −40', 'vibrance +15']);
    expect(packLines('+0.7 EV · highlights −40 · vibrance +15', 30)).toEqual(['+0.7 EV · highlights −40', 'vibrance +15']);
    expect(packLines('A sentence much longer than one line · ok', 16)).toEqual(['A sentence much', 'longer than one', 'line · ok']);
    expect(packLines('short', 40)).toEqual(['short']);
    expect(packLines('typed\nbreak', 40)).toEqual(['typed', 'break']);
    // A 9:16 frame at the caption's size: every line within the budget.
    const budget = monoBudget(1080, 0.042 * 1080, 0.5);
    expect(budget).toBeGreaterThan(30);
    expect(budget).toBeLessThan(40);
    const long = 'Portra 400 · 80 % · Rec.709 2.4 → sRGB · grain · from another picture · + detail, vignette';
    const fitted = fitText(long, 1080, 1920, 0.042, 0.5);
    expect(fitted.lines.join(' · ').replace(/ · /g, ' ')).toBe(long.replace(/ · /g, ' '));
    expect(fitted.lines.every((l) => l.length <= monoBudget(1080, fitted.sizeFrac * 1080, 0.5))).toBe(true);
    // Too many lines at the asked size: it steps down first, and never under its floor.
    expect(fitted.sizeFrac).toBeLessThan(0.042);
    expect(fitted.sizeFrac).toBeGreaterThanOrEqual(0.042 * 0.65 - 1e-9);
    expect(fitted.lines.length).toBeLessThanOrEqual(TEXT_MAX_LINES);
    // Balanced like text-wrap: balance — the tease never ends on one orphaned word.
    const tease = fitText('Here is exactly how this picture was edited, step by step', 1080, 1920, 0.05, 0.5);
    expect(tease.lines.length).toBeGreaterThan(1);
    expect(tease.lines.every((l) => l.split(' ').length >= 2)).toBe(true);
    // A short line is left alone, at its size.
    expect(fitText('+0.7 EV', 1080, 1920, 0.042, 0.5)).toEqual({ lines: ['+0.7 EV'], sizeFrac: 0.042 });
  });

  it('stacks a wrapped caption upward from its foot, and lifts the plate over a wrapped credit', () => {
    const p = edited(FIVE);
    const chapters = pictureChapters(p);
    const id = chapters.chapters[0].id;
    const long = 'Lifted the shadows · cooled the whites · warmed the skin · pulled the sky down';
    const script = timelapseScript(chapters, options(), {
      captions: { [id]: long },
      plate: 'ƒ/1.7 · 1/500 · ISO 100',
      credit: 'Developed in Atelier · © A photographer with a remarkably long name indeed, and a studio',
    });
    const lines = script.overlays.filter((e) => e.id === `caption-${id}` || e.id.startsWith(`caption-${id}.`));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map((e) => e.text).join(' · ')).toBe(long);
    // The foot stays where a one-line caption sits; the lines above climb in order.
    expect(lines[lines.length - 1].y).toBeCloseTo(0.86, 9);
    expect(lines.every((e, i) => i === 0 || e.y > lines[i - 1].y)).toBe(true);
    expect(new Set(lines.map((e) => e.sizeFrac)).size).toBe(1);
    // The face and the box are pinned: the painter's theme would otherwise replace both.
    expect(lines.every((e) => e.fontFamily === 'VT323' && e.legibility.mode === 'box' && e.styleOverrides?.includes('fontFamily') && e.styleOverrides.includes('legibility'))).toBe(true);
    expect(lines.every((e) => e.window?.start === script.chapters[0].start)).toBe(true);
    // Reveal: the credit wraps, the plate sits above its top line.
    const credit = script.overlays.filter((e) => e.id === 'credit' || e.id.startsWith('credit.'));
    const plate = script.overlays.filter((e) => e.id === 'plate' || e.id.startsWith('plate.'));
    expect(credit.length).toBeGreaterThan(1);
    expect(credit[credit.length - 1].y).toBeCloseTo(0.955, 9);
    expect(Math.max(...plate.map((e) => e.y))).toBeLessThan(Math.min(...credit.map((e) => e.y)));
  });

  it('dresses every overlay in the roll’s style, the default being the look it always had', () => {
    // The default is his: VT323 on a solid, square black box.
    const plain = timelapseScript(pictureChapters(edited(FIVE)), options(), { credit: 'Developed in Atelier' });
    const caption = plain.overlays.find((e) => e.id.startsWith('caption-'))!;
    expect(caption).toMatchObject({ fontFamily: 'VT323', weight: 600, color: '#ffffff', legibility: { mode: 'box', color: 'rgba(0,0,0,1)', padFrac: 0.5, radiusFrac: 0 } });
    expect(plain.overlays.find((e) => e.id === 'hook-how')!.legibility.color).toBe('rgba(216,70,31,0.92)');
    expect(plain.overlays.find((e) => e.id === 'credit')!.color).toBe('rgba(255,255,255,0.85)');
    // A style changes all of them at once.
    const style = { ...DEFAULT_TIMELAPSE_STYLE, font: 'Instrument Serif' as const, size: 1.3, bold: false, uppercase: true, radius: 0, text: '#fff8e7', box: '#1a2b3c', boxOpacity: 0.8, accent: '#2266ff' };
    const dressed = timelapseScript(pictureChapters(edited(FIVE)), options({ style }));
    const c = dressed.overlays.find((e) => e.id.startsWith('caption-'))!;
    expect(c).toMatchObject({ fontFamily: 'Instrument Serif', weight: 400, color: '#fff8e7', legibility: { mode: 'box', color: 'rgba(26,43,60,0.8)', radiusFrac: 0 } });
    expect(c.text).toBe(c.text?.toUpperCase());
    expect(c.sizeFrac).toBeCloseTo(0.042 * 1.3, 9);
    expect(dressed.overlays.find((e) => e.id === 'hook-how')!.legibility.color).toBe('rgba(34,102,255,0.92)');
    // Without a box the tease wears the accent as its words, and the small print has no shadow.
    const bare = timelapseScript(pictureChapters(edited(FIVE)), options({ style: { ...style, background: 'none' } }));
    expect(bare.overlays.find((e) => e.id === 'hook-how')).toMatchObject({ color: '#2266ff', legibility: { mode: 'none' } });
    expect(bare.overlays.find((e) => e.id.startsWith('counter-'))!.legibility.mode).toBe('none');
    expect(lookFor({ ...style, background: 'shadow' }).main.mode).toBe('shadow');
    // The reader clamps and refuses what is not a style.
    expect(readTimelapseStyle({ font: 'Comic Sans', size: 9, radius: -2, text: 'red', boxOpacity: 2 })).toEqual({ ...DEFAULT_TIMELAPSE_STYLE, size: 1.5, radius: 0, boxOpacity: 1 });
    expect(readTimelapseOptions({}).style).toEqual(DEFAULT_TIMELAPSE.style);
  });

  it('runs the hook and the reveal through ONE figure, landing on the second picture whatever the bounces', () => {
    // The landing: the picture shown second, alone.
    for (const figure of ['cut', 'crossfade', 'wipe', 'split', 'flicker'] as const) {
      expect(pairAt(figure, 'after-first', 0, 1)).toEqual({ width: 1, alpha: 1, divider: false });
      expect(pairAt(figure, 'before-first', 2, 1)).toEqual({ width: 0, alpha: 1, divider: false });
    }
    // A cut holds the first picture until it lands.
    expect(pairAt('cut', 'after-first', 0, 0.5)).toEqual({ width: 1, alpha: 0, divider: false });
    expect(pairAt('cut', 'before-first', 0, 0.5)).toEqual({ width: 1, alpha: 1, divider: false });
    // A wipe moves its divider across, the before always on the LEFT.
    const mid = pairAt('wipe', 'before-first', 0, 0.6);
    expect(mid.divider).toBe(true);
    expect(mid.width).toBeGreaterThan(0);
    expect(mid.width).toBeLessThan(1);
    // A crossfade blends, a split shows both halves.
    expect(pairAt('crossfade', 'before-first', 0, 0.8).alpha).toBeGreaterThan(0);
    expect(pairAt('crossfade', 'before-first', 0, 0.8).alpha).toBeLessThan(1);
    expect(pairAt('split', 'after-first', 0, 0.3)).toEqual({ width: 0.5, alpha: 1, divider: true });
    // Bounces: back to the first picture in the middle pass, then on to the second.
    expect(pairAt('cut', 'after-first', 1, 0.5).alpha).toBe(1);
    expect(pairAt('cut', 'after-first', 1, 0.1).alpha).toBe(0);
  });

  it('holds the tease for a while or keeps it as a title, ends on the finished picture, and loops', () => {
    const p = pictureChapters(edited(FIVE));
    const base = timelapseScript(p, options());
    const how = base.overlays.find((e) => e.id === 'hook-how')!;
    // From the hook's turn, for its hold — past the hook, into the first chapter.
    expect(how.window).toEqual({ start: base.hook.turn, end: base.hook.turn + 2.5 });
    expect(how.window!.end!).toBeGreaterThan(base.hook.dur);
    const title = timelapseScript(p, options({ tease: { show: 'title', hold: 2.5 } }));
    expect(title.overlays.find((e) => e.id === 'hook-how')!.window).toEqual({ start: title.hook.turn, end: null });
    expect(timelapseScript(p, options({ tease: { show: 'off', hold: 2.5 } })).overlays.some((e) => e.id === 'hook-how')).toBe(false);
    // The ending: two seconds of the finished picture by default, inside the asked length.
    expect(base.ending).toEqual({ start: base.reveal.start + base.reveal.dur, dur: 2 });
    expect(base.seconds).toBeCloseTo(15, 6);
    expect(momentAt(base, base.ending.start + 0.5)).toBe('ending');
    const long = timelapseScript(p, options({ ending: { hold: 5, motion: 'drift', loop: false, line: 'Save this for your next edit' } }));
    expect(long.ending.dur).toBe(5);
    expect(long.seconds).toBeCloseTo(15, 6);
    const line = long.overlays.find((e) => e.id === 'end-line')!;
    expect(line).toMatchObject({ text: 'Save this for your next edit', window: { start: long.ending.start, end: null } });
    // A loop: what stays to the end fades out where the crossfade into the first frame starts.
    const loop = timelapseScript(p, options({ tease: { show: 'title', hold: 2 }, ending: { hold: 2, motion: 'push', loop: true, line: 'Follow' } }), { credit: 'Developed in Atelier' });
    for (const id of ['hook-how', 'end-line', 'credit']) {
      expect(loop.overlays.find((e) => e.id === id)!.window!.end).toBeCloseTo(loop.seconds - LOOP_SECONDS, 9);
    }
    // Stories: one segment for the hook, one per chapter, one for the reveal with its ending.
    expect(progressSegments(base)).toHaveLength(base.chapters.length + 2);
    expect(progressSegments(base).slice(-1)[0]).toEqual({ start: base.reveal.start, end: base.seconds });
    // A moment's own length wins over the length's.
    expect(timelapseScript(p, options({ hook: { ...DEFAULT_TIMELAPSE.hook, seconds: 3 } })).hook.dur).toBe(3);
  });

  it('reads the moments a roll stored before they shared one vocabulary', () => {
    const d = DEFAULT_TIMELAPSE;
    expect(readMoment('result-first', d.hook)).toMatchObject({ figure: 'cut', order: 'after-first' });
    expect(readMoment('raw-first', d.hook)).toMatchObject({ figure: 'cut', order: 'before-first' });
    expect(readMoment('flash', d.hook)).toMatchObject({ figure: 'flicker' });
    expect(readMoment('split', d.reveal)).toMatchObject({ figure: 'split', order: 'before-first' });
    expect(readMoment({ figure: 'crossfade', seconds: 99, bounces: 7 }, d.reveal)).toEqual({ figure: 'crossfade', order: 'before-first', seconds: 6, bounces: 2 });
    expect(readTimelapseOptions({ hook: 'flash', reveal: 'flicker' })).toMatchObject({ hook: { figure: 'flicker' }, reveal: { figure: 'flicker' } });
    expect(readTimelapseOptions({ ending: { hold: 20, motion: 'spin', line: 42 } }).ending).toEqual({ hold: 8, motion: 'push', loop: false, line: '' });
  });

  it('takes the author’s own captions and hidden chapters, and finds the moment at a time', () => {
    const p = edited(FIVE);
    const chapters = pictureChapters(p);
    const hidden = new Set([chapters.chapters[3].id]);
    const script = timelapseScript(chapters, options(), { hidden, captions: { [chapters.chapters[0].id]: 'Light first' } });
    expect(script.chapters).toHaveLength(4);
    expect(script.chapters[0].caption).toBe('Light first');
    // Every state a frame can ask for is in `states`, once — the painter renders exactly these.
    const asked = new Set([script.asShot, script.final, ...script.chapters.flatMap((c) => [c.chapter.before, c.chapter.after])]);
    expect(script.states).toHaveLength(asked.size);
    expect([...asked].every((s) => script.states.includes(s))).toBe(true);
    // The same holds over a dropped run, which is what used to leave a chapter's `before` unrendered.
    const putBack = edited([
      [1000, { develop: exposure(0.5) }],
      [1200, { develop: null }],
      [5000, { aspect: '1:1' }],
    ]);
    const dropped = timelapseScript(pictureChapters(putBack), options());
    expect(dropped.chapters).toHaveLength(1);
    expect(dropped.states).toEqual([dropped.asShot, dropped.chapters[0].chapter.after]);
    expect(dropped.states).toContain(dropped.chapters[0].chapter.before);
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

  it('scores a tick per chapter, the landing at the tease and the seat at the reveal, or nothing', () => {
    const script = timelapseScript(pictureChapters(edited(FIVE)), options());
    expect(timelapseScore(script, 'none')).toEqual([]);
    const score = timelapseScore(script, 'wood');
    expect(score).toHaveLength(1 + script.chapters.length + 1);
    expect(score[0]).toMatchObject({ at: script.hook.dur * 0.62, voice: 'wood', rate: 0.67 });
    expect(score.slice(1, -1).map((e) => e.at)).toEqual(script.chapters.map((c) => c.start));
    expect(score.slice(1, -1).every((e) => e.voice === 'wood' && e.rate === 1)).toBe(true);
    expect(score[score.length - 1]).toMatchObject({ at: script.reveal.start + script.reveal.dur * 0.55, voice: 'seat' });
    expect(score.every((e, i) => i === 0 || e.at >= score[i - 1].at)).toBe(true);
    const flash = timelapseScore(timelapseScript(pictureChapters(edited(FIVE)), options({ hook: { ...DEFAULT_TIMELAPSE.hook, figure: 'flicker' } })), 'click');
    expect(flash[0].voice).toBe('click');
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
