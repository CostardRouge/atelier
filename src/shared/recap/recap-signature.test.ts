import { describe, expect, it } from 'vitest';
import { DEFAULT_DOC_SIGNATURE, DEFAULT_SIGNATURE_STYLE, withPlace } from '../signature/signature';
import { REEL_SAFE } from '../signature/signature-paint';
import { createRecapDoc, readRecapDoc, withRecap } from './recap-doc';
import { recapMark, recapSignedSlides } from './recap-signature';

const doc = createRecapDoc('week', 'local', { anchor: '2026-11-16' });

describe('a recap’s signature', () => {
  it('is on, bottom left, the last slide, for a recap that never chose', () => {
    expect(doc.signature).toEqual(DEFAULT_DOC_SIGNATURE);
    const stored = JSON.parse(JSON.stringify(doc)) as Record<string, unknown>;
    delete stored.signature;
    expect(readRecapDoc(stored, 'local')?.signature).toEqual(DEFAULT_DOC_SIGNATURE);
  });

  it('survives a round trip through storage', () => {
    const off = withRecap(doc, { signature: { on: false, corner: 'tr', slides: 'every' } });
    expect(readRecapDoc(JSON.parse(JSON.stringify(off)), 'local')?.signature).toEqual({ on: false, corner: 'tr', slides: 'every' });
  });

  it('paints the device’s face in the recap’s corner, clear of a Reel’s own interface on a 9:16 page', () => {
    const story = withRecap(doc, { format: 'story' });
    expect(recapMark(story, DEFAULT_SIGNATURE_STYLE)).toEqual({ face: 'sticker', words: 'tool', tool: 'Recap', corner: 'bl', safe: REEL_SAFE, at: null });
    expect(recapMark(withRecap(doc, { format: 'portrait' }), { face: 'stamp', words: 'made' })?.safe).toBeNull();
  });

  it('gives a slide the mark was dragged on its own place, the others their corner', () => {
    const moved = withRecap(doc, { signature: withPlace(doc.signature, { x: 0.8, y: 0.3 }, 'p:2') });
    expect(recapMark(moved, DEFAULT_SIGNATURE_STYLE, 'p:2')?.at).toEqual({ x: 0.8, y: 0.3 });
    expect(recapMark(moved, DEFAULT_SIGNATURE_STYLE, 'p:3')?.at).toBeNull();
    expect(recapMark(moved, DEFAULT_SIGNATURE_STYLE)?.at).toBeNull();
  });

  it('paints nothing and signs no slide when it is off', () => {
    const off = withRecap(doc, { signature: { ...DEFAULT_DOC_SIGNATURE, on: false } });
    expect(recapMark(off, DEFAULT_SIGNATURE_STYLE)).toBeNull();
    expect(recapSignedSlides(off, 4).size).toBe(0);
    expect([...recapSignedSlides(doc, 4)]).toEqual([3]);
  });
});
