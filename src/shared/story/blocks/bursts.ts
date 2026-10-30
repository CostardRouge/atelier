// `bursts` — a row of n near-identical frames (same hue, tiny variations) that slide and fold
// calmly into one stack; the elected one stays in front with a thin accent frame and « 1 / n ».
// {n}
import { register } from "./index";
import { appear, clamp, E, enter, K, PAL, rng, rr, text, TYPO } from "../motion";

register("bursts", (c, lt, p) => {
  const n = Math.max(2, Number(p.n ?? 9));
  const elected = Math.floor(n / 2);
  const R = rng(23);
  const vars = Array.from({ length: n }, () => ({ dl: (R() - 0.5) * 5, dx: (R() - 0.5) * 8, dy: (R() - 0.5) * 6, dr: (R() - 0.5) * 2 }));
  // the row: n tiles across 900 px, centred, at y 880
  const gap = 10, tw = (900 - gap * (n - 1)) / n, rowY = 880, x0 = 90;
  // the stack: tiles grow to 300 px at the centre, 900
  const big = 300, cx = 540, cy = 880;
  const tile = (x: number, y: number, w: number, i: number, a: number) => {
    const v = vars[i];
    c.save();
    c.globalAlpha *= a;
    c.translate(x + w / 2, y + w / 2);
    c.rotate((v.dr * Math.PI) / 180 * (w / big));
    rr(c, -w / 2, -w / 2, w, w, w * 0.06);
    c.clip();
    const g = c.createLinearGradient(0, -w / 2, 0, w / 2);
    g.addColorStop(0, `hsl(196 34% ${66 + v.dl}%)`);
    g.addColorStop(0.55, `hsl(200 30% ${58 + v.dl}%)`);
    g.addColorStop(0.56, `hsl(26 40% ${44 + v.dl}%)`);
    g.addColorStop(1, `hsl(22 38% ${36 + v.dl}%)`);
    c.fillStyle = g;
    c.fillRect(-w / 2, -w / 2, w, w);
    // the subject: one small figure, a few pixels off from one frame to the next
    c.fillStyle = `hsl(20 20% ${22 + v.dl}%)`;
    const sx = (v.dx / 100) * w, sy = (v.dy / 100) * w;
    c.beginPath();
    c.arc(w * 0.12 + sx, w * 0.06 + sy, w * 0.07, 0, 7);
    c.fill();
    rr(c, w * 0.12 + sx - w * 0.06, w * 0.12 + sy, w * 0.12, w * 0.2, w * 0.03);
    c.fill();
    c.restore();
  };
  // 1. the row arrives, staggered
  // 2. from 1.8 s the tiles fold into the stack, the farthest first, the elected one last
  const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => Math.abs(b - elected) - Math.abs(a - elected));
  order.forEach((i) => {
    const a = enter(lt, 0.2 + i * 0.08, 0.9);
    if (a <= 0) return;
    const rank = order.indexOf(i); // 0 = farthest from the elected one
    const f = E(clamp((lt - (1.8 + rank * 0.1) * K) / (1.5 * K)));
    const rx = x0 + i * (tw + gap), ry = rowY - tw / 2;
    const w = tw + (big - tw) * f;
    const k = i - elected;
    const tx = cx - big / 2 + k * 7, ty = cy - big / 2 - Math.abs(k) * 5; // a thin fan behind
    const x = rx + (tx - rx) * f, y = ry + (ty - ry) * f;
    const under = i === elected ? 1 : 1 - 0.55 * f; // the others dim as they go behind
    appear(c, a, () => tile(x, y, w, i, under), 24);
  });
  // 3. the elected one gets its frame and its count
  appear(c, enter(lt, 3.5, 0.9), () => {
    c.strokeStyle = PAL.acc;
    c.lineWidth = 3;
    rr(c, cx - big / 2 - 10, cy - big / 2 - 10, big + 20, big + 20, 24);
    c.stroke();
  }, 6);
  appear(c, enter(lt, 3.8, 0.9), () => text(c, `1 / ${n}`, cx, cy + big / 2 + 70, 28, PAL.dim, { fam: TYPO.mono, w: 400, align: "center", track: 4 }), 8);
});
