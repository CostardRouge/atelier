/**
 * How much COLOUR a JPEG keeps, read from its frame header (2026-10-06).
 *
 * A JPEG stores brightness at every pixel and may store colour at a fraction
 * of them: `4:4:4` keeps a colour per pixel, `4:2:2` one for two across,
 * `4:2:0` one for a block of four. The encoder decides, and a browser's
 * `canvas.toBlob` offers no choice — Chrome writes `4:2:0` under quality 1
 * and `4:4:4` at 1, measured. That halved colour is what draws blocks along a
 * saturated edge and in a smooth sky, so the export SAYS which one a target
 * gets, measured on the browser in hand (`browser-jpeg.ts`) rather than
 * assumed from Chrome.
 *
 * Pure and DOM-free: the bytes in, the sampling out.
 */

export type JpegChroma = '4:4:4' | '4:2:2' | '4:2:0' | '4:4:0' | '4:1:1' | 'grey' | 'other';

/** A start-of-frame marker: every `FFCn` but the Huffman table (C4), the arithmetic extension (C8) and its table (CC). */
function isFrameMarker(m: number): boolean {
  return m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;
}

/**
 * The colour sampling of a JPEG, or null when the bytes hold no frame header
 * (not a JPEG, or one cut short). Read against the FIRST component's factors,
 * which is the brightness in every file a camera or a browser writes.
 */
export function jpegChroma(bytes: Uint8Array): JpegChroma | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let i = 2;
  while (i + 4 <= bytes.length) {
    if (bytes[i] !== 0xff) return null;
    const marker = bytes[i + 1];
    // Fill bytes, then markers that carry no length.
    if (marker === 0xff) {
      i += 1;
      continue;
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    // The entropy-coded data starts after the scan header: no frame header came before it.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    if (length < 2) return null;
    if (isFrameMarker(marker)) {
      const at = i + 4;
      if (at + 6 > bytes.length) return null;
      const count = bytes[at + 5];
      if (count === 1) return 'grey';
      if (count < 3 || at + 6 + count * 3 > bytes.length) return 'other';
      const factors = (k: number) => {
        const f = bytes[at + 6 + k * 3 + 1];
        return { h: f >> 4, v: f & 0x0f };
      };
      const luma = factors(0);
      const cb = factors(1);
      const cr = factors(2);
      if (cb.h !== cr.h || cb.v !== cr.v || cb.h === 0 || cb.v === 0) return 'other';
      const across = luma.h / cb.h;
      const down = luma.v / cb.v;
      if (across === 1 && down === 1) return '4:4:4';
      if (across === 2 && down === 1) return '4:2:2';
      if (across === 2 && down === 2) return '4:2:0';
      if (across === 1 && down === 2) return '4:4:0';
      if (across === 4 && down === 1) return '4:1:1';
      return 'other';
    }
    i += 2 + length;
  }
  return null;
}

/** `full colour` · `half the colour` · `a quarter of the colour` — what a sampling keeps, in words. */
export function chromaWords(chroma: JpegChroma): string {
  switch (chroma) {
    case '4:4:4':
      return 'full colour';
    case '4:2:2':
    case '4:4:0':
      return 'half the colour';
    case '4:2:0':
    case '4:1:1':
      return 'a quarter of the colour';
    case 'grey':
      return 'no colour';
    default:
      return 'unusual colour sampling';
  }
}
