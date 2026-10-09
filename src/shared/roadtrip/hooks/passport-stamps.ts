/**
 * The PASSPORT's stamps (2026-10-09, his report and the lab
 * https://claude.ai/artifact/N6Shz9sFd3vdg6eK2UQDX7, «vas-y avec tes
 * recommandations»): one stamp per part of the road, in its order — the
 * STATE where it is known, else the PLACE. The face used to keep the states
 * alone as soon as one place knew its state, every other place vanishing.
 *
 * A missing state may be read from the shipped town index (`stop-index.ts`:
 * only what it says without doubt), at render time — never written into the
 * places. Consecutive stops in one state are one stamp; a destination is
 * stamped once by default, or at each visit.
 *
 * Pure: the index is handed in.
 */

import type { GazetteerCity } from '../gazetteer';
import type { PlaceWritingTrip } from '../place-style';
import type { DriveStop } from './drive-plan';
import type { HookPlace } from './hook-variant';
import type { NamedTown } from './stop-clusters';
import { placeFromIndex, regionAround, townNames, type TownNames } from './stop-index';
import { stopState } from './stops';
import { cityCode, placeName, type CardOptions } from './summary-card';

export interface CardStamp {
  /** A state's round stamp, or a place's rectangle: the shape says the level. */
  kind: 'state' | 'place';
  /** What makes two stamps the same destination. */
  key: string;
  /** Written large in the stamp. */
  big: string;
  /** Written under it — the full name the code stands for — or empty. */
  small: string;
}

/** A state as the passport reads it: its code as the trip writes it, its full name. */
export interface StopState {
  code: string;
  name: string;
}

/** The most stamps a page holds; the rest are counted. */
export const MAX_STAMPS = 9;

const names = new WeakMap<readonly NamedTown[], TownNames>();

/**
 * The town index as `stop-index.ts` reads it. The shell's towns ARE the
 * gazetteer's records (`townsFromOrder` hands the cities themselves), so
 * their state and its key are there.
 */
function asCities(towns: readonly NamedTown[]): { cities: readonly GazetteerCity[]; names: TownNames } {
  const cities = towns as unknown as readonly GazetteerCity[];
  let byName = names.get(towns);
  if (!byName) {
    byName = townNames(cities);
    names.set(towns, byName);
  }
  return { cities, names: byName };
}

/**
 * The state of a stop: its own, else — when asked — the index's for the
 * place it is (by its name) or the point it stands on. Null where neither
 * says.
 */
export function stopStates(
  stop: DriveStop,
  writing: PlaceWritingTrip | undefined,
  towns: readonly NamedTown[] | null,
  fromIndex: boolean,
): StopState[] {
  const own = (stop.states ?? []).filter(Boolean);
  if (own.length) {
    const full = (stop.source?.state ?? '').trim();
    return own.map((code) => ({ code, name: own.length === 1 && full ? full : code }));
  }
  if (!fromIndex || !towns?.length) return [];
  const { cities, names: byName } = asCities(towns);
  const place: HookPlace = stop.source ?? { name: placeName(stop), lat: stop.lat, lon: stop.lon };
  const filled = placeFromIndex(place, cities, byName);
  const region = filled?.state ? { region: filled.state, country: filled.countryCode ?? '' } : regionAround(cities, stop);
  if (!region?.region.trim()) return [];
  const derived: HookPlace = { ...place, state: region.region, ...(region.country ? { countryCode: region.country } : {}) };
  const code = stopState(derived, writing);
  return code ? [{ code, name: region.region }] : [];
}

/** The stamps, in the road's order, as the options say. */
export function passportStamps(
  stops: readonly DriveStop[],
  o: Pick<CardOptions, 'cardStampMode' | 'cardStampState' | 'cardStampPlace' | 'cardStampOnce'>,
  statesOf: (stop: DriveStop) => StopState[],
): CardStamp[] {
  const out: CardStamp[] = [];
  const push = (stamp: CardStamp) => {
    // The same destination on consecutive stops is one stay in it.
    if (out[out.length - 1]?.key === stamp.key) return;
    if (o.cardStampOnce === 'once' && out.some((s) => s.key === stamp.key)) return;
    out.push(stamp);
  };
  const placeStamp = (stop: DriveStop): CardStamp | null => {
    const name = placeName(stop);
    if (!name) return null;
    return o.cardStampPlace === 'full'
      ? { kind: 'place', key: `p:${name.toLowerCase()}`, big: name, small: '' }
      : { kind: 'place', key: `p:${name.toLowerCase()}`, big: cityCode(name), small: name };
  };
  for (const stop of stops) {
    if (o.cardStampMode === 'places') {
      const stamp = placeStamp(stop);
      if (stamp) push(stamp);
      continue;
    }
    const states = statesOf(stop);
    if (states.length) {
      for (const state of states) {
        const full = o.cardStampState === 'full';
        push({
          kind: 'state',
          key: `s:${state.code.toLowerCase()}`,
          big: full ? state.name : state.code,
          small: full || state.name === state.code ? '' : state.name,
        });
      }
      continue;
    }
    if (o.cardStampMode === 'mixed' && o.cardStampPlace !== 'skip') {
      const stamp = placeStamp(stop);
      if (stamp) push(stamp);
    }
  }
  // A passport of states that knows none still says where the road went.
  if (!out.length && o.cardStampMode === 'states') return passportStamps(stops, { ...o, cardStampMode: 'places', cardStampPlace: o.cardStampPlace === 'skip' ? 'code' : o.cardStampPlace }, statesOf);
  return out;
}
