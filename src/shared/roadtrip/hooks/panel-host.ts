/**
 * A variant panel's HOST made steady (2026-11-10, his report: Recap crawled
 * while its Trip card played). The instrument that mounts `OpenerPanel`
 * re-renders on every frame of its transport's clock and often hands new
 * callbacks each time; the panel's element is memoised on its host and its
 * `onChange`, so a new function per frame re-rendered the whole panel per
 * frame — the road planned again, the card's six faces repainted.
 *
 * `steadyHost` builds ONE host object per SHAPE — which members the caller
 * offers, and the `pictureStatus` it reports, the one member that is data —
 * whose functions call the caller's CURRENT ones through `read`. A member the
 * caller stops offering changes the shape, so a panel that says "the garage
 * is not here" still learns it.
 *
 * Pure and DOM-free.
 */

import type { HookPanelHost } from './hook-variant';

/** The members of a host that are functions — what a panel may ask of it. */
const ASKS = ['choosePictures', 'configureVehicle', 'chooseHop', 'chooseCrossBoat', 'editStopsOnMap'] as const;

/** Which asks `host` offers, as one string: the steady host is rebuilt only when it changes. */
export function hostShape(host: HookPanelHost | undefined): string {
  if (!host) return '';
  return ASKS.filter((k) => typeof host[k] === 'function').join(',');
}

/**
 * A host with `shape`'s asks, each calling `read()`'s at the moment it is
 * asked, and `pictureStatus` as given. Undefined when there is no host.
 */
export function steadyHost(shape: string, pictureStatus: HookPanelHost['pictureStatus'], read: () => HookPanelHost | undefined): HookPanelHost | undefined {
  if (!shape && pictureStatus === undefined && !read()) return undefined;
  const offered = new Set(shape ? shape.split(',') : []);
  const out: HookPanelHost = {};
  if (pictureStatus !== undefined) out.pictureStatus = pictureStatus;
  if (offered.has('choosePictures')) out.choosePictures = (selected, choice) => read()?.choosePictures?.(selected, choice) ?? Promise.resolve(null);
  if (offered.has('configureVehicle')) out.configureVehicle = () => read()?.configureVehicle?.();
  if (offered.has('chooseHop')) out.chooseHop = (placeId, choice) => read()?.chooseHop?.(placeId, choice);
  if (offered.has('chooseCrossBoat')) out.chooseCrossBoat = (placeId, boat) => read()?.chooseCrossBoat?.(placeId, boat);
  if (offered.has('editStopsOnMap')) out.editStopsOnMap = (stops, choice) => read()?.editStopsOnMap?.(stops, choice) ?? Promise.resolve(null);
  return out;
}
