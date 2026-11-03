// `before-after` — two states, a soft wipe between them: {before, after, label?}
// Each side: an eyebrow (AVANT / APRÈS) and one or two lines of text (string or string[]).
import { word } from "../locale";
import { register } from "./index";
import { appear, clamp, E, enter, fit, K, PAL, text, TYPO } from "../motion";
import { obj } from "../objects";
import { drawCovered, editPicture } from "../story-pictures";

const lines = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [String(v ?? "")]);
/** An eyebrow chip on a picture: paper, mono capitals. */
const chip = (c: Parameters<typeof text>[0], s: string, x: number, y: number, right = false) => {
  c.font = `400 24px ${TYPO.mono}`;
  const w = c.measureText(s).width + 36 + s.length * 4;
  if (right) x -= w;
  c.fillStyle = PAL.bg; c.globalAlpha *= 0.92; c.beginPath(); c.roundRect(x, y, w, 46, 23); c.fill(); c.globalAlpha /= 0.92;
  text(c, s, x + 18, y + 31, 24, PAL.ink, { fam: TYPO.mono, w: 400, track: 4 });
};

register("before-after", (c, lt, p) => {
  const before = lines(p.before), after = lines(p.after), label = p.label ? String(p.label) : "";
  const wipe = (lt: number) => E(clamp((lt - 2.0 * K) / (1.4 * K))); // the wipe
  // A picture he developed (Winnow's lineage: the original, then the final edited from it): the original, then
  // the final revealed left to right under an accent edge. `edit` picks which (1 = the first counted); `photos:
  // false`, or no pair on this device, keeps the words.
  const pair = p.photos === false ? null : editPicture(Math.max(0, Number(p.edit ?? 1) - 1));
  if (pair) {
    const x = 90, y = 520, w = 900, h = 720;
    obj(c, "before-after.before", [540, y + h / 2], lt, (lt) => appear(c, enter(lt, 0.2, 1), () => {
      c.save(); c.beginPath(); c.roundRect(x, y, w, h, 18); c.clip(); drawCovered(c, pair.before, x, y, w, h); c.restore();
      chip(c, word("before"), x + 24, y + 24);
    }, 16), 0.2);
    obj(c, "before-after.after", [540, y + h / 2], lt, (lt) => {
      const wv = wipe(lt);
      if (wv <= 0) return;
      const edge = x + w * wv;
      c.save(); c.beginPath(); c.roundRect(x, y, w, h, 18); c.clip(); c.beginPath(); c.rect(x, y, edge - x, h); c.clip(); drawCovered(c, pair.after, x, y, w, h); c.restore();
      c.save(); c.globalAlpha *= 1 - E(clamp((lt - 3.6 * K) / (0.8 * K))); c.fillStyle = PAL.acc; c.fillRect(edge - 2, y, 4, h); c.restore();
      if (wv > 0.6) { c.save(); c.globalAlpha *= clamp((wv - 0.6) / 0.4); chip(c, word("after"), x + w - 24, y + 24, true); c.restore(); }
    }, 2.0);
    if (label) obj(c, "before-after.label", [540, 1290], lt, (lt) => appear(c, enter(lt, 3.4, 1), () => text(c, label, 90, 1300, 32, PAL.dim, { w: TYPO.lw }), 8), 3.4);
    return;
  }
  const draw = (eyebrow: string, ls: string[], color: string, y0: number) => {
    text(c, eyebrow, 90, y0, 26, PAL.dim, { fam: TYPO.mono, w: 400, track: 5 });
    ls.forEach((l, i) => { const z = fit(c, l, 900, i === 0 ? 96 : 60, i === 0 ? TYPO.hw : TYPO.lw, TYPO.fam); text(c, l, 90, y0 + 110 + i * 84, z, color); });
  };
  // before, fading out as the wipe advances
  obj(c, "before-after.before", [540, 880], lt, (lt) => {
    const w = wipe(lt);
    c.save(); c.globalAlpha = enter(lt, 0.2, 1) * (1 - w); c.translate(0, -w * 20); draw(word("before"), before, PAL.dim, 760); c.restore();
  }, 0.2);
  // after, revealed by a rising edge
  obj(c, "before-after.after", [540, 880], lt, (lt) => {
    const w = wipe(lt);
    if (w <= 0) return;
    c.save(); c.beginPath(); c.rect(0, 700 + (1 - w) * 500, 1080, 500); c.clip(); c.globalAlpha = w;
    draw(word("after"), after, PAL.ink, 760); c.restore();
    c.fillStyle = PAL.acc; c.globalAlpha = w * (1 - E(clamp((lt - 3.6 * K) / (0.8 * K)))); c.fillRect(90, 700 + (1 - w) * 500, 900, 2); c.globalAlpha = 1;
  }, 2.0);
  if (label) obj(c, "before-after.label", [540, 1240], lt, (lt) => appear(c, enter(lt, 3.4, 1), () => text(c, label, 90, 1250, 32, PAL.dim, { w: TYPO.lw }), 8), 3.4);
});
