// Mur de photos « unemille »: one tile, the camera pulls back ×6 → ×1 revealing the wall,
// tiles fading in by distance; then a 72 % background scrim, « 100 000 » and « photos ».
import { appear, clamp, E, enter, fit, K, PAL, rng, text, TYPO, type Ctx } from "../motion";

const R = rng(11);
type Tile = { warm: boolean; l: number; s: number; h0: number; delay: number };
export const TILES: Tile[] = Array.from({ length: 10 * 18 }, () => ({
  warm: R() < 0.62,
  l: 28 + R() * 30,
  s: 25 + R() * 30,
  h0: R(),
  delay: R(),
}));
export const tileColor = (tl: Tile, a = 1) => {
  const hue = tl.warm ? 14 + tl.h0 * 34 : 188 + tl.h0 * 26;
  return `hsla(${hue} ${tl.s}% ${tl.l}% / ${a})`;
};

export const COLS = 10,
  CELL = 1080 / COLS,
  ROWS = Math.ceil(1920 / CELL) + 1;

/** v2 deviation: one extra column on the left (col −1). The page's end framing is offset by
 * (54, −66) px, which left a bare 54 px strip on the left edge of the wall. */
export function drawTiles(c: Ctx, alphaOf: (col: number, r: number, tl: Tile) => number) {
  for (let r = 0; r < ROWS; r++)
    for (let col = -1; col < COLS; col++) {
      const tl = TILES[(r * COLS + ((col + COLS) % COLS)) % TILES.length],
        a = alphaOf(col, r, tl);
      if (a <= 0) continue;
      c.fillStyle = tileColor(tl, a);
      c.fillRect(col * CELL + 3, r * CELL + 3, CELL - 6, CELL - 6);
    }
}

export const HOOK_CI = 4,
  HOOK_RI = 9;
/** the wall at camera progress p (0 = one tile at ×6, 1 = the whole wall) */
export function drawWall(c: Ctx, p: number, centre: number) {
  const s = 6 - 5 * p,
    cx = HOOK_CI * CELL + CELL / 2,
    cy = HOOK_RI * CELL + CELL / 2;
  c.save();
  c.translate(540, 960);
  c.scale(s, s);
  c.translate(-cx, -cy);
  drawTiles(c, (col, r) =>
    col === HOOK_CI && r === HOOK_RI ? centre : clamp((p - 0.15 - Math.hypot(col - HOOK_CI, r - HOOK_RI) * 0.02) * 2.2),
  );
  c.restore();
}

export function drawHook(c: Ctx, lt: number, _p: Record<string, unknown> = {}) {
  const p = E(clamp((lt - 0.6 * K) / (2.4 * K)));
  drawWall(c, p, enter(lt, 0, 0.8));
  // the number, after the image has settled
  const sp = enter(lt, 2.0, 1.2);
  c.save();
  c.fillStyle = PAL.bg;
  c.globalAlpha *= 0.72 * sp;
  c.fillRect(0, 0, 1080, 1920);
  c.restore();
  appear(c, enter(lt, 2.3, 1.3), () => {
    const count = String(_p.count ?? "100 000");
    const z = fit(c, count, 860, 250, TYPO.hw, TYPO.fam);
    text(c, count, 540, 1000, z, PAL.ink, { align: "center" });
  }, 20);
  appear(c, enter(lt, 2.7, 1), () => text(c, String(_p.label ?? "photos"), 540, 1090, 56, PAL.acc, { w: TYPO.lw, align: "center" }), 12);
}
