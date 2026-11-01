import { useEffect, useRef } from 'react';
import { coverSource } from '../../shared/mosaic/measure';
import { putThumb } from './mosaic-store';
import type { SceneState } from './use-mosaic-scene';

/** The cover's size: a gallery card's 16:9, drawn twice for a sharp screen. */
const COVER_W = 640;
const COVER_H = 360;
/** How long the scene must stay still before its cover is drawn again. */
const SETTLE_MS = 2000;

/**
 * The gallery card's COVER: the mosaic as the stage last painted it, scaled
 * to a card and kept on this device beside the document once the scene has
 * stayed still a moment — the atlas's rule (`use-atlas-cover.ts`). Never
 * fetches: it reads the scene's own canvas.
 */
export function useMosaicCover(docId: string, state: SceneState): void {
  const drawnFor = useRef<string | null>(null);
  useEffect(() => {
    if (state.status !== 'ready') return;
    const { scene } = state;
    const stamp = `${docId}:${scene.targetId}:${scene.shape.cols}:${scene.matching.ids.length}:${scene.matchMs}`;
    if (drawnFor.current === stamp) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      if (!alive) return;
      const canvas = document.createElement('canvas');
      canvas.width = COVER_W;
      canvas.height = COVER_H;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.imageSmoothingQuality = 'high';
      // A square or upright mosaic fills the card's 16:9 by its middle.
      const src = coverSource(scene.canvas.width, scene.canvas.height, COVER_W, COVER_H);
      ctx.drawImage(scene.canvas, src.x, src.y, src.w, src.h, 0, 0, COVER_W, COVER_H);
      canvas.toBlob(
        (blob) => {
          if (!alive || !blob) return;
          drawnFor.current = stamp;
          void putThumb(docId, blob);
        },
        'image/jpeg',
        0.85,
      );
    }, SETTLE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [docId, state]);
}
