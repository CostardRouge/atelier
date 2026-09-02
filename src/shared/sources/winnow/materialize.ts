/**
 * Turning a Winnow asset into `File`s the suite can hold.
 *
 * The pipeline is built on `File` end to end — `buildAssets`, the stage, the
 * filmstrip, WebCodecs, the exporter — and a `File` cannot be virtualised over
 * a URL. So phase 1 does the honest, simple thing: it FETCHES what it needs
 * and wraps it. Two fidelities:
 *
 * - **proxy** (the default, and what preview should always use): Winnow's
 *   culling rendition. For a video that is H.264 `yuv420p` + AAC with
 *   `moov` at the front — exactly what WebCodecs decodes, so an HEVC rush
 *   needs no ffmpeg.wasm here. For a photo it is a WebP, which is also the
 *   answer to a RAW the browser cannot decode. 720p / 2048 px: good for
 *   editing, and for a photo post it already exceeds 1080×1920.
 * - **original**: the full file, for a final render. Heavy through a tunnel;
 *   the caller shows that cost, it does not hide it.
 *
 * A DJI clip's `.srt` comes along whichever fidelity was chosen: Atelier's
 * founding case is the flight log, and Winnow serves it as a first-class
 * sidecar.
 *
 * Naming keeps the ORIGINAL base name so the library pairs the clip with its
 * sidecar exactly as it would from a folder (`DJI_0001.mp4` + `DJI_0001.SRT`),
 * and only the extension follows the rendition. The files are then vouched
 * for in the identity registry with the original's `content_hash` and Winnow
 * id — a proxy's own bytes are nobody's identity.
 *
 * Memory: a fetched `File` is memory-backed, the same trade `transcode-store`
 * already makes for an H.264 transcode. A dozen 720p clips is fine; a folder
 * of originals is the user's explicit choice.
 */

import {
  registerMediaIdentity,
  type KnownIdentity,
  type MediaOrigin,
} from '../../projects/media-identity';
import type { WinnowAssetRow, WinnowClient } from './client';
import { exifFromRow } from './exif-from-row';

export type Fidelity = 'proxy' | 'original';

export interface MaterializeOptions {
  fidelity: Fidelity;
  /** Called after each file lands, for a progress line. */
  onFile?: (file: File, index: number, total: number) => void;
}

/** `DJI_0001.MP4` → `DJI_0001`. */
function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/** What to fetch, and what to call it, for one rendition of one asset. */
export function plannedFiles(
  client: WinnowClient,
  row: WinnowAssetRow,
  fidelity: Fidelity,
): { url: string; name: string; type: string }[] {
  const base = baseName(row.filename);
  const main =
    fidelity === 'original'
      ? { url: client.originalUrl(row.id), name: row.filename, type: '' }
      : row.media_type === 'video'
        ? { url: client.proxyUrl(row.id), name: `${base}.mp4`, type: 'video/mp4' }
        : { url: client.proxyUrl(row.id), name: `${base}.webp`, type: 'image/webp' };
  const srt = row.sidecars
    .filter((s) => s.kind === 'srt')
    .map((s) => ({ url: client.sidecarUrl(s.id), name: s.filename, type: 'text/plain' }));
  return [main, ...srt];
}

/** The identity every file of `row` is vouched for with. */
export function identityFor(sourceId: string, row: WinnowAssetRow): KnownIdentity {
  return {
    assetId: `${sourceId}/${row.id}`,
    ...(row.content_hash ? { hash: row.content_hash } : {}),
  };
}

export async function materialize(
  client: WinnowClient,
  sourceId: string,
  row: WinnowAssetRow,
  options: MaterializeOptions,
): Promise<File[]> {
  const plan = plannedFiles(client, row, options.fidelity);
  // The capture time is the most useful mtime a fetched file can carry — it
  // is what a folder's file would have had, and what Road Trip reads.
  const lastModified = row.captured_at ? Date.parse(row.captured_at) || Date.now() : Date.now();
  const identity = identityFor(sourceId, row);
  // Where this came from, so the export can say what it is holding and fetch
  // the capture when it is time to deliver. Only on the MAIN file: fetching
  // "the original" of a `.srt` would hand back the video.
  const origin: MediaOrigin = {
    sourceId,
    fidelity: options.fidelity,
    width: row.width,
    height: row.height,
  };
  if (options.fidelity === 'proxy') {
    origin.fetchOriginal = () =>
      client.fetchFile(client.originalUrl(row.id), row.filename, '', lastModified);
  }
  // A photo's proxy is a WebP re-encode with no EXIF, so carry what Winnow
  // parsed at ingest. Only for stills: a clip's telemetry is its `.srt`, which
  // travels as a real file and says far more than a row ever could.
  if (row.media_type === 'photo') {
    const exif = exifFromRow(row);
    if (exif) origin.exif = exif;
  }
  const files: File[] = [];
  for (const [i, item] of plan.entries()) {
    const file = await client.fetchFile(item.url, item.name, item.type, lastModified);
    // The clip and its log share one identity: they are one asset in Winnow
    // as in the library, and the hash is the clip's.
    registerMediaIdentity(file, i === 0 ? { ...identity, origin } : identity);
    files.push(file);
    options.onFile?.(file, i + 1, plan.length);
  }
  return files;
}
