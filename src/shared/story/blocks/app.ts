// `app` — a calm app window (the author's own sorting tool, never named on screen).
// {kind: 'cards' | 'grid', title?, items, flag?}
//  cards: items = [{title, sub, stops?: string[]}] — one card per folder with its stops as tiles
//  grid:  items = number of thumbnails, marks?: string of ✓ – ⊘ per cell (optional), picks?: number[]
import { register } from "./index";
import { appear, enter, PAL, rng, rr, text, TYPO } from "../motion";

const win = (c: CanvasRenderingContext2D, lt: number, x: number, y: number, w: number, h: number, title: string) => {
  appear(c, enter(lt, 0, 1), () => {
    c.fillStyle = PAL.soft; rr(c, x, y, w, h, 22); c.fill();
    c.save(); c.strokeStyle = PAL.dim; c.globalAlpha *= 0.35; c.lineWidth = 1.5; rr(c, x, y, w, h, 22); c.stroke(); c.restore();
    c.save(); c.globalAlpha *= 0.55; c.fillStyle = PAL.dim; [0, 1, 2].forEach((i) => { c.beginPath(); c.arc(x + 34 + i * 30, y + 32, 9, 0, 7); c.fill(); }); c.restore();
    if (title) text(c, title, x + w / 2, y + 41, 24, PAL.dim, { fam: TYPO.mono, w: 400, align: "center" });
  }, 10);
};

register("app", (c, lt, p) => {
  // h: optional window height (default 760 → bottom at 1300); a 3-line caption starts at ≈ 1265,
  // so an episode whose content ends early passes a shorter one (e.g. 660 → 1200).
  const x = 70, y = 540, w = 940, h = Number(p.h ?? 760);
  win(c, lt, x, y, w, h, String(p.title ?? ""));
  if (p.kind === "grid") {
    const n = Number(p.items ?? 24), cols = 6, cell = (w - 40) / cols, R = rng(7);
    const marks = typeof p.marks === "string" ? (p.marks as string) : "";
    const picks = Array.isArray(p.picks) ? (p.picks as number[]) : [];
    for (let i = 0; i < n; i++) {
      const col = i % cols, row = Math.floor(i / cols), cx = x + 20 + col * cell, cy = y + 76 + row * cell;
      const a = enter(lt, 0.3 + i * 0.05, 0.9); if (a <= 0) continue;
      const warm = R() < 0.6, hue = warm ? 14 + R() * 34 : 188 + R() * 26;
      c.save(); c.globalAlpha = a;
      c.fillStyle = `hsl(${hue} ${25 + R() * 30}% ${50 + R() * 25}%)`; rr(c, cx + 4, cy + 4, cell - 8, cell - 8, 8); c.fill();
      const m = marks[i]; const mk = enter(lt, 2.2 + i * 0.07, 0.6);
      if (m && m !== " " && mk > 0) { c.globalAlpha = a * mk; c.fillStyle = m === "✓" ? PAL.acc : PAL.bg; c.beginPath(); c.arc(cx + cell - 24, cy + 24, 14, 0, 7); c.fill(); text(c, m, cx + cell - 24, cy + 31, 20, m === "✓" ? PAL.bg : PAL.dim, { fam: TYPO.mono, w: 700, align: "center" }); }
      if (picks.includes(i)) { const pk = enter(lt, 2.0 + i * 0.05, 0.8); c.globalAlpha = a * pk; c.strokeStyle = PAL.acc; c.lineWidth = 4; rr(c, cx + 2, cy + 2, cell - 4, cell - 4, 10); c.stroke(); }
      c.restore();
    }
    if (p.flag) appear(c, enter(lt, 2.8, 1), () => { c.fillStyle = PAL.acc; rr(c, x + 24, y + h - 78, 24 + String(p.flag).length * 15, 48, 24); c.fill(); text(c, String(p.flag), x + 36, y + h - 46, 24, PAL.bg, { fam: TYPO.mono, w: 400 }); }, 8);
  } else {
    const items = (Array.isArray(p.items) ? p.items : []) as { title: string; sub?: string; stops?: string[] }[];
    let cy = y + 80;
    items.forEach((it, i) => {
      const a = enter(lt, 0.4 + i * 0.25, 1); const ch = it.stops?.length ? 230 : 110;
      if (a > 0) { c.save(); c.globalAlpha = a; c.translate(0, (1 - a) * 14);
        c.fillStyle = PAL.bg; rr(c, x + 20, cy, w - 40, ch - 16, 14); c.fill();
        text(c, it.title, x + 44, cy + 46, 30, PAL.ink, { fam: TYPO.sys, w: 400 });
        if (it.sub) text(c, it.sub, x + 44, cy + 82, 22, PAL.dim, { fam: TYPO.mono, w: 400 });
        (it.stops ?? []).forEach((s, j) => { const sx = x + 44 + j * 214, sa = enter(lt, 1.2 + i * 0.25 + j * 0.12, 0.8); if (sa <= 0 || j > 3) return;
          c.save(); c.globalAlpha = a * sa; c.fillStyle = PAL.soft; rr(c, sx, cy + 104, 198, 92, 10); c.fill(); text(c, s, sx + 14, cy + 160, 22, PAL.ink, { fam: TYPO.sys, w: 400 }); c.restore(); });
        c.restore(); }
      cy += ch;
    });
    if (p.flag) appear(c, enter(lt, 2.8, 1), () => text(c, String(p.flag), x + 44, y + h - 40, 26, PAL.acc, { fam: TYPO.mono, w: 400 }), 8);
  }
});
