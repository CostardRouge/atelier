import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { extractRawPreview } from '../exif/raw-probe';
import { formatBytes } from '../lib/format';
import type { Rendition } from '../media/renditions';
import type { FetchFile } from '../sources/fetch-options';
import { heldOriginal, holdOriginal } from '../sources/original-cache';
import { trackedFetch } from '../tasks/tracked';
import type { LightboxFile } from '../ui/MediaLightbox';
import { viewFacts, viewLabel, viewableRenditions, viewedRendition } from './capture-view';
import type { MediaView } from '../sources/media-scope';

export interface CaptureViewSources {
  /**
   * The capture being looked at, by a key that changes when the sheet moves
   * to another one — the switcher's choice is dropped with it.
   */
  key: string | null;
  /** Its renditions, as `renditionsOf` lists them (the sensor's are left out here). */
  rows: readonly Rendition[];
  /** What the sheet already draws for the row the picture opens on — its own `src`. */
  openSrc: string | null;
  /** A file already in hand for a row: the open file, a folder's sibling. Null when it must be fetched. */
  fileFor: (row: Rendition) => File | null;
  /** Bring a row's bytes in from its instance. Held under the row's asset id once it lands. */
  fetchFor: (row: Rendition) => FetchFile | null;
}

export interface CaptureView {
  /** The chips, in the pill's order; empty when there is nothing to switch to. */
  files: LightboxFile[];
  /** The rendition on screen, or null for the one the picture opened on. */
  viewing: string | null;
  setViewing: (id: string | null) => void;
  /** What a `MediaAction` is handed: the rendition being viewed, as the roll stores it. */
  view: MediaView;
}

/**
 * The lightbox's SWITCHER over one capture's files (R6 of
 * `docs/capture-renditions.md`): view state only — nothing here writes a
 * document, and the choice is dropped the moment the sheet moves on.
 *
 * A file the session already holds is drawn from an object URL made here and
 * revoked on unmount; one that is not is fetched on the chip's click through
 * `fetchFor`, HELD under its asset id like any original (`original-cache.ts`),
 * so a `Develop` pressed next finds it in hand rather than fetching it again.
 * A RAW is never handed to an `<img>`: the render its camera wrote inside it
 * is sliced out (`extractRawPreview`) and that JPEG is what the slot draws.
 */
export function useCaptureView(sources: CaptureViewSources): CaptureView {
  const { key, rows, openSrc, fileFor, fetchFor } = sources;
  const [viewing, setViewingState] = useState<string | null>(null);
  // Object URLs made here, by `<key>:<rendition id>`, revoked when the sheet
  // leaves the capture and on unmount.
  const [urls, setUrls] = useState<ReadonlyMap<string, string>>(() => new Map());
  const made = useRef(new Map<string, string>());
  const release = useCallback(() => {
    for (const url of made.current.values()) URL.revokeObjectURL(url);
    made.current = new Map();
    setUrls((cur) => (cur.size ? new Map() : cur));
  }, []);
  useEffect(() => {
    setViewingState(null);
    release();
  }, [key, release]);
  useEffect(() => release, [release]);

  const latest = useRef({ fileFor, fetchFor });
  latest.current = { fileFor, fetchFor };

  // One fetch per file however many times the chips are rebuilt around it:
  // the sheet asks again whenever the list changes under it, and a 74 MB
  // RAW must not cross the tunnel twice for that.
  const inflight = useRef(new Map<string, Promise<string>>());
  const load = useCallback((row: Rendition, slot: string): Promise<string> => {
    const known = made.current.get(slot);
    if (known) return Promise.resolve(known);
    const running = inflight.current.get(slot);
    if (running) return running;
    const job = (async () => {
      let file = latest.current.fileFor(row) ?? (row.assetId ? heldOriginal(row.assetId) : null);
      if (!file) {
        const fetch = latest.current.fetchFor(row);
        if (!fetch) throw new Error(`${row.name} is not reachable from here`);
        // A task named after the file, on this capture's edge, cancellable
        // from the pill (`tasks/tracked.ts`).
        file = await trackedFetch({ label: `Fetching ${row.name}`, scope: key, bytes: row.bytes }, (opts) => fetch(opts));
        if (row.assetId) holdOriginal(row.assetId, file);
      }
      const blob = row.reach === 'embedded' ? await extractRawPreview(file) : file;
      if (!blob) throw new Error(`${row.name} carries no render a browser can draw`);
      const url = URL.createObjectURL(blob);
      made.current.set(slot, url);
      setUrls(new Map(made.current));
      return url;
    })();
    inflight.current.set(slot, job);
    // The caller handles the outcome; this only forgets the flight — a
    // `finally` on its own would surface the rejection a second time.
    const forget = () => inflight.current.delete(slot);
    void job.then(forget, forget);
    return job;
  }, [key]);

  const files = useMemo<LightboxFile[]>(() => {
    if (!key) return [];
    const shown = viewableRenditions(rows);
    if (shown.length < 2 && !(shown.length === 1 && shown[0].reach === 'embedded')) return [];
    return shown.map((row, at) => {
      const slot = `${key}:${row.id}`;
      const inHand = fileFor(row);
      // The row the sheet opened on already has its URL; every other file is
      // drawn from one made here.
      const src = at === 0 && row.reach === 'file' ? openSrc : (urls.get(slot) ?? null);
      return {
        id: row.id,
        label: viewLabel(row),
        facts: viewFacts(row, formatBytes),
        src,
        natural: row.pixels,
        unavailable: row.blocked,
        load: row.blocked || (src && at === 0) ? undefined : () => load(row, slot),
        // A chip that will fetch says so before the click.
        fetches: !inHand && !(row.assetId && heldOriginal(row.assetId)) && !!row.assetId && at !== 0,
      };
    });
  }, [key, rows, openSrc, fileFor, urls, load]);

  const setViewing = useCallback((id: string | null) => setViewingState(id), []);
  const view = useMemo<MediaView>(() => ({ rendition: viewedRendition(rows, viewing) }), [rows, viewing]);
  return { files, viewing, setViewing, view };
}
