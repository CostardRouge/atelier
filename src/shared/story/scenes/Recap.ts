// Fin « suivant »: « ÉPISODE SUIVANT » in mono, « L’arrivée » big, a short accent rule, « EP.01 ».
import { appear, enter, fit, PAL, rr, text, TYPO, type Ctx } from "../motion";

export function drawRecap(c: Ctx, lt: number, p: { next: { number: string; title: string; thumb?: CanvasImageSource | null } }) {
  // The next post's cover, when it exists: the continuity a series lives on.
  const thumb = p.next.thumb;
  if (thumb) {
    appear(c, enter(lt, 0.05, 1.1), () => {
      const w = 252, h = 448, x = 540 - w / 2, y = 290;
      c.save();
      c.shadowColor = "rgba(24,25,28,.18)";
      c.shadowBlur = 30;
      c.shadowOffsetY = 10;
      rr(c, x, y, w, h, 18);
      c.fillStyle = PAL.bg;
      c.fill();
      c.shadowColor = "transparent";
      c.clip();
      c.drawImage(thumb, x, y, w, h);
      c.restore();
      c.strokeStyle = PAL.deep;
      c.lineWidth = 2;
      rr(c, x, y, w, h, 18);
      c.stroke();
    }, 12);
  }
  appear(c, enter(lt, 0.2, 1), () => text(c, "ÉPISODE SUIVANT", 540, 820, 28, PAL.dim, { fam: TYPO.mono, w: 400, align: "center", track: 6 }), 8);
  appear(c, enter(lt, 0.6, 1.4), () => {
    const z = fit(c, p.next.title, 860, 170, TYPO.hw, TYPO.fam);
    text(c, p.next.title, 540, 990, z, PAL.ink, { align: "center" });
  }, 18);
  appear(c, enter(lt, 1.3, 1), () => {
    c.fillStyle = PAL.acc;
    c.fillRect(500, 1040, 80, 3);
    text(c, p.next.number, 540, 1110, 30, PAL.acc, { fam: TYPO.mono, w: 400, align: "center", track: 4 });
  }, 8);
}

// Fin « carte » (the lab's third variant), used by the season's last episode only:
// the series mark, its name, the account, and a lot of air.
export function drawRecapCarte(c: Ctx, lt: number, p: { series?: string; handle?: string; ask?: string } = {}) {
  const series = p.series ?? "", handle = p.handle ?? "", ask = p.ask ?? "";
  appear(c, enter(lt, 0.2, 1.2), () => {
    c.strokeStyle = PAL.acc; c.lineWidth = 3;
    c.beginPath(); c.arc(540, 780, 46, 0, 7); c.stroke();
    c.beginPath(); c.moveTo(510, 800); c.lineTo(540, 752); c.lineTo(570, 800); c.stroke();
  }, 10);
  appear(c, enter(lt, 0.6, 1.3), () => {
    const z = fit(c, series, 860, 96, TYPO.hw, TYPO.fam);
    text(c, series, 540, 960, z, PAL.ink, { align: "center" });
  }, 14);
  appear(c, enter(lt, 1.1, 1), () => text(c, handle, 540, 1040, 32, PAL.dim, { fam: TYPO.mono, w: 400, align: "center" }), 8);
  appear(c, enter(lt, 1.8, 1), () => text(c, ask, 540, 1240, 30, PAL.dim, { w: TYPO.lw, align: "center" }), 8);
}
