/**
 * Painting the itinerary — one frame, read off the options and the timing that
 * `prepare()` fixed.
 *
 * The map is drawn between the picture and the shades, the engine's one seam.
 * Everything is in units of a 1080-wide frame, so the stage preview and a
 * 1080×1920 export draw the same map at two scales, and everything the author
 * switched on is drawn from the SAME projection — nothing can sit where the
 * line is not.
 *
 * The four ways a picture is presented, and what each is for:
 *
 * - **pin** — a small tile beside the stop's own dot, appearing as the pen
 *   lands. The picture and the place are read in one glance; several are on
 *   screen at once, which is what makes an itinerary rather than a slideshow.
 * - **card** — one larger tile under the map, cross-fading, captioned with the
 *   stop's name. For a picture that deserves to be looked at.
 * - **backdrop** — the picture fills the frame behind the map, dimmed so the
 *   line survives over it. The most cinematic, and the one that replaces the
 *   piece's own picture while it runs.
 * - **strip** — every stop's picture as a contact row along the edge, the ones
 *   still ahead held back. The itinerary read as a set.
 *
 * A stop with no picture, or one that could not be decoded, draws NOTHING —
 * never a placeholder, never the previous stop's picture standing in for it.
 * That is the anti-fabrication rule the whole tool keeps: an empty stop looks
 * empty. A backdrop simply dissolves back to the piece's own picture.
 *
 * A dark underlay runs under every stroke and every glyph, which is what keeps
 * a white line legible over a pale sky without a per-frame shadow blur.
 */

import { drawFramed } from '../../media/framing';
import { hexToRgba } from './colour';
import type { FrameBox, HookCtx2D, HookPicture } from './hook-variant';
import { placeLabels } from './geo';

/** A box a name may not be placed on — a pinned picture's tile. */
interface LabelBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}
import {
  arcControl,
  drawnFractions,
  drawnKm,
  fitProjection,
  formatDistance,
  hopKms,
  mapBox,
  mediaAt,
  penAt,
  pinAlphaAt,
  quadAt,
  quadSplit,
  quadTail,
  stopPictureKey,
  wantsLabel,
  type Box,
  type LatLon,
  type MapOptions,
  type MapStop,
  type MapTiming,
  type Point,
} from './map-plan';

const UNDERLAY = 'rgba(0,0,0,0.3)';
const AHEAD_DASH = [9, 8];
/** The suite's faces, each with a fallback: a glyph must survive a stack we do not control. */
const LABEL_FONT = "'Space Grotesk', 'Helvetica Neue', Arial, sans-serif";
const MONO_FONT = "'JetBrains Mono', 'SF Mono', Menlo, Consolas, monospace";
/** The paper a tile is mounted on, and the ink of a card's caption. */
const PAPER = '#f4efe4';
const PAPER_INK = '#1c1a17';
/** A pin's tile at size 1, in 1080-units. */
const PIN = 150;

interface Painted {
  stop: MapStop;
  at: Point;
  index: number;
}

export function paintMap(
  g: HookCtx2D,
  o: MapOptions,
  timing: MapTiming,
  /**
   * The trip's own located places that are not stops, drawn faint behind the
   * itinerary when the author asks. Handed in rather than read here: the paint
   * never sees the document, only what `prepare()` captured for it.
   */
  context: readonly LatLon[],
  pictures: ReadonlyMap<string, HookPicture> | undefined,
  t: number,
  frame: FrameBox,
): void {
  const { width: w, height: h } = frame;
  if (w <= 0 || h <= 0 || o.stops.length === 0) return;

  const u = w / 1080;
  const box = mapBox(w, h, o.position, o.align, o.size);
  // Every stop is fitted from the first frame — the pen reaches all of them,
  // so hiding the hops ahead must not let the map re-scale under the drawing.
  const { project } = fitProjection(o.stops, box, 8 * u);
  const points: Painted[] = o.stops.map((stop, index) => ({ stop, at: project(stop), index }));
  const pen = penAt(timing, o.easing, t);
  const fractions = drawnFractions(timing, o.easing, t, Math.max(0, o.stops.length - 1));
  const media = mediaAt(timing, t, o.mediaFade);
  const pictureOf = (index: number): HookPicture | undefined => {
    const stop = o.stops[index];
    if (!stop) return undefined;
    const key = stopPictureKey(stop);
    return key ? pictures?.get(key) : undefined;
  };

  g.save();
  g.lineCap = 'round';
  g.lineJoin = 'round';

  if (o.media === 'backdrop') paintBackdrop(g, o, media, pictureOf, w, h);
  if (o.plate) paintPlate(g, o, box, u, w);
  if (o.graticule) paintGraticule(g, o, box, project, u);

  // --- the path ------------------------------------------------------------
  const arcs = points.slice(1).map((to, i) => {
    const from = points[i].at;
    return { from, to: to.at, control: arcControl(from, to.at, o.curve) };
  });
  /**
   * The path, in two layers: what is still to come, then what the pen has
   * drawn over it.
   *
   * The remainder of the hop the pen is ON belongs to the first layer — which
   * is the whole point. Drawing only up to the pen erased the faint line
   * exactly where the eye was following it, so the shape of the journey
   * stopped being readable the moment it started being drawn. Now the ahead
   * style is the line's bed and the pen fills it in.
   */
  const strokeLayer = (layer: 'ahead' | 'drawn', pass: 'under' | 'line') => {
    arcs.forEach((arc, i) => {
      const f = Math.max(0, Math.min(1, fractions[i] ?? 0));
      if (layer === 'ahead' ? f >= 1 : f <= 0) return;
      g.globalAlpha = layer === 'ahead' ? (o.aheadStyle === 'faint' ? 0.3 : 0.5) : 1;
      g.setLineDash(layer === 'ahead' && o.aheadStyle === 'dashed' ? AHEAD_DASH.map((d) => d * u) : []);
      g.beginPath();
      if (layer === 'ahead') {
        const tail = quadTail(arc.from, arc.control, arc.to, f);
        g.moveTo(tail.start.x, tail.start.y);
        g.quadraticCurveTo(tail.control.x, tail.control.y, tail.end.x, tail.end.y);
      } else {
        const part = quadSplit(arc.from, arc.control, arc.to, f);
        g.moveTo(arc.from.x, arc.from.y);
        g.quadraticCurveTo(part.control.x, part.control.y, part.end.x, part.end.y);
      }
      if (pass === 'under') {
        g.strokeStyle = UNDERLAY;
        g.lineWidth = (6 * o.lineWidth + 4) * u;
      } else {
        g.strokeStyle = layer === 'ahead' ? hexToRgba(o.aheadColor, 0.85) : o.pathColor;
        g.lineWidth = (layer === 'ahead' ? 3.5 : 6) * o.lineWidth * u;
      }
      g.stroke();
    });
  };
  if (o.aheadStyle !== 'hidden') {
    if (o.underlay) strokeLayer('ahead', 'under');
    strokeLayer('ahead', 'line');
  }
  if (o.underlay) strokeLayer('drawn', 'under');
  strokeLayer('drawn', 'line');
  g.setLineDash([]);

  // --- the trip's other places, faint behind the itinerary -------------------
  if (o.context) {
    g.globalAlpha = 0.45;
    g.fillStyle = hexToRgba(o.aheadColor, 0.5);
    for (const place of context) {
      const at = project(place);
      if (at.x < 0 || at.y < 0 || at.x > w || at.y > h) continue;
      g.beginPath();
      g.arc(at.x, at.y, 3.5 * u * o.dotSize, 0, Math.PI * 2);
      g.fill();
    }
  }

  // --- the stops ------------------------------------------------------------
  // A stop is "there" once the pen has reached it; the ones still ahead show
  // only when the itinerary ahead is shown at all.
  const reached = points.map(({ index }) => index <= pen.stop);
  // A numbered dot is a disc with a numeral in it, so it has to be big enough
  // to read one: at 1.55 the glyph came out at 12 px on a 1080-wide frame.
  const dotR = 7 * u * o.dotSize * (o.numbers ? 2.1 : 1);
  if (o.dots) {
    points.forEach(({ at, index }) => {
      const ahead = !reached[index];
      if (ahead && o.aheadStyle === 'hidden') return;
      g.globalAlpha = ahead ? 0.55 : 1;
      if (o.underlay) {
        g.fillStyle = 'rgba(0,0,0,0.35)';
        g.beginPath();
        g.arc(at.x, at.y, dotR + 3 * u, 0, Math.PI * 2);
        g.fill();
      }
      g.fillStyle = ahead ? hexToRgba(o.aheadColor, 0.8) : o.pathColor;
      g.beginPath();
      g.arc(at.x, at.y, dotR, 0, Math.PI * 2);
      g.fill();
      if (o.numbers) {
        // The numeral is the map's ink on the dot's own fill — a second colour
        // here would make the dots read as two kinds of thing.
        g.fillStyle = PAPER_INK;
        g.font = `600 ${dotR * 1.15}px ${MONO_FONT}`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(String(index + 1), at.x, at.y + dotR * 0.06);
      }
    });
  }

  // --- pictures pinned at their stops ---------------------------------------
  // Placed before the names, and handed to the label placer as reserved boxes,
  // so a name never lands on a photograph.
  const pinned: LabelBox[] = [];
  if (o.media === 'pin') {
    paintPins(g, o, timing, points, reached, pictureOf, media, t, u, frame, dotR, pinned);
  }

  // --- the names ------------------------------------------------------------
  if (o.labels !== 'none') {
    const fontPx = 26 * u * o.labelSize;
    g.font = `600 ${fontPx}px ${LABEL_FONT}`;
    g.textBaseline = 'middle';
    const labels = placeLabels(
      points.map(({ at, stop, index }) => ({
        x: at.x,
        y: at.y,
        name: stop.name,
        wanted:
          (reached[index] || o.aheadStyle !== 'hidden') &&
          wantsLabel(o.labels, index, points.length, pen.stop),
      })),
      fontPx,
      frame,
      o.dots ? dotR : 2 * u,
      (name) => g.measureText(name).width,
      pinned,
    );
    for (const label of labels) {
      const { stop, index } = points[label.index];
      g.textAlign = label.align;
      g.globalAlpha = reached[index] ? 1 : 0.7;
      if (o.underlay) {
        g.lineWidth = 4 * u;
        g.strokeStyle = 'rgba(0,0,0,0.5)';
        g.strokeText(stop.name.trim(), label.x, label.y);
      }
      g.fillStyle = o.pathColor;
      g.fillText(stop.name.trim(), label.x, label.y);
    }
  }

  // --- the pen's tip --------------------------------------------------------
  if (o.draw && o.pen !== 'none' && pen.hop !== null) {
    const arc = arcs[pen.hop];
    if (arc) {
      const tip = quadAt(arc.from, arc.control, arc.to, pen.fraction);
      const just = quadAt(arc.from, arc.control, arc.to, Math.max(0, pen.fraction - 0.01));
      g.globalAlpha = 1;
      g.fillStyle = o.pathColor;
      if (o.pen === 'plane') {
        paintPlane(g, tip, Math.atan2(tip.y - just.y, tip.x - just.x), 11 * u * o.dotSize);
      } else {
        g.beginPath();
        g.arc(tip.x, tip.y, 8 * u * o.dotSize, 0, Math.PI * 2);
        g.fill();
      }
    }
  }

  // --- the picture under the map, or along the edge -------------------------
  if (o.media === 'card') paintCard(g, o, points, media, pictureOf, box, u, frame);
  if (o.media === 'strip') paintStrip(g, o, timing, points, pictureOf, t, u, frame);

  if (o.compass) paintCompass(g, o, box.x + box.width - 14 * u, box.y - 50 * u, u);

  if (o.distance !== 'off') {
    const km = drawnKm(hopKms(o.stops), fractions);
    const text = formatDistance(km, o.distance);
    g.font = `500 ${28 * u}px ${MONO_FONT}`;
    g.textBaseline = 'middle';
    g.textAlign = o.align === 'right' ? 'right' : 'left';
    const x = o.align === 'right' ? box.x + box.width : box.x;
    const y = box.y + box.height + 40 * u;
    g.globalAlpha = 1;
    if (o.underlay) {
      g.lineWidth = 5 * u;
      g.strokeStyle = 'rgba(0,0,0,0.5)';
      g.strokeText(text, x, y);
    }
    g.fillStyle = o.pathColor;
    g.fillText(text, x, y);
  }

  g.restore();
}

/** The current stop's picture over the whole frame, cross-fading, then dimmed. */
function paintBackdrop(
  g: HookCtx2D,
  o: MapOptions,
  media: { current: number; previous: number | null; mix: number },
  pictureOf: (index: number) => HookPicture | undefined,
  w: number,
  h: number,
): void {
  const current = pictureOf(media.current);
  const previous = media.previous === null ? undefined : pictureOf(media.previous);
  let covered = 0;
  if (previous) {
    g.globalAlpha = 1 - media.mix;
    covered = Math.max(covered, 1 - media.mix);
    cover(g, previous, w, h);
  }
  if (current) {
    g.globalAlpha = previous ? media.mix : media.mix;
    covered = Math.max(covered, media.mix);
    cover(g, current, w, h);
  }
  // The veil only where a picture was actually laid down: with no picture the
  // piece's own frame shows through, and dimming that would be a change
  // nobody asked for.
  if (covered > 0 && o.mediaDim > 0) {
    g.globalAlpha = o.mediaDim * covered;
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
  }
  g.globalAlpha = 1;
}

/** A translucent panel behind the map, for a map over a busy picture. */
function paintPlate(g: HookCtx2D, o: MapOptions, box: Box, u: number, w: number): void {
  const padX = 34 * u + (o.labels !== 'none' ? 80 * u * o.labelSize : 0);
  const top = box.y - (o.compass ? 100 * u : 30 * u);
  const bottom = box.y + box.height + (o.distance !== 'off' ? 66 * u : 30 * u);
  const x0 = Math.max(8 * u, box.x - padX);
  const x1 = Math.min(w - 8 * u, box.x + box.width + padX);
  g.globalAlpha = 1;
  g.fillStyle = hexToRgba(o.plateColor, o.plateOpacity);
  roundedRect(g, x0, top, x1 - x0, bottom - top, 20 * u);
  g.fill();
}

/**
 * A faint lat/lon grid behind the line — whole degrees at a step the span
 * chooses, so a city map and a continent map both get a handful of lines. It
 * says "this is a projection", which is the honest thing for a map with no
 * coastline on it to say.
 */
function paintGraticule(
  g: HookCtx2D,
  o: MapOptions,
  box: Box,
  project: (p: { lat: number; lon: number }) => Point,
  u: number,
): void {
  const lats = o.stops.map((s) => s.lat);
  const lons = o.stops.map((s) => s.lon);
  const span = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lons) - Math.min(...lons));
  const step = [0.1, 0.25, 0.5, 1, 2, 5, 10, 20, 30].find((s) => span / s <= 6) ?? 45;
  g.save();
  g.beginPath();
  g.rect(box.x, box.y, box.width, box.height);
  g.clip();
  g.globalAlpha = 1;
  g.strokeStyle = hexToRgba(o.pathColor, 0.16);
  g.lineWidth = 1.5 * u;
  g.setLineDash([]);
  const first = (min: number) => Math.ceil(min / step) * step;
  for (let lat = first(Math.min(...lats) - step * 3); lat <= Math.max(...lats) + step * 3; lat += step) {
    const a = project({ lat, lon: Math.min(...lons) - step * 6 });
    const b = project({ lat, lon: Math.max(...lons) + step * 6 });
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  for (let lon = first(Math.min(...lons) - step * 3); lon <= Math.max(...lons) + step * 3; lon += step) {
    const a = project({ lat: Math.min(...lats) - step * 6, lon });
    const b = project({ lat: Math.max(...lats) + step * 6, lon });
    g.beginPath();
    g.moveTo(a.x, a.y);
    g.lineTo(b.x, b.y);
    g.stroke();
  }
  g.restore();
}

/**
 * The pictures pinned beside their dots. Each is tried above its dot, then
 * right, left, below, and DROPPED if it would leave the frame, overlap a pin
 * already placed, or cover ANOTHER stop's dot — the rule the names follow,
 * for the same reason, plus one the names do not need: two stops a degree
 * apart put the second one's dot under the first one's photograph, and a
 * stop hidden behind a picture reads as a stop that is not on the itinerary.
 */
function paintPins(
  g: HookCtx2D,
  o: MapOptions,
  timing: MapTiming,
  points: readonly Painted[],
  reached: readonly boolean[],
  pictureOf: (index: number) => HookPicture | undefined,
  media: { current: number },
  t: number,
  u: number,
  frame: FrameBox,
  dotR: number,
  placed: LabelBox[],
): void {
  const size = PIN * u * o.mediaSize;
  const gap = dotR + 14 * u;
  for (const { at, index } of points) {
    if (!reached[index]) continue;
    const picture = pictureOf(index);
    if (!picture) continue;
    const alpha = o.pinKeep
      ? pinAlphaAt(timing, t, index, o.mediaFade)
      : index === media.current
        ? pinAlphaAt(timing, t, index, o.mediaFade)
        : 0;
    if (alpha <= 0) continue;
    const tries = [
      { x: at.x - size / 2, y: at.y - gap - size },
      { x: at.x + gap, y: at.y - size / 2 },
      { x: at.x - gap - size, y: at.y - size / 2 },
      { x: at.x - size / 2, y: at.y + gap },
    ];
    const spot = tries.find((candidate) => {
      const b = { x0: candidate.x, y0: candidate.y, x1: candidate.x + size, y1: candidate.y + size };
      if (b.x0 < 4 * u || b.y0 < 4 * u || b.x1 > frame.width - 4 * u || b.y1 > frame.height - 4 * u) {
        return false;
      }
      if (placed.some((p) => b.x0 < p.x1 && b.x1 > p.x0 && b.y0 < p.y1 && b.y1 > p.y0)) return false;
      return !points.some(
        (other) =>
          other.index !== index &&
          other.at.x > b.x0 - dotR &&
          other.at.x < b.x1 + dotR &&
          other.at.y > b.y0 - dotR &&
          other.at.y < b.y1 + dotR,
      );
    });
    if (!spot) continue;
    placed.push({ x0: spot.x, y0: spot.y, x1: spot.x + size, y1: spot.y + size });
    g.globalAlpha = alpha;
    if (o.pinStem) {
      g.strokeStyle = o.pathColor;
      g.lineWidth = 2 * u * o.lineWidth;
      g.beginPath();
      g.moveTo(at.x, at.y);
      g.lineTo(spot.x + size / 2, spot.y + size / 2);
      g.stroke();
    }
    tile(g, picture, spot.x, spot.y, size, size, o.mediaFrame, u);
  }
  g.globalAlpha = 1;
}

/**
 * One picture under the map (over it, when the map sits low), captioned with
 * the stop's name. The caption is the reason this mode exists rather than a
 * bigger pin: a picture under a place name is a postcard.
 */
function paintCard(
  g: HookCtx2D,
  o: MapOptions,
  points: readonly Painted[],
  media: { current: number; previous: number | null; mix: number },
  pictureOf: (index: number) => HookPicture | undefined,
  box: Box,
  u: number,
  frame: FrameBox,
): void {
  const below = frame.height - (box.y + box.height);
  const above = box.y;
  const under = below >= above;
  const room = Math.max(0, (under ? below : above) - 28 * u);
  if (room <= 40 * u) return;
  const height = Math.min(room, 300 * u * o.mediaSize);
  const width = Math.min(frame.width - 40 * u, height * 1.5);
  const x = box.x + box.width / 2 - width / 2;
  const y = under ? box.y + box.height + 20 * u : box.y - 20 * u - height;

  const draw = (index: number, alpha: number) => {
    const picture = pictureOf(index);
    if (!picture || alpha <= 0) return;
    g.globalAlpha = alpha;
    const name = points[index]?.stop.name.trim() ?? '';
    tile(g, picture, x, y, width, height, o.mediaFrame, u, name);
  };
  if (media.previous !== null) draw(media.previous, 1 - media.mix);
  draw(media.current, media.mix);
  g.globalAlpha = 1;
}

/**
 * Every stop's picture as a row along the frame's edge: the ones the pen has
 * reached at full strength, the ones still ahead held back behind a veil. It
 * is the itinerary read as a set rather than as a journey — and the only mode
 * that shows what is still to come.
 */
function paintStrip(
  g: HookCtx2D,
  o: MapOptions,
  timing: MapTiming,
  points: readonly Painted[],
  pictureOf: (index: number) => HookPicture | undefined,
  t: number,
  u: number,
  frame: FrameBox,
): void {
  const withPictures = points.filter(({ index }) => pictureOf(index));
  if (withPictures.length === 0) return;
  const gap = 8 * u;
  const maxTile = 130 * u * o.mediaSize;
  const available = frame.width - 32 * u;
  const size = Math.min(maxTile, (available - gap * (withPictures.length - 1)) / withPictures.length);
  if (size < 24 * u) return;
  const rowWidth = size * withPictures.length + gap * (withPictures.length - 1);
  const x0 = frame.width / 2 - rowWidth / 2;
  const y = o.position === 'bottom' ? 26 * u : frame.height - size - 26 * u;

  withPictures.forEach(({ index }, slot) => {
    const picture = pictureOf(index);
    if (!picture) return;
    const x = x0 + slot * (size + gap);
    const arrived = pinAlphaAt(timing, t, index, o.mediaFade);
    g.globalAlpha = 1;
    tile(g, picture, x, y, size, size, o.mediaFrame, u);
    if (arrived < 1) {
      // Not yet reached: a veil over the tile rather than a gap, so the row
      // says how many stops there are from the first frame.
      g.globalAlpha = 0.62 * (1 - arrived);
      g.fillStyle = '#0c0b09';
      roundedRect(g, x, y, size, size, 5 * u);
      g.fill();
    }
    if (arrived > 0 && index === lastReached(timing, t)) {
      g.globalAlpha = 1;
      g.strokeStyle = o.pathColor;
      g.lineWidth = 3 * u * o.lineWidth;
      roundedRect(g, x - 2 * u, y - 2 * u, size + 4 * u, size + 4 * u, 6 * u);
      g.stroke();
    }
  });
  g.globalAlpha = 1;
}

function lastReached(timing: MapTiming, t: number): number {
  let index = 0;
  for (let i = 1; i < timing.arrivals.length; i++) if (t + 1e-9 >= timing.arrivals[i]) index = i;
  return index;
}

/**
 * One picture in a box, cover-cropped, on paper or bare. A caption, when there
 * is one, sits in the paper below the picture — which is why a paper tile is
 * the default: the mount is where a name can go.
 */
function tile(
  g: HookCtx2D,
  picture: HookPicture,
  x: number,
  y: number,
  w: number,
  h: number,
  frame: MapOptions['mediaFrame'],
  u: number,
  caption = '',
): void {
  const paper = frame === 'paper';
  const border = paper ? Math.max(3 * u, Math.min(w, h) * 0.045) : 0;
  const captionH = paper && caption ? Math.max(18 * u, h * 0.16) : 0;
  const radius = 5 * u;
  g.save();
  // A shadow under the tile, not under everything drawn after it.
  g.shadowColor = 'rgba(0,0,0,0.45)';
  g.shadowBlur = 10 * u;
  g.shadowOffsetY = 3 * u;
  if (paper) {
    g.fillStyle = PAPER;
    roundedRect(g, x, y, w, h + captionH, radius);
    g.fill();
  }
  g.restore();

  const px = x + border;
  const py = y + border;
  const pw = Math.max(1, w - border * 2);
  const ph = Math.max(1, h - border * 2);
  g.save();
  g.beginPath();
  if (paper) g.rect(px, py, pw, ph);
  else roundedRect(g, px, py, pw, ph, radius);
  g.clip();
  g.translate(px, py);
  try {
    drawFramed(g, picture.image, picture.width, picture.height, pw, ph);
  } catch {
    // A bitmap closed under a render still in flight throws; that frame shows
    // the stop without its picture rather than killing the paint loop.
  }
  g.restore();

  if (!paper) {
    g.save();
    g.strokeStyle = 'rgba(255,255,255,0.85)';
    g.lineWidth = 2 * u;
    roundedRect(g, px, py, pw, ph, radius);
    g.stroke();
    g.restore();
  }

  if (captionH > 0) {
    g.save();
    g.fillStyle = PAPER_INK;
    g.font = `600 ${Math.min(captionH * 0.52, 30 * u)}px ${LABEL_FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(caption, x + w / 2, y + h + captionH / 2 - border / 2, w - border * 2);
    g.restore();
  }
}

function cover(g: HookCtx2D, picture: HookPicture, w: number, h: number): void {
  try {
    drawFramed(g, picture.image, picture.width, picture.height, w, h);
  } catch {
    // See `tile` — a closed bitmap costs this frame's backdrop, not the loop.
  }
}

/** A little aeroplane, nose along the direction of travel. */
function paintPlane(g: HookCtx2D, at: Point, angle: number, r: number): void {
  g.save();
  g.translate(at.x, at.y);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(r, 0);
  g.lineTo(-r * 0.7, r * 0.62);
  g.lineTo(-r * 0.35, 0);
  g.lineTo(-r * 0.7, -r * 0.62);
  g.closePath();
  g.fill();
  g.restore();
}

/** A north arrow with its letter — north is up because the projection is. */
function paintCompass(g: HookCtx2D, o: MapOptions, cx: number, cy: number, u: number): void {
  const half = 17 * u;
  g.globalAlpha = 1;
  const shaft = (pass: 'under' | 'line') => {
    g.strokeStyle = pass === 'under' ? 'rgba(0,0,0,0.5)' : o.pathColor;
    g.lineWidth = (pass === 'under' ? 8 : 3.5) * u;
    g.beginPath();
    g.moveTo(cx, cy + half);
    g.lineTo(cx, cy - half + 6 * u);
    g.stroke();
  };
  if (o.underlay) shaft('under');
  shaft('line');
  g.fillStyle = o.pathColor;
  g.beginPath();
  g.moveTo(cx, cy - half - 2 * u);
  g.lineTo(cx - 7 * u, cy - half + 12 * u);
  g.lineTo(cx + 7 * u, cy - half + 12 * u);
  g.closePath();
  g.fill();
  g.font = `600 ${20 * u}px ${MONO_FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  if (o.underlay) {
    g.lineWidth = 4 * u;
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    g.strokeText('N', cx, cy - half - 16 * u);
  }
  g.fillStyle = o.pathColor;
  g.fillText('N', cx, cy - half - 16 * u);
}

function roundedRect(g: HookCtx2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.lineTo(x + w - rr, y);
  g.quadraticCurveTo(x + w, y, x + w, y + rr);
  g.lineTo(x + w, y + h - rr);
  g.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  g.lineTo(x + rr, y + h);
  g.quadraticCurveTo(x, y + h, x, y + h - rr);
  g.lineTo(x, y + rr);
  g.quadraticCurveTo(x, y, x + rr, y);
  g.closePath();
}
