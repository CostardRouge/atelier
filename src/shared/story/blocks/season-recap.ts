// `season-recap` — the season's episodes, one row each: number in mono accent, title in Geist,
// a one-liner in dim; rows staggered, a thin dim rule between them, kept inside y 560–1240.
// {episodes: [{number, title, line}]}
import { register } from "./index";
import { appear, enter, fit, PAL, text, TYPO } from "../motion";
import { obj } from "../objects";

register("season-recap", (c, lt, p) => {
  const eps = (Array.isArray(p.episodes) ? p.episodes : []) as { number: string; title: string; line: string }[];
  const top = 560, bottom = 1240, rh = Math.min(96, (bottom - top) / Math.max(1, eps.length));
  eps.forEach((e, i) => {
    const y = top + i * rh;
    const t0 = 0.2 + i * 0.18;
    // Each kind of part is one object across the rows: every number, every title, every line, every rule.
    obj(c, "season-recap.numbers", [130, y + 36], lt, (lt) => appear(c, enter(lt, t0, 1), () => text(c, e.number, 90, y + 44, 22, PAL.acc, { fam: TYPO.mono, w: 400, track: 3 }), 14), t0);
    obj(c, "season-recap.titles", [500, y + 32], lt, (lt) => appear(c, enter(lt, t0, 1), () => {
      const z = fit(c, e.title, 560, 34, TYPO.hw, TYPO.fam);
      text(c, e.title, 220, y + 44, z, PAL.ink);
    }, 14), t0);
    obj(c, "season-recap.lines", [600, y + 68], lt, (lt) => appear(c, enter(lt, t0, 1), () => {
      const zl = fit(c, e.line, 760, 24, TYPO.lw, TYPO.fam);
      text(c, e.line, 220, y + 76, zl, PAL.dim, { w: TYPO.lw });
    }, 14), t0);
    if (i < eps.length - 1)
      obj(c, "season-recap.rules", [540, y + rh - 3], lt, (lt) => appear(c, enter(lt, t0, 1), () => {
        c.save();
        c.fillStyle = PAL.dim;
        c.globalAlpha *= 0.3;
        c.fillRect(90, y + rh - 4, 900, 1.5);
        c.restore();
      }, 14), t0);
  });
});
