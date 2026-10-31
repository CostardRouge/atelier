// Carte « camera »: zoomed ×2.3 following the route head (sine in-out), then the camera
// pulls back to the whole map over the last 1.4 s. Coast dim, route accent, stops as reached.
import { clamp, E, enter, K, PAL, sineInOut, text, TYPO, type Ctx } from "../motion";
import { coastPaths, ROUTE, routeAt, STOP_REACH, STOP_XY, STOPS } from "../geo";

/** the coastline at dim, for every map-based block (alpha and width in map units) */
export function drawCoast(c: Ctx, alpha: number, width: number) {
  if (alpha <= 0) return;
  c.save();
  c.globalAlpha *= alpha;
  c.strokeStyle = PAL.dim;
  c.lineJoin = "round";
  c.lineWidth = width;
  coastPaths().forEach((p) => c.stroke(p));
  c.restore();
}

export function drawRoute(c: Ctx, frac: number, width: number) {
  const h = routeAt(frac);
  c.beginPath();
  c.moveTo(ROUTE[0][0], ROUTE[0][1]);
  for (let i = 1; i <= h[2]; i++) c.lineTo(ROUTE[i][0], ROUTE[i][1]);
  c.lineTo(h[0], h[1]);
  c.strokeStyle = PAL.acc;
  c.lineWidth = width;
  c.lineCap = "round";
  c.lineJoin = "round";
  c.stroke();
  return h;
}

/** tail: extra alpha once the route is complete, so the LAST stop (reach = 1) gets its label too */
export function mapLabels(c: Ctx, frac: number, size: number, tail = 0, spread = false, skip: string[] = []) {
  STOPS.forEach((st, i) => {
    const reach = STOP_REACH[i] ?? 1;
    const a = clamp((frac - reach) * 8 + (i === 0 ? 1 : 0) + tail);
    if (a <= 0) return;
    const [x, y] = STOP_XY[i];
    // at ×1 two stops 20 px apart (Cairns, Daintree) would share a label line: the later one goes above
    const dy = spread && i > 0 && Math.hypot(x - STOP_XY[i - 1][0], y - STOP_XY[i - 1][1]) < 60 ? -22 : 8;
    c.save();
    c.globalAlpha *= a;
    c.fillStyle = PAL.bg;
    c.beginPath();
    c.arc(x, y, 9, 0, 7);
    c.fill();
    c.strokeStyle = PAL.acc;
    c.lineWidth = 3;
    c.stroke();
    const right = x < 700;
    if (!skip.includes(st[0])) text(c, st[0], x + (right ? 20 : -20), y + dy, size, PAL.ink, { fam: TYPO.mono, w: 400, align: right ? "left" : "right" });
    c.restore();
  });
}

export function drawMap(c: Ctx, lt: number, _p: Record<string, unknown> = {}) {
  // {still: true}: no camera — the whole map at ×1, the full route tracing calmly over ~4.4 s.
  const still = _p.still === true;
  const rp = still ? clamp((lt - 0.4) / (4.4 * K)) : clamp((lt - 0.3) / (3.6 * K)),
    zp = still ? 1 : E(clamp((lt - 3.6 * K) / (1.4 * K))),
    head = routeAt(sineInOut(rp));
  const s = 2.3 - 1.3 * zp,
    fx = head[0] + (540 - head[0]) * zp,
    fy = head[1] + (900 - head[1]) * zp;
  c.save();
  c.translate(540, 900);
  c.scale(s, s);
  c.translate(-fx, -fy);
  c.save();
  c.globalAlpha *= enter(lt, 0, 0.8);
  c.strokeStyle = PAL.dim;
  c.lineJoin = "round";
  c.lineWidth = (2.5 / s) * 1.4;
  coastPaths().forEach((p) => c.stroke(p));
  c.restore();
  drawRoute(c, sineInOut(rp), (5 / s) * 1.6);
  mapLabels(c, sineInOut(rp), still ? 26 : (26 / s) * 1.3, still ? E(clamp((lt - 4.6 * K) / (0.9 * K))) : 0, still);
  c.restore();
}
