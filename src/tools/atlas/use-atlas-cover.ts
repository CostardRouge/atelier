import { useEffect, useRef } from 'react';
import { ensureFontFaces } from '../../shared/overlay/fonts';
import { HUD_FONT_FACES, paintAtlas, type PaintScene } from './atlas-paint';
import type { AtlasDoc } from './atlas-doc';
import type { AtlasView } from './atlas-view';
import { putThumb } from './atlas-store';
import type { SceneCore } from './use-atlas-scene';

/** The cover's size: a gallery card's 4:3, drawn twice for a sharp screen. */
const COVER_W = 640;
const COVER_H = 480;
/** How long the atlas must stay still before its cover is drawn again. */
const SETTLE_MS = 2500;

/**
 * The gallery card's COVER: the atlas's own poster (every route drawn whole,
 * in its look — his pick in the gallery lab), painted by the export's painter
 * at a card's shape and size once the atlas has stayed still a moment, and kept on this
 * device beside it. No tiles — the cover never fetches. Not drawn while logs
 * are missing, so a cover never shows half an atlas.
 */
export function useAtlasCover(doc: AtlasDoc, core: SceneCore, viewAt: (t: number) => AtlasView, ready: boolean): void {
  const drawnFor = useRef<string | null>(null);
  const latest = useRef({ core, viewAt });
  latest.current = { core, viewAt };
  const stamp = `${doc.id}:${doc.updatedAt}`;

  useEffect(() => {
    if (!ready || drawnFor.current === stamp || core.flights.length === 0) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void (async () => {
        const { core: c, viewAt: at } = latest.current;
        const s = c.settings;
        // Drawn AT the card's shape rather than cropped to it: a title in a corner stays whole.
        const w = COVER_W;
        const h = COVER_H;
        try {
          const ts = s.hud.theme.style;
          await ensureFontFaces([...HUD_FONT_FACES, `${ts.italic ? 'italic ' : ''}${ts.weight} 32px '${ts.fontFamily}'`]);
          if (!alive) return;
          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          const scene: PaintScene = { ...c, tiles: null, focus: null };
          const t = c.story.intro + c.story.flights;
          paintAtlas(ctx, scene, { t, view: at(t), width: w, height: h, poster: true });
          const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
          if (blob && alive && (await putThumb(doc.id, blob))) drawnFor.current = stamp;
        } catch {
          /* no cover this time: the card says so, and the next change tries again */
        }
      })();
    }, SETTLE_MS);
    return () => {
      alive = false;
      window.clearTimeout(timer);
    };
  }, [stamp, ready, core.flights.length, doc.id]);
}
