/**
 * DELIVERY PRESETS: the export targets a network or a use asks for, by name,
 * so an agent says "for Instagram" and the roll's targets are set rather
 * than spelt out — the sizes each platform re-encodes at today, as JPEGs
 * with the suite's standard screen sharpening. A table, nothing measured
 * here: a platform changes its numbers, and this is where they change.
 *
 * Each preset is a LIST of targets (`export-targets.ts`): the first writes
 * into the export folder, the others into a sub-folder named after them.
 * Written through `patchRollExport`, so every number is checked as a
 * person's would be.
 *
 * Pure and DOM-free.
 */

import { CommandError } from '../commands/registry';
import type { ExportTarget } from './export-targets';

export interface DeliveryPreset {
  id: string;
  name: string;
  /** What it is for, in one line. */
  does: string;
  targets: ExportTarget[];
}

const jpeg = (name: string, size: ExportTarget['size'], quality = 0.9, sharpen: ExportTarget['sharpen'] = 'standard'): ExportTarget => ({
  name,
  size,
  format: 'jpeg',
  quality,
  sharpen,
  watermark: false,
});

export const DELIVERY_PRESETS: readonly DeliveryPreset[] = [
  {
    id: 'instagram',
    name: 'Instagram',
    does: 'The feed (1080 wide, a 4:5 frame fills it) and a story or reel cover (1920 tall) — two targets.',
    targets: [jpeg('feed', { mode: 'short', value: 1080 }), jpeg('story', { mode: 'long', value: 1920 })],
  },
  {
    id: 'instagram-feed',
    name: 'Instagram feed',
    does: 'The feed alone: 1080 on the short side, JPEG 0.9.',
    targets: [jpeg('feed', { mode: 'short', value: 1080 })],
  },
  {
    id: 'instagram-story',
    name: 'Instagram story',
    does: 'A story or a reel cover: 1920 on the long side, JPEG 0.9.',
    targets: [jpeg('story', { mode: 'long', value: 1920 })],
  },
  {
    id: 'x',
    name: 'X / Threads',
    does: '2048 on the long side, JPEG 0.9 — what the timeline keeps before it re-encodes.',
    targets: [jpeg('x', { mode: 'long', value: 2048 })],
  },
  {
    id: 'web',
    name: 'Web',
    does: 'A page or a blog: 2560 on the long side, JPEG 0.85.',
    targets: [jpeg('web', { mode: 'long', value: 2560 }, 0.85)],
  },
  {
    id: 'archive',
    name: 'Archive',
    does: 'The picture at its own size, JPEG 0.95, no screen sharpening — a master, plus a 2048 web copy.',
    targets: [jpeg('archive', null, 0.95, 'off'), jpeg('web', { mode: 'long', value: 2048 }, 0.88)],
  },
  {
    id: 'print',
    name: 'Print',
    does: 'The picture at its own size, JPEG 0.97, no screen sharpening — what a lab wants.',
    targets: [jpeg('print', null, 0.97, 'off')],
  },
];

/** A preset by its id or name (case aside), or refused with the list. */
export function findDeliveryPreset(key: string): DeliveryPreset {
  const want = key.trim().toLowerCase();
  const found = DELIVERY_PRESETS.find((p) => p.id === want || p.name.toLowerCase() === want);
  if (!found) throw new CommandError('invalid', `no delivery preset "${key}" — the presets are ${DELIVERY_PRESETS.map((p) => p.id).join(', ')}`);
  return found;
}
