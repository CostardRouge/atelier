/**
 * What a roll DELIVERS, decided before a pixel is read (D9 of
 * `docs/develop-tool.md`, O1 + O2 of `docs/develop-originals.md`): the frame a
 * picture exports into, whether that frame upscales the file in hand, whether
 * the original is worth fetching for it, the sentence that says so, and the
 * file's name. Pure and DOM-free; `roll-render.ts` does the drawing.
 *
 * Two axes, kept apart as decided there: the PIXELS (the Library's file — a
 * Winnow proxy or the file itself — against the full-size original) are chosen
 * here per picture; the MATERIAL (an 8-bit render against a RAW) is not chosen
 * at export at all — a RAW original is never fetched, and the picture is
 * delivered from the render the person looked at (decision 4).
 */

import { isRawImage } from '../library/assets';
import { DEFAULT_FRAMING, framingTransform, type Framing } from '../media/framing';
import type { RollExport, RollOriginals } from './roll-types';

export interface PictureSize {
  width: number;
  height: number;
}

/** What a source says about the picture's original, when the file in hand is a proxy. */
export interface OriginalInfo {
  width: number | null;
  height: number | null;
  /** The original's file name, for its extension. */
  name: string | null;
  bytes: number | null;
}

/**
 * The frame a picture delivers into: the box of `aspectRatio` the source
 * covers at its own density (an `'original'` aspect is the source itself),
 * capped to the roll's long edge — never upscaled, so a small file asked for
 * 4096 delivers what it has.
 */
export function rollOutputSize(
  src: PictureSize,
  aspectRatio: number,
  longEdge: number | null,
): { w: number; h: number } {
  if (src.width <= 0 || src.height <= 0) return { w: 0, h: 0 };
  const ratio = aspectRatio > 0 ? aspectRatio : src.width / src.height;
  let w = src.width;
  let h = src.width / ratio;
  if (h > src.height) {
    h = src.height;
    w = src.height * ratio;
  }
  const long = Math.max(w, h);
  const cap = longEdge !== null && longEdge > 0 ? Math.min(longEdge, long) : long;
  const k = cap / long;
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}

/**
 * Source pixels per output pixel across the frame under this crop: 1 is
 * exact, below 1 the export UPSCALES (a landscape proxy cropped to 4:5 at a
 * 1920 long edge is 0.8 — F3 of `develop-originals.md`), above 1 there is
 * detail to spare. Zoom and rotation both eat into it, exactly as the
 * transform that will draw it says.
 */
export function pixelHeadroom(src: PictureSize, framing: Framing | null, out: { w: number; h: number }): number {
  const t = framingTransform(src.width, src.height, out.w, out.h, framing ?? DEFAULT_FRAMING);
  return t.scale > 0 ? 1 / t.scale : 0;
}

/** The formats the browser decodes on its own; a RAW, HEIC or TIFF original is delivered from its render. */
const DECODABLE = new Set(['jpg', 'jpeg', 'png', 'webp', 'avif', 'gif', 'bmp']);

export function decodableOriginal(name: string | null): boolean {
  if (!name || isRawImage(name)) return false;
  const dot = name.lastIndexOf('.');
  return dot >= 0 && DECODABLE.has(name.slice(dot + 1).toLowerCase());
}

export type PixelsFrom = 'file' | 'original';

export interface PixelsChoice {
  from: PixelsFrom;
  /** Why, in the words the panel says; null when there was nothing to decide. */
  reason: string | null;
}

/**
 * Which pixels a picture is delivered from. `Auto` fetches the original only
 * where the file in hand would upscale; `Proxies` never; `Originals` whenever
 * there is one the browser decodes. A file that IS the original, or whose
 * original is a RAW (decision 4), has nothing to choose.
 */
export function choosePixels(
  mode: RollOriginals,
  fileHeadroom: number,
  original: OriginalInfo | null,
): PixelsChoice {
  if (!original) return { from: 'file', reason: null };
  if (!decodableOriginal(original.name)) {
    return {
      from: 'file',
      reason: `its original is ${original.name ? labelOf(original.name) : 'a format this browser does not decode'} — delivered from the render you developed`,
    };
  }
  if (mode === 'proxies') return { from: 'file', reason: 'proxies only' };
  if (mode === 'originals') return { from: 'original', reason: 'originals asked for' };
  return fileHeadroom < 1
    ? { from: 'original', reason: `the proxy would be upscaled ×${(1 / fileHeadroom).toFixed(2)}` }
    : { from: 'file', reason: 'the proxy has the pixels this frame needs' };
}

function labelOf(name: string): string {
  if (isRawImage(name)) return 'a RAW';
  const dot = name.lastIndexOf('.');
  const ext = dot >= 0 ? name.slice(dot + 1).toUpperCase() : '';
  return ext ? `a ${ext}` : 'a format this browser does not decode';
}

/**
 * `Proxy 1536 px → 1920 · ×1.25 upscaled` — the calculator in one sentence.
 * `askedLong` is the long edge the export WANTED when the frame fell short
 * of it (a proxy delivering 1536 where 1920 was asked), said as such.
 */
export function deliversLine(
  label: string,
  out: { w: number; h: number },
  headroom: number,
  askedLong: number | null = null,
): string {
  const outLong = Math.max(out.w, out.h);
  const srcLong = Math.round(outLong * headroom);
  const verdict =
    headroom <= 0
      ? 'nothing to draw'
      : headroom < 0.995
        ? `×${(1 / headroom).toFixed(2)} upscaled`
        : headroom < 1.005
          ? 'exact'
          : `×${headroom.toFixed(2)} to spare`;
  const short = askedLong !== null && askedLong > outLong ? ` · asked ${askedLong}` : '';
  return `${label} ${srcLong} px → ${outLong} · ${verdict}${short}`;
}

export interface DeliverySummary {
  from: PixelsFrom;
  /** The frame the export will write. */
  out: { w: number; h: number };
  headroom: number;
  line: string;
  /** Why these pixels, or null when there was nothing to decide. */
  reason: string | null;
}

/**
 * Everything the Export tab says about ONE picture, and everything the
 * renderer needs to know before fetching: the frame, from which pixels, and
 * the sentence. `fileIsProxy` says whether the file in hand is a source's
 * editing rendition (its original is then `original`).
 *
 * The long edge is a CAP that never upscales, so the frame a proxy can give
 * on its own is always exact — the upscale question is asked against the
 * frame the ORIGINAL could give, which is what the person asked for: a proxy
 * that cannot fill it is what `Auto` fetches the original for. Without one,
 * the file delivers what it has and the line says what was asked.
 */
export function deliverySummary(
  file: PictureSize,
  fileIsProxy: boolean,
  original: OriginalInfo | null,
  framing: Framing | null,
  aspectRatio: number,
  settings: Pick<RollExport, 'longEdge' | 'originals'>,
): DeliverySummary {
  const known = fileIsProxy && original && original.width && original.height ? original : null;
  const best = known ? { width: known.width!, height: known.height! } : file;
  const asked = rollOutputSize(best, aspectRatio, settings.longEdge);
  const fileHeadroom = pixelHeadroom(file, framing, asked);
  const choice = choosePixels(settings.originals, fileHeadroom, fileIsProxy ? original : null);
  if (choice.from === 'original' && known) {
    const headroom = pixelHeadroom(best, framing, asked);
    return { from: 'original', out: asked, headroom, line: deliversLine('Original', asked, headroom), reason: choice.reason };
  }
  const out = rollOutputSize(file, aspectRatio, settings.longEdge);
  const headroom = pixelHeadroom(file, framing, out);
  const label = fileIsProxy ? 'Proxy' : 'File';
  return {
    from: choice.from,
    out,
    headroom,
    line: deliversLine(label, out, headroom, Math.max(asked.w, asked.h)),
    reason: choice.from === 'original' ? 'the original will be measured once fetched' : choice.reason,
  };
}

/** `IMG_0421.jpg` + `4:5` → `IMG_0421-developed-4x5.jpg`; never the source's own name. */
export function exportName(refName: string, aspect: string): string {
  const base = refName.replace(/\.[^.]+$/, '') || 'picture';
  const shape = aspect !== 'original' ? `-${aspect.replace(':', 'x')}` : '';
  return `${base}-developed${shape}.jpg`;
}

/** The choices the Size select offers: the source's own, or a long edge. */
export const LONG_EDGE_CHOICES: readonly { id: string; label: string; longEdge: number | null }[] = [
  { id: 'source', label: 'Source size', longEdge: null },
  { id: '4096', label: '4096 px', longEdge: 4096 },
  { id: '2560', label: '2560 px', longEdge: 2560 },
  { id: '2048', label: '2048 px', longEdge: 2048 },
  { id: '1920', label: '1920 px', longEdge: 1920 },
  { id: '1080', label: '1080 px', longEdge: 1080 },
];

export function longEdgeChoiceId(longEdge: number | null): string {
  return LONG_EDGE_CHOICES.find((c) => c.longEdge === longEdge)?.id ?? 'source';
}

/** The run's outcome in one sentence: what was written, what could not be. */
export function describeRun(written: number, method: 'folder' | 'download', failures: readonly string[]): string {
  const head =
    written === 0
      ? 'Nothing was written'
      : `${written} picture${written === 1 ? '' : 's'} ${method === 'folder' ? 'written' : 'downloaded'}`;
  return failures.length ? `${head} — ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}` : head;
}
