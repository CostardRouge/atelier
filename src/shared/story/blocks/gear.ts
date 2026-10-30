// `gear` — a calm stagger of device silhouettes (simple rounded shapes, no logos):
// {devices: [{name, note?, kind: 'camera'|'small'|'drone'|'phone'|'compact'}]}
// Three on the first row, the rest on a second; label in Geist, a one-word note in mono.
import { register } from "./index";
import { appear, enter, PAL, rr, text, TYPO, type Ctx } from "../motion";

type Kind = "camera" | "small" | "drone" | "phone" | "compact";
type Device = { name: string; note?: string; kind: Kind };

const lens = (c: Ctx, x: number, y: number, r: number) => {
  c.fillStyle = PAL.bg; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  c.fillStyle = PAL.ink; c.beginPath(); c.arc(x, y, r * 0.66, 0, 7); c.fill();
  c.fillStyle = PAL.bg; c.beginPath(); c.arc(x, y, r * 0.3, 0, 7); c.fill();
};

/** each silhouette is centred on (0, 0), about 160 px wide at most */
const SHAPES: Record<Kind, (c: Ctx) => void> = {
  camera: (c) => {
    c.fillStyle = PAL.ink;
    rr(c, -78, -48, 156, 96, 14); c.fill(); // body
    rr(c, -62, -62, 40, 20, 6); c.fill(); // viewfinder bump
    rr(c, 30, -58, 28, 12, 4); c.fill(); // hot shoe
    lens(c, 0, 4, 34);
    c.fillStyle = PAL.bg; rr(c, 44, -34, 22, 6, 3); c.fill(); // a dial
  },
  small: (c) => {
    c.fillStyle = PAL.ink;
    rr(c, -62, -40, 124, 80, 12); c.fill();
    rr(c, 20, -50, 26, 12, 4); c.fill();
    lens(c, -4, 2, 27);
    c.fillStyle = PAL.bg; rr(c, 34, -28, 18, 5, 2); c.fill();
  },
  drone: (c) => {
    c.strokeStyle = PAL.ink; c.lineWidth = 5; c.lineCap = "round";
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sy]) => {
      c.beginPath(); c.moveTo(sx * 18, sy * 10); c.lineTo(sx * 58, sy * 34); c.stroke();
      c.beginPath(); c.arc(sx * 64, sy * 38, 22, 0, 7); c.stroke();
    });
    c.fillStyle = PAL.ink; rr(c, -34, -20, 68, 40, 12); c.fill();
    c.fillStyle = PAL.bg; c.beginPath(); c.arc(-18, 10, 6, 0, 7); c.fill(); // the gimbal
  },
  phone: (c) => {
    c.fillStyle = PAL.ink; rr(c, -31, -62, 62, 124, 14); c.fill();
    c.fillStyle = PAL.bg; rr(c, -24, -54, 48, 108, 8); c.fill();
    c.fillStyle = PAL.ink; rr(c, -8, -50, 16, 5, 2.5); c.fill(); // the island
    c.beginPath(); c.arc(-14, -40, 5, 0, 7); c.fill(); c.beginPath(); c.arc(-14, -26, 5, 0, 7); c.fill(); // two lenses
  },
  compact: (c) => {
    c.fillStyle = PAL.ink; rr(c, -52, -32, 104, 64, 10); c.fill();
    lens(c, 2, 0, 22);
    c.fillStyle = PAL.bg; rr(c, -40, -20, 12, 6, 3); c.fill(); // the flash
    rr(c, 30, -22, 14, 5, 2.5); c.fill();
  },
};

register("gear", (c, lt, p) => {
  const devices = (Array.isArray(p.devices) ? p.devices : []) as Device[];
  const first = devices.slice(0, 3), second = devices.slice(3);
  const rows: { items: Device[]; y: number }[] = [{ items: first, y: 720 }];
  if (second.length) rows.push({ items: second, y: 1030 });
  let k = 0;
  rows.forEach((row) => {
    const n = row.items.length;
    row.items.forEach((d, i) => {
      const x = n === 1 ? 540 : n >= 3 ? 210 + i * 330 : 375 + i * 330;
      const t0 = 0.3 + k * 0.22; k++;
      appear(c, enter(lt, t0, 1.1), () => {
        c.save(); c.translate(x, row.y); (SHAPES[d.kind] ?? SHAPES.camera)(c); c.restore();
      }, 18);
      appear(c, enter(lt, t0 + 0.25, 1), () => text(c, d.name, x, row.y + 118, 28, PAL.ink, { align: "center", w: 500 }), 10);
      if (d.note) appear(c, enter(lt, t0 + 0.55, 1), () => text(c, d.note!, x, row.y + 154, 20, PAL.dim, { align: "center", fam: TYPO.mono, w: 400 }), 8);
    });
  });
});
