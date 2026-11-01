import { useEffect, useMemo, useRef, useState } from 'react';
import { mulberry32 } from '../../shared/lib/prng';
import { measuredTiles, type MosaicDoc } from '../../shared/mosaic/mosaic-doc';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { SceneBuilder, type BuildStep, type MosaicScene } from './scene-builder';

export type { MosaicScene } from './scene-builder';

export type SceneState =
  | { status: 'idle'; why: 'no-target' | 'no-tiles' | 'no-client' | 'no-room' }
  | { status: 'building'; step: BuildStep; previous: MosaicScene | null }
  | { status: 'ready'; scene: MosaicScene }
  | { status: 'failed'; error: string; previous: MosaicScene | null };

interface SceneInputs {
  doc: MosaicDoc;
  client: WinnowClient | null;
  /** The stage's logical size (CSS pixels). */
  stageW: number;
  stageH: number;
  dpr: number;
}

/**
 * The mosaic of `doc.target` out of `doc`'s measured tiles, rebuilt when the
 * target, the library, a matching setting or the stage's size changes — the
 * builder does the work (`scene-builder.ts`); a build superseded mid-way is
 * abandoned and the previous scene stays on screen meanwhile. The builder
 * is handed back for the player, which shares its caches.
 */
export function useMosaicScene({ doc, client, stageW, stageH, dpr }: SceneInputs): { state: SceneState; builder: SceneBuilder | null } {
  const [state, setState] = useState<SceneState>({ status: 'idle', why: 'no-target' });
  const latest = useRef<MosaicScene | null>(null);
  const instance = doc.instance ?? null;

  const builder = useMemo(() => (instance ? new SceneBuilder(instance, client) : null), [instance, client]);
  useEffect(() => () => builder?.dispose(), [builder]);

  const library = useMemo(() => measuredTiles(doc), [doc.tiles]);
  useEffect(() => builder?.setLibrary(library), [builder, library]);
  const { level, space, cellPx, tint, distinctNeighbours } = doc.settings;
  const target = doc.target;

  useEffect(() => {
    const previous = latest.current;
    if (!client || !builder) {
      setState({ status: 'idle', why: 'no-client' });
      return;
    }
    if (!library.tiles.length) {
      setState({ status: 'idle', why: 'no-tiles' });
      return;
    }
    if (target === undefined || !library.tiles.some((t) => t.id === target)) {
      setState({ status: 'idle', why: 'no-target' });
      return;
    }
    if (stageW < 16 || stageH < 9) {
      setState({ status: 'idle', why: 'no-room' });
      return;
    }
    const controller = new AbortController();
    let alive = true;
    void builder
      .build(target, { cellPx, level, space, tint, distinctNeighbours }, { stageW, stageH, dpr }, {
        signal: controller.signal,
        onStep: (step) => {
          if (alive) setState({ status: 'building', step, previous });
        },
      })
      .then(
        (scene) => {
          latest.current = scene;
          if (alive) setState({ status: 'ready', scene });
        },
        (e: unknown) => {
          if (!alive || controller.signal.aborted) return;
          setState({ status: 'failed', error: e instanceof Error ? e.message : String(e), previous });
        },
      );
    return () => {
      alive = false;
      controller.abort();
    };
  }, [client, builder, library, target, stageW, stageH, dpr, cellPx, level, space, tint, distinctNeighbours]);

  return { state, builder };
}

/** A target drawn at random among the measured tiles, from the document's seed and a salt. */
export function randomTarget(doc: MosaicDoc, salt: number): number | undefined {
  const { tiles } = measuredTiles(doc);
  if (!tiles.length) return undefined;
  const rnd = mulberry32(doc.settings.seed + salt);
  const pick = tiles[Math.floor(rnd() * tiles.length)];
  return pick.id === doc.target && tiles.length > 1 ? tiles[(tiles.indexOf(pick) + 1) % tiles.length].id : pick.id;
}
