/**
 * The charte of the Storytelling series — every look and motion decision the
 * author locked in the labs of 2026-10-25 → 10-27 (palette « lin », Geist,
 * the « pose » tempo, captions « leve », the HUD after the hook, grain and
 * vignette). One module, so a post never restates a colour or a duration.
 * Numbers are the lab pages' own, copied, not re-tuned, except where a
 * comment says « v2 deviation ».
 */

// ---- Tempo « pose »: every entrance lasts d·k seconds on expoOut (no scale, no bounce).
const expoOut = (x: number) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x));
export const TEMPO = { k: 1.0, ease: expoOut };
export const RISE = 24; // px an `appear()` rises by default
export const BLUR = 6; // px of blur at p = 0, clearing to 0 at p = 1

// ---- Palette « lin »
export const PAL = {
  bg: "#f1eee8",
  ink: "#18191c",
  acc: "#2f4fbf",
  dim: "#9b9890",
  soft: "#e2ded5",
  deep: "#d9d4c9",
};

// ---- Typography « geist »: titles 600, light text 300; mono for small labels.
export const TYPO = {
  fam: 'Geist, "Helvetica Neue", Arial, sans-serif',
  hw: 600,
  lw: 300,
  mono: '"JetBrains Mono", ui-monospace, monospace',
  sys: '-apple-system, BlinkMacSystemFont, Geist, "Helvetica Neue", Arial, sans-serif',
};

// ---- Transition « noir »: scenes overlap OV s; A fades out over the first half, B in over the second.
export const OV = 0.9;

// ---- Captions « leve »
export const CAPTION = {
  x: 90,
  baseline: 1450, // baseline of the LAST line
  wrap: 800,
  size: 58,
  lineHeight: 1.22,
  stagger: 0.12, // s between lines
  lineRise: 14,
  lineDur: 0.7,
  fadeIn: 0.45,
  fadeOut: 0.4,
  unsaid: 0.38, // opacity of a word not yet said
  // v2 deviation: on the map only, a soft band of background behind the caption (fades with it),
  // so stop labels passing under the words do not collide with them. [] = the lab's look.
  // (Tried on the hook too: over the tiles it read as a foggy stripe, so not there.)
  scrimScenes: ["map"] as string[],
  scrim: 0.82,
  scrimTop: 1240,
  scrimBottom: 1540,
};

// ---- HUD « apres »: appears HUD.delay s after the hook starts, over HUD.fade s.
export const HUD = { delay: 2.4, fade: 1.0, y: 214, x0: 80, x1: 1000, track: 0.35, labelY: 280, label: "EP.00" };

// ---- Texture « grainvig »
export const TEXTURE = {
  grain: 0.055, // overlay opacity
  grainMs: 80, // grain pattern changes every 80 ms (seeded by time, deterministic)
  vignetteInner: 500,
  vignetteOuter: 1250,
  vignette: 0.25, // v2 deviation: the lab's .45 turned the light « lin » corners a dirty grey; softened to .25
};

export type Cap = { a: number; b: number; text: string } | null;

export const FPS = 30;
export const W = 1080;
export const H = 1920;
