import { describe, expect, it } from 'vitest';
import { createRecapDoc, readRecapDoc, withPictures, withRecap, type RecapPicture } from './recap-doc';
import { layoutRecap } from './recap-layout';
import { filledOf, planFilm } from './recap-motion';
import { readOpener } from './recap-opener';
import { planOpener } from './recap-opener-plan';
import { beatGrid, beatOf, bpmOf, onTheBeat, readBeat } from './recap-beat';
import { resolveRecap } from './recap-slots';

const pic = (key: string, day: string): RecapPicture => ({ key, origin: 'local', name: key, kind: 'photo', day });
const onGrid = (t: number, period: number, phase: number) => Math.abs((((t - phase) / period) % 1 + 1) % 1) < 1e-6 || Math.abs(((((t - phase) / period) % 1) + 1) % 1 - 1) < 1e-6;

describe('cuts on the beat', () => {
  it('keeps a beat as its spacing and its phase, and reads only a sane one', () => {
    const b = beatOf([0.31, 0.81, 1.31, 1.81, 2.31, 2.8])!;
    expect(b.period).toBeCloseTo(0.5);
    expect(b.phase).toBeCloseTo(0.31);
    expect(bpmOf(b)).toBe(120);
    expect(beatOf([0, 1])).toBeNull();
    expect(readBeat({ period: 3 })).toBeNull();
    expect(readBeat({ period: 0.5, phase: 1.2 })!.phase).toBeCloseTo(0.2);
  });

  it('starts the grid again at each turn of the loop', () => {
    expect(beatGrid({ period: 0.5, phase: 0.1 }, 1.2, 3)).toEqual([0.1, 0.6, 1.1, 1.3, 1.8, 2.3, 2.5]);
  });

  const base = withPictures(createRecapDoc('dump', 'local', { now: 1 }), ['2026-10-02', '2026-10-05', '2026-10-09', '2026-10-12', '2026-10-15', '2026-10-20', '2026-10-24'].map((d, i) => pic(`p${i}`, d)));
  const sound = { name: 's', gain: 1, fade: 1, fit: true, seconds: 60, beat: { period: 0.5, phase: 0.13 } };

  it('lands every page change, every entrance and the end on the beat', () => {
    const doc = withRecap(base, { range: { from: '2026-10-01', to: '2026-10-31' }, sound, motion: { ...base.motion, onBeat: true } });
    const r = resolveRecap(doc);
    const layout = layoutRecap(doc, r);
    const film = planFilm(doc, layout, () => null, filledOf(r));
    expect(film.pages.length).toBeGreaterThan(1);
    for (const p of film.pages) {
      if (p !== film.pages[0]) expect(onGrid(p.start, 0.5, 0.13)).toBe(true);
      for (const s of p.cells.values()) expect(onGrid(s.at * 2, 0.5, 0.26) || onGrid(s.at, 0.5, 0.13) || onGrid(s.at, 0.25, 0.13)).toBe(true);
    }
    // A whole bar: four beats from the first.
    expect(onGrid(film.total, 2, 0.13)).toBe(true);
    // Off, the film keeps its own time.
    const off = planFilm(withRecap(doc, { motion: { ...doc.motion, onBeat: false } }), layout, () => null, filledOf(r));
    expect(off.pages[1].start).not.toBeCloseTo(film.pages[1].start, 3);
  });

  it('moves the opener’s cut to a beat, and keeps the author’s length', () => {
    const doc = withRecap(base, { range: { from: '2026-10-01', to: '2026-10-31' }, sound, motion: { ...base.motion, onBeat: true }, opener: { ...readOpener({ kind: 'badge' }), seconds: 2.4 } });
    const r = resolveRecap(doc);
    const layout = layoutRecap(doc, r);
    const film = planFilm(doc, layout, () => null, filledOf(r), planOpener(doc, r));
    expect(film.lead).toBeCloseTo(2.63);
    expect(film.pages[0].start).toBeCloseTo(2.63);
    const fixed = planFilm(withRecap(doc, { length: 20 }), layout, () => null, filledOf(r), planOpener(doc, r));
    expect(fixed.total).toBeCloseTo(20);
  });

  it('reads the switch and the beat back, and changes nothing with no grid', () => {
    const doc = readRecapDoc({ id: 'x', template: 'month', motion: { onBeat: true }, sound: { name: 's', seconds: 10, beat: { period: 0.6, phase: 0.1 } } }, 'local')!;
    expect(doc.motion.onBeat).toBe(true);
    expect(doc.sound!.beat!.period).toBe(0.6);
    expect(doc.sound!.beat!.phase).toBeCloseTo(0.1);
    const plan = { pages: [], total: 3 };
    expect(onTheBeat(plan, [])).toBe(plan);
  });
});
