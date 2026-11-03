// Captions « leve »: each line rises and fades in, staggered; words not yet said sit at 38 %.
import { CAPTION, type Cap } from "./charte";
import { clamp, E, font, K, PAL, text, TYPO, type Ctx } from "./motion";
import { captionLook, layCaption, type CaptionLook } from "./caption-layout";
import { styleOf } from "./objects";

/** The series' caption layout (`caption-layout.ts`), set per frame by `compose.ts`; absent = the defaults. */
let LOOK: CaptionLook = captionLook();
export function setCaptionLook(given: Partial<CaptionLook> | null | undefined) {
  LOOK = captionLook(given);
}

export function drawCaption(c: Ctx, cap: Cap, lt: number, sceneId = "") {
  if (!cap) return;
  const words = cap.text.split(/\s+/).filter(Boolean),
    n = words.length,
    span = cap.b - cap.a;
  const inA = clamp((lt - cap.a) / CAPTION.fadeIn),
    outA = 1 - clamp((lt - cap.b) / CAPTION.fadeOut);
  const alpha = Math.min(inA, outA);
  if (alpha <= 0) return;
  if (CAPTION.scrim > 0 && CAPTION.scrimScenes.includes(sceneId)) {
    const mid = (CAPTION.scrimTop + CAPTION.scrimBottom) / 2;
    const g = c.createLinearGradient(0, CAPTION.scrimTop, 0, CAPTION.scrimBottom);
    const clear = `${PAL.bg}00`;
    g.addColorStop(0, clear);
    g.addColorStop((mid - 60 - CAPTION.scrimTop) / (CAPTION.scrimBottom - CAPTION.scrimTop), PAL.bg);
    g.addColorStop((mid + 40 - CAPTION.scrimTop) / (CAPTION.scrimBottom - CAPTION.scrimTop), PAL.bg);
    g.addColorStop(1, clear);
    c.save();
    c.globalAlpha = alpha * CAPTION.scrim;
    c.fillStyle = g;
    c.fillRect(0, CAPTION.scrimTop, 1080, CAPTION.scrimBottom - CAPTION.scrimTop);
    c.restore();
  }
  const fpos = ((lt - cap.a) / span) * n; // fractional index of the word being said
  // Laid like the hook (`caption-layout.ts`): the series' column, its line limit, the platforms' buttons as an
  // edge — the Studio's move counted, so a caption dragged down stops above the band.
  const measure = (w: string, z: number) => {
    c.font = font(z, TYPO.hw, TYPO.fam);
    return c.measureText(w).width;
  };
  const laid = layCaption(cap.text, measure, LOOK, { x: CAPTION.x, baseline: CAPTION.baseline, size: CAPTION.size, lineHeight: CAPTION.lineHeight }, styleOf("caption").dy ?? 0);
  const size = laid.size;
  c.font = font(size, TYPO.hw, TYPO.fam);
  const lines = laid.lines,
    lh = laid.lineHeight,
    top = laid.top;
  const space = c.measureText(" ").width;
  lines.forEach((L, li) => {
    const lp = E(clamp((lt - cap.a - li * CAPTION.stagger) / (CAPTION.lineDur * K)));
    let x = CAPTION.x;
    const y = top + li * lh + (1 - lp) * CAPTION.lineRise;
    L.forEach((o) => {
      const wa = CAPTION.unsaid + (1 - CAPTION.unsaid) * clamp((fpos - o.i) * 1.6 + 0.2);
      c.save();
      c.globalAlpha = alpha * lp * wa;
      text(c, o.word, x, y, size, PAL.ink);
      c.restore();
      x += o.ww + space;
    });
  });
}
