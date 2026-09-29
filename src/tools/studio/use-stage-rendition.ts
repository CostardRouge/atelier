import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { isProxyOverRaw, rawRenderFrom, rawRenderOf } from '../../shared/develop/delivery-source';
import { deliveredSourceFor } from '../../shared/develop/sensor-source';
import { fileIdentity, isRawImage } from '../../shared/library/assets';
import type { PixelSize, Rendition } from '../../shared/media/renditions';
import { knownIdentity, mediaOrigin } from '../../shared/projects/media-identity';
import { stageChoice, stageRenditions } from '../../shared/projects/media-rendition';
import { isAbortError } from '../../shared/sources/fetch-options';
import { fetchHeld } from '../../shared/sources/held-fetch';
import { heldOriginal, heldVersion, subscribeHeld } from '../../shared/sources/original-cache';
import { trackedFetch } from '../../shared/tasks/tracked';

export interface StageRenditionInput {
  /** The file the Library holds for the open media — a source's proxy, or the file itself. */
  file: File | null;
  /** The choice the project stores for it (`ProjectMedia.renditions`), null for where it opens. */
  stored: string | null;
  /** The Library file's own pixels, where measured — what the proxy's row says. */
  measured: PixelSize | null;
  /** Write a choice; null is where the media opens. */
  onChoose: (id: string | null) => void;
}

export interface StageRendition {
  /** The media's files, in the pill's order; fewer than two means nothing to switch. */
  rows: Rendition[];
  /** The row the menu marks — the one chosen, even while it is still on its way. */
  current: Rendition | null;
  /** The file the stage draws right now. */
  file: File | null;
  /** True while the stage draws the Library's own file. */
  onLibraryFile: boolean;
  /** True while the chosen file is being fetched — the stage keeps the proxy meanwhile. */
  fetching: boolean;
  /** Why the chosen file did not come, said once; null otherwise. */
  error: string | null;
  choose: (id: string) => void;
}

interface Flight {
  /** `fileIdentity` of the media's Library file, and the rendition being brought. */
  of: string;
  id: string;
  controller: AbortController;
  job: Promise<File>;
}

/**
 * WHICH FILE of the open media the Studio's stage works from (2026-09-29) —
 * the Develop tool's rendition switch, for a clip and a still in a project.
 *
 * The media opens on the file the Library holds (a Winnow proxy: a 720p H.264,
 * a 2048 px WebP). A choice stored on the project brings another of the
 * capture's files onto the stage — the rush itself, the camera's JPEG, the
 * render inside a RAW companion — fetched once through the one flight
 * (`held-fetch.ts`), held for the session, and SHARED with the export, so the
 * export delivers from the file on the stage without fetching it again. The
 * proxy stays on the stage until the file has landed; a failure is said and
 * puts the media back where it opens, a Cancel from the task does the same.
 *
 * A fetch outlives a switch to another clip — the task pill shows it and can
 * stop it, and coming back finds it held — but not a switch to another file
 * of the SAME media: a gigabyte asked for by mistake stops when the person
 * picks the proxy again.
 */
export function useStageRendition({ file, stored, measured, onChoose }: StageRenditionInput): StageRendition {
  const origin = mediaOrigin(file);
  const assetKey = file ? (knownIdentity(file)?.assetId ?? null) : null;
  const fileKey = file ? fileIdentity(file) : null;
  const companion = origin?.companion ?? null;

  // Whether the session holds the capture's files, re-read whenever the
  // cache moves (a fetch lands, an eviction), so a row's `here` follows.
  useSyncExternalStore(subscribeHeld, heldVersion, heldVersion);
  const originalHeld = assetKey ? heldOriginal(assetKey) !== null : false;
  const companionHeld = companion ? heldOriginal(companion.assetId) !== null : false;

  // How big the render inside a still's RAW is, read from a megabyte of its
  // head once per session (`original-cache.ts`) — the same reads Develop
  // makes, so a DJI DNG's row says 960 × 540 before anyone fetches 74 MB.
  const [originalRender, setOriginalRender] = useState<PixelSize | null | undefined>(undefined);
  useEffect(() => {
    setOriginalRender(undefined);
    if (!origin || !isProxyOverRaw(origin)) return;
    let alive = true;
    void rawRenderOf(origin, assetKey).then(({ render }) => {
      if (alive) setOriginalRender(render);
    });
    return () => {
      alive = false;
    };
  }, [origin, assetKey]);
  const [companionRender, setCompanionRender] = useState<PixelSize | null | undefined>(undefined);
  useEffect(() => {
    setCompanionRender(undefined);
    if (!companion || !isRawImage(companion.name)) return;
    let alive = true;
    void rawRenderFrom(companion.fetchHead, companion.assetId).then(({ render }) => {
      if (alive) setCompanionRender(render);
    });
    return () => {
      alive = false;
    };
  }, [companion]);

  const measuredW = measured?.width ?? 0;
  const measuredH = measured?.height ?? 0;
  const rows = useMemo<Rendition[]>(() => {
    if (!file) return [];
    return stageRenditions({
      file,
      origin,
      measured: measuredW && measuredH ? { width: measuredW, height: measuredH } : null,
      original: { assetId: assetKey, held: originalHeld, render: originalRender },
      companion: companion ? { held: companionHeld, render: companionRender } : undefined,
    });
  }, [file, origin, measuredW, measuredH, assetKey, originalHeld, originalRender, companion, companionHeld, companionRender]);

  const { current, wanted } = stageChoice(rows, stored);
  const wantedId = wanted?.id ?? null;

  // The stage's OWN reference to the file it draws: the session cache may let
  // it go (`held-budget.ts`), and a stage whose file vanished would fetch it
  // again — against the very cache that just evicted it.
  const [loaded, setLoaded] = useState<{ of: string; id: string; file: File } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setError(null);
    setLoaded((l) => (l && l.of !== fileKey ? null : l));
  }, [fileKey]);

  const flights = useRef(new Map<string, Flight>());
  const latest = useRef({ wanted, origin, assetKey, stored, onChoose });
  latest.current = { wanted, origin, assetKey, stored, onChoose };

  useEffect(() => {
    const { wanted: row, origin: from, assetKey: key } = latest.current;
    if (!file || !fileKey || !row || row.id !== wantedId) return;
    const source = deliveredSourceFor(row.id, file, from, [], key);
    if (source?.held) {
      setLoaded({ of: fileKey, id: row.id, file: source.held });
      return;
    }
    const slot = `${fileKey}\n${row.id}`;
    let flight = flights.current.get(slot);
    if (!flight) {
      const fetch = source?.fetch ?? null;
      if (!source || !fetch) {
        setError(`${row.name} is not reachable from here — the stage stays on the proxy.`);
        if (latest.current.stored === row.id) latest.current.onChoose(null);
        return;
      }
      const controller = new AbortController();
      const init = { label: `Fetching ${row.name}`, scope: key, bytes: row.bytes };
      // Held under its own asset id, and joined by the export if it asks
      // for the same file before this one has landed.
      const job = source.key
        ? fetchHeld(source.key, init, fetch, controller.signal)
        : trackedFetch({ ...init, signal: controller.signal }, (opts) => fetch(opts));
      const started: Flight = { of: fileKey, id: row.id, controller, job };
      flights.current.set(slot, started);
      const forget = () => {
        if (flights.current.get(slot) === started) flights.current.delete(slot);
      };
      job.then(forget, forget);
      flight = started;
    }
    let alive = true;
    flight.job.then(
      (got) => {
        if (alive) setLoaded({ of: fileKey, id: row.id, file: got });
      },
      (err: unknown) => {
        if (!alive) return;
        // A Cancel is a person saying no; anything else is said. Either way
        // the media goes back to where it opens — unless the person has
        // already chosen something else, which stands.
        if (!isAbortError(err)) {
          setError(`${row.name} could not be fetched (${err instanceof Error ? err.message : String(err)}) — the stage stays on the proxy.`);
        }
        if (latest.current.stored === row.id) latest.current.onChoose(null);
      },
    );
    return () => {
      alive = false;
    };
  }, [file, fileKey, wantedId]);

  // Leaving the Studio stops every fetch the stage asked for; the export's own
  // readers keep theirs (`held-fetch.ts`).
  useEffect(() => {
    const all = flights.current;
    return () => {
      for (const flight of all.values()) flight.controller.abort();
    };
  }, []);

  const choose = useCallback(
    (id: string) => {
      setError(null);
      // A file of THIS media asked for and no longer wanted stops coming.
      for (const flight of flights.current.values()) {
        if (flight.of === fileKey && flight.id !== id) flight.controller.abort();
      }
      const row = rows.find((r) => r.id === id) ?? null;
      const opening = stageChoice(rows, null).current;
      onChoose(!row || row.id === opening?.id ? null : row.id);
    },
    [rows, fileKey, onChoose],
  );

  // What the stage draws: the chosen file once it is here — in the stage's
  // own hands, or held already by the session, so a return costs no frame on
  // the proxy — else the Library's file.
  const ownLoaded = wanted && loaded && loaded.of === fileKey && loaded.id === wanted.id ? loaded.file : null;
  const inHand =
    wanted && !ownLoaded && file ? (deliveredSourceFor(wanted.id, file, origin, [], assetKey)?.held ?? null) : null;
  const shown = ownLoaded ?? inHand ?? file;

  return {
    rows,
    current,
    file: shown,
    onLibraryFile: shown === file,
    fetching: !!wanted && shown === file,
    error,
    choose,
  };
}
