/**
 * The modes as the mode drawer shows them (lab 4, L1): the recipes in three
 * FAMILIES that say what the motion does — Travel (into a cell and out of
 * one), Transform (the mosaic turns into another where it stands), Watch
 * (the camera looks) — and, for each, the frame its tile's little preview
 * draws at a time: a camera on the mosaic, how far the next one has come,
 * how much of the photo shows. Still is not here: it is the editing state,
 * a button of its own; Custom is the Motion section, a link at the foot.
 *
 * Pure and DOM-free: `ModeDrawer.tsx` paints these frames with the stage's
 * own scene.
 */

import type { Recipe } from './motion';

export interface ModeFamily {
  id: 'travel' | 'transform' | 'watch';
  label: string;
  modes: readonly Recipe[];
}

export const MODE_FAMILIES: readonly ModeFamily[] = [
  { id: 'travel', label: 'Travel', modes: ['mosaics', 'chain', 'dezoom', 'steer'] },
  { id: 'transform', label: 'Transform', modes: ['reveal', 'wave'] },
  { id: 'watch', label: 'Watch', modes: ['drift', 'slideshow'] },
];

/** What each recipe is called and what it does, in a line — the tile's words and the button's. */
export const MODE_WORDS: Record<Recipe, { label: string; line: string }> = {
  mosaics: { label: 'Mosaics', line: 'From mosaic to mosaic — the photo never shows' },
  chain: { label: 'Chain', line: 'Dive into a cell until its photo fills the screen' },
  dezoom: { label: 'Pull back', line: 'The photo pulls back into a cell of another — once' },
  steer: { label: 'Steer', line: 'Click the cell to go to next' },
  reveal: { label: 'Reveal', line: 'The cells flip one by one to the photo' },
  wave: { label: 'Wave', line: 'The next mosaic lands in a wave from a cell' },
  drift: { label: 'Drift', line: 'The camera wanders over the mosaic' },
  slideshow: { label: 'Slideshow', line: 'A new mosaic at a steady beat' },
};

/** One loop of a preview, seconds. */
export const PREVIEW_PERIOD = 3.2;
/** The cell a preview aims at, as a share of the stage: right of centre, where a dive reads well. */
export const PREVIEW_AIM = { x: 0.62, y: 0.44 } as const;
/** How far a preview dives: a cell of a ~16-column mosaic fills the frame near ×16. */
const DIVE = 14;

/** A preview's frame: the camera over the BASE mosaic and what lies over it. */
export interface PreviewFrame {
  /** Which of the two mosaics a preview alternates between is the base, 0 or 1. */
  base: 0 | 1;
  /** The camera's scale and the point it holds at the frame's centre, 0..1 of the stage. */
  s: number;
  cx: number;
  cy: number;
  /** How much of the OTHER mosaic covers the frame, 0..1 — a crossfade. */
  next: number;
  /** How much of the base's PHOTO covers it, 0..1. */
  photo: number;
  /** The share of cells flipped to the photo, in a scattered order, 0..1. */
  flipped: number;
  /** The radius, 0..1 of the stage's diagonal, inside which the other mosaic has landed. */
  wave: number;
  /** A click's ring growing on the aimed cell, 0..1; 0 when none. */
  ring: number;
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - (-2 * x + 2) ** 2 / 2);

/** The camera diving `k` (0..1) of the way into the aimed cell, its centre kept on the frame. */
function diveCamera(k: number): { s: number; cx: number; cy: number } {
  const s = 1 + (DIVE - 1) * ease(clamp01(k));
  // At ×1 the centre is the stage's; as the camera dives it slides to the cell.
  const f = (s - 1) / (DIVE - 1);
  return { s, cx: 0.5 + (PREVIEW_AIM.x - 0.5) * Math.min(1, f * 3), cy: 0.5 + (PREVIEW_AIM.y - 0.5) * Math.min(1, f * 3) };
}

/** The frame of recipe `id`'s preview at `t` seconds (any t ≥ 0; it loops). */
export function previewFrame(id: Recipe, t: number): PreviewFrame {
  const time = Math.max(0, t);
  const loop = Math.floor(time / PREVIEW_PERIOD);
  const u = (time % PREVIEW_PERIOD) / PREVIEW_PERIOD;
  const base = (loop % 2) as 0 | 1;
  const still: PreviewFrame = { base, s: 1, cx: 0.5, cy: 0.5, next: 0, photo: 0, flipped: 0, wave: 0, ring: 0 };
  switch (id) {
    case 'mosaics':
      return { ...still, ...diveCamera(u / 0.8), next: clamp01((u - 0.8) / 0.2) };
    case 'chain': {
      const cam = diveCamera(u / 0.7);
      return { ...still, ...cam, photo: clamp01((u - 0.7) / 0.15), next: clamp01((u - 0.88) / 0.12) };
    }
    case 'steer': {
      const ring = u < 0.25 ? u / 0.25 : 0;
      return { ...still, ...diveCamera((u - 0.25) / 0.6), ring, next: clamp01((u - 0.85) / 0.15) };
    }
    case 'dezoom': {
      // The photo first, then the camera pulls back from its cell to the whole mosaic.
      const cam = diveCamera(1 - (u - 0.1) / 0.75);
      return { ...still, ...cam, photo: u < 0.1 ? 1 : clamp01(1 - (u - 0.1) / 0.12) };
    }
    case 'reveal':
      return { ...still, flipped: clamp01(u / 0.75) };
    case 'wave':
      return { ...still, wave: clamp01(u / 0.85) };
    case 'drift': {
      const s = 1.5 + 0.2 * Math.sin(time * 0.5);
      return { ...still, base: 0, s, cx: 0.5 + 0.18 * Math.sin(time * 0.37), cy: 0.5 + 0.14 * Math.cos(time * 0.29) };
    }
    case 'slideshow':
      return { ...still, base: (Math.floor(time / (PREVIEW_PERIOD / 2)) % 2) as 0 | 1 };
  }
}
