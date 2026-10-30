// `map-holes` — the route with GAPS: the days without a position are dotted at dim.
// fill = true: the route is already there, a second, slightly offset track in accent (Polarsteps)
// draws over the gaps, then a few small triangles (the drone's points) settle on the line; a
// legend at the bottom-left. {gaps: [[fracStart, fracEnd], ...], fill: boolean}
import { register } from "./index";
import { appear, clamp, enter, K, PAL, sineInOut, text, TYPO, type Ctx } from "../motion";
import { routeAt, STOPS } from "../geo";
import { drawCoast, mapLabels } from "../scenes/MapScene";
import { MAP_DY } from "./journey-impossible";

type Gap = [number, number];
const N = 480;
const inGap = (f: number, gaps: Gap[]) => gaps.some(([a, b]) => f >= a && f <= b);

/** the route up to `head`, solid in accent outside the gaps, dotted at dim inside them */
function holeyRoute(c: Ctx, head: number, gaps: Gap[], width: number, onlyGaps = false, dx = 0, dy = 0) {
  let i = 0;
  while (i < N) {
    const f0 = i / N;
    if (f0 >= head) break;
    const g = inGap(f0, gaps);
    let j = i;
    while (j < N && inGap(j / N, gaps) === g && j / N < head) j++;
    const fEnd = Math.min(j / N, head);
    if (!(onlyGaps && !g)) {
      c.save();
      c.beginPath();
      const s = routeAt(f0);
      c.moveTo(s[0] + dx, s[1] + dy);
      for (let k = i + 1; k <= j; k++) {
        const f = Math.min(k / N, fEnd);
        const q = routeAt(f);
        c.lineTo(q[0] + dx, q[1] + dy);
      }
      c.lineCap = "round";
      c.lineJoin = "round";
      if (onlyGaps) {
        c.strokeStyle = PAL.acc;
        c.lineWidth = width * 0.8;
      } else if (g) {
        c.strokeStyle = PAL.dim;
        c.lineWidth = width * 0.6;
        c.setLineDash([2, 9]);
      } else {
        c.strokeStyle = PAL.acc;
        c.lineWidth = width;
      }
      c.stroke();
      c.restore();
    }
    i = Math.max(j, i + 1);
  }
}

const tri = (c: Ctx, x: number, y: number, r: number) => {
  c.beginPath();
  c.moveTo(x, y - r);
  c.lineTo(x + r * 0.9, y + r * 0.6);
  c.lineTo(x - r * 0.9, y + r * 0.6);
  c.closePath();
  c.fill();
};

const legend = (c: Ctx, lt: number, t0: number, items: { kind: "line" | "dots" | "tri"; color: string; label: string }[]) => {
  appear(c, enter(lt, t0, 1), () => {
    let x = 90;
    const y = 1215;
    items.forEach((it) => {
      c.save();
      c.strokeStyle = it.color;
      c.fillStyle = it.color;
      c.lineWidth = 3;
      c.lineCap = "round";
      if (it.kind === "tri") tri(c, x + 14, y - 9, 10);
      else {
        if (it.kind === "dots") c.setLineDash([2, 7]);
        c.beginPath();
        c.moveTo(x, y - 9);
        c.lineTo(x + 30, y - 9);
        c.stroke();
      }
      c.restore();
      text(c, it.label, x + 44, y, 22, PAL.dim, { fam: TYPO.mono, w: 400 });
      c.font = `400 22px ${TYPO.mono}`;
      x += 44 + c.measureText(it.label).width + 44;
    });
  }, 8);
};

register("map-holes", (c, lt, p) => {
  const gaps = (Array.isArray(p.gaps) ? p.gaps : [[0.2, 0.3], [0.5, 0.58], [0.75, 0.85]]) as Gap[];
  const fill = Boolean(p.fill);
  c.save();
  c.translate(0, MAP_DY);
  drawCoast(c, enter(lt, 0, 0.9), 2.5);
  const W = 5;
  if (!fill) {
    const rp = sineInOut(clamp((lt - 0.5) / (3.4 * K)));
    holeyRoute(c, rp, gaps, W);
    // once the head has arrived, the last labels finish lighting up
    mapLabels(c, rp + enter(lt, 3.9, 0.8) * 0.2, 24, 0, false, [STOPS[STOPS.length - 1][0]]);
  } else {
    c.save();
    c.globalAlpha *= enter(lt, 0.1, 0.9);
    holeyRoute(c, 1, gaps, W);
    mapLabels(c, 1.2, 24, 0, false, [STOPS[STOPS.length - 1][0]]);
    c.restore();
    // Polarsteps: a second track, a few px aside, over the gaps
    const pp = sineInOut(clamp((lt - 0.9) / (2.4 * K)));
    holeyRoute(c, pp, gaps, W, true, 7, 7);
    // the drone's points, settling on the line
    const pts = [0.24, 0.54, 0.8];
    pts.forEach((f, i) => {
      const q = routeAt(f);
      appear(c, enter(lt, 3.1 + i * 0.22, 0.9), () => {
        c.fillStyle = PAL.ink;
        tri(c, q[0] + 7, q[1] + 7, 11);
      }, 14);
    });
  }
  c.restore();
  if (!fill) legend(c, lt, 2.4, [{ kind: "line", color: PAL.acc, label: "appareil" }, { kind: "dots", color: PAL.dim, label: "jours sans position" }]);
  else legend(c, lt, 1.6, [{ kind: "line", color: PAL.acc, label: "Polarsteps" }, { kind: "tri", color: PAL.ink, label: "drone" }]);
});
