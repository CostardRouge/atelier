import { describe, expect, it } from 'vitest';
import { applySettings, recapOutline } from './recap-commands';
import { createRecapDoc, withPictures } from './recap-doc';
import { resolveRecap } from './recap-slots';

describe('recap commands', () => {
  const doc = withPictures(createRecapDoc('month', 'local', { anchor: '2026-10-01', now: 1 }), [
    { key: 'a', origin: 'local', name: 'a.jpg', kind: 'photo', day: '2026-10-02', device: 'ILCE-7M4' },
    { key: 'sky', origin: 'local', name: 'sky.mp4', kind: 'video', day: '2026-10-03', loose: true },
  ]);

  it('writes known settings, deep, and says what changed', () => {
    const r = applySettings(doc, { format: 'square', cells: { gap: 0.02, count: true }, motion: { order: 'spiral' } }, 5);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.doc.format).toBe('square');
    expect(r.doc.cells.gap).toBe(0.02);
    expect(r.doc.cells.number).toBe(doc.cells.number);
    expect(r.doc.motion.order).toBe('spiral');
    expect(r.changed).toEqual(['format', 'cells.gap', 'cells.count', 'motion.order']);
  });

  it('refuses an unknown key and an out-of-range value, never clamping', () => {
    expect(applySettings(doc, { colour: 'red' })).toEqual({ ok: false, error: expect.stringContaining('unknown setting "colour"') });
    expect(applySettings(doc, { cells: { gap: 0.5 } })).toEqual({ ok: false, error: expect.stringContaining('cells.gap: 0.5') });
    expect(applySettings(doc, { motion: { order: 'sideways' } }).ok).toBe(false);
    expect(applySettings(doc, { pictures: [] }).ok).toBe(false);
    expect(applySettings(doc, 'x').ok).toBe(false);
  });

  it('outlines a recap for an agent, its loose clip out of the pool', () => {
    const o = recapOutline(doc, resolveRecap(doc), 1, 7.5, { 'ILCE-7M4': 'Sony' });
    expect(o.pool).toBe(1);
    expect(o.filled).toBe(1);
    expect(o.slots[1]).toEqual({ slot: '2026-10-02', label: '2 October', day: '2026-10-02', picture: { key: 'a', name: 'a.jpg', kind: 'photo', device: 'Sony' }, candidates: 1 });
    expect(o.slots[2].picture).toBeNull();
  });
});

describe('what an agent writes a caption from, and when it goes out', () => {
  it('gathers the period, the stays in order, the cameras and the best pictures', async () => {
    const { createRecapDoc, withPictures } = await import('./recap-doc');
    const { resolveRecap } = await import('./recap-slots');
    const { recapFacts } = await import('./recap-commands');
    let doc = createRecapDoc('dump', 'local', { now: 1 });
    doc = { ...doc, range: { from: '2025-11-01', to: '2025-11-10' } };
    doc = withPictures(doc, [
      { key: 'a', origin: 'local', name: 'a', kind: 'photo', day: '2025-11-01', place: 'Hobart', device: 'ILCE-7M4' },
      { key: 'b', origin: 'local', name: 'b', kind: 'photo', day: '2025-11-02', place: 'Hobart', device: 'ILCE-7M4', fav: true },
      { key: 'c', origin: 'local', name: 'c', kind: 'video', day: '2025-11-05', place: 'Freycinet', device: 'iPhone 15 Pro' },
    ]);
    const f = recapFacts(doc, resolveRecap(doc));
    expect(f.period).toEqual({ from: '2025-11-01', to: '2025-11-05' });
    expect(f.places.route).toEqual(['Hobart', 'Freycinet']);
    expect(f.places.stays).toEqual([
      { place: 'Hobart', days: 2, from: '2025-11-01', to: '2025-11-02' },
      { place: 'Freycinet', days: 1, from: '2025-11-05', to: '2025-11-05' },
    ]);
    expect(f.devices[0]).toEqual({ name: 'ILCE-7M4', count: 2 });
    expect(f.shown[0]).toMatchObject({ key: 'b', fav: true });
    expect(f.words.tags).toContain('#hobart');
    expect(f.caption).toMatchObject({ approved: false, custom: false });
  });

  it('reads when a post goes out: the next free slot, now, a draft, a wall clock in the rhythm’s zone', async () => {
    const { scheduleTarget } = await import('./recap-commands');
    const { DEFAULT_RHYTHM } = await import('../sources/postiz/rhythm');
    const now = new Date('2026-11-08T20:00:00Z');
    expect(scheduleTarget(undefined, DEFAULT_RHYTHM, [], now)).toEqual({ at: new Date('2026-11-10T08:00:00.000Z') });
    expect(scheduleTarget('now', DEFAULT_RHYTHM, [], now)).toEqual({ at: 'now' });
    expect(scheduleTarget('2026-11-12T18:30', DEFAULT_RHYTHM, [], now)).toEqual({ at: new Date('2026-11-12T17:30:00.000Z') });
    expect(scheduleTarget('2026-11-12T18:30:00Z', DEFAULT_RHYTHM, [], now)).toEqual({ at: new Date('2026-11-12T18:30:00.000Z') });
    expect(scheduleTarget('2026-11-01T10:00', DEFAULT_RHYTHM, [], now)).toMatchObject({ error: expect.stringMatching(/past/) });
    expect(scheduleTarget('tomorrow', DEFAULT_RHYTHM, [], now)).toMatchObject({ error: expect.stringMatching(/not a time/) });
  });
});
