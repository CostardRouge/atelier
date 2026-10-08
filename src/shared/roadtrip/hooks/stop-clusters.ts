/**
 * Grouping nearby places — «Labo Virée» §4 (2026-10-07), accepted with every
 * option kept.
 *
 * Six weeks in Melbourne and fifteen places a few kilometres apart: the car
 * halted fifteen times. Grouping is applied AT RENDER TIME, over the stops a
 * route or an itinerary already holds — the author's list is never edited,
 * and the Itinerary keeps every point. A group's halt sits on a REAL stop,
 * the member nearest the group's centre; it shows every member's pictures
 * and its dot carries `×N`.
 *
 * - **Which places**: `consecutive` (the default) merges only stops that
 *   follow each other, so the journey's order stands and a later return is
 *   a second halt; `all` merges every visit into the first, and the car
 *   never comes back — offered, not recommended.
 * - **Name**: `town` — the biggest town of the shipped index near the group
 *   (within the group's reach plus `TOWN_REACH_KM`), when the index is at
 *   hand; `first` — the first member's name; `central` — the anchor's.
 *   A group of one keeps its own name whatever the rule.
 *
 * Pure and DOM-free; the towns are handed in.
 */

import { degreeWindow, haversineKm, type GeoPoint } from './geo';
import { cardWantsTowns } from './summary-card';

export type GroupVisits = 'consecutive' | 'all';
export type GroupName = 'town' | 'first' | 'central';

export interface GroupOptions {
  /** Kilometres within which places are one halt; 0 is off. */
  groupKm: number;
  groupVisits: GroupVisits;
  groupName: GroupName;
}

export const GROUP_LIMITS = { groupKm: { min: 0.5, max: 80 } } as const;
/** The three shortcuts: a neighbourhood, a city, a metropolitan area. */
export const GROUP_SHORTCUTS: readonly { km: number; label: string }[] = [
  { km: 2, label: 'Neighbourhood' },
  { km: 10, label: 'City' },
  { km: 40, label: 'Metro area' },
];
/** A town may name a group from this far past the group's own reach. */
export const TOWN_REACH_KM = 15;

/** A named place with a population — what `pick-map.ts`'s `Town` is. */
export interface NamedTown extends GeoPoint {
  name: string;
  population: number;
}

export interface StopGroup {
  /** Indices into the stops, in the order they were given. */
  members: number[];
  /** The member the halt sits on: nearest the group's centre. */
  anchor: number;
  centre: GeoPoint;
  /** The farthest member from the anchor, km. */
  extentKm: number;
}

function centreOf(stops: readonly GeoPoint[], members: readonly number[]): GeoPoint {
  let lat = 0;
  let lon = 0;
  for (const i of members) {
    lat += stops[i].lat;
    lon += stops[i].lon;
  }
  return { lat: lat / members.length, lon: lon / members.length };
}

/**
 * The groups over `stops`, in the order their first member comes. With `km`
 * at 0 (or one stop) every stop is a group of its own.
 */
export function groupStops(stops: readonly GeoPoint[], km: number, visits: GroupVisits): StopGroup[] {
  const groups: number[][] = [];
  stops.forEach((stop, i) => {
    if (!(km > 0)) {
      groups.push([i]);
      return;
    }
    if (visits === 'consecutive') {
      const last = groups[groups.length - 1];
      if (last && haversineKm(centreOf(stops, last), stop) <= km) last.push(i);
      else groups.push([i]);
      return;
    }
    let best: number[] | null = null;
    let bestKm = Infinity;
    for (const group of groups) {
      const d = haversineKm(centreOf(stops, group), stop);
      if (d <= km && d < bestKm) {
        bestKm = d;
        best = group;
      }
    }
    if (best) best.push(i);
    else groups.push([i]);
  });
  return groups.map((members) => {
    const centre = centreOf(stops, members);
    let anchor = members[0];
    let nearest = Infinity;
    for (const i of members) {
      const d = haversineKm(centre, stops[i]);
      if (d < nearest) {
        nearest = d;
        anchor = i;
      }
    }
    const extentKm = Math.max(0, ...members.map((i) => haversineKm(stops[anchor], stops[i])));
    return { members, anchor, centre, extentKm };
  });
}

/**
 * The name a group is given: a town of the index near it, the first member's
 * or the anchor's. A group of one keeps its own name. `town` with no index
 * at hand reads as `first` — never a blank.
 */
export function groupName(
  stops: readonly (GeoPoint & { name: string })[],
  group: StopGroup,
  rule: GroupName,
  towns: readonly NamedTown[] | null = null,
): string {
  if (group.members.length < 2) return stops[group.anchor].name;
  if (rule === 'central') return stops[group.anchor].name;
  if (rule === 'town' && towns?.length) {
    const reach = Math.max(...group.members.map((i) => haversineKm(group.centre, stops[i]))) + TOWN_REACH_KM;
    const best = biggestTownWithin(towns, group.centre, reach);
    if (best) return best.name;
  }
  return stops[group.members[0]].name;
}

/**
 * The towns in one-degree CELLS, built once per index and kept beside it.
 *
 * Naming a group used to read every town of the index — 130 000 great-circle
 * solves per group, 685 ms for the 40 groups of a three-month trip, measured
 * on the real file — and every surface that draws an opener asks for the
 * names again: the panel on each render (which is each frame while the piece
 * plays), `prepare`, `wantsPictures`, `wantsBasemap`. That is what made the
 * whole editor stutter the moment grouping was on (2026-10-07, the
 * maintainer). A group's reach is tens of kilometres, so only the cells
 * around it are read: the same answer, to the town.
 */
const CELL_DEG = 1;
interface TownGrid {
  cells: Map<string, number[]>;
}
const grids = new WeakMap<readonly NamedTown[], TownGrid>();

const SPAN = Math.round(360 / CELL_DEG);
/** A longitude cell index brought into [−180, 180): ±180 is one meridian. */
function wrapCell(b: number): number {
  return ((((b + SPAN / 2) % SPAN) + SPAN) % SPAN) - SPAN / 2;
}
function cellKey(lat: number, lon: number): string {
  return `${Math.floor(lat / CELL_DEG)}:${wrapCell(Math.floor(lon / CELL_DEG))}`;
}

function gridOf(towns: readonly NamedTown[]): TownGrid {
  let grid = grids.get(towns);
  if (grid) return grid;
  const cells = new Map<string, number[]>();
  towns.forEach((town, i) => {
    const key = cellKey(town.lat, town.lon);
    const cell = cells.get(key);
    if (cell) cell.push(i);
    else cells.set(key, [i]);
  });
  grid = { cells };
  grids.set(towns, grid);
  return grid;
}

/**
 * The most populous town within `reach` km of `centre` — on a tie the one
 * the index lists first, exactly as a scan of the whole list would choose.
 */
export function biggestTownWithin(towns: readonly NamedTown[], centre: GeoPoint, reach: number): NamedTown | null {
  const { cells } = gridOf(towns);
  const window = degreeWindow(centre.lat, reach);
  const lat0 = Math.floor((centre.lat - window.dLat) / CELL_DEG);
  const lat1 = Math.floor((centre.lat + window.dLat) / CELL_DEG);
  // Near a pole, or for a reach past a few thousand km, every longitude.
  const dLon = window.dLon === null || window.dLon >= 180 ? 180 : window.dLon;
  const lon0 = Math.floor((centre.lon - dLon) / CELL_DEG);
  const lon1 = Math.floor((centre.lon + dLon) / CELL_DEG);
  const seen = new Set<number>();
  let best = -1;
  for (let a = lat0; a <= lat1; a += 1) {
    for (let b = lon0; b <= lon1; b += 1) {
      // A longitude cell past ±180 is the same cell the other side of the antimeridian.
      const wrapped = wrapCell(b);
      if (seen.has(a * SPAN + wrapped)) continue;
      seen.add(a * SPAN + wrapped);
      const cell = cells.get(`${a}:${wrapped}`);
      if (!cell) continue;
      for (const i of cell) {
        const town = towns[i];
        if (best >= 0) {
          const held = towns[best];
          if (town.population < held.population || (town.population === held.population && i > best)) continue;
        }
        if (haversineKm(centre, town) > reach) continue;
        best = i;
      }
    }
  }
  return best >= 0 ? towns[best] : null;
}

/** Whether these options group anything at all. */
export function groupsOn(o: Pick<GroupOptions, 'groupKm'>): boolean {
  return o.groupKm > 0;
}

/**
 * Whether any of these opener layers names a group by its TOWN — what makes
 * the editor read the town index, so every surface names the same groups.
 */
export function wantsTowns(layers: readonly { id?: string; options?: Readonly<Record<string, unknown>> }[]): boolean {
  return layers.some((layer) => {
    const o = layer.options ?? {};
    // Virée's summary card names its groups of places by town too.
    return (Number(o.groupKm) > 0 && (o.groupName ?? 'town') === 'town') || (layer.id === 'drive' && cardWantsTowns(o));
  });
}
