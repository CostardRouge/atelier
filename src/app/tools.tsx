import type { ComponentType } from 'react';
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
  /** The tool's root component. */
  Component: ComponentType;
  /** When set, the shell becomes a fixed-height frame (e.g. an editor). */
  fullHeight?: boolean;
}

export const TOOLS: Tool[] = [
  {
    id: 'telemetry',
    path: '/telemetry',
    label: 'Telemetry',
    subtitle: 'DJI · SRT telemetry',
    Component: TelemetryTool,
  },
  {
    id: 'lut',
    path: '/lut',
    label: 'LUT Studio',
    subtitle: 'Colour grading',
    Component: LutStudio,
    fullHeight: true,
  },
];

/** The tool shown for an empty or unknown route. */
export const DEFAULT_TOOL = TOOLS[0];

export function toolForPath(path: string): Tool | undefined {
  return TOOLS.find((t) => t.path === path);
}
