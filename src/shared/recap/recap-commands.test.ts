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
