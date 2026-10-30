// Ouverture « ligne »: a hairline draws from the centre outward, the title rises from behind
// a clip line, then « EP.00 · SAISON 1 » in mono.
import { appear, enter, fit, PAL, text, TYPO, type Ctx } from "../motion";

export function drawIntro(c: Ctx, lt: number, ep: { title: string; number: string; season?: number }) {
  const title = ep.title;
  const p = enter(lt, 0.2, 1.2),
    half = 380 * p;
  c.strokeStyle = PAL.dim;
  c.lineWidth = 2;
  c.beginPath();
  c.moveTo(540 - half, 1010);
  c.lineTo(540 + half, 1010);
  c.stroke();
  const q = enter(lt, 0.9, 1.2);
  c.save();
  c.beginPath();
  c.rect(0, 700, 1080, 300);
  c.clip();
  const z = fit(c, title, 860, 140, TYPO.hw, TYPO.fam);
  c.globalAlpha *= q;
  text(c, title, 540, 980 + (1 - q) * 150, z, PAL.ink, { align: "center" });
  c.restore();
  appear(c, enter(lt, 1.5, 1), () => text(c, `${ep.number} · SAISON ${ep.season ?? 1}`, 540, 1070, 28, PAL.dim, { fam: TYPO.mono, w: 400, align: "center", track: 5 }), 8);
}
