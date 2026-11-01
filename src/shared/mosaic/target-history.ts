/**
 * The TARGETS visited, as a browser's back and forward (his ask,
 * 2026-11-01: «à chaque fois que je clique dans une image je ne peux pas
 * forcément revenir à l'image précédente … des flèches … précédent et
 * suivant»). Every change of target — a click on a cell, the chooser, a
 * draw, a run that stopped on another picture, an undo — leaves the one
 * before in `past`; going back puts the current one in `future`, and a new
 * visit clears it. A step keeps its CROP, so going back returns to the part
 * that was framed.
 *
 * Kept for the editor's session, never in the document: it is where the
 * person has been, not what the mosaic is. Pure and DOM-free.
 */

import type { Crop } from './frame';

export interface TargetStep {
  id: number;
  crop?: Crop;
}

export interface TargetHistory {
  past: TargetStep[];
  future: TargetStep[];
}

export const MAX_TARGET_HISTORY = 50;
export const EMPTY_TARGETS: TargetHistory = { past: [], future: [] };

/** `to` was reached from `from`: `from` goes on the past, the future is cleared. The same object when nothing moved. */
export function visited(h: TargetHistory, from: TargetStep | null, to: number): TargetHistory {
  if (!from || from.id === to) return h;
  const past = [...h.past, from].slice(-MAX_TARGET_HISTORY);
  return { past, future: [] };
}

/** The last step of `list` still `known`, its index; −1 when none. */
function lastKnown(list: readonly TargetStep[], known: (id: number) => boolean, not: number): number {
  for (let i = list.length - 1; i >= 0; i--) if (known(list[i].id) && list[i].id !== not) return i;
  return -1;
}

/**
 * Back from `current`: the latest past step whose picture the mosaic still
 * holds (a removed picture is skipped and dropped), with the history after
 * the move; null when there is nowhere to go.
 */
export function stepBack(h: TargetHistory, current: TargetStep, known: (id: number) => boolean = () => true): { history: TargetHistory; to: TargetStep } | null {
  const i = lastKnown(h.past, known, current.id);
  if (i < 0) return null;
  return { to: h.past[i], history: { past: h.past.slice(0, i), future: [...h.future, current].slice(-MAX_TARGET_HISTORY) } };
}

/** Forward from `current`: the mirror of `stepBack`. */
export function stepForward(h: TargetHistory, current: TargetStep, known: (id: number) => boolean = () => true): { history: TargetHistory; to: TargetStep } | null {
  const i = lastKnown(h.future, known, current.id);
  if (i < 0) return null;
  return { to: h.future[i], history: { past: [...h.past, current].slice(-MAX_TARGET_HISTORY), future: h.future.slice(0, i) } };
}

/** The current step's crop updated, so a return lands on the part last framed. */
export function withCurrentCrop(step: TargetStep, crop: Crop | undefined): TargetStep {
  if (!crop) return step.crop ? { id: step.id } : step;
  return { id: step.id, crop };
}
