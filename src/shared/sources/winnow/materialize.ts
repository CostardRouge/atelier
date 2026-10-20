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
 * - **log**: a DJI clip's `.srt` ALONE — the flight, never the video. What
 *   Flight Atlas reads, and a few hundred kilobytes of text where the proxy
 *   is a video. A row with no log brings nothing.
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
  type CaptureCompanion,
  type KnownIdentity,
  type MediaOrigin,
} from '../../projects/media-identity';
import type { SavedMediaRef } from '../../projects/project-types';
import { trackedFetch } from '../../tasks/tracked';
import type { FetchOptions } from '../fetch-options';
import { WinnowError, type WinnowAssetRow, type WinnowClient } from './client';
import { exifFromRow } from './exif-from-row';
import { srtSidecars } from './picker/pick-filter';

export type Fidelity = 'proxy' | 'original' | 'log';

export interface MaterializeOptions {
  fidelity: Fidelity;
  /** Called after each file lands, for a progress line. */
  onFile?: (file: File, index: number, total: number) => void;
  /**
   * No task of its own: the caller is already one (a roll export naming the
   * picture), and a task inside a task would say the same thing twice.
   */
  quiet?: boolean;
  /**
   * A file already fetched for this URL (a flight log the picker read to draw
   * its track), handed back instead of a second request. `log` only.
   */
  reuse?: (url: string) => File | null;
  /**
   * Stop the fetch in flight — the browser's Cancel, which used to close the
   * sheet while the files went on downloading and landed in the Library after
   * all (the audit of 2026-09-22). Joined with the task's own Cancel.
   */
  signal?: AbortSignal;
}

/** Either signal aborts the result — `AbortSignal.any` where the engine has it. */
function eitherSignal(a: AbortSignal | undefined, b: AbortSignal | undefined): AbortSignal | undefined {
  if (!a) return b;
  if (!b) return a;
  const any = (AbortSignal as { any?: (signals: AbortSignal[]) => AbortSignal }).any;
  if (any) return any([a, b]);
  const joined = new AbortController();
  const stop = () => joined.abort();
  if (a.aborted || b.aborted) stop();
  a.addEventListener('abort', stop, { once: true });
  b.addEventListener('abort', stop, { once: true });
  return joined.signal;
}

/** `DJI_0001.MP4` → `DJI_0001`. */
function baseName(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot > 0 ? filename.slice(0, dot) : filename;
}

/** One file to fetch; `or` lists where else the same file may be, tried in order on a 404. */
export interface PlannedFile {
  url: string;
  name: string;
  type: string;
  or?: { url: string; name: string }[];
}

/**
 * The clip's flight log as ONE planned file: its newest `.srt` row, the older
 * ones as fallbacks — a moved clip keeps a dead row beside the live one
 * (`srtSidecars`), and both are the same log.
 */
function plannedLog(client: WinnowClient, row: WinnowAssetRow): PlannedFile | null {
  const [first, ...rest] = srtSidecars(row).map((s) => ({ url: client.sidecarUrl(s.id), name: s.filename }));
  if (!first) return null;
  return { ...first, type: 'text/plain', ...(rest.length ? { or: rest } : {}) };
}

/**
 * `item` fetched from the first place that answers: a 404 tries the next one
 * (a dead row of a moved clip), anything else stops at once. `reuse` hands
 * back a file already held for a URL. Throws the last 404 when none answers.
 */
async function fetchPlanned(
  client: WinnowClient,
  item: PlannedFile,
  lastModified: number,
  opts: FetchOptions,
  reuse?: (url: string) => File | null,
): Promise<{ file: File; url: string }> {
  let miss: unknown = null;
  for (const at of [{ url: item.url, name: item.name }, ...(item.or ?? [])]) {
    const held = reuse?.(at.url);
    if (held) return { file: held, url: at.url };
    try {
      return { file: await client.fetchFile(at.url, at.name, item.type, lastModified, opts), url: at.url };
    } catch (err) {
      if (!(err instanceof WinnowError && err.kind === 'notfound')) throw err;
      miss = err;
    }
  }
  throw miss;
}

/**
 * A clip's flight log, from the first of its `.srt` rows that answers, with
 * the URL that did; null when the clip carries none. For a reader that wants
 * the text only (the Logbook's tracks, an agent's flights) — the Library's
 * files go through `materialize`.
 */
export async function fetchLog(
  client: WinnowClient,
  row: WinnowAssetRow,
  opts: FetchOptions & { reuse?: (url: string) => File | null } = {},
): Promise<{ file: File; url: string } | null> {
  const log = plannedLog(client, row);
  if (!log) return null;
  const { reuse, ...fetchOpts } = opts;
  return fetchPlanned(client, log, captureMtime(row), fetchOpts, reuse);
}

/** What to fetch, and what to call it, for one rendition of one asset. */
export function plannedFiles(client: WinnowClient, row: WinnowAssetRow, fidelity: Fidelity): PlannedFile[] {
  const log = plannedLog(client, row);
  const srt = log ? [log] : [];
  if (fidelity === 'log') return srt;
  const base = baseName(row.filename);
  const main =
    fidelity === 'original'
      ? { url: client.originalUrl(row.id), name: row.filename, type: '' }
      : row.media_type === 'video'
        ? { url: client.proxyUrl(row.id), name: `${base}.mp4`, type: 'video/mp4' }
        : { url: client.proxyUrl(row.id), name: `${base}.webp`, type: 'image/webp' };
  return [main, ...srt];
}

/** The identity every file of `row` is vouched for with. */
export function identityFor(sourceId: string, row: WinnowAssetRow): KnownIdentity {
  return {
    assetId: `${sourceId}/${row.id}`,
    ...(row.content_hash ? { hash: row.content_hash } : {}),
  };
}

/**
 * The mtime a fetched file carries: the CAPTURE's instant, never the moment it
 * was copied. It is what a folder's file would have had, and it is what every
 * fallback in the suite reads — Road Trip's day, the library's ordering — so
 * `Date.now()` here would file a 2025 photograph under today.
 *
 * `captured_at` is the answer whenever the instance has one. When it has only
 * a `capture_date` (an asset whose EXIF held a day and no clock), the day is
 * taken at LOCAL NOON: midnight would land on the day before in any zone west
 * of the parser, which is the one mistake the whole date path exists to avoid.
 * Only a row that knows neither falls through to now, and it is the honest
 * last resort — nothing knows when that file was made.
 */
export function captureMtime(row: WinnowAssetRow): number {
  const instant = row.captured_at ? Date.parse(row.captured_at) : NaN;
  if (Number.isFinite(instant)) return instant;
  const day = /^(\d{4})-(\d{2})-(\d{2})/.exec(row.capture_date ?? '');
  if (day) return new Date(Number(day[1]), Number(day[2]) - 1, Number(day[3]), 12).getTime();
  return Date.now();
}

/**
 * The ref a document would store for `row`'s PROXY, without fetching it — the
 * name `materialize` gives the file, the capture's instant, and the identity it
 * is vouched for with. What a document picks from an instance's list (a Develop
 * roll adding a day) becomes a ref at no network cost, and the bytes follow
 * when a picture is opened (`resolve-media.ts`).
 *
 * `size` is 0 — unknown until the proxy is fetched — which is harmless where
 * it is read: a ref with an asset id is matched by that id (`sameMediaRef`),
 * and the Library finds the fetched file by its name first (`findMedia`).
 */
export function rowMediaRef(sourceId: string, row: WinnowAssetRow): SavedMediaRef {
  const { assetId, hash } = identityFor(sourceId, row);
  const name = row.media_type === 'video' ? `${baseName(row.filename)}.mp4` : `${baseName(row.filename)}.webp`;
  return {
    name,
    size: 0,
    lastModified: captureMtime(row),
    ...(assetId ? { assetId } : {}),
    ...(hash ? { hash } : {}),
  };
}

/**
 * The capture's other file, when this row is half of a paired media.
 *
 * Everything it needs is already on the row Winnow sent (`WinnowAssetRow`'s
 * companion fields), so this costs no request: the id is enough to fetch the
 * bytes or just their head, and the name and weight are what a panel says
 * before anyone clicks.
 *
 * **Only `raw_jpeg`.** A `live_photo` companion is a `.mov` — motion, not
 * material — and handing it back here would let a caller offer a movie as the
 * sensor's data. Checked on the KIND rather than the extension, because that
 * is the field Winnow actually decides with; the extension is checked too, so
 * a row whose kind is missing from an older instance still cannot mislead.
 */
export function companionOf(
  client: WinnowClient,
  sourceId: string,
  row: WinnowAssetRow,
  lastModified: number,
): CaptureCompanion | null {
  const id = row.companion_id;
  const name = row.companion_filename;
  if (!id || !name) return null;
  if (row.group_kind && row.group_kind !== 'raw_jpeg') return null;
  if (row.companion_media_type && row.companion_media_type !== 'photo') return null;
  return {
    assetId: `${sourceId}/${id}`,
    name,
    bytes: row.companion_file_size ?? null,
    width: row.companion_width ?? null,
    height: row.companion_height ?? null,
    fetchFile: (opts) => client.fetchFile(client.originalUrl(id), name, '', lastModified, opts),
    fetchHead: (bytes) => client.fetchHead(client.originalUrl(id), bytes),
  };
}

export async function materialize(
  client: WinnowClient,
  sourceId: string,
  row: WinnowAssetRow,
  options: MaterializeOptions,
): Promise<File[]> {
  const plan = plannedFiles(client, row, options.fidelity);
  if (plan.length === 0) return [];
  const lastModified = captureMtime(row);
  const identity = identityFor(sourceId, row);
  if (options.fidelity === 'log') return materializeLogs(client, sourceId, plan, lastModified, identity, options);
  // Where this came from, so the export can say what it is holding and fetch
  // the capture when it is time to deliver. Only on the MAIN file: fetching
  // "the original" of a `.srt` would hand back the video.
  const origin: MediaOrigin = {
    sourceId,
    fidelity: options.fidelity,
    width: row.width,
    height: row.height,
    name: row.filename,
    bytes: row.file_size,
  };
  if (options.fidelity === 'proxy') {
    origin.fetchOriginal = (opts) => client.fetchFile(client.originalUrl(row.id), row.filename, '', lastModified, opts);
    origin.fetchOriginalHead = (bytes) => client.fetchHead(client.originalUrl(row.id), bytes);
  }
  const companion = companionOf(client, sourceId, row, lastModified);
  if (companion) origin.companion = companion;
  // A photo's proxy is a WebP re-encode with no EXIF, so carry what Winnow
  // parsed at ingest. Only for stills: a clip's telemetry is its `.srt`, which
  // travels as a real file and says far more than a row ever could.
  if (row.media_type === 'photo') {
    const exif = exifFromRow(row);
    if (exif) origin.exif = exif;
  }
  const files: File[] = [];
  // One TASK for the whole asset (T2 of `docs/progress-feedback.md`): named
  // after the capture, scoped to its asset id so a stage showing that
  // picture can draw the bar on its edge, cancellable by aborting the
  // request in flight. The proxy's weight is unknown until the server says
  // it; the original's is the row's.
  const bring = async (opts: FetchOptions = {}) => {
    for (const [i, item] of plan.entries()) {
      let fetched: { file: File };
      try {
        fetched = await fetchPlanned(client, item, lastModified, {
          signal: eitherSignal(opts.signal, options.signal),
          onProgress: i === 0 ? opts.onProgress : undefined,
        });
      } catch (err) {
        // A sidecar whose every row is dead (a clip moved off its drive) must
        // not cost the clip that already landed: it comes without its log.
        if (i > 0 && err instanceof WinnowError && err.kind === 'notfound') continue;
        throw err;
      }
      const { file } = fetched;
      // The clip and its log share one identity: they are one asset in Winnow
      // as in the library, and the hash is the clip's.
      registerMediaIdentity(file, i === 0 ? { ...identity, origin } : identity);
      files.push(file);
      options.onFile?.(file, i + 1, plan.length);
    }
    return files;
  };
  if (options.quiet) return bring();
  return trackedFetch(
    {
      label: `Fetching ${row.filename}${options.fidelity === 'proxy' ? '’s proxy' : ''}`,
      scope: identity.assetId ?? null,
      bytes: options.fidelity === 'original' ? row.file_size : null,
    },
    bring,
  );
}

/**
 * A clip's flight log alone. The `.srt` is vouched for with the CLIP's
 * identity and an origin naming the log itself — so the Library files it under
 * the instance it came from — and nothing else: no proxy, no original to
 * fetch, no companion. Fetched as the source's own file (`original`), which a
 * sidecar is. Adding the clip later groups both under one asset by base name,
 * as a folder would.
 */
async function materializeLogs(
  client: WinnowClient,
  sourceId: string,
  plan: PlannedFile[],
  lastModified: number,
  identity: KnownIdentity,
  options: MaterializeOptions,
): Promise<File[]> {
  const files: File[] = [];
  const bring = async (opts: FetchOptions = {}) => {
    for (const [i, item] of plan.entries()) {
      const { file } = await fetchPlanned(
        client,
        item,
        lastModified,
        { signal: eitherSignal(opts.signal, options.signal), onProgress: i === 0 ? opts.onProgress : undefined },
        options.reuse,
      );
      registerMediaIdentity(file, {
        ...identity,
        origin: { sourceId, fidelity: 'original', width: null, height: null, name: file.name, bytes: null },
      });
      files.push(file);
      options.onFile?.(file, i + 1, plan.length);
    }
    return files;
  };
  if (options.quiet) return bring();
  return trackedFetch({ label: `Fetching ${plan[0].name}`, scope: identity.assetId ?? null, bytes: null }, bring);
}
