import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteRollShots, getRollShots, putRollShot } from '../../shared/develop/roll-store';
import { bakeShot } from '../../shared/develop/shot-bake';
import { shotsPref } from '../../shared/develop/shot-record';
import { isClipPicture, type RollPicture } from '../../shared/develop/roll-types';
import { isWorkingPreview } from '../../shared/develop/working-preview';
import { useLocalPref } from '../../shared/ui/local-pref';

export interface RollShots {
  /** Whether this device keeps the pairs (`shotsPref`). */
  enabled: boolean;
  /** Pictures of this roll whose pair is kept. */
  kept: number;
  /** Drop the pairs of pictures that left the roll. */
  forget: (pictureIds: readonly string[]) => void;
}

/**
 * The as-shot pairs of a roll (B1 of `docs/auto-develop.md` §6,
 * `shot-record.ts`): while the device keeps them, every photograph whose file
 * is in hand gets its vignette, stats and camera facts baked once — in the
 * roll's one background decode slot, like a thumbnail — and kept in
 * `atelier-develop` beside its record. A clip has no pair; a working preview
 * answers for a file that is away (its EXIF then says nothing, and the record
 * keeps that honestly). Turning the device's choice off drops every pair of
 * every roll — the sheet's own write (`DevelopSettingsSheet`), the working
 * previews' rule.
 */
export function useRollShots({
  rollId,
  pictures,
  files,
}: {
  rollId: string;
  pictures: readonly RollPicture[];
  /** The files in hand, previews included, by picture id. */
  files: ReadonlyMap<string, File>;
}): RollShots {
  const [enabled] = useLocalPref(shotsPref, true);
  const [kept, setKept] = useState<ReadonlySet<string>>(new Set());
  const keptRef = useRef(kept);
  keptRef.current = kept;
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoaded(false);
    void getRollShots(rollId).then((stored) => {
      if (!alive) return;
      setKept(new Set(stored.keys()));
      setLoaded(true);
    });
    return () => {
      alive = false;
    };
  }, [rollId]);

  // Make what is missing, from the files in hand — the real file before a
  // preview, since only the real file carries the camera's facts.
  const tried = useRef(new Set<string>());
  useEffect(() => {
    if (!enabled || !loaded) return;
    const due = pictures.filter((p) => !isClipPicture(p) && files.has(p.id) && !keptRef.current.has(p.id) && !tried.current.has(p.id));
    if (due.length === 0) return;
    let alive = true;
    void (async () => {
      for (const p of due) {
        if (!alive) return;
        const file = files.get(p.id)!;
        // A preview in hand today may be the real file tomorrow: try again then.
        if (!isWorkingPreview(file)) tried.current.add(p.id);
        const baked = await bakeShot(file);
        if (!baked || !alive) continue;
        const ok = await putRollShot({ ...baked, id: p.id, rollId, updatedAt: Date.now() });
        if (ok && alive) setKept((s) => new Set(s).add(p.id));
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, loaded, pictures, files, rollId]);

  // The device said no: the settings sheet drops every pair (`clearRollShots`),
  // and what this roll knew of them goes with it — so a later yes bakes afresh.
  useEffect(() => {
    if (enabled) return;
    setKept(new Set());
    tried.current = new Set();
  }, [enabled]);

  const forget = useCallback((ids: readonly string[]) => {
    void deleteRollShots(ids);
    setKept((s) => {
      if (!ids.some((id) => s.has(id))) return s;
      const next = new Set(s);
      for (const id of ids) next.delete(id);
      return next;
    });
  }, []);

  return { enabled, kept: kept.size, forget };
}
