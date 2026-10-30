// Dossiers « colonnes »: Finder column view. Window, three columns arriving from the right
// with a fade, rows staggered, selection at accent 22 % on 2026 then 2026-02, the four card
// folders with counts, the breadcrumb, then « 8 940 photos à trier ce mois-ci ».
import { appear, enter, K, PAL, rr, text, TYPO, type Ctx } from "../motion";

/** a Finder folder, drawn calmly: no scale pop */
export function folder(c: Ctx, cx: number, cy: number, w: number, open = 0) {
  const h = w * 0.8,
    x = cx - w / 2,
    y = cy - h / 2,
    r = w * 0.06,
    top = y + h * 0.2 + open * h * 0.2,
    sp = open * w * 0.05;
  const back = c.createLinearGradient(0, y, 0, y + h);
  back.addColorStop(0, "#7fc0ee");
  back.addColorStop(1, "#4a9bd8");
  c.fillStyle = back;
  rr(c, x, y, w * 0.42, h * 0.22, r * 0.8);
  c.fill();
  rr(c, x, y + h * 0.09, w, h * 0.91, r);
  c.fill();
  if (open > 0) {
    c.fillStyle = "#f3f5f7";
    rr(c, x + w * 0.07, y + h * 0.16 - open * h * 0.12, w * 0.86, h * 0.55, r * 0.5);
    c.fill();
  }
  const fg = c.createLinearGradient(0, top, 0, y + h);
  fg.addColorStop(0, "#a2dafc");
  fg.addColorStop(1, "#5eb0e9");
  c.fillStyle = fg;
  c.beginPath();
  c.moveTo(x - sp + r, top);
  c.lineTo(x + w + sp - r, top);
  c.quadraticCurveTo(x + w + sp, top, x + w + sp, top + r);
  c.lineTo(x + w, y + h - r);
  c.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  c.lineTo(x + r, y + h);
  c.quadraticCurveTo(x, y + h, x, y + h - r);
  c.lineTo(x - sp, top + r);
  c.quadraticCurveTo(x - sp, top, x - sp + r, top);
  c.closePath();
  c.fill();
  c.strokeStyle = "rgba(255,255,255,.9)";
  c.lineWidth = Math.max(1.5, w * 0.018);
  c.beginPath();
  c.moveTo(x - sp + r, top + 1.5);
  c.lineTo(x + w + sp - r, top + 1.5);
  c.stroke();
}

export const CARDS: [string, string][] = [
  ["SONY A7 V", "3 412"],
  ["DJI MINI", "1 288"],
  ["iPhone", "2 631"],
  ["GoPro", "1 609"],
];

/** the path line, its last segment cross-fading */
function crumb(c: Ctx, lt: number, steps: [number, string][]) {
  const shown = steps.filter((s) => lt >= s[0] * K);
  const last = shown[shown.length - 1];
  if (!last) return;
  appear(c, enter(lt, last[0], 0.8), () => text(c, last[1], 90, 470, 30, PAL.dim, { fam: TYPO.mono, w: 400 }), 6);
}

type ColParam = { items: string[]; sel?: number; counts?: string[] };

export function drawFolders(c: Ctx, lt: number, _p: Record<string, unknown> = {}) {
  // optional params: {columns?: [{items, sel?, counts?}], path?: string[], footnote?: string}
  // — with none, the lab's fixed 2026 › 2026-02 › cards view.
  const pCols = Array.isArray(_p.columns) ? (_p.columns as ColParam[]) : null;
  const pPath = Array.isArray(_p.path) ? (_p.path as string[]) : null;
  const footnote = _p.footnote === undefined ? "8 940 photos à trier ce mois-ci" : String(_p.footnote);
  const x0 = 70,
    y0 = 540,
    w = 830,
    h = 640, // v2 deviation: the lab's 760 put « 8 940 photos… » (y 1370) under the caption
    cw = w / 3;
  appear(c, enter(lt, 0, 1), () => {
    c.fillStyle = PAL.soft;
    rr(c, x0, y0, w, h, 22);
    c.fill();
    c.save();
    c.strokeStyle = PAL.dim;
    c.globalAlpha *= 0.35;
    c.lineWidth = 1.5;
    rr(c, x0, y0, w, h, 22);
    c.stroke();
    c.restore();
    for (let i = 0; i < 3; i++) {
      c.save();
      c.fillStyle = PAL.dim;
      c.globalAlpha *= 0.55;
      c.beginPath();
      c.arc(x0 + 34 + i * 30, y0 + 32, 9, 0, 7);
      c.fill();
      c.restore();
    }
    for (let i = 1; i < (pCols ? pCols.length : 3); i++) {
      c.save();
      c.fillStyle = PAL.dim;
      c.globalAlpha *= 0.25;
      c.fillRect(x0 + i * cw, y0 + 64, 1.5, h - 64);
      c.restore();
    }
  }, 10);
  const cols: { t0: number; items: string[]; counts?: string[]; sel: number; selAt?: number }[] = pCols
    ? pCols.map((col, i) => ({
        t0: 0.2 + i * 1.2,
        items: col.items,
        counts: col.counts,
        sel: col.sel ?? -1,
        selAt: col.sel !== undefined && col.sel >= 0 ? 0.2 + i * 1.2 + 0.9 : undefined,
      }))
    : [
        { t0: 0.2, items: ["2024", "2025", "2026"], sel: 2, selAt: 1.0 },
        { t0: 1.3, items: ["2026-01", "2026-02", "2026-03", "2026-04", "2026-05"], sel: 1, selAt: 2.3 },
        { t0: 2.6, items: CARDS.map((x) => x[0]), counts: CARDS.map((x) => x[1]), sel: -1 },
      ];
  cols.forEach((col, ci) => {
    const p = enter(lt, col.t0, 1.1);
    if (p <= 0) return;
    c.save();
    c.globalAlpha *= p;
    c.translate((1 - p) * 40, 0);
    col.items.forEach((name, i) => {
      const ry = y0 + 92 + i * (col.counts ? 92 : 64),
        rx = x0 + ci * cw + 14;
      const ip = enter(lt, col.t0 + i * 0.08, 0.9);
      if (ip <= 0) return;
      c.save();
      c.globalAlpha *= ip;
      if (i === col.sel && col.selAt !== undefined) {
        const sp = enter(lt, col.selAt, 0.6);
        c.save();
        c.fillStyle = PAL.acc;
        c.globalAlpha *= 0.22 * sp;
        rr(c, rx - 6, ry - 6, cw - 16, 52, 10);
        c.fill();
        c.restore();
      }
      folder(c, rx + 22, ry + 20, 38, 0);
      text(c, name, rx + 54, ry + 31, 27, PAL.ink, { fam: TYPO.sys, w: 400 });
      if (col.counts) text(c, col.counts[i] + " photos", rx + 54, ry + 66, 22, PAL.dim, { fam: TYPO.mono, w: 400 });
      else if (c.measureText(name).width < cw - 100) text(c, "›", x0 + (ci + 1) * cw - 28, ry + 31, 28, PAL.dim, { fam: TYPO.sys, w: 400 }); // no chevron under a long name
      c.restore();
    });
    c.restore();
  });
  if (pPath) {
    // path[0] at once, then each segment when the matching column's selection lands
    const steps: [number, string][] = [];
    pPath.forEach((_, i) => {
      const at = i === 0 ? 0 : cols[i - 1]?.selAt ?? 0.2 + (i - 1) * 1.2 + 0.9;
      steps.push([at, pPath.slice(0, i + 1).join(" › ")]);
    });
    crumb(c, lt, steps);
  } else {
    crumb(c, lt, [
      [0, "Photos"],
      [1.0, "Photos › 2026"],
      [2.3, "Photos › 2026 › 2026-02"],
    ]);
  }
  if (footnote) appear(c, enter(lt, 3.6, 1), () => text(c, footnote, 90, 1250, 32, PAL.ink, { fam: TYPO.fam, w: TYPO.lw }), 10);
}
