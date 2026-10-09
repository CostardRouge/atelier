import type { ImageResult } from './registry';

/** Base64 of some bytes, in chunks: a spread of a whole JPEG overflows the call stack. */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** A JPEG or PNG blob as a command's picture answer (`ImageResult`). */
export async function imageResult(blob: Blob, width: number, height: number, note?: string): Promise<ImageResult> {
  const mimeType = blob.type === 'image/png' ? 'image/png' : 'image/jpeg';
  return {
    kind: 'image',
    mimeType,
    data: bytesToBase64(new Uint8Array(await blob.arrayBuffer())),
    width,
    height,
    ...(note ? { note } : {}),
  };
}

/**
 * Resolve once `read()` has answered the SAME value for `quietMs`, or after
 * `capMs` whatever it answers. What a command that LOOKS at the screen waits
 * for after one that wrote: the write reaches the document at once, but the
 * stage's cube, its passes and its grader follow a render later — and a
 * callback whose identity tracks every input (`delivered`) is exactly the
 * value that stops changing when the picture has caught up.
 */
export function untilSteady(read: () => unknown, quietMs = 150, capMs = 3000, tickMs = 25): Promise<void> {
  return new Promise((resolve) => {
    const start = Date.now();
    let last = read();
    let since = start;
    const timer = setInterval(() => {
      const now = Date.now();
      const v = read();
      if (v !== last) {
        last = v;
        since = now;
      }
      if (now - since >= quietMs || now - start >= capMs) {
        clearInterval(timer);
        resolve();
      }
    }, tickMs);
  });
}
