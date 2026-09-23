import { lazy, type ComponentType } from 'react';
import type { AssetKind } from '../shared/library/assets';

/**
 * Every tool is its own chunk, loaded the first time its route is opened.
 *
 * The registry used to import all ten components statically, so the whole
 * suite — the Develop workbench, the Trips editor, the Studio, the render
 * graph and everything they reach — travelled in ONE 1.9 MB script that the
 * home page and every instrument paid for before painting a thing. A
 * `lazy()` per tool lets Rollup cut the bundle at the one seam the suite
 * already has: nothing under `src/tools/<a>/` imports `src/tools/<b>/`, and
 * nothing in the shell imports a tool except this file. Shared modules that
 * two tools both reach are hoisted into common chunks by the bundler, so a
 * second tool on the same visit downloads only what it alone needs.
 *
 * The shell draws the wait (`App.tsx`, a `Suspense` around the tool) and
 * `main.tsx` handles the one failure this creates: a chunk name that no
 * longer exists after a deploy. Each loader is also the tool's `preload`,
 * so a menu can fetch the chunk on hover, before the click.
 */
const LOAD = {
  compare: () => import('../tools/compare/CompareTool'),
  composer: () => import('../tools/composer/ComposerTool'),
  develop: () => import('../tools/develop/DevelopTool'),
  exif: () => import('../tools/exif/ExifTool'),
  lut: () => import('../tools/lut/LutStudio'),
  map: () => import('../tools/map/MapTool'),
  overlay: () => import('../tools/overlay/OverlayStudio'),
  roadtrip: () => import('../tools/roadtrip/RoadTripTool'),
  studio: () => import('../tools/studio/StudioTool'),
  telemetry: () => import('../tools/telemetry/TelemetryTool'),
};
const CompareTool = lazy(LOAD.compare);
const ComposerTool = lazy(LOAD.composer);
const DevelopTool = lazy(LOAD.develop);
const ExifTool = lazy(LOAD.exif);
const LutStudio = lazy(LOAD.lut);
const MapTool = lazy(LOAD.map);
const OverlayStudio = lazy(LOAD.overlay);
const RoadTripTool = lazy(LOAD.roadtrip);
const StudioTool = lazy(LOAD.studio);
const TelemetryTool = lazy(LOAD.telemetry);

/**
 * The tool registry — the single source of truth for the suite. The masthead
 * nav and the router both derive from this list, so adding a tool is one entry
 * here plus its component. Each tool is self-contained (owns its own state).
 */
export interface Tool {
  /** Stable id, also used for the active-nav highlight. */
  id: string;
  /** Route path (the hash without `#`), e.g. `/lut`. */
  path: string;
  /** Nav label. */
  label: string;
  /** The card's eyebrow on the home page. */
  subtitle?: string;
  /**
   * Where the switcher files it. The `editor`s are where the suite is
   * converging (`studio.md`); an `instrument` is one of the standalone pages
   * kept until the Studio absorbs it. The list will grow — that is why the
   * switcher is a menu and not a row of segments.
   */
  group: 'editor' | 'instrument';
  /** One-line pitch shown on the home page card. */
  blurb?: string;
  /** The tool's root component. */
  Component: ComponentType;
  /**
   * Fetch the tool's chunk ahead of a click (the switcher does it on hover
   * and focus), so the route's `Suspense` fallback is rarely seen. The same
   * loader `Component` was made from, so it resolves to the same module.
   */
  preload: () => Promise<unknown>;
  /**
   * Asset kinds this tool consumes. Every tool reads from the global asset
   * library: the shell shows the library sidebar and the tool takes its
   * selection from there, filtered to these kinds.
   */
  accepts: AssetKind[];
}

export const TOOLS: Tool[] = [
  {
    id: 'studio',
    group: 'editor',
    path: '/studio',
    label: 'Studio',
    subtitle: 'Unified editor',
    blurb:
      'One place to edit a clip or a photo: overlay telemetry and text, grade through a LUT, and export the result — the editor the whole suite is converging on.',
    Component: StudioTool,
    preload: LOAD.studio,
    accepts: ['video+telemetry', 'video', 'photo'],
  },
  {
    id: 'roadtrip',
    group: 'editor',
    path: '/roadtrip',
    label: 'Trips',
    subtitle: 'Trip · days · posts',
    blurb:
      'Give a trip its dates and every photo knows which day it belongs to — a grid of the whole journey shows what you have told and what you never have.',
    Component: RoadTripTool,
    preload: LOAD.roadtrip,
    accepts: ['photo', 'video+telemetry', 'video'],
  },
  {
    id: 'develop',
    group: 'editor',
    path: '/develop',
    label: 'Develop',
    subtitle: 'Roll · pictures · look',
    blurb:
      'Gather the photographs you mean to develop into a roll — from a folder or a day on your Winnow — and give each its own light and colour, under one look for the roll.',
    Component: DevelopTool,
    preload: LOAD.develop,
    accepts: ['photo'],
  },
  {
    id: 'telemetry',
    group: 'instrument',
    path: '/telemetry',
    label: 'DJI Telemetry',
    subtitle: 'DJI · SRT telemetry',
    blurb:
      'Play any DJI clip with its flight log in sync — altitude, GPS, ISO and shutter move with the frame.',
    Component: TelemetryTool,
    preload: LOAD.telemetry,
    accepts: ['video+telemetry', 'telemetry', 'video'],
  },
  {
    id: 'overlay',
    group: 'instrument',
    path: '/overlay',
    label: 'Telemetry Overlay',
    subtitle: 'Burn-in telemetry',
    blurb:
      'Place altitude, GPS and exposure readouts anywhere on your DJI clip, then export an MP4 with the telemetry burned in.',
    Component: OverlayStudio,
    preload: LOAD.overlay,
    accepts: ['video+telemetry'],
  },
  {
    id: 'map',
    group: 'instrument',
    path: '/map',
    label: 'Flight Map',
    subtitle: 'GPS flight path',
    blurb:
      'Trace a DJI clip’s GPS path on a map and scrub the video to walk the aircraft along it. Draws offline; the map background is opt-in.',
    Component: MapTool,
    preload: LOAD.map,
    accepts: ['video+telemetry', 'telemetry'],
  },
  {
    id: 'composer',
    group: 'instrument',
    path: '/composer',
    label: 'Composer',
    subtitle: 'Video + map + telemetry',
    blurb:
      'Compose a DJI clip with its flight map and a draggable telemetry readout into one frame — pick the aspect, layout and a LUT, and preview the assembly.',
    Component: ComposerTool,
    preload: LOAD.composer,
    accepts: ['video+telemetry'],
  },
  {
    id: 'exif',
    group: 'instrument',
    path: '/exif',
    label: 'Photo EXIF',
    subtitle: 'Camera · lens · GPS',
    blurb:
      'Inspect any photo’s metadata — camera, lens, the full exposure triplet and GPS location — read straight from the file, even RAW.',
    Component: ExifTool,
    preload: LOAD.exif,
    accepts: ['photo'],
  },
  {
    id: 'compare',
    group: 'instrument',
    path: '/compare',
    label: 'Compare A/B',
    subtitle: 'Before/after wipe',
    blurb:
      'Lay any two photos or clips side by side under a draggable divider — two grades, two takes, before and after — with synced playback for clips.',
    Component: CompareTool,
    preload: LOAD.compare,
    accepts: ['photo', 'video'],
  },
  {
    id: 'lut',
    group: 'instrument',
    path: '/lut',
    label: 'LUT Studio',
    subtitle: 'Colour grading',
    blurb:
      'Preview .cube LUTs on your footage with a before/after wipe, then batch-export the graded clips.',
    Component: LutStudio,
    preload: LOAD.lut,
    accepts: ['video'],
  },
];

/** Route path of the home page (the empty hash). */
export const HOME_PATH = '/';

/**
 * Resolve a route to its tool. A tool owns its sub-routes too (`/studio/home`
 * belongs to `/studio`) — the tool component reads the hash itself to pick the
 * sub-view, so the shell stays a two-level router.
 */
export function toolForPath(path: string): Tool | undefined {
  return TOOLS.find((t) => t.path === path || path.startsWith(`${t.path}/`));
}
