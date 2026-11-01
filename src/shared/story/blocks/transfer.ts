// `transfer` — a memory card → the NAS: a long thin line filling over ~3.5 s, file names
// streaming under it in mono, then the total in Geist. {card, total, prefix?, ext?}
import { word, numberText } from "../locale";
import { register } from "./index";
import { appear, clamp, E, enter, K, PAL, rr, text, TYPO, type Ctx } from "../motion";
import { obj } from "../objects";

const fr = (n: number) => numberText(n);

function card(c: Ctx, x: number, y: number, label: string) {
  // a rounded rect with the top-right corner notched
  const w = 150, h = 200, r = 14, n = 30;
  c.fillStyle = PAL.ink;
  c.beginPath();
  c.moveTo(x + r, y);
  c.lineTo(x + w - n, y);
  c.lineTo(x + w, y + n);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x, y + r);
  c.quadraticCurveTo(x, y, x + r, y);
  c.closePath();
  c.fill();
  c.fillStyle = PAL.bg;
  rr(c, x + 18, y + 54, w - 36, 92, 8); c.fill(); // the label area
  for (let i = 0; i < 7; i++) c.fillRect(x + 22 + i * 16, y + h - 26, 9, 14); // the contacts
  // two lines at most: the first word, then the rest (« SONY » / « A7C II »)
  const sp = label.indexOf(" ");
  const lines = sp > 0 ? [label.slice(0, sp), label.slice(sp + 1)] : [label];
  lines.forEach((l, i) => text(c, l, x + w / 2, y + (lines.length === 1 ? 108 : 92) + i * 32, 22, PAL.ink, { fam: TYPO.mono, w: 400, align: "center" }));
}

function nas(c: Ctx, x: number, y: number, on: number) {
  const w = 160, h = 260;
  c.fillStyle = PAL.ink; rr(c, x, y, w, h, 16); c.fill();
  [0, 1].forEach((i) => {
    const by = y + 42 + i * 84;
    c.fillStyle = PAL.bg; rr(c, x + 22, by, w - 44, 58, 6); c.fill();
    c.fillStyle = PAL.ink; rr(c, x + 34, by + 22, w - 68, 6, 3); c.fill();
    // activity light, breathing while the copy runs
    c.fillStyle = on > 0 ? PAL.acc : PAL.dim; c.beginPath(); c.arc(x + w - 40, by + 46, 5, 0, 7); c.fill();
  });
  c.fillStyle = PAL.bg; rr(c, x + 40, y + h - 36, w - 80, 8, 4); c.fill();
}

register("transfer", (c, lt, p) => {
  const label = String(p.card ?? "CARD"), total = Number(p.total ?? 1000);
  const prefix = String(p.prefix ?? "DSC0"), ext = String(p.ext ?? ".ARW");
  const yL = 900, x0 = 300, x1 = 790;
  const T0 = 0.9, DUR = 3.5;
  // Each part reads the copy's progress on its own clock (an object may be delayed, `objects.ts`).
  const progress = (lt: number) => E(clamp((lt - T0 * K) / (DUR * K)));
  obj(c, "transfer.card", [195, 900], lt, (lt) => appear(c, enter(lt, 0.1, 1), () => card(c, 120, yL - 100, label), 16), 0.1);
  obj(c, "transfer.nas", [900, 900], lt, (lt) => {
    const u = progress(lt);
    appear(c, enter(lt, 0.4, 1), () => nas(c, 820, yL - 130, u > 0 && u < 1 ? 1 : 0), 16);
  }, 0.4);
  // the line: a dim track, the accent fill
  obj(c, "transfer.line", [545, yL], lt, (lt) => {
    const u = progress(lt);
    appear(c, enter(lt, 0.6, 0.8), () => {
      c.save();
      c.strokeStyle = PAL.dim; c.globalAlpha *= 0.5; c.lineWidth = 2; c.lineCap = "round";
      c.beginPath(); c.moveTo(x0, yL); c.lineTo(x1, yL); c.stroke();
      c.restore();
      if (u > 0) {
        c.strokeStyle = PAL.acc; c.lineWidth = 3; c.lineCap = "round";
        c.beginPath(); c.moveTo(x0, yL); c.lineTo(x0 + (x1 - x0) * u, yL); c.stroke();
      }
    }, 0);
  }, 0.6);
  // file names streaming under the line: a new one every STEP s, the last four stacked
  const STEP = 0.16;
  obj(c, "transfer.files", [540, yL + 120], lt, (lt) => {
    if (progress(lt) >= 1) return;
    const cur = Math.floor((lt - T0 * K) / (STEP * K));
    for (let i = Math.max(0, cur - 3); i <= cur; i++) {
      const age = (lt - T0 * K - i * STEP * K) / (STEP * K); // 0 at birth, 1 when the next arrives
      const a = clamp(age * 1.6) * clamp(1 - (age - 1) / 3);
      if (a <= 0) continue;
      const num = Math.round(1000 + (i * STEP) / DUR * total * 1.0) % 10000;
      const name = prefix + String(num).padStart(4, "0") + ext;
      c.save(); c.globalAlpha *= a * (i === cur ? 1 : 0.55);
      text(c, name, 540, yL + 70 + (cur - i) * 34 - clamp(age) * 0 , 22, i === cur ? PAL.ink : PAL.dim, { fam: TYPO.mono, w: 400, align: "center" });
      c.restore();
    }
  }, T0 * K);
  // the count, moving with the line, then the total in Geist
  obj(c, "transfer.count", [545, yL - 34], lt, (lt) => {
    const u = progress(lt);
    if (!(u > 0 && u < 1)) return;
    c.save(); c.globalAlpha *= 0.8;
    text(c, fr(Math.round(total * u)) + " / " + fr(total), 545, yL - 28, 20, PAL.dim, { fam: TYPO.mono, w: 400, align: "center" });
    c.restore();
  }, T0 * K);
  obj(c, "transfer.total", [540, yL + 252], lt, (lt) => appear(c, enter(lt, T0 + DUR + 0.1, 1), () => text(c, `${fr(total)} ${word("files")}`, 540, yL + 270, 56, PAL.ink, { align: "center" }), 14), T0 + DUR + 0.1);
  obj(c, "transfer.copied", [540, yL + 308], lt, (lt) => appear(c, enter(lt, T0 + DUR + 0.4, 1), () => text(c, word("copied"), 540, yL + 318, 32, PAL.acc, { align: "center", w: TYPO.lw }), 10), T0 + DUR + 0.4);
});
