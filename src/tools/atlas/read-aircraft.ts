import { aircraftName, parseMetadata } from './atlas-aircraft';

/** A metadata box larger than this is not metadata worth reading. */
const MAX_META = 4 * 1024 * 1024;

interface BoxAt {
  type: string;
  /** Where the box starts (its header) and where its payload starts and ends. */
  at: number;
  start: number;
  end: number;
}

async function bytes(file: Blob, start: number, end: number): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(start, end).arrayBuffer());
}

/** Walk the boxes of `[from, to)` by their headers alone — one 16-byte read each. */
async function boxes(file: Blob, from: number, to: number): Promise<BoxAt[]> {
  const out: BoxAt[] = [];
  let o = from;
  for (let guard = 0; o + 8 <= to && guard < 4096; guard++) {
    const h = await bytes(file, o, Math.min(to, o + 16));
    if (h.length < 8) break;
    let size = ((h[0] << 24) | (h[1] << 16) | (h[2] << 8) | h[3]) >>> 0;
    const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
    let header = 8;
    if (size === 1) {
      if (h.length < 16) break;
      size = (((h[8] << 24) | (h[9] << 16) | (h[10] << 8) | h[11]) >>> 0) * 2 ** 32 + ((((h[12] << 24) | (h[13] << 16) | (h[14] << 8) | h[15]) >>> 0));
      header = 16;
    } else if (size === 0) size = to - o;
    if (size < header || o + size > to) break;
    out.push({ type, at: o, start: o + header, end: o + size });
    o += size;
  }
  return out;
}

/** The tab's answers, one per video file. */
const known = new WeakMap<File, Promise<string | null>>();

/**
 * The aircraft a DJI clip names in its own metadata, or null — reading only
 * box headers down to `moov`, then the `udta` / `meta` boxes inside it
 * (kilobytes of a file that may weigh gigabytes).
 */
export function readAircraft(file: File): Promise<string | null> {
  let pending = known.get(file);
  if (!pending) {
    pending = (async () => {
      const moov = (await boxes(file, 0, file.size)).find((b) => b.type === 'moov');
      if (!moov) return null;
      const blocks: Uint8Array[] = [];
      for (const b of await boxes(file, moov.start, moov.end)) {
        // Read with its own header, so the parser sees the box and not only its children.
        if ((b.type === 'udta' || b.type === 'meta') && b.end - b.at <= MAX_META) blocks.push(await bytes(file, b.at, b.end));
      }
      return blocks.length ? aircraftName(parseMetadata(blocks)) : null;
    })().catch(() => null);
    known.set(file, pending);
  }
  return pending;
}
