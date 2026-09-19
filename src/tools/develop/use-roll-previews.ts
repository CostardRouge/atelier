import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { deleteRollPreviews, getRollPreviews, putRollPreview } from '../../shared/develop/roll-store';
import { pictureThumbnail } from '../../shared/develop/roll-thumb';
import type { RollPicture } from '../../shared/develop/roll-types';
import {
  WORKING_PREVIEW_EDGE,
  WORKING_PREVIEW_QUALITY,
  isWorkingPreview,
  workingPreviewFile,
  workingPreviewsKey,
} from '../../shared/develop/working-preview';

export interface RollPreviews {
  /** Whether this roll keeps working previews on this device. */
  enabled: boolean;
  setEnabled: (on: boolean) => void;
  /** The previews in hand, as files, by picture id. */
  files: ReadonlyMap<string, File>;
  /** What the stored previews weigh. */
  bytes: number;
  /** Local pictures whose preview is still to be made from a file in hand. */
  pending: number;
  /** Drop the previews of pictures that left the roll. */
  forget: (pictureIds: readonly string[]) => void;
}

function readFlag(rollId: string): boolean {
  try {
    return localStorage.getItem(workingPreviewsKey(rollId)) === '1';
  } catch {
    return false;
  }
}

/** A LOCAL picture: no instance holds it, so nothing could fetch it back. */
function isLocal(p: RollPicture): boolean {
  return !p.ref.assetId;
}

/**
 * The working previews of a roll (F5 of `docs/develop-tool.md` §9): when the
 * roll asks for them, every LOCAL picture whose file is in hand gets a 2048 px
 * JPEG kept in `atelier-develop` — one at a time, made from the real file,
 * never from another preview — and a later visit develops from it while the
 * file is away. A Winnow picture never gets one (its ref is its address).
 * Turning them off deletes them. The opt-in is this device's
 * (`localStorage`), like the previews.
 */
export function useRollPreviews({
  rollId,
  pictures,
  realFiles,
}: {
  rollId: string;
  pictures: readonly RollPicture[];
  /** The files in hand that are NOT previews. */
  realFiles: ReadonlyMap<string, File>;
}): RollPreviews {
  const [enabled, setEnabledState] = useState(() => readFlag(rollId));
  const [blobs, setBlobs] = useState<ReadonlyMap<string, Blob>>(new Map());
  const blobsRef = useRef(blobs);
  blobsRef.current = blobs;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    void getRollPreviews(rollId).then((stored) => {
      if (!alive) return;
      setBlobs(stored);
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [rollId]);

  const localIds = useMemo(() => new Set(pictures.filter(isLocal).map((p) => p.id)), [pictures]);

  // Make what is missing, from the real files in hand.
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled || !loaded) return;
    const due = pictures.filter(
      (p) =>
        localIds.has(p.id) &&
        realFiles.has(p.id) &&
        !isWorkingPreview(realFiles.get(p.id)) &&
        !blobsRef.current.has(p.id) &&
        !tried.current.has(p.id),
    );
    if (due.length === 0) return;
    let alive = true;
    void (async () => {
      for (const p of due) {
        if (!alive) return;
        tried.current.add(p.id);
        const blob = await pictureThumbnail(realFiles.get(p.id)!, WORKING_PREVIEW_EDGE, WORKING_PREVIEW_QUALITY);
        if (!blob) continue;
        if (await putRollPreview(p.id, rollId, blob)) setBlobs((m) => new Map(m).set(p.id, blob));
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, loaded, pictures, localIds, realFiles, rollId]);

  const setEnabled = useCallback(
    (on: boolean) => {
      try {
        if (on) localStorage.setItem(workingPreviewsKey(rollId), '1');
        else localStorage.removeItem(workingPreviewsKey(rollId));
      } catch {
        /* the switch lasts the session */
      }
      setEnabledState(on);
      if (!on) {
        // Off means gone: a preview nobody asked for is media kept for nothing.
        void deleteRollPreviews([...blobsRef.current.keys()]);
        setBlobs(new Map());
        tried.current = new Set();
      }
    },
    [rollId],
  );

  const forget = useCallback((ids: readonly string[]) => {
    void deleteRollPreviews(ids);
    setBlobs((m) => {
      if (!ids.some((id) => m.has(id))) return m;
      const next = new Map(m);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  // One File per stored preview, kept stable across renders so a picture's
  // decode is not redone every time the map is read.
  const cache = useRef(new Map<string, { blob: Blob; file: File }>());
  const files = useMemo(() => {
    const out = new Map<string, File>();
    for (const p of pictures) {
      const blob = blobs.get(p.id);
      if (!blob) continue;
      let entry = cache.current.get(p.id);
      if (!entry || entry.blob !== blob) {
        entry = { blob, file: workingPreviewFile(blob, p.ref.name, p.ref.lastModified) };
        cache.current.set(p.id, entry);
      }
      out.set(p.id, entry.file);
    }
    return out;
  }, [blobs, pictures]);

  let bytes = 0;
  for (const b of blobs.values()) bytes += b.size;
  const pending = enabled
    ? pictures.filter((p) => localIds.has(p.id) && realFiles.has(p.id) && !blobs.has(p.id)).length
    : 0;

  return { enabled, setEnabled, files, bytes, pending, forget };
}
