/**
 * The openers' choices DRAWN (2026-10-12, step 5 of
 * `docs/opener-inspector-redesign.md`): a small picture above each word, so
 * «Faint» or «Heading up» is seen before it is read — the summary card's
 * faces did it first.
 *
 * Glyphs, not renders of the piece: an opener's `prepare()` computes its whole
 * road on every call (Virée's coast and vehicles included), and a tile per
 * choice would run it a dozen times per change — the cost that once made the
 * Look tab crawl. A glyph says what the choice DOES; the stage beside it shows
 * the piece. The easing curves are the exception that costs nothing: they are
 * plotted from the engine's own functions.
 *
 * `currentColor` throughout, so a glyph takes its tile's ink — chosen or not.
 */

import type { ReactNode } from 'react';
import { EASINGS, type HookEasing } from './easing';

const W = 40;
const H = 24;

function glyph(children: ReactNode) {
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

/** The frame every placement glyph is drawn in. */
const frame = <rect x={6} y={2} width={28} height={20} rx={2} strokeOpacity={0.45} />;
const ROAD = 'M5 18 C 12 6, 19 20, 26 10 S 33 5, 36 7';

export const PATH_GLYPHS = {
  curved: glyph(<path d={ROAD} />),
  straight: glyph(<path d="M5 18 L 15 9 L 26 13 L 36 6" />),
};

/** The road behind the vehicle drawn, the road ahead as chosen. */
export const AHEAD_GLYPHS = {
  dashed: glyph(<><path d="M4 17 L 20 11" /><path d="M20 11 L 36 6" strokeDasharray="2.2 2.6" /><circle cx={20} cy={11} r={2} fill="currentColor" /></>),
  faint: glyph(<><path d="M4 17 L 20 11" /><path d="M20 11 L 36 6" strokeOpacity={0.3} /><circle cx={20} cy={11} r={2} fill="currentColor" /></>),
  hidden: glyph(<><path d="M4 17 L 20 11" /><circle cx={20} cy={11} r={2} fill="currentColor" /></>),
};

/** Where a picture shows on Virée's map. */
export const DRIVE_PICTURE_GLYPHS = {
  cards: glyph(<><path d={ROAD} strokeOpacity={0.45} /><rect x={9} y={3} width={10} height={8} rx={0.8} fill="var(--color-surface)" /><rect x={23} y={11} width={10} height={8} rx={0.8} fill="var(--color-surface)" /></>),
  fill: glyph(<><rect x={6} y={2} width={28} height={20} rx={2} fill="currentColor" fillOpacity={0.25} /><path d="M8 19 L 16 11 L 22 16 L 26 13 L 32 19" /></>),
  backdrop: glyph(<><rect x={6} y={2} width={28} height={20} rx={2} fill="currentColor" fillOpacity={0.12} strokeOpacity={0.45} /><path d={ROAD} /></>),
  none: glyph(<path d={ROAD} />),
};

/** What the vehicle drives on. */
export const GROUND_GLYPHS = {
  paper: glyph(<>{frame}<path d="M6 9 H 34 M6 15 H 34 M15 2 V 22 M25 2 V 22" strokeOpacity={0.25} /><path d="M9 18 C 15 8, 22 18, 31 6" /></>),
  tiles: glyph(<>{frame}<path d="M23 2 C 21 9, 27 13, 25 22" strokeOpacity={0.5} /><path d="M6 14 C 13 12, 17 16, 23 13" strokeOpacity={0.35} strokeWidth={2.5} /><path d="M9 18 C 15 8, 22 18, 31 6" /></>),
  picture: glyph(<>{frame}<path d="M8 20 L 15 12 L 20 17 L 25 11 L 32 20" strokeOpacity={0.45} /><circle cx={28} cy={7} r={1.8} strokeOpacity={0.45} /><path d="M9 16 C 15 8, 22 14, 31 6" /></>),
};

/** A block placed in the frame, up and down. */
export const POSITION_GLYPHS = {
  top: glyph(<>{frame}<rect x={11} y={5} width={18} height={6} rx={1} fill="currentColor" fillOpacity={0.35} /></>),
  middle: glyph(<>{frame}<rect x={11} y={9} width={18} height={6} rx={1} fill="currentColor" fillOpacity={0.35} /></>),
  bottom: glyph(<>{frame}<rect x={11} y={13} width={18} height={6} rx={1} fill="currentColor" fillOpacity={0.35} /></>),
};

/** A block placed in the frame, side to side. */
export const ALIGN_GLYPHS = {
  left: glyph(<>{frame}<rect x={9} y={7} width={11} height={10} rx={1} fill="currentColor" fillOpacity={0.35} /></>),
  center: glyph(<>{frame}<rect x={14.5} y={7} width={11} height={10} rx={1} fill="currentColor" fillOpacity={0.35} /></>),
  right: glyph(<>{frame}<rect x={20} y={7} width={11} height={10} rx={1} fill="currentColor" fillOpacity={0.35} /></>),
};

const STOPS: readonly [number, number][] = [[6, 17], [14, 10], [22, 15], [30, 7]];
/** Four stops on a line, a name drawn as a bar beside the ones that carry one. */
function named(which: readonly number[], pen?: number) {
  return glyph(
    <>
      <path d="M6 17 L 14 10 L 22 15 L 30 7" strokeOpacity={0.45} />
      {STOPS.map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={1.6} fill={i === pen ? 'currentColor' : 'var(--color-surface)'} />
      ))}
      {which.map((i) => (
        <path key={`n${i}`} d={`M${STOPS[i][0] + 3} ${STOPS[i][1] - 3.5} h 6`} strokeWidth={2} />
      ))}
    </>,
  );
}

export const DRIVE_LABEL_GLYPHS = {
  none: named([]),
  ends: named([0, 3]),
  all: named([0, 1, 2, 3]),
};

export const MAP_LABEL_GLYPHS = {
  none: named([]),
  ends: named([0, 3]),
  current: named([2], 2),
  passed: named([0, 1, 2], 2),
  all: named([0, 1, 2, 3]),
};

/** Where an Itinerary stop's picture is shown. */
export const MAP_MEDIA_GLYPHS = {
  off: glyph(<>{frame}<path d="M10 17 L 18 10 L 30 13" /></>),
  pin: glyph(<>{frame}<path d="M10 17 L 18 10 L 30 13" strokeOpacity={0.45} /><rect x={15} y={4} width={9} height={7} rx={0.6} fill="var(--color-surface)" /></>),
  card: glyph(<><rect x={6} y={2} width={28} height={12} rx={2} strokeOpacity={0.45} /><path d="M10 11 L 18 6 L 30 8" strokeOpacity={0.45} /><rect x={9} y={16} width={22} height={6} rx={1} fill="currentColor" fillOpacity={0.35} /></>),
  backdrop: glyph(<><rect x={6} y={2} width={28} height={20} rx={2} fill="currentColor" fillOpacity={0.25} /><path d="M10 17 L 18 10 L 30 13" /></>),
  strip: glyph(<>{frame}<path d="M9 17 L 15 10 L 23 13" strokeOpacity={0.45} /><path d="M28 5 v 3 M28 11 v 3 M28 17 v 2" strokeWidth={3} /></>),
};

/** What travels the Itinerary's line. */
export const PEN_GLYPHS = {
  dot: glyph(<><path d="M4 17 L 22 9" /><path d="M22 9 L 36 5" strokeOpacity={0.3} /><circle cx={22} cy={9} r={2.6} fill="currentColor" /></>),
  plane: glyph(<><path d="M4 17 L 20 10" /><path d="M20 10 L 36 5" strokeOpacity={0.3} /><path d="M27 7 L 18 7.5 L 20 10 L 18 12.5 Z" fill="currentColor" transform="rotate(-22 22 10)" /></>),
  none: glyph(<><path d="M4 17 L 22 9" /><path d="M22 9 L 36 5" strokeOpacity={0.3} /></>),
};

/** The camera: the whole route fitted, or a window riding on what moves. */
export const CAMERA_GLYPHS = {
  whole: glyph(<>{frame}<path d="M10 17 C 15 7, 22 17, 30 7" /><circle cx={20} cy={12} r={1.6} fill="currentColor" /></>),
  follow: glyph(<><path d="M2 20 C 10 6, 24 22, 38 4" strokeOpacity={0.35} /><rect x={12} y={5} width={16} height={14} rx={2} /><circle cx={20} cy={12} r={1.8} fill="currentColor" /></>),
};

/** Which way is up while the camera follows. */
export const ORIENTATION_GLYPHS = {
  north: glyph(<>{frame}<path d="M20 18 V 6 M16 10 L 20 6 L 24 10" /><path d="M13 16 L 26 9" strokeOpacity={0.35} /></>),
  heading: glyph(<>{frame}<path d="M20 18 V 6 M16 10 L 20 6 L 24 10" /><path d="M20 21 V 3" strokeOpacity={0.35} strokeDasharray="2 2" /></>),
};

/** An easing, plotted from the engine's own curve: time across, distance up. */
export function easingGlyph(id: HookEasing) {
  const ease = EASINGS[id].ease;
  const points = Array.from({ length: 21 }, (_, i) => {
    const u = i / 20;
    return `${(6 + u * 28).toFixed(1)} ${(20 - ease(u) * 16).toFixed(1)}`;
  });
  return glyph(
    <>
      <path d="M6 20 H 34" strokeOpacity={0.3} />
      <path d={`M${points.join(' L ')}`} />
    </>,
  );
}
