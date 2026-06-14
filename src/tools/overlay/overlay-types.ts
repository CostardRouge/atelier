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
  | 'timestamp';

export type OverlayKind = 'telemetry-field' | 'text';

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

  /** Font size as a fraction of video height (resolution-independent). */
  fontFamily: OverlayFontFamily;
  sizeFrac: number;
  color: string;
  weight: FontWeight;
  italic: boolean;

  legibility: LegibilityStyle;
  visible: boolean;
}

/** Families that must be loaded via FontFace before canvas text is correct. */
export const BRAND_FONTS: ReadonlySet<OverlayFontFamily> = new Set([
  'Space Grotesk',
  'JetBrains Mono',
  'Instrument Serif',
]);

/** The font choices offered in the style picker. */
export const CURATED_FONTS: readonly OverlayFontFamily[] = [
  'Space Grotesk',
  'JetBrains Mono',
  'Instrument Serif',
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
