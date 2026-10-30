// `before-after` — two states, a soft wipe between them: {before, after, label?}
// Each side: an eyebrow (AVANT / APRÈS) and one or two lines of text (string or string[]).
import { register } from "./index";
import { appear, clamp, E, enter, fit, K, PAL, text, TYPO } from "../motion";

const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [String(v ?? "")]);
register("before-after", (c, lt, p) => {
  const before = lines(p.before), after = lines(p.after), label = p.label ? String(p.label) : "";
  const w = E(clamp((lt - 2.0 * K) / (1.4 * K))); // the wipe
  const draw = (eyebrow: string, ls: string[], color: string, y0: number) => {
    text(c, eyebrow, 90, y0, 26, PAL.dim, { fam: TYPO.mono, w: 400, track: 5 });
    ls.forEach((l, i) => { const z = fit(c, l, 900, i === 0 ? 96 : 60, i === 0 ? TYPO.hw : TYPO.lw, TYPO.fam); text(c, l, 90, y0 + 110 + i * 84, z, color); });
  };
  // before, fading out as the wipe advances
  c.save(); c.globalAlpha = enter(lt, 0.2, 1) * (1 - w); c.translate(0, -w * 20); draw("AVANT", before, PAL.dim, 760); c.restore();
  // after, revealed by a rising edge
  if (w > 0) {
    c.save(); c.beginPath(); c.rect(0, 700 + (1 - w) * 500, 1080, 500); c.clip(); c.globalAlpha = w;
    draw("APRÈS", after, PAL.ink, 760); c.restore();
    c.fillStyle = PAL.acc; c.globalAlpha = w * (1 - E(clamp((lt - 3.6 * K) / (0.8 * K)))); c.fillRect(90, 700 + (1 - w) * 500, 900, 2); c.globalAlpha = 1;
  }
  if (label) appear(c, enter(lt, 3.4, 1), () => text(c, label, 90, 1250, 32, PAL.dim, { w: TYPO.lw }), 8);
});
