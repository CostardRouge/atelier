import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAMING } from '../media/framing';
import {
  collageCellAt,
  collageCellCount,
  collageKept,
  collageMediaRefs,
  createCollage,
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
