import { describe, expect, it } from 'vitest';
import { createRecapDoc, readRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { layoutRecap } from './recap-layout';
import { filledOf, planFilm } from './recap-motion';
import { BAND_MOTIONS, bandSeconds, bandsAt } from './recap-bands';
import { resolveRecap } from './recap-slots';
import { recordingContext } from '../story/recording-context';
import { paintRecap } from './recap-paint';

const W = 1080;
const H = 1920;
const boxes = Array.from({ length: 7 }, (_, i) => ({ x: i * 156, y: 0, w: 150, h: H }));
const span = { from: 2, hold: 1 };

describe('the week’s bands moving', () => {
  it('rests as laid before its turn and after the return, every motion', () => {
    for (const m of BAND_MOTIONS) {
      expect(bandsAt(m, boxes, W, H, span, 1, false).map((l) => l.box)).toEqual(boxes);
      expect(bandsAt(m, boxes, W, H, span, 2 + bandSeconds(1) + 0.01, false).map((l) => l.box)).toEqual(boxes);
    }
  });

  it('opens each day in turn wide in an accordion, the week still filling the page', () => {
    const at = bandsAt('accordion', boxes, W, H, span, 2 + 3.6, false);
    const widths = at.map((l) => l.box.w);
    expect(widths.indexOf(Math.max(...widths))).toBe(3);
    expect(widths[3]).toBeGreaterThan(boxes[3].w * 2.5);
    const last = at[6].box;
    expect(last.x + last.w).toBeCloseTo(boxes[6].x + boxes[6].w, 5);
  });

  it('puts the day over the whole page in a spotlight, dims the others in focus, slides a wide strip', () => {
    const spot = bandsAt('spotlight', boxes, W, H, span, 2 + 1.5, false);
    expect(spot[1]).toMatchObject({ box: { x: 0, y: 0, w: W, h: H }, top: true });
    const focus = bandsAt('focus', boxes, W, H, span, 2 + 4.6, false);
    expect(focus[4].dim).toBe(0);
    expect(focus[0].dim).toBeGreaterThan(0.4);
    expect(focus.map((l) => l.box)).toEqual(boxes);
    const slide = bandsAt('slide', boxes, W, H, span, 2 + 5.8, false);
    expect(slide[0].box.w).toBeCloseTo(W * 0.55);
    expect(slide[0].box.x).toBeLessThan(0);
  });

  it('drifts each picture with Pan inside, even with the bands still', () => {
    const a = bandsAt('none', boxes, W, H, null, 1, true);
    expect(a.some((l) => l.pan !== 0)).toBe(true);
    expect(a.map((l) => l.box)).toEqual(boxes);
  });

  it('is the week’s default, extends its page, and lands each day on whole beats', () => {
    let doc = createRecapDoc('week', 'local', { anchor: '2026-10-05', now: 1 });
    expect(doc.motion.bands).toBe('accordion');
    expect(doc.motion.bandPan).toBe(true);
    expect(readRecapDoc({ id: 'x', template: 'month' }, 'local')!.motion.bands).toBe('none');
    doc = withPictures(doc, Array.from({ length: 7 }, (_, i): RecapPicture => ({ key: `p${i}`, origin: 'local', name: `p${i}`, kind: 'photo', day: `2026-10-${String(5 + i).padStart(2, '0')}` })));
    const r = resolveRecap(doc);
    const layout = layoutRecap(doc, r);
    const film = planFilm(doc, layout, () => null, filledOf(r));
    const b = film.pages[0].bands!;
    expect(b.from).toBeGreaterThan(film.pages[0].allOn);
    expect(film.total).toBeGreaterThanOrEqual(b.from + bandSeconds(b.hold));
    const beat = withRecap(doc, { sound: { name: 's', gain: 1, fade: 1, fit: false, seconds: 60, beat: { period: 0.5, phase: 0.1 } }, motion: { ...doc.motion, onBeat: true } });
    const fb = planFilm(beat, layout, () => null, filledOf(r)).pages[0].bands!;
    expect(fb.hold).toBeCloseTo(1);
    expect(((fb.from - 0.1) / 0.5) % 1).toBeCloseTo(0, 5);
    // Painted mid-turn: every band still drawn.
    const rec = recordingContext(W, H);
    paintRecap(rec.ctx, W, doc, r, layout, film, { still: () => ({ image: {} as CanvasImageSource, width: 800, height: 1200 }) }, { t: b.from + 2.5, page: 0 });
    expect(rec.ops.filter((o) => o.startsWith('image')).length).toBe(7);
  });
});
