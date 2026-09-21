/**
 * What the Develop workbench KNOWS about the files of the picture it holds,
 * turned into the input `media/renditions.ts` lists from.
 *
 * The workbench holds one `File` and a few facts gathered around it — where a
 * source says it came from (`MediaOrigin`), what its pixels measured, the
 * sensor plane a RAW's head stated, whether the proxy's original is already
 * held for the session, and the capture's other files a folder listed beside
 * it (`AssetParts.siblings`). None of that is a rendition yet; this is the
 * one place those facts become `CaptureFile`s, so the list is built the same
 * way on every render and can be tested without a browser.
 *
 * Pure and DOM-free. Nothing here fetches, probes or decodes: a fact that has
 * not been measured is passed as "not measured", never guessed.
 */

import { isRawImage } from '../library/assets';
import type { CaptureFile, CaptureInput, PixelSize } from '../media/renditions';
import type { MediaOrigin } from '../projects/media-identity';

/** What has been read of a sibling file's head — nothing is listed before this is known. */
export interface SiblingFacts {
  /** Its `Software` tag, or null when it carries none (`exif/software-mark.ts`). */
  software: string | null;
  /** For a RAW: the render inside it and its sensor plane, as `rawSizes` read them. */
  render?: PixelSize | null;
  sensor?: PixelSize | null;
  /** For a drawable file: its own pixels, where something measured them. */
  pixels?: PixelSize | null;
}

export interface CaptureFacts {
  /** The file in hand. */
  file: File;
  /** Where a source says it came from; null for a file opened from a disk. */
  origin: MediaOrigin | null;
  /** The pixels the stage measured of `file` — the file's own, or the render inside a RAW. */
  measured: (PixelSize & { viaRawPreview?: boolean }) | null;
  /** A RAW in hand: its sensor plane, read from its head. */
  sensor: PixelSize | null;
  /** The proxy's original: its asset id, whether it is held already, and — for a RAW — its render's size once read. */
  original?: {
    assetId: string | null;
    held: boolean;
    /** `undefined` is "not read yet", `null` is "read, and it carries none". */
    render?: PixelSize | null;
  };
  /** The capture's other files a folder listed beside `file`, once their heads were read. */
  siblings?: readonly { file: File; facts: SiblingFacts }[];
  canDraw?: (name: string) => boolean;
}

function size(width: number | null | undefined, height: number | null | undefined): PixelSize | null {
  return width && height && width > 0 && height > 0 ? { width, height } : null;
}

/** The list `renditionsOf` reads, from what the workbench has in hand. */
export function captureInput(facts: CaptureFacts): CaptureInput {
  const { file, origin, measured } = facts;
  const openIsProxy = origin?.fidelity === 'proxy';
  const open: CaptureFile = isRawImage(file.name)
    ? {
        name: file.name,
        bytes: file.size,
        here: true,
        // Measured through the render inside it, or not measured at all —
        // never "none" from here: only a probe can say a RAW carries no render.
        ...(measured ? { render: { width: measured.width, height: measured.height } } : {}),
        ...(facts.sensor ? { sensor: facts.sensor } : {}),
      }
    : {
        name: file.name,
        bytes: file.size,
        here: true,
        pixels: measured ? { width: measured.width, height: measured.height } : null,
      };

  const others: CaptureFile[] = [];
  if (openIsProxy && origin?.name) {
    const raw = isRawImage(origin.name);
    others.push({
      name: origin.name,
      bytes: origin.bytes ?? null,
      here: facts.original?.held ?? false,
      ...(facts.original?.assetId ? { assetId: facts.original.assetId } : {}),
      // A source states the CAPTURE's pixels — the sensor's, for a RAW, which
      // says nothing about the render inside it; that one is read from the head.
      ...(raw
        ? { render: facts.original?.render, sensor: size(origin.width, origin.height) }
        : { pixels: size(origin.width, origin.height) }),
    });
  }
  for (const { file: sibling, facts: known } of facts.siblings ?? []) {
    others.push({
      name: sibling.name,
      bytes: sibling.size,
      here: true,
      software: known.software,
      ...(isRawImage(sibling.name)
        ? { render: known.render, sensor: known.sensor ?? null }
        : { pixels: known.pixels ?? null }),
    });
  }
  return {
    open,
    openIsProxy,
    others,
    ...(facts.canDraw ? { canDraw: facts.canDraw } : {}),
  };
}
