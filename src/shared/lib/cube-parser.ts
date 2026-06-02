/**
 * Pure, dependency-free, DOM-free parser for Adobe/IRIDAS `.cube` 3D LUT files.
 *
 * A `.cube` file describes a colour look-up table: a regular grid of
 * input RGB → output RGB mappings used to grade footage (the same files
 * DaVinci Resolve / Premiere consume). This module turns that text into a
 * flat {@link CubeLut} ready to upload as a WebGL 3D texture.
 *
 * Mirrors the design of {@link ./srt-parser}: no external dependencies, never
 * touches the DOM, returns `null` on anything it can't represent rather than
 * throwing, so callers stay simple.
 *
 * Scope: 3D LUTs only (`LUT_3D_SIZE`). 1D LUTs (`LUT_1D_SIZE`) are detected and
 * rejected with `null` — a future format can plug in here without rewriting the
 * entry point, exactly like the SRT parser's `unknown` branch.
 */

export interface CubeLut {
  /** Grid size N along each axis (LUT_3D_SIZE), typically 17, 33 or 65. */
  size: number;
  /**
   * Flat RGB triplets, length `size**3 * 3`, in `.cube` table order: the red
   * index varies fastest, then green, then blue. This is also the memory order
   * a WebGL `TEXTURE_3D` expects (x fastest, then y, then z), so the array can
   * be uploaded as-is.
   */
  data: Float32Array;
  /** TITLE value if present, else undefined. */
  title?: string;
  /** Input domain lower bound (defaults to [0,0,0]). */
  domainMin: [number, number, number];
  /** Input domain upper bound (defaults to [1,1,1]). */
  domainMax: [number, number, number];
}

/** Matches `KEYWORD` at the start of a (trimmed) line. */
const TITLE_RE = /^TITLE\s+"?(.*?)"?\s*$/;
const SIZE_3D_RE = /^LUT_3D_SIZE\s+(\d+)/;
const SIZE_1D_RE = /^LUT_1D_SIZE\s+(\d+)/;
const DOMAIN_MIN_RE = /^DOMAIN_MIN\s+(\S+)\s+(\S+)\s+(\S+)/;
const DOMAIN_MAX_RE = /^DOMAIN_MAX\s+(\S+)\s+(\S+)\s+(\S+)/;
/** A data row: three floats (optionally signed / scientific). */
const TRIPLET_RE = /^(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s+(-?[\d.eE+-]+)\s*$/;

/**
 * Parse the contents of a `.cube` file into a {@link CubeLut}.
 *
 * @param text Raw file contents.
 * @returns The parsed LUT, or `null` if the file is not a usable 3D LUT
 *   (unsupported 1D LUT, missing/invalid size, or a row count that doesn't
 *   match `size**3`).
 */
export function parseCube(text: string): CubeLut | null {
  const lines = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  let size = 0;
  let title: string | undefined;
  let domainMin: [number, number, number] = [0, 0, 0];
  let domainMax: [number, number, number] = [1, 1, 1];
  let data: Float32Array | null = null;
  let writeIndex = 0;

  for (const raw of lines) {
    const line = raw.trim();
    // Skip blanks and comments.
    if (line === '' || line.startsWith('#')) continue;

    // A leading digit / sign means a data row; everything else is a keyword.
    const firstChar = line[0];
    const looksNumeric = firstChar === '-' || firstChar === '.' || (firstChar >= '0' && firstChar <= '9');

    if (!looksNumeric) {
      const titleMatch = line.match(TITLE_RE);
      if (titleMatch) {
        title = titleMatch[1];
        continue;
      }
      if (SIZE_1D_RE.test(line)) {
        // 1D LUTs are out of scope; bail rather than silently mis-parse.
        return null;
      }
      const sizeMatch = line.match(SIZE_3D_RE);
      if (sizeMatch) {
        size = Number(sizeMatch[1]);
        continue;
      }
      const minMatch = line.match(DOMAIN_MIN_RE);
      if (minMatch) {
        domainMin = [Number(minMatch[1]), Number(minMatch[2]), Number(minMatch[3])];
        continue;
      }
      const maxMatch = line.match(DOMAIN_MAX_RE);
      if (maxMatch) {
        domainMax = [Number(maxMatch[1]), Number(maxMatch[2]), Number(maxMatch[3])];
        continue;
      }
      // Unknown keyword — ignore, tolerant to vendor extensions.
      continue;
    }

    // Data row. We must have seen LUT_3D_SIZE first.
    if (size <= 0) return null;
    if (!data) data = new Float32Array(size * size * size * 3);

    const triplet = line.match(TRIPLET_RE);
    if (!triplet) continue;

    // Guard against files declaring more rows than size**3.
    if (writeIndex + 3 > data.length) return null;

    data[writeIndex++] = Number(triplet[1]);
    data[writeIndex++] = Number(triplet[2]);
    data[writeIndex++] = Number(triplet[3]);
  }

  if (!data || size <= 0) return null;
  // Reject truncated tables: the row count must match the declared size.
  if (writeIndex !== data.length) return null;

  return { size, data, title, domainMin, domainMax };
}
