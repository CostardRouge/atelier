import type { ComponentType } from 'react';
import type { AssetKind } from '../shared/library/assets';
import LutStudio from '../tools/lut/LutStudio';
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
  /** When set, the shell becomes a fixed-height frame (e.g. an editor). */
  fullHeight?: boolean;
  /**
   * Asset kinds this tool consumes. When set, the shell shows the global asset
   * library sidebar and the tool reads its selection from there. Tools without
   * `accepts` keep their own import flow (full width, no sidebar).
   */
  accepts?: AssetKind[];
}

export const TOOLS: Tool[] = [
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
    id: 'lut',
    path: '/lut',
    label: 'LUT Studio',
    subtitle: 'Colour grading',
    blurb:
      'Preview .cube LUTs on your footage with a before/after wipe, then batch-export the graded clips.',
    Component: LutStudio,
    fullHeight: true,
    accepts: ['video'],
  },
];

/** Route path of the home page (the empty hash). */
export const HOME_PATH = '/';

export function toolForPath(path: string): Tool | undefined {
  return TOOLS.find((t) => t.path === path);
}
