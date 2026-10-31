// `season-recap` — the season's episodes, one row each: number in mono accent, title in Geist,
// a one-liner in dim; rows staggered, a thin dim rule between them, kept inside y 560–1240.
// {episodes: [{number, title, line}]}
import { register } from "./index";
import { appear, enter, fit, PAL, text, TYPO } from "../motion";

register("season-recap", (c, lt, p) => {
  const eps = (Array.isArray(p.episodes) ? p.episodes : []) as { number: string; title: string; line: string }[];
  const top = 560, bottom = 1240, rh = Math.min(96, (bottom - top) / Math.max(1, eps.length));
  eps.forEach((e, i) => {
    const y = top + i * rh;
    appear(c, enter(lt, 0.2 + i * 0.18, 1), () => {
      text(c, e.number, 90, y + 44, 22, PAL.acc, { fam: TYPO.mono, w: 400, track: 3 });
      const z = fit(c, e.title, 560, 34, TYPO.hw, TYPO.fam);
      text(c, e.title, 220, y + 44, z, PAL.ink);
      const zl = fit(c, e.line, 760, 24, TYPO.lw, TYPO.fam);
      text(c, e.line, 220, y + 76, zl, PAL.dim, { w: TYPO.lw });
      if (i < eps.length - 1) {
        c.save();
        c.fillStyle = PAL.dim;
        c.globalAlpha *= 0.3;
        c.fillRect(90, y + rh - 4, 900, 1.5);
        c.restore();
      }
    }, 14);
  });
});
