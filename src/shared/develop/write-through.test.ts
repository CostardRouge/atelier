import { describe, expect, it } from 'vitest';
import { arrived, drafted, flushed, newWriteThrough } from './write-through';

/** A value with one number in it, compared the way a develop is: by what it says. */
interface Box {
  n: number;
}
const same = (a: Box | null, b: Box | null) => (a?.n ?? 0) === (b?.n ?? 0);

describe('a draft written through to a document', () => {
  it('owes nothing when it opens', () => {
    const w = newWriteThrough<Box>({ n: 1 });
    expect(w.pending).toBe(null);
    expect(flushed(w).owed).toBe(false);
  });

  it('owes a write once the draft moves, and remembers what it wrote', () => {
    let w = newWriteThrough<Box>({ n: 1 });
    w = drafted(w, { n: 2 }, same);
    expect(w.pending?.value).toEqual({ n: 2 });
    const out = flushed(w);
    expect(out.owed).toBe(true);
    expect(out.value).toEqual({ n: 2 });
    expect(out.state.written).toEqual({ n: 2 });
    expect(out.state.pending).toBe(null);
  });

  it('owes nothing for a gesture that ends where it started', () => {
    let w = newWriteThrough<Box>({ n: 1 });
    w = drafted(w, { n: 5 }, same);
    w = drafted(w, { n: 1 }, same);
    expect(w.pending).toBe(null);
    expect(flushed(w).owed).toBe(false);
  });

  it('does not read the document LAGGING a gesture as somebody else’s edit', () => {
    // The drag writes 2, then moves on to 3 before the document has caught up:
    // what arrives is the 2 we wrote, and it must not reseed the draft to it.
    let w = newWriteThrough<Box>({ n: 1 });
    w = flushed(drafted(w, { n: 2 }, same)).state;
    w = drafted(w, { n: 3 }, same);
    const back = arrived(w, { n: 2 }, same);
    expect(back.reseed).toBe(false);
    expect(back.state.pending?.value).toEqual({ n: 3 });
  });

  it('takes a value the editor did not write — an undo, a batch verb, an instance’s copy', () => {
    let w = newWriteThrough<Box>({ n: 1 });
    w = flushed(drafted(w, { n: 2 }, same)).state;
    const back = arrived(w, { n: 1 }, same);
    expect(back.reseed).toBe(true);
    expect(back.state.written).toEqual({ n: 1 });
  });

  it('drops what it owed when the document is changed under it', () => {
    // Undo landing mid-gesture: the pending write would otherwise put the
    // undone value straight back a moment later.
    let w = newWriteThrough<Box>({ n: 1 });
    w = drafted(w, { n: 9 }, same);
    const back = arrived(w, { n: 0 }, same);
    expect(back.reseed).toBe(true);
    expect(back.state.pending).toBe(null);
    expect(flushed(back.state).owed).toBe(false);
  });

  it('reads null and the value at rest as the same thing', () => {
    let w = newWriteThrough<Box>(null);
    w = drafted(w, { n: 0 }, same);
    expect(w.pending).toBe(null);
    expect(arrived(w, { n: 0 }, same).reseed).toBe(false);
  });
});
