// `card-recovery` — an SD card drawn large, a file row under it that fades to 15 % behind a thin
// strike line, holds, then comes back to full with a calm accent check. {file}
import { register } from "./index";
import { appear, clamp, E, enter, K, PAL, rr, text, TYPO } from "../motion";

register("card-recovery", (c, lt, p) => {
  const file = String(p.file ?? "DSC08801.ARW");
  // the card: 320 × 400, a chamfered top-right corner and a small notch on the left edge
  const x = 380, y = 560, w = 320, h = 400, r = 22, ch = 56;
  appear(c, enter(lt, 0.1, 1.1), () => {
    c.beginPath();
    c.moveTo(x + r, y);
    c.lineTo(x + w - ch, y);
    c.lineTo(x + w, y + ch);
    c.lineTo(x + w, y + h - r);
    c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    c.lineTo(x + r, y + h);
    c.quadraticCurveTo(x, y + h, x, y + h - r);
    c.lineTo(x, y + 150);
    c.lineTo(x + 14, y + 140);
    c.lineTo(x + 14, y + 92);
    c.lineTo(x, y + 82);
    c.lineTo(x, y + r);
    c.quadraticCurveTo(x, y, x + r, y);
    c.closePath();
    c.fillStyle = PAL.soft;
    c.fill();
    c.save();
    c.strokeStyle = PAL.dim;
    c.globalAlpha *= 0.45;
    c.lineWidth = 2;
    c.stroke();
    c.restore();
    // the contacts, a row of thin bars along the top
    c.save();
    c.fillStyle = PAL.dim;
    c.globalAlpha *= 0.5;
    for (let i = 0; i < 8; i++) c.fillRect(x + 36 + i * 28, y + 12, 14, 34);
    c.restore();
    // the label
    c.fillStyle = PAL.bg;
    rr(c, x + 40, y + 190, w - 80, 150, 14);
    c.fill();
    text(c, "128 GB", x + w / 2, y + 258, 30, PAL.ink, { fam: TYPO.mono, w: 400, align: "center", track: 3 });
    c.save();
    c.fillStyle = PAL.dim;
    c.globalAlpha *= 0.5;
    c.fillRect(x + 70, y + 292, w - 140, 2);
    c.restore();
  }, 20);
  // the file row: a small tile and the name, under the card
  const ry = 1090, rx = 250;
  const gone = E(clamp((lt - 1.6 * K) / (1.0 * K))), back = E(clamp((lt - 3.4 * K) / (1.1 * K)));
  const level = 1 - 0.85 * gone * (1 - back);
  appear(c, enter(lt, 0.7, 1), () => {
    c.save();
    c.globalAlpha *= level;
    const g = c.createLinearGradient(0, ry - 32, 0, ry + 32);
    g.addColorStop(0, "hsl(196 34% 64%)");
    g.addColorStop(0.55, "hsl(200 30% 56%)");
    g.addColorStop(0.56, "hsl(26 40% 44%)");
    g.addColorStop(1, "hsl(22 38% 36%)");
    c.fillStyle = g;
    rr(c, rx, ry - 32, 64, 64, 8);
    c.fill();
    text(c, file, rx + 96, ry + 12, 34, PAL.ink, { fam: TYPO.mono, w: 400, track: 2 });
    c.restore();
    // the strike line, drawn as the file fades, erased as it comes back
    c.font = `400 34px ${TYPO.mono}`;
    c.letterSpacing = "2px";
    const tw = c.measureText(file).width;
    c.letterSpacing = "0px";
    const sl = gone * (1 - back);
    if (sl > 0) {
      c.save();
      c.fillStyle = PAL.dim;
      c.globalAlpha *= 0.8 * clamp(sl * 1.6);
      c.fillRect(rx + 96, ry - 1, tw * clamp(sl * 1.3), 2);
      c.restore();
    }
  }, 14);
  // a calm accent check, once the file is back
  appear(c, enter(lt, 4.3, 0.9), () => {
    c.strokeStyle = PAL.acc;
    c.lineWidth = 3;
    c.lineCap = "round";
    c.lineJoin = "round";
    const kx = 860, ky = ry;
    c.beginPath();
    c.arc(kx, ky, 22, 0, 7);
    c.stroke();
    c.beginPath();
    c.moveTo(kx - 10, ky + 1);
    c.lineTo(kx - 3, ky + 8);
    c.lineTo(kx + 11, ky - 7);
    c.stroke();
  }, 8);
});
