import { useEffect, useState } from 'react';
import { jpegChroma, type JpegChroma } from './jpeg-chroma';

/**
 * What THIS browser's JPEG encoder keeps of the colour at a quality —
 * MEASURED, by encoding a 16 × 16 canvas and reading the file's own header
 * (`jpeg-chroma.ts`), never assumed from one browser (2026-10-06).
 *
 * Chrome writes `4:2:0` under quality 1 and `4:4:4` at 1; Safari's encoder
 * is another one and has not been measured here. Each answer is a few
 * hundred bytes of work, kept for the session.
 */

const measured = new Map<number, Promise<JpegChroma | null>>();

/** Qualities are read on the export's own grid, a hundredth. */
function step(quality: number): number {
  return Math.round(Math.min(1, Math.max(0, quality)) * 100) / 100;
}

function encode(quality: number): Promise<JpegChroma | null> {
  if (typeof document === 'undefined') return Promise.resolve(null);
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext('2d');
  if (!ctx) return Promise.resolve(null);
  // Colour on purpose: an encoder may write a grey picture without its colour planes.
  const g = ctx.createLinearGradient(0, 0, 16, 16);
  g.addColorStop(0, '#d23c1e');
  g.addColorStop(1, '#1e64d2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 16, 16);
  return new Promise((resolve) =>
    canvas.toBlob(
      (blob) => {
        if (!blob) return resolve(null);
        blob.arrayBuffer().then(
          (buf) => resolve(jpegChroma(new Uint8Array(buf))),
          () => resolve(null),
        );
      },
      'image/jpeg',
      quality,
    ),
  );
}

/** The sampling this browser writes at a quality, or null where it cannot be told. */
export function browserChroma(quality: number): Promise<JpegChroma | null> {
  const q = step(quality);
  let answer = measured.get(q);
  if (!answer) {
    answer = encode(q);
    measured.set(q, answer);
  }
  return answer;
}

/**
 * The lowest quality, on the hundredth grid from 0.5, at which this browser
 * writes FULL colour — 1 in Chrome — or null when it never does. A search
 * over a monotone answer: seven encodes at most.
 */
export async function fullColourFrom(): Promise<number | null> {
  if ((await browserChroma(1)) !== '4:4:4') return null;
  let lo = 50;
  let hi = 100;
  if ((await browserChroma(lo / 100)) === '4:4:4') return lo / 100;
  // Invariant: lo is not full colour, hi is.
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if ((await browserChroma(mid / 100)) === '4:4:4') hi = mid;
    else lo = mid;
  }
  return hi / 100;
}

/** The sampling a quality gets on this browser, as a React value — null until measured. */
export function useBrowserChroma(quality: number): JpegChroma | null {
  const q = step(quality);
  const [state, setState] = useState<{ q: number; chroma: JpegChroma | null } | null>(null);
  useEffect(() => {
    let live = true;
    void browserChroma(q).then((chroma) => {
      if (live) setState({ q, chroma });
    });
    return () => {
      live = false;
    };
  }, [q]);
  return state?.q === q ? state.chroma : null;
}

/** Where this browser starts writing full colour — `undefined` while measuring, null for never. */
export function useFullColourFrom(): number | null | undefined {
  const [from, setFrom] = useState<number | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void fullColourFrom().then((q) => {
      if (live) setFrom(q);
    });
    return () => {
      live = false;
    };
  }, []);
  return from;
}
