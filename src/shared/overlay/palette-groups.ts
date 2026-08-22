/**
 * What the component palette offers, and in what order — pure data.
 *
 * The palette is a grid of three cells per row inside a 340px inspector, so the
 * eighteen telemetry fields plus the three shapes only stay readable if they
 * are grouped: a pilot looks for "speed" under Flight, not in an alphabetical
 * wall. The unit test beside this file guarantees a field added to the model
 * can never stay unreachable from the palette.
 */

import type { IntroPresetId } from './intro-presets';
import type { TelemetryFieldKey } from './overlay-types';

/**
 * A cell is usually one element kind. The Intro group is the exception: its
 * cells are **presets** (see intro-presets.ts) — a hook title and a subtitle
 * are both text elements, told apart by size, placement and entrance, not by
 * kind.
 */
export type PaletteItem =
  | { kind: 'telemetry-field'; field: TelemetryFieldKey }
  | { kind: 'text' }
  | { kind: 'heading-arrow' }
  | { kind: 'heading-tape' }
  | { kind: 'frame-corners' }
  | { kind: 'battery' }
  | { kind: 'preset'; preset: IntroPresetId };

export interface PaletteGroup {
  /** Section header — short, it sits above a three-column grid. */
  label: string;
  items: readonly PaletteItem[];
}

function field(f: TelemetryFieldKey): PaletteItem {
  return { kind: 'telemetry-field', field: f };
}

export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  {
    // First, because it is where a social cut starts: the hook is what decides
    // whether the flight footage underneath is watched at all.
    label: 'Intro',
    items: [
      { kind: 'preset', preset: 'hook-title' },
      { kind: 'preset', preset: 'subtitle' },
      { kind: 'preset', preset: 'question' },
      { kind: 'preset', preset: 'rotate-phone' },
    ],
  },
  {
    label: 'Flight',
    items: [
      field('rel_alt'),
      field('abs_alt'),
      field('gnd_speed'),
      field('vert_speed'),
      field('heading'),
      field('latitude'),
      field('longitude'),
    ],
  },
  {
    label: 'Camera',
    items: [
      field('iso'),
      field('shutter'),
      field('fnum'),
      field('ev'),
      field('focal_len'),
      field('color_md'),
      field('ct'),
    ],
  },
  {
    label: 'Time',
    items: [field('clock'), field('date'), field('timestamp'), field('frame')],
  },
  {
    label: 'Instruments',
    items: [{ kind: 'heading-tape' }, { kind: 'heading-arrow' }, { kind: 'battery' }],
  },
  {
    label: 'Shapes',
    items: [{ kind: 'text' }, { kind: 'frame-corners' }],
  },
];
