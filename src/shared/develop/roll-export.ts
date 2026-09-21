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
import { borderLayout, scaleLayout, type BorderLayout, type RollBorder } from './border-layout';
import type { RollExport, RollOriginals } from './roll-types';

export interface PictureSize {
  width: number;
  height: number;
}

/**
 * The picture in hand as the delivery knows it: its pixels, and whether they
 * are the render a camera wrote inside a RAW (`MeasuredPicture`). The label on
 * the *Delivers* row turns on that flag — `File 8064 px` over a DNG whose only
 * decodable half is 960 × 540 is the one sentence the plan must never say.
 */
export type DeliverySource = PictureSize & { viaRawPreview?: boolean };

/** What the *Delivers* row calls the pixels it is measuring. */
export function sourceLabel(fileIsProxy: boolean, source: DeliverySource): string {
  if (fileIsProxy) return 'Proxy';
  return source.viaRawPreview ? 'Camera render' : 'File';
}

/** What a source says about the picture's original, when the file in hand is a proxy. */
export interface OriginalInfo {
  width: number | null;
  height: number | null;
  /** The original's file name, for its extension. */
  name: string | null;
  bytes: number | null;
  /**
   * For a RAW: the size of the RENDER inside it — all a browser ever decodes
   * of one — read from its head (`rawSizesFrom`), never assumed.
   *
   * `width`/`height` above are the SENSOR's, which is what the source
   * recorded and what no delivery here can reach: 8064 × 4536 on the
   * maintainer's DJI against a 960 × 540 render. Absent means the head has
   * not been read, and nothing is decided on a guess.
   */
  render?: PictureSize | null;
}

/**
 * The pixels an original can really hand a delivery. For a RAW that is the
 * render inside it and nothing else — null until its head says how big that
 * render is, because "a RAW may carry a full-size render" (F5 of
 * `docs/develop-originals.md`) turned out to be false for the one camera we
 * have measured, and a 74 MB fetch for 0.52 megapixels is the mistake this
 * refusal exists to prevent.
 */
export function originalPixels(original: OriginalInfo): PictureSize | null {
  if (isRawImage(original.name ?? '')) return original.render ?? null;
  return original.width && original.height ? { width: original.width, height: original.height } : null;
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
 * The crop's own size in the source's pixels — the zone the crop stage drew
 * (`crop-rect.ts`), read through the renderer's transform so a clamped pan or
 * a turned picture gives what will really be cut. A legacy Whole framing
 * (`contain`) has no zone: its "crop" is the aspect box it letterboxes into,
 * as it always was.
 */
export function cropZoneSize(
  src: PictureSize,
  aspectRatio: number,
  framing: Framing | null,
): { w: number; h: number } {
  const box = rollOutputSize(src, aspectRatio, null);
  if (!framing || framing.fit === 'contain' || box.w <= 0) return box;
  const t = framingTransform(src.width, src.height, box.w, box.h, framing);
  return t.scale > 0 ? { w: box.w / t.scale, h: box.h / t.scale } : box;
}

/** What a picture delivers: the canvas (capped), where the crop sits in it, and the crop's own size. */
export interface DeliveredLayout {
  out: { w: number; h: number };
  /** The canvas and the crop's rectangle, in OUTPUT pixels (unrounded). */
  layout: BorderLayout;
  /** The crop in the source's pixels. */
  zone: { w: number; h: number };
}

/**
 * The file a picture becomes: its crop at the source's OWN density (a zone of
 * 1200 px on a 6000 px picture is 1200 px, never blown up to the aspect box),
 * inside its border, capped to the roll's long edge — never upscaled.
 */
export function deliveredLayout(
  src: PictureSize,
  aspectRatio: number,
  framing: Framing | null,
  border: RollBorder | null,
  longEdge: number | null,
): DeliveredLayout {
  const zone = cropZoneSize(src, aspectRatio, framing);
  const full = borderLayout(zone.w, zone.h, border);
  const long = Math.max(full.w, full.h);
  if (!(long > 0)) return { out: { w: 0, h: 0 }, layout: full, zone };
  const k = longEdge !== null && longEdge > 0 ? Math.min(1, longEdge / long) : 1;
  const out = { w: Math.max(1, Math.round(full.w * k)), h: Math.max(1, Math.round(full.h * k)) };
  // Scaled onto the ROUNDED canvas, so the rectangle and the file agree.
  const layout = scaleLayout(full, out.w / full.w);
  return { out, layout, zone };
}

/** Source pixels per output pixel for this delivery — 1 exact, below 1 upscaled. */
export function deliveryHeadroom(src: PictureSize, aspectRatio: number, framing: Framing | null, d: DeliveredLayout): number {
  if (framing?.fit === 'contain') return pixelHeadroom(src, framing, { w: d.layout.pw, h: d.layout.ph });
  const zone = cropZoneSize(src, aspectRatio, framing);
  return d.layout.pw > 0 ? zone.w / d.layout.pw : 0;
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
 * there is one the browser decodes. A file that IS the original has nothing
 * to choose.
 *
 * **A RAW original is the case decision 4 got half right** (2026-09-20). It
 * said a RAW never checked in Develop is delivered "from its render —
 * full-size embedded preview, else the proxy", which assumes the embedded
 * render wins. On the maintainer's own DJI it loses, badly: 960 × 540 against
 * a 2048 px proxy. So the rule here is the LARGER of the two, measured and
 * named — and where the render's size has not been read, the proxy delivers,
 * because a proxy is built FROM that render and fetching the file again to
 * find out would cost tens of megabytes for pixels that may not be there.
 */
export function choosePixels(
  mode: RollOriginals,
  fileHeadroom: number,
  original: OriginalInfo | null,
  /** The file in hand, so a RAW's render can be measured against it. */
  file: PictureSize | null = null,
): PixelsChoice {
  if (!original) return { from: 'file', reason: null };
  if (isRawImage(original.name ?? '')) return chooseAgainstRaw(mode, fileHeadroom, original, file);
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

function chooseAgainstRaw(
  mode: RollOriginals,
  fileHeadroom: number,
  original: OriginalInfo,
  file: PictureSize | null,
): PixelsChoice {
  const render = originalPixels(original);
  if (!render) {
    return {
      from: 'file',
      reason:
        'its original is a RAW: only the render inside it is decodable, and this proxy was built from that render — its size is read from the file’s head at export, and the larger of the two delivers',
    };
  }
  const fileLong = file ? Math.max(file.width, file.height) : 0;
  const rawLong = Math.max(render.width, render.height);
  if (rawLong <= fileLong * 1.005) {
    return {
      from: 'file',
      reason: `its original is a RAW whose own render is ${rawLong} px against the proxy’s ${fileLong} — the proxy is what leaves`,
    };
  }
  if (mode === 'proxies') return { from: 'file', reason: 'proxies only' };
  if (mode === 'auto' && fileHeadroom >= 1) {
    return {
      from: 'file',
      reason: `the proxy has the pixels this frame needs — the ${rawLong} px render inside its RAW would buy nothing here`,
    };
  }
  return {
    from: 'original',
    reason: `its original is a RAW, and the ${rawLong} px render inside it is larger than the ${fileLong} px proxy`,
  };
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
  /** The crop's own long edge in the source — say it when a border makes the file larger than the crop. */
  cropLong: number | null = null,
): string {
  const outLong = Math.max(out.w, out.h);
  const srcLong = cropLong !== null ? Math.round(cropLong) : Math.round(outLong * headroom);
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
  file: DeliverySource,
  fileIsProxy: boolean,
  original: OriginalInfo | null,
  framing: Framing | null,
  aspectRatio: number,
  border: RollBorder | null,
  settings: Pick<RollExport, 'longEdge' | 'originals'>,
): DeliverySummary {
  // What the original could really hand over — for a RAW, the render inside
  // it, and only once its head has said how big that render is.
  const known = fileIsProxy && original ? originalPixels(original) : null;
  const best = known ?? file;
  const asked = deliveredLayout(best, aspectRatio, framing, border, settings.longEdge);
  const bordered = border !== null;
  const fileHeadroom = deliveryHeadroom(file, aspectRatio, framing, asked);
  const choice = choosePixels(settings.originals, fileHeadroom, fileIsProxy ? original : null, file);
  if (choice.from === 'original' && known) {
    const headroom = deliveryHeadroom(best, aspectRatio, framing, asked);
    // A RAW's original is reached only through the render inside it, and the
    // row says so rather than letting `Original` suggest the sensor.
    const label = isRawImage(original?.name ?? '') ? 'Original render' : 'Original';
    return {
      from: 'original',
      out: asked.out,
      headroom,
      line: deliversLine(label, asked.out, headroom, null, bordered ? Math.max(asked.zone.w, asked.zone.h) : null),
      reason: choice.reason,
    };
  }
  const own = deliveredLayout(file, aspectRatio, framing, border, settings.longEdge);
  const headroom = deliveryHeadroom(file, aspectRatio, framing, own);
  const label = sourceLabel(fileIsProxy, file);
  return {
    from: choice.from,
    out: own.out,
    headroom,
    line: deliversLine(
      label,
      own.out,
      headroom,
      Math.max(asked.out.w, asked.out.h),
      bordered ? Math.max(own.zone.w, own.zone.h) : null,
    ),
    reason: choice.from === 'original' ? 'the original will be measured once fetched' : choice.reason,
  };
}

/**
 * The same decision where the output frame is FIXED rather than capped —
 * Trips' deck (1920 on the long edge, whatever the picture gives) and a
 * Studio variant, both of which will upscale rather than deliver less.
 *
 * The roll's own `deliverySummary` cannot answer for them: its long edge is a
 * cap, so a proxy's frame is always "exact" there and the upscale question
 * is asked against what the original could give. Here the frame is the
 * frame, so the question is simply whether the pixels in hand fill it —
 * which is what `pixelHeadroom` has always answered (F3 of
 * `docs/develop-originals.md`: a landscape proxy cropped to 4:5 at a 1920
 * export is ×1.25 upscaled). Everything else — which pixels, why, and the
 * sentence — is the roll's, shared rather than written a second time.
 */
export function fixedFrameDelivery(
  file: DeliverySource,
  fileIsProxy: boolean,
  original: OriginalInfo | null,
  framing: Framing | null,
  out: { w: number; h: number },
  mode: RollOriginals,
): DeliverySummary {
  const fileHeadroom = pixelHeadroom(file, framing, out);
  const choice = choosePixels(mode, fileHeadroom, fileIsProxy ? original : null, file);
  const best = fileIsProxy && original ? originalPixels(original) : null;
  if (choice.from === 'original' && best) {
    const headroom = pixelHeadroom(best, framing, out);
    const label = isRawImage(original?.name ?? '') ? 'Original render' : 'Original';
    return { from: 'original', out, headroom, line: deliversLine(label, out, headroom), reason: choice.reason };
  }
  return {
    from: 'file',
    out,
    headroom: fileHeadroom,
    line: deliversLine(sourceLabel(fileIsProxy, file), out, fileHeadroom),
    reason: choice.from === 'original' ? 'the original will be measured once fetched' : choice.reason,
  };
}

/**
 * `DJI_0101.JPG` → `DJI_0101.jpg`: EXACTLY the picture's own name, with the
 * extension a JPEG deserves (2026-09-20, the maintainer's convention — his
 * Gallery holds the developed file under the capture's name, which is what
 * pairs his two folders by eye and what Winnow's `reconcile` pairs on).
 *
 * Nothing is added — no `-developed`, no shape tag: an added word breaks that
 * pairing. Two deliveries that then want one name are numbered where they
 * meet, by `shared/sources/unique-name.ts`: inside a run, and against the
 * folder being written into.
 */
export function exportName(refName: string): string {
  const base = refName.replace(/\.[^.]+$/, '') || 'picture';
  return `${base}.jpg`;
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

/**
 * The run's outcome in one sentence: what was written, what was numbered
 * around a file already there, and what could not be written at all.
 */
export function describeRun(
  written: number,
  method: 'folder' | 'download',
  failures: readonly string[],
  renamed = 0,
): string {
  const head =
    written === 0
      ? 'Nothing was written'
      : `${written} picture${written === 1 ? '' : 's'} ${method === 'folder' ? 'written' : 'downloaded'}`;
  const kept =
    renamed > 0
      ? ` · ${renamed} numbered, the folder already held ${renamed === 1 ? 'that name' : 'those names'}`
      : '';
  return failures.length
    ? `${head}${kept} — ${failures[0]}${failures.length > 1 ? ` (+${failures.length - 1} more)` : ''}`
    : `${head}${kept}`;
}
