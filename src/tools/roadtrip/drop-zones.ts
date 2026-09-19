/**
 * What the stage shows while a picture is dragged onto it — pure, tested.
 *
 * The zones are the collage's cells in CSS pixels over the stage (or the
 * whole frame when the slide holds one picture), each knowing what it holds,
 * so a target can say "Replace pic-D" rather than a bare "Drop here". The
 * copy is here too, one function per question, so the words a person reads
 * while dragging are the same wherever a drop is offered.
 */

import type { CellRect } from '../../shared/media/media-layout';

/** One place a picture can land, in the stage's CSS pixels. */
export interface DropZone {
  /** The cell index — 0 is the slide's own picture. */
  index: number;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Degrees clockwise about the zone's centre — only a print turns. */
  rotation: number;
  /** The name of what the cell holds now, or null for an empty one. */
  holding: string | null;
}

/**
 * The zones for a stage `cssW` × `cssH` whose canvas is `canvasW` wide.
 * Without cells (no collage) the whole frame is zone 0.
 */
export function dropZones(
  cells: readonly CellRect[],
  canvasW: number,
  cssW: number,
  cssH: number,
  holding: readonly (string | null)[],
): DropZone[] {
  if (cells.length === 0) {
    return [{ index: 0, x: 0, y: 0, w: cssW, h: cssH, rotation: 0, holding: holding[0] ?? null }];
  }
  const k = canvasW > 0 ? cssW / canvasW : 1;
  return cells.map((c, i) => ({
    index: i,
    x: c.x * k,
    y: c.y * k,
    w: c.w * k,
    h: c.h * k,
    rotation: c.rotation,
    holding: holding[i] ?? null,
  }));
}

/** Where a drop is in its life, as the stage draws it. */
export type DropPhase = 'over' | 'fetching' | 'placed' | 'failed';

export type ChipTone = 'accent' | 'ok' | 'danger' | 'muted';

export interface DropChip {
  /** The verb, large. */
  title: string;
  /** What it applies to, small — a cell, a picture, a reason. */
  detail: string | null;
  tone: ChipTone;
  /** Which glyph leads the chip. */
  icon: 'plus' | 'swap' | 'check' | 'warning' | 'wait';
}

export interface DropChipInput {
  phase: DropPhase;
  /** The zone the chip sits in. */
  zone: Pick<DropZone, 'index' | 'holding'>;
  /** Whether the slide is a collage — a single picture has no cells to name. */
  collage: boolean;
  /** The picture being dropped. */
  label: string;
  /** Where it is being fetched from, while it is. */
  source?: string | null;
  /** Why it failed, when it did. */
  reason?: string | null;
}

/** The chip a zone wears for one phase of a drop. */
export function dropChip(input: DropChipInput): DropChip {
  const { phase, zone, collage, label } = input;
  switch (phase) {
    case 'over':
      if (zone.holding) {
        return {
          title: collage ? 'Replace' : 'Replace the picture',
          detail: zone.holding,
          tone: 'accent',
          icon: 'swap',
        };
      }
      return {
        title: collage ? 'Place here' : 'Use this picture',
        detail: collage ? `Cell ${zone.index + 1}` : label,
        tone: 'accent',
        icon: 'plus',
      };
    case 'fetching':
      return {
        title: 'Fetching…',
        detail: input.source ? `from ${input.source}` : label,
        tone: 'muted',
        icon: 'wait',
      };
    case 'placed':
      return { title: 'Placed', detail: label, tone: 'ok', icon: 'check' };
    case 'failed':
      return {
        title: 'Couldn’t place it',
        detail: input.reason || label,
        tone: 'danger',
        icon: 'warning',
      };
  }
}

/** The line a screen reader hears when a drop settles. */
export function dropAnnouncement(input: DropChipInput): string {
  const where = input.collage ? `cell ${input.zone.index + 1}` : 'the slide';
  switch (input.phase) {
    case 'over':
      return input.zone.holding
        ? `Drop to replace ${input.zone.holding} in ${where}`
        : `Drop to place ${input.label} in ${where}`;
    case 'fetching':
      return `Fetching ${input.label}${input.source ? ` from ${input.source}` : ''}…`;
    case 'placed':
      return `${input.label} placed in ${where}`;
    case 'failed':
      return `${input.label} could not be placed${input.reason ? `: ${input.reason}` : ''}`;
  }
}

/** The hint the stage wears while any picture is being dragged, before it reaches a zone. */
export function dropHint(collage: boolean, cellCount: number): string {
  return collage ? `Drop on one of the ${cellCount} cells` : 'Drop on the picture to use it';
}
