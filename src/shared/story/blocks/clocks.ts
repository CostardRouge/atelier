// `clocks` — two clock faces side by side, the second's hour hand turning to show the offset;
// under them a day line with a midnight tick, and a few photo tiles sliding from the morning
// of the day to the evening of the day before. {zoneA, zoneB, offsetHours, pctWrong}
import { register } from "./index";
import { appear, enter, PAL, rr, text, TYPO, type Ctx } from "../motion";

const face = (c: Ctx, cx: number, cy: number, r: number, hourDeg: number, minDeg: number) => {
  c.save();
  c.strokeStyle = PAL.ink;
  c.lineWidth = 2;
  c.beginPath();
  c.arc(cx, cy, r, 0, 7);
  c.stroke();
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2, big = i % 3 === 0;
    c.save();
    c.globalAlpha *= big ? 0.9 : 0.45;
    c.lineWidth = big ? 2.5 : 1.5;
    c.beginPath();
    c.moveTo(cx + Math.sin(a) * (r - (big ? 18 : 10)), cy - Math.cos(a) * (r - (big ? 18 : 10)));
    c.lineTo(cx + Math.sin(a) * (r - 4), cy - Math.cos(a) * (r - 4));
    c.stroke();
    c.restore();
  }
  const hand = (deg: number, len: number, w: number) => {
    const a = (deg * Math.PI) / 180;
    c.lineWidth = w;
    c.lineCap = "round";
    c.beginPath();
    c.moveTo(cx - Math.sin(a) * 14, cy + Math.cos(a) * 14);
    c.lineTo(cx + Math.sin(a) * len, cy - Math.cos(a) * len);
    c.stroke();
  };
  hand(hourDeg, r * 0.55, 5);
  hand(minDeg, r * 0.82, 3);
  c.fillStyle = PAL.ink;
  c.beginPath();
  c.arc(cx, cy, 5, 0, 7);
  c.fill();
  c.restore();
};

const hhmm = (h: number, m: number) => `${String(((h % 24) + 24) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`;

register("clocks", (c, lt, p) => {
  const zoneA = String(p.zoneA ?? "SYDNEY"), zoneB = String(p.zoneB ?? "PARIS");
  const off = Number(p.offsetHours ?? 10), pct = p.pctWrong != null ? String(p.pctWrong) : "";
  const h0 = 23, m0 = 40; // the home time; the camera's clock is `off` hours ahead
  const minDeg = (m0 / 60) * 360, hourB = ((h0 + m0 / 60) / 12) * 360;
  const turn = enter(lt, 1.0, 2.4); // the hour hand of zone A turning forward by the offset
  const hourA = hourB + turn * (off / 12) * 360;
  const R = 150, cy = 720, xa = 300, xb = 780;
  appear(c, enter(lt, 0, 1.1), () => {
    face(c, xa, cy, R, hourA, minDeg);
    text(c, zoneA, xa, cy + R + 56, 24, PAL.dim, { fam: TYPO.mono, w: 400, align: "center", track: 5 });
  }, 16);
  appear(c, enter(lt, 0.25, 1.1), () => {
    face(c, xb, cy, R, hourB, minDeg);
    text(c, zoneB, xb, cy + R + 56, 24, PAL.dim, { fam: TYPO.mono, w: 400, align: "center", track: 5 });
  }, 16);
  // the two times, once the hand has settled
  appear(c, enter(lt, 0.6, 1), () => text(c, hhmm(h0, m0), xb, cy + R + 100, 30, PAL.ink, { fam: TYPO.mono, w: 400, align: "center" }), 8);
  appear(c, enter(lt, 3.0, 1), () => text(c, hhmm(h0 + off, m0), xa, cy + R + 100, 30, PAL.acc, { fam: TYPO.mono, w: 400, align: "center" }), 8);
  // the day line
  const ly = 1090;
  appear(c, enter(lt, 1.6, 1), () => {
    c.strokeStyle = PAL.dim;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(120, ly);
    c.lineTo(960, ly);
    c.stroke();
    c.strokeStyle = PAL.ink;
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(540, ly - 16);
    c.lineTo(540, ly + 16);
    c.stroke();
    text(c, "MINUIT", 540, ly + 48, 20, PAL.ink, { fam: TYPO.mono, w: 400, align: "center", track: 4 });
    text(c, "11 FÉV.", 300, ly + 48, 20, PAL.dim, { fam: TYPO.mono, w: 400, align: "center", track: 4 });
    text(c, "12 FÉV.", 780, ly + 48, 20, PAL.dim, { fam: TYPO.mono, w: 400, align: "center", track: 4 });
  }, 10);
  // the morning photos, sliding onto the day before
  const hues = [22, 196, 38, 204];
  hues.forEach((h, i) => {
    const a = enter(lt, 2.0 + i * 0.1, 0.9);
    if (a <= 0) return;
    const s = enter(lt, 3.0 + i * 0.12, 1.3);
    const x = 592 + i * 58 - s * 330;
    c.save();
    c.globalAlpha *= a;
    c.fillStyle = `hsl(${h} 32% 58%)`;
    rr(c, x, ly - 62, 46, 46, 6);
    c.fill();
    c.restore();
  });
  if (pct) appear(c, enter(lt, 4.3, 1), () => text(c, `${pct} %`, 90, 1222, 44, PAL.acc, { w: TYPO.lw }), 10);
});
