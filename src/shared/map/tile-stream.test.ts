import { describe, expect, it, vi } from 'vitest';
import { TileStream, closeStream, holdingStream, openStream, streamFor, type StreamIO } from './tile-stream';
import type { PyramidTile } from './tile-strip';

/** A fake bitmap: which tile it is, and whether it was closed. */
interface Fake {
  tile: string;
  closed: boolean;
}

/** Blobs that answer at once (or refuse for `refused` keys), bitmaps counted. */
function io(refused: ReadonlySet<string> = new Set()) {
  const made: Fake[] = [];
  const asked: string[] = [];
  const io: StreamIO<Fake> = {
    async fetch(tile) {
      const key = `${tile.z}/${tile.x}/${tile.y}`;
      asked.push(key);
      if (refused.has(key)) throw new Error('refused');
      // A tile marked `parent` stands in for one the server refused.
      return { blob: new Blob([key]), zoom: refused.has(`parent:${key}`) ? tile.z - 1 : tile.z };
    },
    async decode(_blob, _zoom, tile) {
      const fake = { tile: `${tile.z}/${tile.x}/${tile.y}`, closed: false };
      made.push(fake);
      return fake;
    },
    close(bitmap) {
      bitmap.closed = true;
    },
  };
  return { io, made, asked };
}

/** A row of tiles at zoom 10, and their parents at 9. */
const ROW: PyramidTile[] = [
  ...Array.from({ length: 4 }, (_, x) => ({ z: 9, x, y: 0 })),
  ...Array.from({ length: 8 }, (_, x) => ({ z: 10, x, y: 0 })),
];

describe('a streamed ground', () => {
  it('fetches every blob ahead, coarse first, and counts what failed', async () => {
    const { io: fake, asked } = io(new Set(['10/7/0']));
    const stream = new TileStream('k', ROW, 4, fake, 2);
    await stream.fetchAll();
    expect(asked.length).toBe(ROW.length);
    expect(asked.slice(0, 4).every((key) => key.startsWith('9/'))).toBe(true);
    const p = stream.progress();
    expect(p).toMatchObject({ total: 12, fetched: 11, failed: 1, done: true, decoded: 0 });
  });

  it('decodes only what is asked for, and never more than the window', async () => {
    const { io: fake, made } = io();
    const stream = new TileStream('k', ROW, 4, fake);
    await stream.fetchAll();
    await stream.ready([4, 5, 6]);
    expect(made.map((m) => m.tile)).toEqual(['10/0/0', '10/1/0', '10/2/0']);
    expect(stream.get(4)?.tile).toBe('10/0/0');
    await stream.ready([7, 8, 9, 10, 11]);
    // Five asked into a window of four: the nearest four are pinned and in.
    expect(stream.progress().decoded).toBe(4);
    for (const i of [7, 8, 9, 10]) expect(stream.get(i)).toBeDefined();
    // What fell out of the window was closed, not leaked.
    expect(made.filter((m) => m.closed).length).toBe(made.length - 4);
  });

  it('never closes a pinned tile for a preview’s request', async () => {
    const { io: fake } = io();
    const stream = new TileStream('k', ROW, 3, fake);
    await stream.fetchAll();
    await stream.ready([4, 5, 6]);
    stream.request([7, 8, 9]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (const i of [4, 5, 6]) expect(stream.get(i)?.closed).toBe(false);
  });

  it('closes the least recently used first', async () => {
    const { io: fake } = io();
    const stream = new TileStream('k', ROW, 2, fake);
    await stream.fetchAll();
    stream.request([4, 5]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    stream.get(4); // 5 is now the oldest
    stream.request([6]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stream.get(4)).toBeDefined();
    expect(stream.get(5)).toBeUndefined();
    expect(stream.get(6)).toBeDefined();
  });

  it('finds the nearest decoded ancestor for a tile not in yet', async () => {
    const { io: fake } = io();
    const stream = new TileStream('k', ROW, 8, fake);
    await stream.fetchAll();
    await stream.ready([1]); // 9/1/0
    // 10/2/0 and 10/3/0 are its children; 10/0/0's parent is 9/0/0, not decoded.
    expect(stream.ancestor(6)).toBe(1);
    expect(stream.ancestor(7)).toBe(1);
    expect(stream.ancestor(4)).toBeUndefined();
  });

  it('decodes a tile asked for before its blob was in, as soon as it lands', async () => {
    const { io: fake } = io();
    const stream = new TileStream('k', ROW, 8, fake, 1);
    stream.request([11]);
    expect(stream.get(11)).toBeUndefined();
    await stream.fetchAll();
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(stream.get(11)?.tile).toBe('10/7/0');
  });

  it('waits for the fetch when an export asks before it is over', async () => {
    const { io: fake } = io();
    const stream = new TileStream('k', ROW, 8, fake, 1);
    await stream.ready([10, 11]);
    expect(stream.get(10)).toBeDefined();
    expect(stream.get(11)).toBeDefined();
  });

  it('counts a tile that landed from a coarser zoom', async () => {
    const { io: fake } = io(new Set(['parent:10/3/0']));
    const stream = new TileStream('k', ROW, 8, fake);
    await stream.fetchAll();
    expect(stream.progress().coarser).toBe(1);
  });

  /** Decodes held until `open()` — so the lanes fill and a queue forms. */
  function gated() {
    const base = io();
    let open!: () => void;
    const gate = new Promise<void>((resolve) => (open = resolve));
    const slow: StreamIO<Fake> = { ...base.io, decode: async (...args) => (await gate, base.io.decode(...args)) };
    return { ...base, io: slow, open: () => open() };
  }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  it('drops a queued decode the preview no longer asks for', async () => {
    const { io: slow, made, open } = gated();
    const stream = new TileStream('k', ROW, 8, slow);
    await stream.fetchAll();
    // Three lanes run 4–6; 7 and 8 wait in the queue.
    stream.request([4, 5, 6, 7, 8]);
    // The playhead moved on before they ran.
    stream.request([9, 10]);
    open();
    for (let k = 0; k < 6; k++) await tick();
    const tiles = made.map((m) => m.tile);
    expect(tiles).not.toContain('10/3/0');
    expect(tiles).not.toContain('10/4/0');
    expect(stream.get(9)).toBeDefined();
    expect(stream.get(10)).toBeDefined();
  });

  it('never drops a decode an export awaits, whatever the preview asks since', async () => {
    const { io: slow, open } = gated();
    const stream = new TileStream('k', ROW, 8, slow);
    await stream.fetchAll();
    const export_ = stream.ready([4, 5, 6, 7, 8]);
    stream.request([0]);
    open();
    await export_;
    for (const i of [4, 5, 6, 7, 8]) expect(stream.get(i)).toBeDefined();
  });

  it('answers an export still waiting when the stream is let go', async () => {
    const { io: slow, open } = gated();
    const stream = new TileStream('k', ROW, 8, slow);
    await stream.fetchAll();
    // Three decodes hang on the gate, two are queued behind them.
    const waiting = stream.ready([4, 5, 6, 7, 8]);
    let answered = false;
    void waiting.then(() => (answered = true));
    stream.dispose();
    open();
    for (let k = 0; k < 6; k++) await tick();
    expect(answered).toBe(true);
    // Nothing decoded after the end is kept.
    expect(stream.progress().decoded).toBe(0);
  });

  it('keeps a stream an export holds past the editor letting it go', async () => {
    vi.useFakeTimers();
    try {
      const stream = openStream('held', ROW);
      // The editor lets go (the camera changed under a frozen piece)…
      closeStream('held');
      // …while an export frame waits past the release delay.
      await holdingStream('held', async () => {
        await vi.advanceTimersByTimeAsync(10_000);
      });
      expect(streamFor('held')).toBe(stream);
      // Once nobody holds it, it goes.
      await vi.advanceTimersByTimeAsync(10_000);
      expect(streamFor('held')).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });
});
