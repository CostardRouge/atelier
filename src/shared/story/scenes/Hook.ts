// Mur de photos « unemille »: one tile, the camera pulls back ×6 → ×1 revealing the wall,
// tiles fading in by distance; then a 72 % background scrim, « 100 000 » and « photos ».
// The grid — columns, rows, gap, corners, big pictures, order, the camera's end — is the
// series' look (`wall-grid.ts`); its default is this wall as it was first drawn.
import { word, numberText } from "../locale";
import { appear, clamp, E, enter, fit, font, K, PAL, rng, text, TYPO, type Ctx } from "../motion";
import { pictureFor, wallGrid, wallLayout, type WallGrid, type WallGroup, type WallRect } from "../wall-grid";

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

/**
 * The author's own pictures for the tiles (`compose.ts` sets them from the
 * series' counted `tiles`, `wall-cache.ts`), square and in day order; a tile
 * without one keeps its colour. Empty = the invented colours, as before.
 */
let WALL: readonly (CanvasImageSource | null)[] = [];
export function setWall(images: readonly (CanvasImageSource | null)[] | null | undefined) {
  WALL = images ?? [];
}

/** The series' grid (`wall-grid.ts`) and its groups, set with the pictures by `compose.ts` and `cover.ts`. */
let GRID: Partial<WallGrid> | null = null;
let GROUPS: readonly WallGroup[] | null = null;
export function setWallGrid(grid: Partial<WallGrid> | null | undefined, groups?: readonly WallGroup[] | null) {
  GRID = grid ?? null;
  GROUPS = groups?.length ? groups : null;
}

/** A band's name on its first picture: a paper chip, mono capitals, sized to the cell. */
function drawBandLabel(c: Ctx, label: string, x: number, y: number, cellH: number) {
  const size = Math.max(16, Math.min(36, cellH * 0.22));
  const pad = size * 0.45;
  c.font = font(size, 500, TYPO.mono);
  c.letterSpacing = `${size * 0.08}px`;
  const shown = label.toUpperCase();
  const w = c.measureText(shown).width + pad * 2;
  c.fillStyle = PAL.bg;
  c.globalAlpha *= 0.9;
  c.beginPath();
  c.roundRect(x + pad, y + pad, w, size + pad * 1.4, size * 0.3);
  c.fill();
  c.globalAlpha /= 0.9;
  c.fillStyle = PAL.ink;
  c.textAlign = 'left';
  c.textBaseline = 'middle';
  c.fillText(shown, x + pad * 2, y + pad + (size + pad * 1.4) / 2);
  c.letterSpacing = '0px';
}

/** The picture, cropped from its centre to the place's shape (the cache keeps squares). */
function drawPicture(c: Ctx, img: CanvasImageSource, x: number, y: number, w: number, h: number) {
  const iw = (img as { width: number }).width || 1;
  const ih = (img as { height: number }).height || 1;
  const k = Math.min(iw / w, ih / h);
  const sw = w * k;
  const sh = h * k;
  c.drawImage(img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, w, h);
}

export function drawTiles(c: Ctx, alphaOf: (rect: WallRect, i: number) => number) {
  const g = wallGrid(GRID);
  const groups = g.group !== 'none' ? GROUPS : null;
  const { rects, cellH } = wallLayout(g, groups?.map((x) => x.n));
  const inset = g.gap / 2;
  const total = groups ? groups.reduce((n, x) => n + x.n, 0) : 0;
  const heads: [string, number, number, number][] = [];
  rects.forEach((rect, i) => {
    const a = alphaOf(rect, i);
    if (a <= 0) return;
    const x = rect.x + inset,
      y = rect.y + inset,
      w = rect.w - g.gap,
      h = rect.h - g.gap;
    if (w <= 0 || h <= 0) return;
    // A grouped wall's place names its picture among the counted ones; those map onto what is loaded.
    const at = rect.pic !== undefined && total ? pictureFor(rect.pic, total, WALL.length) : pictureFor(i, rects.length, WALL.length);
    const img = at >= 0 ? WALL[at] : null;
    c.save();
    if (g.radius > 0) {
      c.beginPath();
      c.roundRect(x, y, w, h, Math.min(g.radius, w / 2, h / 2));
      c.clip();
    }
    if (img) {
      c.globalAlpha *= Math.min(1, a);
      drawPicture(c, img, x, y, w, h);
    } else {
      c.fillStyle = tileColor(TILES[i % TILES.length], a);
      c.fillRect(x, y, w, h);
    }
    c.restore();
    if (groups && g.labels && rect.head && rect.band !== undefined && groups[rect.band]) heads.push([groups[rect.band].label, x, y, a]);
  });
  // The names after every picture, so no neighbour paints over a long one.
  for (const [label, x, y, a] of heads) {
    c.save();
    c.globalAlpha *= Math.min(1, a);
    drawBandLabel(c, label, x, y, cellH);
    c.restore();
  }
}

/** the wall at camera progress p (0 = the centre picture filling most of the frame, 1 = the whole wall at its zoom) */
export function drawWall(c: Ctx, p: number, centre: number) {
  const g = wallGrid(GRID);
  const { cellW } = wallLayout(g);
  // The camera starts with the centre picture 648 px wide — ×6 on the default's 108 px cell.
  const s0 = Math.max(g.zoom, 648 / cellW);
  const s = s0 + (g.zoom - s0) * p;
  c.save();
  c.translate(540, 960);
  c.scale(s, s);
  c.translate(-540, -960);
  drawTiles(c, (rect) => (rect.centre ? centre : clamp((p - 0.15 - rect.d * 0.02) * 2.2)));
  c.restore();
}

export function drawHook(c: Ctx, lt: number, _p: Record<string, unknown> = {}) {
  const p = E(clamp((lt - 0.6 * K) / (2.4 * K)));
  // Under a post's hook (`hook.ts`) the wall is the picture only: its one photo there from the first frame,
  // no veil and no number — the hook's words are on it.
  const quiet = _p.quiet === true;
  drawWall(c, p, quiet ? 1 : enter(lt, 0, 0.8));
  if (quiet) return;
  // the number, after the image has settled
  const sp = enter(lt, 2.0, 1.2);
  c.save();
  c.fillStyle = PAL.bg;
  c.globalAlpha *= 0.72 * sp;
  c.fillRect(0, 0, 1080, 1920);
  c.restore();
  appear(c, enter(lt, 2.3, 1.3), () => {
    // A counted fact arrives as a number (`story-facts.ts`): written the way the series writes numbers.
    const count = typeof _p.count === "number" ? numberText(_p.count) : String(_p.count ?? numberText(100000));
    const z = fit(c, count, 860, 250, TYPO.hw, TYPO.fam);
    text(c, count, 540, 1000, z, PAL.ink, { align: "center" });
  }, 20);
  appear(c, enter(lt, 2.7, 1), () => text(c, String(_p.label ?? word("photos")), 540, 1090, 56, PAL.acc, { w: TYPO.lw, align: "center" }), 12);
}
