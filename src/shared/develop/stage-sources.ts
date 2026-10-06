/**
 * The stage's decoded STILLS, kept for the session across a picture switch
 * (P4 of `docs/develop-performance.md`, 2026-10-06). ←/→ used to decode the
 * next picture at the stage's budget every time, and a picture stepped back
 * to again. A still decoded for the stage is held here in a BORROWED cache
 * (`media/borrowed-cache.ts`) under a byte ceiling (`still-fit.ts`,
 * `stageHoldFor`: three stage pictures on a phone, eight 4K frames on a
 * computer) — the open picture borrowed and never let go under the stage,
 * the rest least recently used first — and the roll WARMS the two pictures
 * beside the open one into it in its background slot, so a step lands on a
 * decode already made. A warm and the stage asking for the same picture
 * share ONE decode. A RAW developed from its sensor keeps its own cache
 * (`raw/decoded-cache.ts`); a clip is a video element and is never held;
 * a phone lets everything free go when the tab is hidden, as the RAW cache
 * does. Session-only, never persisted (`local-first.md`).
 */

import { deviceClass } from '../lib/device-class';
import { makeBorrowedCache } from '../media/borrowed-cache';
import { decodeStill, stageBudget } from '../media/still-decode';
import { stageHoldFor, type PixelSize } from '../media/still-fit';
import { fileKey } from '../raw/decoded-cache';
import { undecodableMessage, type BadgeSource } from '../roadtrip/badge-render';
import { enqueueRollDecode } from './roll-thumb';

interface StageStill {
  bitmap: ImageBitmap;
  natural: PixelSize;
}

const stills = makeBorrowedCache<StageStill>({
  ceiling: () => stageHoldFor(deviceClass()),
  dispose: (s) => s.bitmap.close(),
});
/** One decode per key at a time: a warm and the stage asking for the same picture share it. */
const inFlight = new Map<string, Promise<StageStill>>();
/** The warms waiting for the background slot, so a second ask does not queue twice. */
const warming = new Set<string>();

/** The identity a still is held under: the file's, and the budget it was decoded to. */
export function stageStillKey(file: File, budget: number = stageBudget()): string {
  return `${fileKey(file)}@${budget}`;
}

const bytesOf = (s: StageStill) => s.bitmap.width * s.bitmap.height * 4;

function decodeOnce(file: File, key: string, budget: number): Promise<StageStill> {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const job = decodeStill(file, { budgetPixels: budget })
    .then(({ bitmap, natural }) => ({ bitmap, natural }))
    .finally(() => {
      inFlight.delete(key);
    });
  inFlight.set(key, job);
  return job;
}

function asSource(still: StageStill, release: () => void): BadgeSource {
  const { bitmap, natural } = still;
  return {
    image: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    ...(natural.width !== bitmap.width || natural.height !== bitmap.height ? { natural } : {}),
    release,
  };
}

/**
 * The still decoded at the stage's budget — held already, or decoded into
 * the cache now. Its `release` hands it back and never closes it: the cache
 * does, once nobody holds it and the room is needed.
 */
export async function openStageStill(file: File): Promise<BadgeSource> {
  const budget = stageBudget();
  const key = stageStillKey(file, budget);
  const held = stills.borrow(key);
  if (held) return asSource(held.value, held.release);
  let still: StageStill;
  try {
    still = await decodeOnce(file, key, budget);
  } catch {
    throw new Error(undecodableMessage(file));
  }
  const given = stills.give(key, still, bytesOf(still));
  return asSource(given.value, given.release);
}

/**
 * Decode `file` for the stage AHEAD of its opening, in the roll's background
 * slot — nothing where it is held, decoding or waiting already, and nothing
 * said on a failure: the stage will say it when the picture opens.
 */
export function warmStageStill(file: File): void {
  const budget = stageBudget();
  const key = stageStillKey(file, budget);
  if (stills.has(key) || inFlight.has(key) || warming.has(key)) return;
  warming.add(key);
  void enqueueRollDecode(async () => {
    // Opened in the meantime: the stage decoded it itself.
    if (stills.has(key) || inFlight.has(key)) return;
    const still = await decodeOnce(file, key, budget);
    stills.keep(key, still, bytesOf(still));
  })
    .catch(() => {})
    .finally(() => warming.delete(key));
}

/** What is held right now — for a bench or a spec to read. */
export function stageStillsForTest(): { keys: string[]; bytes: number } {
  return { keys: stills.keys(), bytes: stills.size() };
}

// A phone's tab is reclaimed in the background by its memory: the free
// decodes go the moment it is hidden (the RAW cache's rule, `device-memory.md`);
// the one on the stage is doomed and survives until the stage lets it go.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && deviceClass() === 'constrained') stills.clear();
  });
}
