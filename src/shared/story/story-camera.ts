/**
 * The camera over a Storytelling map (road lab C3, his « je valide »): the
 * camera Virée and the Itinerary follow their vehicle with (`map-camera.ts`,
 * `subjectTrack` — a centred smoothing window, a look-ahead, the map turned
 * with the heading under a turn limit, the whole route opening and closing
 * the shot), following the HEAD of the story's route. One engine for both
 * tools: what makes Virée steadier makes this map steadier.
 *
 * The presets keep Trips' names and roles at the story's own scale: a post's
 * map crosses a continent in four seconds, where an opener's crosses a day,
 * so Calm sees 2 600 km rather than 120. « As before » is the camera of
 * before 2026-11-01 — ×2.3 on the head, a pull back at the end — kept for the
 * posts already made; a series that chose none still has it. (pure)
 */
import { subjectTrack, type CameraOptions } from '../roadtrip/hooks/map-camera';
import type { CameraFrame, CameraTrack, PlanPoint } from '../roadtrip/hooks/drive-plan';

export type StoryCameraPreset = 'before' | 'calm' | 'navigation' | 'documentary' | 'own';

export interface StoryCamera {
  preset?: StoryCameraPreset;
  /** Kilometres across the frame while following. */
  viewKm?: number;
  /** Seconds of the centred window over the head's position. */
  smoothing?: number;
  /** Seconds the camera reads the head ahead of now. */
  lookAhead?: number;
  /** North up, or the map turned so the route runs up the frame. */
  orientation?: 'north' | 'heading';
  /** Degrees per second the map may turn at most. */
  maxTurn?: number;
  /** Opens on, and ends on, the whole map. */
  openWide?: boolean;
  endWide?: boolean;
}

export type StoryCameraValues = Required<Omit<StoryCamera, 'preset'>>;
type Values = StoryCameraValues;

export const STORY_CAMERA_PRESETS: Record<Exclude<StoryCameraPreset, 'own' | 'before'>, { label: string; hint: string; values: Values }> = {
  calm: {
    label: 'Calm',
    hint: 'Wide and steady, opening and closing on the whole map',
    values: { viewKm: 2600, smoothing: 1.1, lookAhead: 0.4, orientation: 'north', maxTurn: 50, openWide: true, endWide: true },
  },
  navigation: {
    label: 'Navigation',
    hint: 'Close behind the head, the road ahead up the frame',
    values: { viewKm: 1400, smoothing: 0.7, lookAhead: 0.7, orientation: 'heading', maxTurn: 60, openWide: false, endWide: true },
  },
  documentary: {
    label: 'Documentary',
    hint: 'High, slow and wide',
    values: { viewKm: 4200, smoothing: 1.8, lookAhead: 0.2, orientation: 'north', maxTurn: 40, openWide: true, endWide: true },
  },
};

export const STORY_CAMERA_LIMITS = {
  viewKm: [600, 900, 1400, 2000, 2600, 3400, 4200] as const,
  smoothing: [0, 0.4, 0.7, 1.1, 1.8, 2.5] as const,
  lookAhead: [0, 0.2, 0.4, 0.7, 1, 1.5] as const,
};

/** A series that chose no camera keeps the one of before. */
export const DEFAULT_STORY_CAMERA: StoryCamera = { preset: 'before' };

/** The camera a series' setting means: `null` for « As before » (the old path draws it). (pure) */
export function cameraValues(c: StoryCamera | null | undefined): Values | null {
  const preset = c?.preset ?? 'before';
  if (preset === 'before') return null;
  const base = preset === 'own' ? STORY_CAMERA_PRESETS.calm.values : STORY_CAMERA_PRESETS[preset].values;
  if (preset !== 'own') return base;
  const v = c ?? {};
  return {
    viewKm: v.viewKm ?? base.viewKm,
    smoothing: v.smoothing ?? base.smoothing,
    lookAhead: v.lookAhead ?? base.lookAhead,
    orientation: v.orientation ?? base.orientation,
    maxTurn: v.maxTurn ?? base.maxTurn,
    openWide: v.openWide ?? base.openWide,
    endWide: v.endWide ?? base.endWide,
  };
}

/** A series' camera, kept field by field when well formed. (pure) */
export function readStoryCamera(raw: unknown): StoryCamera | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined);
  const out: StoryCamera = {};
  if (typeof r.preset === 'string' && ['before', 'calm', 'navigation', 'documentary', 'own'].includes(r.preset)) out.preset = r.preset as StoryCameraPreset;
  const viewKm = num(r.viewKm, 200, 8000);
  const smoothing = num(r.smoothing, 0, 2.5);
  const lookAhead = num(r.lookAhead, 0, 1.5);
  const maxTurn = num(r.maxTurn, 15, 180);
  if (viewKm !== undefined) out.viewKm = viewKm;
  if (smoothing !== undefined) out.smoothing = smoothing;
  if (lookAhead !== undefined) out.lookAhead = lookAhead;
  if (maxTurn !== undefined) out.maxTurn = maxTurn;
  if (r.orientation === 'north' || r.orientation === 'heading') out.orientation = r.orientation;
  if (typeof r.openWide === 'boolean') out.openWide = r.openWide;
  if (typeof r.endWide === 'boolean') out.endWide = r.endWide;
  return Object.keys(out).length ? out : undefined;
}

/** The story map's frame at ×1, in its own units: 1 080 across, centred on (540, 900) like `drawMap`'s pull-back. */
const WHOLE = { x0: 0, y0: -60, x1: 1080, y1: 1860 };
const BOX = { width: 1080, height: 1920 };
/**
 * Kilometres per map unit: `proj` puts 23.6 units in a degree of latitude
 * (111 km) and 21.4 in a degree of longitude at the map's 27° S (99 km) —
 * 4.7 either way, which is what the view's width is read through.
 */
export const KM_PER_MAP_UNIT = 4.7;

/**
 * Bake the camera following `at(t)` (the head, map units) for `seconds`.
 * Cached by the caller: a frame reads it with `track.at(t)`. (pure)
 */
export function storyCameraTrack(v: Values, seconds: number, at: (t: number) => PlanPoint): CameraTrack {
  const o: CameraOptions = {
    camera: 'follow',
    viewKm: v.viewKm,
    followZoom: 0.3,
    zoom: 'fixed',
    pullBack: 0,
    orientation: v.orientation,
    smoothing: v.smoothing,
    lookAhead: v.lookAhead,
    turnSmoothing: 1.4,
    maxTurn: v.maxTurn,
    openWide: v.openWide,
    endWide: v.endWide,
  };
  return subjectTrack(
    { seconds, at: (t) => at(Math.max(0, Math.min(seconds, t))), runAt: () => null, bounds: WHOLE, kmPerUnit: KM_PER_MAP_UNIT },
    o,
    BOX,
    0,
  );
}

/** The canvas transform a camera frame asks of the story map: centre on (540, 900), turned, scaled. */
export function frameScale(f: CameraFrame): number {
  return BOX.width / Math.max(1e-6, f.width);
}

let CAMERA: StoryCameraValues | null = null;
/** Set the camera the frames that follow draw the map with (`compose.ts`); none = as before. */
export function setStoryCamera(c: StoryCamera | null | undefined): void {
  CAMERA = cameraValues(c);
}
/** The camera in force, or null for the one of before. */
export const storyCamera = (): StoryCameraValues | null => CAMERA;
