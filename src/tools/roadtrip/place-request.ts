import { useSyncExternalStore } from 'react';

/**
 * A request to open ONE place of a stage, made from outside the stage's card
 * — the trip map's «Not on the map» tray asks for Fix on a place the index
 * could not settle, or for a first place on a stage that has none. The card
 * is drawn in three homes (beside the map, under the ruler, in the phone's
 * legs sheet) and may mount after the request, so the request waits here
 * until the card of that stage takes it, once.
 */
export interface PlaceRequest {
  stageId: string;
  /** The place to open on Fix; null asks for a new place, its name field focused. */
  placeId: string | null;
}

let current: PlaceRequest | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function requestPlace(request: PlaceRequest): void {
  current = request;
  emit();
}

/** Taken by the card that answers it, so a second mount does not reopen it. */
export function takePlaceRequest(stageId: string): PlaceRequest | null {
  if (!current || current.stageId !== stageId) return null;
  const taken = current;
  current = null;
  emit();
  return taken;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The request waiting for this stage's card, if any. */
export function usePlaceRequest(stageId: string): PlaceRequest | null {
  return useSyncExternalStore(
    subscribe,
    () => (current && current.stageId === stageId ? current : null),
    () => null,
  );
}
