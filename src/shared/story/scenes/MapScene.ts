// Carte « camera »: zoomed ×2.3 following the route head (sine in-out), then the camera
// pulls back to the whole map over the last 1.4 s. Coast dim, route accent, stops as reached.
import { clamp, E, enter, K, PAL, sineInOut, text, TYPO, type Ctx } from "../motion";
import { HEAD, NAMED, PACE_VERSION, paced, ROUTE, ROUTELEN, routeAt, STOP_REACH, STOP_XY, STOPS } from "../geo";
import { drawGround, groundCredit } from "../map-ground";
import { frameScale, storyCamera, storyCameraTrack, type StoryCameraValues } from "../story-camera";
import type { CameraTrack } from "../../roadtrip/hooks/drive-plan";
import { obj } from "../objects";

/** the map's ground — the coastline at dim, the tiles, or nothing (`map-ground.ts`) — for every map-based block (alpha and width in map units) */
export function drawCoast(c: Ctx, alpha: number, width: number) {
  drawGround(c, alpha, width);
}

/**
 * The tiles' credit, as the licence asks, on the frames that draw them and no
 * other — an object of its own (`map.credit`), one for every map block, so
 * its place, face and size are set once for the series. Drawn in the frame's
 * pixels, outside the map's camera.
 */
export function drawMapCredit(c: Ctx, lt: number, from = 0) {
  const credit = groundCredit();
  if (!credit) return;
  obj(c, "map.credit", [880, 1214], lt, (lt) => {
    c.save();
    // In ink, not the muted tone: over the tiles the muted one all but vanished (seen headless).
    c.globalAlpha *= enter(lt, from, 0.8) * 0.75;
    text(c, credit, 1010, 1222, 20, PAL.ink, { fam: TYPO.mono, w: 400, align: "right" });
    c.restore();
  }, from);
}

/**
 * The tip of the route as it is drawn, as the series' pace says: nothing
 * (before), a dot, or an arrow along the road — its direction read over a
 * stretch of road either side, so a bend of the line never jerks it.
 */
export function drawHead(c: Ctx, frac: number, size: number) {
  if (HEAD === "none" || frac <= 0) return;
  const [x, y] = routeAt(frac);
  c.save();
  c.fillStyle = PAL.acc;
  c.strokeStyle = PAL.bg;
  c.lineWidth = size * 0.28;
  if (HEAD === "dot") {
    c.beginPath();
    c.arc(x, y, size * 0.6, 0, 7);
    c.fill();
    c.stroke();
  } else {
    const reach = (size * 3) / Math.max(1, ROUTELEN);
    const a = routeAt(Math.max(0, frac - reach));
    const b = routeAt(Math.min(1, frac + reach));
    const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
    c.translate(x, y);
    c.rotate(angle);
    c.beginPath();
    c.moveTo(size, 0);
    c.lineTo(-size * 0.7, size * 0.65);
    c.lineTo(-size * 0.35, 0);
    c.lineTo(-size * 0.7, -size * 0.65);
    c.closePath();
    c.stroke();
    c.fill();
  }
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

/**
 * The stops' names. Which carry one is the series' (`NAMED`, `map-names.ts`):
 * every one, those the route has reached, only the latest reached, the first
 * and last, or none. A name has two lines: what it says, then smaller and
 * muted its second line. `tail` adds alpha once the route is complete, so the
 * LAST stop (reach = 1) gets its name too; `skip` leaves names out by text.
 */
export function mapLabels(c: Ctx, frac: number, size: number, tail = 0, spread = false, skip: string[] = [], upright = 0) {
  const n = STOPS.length;
  STOPS.forEach((st, i) => {
    const reach = STOP_REACH[i] ?? 1;
    // Reached: the dot (and, under « those passed », the name) arrives as the route gets there.
    const reached = clamp((frac - reach) * 8 + (i === 0 ? 1 : 0) + tail);
    const next = i < n - 1 ? clamp((frac - (STOP_REACH[i + 1] ?? 1)) * 8) : 0;
    const named =
      NAMED === "none" ? 0
      : NAMED === "all" ? 1
      : NAMED === "ends" ? (i === 0 ? 1 : i === n - 1 ? reached : 0)
      : NAMED === "current" ? reached * (1 - next)
      : reached;
    const a = Math.max(reached, NAMED === "all" ? 1 : 0);
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
    const shown = named > 0 && !skip.includes(st[0]);
    if (shown && (st[0] || st[4])) {
      c.globalAlpha *= named / a;
      if (upright) {
        // A map turned with the heading: the name turns back about its dot, so it reads level.
        c.translate(x, y);
        c.rotate(upright);
        c.translate(-x, -y);
      }
      const tx = x + (right ? 20 : -20);
      const align = right ? "left" : "right";
      text(c, st[0], tx, y + dy, size, PAL.ink, { fam: TYPO.mono, w: 400, align });
      if (st[4]) text(c, st[4], tx, y + dy + size * 0.95, size * 0.72, PAL.dim, { fam: TYPO.mono, w: 400, align });
    }
    c.restore();
  });
}

/** The baked track of the camera in force, for the route on the map now — one per route, camera and tempo. */
let baked: { route: unknown; key: string; track: CameraTrack } | null = null;
function trackFor(cam: StoryCameraValues, seconds: number, progress: (t: number) => number): CameraTrack {
  const key = `${JSON.stringify(cam)}|${seconds}|${PACE_VERSION}`;
  if (baked && baked.route === ROUTE && baked.key === key) return baked.track;
  const track = storyCameraTrack(cam, seconds, (t) => {
    const h = routeAt(paced(sineInOut(progress(t))));
    return { x: h[0], y: h[1] };
  });
  baked = { route: ROUTE, key, track };
  return track;
}

export function drawMap(c: Ctx, lt: number, _p: Record<string, unknown> = {}) {
  // {still: true}: no camera — the whole map at ×1, the full route tracing calmly over ~4.4 s.
  const still = _p.still === true;
  const rp = still ? clamp((lt - 0.4) / (4.4 * K)) : clamp((lt - 0.3) / (3.6 * K)),
    zp = still ? 1 : E(clamp((lt - 3.6 * K) / (1.4 * K))),
    head = routeAt(paced(sineInOut(rp)));
  const progress = (lt: number) => (still ? clamp((lt - 0.4) / (4.4 * K)) : clamp((lt - 0.3) / (3.6 * K)));
  // The series' camera (`story-camera.ts`, Trips' own engine), or — none chosen — the one of before:
  // ×2.3 on the head, pulled back to the whole map over the last 1.4 s.
  const cam = still ? null : storyCamera();
  let s: number, fx: number, fy: number, turn = 0;
  if (cam) {
    const f = trackFor(cam, 0.3 + 5 * K, progress).at(lt);
    s = frameScale(f);
    fx = f.centre.x;
    fy = f.centre.y;
    turn = f.angle;
  } else {
    s = 2.3 - 1.3 * zp;
    fx = head[0] + (540 - head[0]) * zp;
    fy = head[1] + (900 - head[1]) * zp;
  }
  c.save();
  c.translate(540, 900);
  if (turn) c.rotate(turn);
  c.scale(s, s);
  c.translate(-fx, -fy);
  // Under the camera, three objects: the coast, the route and the named stops (each on its own clock).
  obj(c, "map-camera.coast", [fx, fy], lt, (lt) => {
    drawGround(c, enter(lt, 0, 0.8), (2.5 / s) * 1.4);
  }, 0);
  // The route's fraction drawn: the scene's eased clock, warped by the series' pace (`route-pace.ts`).
  const drawn = (lt: number) => paced(sineInOut(progress(lt)));
  obj(c, "map-camera.route", [fx, fy], lt, (lt) => {
    drawRoute(c, drawn(lt), (5 / s) * 1.6);
    drawHead(c, drawn(lt), still ? 16 : (16 / s) * 1.3);
  });
  obj(c, "map-camera.stops", [fx, fy], lt, (lt) => {
    // Names stay upright when the map turns with the heading.
    mapLabels(c, drawn(lt), still ? 26 : (26 / s) * 1.3, still ? E(clamp((lt - 4.6 * K) / (0.9 * K))) : 0, still, [], -turn);
  });
  c.restore();
  drawMapCredit(c, lt);
}
