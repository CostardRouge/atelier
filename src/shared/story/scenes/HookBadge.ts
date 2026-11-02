// The hook as Trips' badge (`hook-badge.ts`): a veil under the words, a band when the composition asks for
// one, then each piece an object of its own (the Studio picks, moves and fades it), painted by the overlay
// engine in the series' look.
import { drawOverlays, textElementSize } from "../../overlay/draw-overlays";
import { createTextElement } from "../../overlay/overlay-types";
import type { StyleTheme } from "../../overlay/title-styles";
import { clamp, E, type Ctx } from "../motion";
import { PAL } from "../charte";
import { colorOf, markText, obj, objectFace, styleOf } from "../objects";
import { STOPS } from "../geo";
import { HOOK_DEFAULTS, type Hook, type HookTimeline } from "../hook";
import { paintShades } from "../../shades/shade-paint";
import { HOOK_PIECES, hookBadgeElements, hookBadgeOf, hookBand, hookBlockOf, hookLayoutOf, hookThemeOf, pieceLookOf, type HookBadge, type HookBadgeElement, type HookMeasure, type HookPieceKey, type HookPieceLooks, type HookSeries } from "../hook-badge";
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

/** Each piece's Studio settings, as the badge wears them (`HookPieceLook`). */
function looksNow(): HookPieceLooks {
  const out: HookPieceLooks = {};
  for (const key of ["big", ...HOOK_PIECES.map((p) => p.id)] as (HookPieceKey | "big")[]) {
    const st = styleOf(`hook.${key}`);
    const look = pieceLookOf(st, objectFace(st.font, st.weight), st.color ? colorOf(st.color, "") || null : null);
    if (look) out[key] = look;
  }
  return out;
}

/** The hook's name for a piece of Trips' badge, for the measure. */
const HOOK_OF: Record<string, HookPieceKey | "big"> = { kicker: "header", headline: "big", counter: "second", caption: "place", timing: "why", exif: "camera" };

/** How wide a text runs in the badge's title style — the piece's own face if its object sets one — measured on the frame's canvas. */
function measureIn(c: Ctx, theme: StyleTheme, looks: HookPieceLooks): HookMeasure {
  return (text, piece, sizeFrac) => {
    const el = createTextElement(text);
    el.sizeFrac = sizeFrac;
    const face = looks[HOOK_OF[piece] ?? "big"]?.face;
    if (face) {
      el.fontFamily = face.family as typeof el.fontFamily;
      el.weight = face.weight as typeof el.weight;
      el.italic = face.italic;
      el.styleOverrides = ["fontFamily", "weight", "italic"];
    }
    return (textElementSize(c, el, 1080, 1920, theme)?.w ?? text.length * sizeFrac * 540) / 1080;
  };
}

let built: { key: string; els: HookBadgeElement[] } | null = null;
function elementsFor(c: Ctx, hook: Hook, tl: HookTimeline, look: HookBadge | undefined, series: HookSeries, theme: StyleTheme, looks: HookPieceLooks): HookBadgeElement[] {
  // The fonts' arrival changes what a line measures: the key holds whether they are in.
  const key = JSON.stringify([hook, look ?? null, series, looks, STOPS.length, typeof document !== "undefined" ? document.fonts?.status : ""]);
  if (built?.key === key) return built.els;
  built = { key, els: hookBadgeElements(hook, tl, look, series, measureIn(c, theme, looks), looks) };
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
  const theme = hookThemeOf(look);
  const looks = looksNow();
  // The whole badge turns and grows about its anchor's point: a piece dragged or sized moves it all (`hook.badge`).
  const at = hookLayoutOf(hookBadgeOf(look));
  const pivot: [number, number] = [at.x * 1080, at.y * 1920];
  // The shades under the badge, as Trips lays them: a following shade lands on the block where it is drawn —
  // moved and grown with the badge's Studio geometry (`hook.badge`).
  const shades = hookBadgeOf(look).shades;
  if (shades?.length) {
    const block = hookBlockOf(hook, look, series, measureIn(c, theme, looks), looks);
    const geo = styleOf("hook.badge");
    const k = geo.scale ?? 1;
    const moved = block && { ...block, top: (pivot[1] + (block.top * 1920 - pivot[1]) * k + (geo.dy ?? 0)) / 1920, bottom: (pivot[1] + (block.bottom * 1920 - pivot[1]) * k + (geo.dy ?? 0)) / 1920 };
    obj(c, "hook.shades", [540, 960], t, () => paintShades(c, 1080, 1920, shades, moved, shown));
  }
  const band = hookBand(hook, look, series, measureIn(c, theme, looks), looks);
  if (band)
    obj(c, "hook.band", pivot, t, () => {
      c.save();
      c.globalAlpha *= shown;
      c.fillStyle = band.fill;
      c.fillRect(0, band.top * 1920, 1080 * shown, (band.bottom - band.top) * 1920);
      c.restore();
    });
  // One object a piece, its lines drawn together: a hit on any line picks the piece.
  const byPiece = new Map<string, HookBadgeElement["el"][]>();
  for (const { piece, el } of elementsFor(c, hook, tl, look, series, theme, looks)) byPiece.set(piece, [...(byPiece.get(piece) ?? []), el]);
  for (const [piece, els] of byPiece) {
    obj(c, `hook.${piece}`, pivot, t, () => {
      // Its words are text the Studio sets (font, size as a share of the stack, ink, case, spacing).
      markText(els.map((e) => e.text ?? "").join(" "));
      drawOverlays(c, els, null, 1080, 1920, { theme, timeSeconds: t });
    });
  }
}
