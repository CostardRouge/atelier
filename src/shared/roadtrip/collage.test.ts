import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING } from '../media/framing';
import {
  collageAnimates,
  collageCellAt,
  collageCellCount,
  collageCellMotions,
  collageKept,
  collageMediaRefs,
  collageSettleSeconds,
  createCollage,
  mirroredExit,
  readCollage,
  resolveCollage,
  retemplateCollage,
  swapCollageCells,
  withCollageCell,
  type CollageLead,
} from './collage';

const ref = (name: string) => ({ name, size: 1, lastModified: 1 });
const lead: CollageLead = { media: ref('lead.jpg'), framing: { ...DEFAULT_FRAMING }, develop: null };

describe('createCollage / readCollage', () => {
  it('starts a collage with empty cells after the lead', () => {
    const c = createCollage('grid-2x2')!;
    expect(c.cells).toHaveLength(3);
    expect(c.cells.every((cell) => cell.media === null)).toBe(true);
    expect(collageCellCount(c)).toBe(4);
    expect(createCollage('nope')).toBeNull();
  });

  it('reads a stored collage and refuses an unknown template', () => {
    expect(readCollage(null)).toBeNull();
    expect(readCollage({ template: 'from-the-future', cells: [] })).toBeNull();
    const c = readCollage({
      template: 'bento-hero',
      spacing: { gap: 2 },
      background: 'red',
      cells: [{ media: ref('b.jpg'), framing: { scale: 2 } }, 'junk'],
    })!;
    expect(c.spacing.gap).toBe(0.1);
    expect(c.background).toBe('#100f0d');
    expect(c.cells[0].media?.name).toBe('b.jpg');
    expect(c.cells[0].framing.scale).toBe(2);
    expect(c.cells[1].media).toBeNull();
    expect(c.place).toEqual({ dx: 0, dy: 0, rotation: 0 });
  });
});

describe('motion', () => {
  const frame = { w: 1080, h: 1920 };
  const enter = {
    step: { preset: 'fade' as const, duration: 0.5, easing: 'linear' as const },
    stagger: { each: 0.25, order: 'rows' as const },
  };

  it('is still without an entrance or an exit, and moves with either', () => {
    const c = createCollage('grid-2x2')!;
    expect(collageAnimates(c)).toBe(false);
    expect(collageCellMotions(c, resolveCollage(c, 1080, 1920), frame, 1, 3)).toBeNull();
    expect(collageAnimates({ ...c, enter })).toBe(true);
    expect(collageAnimates({ ...c, exit: { step: enter.step, reverse: true } })).toBe(true);
    expect(collageAnimates(null)).toBe(false);
  });

  it('lands a row at a time and settles after the last row plus the step', () => {
    const c = { ...createCollage('grid-2x2')!, enter };
    const cells = resolveCollage(c, 1080, 1920);
    const at = (t: number) => collageCellMotions(c, cells, frame, t, null)!.map((m) => m!.transform.alpha);
    expect(at(0)).toEqual([0, 0, 0, 0]);
    expect(at(0.25)).toEqual([expect.closeTo(0.5, 6), expect.closeTo(0.5, 6), 0, 0]);
    expect(at(1)).toEqual([1, 1, 1, 1]);
    expect(collageSettleSeconds(c, 1080 / 1920)).toBeCloseTo(0.75);
    expect(collageSettleSeconds(createCollage('grid-2x2'), 1)).toBe(0);
  });

  it('lays a staggered exit against the screen time as earlier window ends', () => {
    const c = { ...createCollage('grid-2x2')!, enter, exit: { step: { ...enter.step, duration: 0.5 }, reverse: true } };
    const cells = resolveCollage(c, 1080, 1920);
    // Reverse (last in, first out): the bottom row arrived last, so its window
    // ends first, at 3 − 0.25; the top row's ends at 3.
    const at = (t: number) => collageCellMotions(c, cells, frame, t, 3)!.map((m) => m!.transform.alpha);
    expect(at(2.9)).toEqual([expect.closeTo(0.2, 6), expect.closeTo(0.2, 6), 0, 0]);
    const fifo = { ...c, exit: { ...c.exit!, reverse: false } };
    expect(collageCellMotions(fifo, cells, frame, 2.9, 3)!.map((m) => m!.transform.alpha)).toEqual([
      0,
      0,
      expect.closeTo(0.2, 6),
      expect.closeTo(0.2, 6),
    ]);
    expect(at(3.1)).toEqual([0, 0, 0, 0]);
    // A still (no screen time) never leaves.
    expect(collageCellMotions(c, cells, frame, 10, null)!.map((m) => m!.transform.alpha)).toEqual([1, 1, 1, 1]);
  });

  it('mirrors an entrance into an exit travelling back, and reads stored motion', () => {
    const mirrored = mirroredExit({
      step: { preset: 'slide', duration: 0.4, easing: 'out', direction: 'up', delay: 1 },
      stagger: { each: 0.1, order: 'sequence' },
    });
    expect(mirrored.step.direction).toBe('down');
    expect(mirrored.step.delay).toBeUndefined();
    expect(mirrored.reverse).toBe(true);
    const read = readCollage({
      template: 'grid-2x2',
      enter: { step: { preset: 'scale', duration: 0.3, easing: 'back', inside: true }, stagger: { order: 'size' } },
      exit: 'nope',
    })!;
    expect(read.enter?.step).toMatchObject({ preset: 'scale', easing: 'back', inside: true });
    expect(read.enter?.stagger.order).toBe('size');
    expect(read.exit).toBeNull();
  });
});

describe('cells', () => {
  it('cell 0 is the lead and the rest are the list', () => {
    const c = withCollageCell(lead, createCollage('grid-2x2')!, 2, { media: ref('c.jpg') }).collage;
    expect(collageCellAt(lead, c, 0).media?.name).toBe('lead.jpg');
    expect(collageCellAt(lead, c, 2).media?.name).toBe('c.jpg');
    expect(collageCellAt(lead, c, 9).media).toBeNull();
    expect(collageMediaRefs(lead, c).map((r) => r.name)).toEqual(['lead.jpg', 'c.jpg']);
  });

  it('writes the lead through cell 0', () => {
    const out = withCollageCell(lead, createCollage('grid-2x2')!, 0, { media: ref('new.jpg') });
    expect(out.lead.media?.name).toBe('new.jpg');
    expect(out.collage.cells).toHaveLength(3);
  });

  it('swaps pictures, framings and develops but never places', () => {
    let c = createCollage('prints-3')!;
    c = withCollageCell(lead, c, 1, { media: ref('b.jpg'), place: { dx: 0.1, dy: 0, rotation: 3 } }).collage;
    const out = swapCollageCells(lead, c, 0, 1);
    expect(out.lead.media?.name).toBe('b.jpg');
    expect(out.collage.cells[0].media?.name).toBe('lead.jpg');
    expect(out.collage.cells[0].place).toEqual({ dx: 0.1, dy: 0, rotation: 3 });
    expect(out.collage.place).toEqual({ dx: 0, dy: 0, rotation: 0 });
  });

  it('keeps pictures past a smaller template and pads up to a bigger one', () => {
    let c = createCollage('bento-six')!;
    c = withCollageCell(lead, c, 5, { media: ref('six.jpg') }).collage;
    const small = retemplateCollage(c, 'grid-2x2')!;
    expect(small.cells).toHaveLength(5);
    expect(collageKept(small)).toEqual([{ cell: 6, media: ref('six.jpg') }]);
    const big = retemplateCollage(small, 'grid-3x3')!;
    expect(big.cells).toHaveLength(8);
    expect(collageKept(big)).toEqual([]);
    expect(retemplateCollage(c, 'nope')).toBeNull();
  });

  it('resolves to its template\'s cells at any frame', () => {
    const c = createCollage('stack-2')!;
    const cells = resolveCollage(c, 1080, 1920);
    expect(cells).toHaveLength(2);
    expect(cells[1].y).toBeGreaterThan(cells[0].y);
  });
});
