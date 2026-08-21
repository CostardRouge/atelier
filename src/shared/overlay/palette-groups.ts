/**
 * What the component palette offers, and in what order — pure data.
 *
 * The palette is a grid of three cells per row inside a 340px inspector, so the
 * eighteen telemetry fields plus the three shapes only stay readable if they
 * are grouped: a pilot looks for "speed" under Flight, not in an alphabetical
 * wall. The unit test beside this file guarantees a field added to the model
 * can never stay unreachable from the palette.
 */

import type { TelemetryFieldKey } from './overlay-types';

export type PaletteItem =
  | { kind: 'telemetry-field'; field: TelemetryFieldKey }
  | { kind: 'text' }
  | { kind: 'heading-arrow' }
  | { kind: 'frame-corners' };

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
    label: 'Shapes',
    items: [{ kind: 'text' }, { kind: 'heading-arrow' }, { kind: 'frame-corners' }],
  },
];
