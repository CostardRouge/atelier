// `journey-impossible` — the map at dim, a photo dot at one place, then the same dot at another
// place a minute later, a thin dotted line between them and a calm flag « horloge fausse ».
// {from, to, km} — from/to are names from geo's STOPS (both must be on the map).
import { register } from "./index";
import { appear, clamp, E, enter, K, PAL, rr, text, TYPO, type Ctx } from "../motion";
import { proj, STOPS } from "../geo";
import { drawCoast } from "../scenes/MapScene";

export const MAP_DY = -80; // the whole map lifted so Tasmania stays above the caption zone

const where = (name: string): [number, number] => {
  const s = STOPS.find((x) => x[0] === name) ?? STOPS[0];
  return proj(s[1], s[2]);
};

const dot = (c: Ctx, x: number, y: number, label: string, right: boolean) => {
  c.fillStyle = PAL.bg;
  c.beginPath();
  c.arc(x, y, 11, 0, 7);
  c.fill();
  c.strokeStyle = PAL.acc;
  c.lineWidth = 3;
  c.stroke();
  c.fillStyle = PAL.acc;
  c.beginPath();
  c.arc(x, y, 4, 0, 7);
  c.fill();
  text(c, label, x + (right ? 24 : -24), y + 9, 26, PAL.ink, { fam: TYPO.mono, w: 400, align: right ? "left" : "right" });
};

register("journey-impossible", (c, lt, p) => {
  const from = String(p.from ?? STOPS[0][0]), to = String(p.to ?? STOPS[STOPS.length - 1][0]), km = String(p.km ?? "");
  const A = where(from), B = where(to);
  c.save();
  c.translate(0, MAP_DY);
  drawCoast(c, enter(lt, 0, 0.9), 2.5);
  appear(c, enter(lt, 0.6, 1), () => dot(c, A[0], A[1], `${from} · 09:40`, A[0] < 700), 12);
  // the line, drawn from A to B
  const lp = E(clamp((lt - 2.0 * K) / (1.1 * K)));
  if (lp > 0) {
    c.save();
    c.strokeStyle = PAL.acc;
    c.lineWidth = 2;
    c.setLineDash([3, 10]);
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(A[0], A[1]);
    c.lineTo(A[0] + (B[0] - A[0]) * lp, A[1] + (B[1] - A[1]) * lp);
    c.stroke();
    c.restore();
  }
  appear(c, enter(lt, 2.8, 1), () => dot(c, B[0], B[1], `${to} · 09:41`, B[0] < 700), 12);
  c.restore();
  appear(c, enter(lt, 3.1, 1), () => text(c, `${km} km · 1 minute`, 90, 1150, 30, PAL.dim, { fam: TYPO.mono, w: 400 }), 8);
  appear(c, enter(lt, 3.8, 1), () => {
    const s = "horloge fausse";
    c.font = `400 26px ${TYPO.mono}`;
    const w = c.measureText(s).width + 48;
    c.fillStyle = PAL.acc;
    rr(c, 90, 1178, w, 52, 26);
    c.fill();
    text(c, s, 114, 1213, 26, PAL.bg, { fam: TYPO.mono, w: 400 });
  }, 10);
});
