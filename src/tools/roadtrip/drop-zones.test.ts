import { describe, expect, it } from 'vitest';
import type { CellRect } from '../../shared/media/media-layout';
import { dropAnnouncement, dropChip, dropHint, dropZones } from './drop-zones';

const cell = (x: number, y: number, w: number, h: number, rotation = 0): CellRect => ({
  x,
  y,
  w,
  h,
  rotation,
  mount: 'none',
});

describe('dropZones', () => {
  it('turns canvas cells into CSS zones, each knowing what it holds', () => {
    const zones = dropZones([cell(0, 0, 400, 800), cell(400, 0, 400, 800, 5)], 800, 400, 800, ['pic-A', null]);
    expect(zones).toEqual([
      { index: 0, x: 0, y: 0, w: 200, h: 400, rotation: 0, holding: 'pic-A' },
      { index: 1, x: 200, y: 0, w: 200, h: 400, rotation: 5, holding: null },
    ]);
  });

  it('makes the whole frame one zone when the slide holds one picture', () => {
    expect(dropZones([], 800, 400, 700, ['lead'])).toEqual([
      { index: 0, x: 0, y: 0, w: 400, h: 700, rotation: 0, holding: 'lead' },
    ]);
    expect(dropZones([], 800, 400, 700, [])[0].holding).toBeNull();
  });
});

describe('dropChip', () => {
  const base = { collage: true, label: 'pic-B' } as const;

  it('offers to place in an empty cell and to replace a filled one', () => {
    expect(dropChip({ ...base, phase: 'over', zone: { index: 2, holding: null } })).toEqual({
      title: 'Place here',
      detail: 'Cell 3',
      tone: 'accent',
      icon: 'plus',
    });
    expect(dropChip({ ...base, phase: 'over', zone: { index: 0, holding: 'pic-D' } })).toMatchObject({
      title: 'Replace',
      detail: 'pic-D',
      icon: 'swap',
    });
  });

  it('speaks of the picture, not a cell, on a single-picture slide', () => {
    expect(
      dropChip({ ...base, collage: false, phase: 'over', zone: { index: 0, holding: null } }).title,
    ).toBe('Use this picture');
    expect(
      dropChip({ ...base, collage: false, phase: 'over', zone: { index: 0, holding: 'lead' } }).title,
    ).toBe('Replace the picture');
  });

  it('says where a fetch comes from, that a drop landed, and why one failed', () => {
    const zone = { index: 1, holding: null };
    expect(dropChip({ ...base, phase: 'fetching', zone, source: 'winnow' })).toMatchObject({
      title: 'Fetching…',
      detail: 'from winnow',
      tone: 'muted',
    });
    expect(dropChip({ ...base, phase: 'placed', zone })).toMatchObject({ title: 'Placed', tone: 'ok' });
    expect(dropChip({ ...base, phase: 'failed', zone, reason: 'offline' })).toMatchObject({
      tone: 'danger',
      detail: 'offline',
    });
    expect(dropChip({ ...base, phase: 'failed', zone }).detail).toBe('pic-B');
  });
});

describe('what is said aloud', () => {
  it('names the picture and the cell', () => {
    const zone = { index: 1, holding: null };
    expect(dropAnnouncement({ collage: true, label: 'pic-B', phase: 'placed', zone })).toBe(
      'pic-B placed in cell 2',
    );
    expect(dropAnnouncement({ collage: false, label: 'pic-B', phase: 'failed', zone, reason: 'offline' })).toBe(
      'pic-B could not be placed: offline',
    );
    expect(dropHint(true, 4)).toBe('Drop on one of the 4 cells');
    expect(dropHint(false, 1)).toBe('Drop on the picture to use it');
  });
});
