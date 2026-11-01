// The hook as Trips' badge (`hook-badge.ts`): a veil under the words, a band when the composition asks for
// one, then each piece an object of its own (the Studio picks, moves and fades it), painted by the overlay
// engine in the series' look.
import { drawOverlays } from "../../overlay/draw-overlays";
import { clamp, E, type Ctx } from "../motion";
import { PAL } from "../charte";
import { obj } from "../objects";
import { STOPS } from "../geo";
import { HOOK_DEFAULTS, type Hook, type HookTimeline } from "../hook";
import { hookBadgeElements, hookBand, hookThemeOf, type HookBadge, type HookBadgeElement, type HookSeries } from "../hook-badge";
import type { Episode } from "../episode";

/** The series' facts the pieces read: its name, the post's number, the map's ends, the trip's first day. */
export function hookSeriesOf(ep: Episode, today = new Date().toISOString().slice(0, 10)): HookSeries {
  const name = (i: number) => (STOPS[i] ? (STOPS[i][5] || STOPS[i][0]) : "");
  return {
    series: ep.closing.series,
    number: ep.number,
    from: STOPS.length && STOPS[0][1] !== undefined && STOPS[0][0] !== "" ? name(0) : undefined,
    to: STOPS.length > 1 && STOPS[STOPS.length - 1][0] !== "" ? name(STOPS.length - 1) : undefined,
    since: ep.since,
    today,
    lang: ep.lang === "en" ? "en" : "fr",
  };
}

let built: { key: string; els: HookBadgeElement[] } | null = null;
function elementsFor(hook: Hook, tl: HookTimeline, look: HookBadge | undefined, series: HookSeries): HookBadgeElement[] {
  const key = JSON.stringify([hook, look ?? null, series, STOPS.length]);
  if (built?.key === key) return built.els;
  built = { key, els: hookBadgeElements(hook, tl, look, series) };
  return built.els;
}

export function drawHookBadge(c: Ctx, ep: Episode, hook: Hook, tl: HookTimeline, t: number): void {
  if (!hook.lines.length || t < Math.max(0, tl.lines[0].start - 0.3) || t >= tl.end) return;
  const look = ep.look?.hook;
  const series = hookSeriesOf(ep);
  const exit = hook.exit ?? HOOK_DEFAULTS.exit;
  const out = exit === "cut" ? 0 : clamp((t - tl.leave) / Math.max(0.05, tl.end - tl.leave));
  const shown = E(clamp((t - tl.lines[0].start + 0.3) / 0.5)) * (1 - E(out));
  const scrim = clamp(hook.scrim ?? HOOK_DEFAULTS.scrim);
  if (scrim > 0)
    obj(c, "hook.veil", [540, 960], t, () => {
      c.save();
      c.globalAlpha = scrim * shown;
      c.fillStyle = PAL.ink;
      c.fillRect(0, 0, 1080, 1920);
      c.restore();
    });
  const band = hookBand(hook, look, series);
  if (band)
    obj(c, "hook.band", [540, ((band.top + band.bottom) / 2) * 1920], t, () => {
      c.save();
      c.globalAlpha *= shown;
      c.fillStyle = band.fill;
      c.fillRect(0, band.top * 1920, 1080 * shown, (band.bottom - band.top) * 1920);
      c.restore();
    });
  const theme = hookThemeOf(look);
  for (const { piece, el } of elementsFor(hook, tl, look, series)) {
    obj(c, `hook.${piece}`, [el.x * 1080, el.y * 1920], t, () => drawOverlays(c, [el], null, 1080, 1920, { theme, timeSeconds: t }));
  }
}
