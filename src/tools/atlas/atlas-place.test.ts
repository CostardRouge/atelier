import { describe, expect, it } from 'vitest';
import type { OverlayHit } from './atlas-layers';
import { dropPlacement, pieceAt, pieceBox, sanitizePlace, withPlacement } from './atlas-place';
import { DEFAULT_SETTINGS, sanitizeSettings } from './atlas-settings';

// A 1000 × 500 area at the origin: short side 500, a spot's margin 22.5 px, the snap 30 px.
const area = { x: 0, y: 0, w: 1000, h: 500 };

describe('dropPlacement', () => {
  it('goes back to a spot when its anchor comes near the spot', () => {
    expect(dropPlacement({ x: 30, y: 25, w: 200, h: 60 }, area)).toEqual({ spot: 'tl' });
    // The top-right spot pins the right edge; the bottom spots pin the bottom.
    expect(dropPlacement({ x: 770, y: 30, w: 200, h: 60 }, area)).toEqual({ spot: 'tr' });
    expect(dropPlacement({ x: 400, y: 410, w: 200, h: 60 }, area)).toEqual({ spot: 'bc' });
  });

  it('is held where it is let go elsewhere, growing from the nearest side', () => {
    expect(dropPlacement({ x: 100, y: 200, w: 120, h: 40 }, area)).toEqual({ free: { x: 0.1, y: 0.4, align: 'left' } });
    expect(dropPlacement({ x: 440, y: 200, w: 120, h: 40 }, area)).toEqual({ free: { x: 0.5, y: 0.4, align: 'center' } });
    expect(dropPlacement({ x: 700, y: 200, w: 200, h: 40 }, area)).toEqual({ free: { x: 0.9, y: 0.4, align: 'right' } });
  });

  it('keeps a piece let go past an edge inside the area', () => {
    const place = dropPlacement({ x: -80, y: 480, w: 200, h: 60 }, area);
    expect(place).toEqual({ free: { x: 0, y: 0.88, align: 'left' } });
  });

  it('measures a spot in the area it is given, not the frame', () => {
    const inner = { x: 100, y: 50, w: 800, h: 400 };
    expect(dropPlacement({ x: 120, y: 70, w: 100, h: 30 }, inner)).toEqual({ spot: 'tl' });
  });
});

describe('withPlacement', () => {
  it('holds a piece by hand, then puts it back in a spot and forgets the hand', () => {
    const held = withPlacement(DEFAULT_SETTINGS, 'title', { free: { x: 0.3, y: 0.6, align: 'center' } });
    expect(held.hud.free.title).toEqual({ x: 0.3, y: 0.6, align: 'center' });
    expect(held.hud.titleAt).toBe(DEFAULT_SETTINGS.hud.titleAt);
    const back = withPlacement(held, 'title', { spot: 'br' });
    expect(back.hud.titleAt).toBe('br');
    expect(back.hud.free.title).toBeUndefined();
  });

  it('moves the spot of the piece named, and no other', () => {
    const s = withPlacement(DEFAULT_SETTINGS, 'card', { spot: 'bl' });
    expect(s.hud.spotCardAt).toBe('bl');
    expect(s.hud.clockAt).toBe(DEFAULT_SETTINGS.hud.clockAt);
  });
});

describe('pieces on the frame', () => {
  const hits: OverlayHit[] = [
    { layer: 'title', piece: 'title', x: 10, y: 10, w: 100, h: 30 },
    { layer: 'title', piece: 'title', x: 10, y: 40, w: 60, h: 20 },
    { layer: 'intro', x: 0, y: 0, w: 500, h: 500 },
    { layer: 'clock', piece: 'clock', x: 300, y: 300, w: 80, h: 80 },
  ];

  it('finds the piece under the point, never a word that is not a piece', () => {
    expect(pieceAt(hits, 20, 20)).toBe('title');
    expect(pieceAt(hits, 320, 320)).toBe('clock');
    expect(pieceAt(hits, 200, 200)).toBeNull();
  });

  it('boxes every block of a piece', () => {
    expect(pieceBox(hits, 'title')).toEqual({ x: 10, y: 10, w: 100, h: 50 });
    expect(pieceBox(hits, 'stats')).toBeNull();
  });
});

describe('stored placements', () => {
  it('reads back a placement and refuses what is not one', () => {
    expect(sanitizePlace({ x: 1.4, y: -1, align: 'right' })).toEqual({ x: 1, y: 0, align: 'right' });
    expect(sanitizePlace({ x: 'a', y: 0 })).toBeNull();
    expect(sanitizePlace(null)).toBeNull();
  });

  it('keeps only the pieces it knows', () => {
    const s = sanitizeSettings({ hud: { free: { title: { x: 0.2, y: 0.3, align: 'left' }, banner: { x: 0, y: 0 } } } });
    expect(s.hud.free).toEqual({ title: { x: 0.2, y: 0.3, align: 'left' } });
  });
});
