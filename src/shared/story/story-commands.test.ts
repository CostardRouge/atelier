import { describe, expect, it } from 'vitest';
import { checkStylePatch, postOutline } from './story-commands';

describe('checkStylePatch', () => {
  it('keeps fields given in range', () => {
    expect(checkStylePatch({ dx: 12, opacity: 0.5, color: '@acc', textCase: 'upper' })).toEqual({ ok: true, patch: { dx: 12, opacity: 0.5, color: '@acc', textCase: 'upper' } });
  });
  it('clears a field with null, and hidden with false', () => {
    expect(checkStylePatch({ dx: null, hidden: false })).toEqual({ ok: true, patch: { dx: undefined, hidden: undefined } });
  });
  it('refuses out of range rather than clamping', () => {
    const r = checkStylePatch({ opacity: 2 });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.reason).toMatch(/^opacity/);
  });
  it('refuses an unknown field, naming it', () => {
    const r = checkStylePatch({ colour: '#fff' });
    expect(!r.ok && r.reason).toMatch(/“colour”/);
  });
  it('refuses a colour that is neither a token nor a hex', () => {
    expect(checkStylePatch({ color: 'red' }).ok).toBe(false);
    expect(checkStylePatch({ color: '#ff0000' }).ok).toBe(true);
  });
  it('refuses an empty or non-object style', () => {
    expect(checkStylePatch({}).ok).toBe(false);
    expect(checkStylePatch([1]).ok).toBe(false);
  });
});

describe('postOutline', () => {
  it('places scenes and captions on the post clock', () => {
    const out = postOutline(
      [{ key: 's1', block: 'counter', index: 0, a: 3.6, b: 8.1, start: 3.3, cap: { a: 0.8, b: 3.6 } }],
      [{ id: 'x', key: 'counter.number', slot: 's1', text: true, spans: [[4.04, 8.1]] }],
    );
    expect(out.scenes[0]).toMatchObject({ slot: 's1', block: 'counter', from: 3.6, to: 8.1, caption: { from: 4.1, to: 6.9 } });
    expect(out.objects[0]).toMatchObject({ key: 'counter.number', slot: 's1', text: true, on: [[4, 8.1]] });
  });
});
