// `counter` — one big number that moves, calmly: {from, to, label, unit?, sub?}
// The number eases over the block's middle; label under it in accent; optional second line.
import { register } from "./index";
import { appear, clamp, E, enter, fit, K, PAL, text, TYPO } from "../motion";

const fr = (n: number) => Math.round(n).toLocaleString("fr-FR");
register("counter", (c, lt, p) => {
  const from = Number(p.from ?? 0), to = Number(p.to ?? 100000);
  const label = String(p.label ?? ""), unit = p.unit ? String(p.unit) : "", sub = p.sub ? String(p.sub) : "";
  const u = E(clamp((lt - 0.6 * K) / (2.6 * K)));
  const n = from + (to - from) * u;
  appear(c, enter(lt, 0.2, 1.2), () => {
    const s = fr(n) + unit;
    const z = fit(c, fr(Math.max(from, to)) + unit, 900, 260, TYPO.hw, TYPO.fam);
    text(c, s, 540, 1000, z, PAL.ink, { align: "center" });
  }, 20);
  if (label) appear(c, enter(lt, 0.6, 1), () => text(c, label, 540, 1090, 52, PAL.acc, { w: TYPO.lw, align: "center" }), 12);
  if (sub) appear(c, enter(lt, 3.2, 1), () => text(c, sub, 540, 1180, 34, PAL.dim, { w: TYPO.lw, align: "center" }), 10);
});
