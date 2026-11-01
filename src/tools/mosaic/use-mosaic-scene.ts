import { useEffect, useMemo, useRef, useState } from 'react';
import { mulberry32 } from '../../shared/lib/prng';
import { aspectRatio } from '../../shared/mosaic/frame';
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
  /** The room the stage may take (CSS pixels); the stage is the widest frame of the mosaic's shape in it, never taller. */
  room: { width: number; height: number };
  dpr: number;
}

/** The widest `aspect` frame a room holds, never taller than it, in whole pixels. */
export function stageIn(room: { width: number; height: number }, aspect: number): { stageW: number; stageH: number } {
  const stageW = Math.max(0, Math.floor(Math.min(room.width, (room.height || Infinity) * aspect)));
  return { stageW, stageH: Math.max(0, Math.floor(stageW / aspect)) };
}

/**
 * The mosaic of `doc.target` out of `doc`'s measured tiles, rebuilt when the
 * target, the library, a matching setting or the stage's size changes — the
 * builder does the work (`scene-builder.ts`); a build superseded mid-way is
 * abandoned and the previous scene stays on screen meanwhile. The builder
 * is handed back for the player, which shares its caches.
 */
export function useMosaicScene({ doc, client, room, dpr }: SceneInputs): { state: SceneState; builder: SceneBuilder | null; stageW: number; stageH: number; frameAspect: number } {
  const [state, setState] = useState<SceneState>({ status: 'idle', why: 'no-target' });
  const latest = useRef<MosaicScene | null>(null);
  const instance = doc.instance ?? null;
  // The target's own shape, learnt from its picture — what `original` means.
  const [own, setOwn] = useState<{ id: number; aspect: number } | null>(null);
  const frameAspect = aspectRatio(doc.settings.aspect, own && own.id === doc.target ? own.aspect : undefined);
  const { stageW, stageH } = stageIn(room, frameAspect);

  const builder = useMemo(() => (instance ? new SceneBuilder(instance, client) : null), [instance, client]);
  useEffect(() => () => builder?.dispose(), [builder]);

  const library = useMemo(() => measuredTiles(doc), [doc.tiles]);
  useEffect(() => builder?.setLibrary(library), [builder, library]);
  const { level, space, cellPx, tint, distinctNeighbours } = doc.settings;
  const target = doc.target;
  // An equal crop in a new object must not rebuild the scene: keyed on its numbers.
  const cropKey = doc.crop ? `${doc.crop.cx}|${doc.crop.cy}|${doc.crop.scale}` : '';
  const crop = useMemo(() => doc.crop, [cropKey]);

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
    const targetTile = library.tiles.find((t) => t.id === target);
    // `original` needs the picture's shape before the stage can take it: the bitmap first, the build on the next render.
    if (doc.settings.aspect === 'original' && (!own || own.id !== target) && targetTile) {
      setState({ status: 'building', step: 'target', previous });
      void builder.targetBitmap(targetTile, controller.signal).then(
        (b) => alive && setOwn({ id: target, aspect: b.width / b.height }),
        (e: unknown) => alive && !controller.signal.aborted && setState({ status: 'failed', error: e instanceof Error ? e.message : String(e), previous }),
      );
      return () => {
        alive = false;
        controller.abort();
      };
    }
    void builder
      .build(target, { cellPx, level, space, tint, distinctNeighbours }, { stageW, stageH, dpr }, {
        signal: controller.signal,
        crop,
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
  }, [client, builder, library, target, crop, stageW, stageH, dpr, cellPx, level, space, tint, distinctNeighbours, doc.settings.aspect, own]);

  return { state, builder, stageW, stageH, frameAspect };
}

/** A target drawn at random among the measured tiles, from the document's seed and a salt. */
export function randomTarget(doc: MosaicDoc, salt: number): number | undefined {
  const { tiles } = measuredTiles(doc);
  if (!tiles.length) return undefined;
  const rnd = mulberry32(doc.settings.seed + salt);
  const pick = tiles[Math.floor(rnd() * tiles.length)];
  return pick.id === doc.target && tiles.length > 1 ? tiles[(tiles.indexOf(pick) + 1) % tiles.length].id : pick.id;
}
