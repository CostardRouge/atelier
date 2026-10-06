/**
 * What the SHELL reads of the three document stores — one document per Home
 * door, and the Sources screen's count — gathered here so Home and Sources
 * import it DYNAMICALLY (`await import('./documents-read')`) and never
 * statically: a store pulls its whole document model onto whichever chunk
 * imports it (the migrations over every version reach the editors' own
 * code), and that chunk was the shell's first-paint one (audit PERF-04:
 * 650 kB, 75 kB of it this). A door shows ONE document, so it asks the
 * store for the last one alone (`lastRoll`, `lastTrip`, `lastProject`:
 * audit PERF-05 — `listRolls` migrated every roll, each migration walking
 * every picture's journal, to show one).
 */

import { getRollThumbs, lastRoll, listRolls } from '../shared/develop/roll-store';
import { rollProgress, type RollDoc } from '../shared/develop/roll-types';
import { lastProject, listProjects } from '../shared/projects/project-store';
import type { ProjectDoc } from '../shared/projects/project-types';
import { lastTrip, listTrips } from '../shared/roadtrip/trip-store';
import type { TripDoc } from '../shared/roadtrip/trip-types';
import { tripCoverage } from '../shared/roadtrip/trip-coverage';
import { formatIsoDate } from '../shared/roadtrip/trip-days';

export interface StudioDoorFacts {
  name: string;
  updatedAt: number;
  thumbnail: Blob | null;
}

/** The project this browser touched last, with its preview. */
export async function studioDoor(): Promise<StudioDoorFacts | null> {
  const p = await lastProject();
  return p ? { name: p.name, updatedAt: p.updatedAt, thumbnail: p.thumbnail } : null;
}

export interface TripsDoorFacts {
  name: string;
  told: number;
  total: number;
  /** At most 60 cells, 1 where a day in the bucket has a piece: a year is bucketed, a fortnight is a day each. */
  cells: number[];
  /** The first day, written out. */
  start: string;
}

/** The trip touched last, its days as a strip. */
export async function tripsDoor(): Promise<TripsDoorFacts | null> {
  const t = await lastTrip();
  if (!t) return null;
  const coverage = tripCoverage(t);
  const size = Math.max(1, Math.ceil(coverage.days.length / 60));
  const cells: number[] = [];
  for (let i = 0; i < coverage.days.length; i += size) {
    const slice = coverage.days.slice(i, i + size);
    cells.push(slice.some((d) => d.posts.length > 0) ? 1 : 0);
  }
  return { name: t.name, told: coverage.toldDays, total: coverage.totalDays, cells, start: formatIsoDate(t.startDate) };
}

export interface DevelopDoorFacts {
  name: string;
  developed: number;
  total: number;
  /** The first pictures' thumbnails, those that exist. */
  thumbs: Blob[];
}

/** The roll touched last, its first pictures as a strip. */
export async function developDoor(): Promise<DevelopDoorFacts | null> {
  const r = await lastRoll();
  if (!r) return null;
  const ids = r.pictures.slice(0, 5).map((p) => p.id);
  const map = await getRollThumbs(ids);
  const { developed, total } = rollProgress(r);
  return { name: r.name, developed, total, thumbs: ids.flatMap((id) => map.get(id) ?? []) };
}

/** Every document of the three stores — what the Sources screen counts per source. */
export async function allDocuments(): Promise<{ projects: ProjectDoc[]; trips: TripDoc[]; rolls: RollDoc[] }> {
  const [projects, trips, rolls] = await Promise.all([listProjects(), listTrips(), listRolls()]);
  return { projects, trips, rolls };
}
