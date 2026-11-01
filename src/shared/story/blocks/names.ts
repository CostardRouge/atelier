// `names` — three rows: a wrong name at dim, softly struck through, then the right name rising
// in ink beside it, with the distance in mono. {pairs: [{wrong, right, km}]}
import { register } from "./index";
import { appear, clamp, E, enter, font, fit, K, PAL, text, TYPO } from "../motion";
import { obj } from "../objects";

type Pair = { wrong: string; right: string; km: string };
register("names", (c, lt, p) => {
  const pairs = (Array.isArray(p.pairs) ? p.pairs : []) as Pair[];
  const x0 = 90, xr = 990, wrongSize = 40, rightSize = 56;
  pairs.forEach((pr, i) => {
    const y = 760 + i * 190, t0 = 0.3 + i * 0.35;
    const wrong = String(pr.wrong), right = String(pr.right), km = String(pr.km ?? "");
    c.font = font(wrongSize, TYPO.lw, TYPO.fam);
    const ww = c.measureText(wrong).width;
    // The wrong names are one object, struck through as they are set (measured in their own face).
    obj(c, "names.wrong", [x0 + ww / 2, y - 14], lt, (lt) => {
      appear(c, enter(lt, t0, 1), () => text(c, wrong, x0, y, wrongSize, PAL.dim, { w: TYPO.lw }), 14);
      c.font = font(wrongSize, TYPO.lw, TYPO.fam);
      const own = c.measureText(wrong).width;
      // the strike, drawn left to right
      const sp = E(clamp((lt - (t0 + 1.0) * K) / (0.7 * K)));
      if (sp > 0) {
        c.save();
        c.strokeStyle = PAL.dim;
        c.lineWidth = 2;
        c.lineCap = "round";
        c.beginPath();
        c.moveTo(x0 - 2, y - wrongSize * 0.32);
        c.lineTo(x0 - 2 + (own + 4) * sp, y - wrongSize * 0.32);
        c.stroke();
        c.restore();
      }
    }, t0);
    // the right name, beside it, and the distance at the right edge
    c.font = font(24, 400, TYPO.mono);
    const kw = km ? c.measureText(km).width : 0;
    const xRight = x0 + ww + 36, room = xr - kw - 30 - xRight;
    const z = fit(c, right, room, rightSize, TYPO.hw, TYPO.fam);
    obj(c, "names.right", [xRight + 160, y - 18], lt, (lt) => appear(c, enter(lt, t0 + 1.4, 1.1), () => text(c, right, xRight, y, z, PAL.ink), 18), t0 + 1.4);
    if (km) obj(c, "names.distance", [xr - kw / 2, y - 8], lt, (lt) => appear(c, enter(lt, t0 + 1.8, 1), () => text(c, km, xr, y, 24, PAL.dim, { fam: TYPO.mono, w: 400, align: "right" }), 8), t0 + 1.8);
  });
});
