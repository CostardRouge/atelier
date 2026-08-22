/**
 * Data model for the Telemetry Overlay tool — pure, DOM-free.
 *
 * An {@link OverlayElement} is one draggable readout (a telemetry field or a
 * free-text label) placed on the video. Positions are stored as **normalized**
 * coordinates (0..1 of the video's width/height) and the font size as a
 * **fraction of video height**, so the single canvas renderer produces an
 * identical layout for the scaled editor preview and the full-resolution
 * export (true WYSIWYG).
 */

import type { SpeedUnit } from '../telemetry/motion';
import type { TimeFormatOptions } from '../telemetry/time-format';
import type { ElementAnimation, TimeWindow } from './animation';
export type { SpeedUnit, TimeFormatOptions };

/**
 * Telemetry fields exposable as widgets: the raw SRT fields plus the motion
 * values (`gnd_speed`, `vert_speed`, `heading`) reconstructed from GPS.
 */
export type TelemetryFieldKey =
  | 'rel_alt'
  | 'abs_alt'
  | 'gnd_speed'
  | 'vert_speed'
  | 'heading'
  | 'latitude'
  | 'longitude'
  | 'iso'
  | 'shutter'
  | 'fnum'
  | 'ev'
  | 'focal_len'
  | 'color_md'
  | 'ct'
  | 'frame'
  | 'timestamp'
  | 'clock'
  | 'date';

export type OverlayKind =
  | 'telemetry-field'
  | 'text'
  | 'heading-arrow'
  | 'heading-tape'
  | 'frame-corners'
  | 'battery'
  | 'rotate-device';

/** Which way the `rotate-device` pictogram tips the phone. */
export type RotateDirection = 'cw' | 'ccw';

/** Where a shape element's caption sits relative to it. */
export type LabelPlacement = 'none' | 'above' | 'below' | 'left' | 'right';

/** What the heading tape draws under its sight. */
export type TapeReticle = 'none' | 'line' | 'triangle' | 'both';

/**
 * What a heading instrument does while the reading is gone (hovering, or a yaw
 * on the spot — see telemetry/heading-smooth.ts).
 * - `dim`  hold the last bearing, fading out over the hold window (default);
 * - `hold` keep it at full strength for the hold window, then drop;
 * - `hide` drop to the no-data state at once.
 */
export type HeadingGapMode = 'dim' | 'hold' | 'hide';

/** Where the battery gauge reads its level. See battery.ts. */
export type BatterySource = 'manual' | 'telemetry';

/** Which point of the element box maps to (x,y) — enables clean corner snaps. */
export type Anchor =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'center-left'
  | 'center'
  | 'center-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type FontWeight = 400 | 500 | 600 | 700;

/** Curated families. The brand fonts are loaded via FontFace before drawing;
 *  the rest are system fonts that need no loading. */
export type OverlayFontFamily =
  | 'Space Grotesk'
  | 'JetBrains Mono'
  | 'Instrument Serif'
  | 'VT323'
  | 'Arial'
  | 'Georgia'
  | 'Courier New';

export interface LegibilityStyle {
  /** none → plain text; shadow → drop shadow; box → filled rounded panel. */
  mode: 'none' | 'shadow' | 'box';
  /** Box fill / shadow colour (rgba string). */
  color: string;
  /** Padding (box) or blur (shadow) as a fraction of font size. */
  padFrac: number;
}

export interface OverlayElement {
  id: string;
  kind: OverlayKind;

  /** For telemetry-field: which field; ignored for text. */
  field?: TelemetryFieldKey;
  /** Optional label prefix shown before the value, e.g. `ALT`. */
  label?: string;
  /** For kind:'text', the literal string. */
  text?: string;

  /** Anchor point in normalized [0,1] video coords. */
  anchor: Anchor;
  x: number;
  y: number;

  /**
   * Size as a fraction of the video's **shorter side** — width for portrait,
   * height for landscape. Keeps the apparent size consistent regardless of
   * orientation. For text this is the font size; for heading-arrow the radius.
   */
  fontFamily: OverlayFontFamily;
  sizeFrac: number;
  color: string;
  weight: FontWeight;
  italic: boolean;

  legibility: LegibilityStyle;
  visible: boolean;

  /**
   * `heading-arrow` only: when true, draw a compass ring with N/E/S/W labels
   * around the arrow. The ring rotates in relative mode, stays fixed in absolute.
   */
  showCompass?: boolean;

  // --- heading instruments (arrow + tape) ----------------------------------

  /**
   * Easing time constant in seconds for the reconstructed heading, on both the
   * arrow and the tape. 0 disables it (raw, stepping readings). The same
   * window bridges short data gaps — see telemetry/heading-smooth.ts.
   */
  headingSmoothing?: number;
  /** What to do while the heading is missing. Default 'dim'. */
  headingGap?: HeadingGapMode;
  /** How long a stale bearing keeps being shown, in seconds. Default 2. */
  headingHoldSeconds?: number;

  /**
   * `heading-arrow` + `showCompass` only.
   * - `'absolute'` (default / north-up): the ring is screen-aligned — N is always
   *   at the top. The arrow rotates to the current heading.
   * - `'relative'` (track-up): the ring rotates so the heading direction rises to
   *   the top, mirroring a "track-up" map. The arrow always points up.
   */
  compassMode?: 'absolute' | 'relative';

  /**
   * Speed / vertical-speed / heading readouts and the two heading instruments:
   * show the value **measured forward** over the clip's opening window while
   * there is no past to measure against, instead of `—` (see
   * telemetry/motion.ts). Defaults to **on** — the hole is a second at most,
   * but on a social cut it is the first second, and an instrument that spends
   * it blank is what the viewer remembers. Turn it off for the strictly
   * backward-looking reading.
   */
  earlyValues?: boolean;

  /**
   * `telemetry-field` only, for `gnd_speed` / `vert_speed`: which unit to
   * display. Defaults to `'m/s'` when absent.
   */
  speedUnit?: SpeedUnit;

  /**
   * `telemetry-field` only, for `clock` / `date` / `timestamp`: how this badge
   * reads (12h vs 24h, meridiem, seconds, date style). The *correction* to the
   * capture time is NOT here — it belongs to the footage, so it lives in the
   * project settings and applies to every time element at once.
   */
  timeFormat?: TimeFormatOptions;

  /**
   * `frame-corners` only: how far the brackets sit from the frame edges, as a
   * fraction of the shorter side. Defaults to 0.03.
   */
  cornerInset?: number;

  // --- heading tape --------------------------------------------------------
  // A sliding compass ribbon (see heading-tape.ts for the geometry).

  /** Degrees visible across the whole tape. Default 90 — wider reads flatter. */
  tapeSpanDeg?: number;
  /** Tape width as a fraction of the frame's width. Default 0.5. */
  tapeWidthFrac?: number;
  /** Degrees between labelled ticks. Default 30. */
  tapeMajorStep?: number;
  /** Degrees between plain ticks. Default 10. */
  tapeMinorStep?: number;
  /** Share of each half that dissolves into the image. 0..0.9, default 0.22. */
  tapeFadeFrac?: number;
  /** Tick height as a multiple of the label font size. Default 1. */
  tapeTickScale?: number;
  /** What marks the centre. Default 'both'. */
  tapeReticle?: TapeReticle;
  /** Sight colour — deliberately its own, so it reads against the ticks. */
  tapeReticleColor?: string;
  /** Draw the horizontal rule the ticks stand on. Default true. */
  tapeRule?: boolean;
  /** Letters (N/E/S/W) rather than degrees on the cardinal ticks. Default true. */
  tapeCardinals?: boolean;
  /** Where the "247° WSW" caption sits, or 'none'. Default 'above'. */
  tapeLabel?: LabelPlacement;
  /** Overall opacity of the ribbon, 0..1. Default 1. */
  tapeOpacity?: number;

  // --- battery gauge -------------------------------------------------------

  /** Where the level comes from. Default 'manual' — the sidecar has none. */
  batterySource?: BatterySource;
  /** `batterySource:'telemetry'`: the cue key to read; blank probes the known set. */
  batteryKey?: string;
  /** `batterySource:'manual'`: the authored percentage, 0..100. */
  batteryPercent?: number;
  /** Gauge width as a multiple of its height. Default 2.1. */
  batteryAspect?: number;
  /** Print the number beside the cell. Default true. */
  batteryShowPercent?: boolean;
  /** At or below this percentage the fill turns to `batteryLowColor`. Default 20. */
  batteryLowPercent?: number;
  /** The alarm colour. Default a warm red. */
  batteryLowColor?: string;
  /** Where the caption sits relative to the cell. Default 'right'. */
  batteryLabel?: LabelPlacement;

  // --- rotate-device prompt ------------------------------------------------

  /** Which way the phone tips. Default 'cw' — onto its right side. */
  rotateDirection?: RotateDirection;
  /** Seconds for one full tip (and return). Default 1.8. */
  rotateCycleSeconds?: number;
  /** Tip and come back, rather than tipping and holding. Default true. */
  rotateReturn?: boolean;
  /** Where the caption sits relative to the phone. Default 'below'. */
  rotateLabel?: LabelPlacement;

  // --- timing --------------------------------------------------------------

  /**
   * When this element is on screen, in seconds from the first exported frame —
   * or, when it belongs to a scene, from that scene's start (see scenes.ts).
   * Absent = the whole clip, which is what every element meant before windows
   * existed.
   */
  window?: TimeWindow;
  /** How it arrives and how it leaves. Absent = a hard cut. See animation.ts. */
  animation?: ElementAnimation;
  /**
   * The scene this element belongs to, if any. A scene lends it a window and
   * can hold back everything outside itself while it runs.
   */
  sceneId?: string;

  // --- appearance extensions (title styles) --------------------------------

  /** Render the text uppercase. Absent = false. */
  uppercase?: boolean;
  /** Extra letter spacing in em (fraction of font size). Absent = 0. */
  letterSpacingEm?: number;
  /** Element-level glow (used when 'glow' is overridden or there's no theme). */
  glowAmount?: number;
  glowWarmth?: number;

  /**
   * Appearance keys this element pins against the project theme (the cascade's
   * third level — see title-styles.ts). Absent/empty = fully themed. Ignored
   * when no theme is active: the element's own values always apply then.
   */
  styleOverrides?: string[];
}

/** Families that must be loaded via FontFace before canvas text is correct. */
export const BRAND_FONTS: ReadonlySet<OverlayFontFamily> = new Set([
  'Space Grotesk',
  'JetBrains Mono',
  'Instrument Serif',
  'VT323',
]);

/** The font choices offered in the style picker. */
export const CURATED_FONTS: readonly OverlayFontFamily[] = [
  'Space Grotesk',
  'JetBrains Mono',
  'Instrument Serif',
  'VT323',
  'Arial',
  'Georgia',
  'Courier New',
];

/** Short uppercase labels used as the default prefix per field. */
const SHORT_LABELS: Record<TelemetryFieldKey, string> = {
  rel_alt: 'ALT',
  abs_alt: 'ABS ALT',
  gnd_speed: 'SPEED',
  vert_speed: 'V.SPEED',
  heading: 'HDG',
  latitude: 'LAT',
  longitude: 'LON',
  iso: 'ISO',
  shutter: 'SHUTTER',
  fnum: 'APERTURE',
  ev: 'EV',
  focal_len: 'FOCAL',
  color_md: 'PROFILE',
  ct: 'WB',
  frame: 'FRAME',
  timestamp: 'TIME',
  clock: '',
  date: '',
};

/** A short, stable unique id (crypto where available, Math.random fallback). */
function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `el_${Math.random().toString(36).slice(2)}`;
}

const DEFAULT_LEGIBILITY: LegibilityStyle = {
  mode: 'shadow',
  color: 'rgba(0,0,0,0.65)',
  padFrac: 0.3,
};

/** Shared style defaults for a new element. */
function baseStyle(): Omit<OverlayElement, 'id' | 'kind' | 'anchor' | 'x' | 'y'> {
  return {
    fontFamily: 'Space Grotesk',
    sizeFrac: 0.045,
    color: '#ffffff',
    weight: 600,
    italic: false,
    legibility: { ...DEFAULT_LEGIBILITY },
    visible: true,
  };
}

/** Create a telemetry-field element for `field`, with its default label. */
export function createTelemetryElement(field: TelemetryFieldKey): OverlayElement {
  return {
    id: uid(),
    kind: 'telemetry-field',
    field,
    label: SHORT_LABELS[field],
    anchor: 'top-left',
    x: 0.05,
    y: 0.05,
    ...baseStyle(),
  };
}

/** Create a free-text element. */
export function createTextElement(text = 'Text'): OverlayElement {
  return {
    id: uid(),
    kind: 'text',
    text,
    anchor: 'top-left',
    x: 0.05,
    y: 0.05,
    ...baseStyle(),
  };
}

/**
 * Create the frame-corner brackets: four L-shaped marks inset from the frame
 * edges, the viewfinder furniture of a HUD. It spans the whole frame, so it
 * ignores anchor/position — `sizeFrac` is the arm length, `cornerInset` the
 * distance from the edges.
 */
export function createFrameCornersElement(): OverlayElement {
  return {
    id: uid(),
    kind: 'frame-corners',
    anchor: 'center',
    x: 0.5,
    y: 0.5,
    ...baseStyle(),
    sizeFrac: 0.05,
    cornerInset: 0.03,
    legibility: { mode: 'none', color: 'rgba(0,0,0,0.65)', padFrac: 0.3 },
  };
}

/**
 * Create a heading-arrow element: a canvas-drawn chevron that rotates to the
 * current course-over-ground heading. Shrinks to a dot while the drone hovers.
 */
export function createHeadingArrowElement(): OverlayElement {
  return {
    id: uid(),
    kind: 'heading-arrow',
    anchor: 'center',
    x: 0.5,
    y: 0.5,
    ...baseStyle(),
    sizeFrac: 0.06,
    headingSmoothing: 0.6,
    headingGap: 'dim',
    headingHoldSeconds: 2,
  };
}

/**
 * Create a heading tape: the sliding compass ribbon, ticks under a fixed
 * centre sight, ends dissolving into the image. Sits across the top by
 * default, where a cockpit HUD puts it.
 */
export function createHeadingTapeElement(): OverlayElement {
  return {
    id: uid(),
    kind: 'heading-tape',
    anchor: 'top-center',
    x: 0.5,
    y: 0.06,
    ...baseStyle(),
    sizeFrac: 0.028,
    tapeSpanDeg: 90,
    tapeWidthFrac: 0.5,
    tapeMajorStep: 30,
    tapeMinorStep: 10,
    tapeFadeFrac: 0.22,
    tapeTickScale: 1,
    tapeReticle: 'both',
    tapeReticleColor: '#e2542f',
    tapeRule: true,
    tapeCardinals: true,
    tapeLabel: 'above',
    tapeOpacity: 1,
    headingSmoothing: 0.6,
    headingGap: 'dim',
    headingHoldSeconds: 2,
    legibility: { mode: 'shadow', color: 'rgba(0,0,0,0.55)', padFrac: 0.3 },
  };
}

/**
 * Create a battery gauge. Manual by default and on purpose: the DJI video
 * sidecar carries no state of charge (see battery.ts), so an author sets the
 * level as a prop, or points the gauge at a telemetry key if their firmware
 * ever writes one.
 */
export function createBatteryElement(): OverlayElement {
  return {
    id: uid(),
    kind: 'battery',
    anchor: 'top-right',
    x: 0.95,
    y: 0.05,
    ...baseStyle(),
    sizeFrac: 0.03,
    batterySource: 'manual',
    batteryPercent: 100,
    batteryAspect: 2.1,
    batteryShowPercent: true,
    batteryLowPercent: 20,
    batteryLowColor: '#e2402a',
    batteryLabel: 'right',
  };
}

/**
 * Create the "turn your phone" prompt: a phone pictogram that tips a quarter
 * turn, with a caption under it.
 *
 * It is a drawing, not a control: the export is a flat video, so the only way
 * to invite a viewer to rotate their screen is to show them the gesture. That
 * is also why the tipping matters more than the words — it reads before the
 * caption does, and it survives a viewer who does not read the caption's
 * language.
 */
export function createRotateDeviceElement(): OverlayElement {
  return {
    id: uid(),
    kind: 'rotate-device',
    text: 'Rotate your phone',
    anchor: 'center',
    x: 0.5,
    y: 0.5,
    ...baseStyle(),
    sizeFrac: 0.16,
    rotateDirection: 'cw',
    rotateCycleSeconds: 1.8,
    rotateReturn: true,
    rotateLabel: 'below',
    legibility: { mode: 'shadow', color: 'rgba(0,0,0,0.55)', padFrac: 0.3 },
  };
}

/**
 * A sensible starter deck: altitude headline with speed and heading beneath it,
 * GPS bottom-left and the exposure pair top-right.
 */
export function defaultElementsPreset(): OverlayElement[] {
  const alt = createTelemetryElement('rel_alt');
  alt.anchor = 'top-left';
  alt.x = 0.04;
  alt.y = 0.05;

  const speed = createTelemetryElement('gnd_speed');
  speed.anchor = 'top-left';
  speed.x = 0.04;
  speed.y = 0.12;
  speed.sizeFrac = 0.03;

  const heading = createTelemetryElement('heading');
  heading.anchor = 'top-left';
  heading.x = 0.04;
  heading.y = 0.16;
  heading.sizeFrac = 0.03;

  const lat = createTelemetryElement('latitude');
  lat.anchor = 'bottom-left';
  lat.x = 0.04;
  lat.y = 0.95;
  lat.sizeFrac = 0.03;

  const lon = createTelemetryElement('longitude');
  lon.anchor = 'bottom-left';
  lon.x = 0.04;
  lon.y = 0.99;
  lon.sizeFrac = 0.03;

  const iso = createTelemetryElement('iso');
  iso.anchor = 'top-right';
  iso.x = 0.96;
  iso.y = 0.05;
  iso.sizeFrac = 0.03;

  const shutter = createTelemetryElement('shutter');
  shutter.anchor = 'top-right';
  shutter.x = 0.96;
  shutter.y = 0.09;
  shutter.sizeFrac = 0.03;

  return [alt, speed, heading, lat, lon, iso, shutter];
}
