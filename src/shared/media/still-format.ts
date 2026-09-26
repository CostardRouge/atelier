/**
 * Which still format a file IS, read from its first bytes — pure, tested.
 *
 * Asked only once the browser has refused a picture (`still-decode.ts`), to
 * pick the decoder this suite ships for it. By the bytes and never by the
 * name: a `.HIF` is a HEIF, a `.heic` exported by some tools is a JPEG, and a
 * file fetched from an instance may carry no extension at all.
 *
 * - **JPEG XL**: a bare codestream starts `FF 0A`; the ISO-BMFF container
 *   starts with the 12-byte `JXL ` signature box.
 * - **HEIF**: an `ftyp` box whose major or compatible brands name an HEVC
 *   image (`heic`, `heix`, `hevc`, `hevx`, `heim`, `heis`) or the generic
 *   `mif1` / `msf1`. An AVIF (`avif`, `avis`) is a HEIF too, but every
 *   browser that would reach this decodes AVIF on its own, and the HEIF
 *   decoder shipped here reads HEVC alone — so an AVIF is left to the browser.
 */

export type StillFormat = 'jxl' | 'heif';

/** Bytes a caller should read for {@link sniffStillFormat}: the `ftyp` box's brands fit in it. */
export const STILL_SNIFF_BYTES = 64;

const JXL_BOX = [0x00, 0x00, 0x00, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a];
const HEIF_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function fourcc(b: Uint8Array, at: number): string {
  return String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]);
}

/** The format the head of a file announces, or null for anything the browser is left to answer. */
export function sniffStillFormat(head: Uint8Array): StillFormat | null {
  if (head.length >= 2 && head[0] === 0xff && head[1] === 0x0a) return 'jxl';
  if (head.length >= JXL_BOX.length && JXL_BOX.every((v, i) => head[i] === v)) return 'jxl';
  if (head.length < 16 || fourcc(head, 4) !== 'ftyp') return null;
  const size = ((head[0] << 24) | (head[1] << 16) | (head[2] << 8) | head[3]) >>> 0;
  const end = Math.min(head.length, size >= 16 ? size : head.length);
  const brands = [fourcc(head, 8)];
  for (let at = 16; at + 4 <= end; at += 4) brands.push(fourcc(head, at));
  if (AVIF_BRANDS.has(brands[0])) return null;
  if (brands.some((b) => HEIF_BRANDS.has(b)) && !brands.every((b) => AVIF_BRANDS.has(b) || b === 'mif1' || b === 'miaf')) {
    return 'heif';
  }
  return null;
}
