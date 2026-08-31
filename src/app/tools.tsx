import type { ComponentType } from 'react';
import type { AssetKind } from '../shared/library/assets';
import CompareTool from '../tools/compare/CompareTool';
import ComposerTool from '../tools/composer/ComposerTool';
import ExifTool from '../tools/exif/ExifTool';
import LutStudio from '../tools/lut/LutStudio';
import MapTool from '../tools/map/MapTool';
import OverlayStudio from '../tools/overlay/OverlayStudio';
import RoadTripTool from '../tools/roadtrip/RoadTripTool';
import StudioTool from '../tools/studio/StudioTool';
import TelemetryTool from '../tools/telemetry/TelemetryTool';

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
  /** Optional contextual caption shown beside the wordmark when active. */
  subtitle?: string;
  /** One-line pitch shown on the home page card. */
  blurb?: string;
  /** The tool's root component. */
  Component: ComponentType;
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
    path: '/studio',
    label: 'Studio',
    subtitle: 'Unified editor',
    blurb:
      'One place to edit a clip or a photo: overlay telemetry and text, grade through a LUT, and export the result — the editor the whole suite is converging on.',
    Component: StudioTool,
    accepts: ['video+telemetry', 'video', 'photo'],
  },
  {
    id: 'roadtrip',
    path: '/roadtrip',
    label: 'Road Trip',
    subtitle: 'Trip · days · posts',
    blurb:
      'Give a trip its dates and every photo knows which day it belongs to — a grid of the whole journey shows what you have told and what you never have.',
    Component: RoadTripTool,
    accepts: ['photo', 'video+telemetry', 'video'],
  },
  {
    id: 'telemetry',
    path: '/telemetry',
    label: 'DJI Telemetry',
    subtitle: 'DJI · SRT telemetry',
    blurb:
      'Play any DJI clip with its flight log in sync — altitude, GPS, ISO and shutter move with the frame.',
    Component: TelemetryTool,
    accepts: ['video+telemetry', 'telemetry', 'video'],
  },
  {
    id: 'overlay',
    path: '/overlay',
    label: 'Telemetry Overlay',
    subtitle: 'Burn-in telemetry',
    blurb:
      'Place altitude, GPS and exposure readouts anywhere on your DJI clip, then export an MP4 with the telemetry burned in.',
    Component: OverlayStudio,
    accepts: ['video+telemetry'],
  },
  {
    id: 'map',
    path: '/map',
    label: 'Flight Map',
    subtitle: 'GPS flight path',
    blurb:
      'Trace a DJI clip’s GPS path on a map and scrub the video to walk the aircraft along it. Draws offline; the map background is opt-in.',
    Component: MapTool,
    accepts: ['video+telemetry', 'telemetry'],
  },
  {
    id: 'composer',
    path: '/composer',
    label: 'Composer',
    subtitle: 'Video + map + telemetry',
    blurb:
      'Compose a DJI clip with its flight map and a draggable telemetry readout into one frame — pick the aspect, layout and a LUT, and preview the assembly.',
    Component: ComposerTool,
    accepts: ['video+telemetry'],
  },
  {
    id: 'exif',
    path: '/exif',
    label: 'Photo EXIF',
    subtitle: 'Camera · lens · GPS',
    blurb:
      'Inspect any photo’s metadata — camera, lens, the full exposure triplet and GPS location — read straight from the file, even RAW.',
    Component: ExifTool,
    accepts: ['photo'],
  },
  {
    id: 'compare',
    path: '/compare',
    label: 'Compare A/B',
    subtitle: 'Before/after wipe',
    blurb:
      'Lay any two photos or clips side by side under a draggable divider — two grades, two takes, before and after — with synced playback for clips.',
    Component: CompareTool,
    accepts: ['photo', 'video'],
  },
  {
    id: 'lut',
    path: '/lut',
    label: 'LUT Studio',
    subtitle: 'Colour grading',
    blurb:
      'Preview .cube LUTs on your footage with a before/after wipe, then batch-export the graded clips.',
    Component: LutStudio,
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
