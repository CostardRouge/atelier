/**
 * The ONE palette of mask kinds (2026-10-02, `docs/mask-ui-redesign.md` §3.1):
 * the same grouped choice adds a layer, changes a layer's kind and combines a
 * term into its mask. It replaces a grid of `+ Kind` buttons, a seven-way
 * segmented switch and a second grid under Combine — twenty-two buttons on one
 * screen for one question asked three ways (his «les boutons peut-être qu'ils
 * peuvent être mieux faits»).
 *
 * Grouped by what the author DOES, not by what the maths is: a kind is pointed
 * at on the picture, drawn on it, or everywhere. Each carries one line of use.
 * Pure — the component is `KindPalette.tsx`.
 */

import { PART_KINDS } from '../../shared/develop/layer';
import type { MaskKind } from '../../shared/render/mask';

/** A mask kind, or the whole picture (a layer with no mask). */
export type PaletteKind = MaskKind | 'whole';

/**
 * Why the palette is open: a NEW layer, a layer's own kind changed, a TERM
 * combined into the mask, or a term's kind changed. A term is never a subject
 * nor the whole picture (`PART_KINDS`).
 */
export type PaletteMode = 'new' | 'type' | 'part' | 'part-type';

export interface PaletteEntry {
  kind: PaletteKind;
  label: string;
  /** One line of use, under the name. */
  line: string;
}

export interface PaletteGroup {
  id: 'pick' | 'draw' | 'all';
  label: string;
  kinds: readonly PaletteEntry[];
}

export const PALETTE_GROUPS: readonly PaletteGroup[] = [
  {
    id: 'pick',
    label: 'Point at it',
    kinds: [
      { kind: 'subject', label: 'Subject', line: 'a model finds what you tap; tap again to add or remove' },
      { kind: 'colour', label: 'Colour', line: 'the colours you tap, wherever they are' },
      { kind: 'luma', label: 'Brightness', line: 'a band of tone, wherever it falls' },
    ],
  },
  {
    id: 'draw',
    label: 'Draw it',
    kinds: [
      { kind: 'linear', label: 'Linear', line: 'a straight edge, soft — a sky' },
      { kind: 'radial', label: 'Radial', line: 'an ellipse — a face, a pool of light' },
      { kind: 'shade', label: 'Shade', line: 'an edge or a corner, its reach and its core' },
      { kind: 'brush', label: 'Painted', line: 'drawn by hand, erased by hand' },
    ],
  },
  {
    id: 'all',
    label: 'Everywhere',
    kinds: [{ kind: 'whole', label: 'Whole picture', line: 'everywhere — a global move you can fade' }],
  },
];

/** The groups the palette offers in a mode — a term's kinds only for a term. Empty groups are dropped. */
export function paletteGroups(mode: PaletteMode): PaletteGroup[] {
  const forPart = mode === 'part' || mode === 'part-type';
  return PALETTE_GROUPS.map((g) => ({
    ...g,
    kinds: forPart ? g.kinds.filter((k) => k.kind !== 'whole' && PART_KINDS.includes(k.kind)) : g.kinds,
  })).filter((g) => g.kinds.length > 0);
}

/** The palette's heading — the question it answers. */
export function paletteTitle(mode: PaletteMode): string {
  if (mode === 'new') return 'New layer — where should it apply?';
  if (mode === 'type') return 'Change this mask to…';
  if (mode === 'part-type') return 'Change this term to…';
  return 'Combine with…';
}

/** A kind's name, `Whole picture` for a layer with no mask. */
export function kindLabel(kind: PaletteKind | null | undefined): string {
  const k = kind ?? 'whole';
  for (const g of PALETTE_GROUPS) for (const e of g.kinds) if (e.kind === k) return e.label;
  return k;
}

/**
 * Kinds made with the POINTER — a subject is tapped, a colour picked, a mask
 * painted —, so the stage's Pick / Paint comes on with them rather than being
 * one more thing to find.
 */
export function takesPointer(kind: PaletteKind | null | undefined): boolean {
  return kind === 'subject' || kind === 'colour' || kind === 'brush';
}
