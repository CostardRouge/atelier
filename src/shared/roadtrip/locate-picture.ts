/**
 * One photograph, read as the place it was taken — and offered to the leg of
 * its own day.
 *
 * The second gesture of the itinerary deduction (`segment-track.ts` and
 * `track-chapters.ts` are the first): that one works a whole trip out from one
 * position per day and proposes thirty legs; this one answers the smaller
 * question a single picture can settle — *where was I that day?* — for the leg
 * the calendar already holds. Same index, same contest, same refusals; it is
 * not a second geometry.
 *
 * Four rules it inherits, each already binding on the deduction:
 *
 * - **The name goes into the PLACE, never into `stage.name`.** An empty leg
 *   name means COMPUTED and a leg holding one place derives its label through
 *   `stageLabel`; writing "Kalbarri" into the name would pin as a decision what
 *   the place already says, and the label would lie the moment the place was
 *   renamed.
 * - **No country in the document.** `TripPlace.region` is an editorial field
 *   whose empty value means derived, while "AU" is a machine token. The country
 *   rides on `PictureLocation.city` for a panel to show as a hint, and reaches
 *   nothing that is stored.
 * - **Null Island is refused.** `0, 0` is what a camera writes with no fix
 *   (`readDayPoint` and `parsePosition` both refuse it), and one such picture
 *   would drag a leg into the Gulf of Guinea.
 * - **Offered, never applied on its own**, and a picture dated outside the trip
 *   is CALLED OUT rather than quietly clamped onto an edge — the rule the day a
 *   piece tells already follows.
 *
 * It reverse-geocodes nothing: the name comes from the committed index
 * (`gazetteer.ts`), for the reason written there — the suite's one online place
 * lookup carries text the author typed, and sending the coordinates of their
 * photographs would be a larger claim on their data, for a name.
 *
 * What it writes, it writes through the editors that already exist:
 * `startStageAt` mints a leg exactly as the calendar's context menu does, and a
 * place is appended the way the leg's own editor appends one. There is no
 * second write path into the document.
 *
 * Pure and DOM-free.
 */

import { nearestCity, type GazetteerCity } from './gazetteer';
import { haversineKm, type GeoPoint } from './hooks/geo';
import { startStageAt, type StageEditResult } from './stage-edit';
import { stageAt } from './trip-coverage';
import { formatIsoDate, isIsoDate, isWithin, type IsoDate } from './trip-days';
import { stageLabel } from './trip-places';
import { createTripPlace, type TripDoc, type TripStage } from './trip-types';

/**
 * Why a picture yields nothing to accept. Null when it yields a proposal —
 * these are the six ways the answer is honestly "not from this one".
 */
export type LocateSilence =
  /** Its EXIF says nothing about where it was, and no source vouched for one. */
  | 'no-position'
  /** `0, 0`: a camera with no fix, refused rather than believed. */
  | 'null-island'
  /** Nothing says which day it belongs to, so there is no leg to offer it to. */
  | 'no-date'
  /** Its day is not one of the trip's — said, never clamped onto an edge. */
  | 'outside-trip'
  /** Nothing in the city index is near enough to name the point. */
  | 'no-name'
  /** The leg of that day already names that place. */
  | 'already';

/** What accepting would do, in the trip's own words. One or none. */
export interface LocateProposal {
  /**
   * `name` — the leg of that day names nothing yet, so this place becomes its
   * label. `route` — it already names places, so this one joins them.
   * `start` — no leg covers the day, so one begins there.
   */
  id: 'name' | 'route' | 'start';
  /** The sentence, naming the REAL leg it would touch. */
  label: string;
  /** What it writes exactly, one line under the sentence. */
  detail: string;
  /** The edit, as every stage editor states it: (trip) → new stages. */
  apply: (trip: TripDoc) => StageEditResult;
}

export interface PictureLocation {
  /** What the index calls the point; null when nothing was near enough. */
  city: GazetteerCity | null;
  /** How far that city is from where the picture was taken, in km. */
  km: number | null;
  /** The day the proposal is about; null when the picture does not say. */
  date: IsoDate | null;
  /** The leg covering that day, when one does. */
  stage: TripStage | null;
  proposal: LocateProposal | null;
  silence: LocateSilence | null;
}

export interface LocateInput {
  trip: TripDoc;
  /** The day the picture says it was taken (`readCapture`), or null. */
  date: string | null;
  /** Where its EXIF says it was shot, or null when nothing says. */
  coords: { lat: number; lon: number } | null;
  /** The committed index; an empty one simply names nothing. */
  cities: readonly GazetteerCity[];
  /** How far a picture may be from a city and still take its name. */
  maxKm?: number;
}

/** A leg as a sentence names it: its label, else the span it covers. */
function spanWords(stage: TripStage): string {
  return stage.startDate === stage.endDate
    ? formatIsoDate(stage.startDate)
    : `${formatIsoDate(stage.startDate)} → ${formatIsoDate(stage.endDate)}`;
}

function legName(stage: TripStage): string {
  const label = stageLabel(stage);
  return label ? `“${label}”` : `the leg of ${spanWords(stage)}`;
}

/** The place as it would be written: the CITY's name and coordinates. */
function placeFor(city: GazetteerCity) {
  // The name is the city's, so the coordinates are too — the same pairing
  // `track-chapters.ts` writes, and the one the Itinerary draws a stop at.
  // The region stays EMPTY: empty means derived, and "AU" is a machine token.
  return createTripPlace(city.name, '', { lat: city.lat, lon: city.lon });
}

/** Does this leg already say it went there? Names are compared as written. */
function names(stage: TripStage, city: GazetteerCity): boolean {
  const wanted = city.name.trim().toLowerCase();
  return (stage.places ?? []).some((place) => place.name.trim().toLowerCase() === wanted);
}

function usablePoint(coords: { lat: number; lon: number } | null): GeoPoint | null {
  if (!coords) return null;
  const { lat, lon } = coords;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
  return { lat, lon };
}

/**
 * What one picture can say about this trip's itinerary, and the single edit
 * that would write it down.
 *
 * The order of the refusals is the order of the questions: is there a position
 * at all, is it a real one, which day is this, is that day the trip's — then,
 * and only then, what is this place called. The name is looked up whatever the
 * date says, so a picture from the wrong year still tells the author which
 * place it was, and only the WRITE is refused.
 */
export function locatePicture({
  trip,
  date,
  coords,
  cities,
  maxKm,
}: LocateInput): PictureLocation {
  const empty = { city: null, km: null, date: null, stage: null, proposal: null };

  const point = usablePoint(coords);
  if (!point) return { ...empty, silence: 'no-position' };
  if (point.lat === 0 && point.lon === 0) return { ...empty, silence: 'null-island' };

  const city = cities.length ? nearestCity(cities, point, maxKm) : null;
  const km = city ? haversineKm(point, city) : null;
  const named = { city, km };

  const day: IsoDate | null = date && isIsoDate(date) ? date : null;
  if (!day) return { ...empty, ...named, silence: 'no-date' };
  if (!isWithin(trip.startDate, trip.endDate, day)) {
    return { ...empty, ...named, date: day, silence: 'outside-trip' };
  }
  if (!city) return { ...empty, ...named, date: day, silence: 'no-name' };

  const stage = stageAt(trip, day);
  const found = { ...named, city, date: day, stage };

  if (stage && names(stage, city)) return { ...found, proposal: null, silence: 'already' };

  // Appending is the same write in both covered cases; only the sentence
  // differs, because a leg that named nothing is being NAMED while one that
  // already has a route is being extended by a place whose position in that
  // route only the author knows.
  const append = (target: TripStage) => (t: TripDoc): StageEditResult => ({
    stages: t.stages.map((s) =>
      s.id === target.id ? { ...s, places: [...(s.places ?? []), placeFor(city)] } : s,
    ),
    selectedId: target.id,
  });

  if (stage) {
    const first = stageLabel(stage) === '';
    return {
      ...found,
      silence: null,
      proposal: {
        id: first ? 'name' : 'route',
        label: first
          ? `Name ${legName(stage)} “${city.name}”`
          : `Add ${city.name} to ${legName(stage)}`,
        detail: first
          ? 'Its only place, so the leg takes that name — and gives it back if the place is renamed.'
          : 'Appended at the end of its route; reorder it in the leg itself.',
        apply: append(stage),
      },
    };
  }

  // No leg covers that day: one begins there, exactly as the calendar's own
  // "Start a stage here" mints it — to the day before the next leg, else to
  // the end of the trip — and the place is written onto it.
  const preview = startStageAt(trip, day);
  const minted = preview.stages.find((s) => s.id === preview.selectedId);
  return {
    ...found,
    silence: null,
    proposal: {
      id: 'start',
      label: `Start a leg at ${city.name} on ${formatIsoDate(day)}`,
      detail: minted
        ? `No leg covers that day. The new one would run ${spanWords(minted)}.`
        : 'No leg covers that day.',
      apply: (t) => {
        const result = startStageAt(t, day);
        return {
          stages: result.stages.map((s) =>
            s.id === result.selectedId ? { ...s, places: [placeFor(city)] } : s,
          ),
          selectedId: result.selectedId,
        };
      },
    },
  };
}
