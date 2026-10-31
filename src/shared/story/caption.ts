// Captions « leve »: each line rises and fades in, staggered; words not yet said sit at 38 %.
import { CAPTION, type Cap } from "./charte";
import { clamp, E, font, K, PAL, text, TYPO, type Ctx } from "./motion";

type Word = { word: string; i: number; ww: number };
function wrapWords(c: Ctx, words: string[], max: number) {
  const lines: Word[][] = [[]];
  let w = 0;
  const sp = c.measureText(" ").width;
  words.forEach((word, i) => {
    const ww = c.measureText(word).width;
    if (lines[lines.length - 1].length && w + sp + ww > max) {
      lines.push([]);
      w = 0;
    }
    const L = lines[lines.length - 1];
    L.push({ word, i, ww });
    w += (L.length > 1 ? sp : 0) + ww;
  });
  return lines;
}

export function drawCaption(c: Ctx, cap: Cap, lt: number, sceneId = "") {
  if (!cap) return;
  const words = cap.text.split(" "),
    n = words.length,
    span = cap.b - cap.a;
  const inA = clamp((lt - cap.a) / CAPTION.fadeIn),
    outA = 1 - clamp((lt - cap.b) / CAPTION.fadeOut);
  const alpha = Math.min(inA, outA);
  if (alpha <= 0) return;
  if (CAPTION.scrim > 0 && CAPTION.scrimScenes.includes(sceneId)) {
    const mid = (CAPTION.scrimTop + CAPTION.scrimBottom) / 2;
    const g = c.createLinearGradient(0, CAPTION.scrimTop, 0, CAPTION.scrimBottom);
    g.addColorStop(0, "rgba(241,238,232,0)");
    g.addColorStop((mid - 60 - CAPTION.scrimTop) / (CAPTION.scrimBottom - CAPTION.scrimTop), PAL.bg);
    g.addColorStop((mid + 40 - CAPTION.scrimTop) / (CAPTION.scrimBottom - CAPTION.scrimTop), PAL.bg);
    g.addColorStop(1, "rgba(241,238,232,0)");
    c.save();
    c.globalAlpha = alpha * CAPTION.scrim;
    c.fillStyle = g;
    c.fillRect(0, CAPTION.scrimTop, 1080, CAPTION.scrimBottom - CAPTION.scrimTop);
    c.restore();
  }
  const fpos = ((lt - cap.a) / span) * n; // fractional index of the word being said
  const size = CAPTION.size;
  c.font = font(size, TYPO.hw, TYPO.fam);
  const lines = wrapWords(c, words, CAPTION.wrap),
    lh = size * CAPTION.lineHeight,
    top = CAPTION.baseline - (lines.length - 1) * lh;
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
