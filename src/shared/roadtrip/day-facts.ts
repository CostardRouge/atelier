/**
 * The FACTS of one day of a trip, read off the document — the day's number,
 * its leg and places, the vehicle it drove, the kilometres its road holds
 * for that day, the sun's rise and set over its place — for an agent to
 * write a caption from facts and never from invention. What the document
 * does not say is null: a day with no road has no kilometres, a leg with no
 * located place no sun.
 *
 * The clock the sun is told on is the zone `offsetMin` names when the
 * caller knows it (Winnow's rows carry the capture's offset), else the zone
 * the longitude alone suggests — said as such in `sun.zone`.
 *
 * Pure and DOM-free.
 */

import { offsetFromLongitude, sunTimes, type SunTimes } from '../lib/sun';
import { decodeTrack, distanceKm } from './road-track';
import { stageAt, stageDayNumber } from './trip-coverage';
import { dayNumber, isWithin, spanLength, toIsoDate, type IsoDate } from './trip-days';
import type { TripDoc, TripPlace, TripStage } from './trip-types';
import { mainVehicle, resolveRef, vehicleOnDay } from './vehicle-fleet';

export interface DayFacts {
  date: IsoDate;
  /** 1-based, over the trip; null when the date is outside it. */
  dayNumber: number | null;
  totalDays: number | null;
  stage: { id: string; name: string | null; from: IsoDate; to: IsoDate; dayInStage: number | null; places: string[] } | null;
  /** The place the day is told from: the stage's place dated for it, else its first located one. */
  place: { name: string; lat: number; lon: number } | null;
  vehicle: { model: string; colour: string } | null;
  /** Kilometres of the trip's road recorded that day, or null with no road. */
  roadKm: number | null;
  sun: (SunTimes & { zone: 'given' | 'longitude'; offsetMin: number }) | null;
  pieces: { id: string; kind: string; title: string | null; published: boolean }[];
}

/** The place a day is told from, in a stage. */
export function placeOfDay(stage: TripStage, date: IsoDate): TripPlace | null {
  const located = stage.places.filter((p) => p.coords);
  const dated = located.find((p) => p.arrived && p.left && isWithin(p.arrived, p.left, date));
  return dated ?? located[0] ?? null;
}

export function dayFacts(trip: TripDoc, date: IsoDate, offsetMin: number | null = null): DayFacts {
  const stage = stageAt(trip, date);
  const place = stage ? placeOfDay(stage, date) : null;
  const inTrip = isWithin(trip.startDate, trip.endDate, date);
  const spec = stage?.vehicle ? resolveRef(stage.vehicle, trip.vehicles, date) : vehicleOnDay(mainVehicle(trip.vehicles), date);
  const offset = offsetMin ?? (place?.coords ? offsetFromLongitude(place.coords.lon) : null);
  return {
    date,
    dayNumber: inTrip ? dayNumber(trip.startDate, date) : null,
    totalDays: spanLength(trip.startDate, trip.endDate),
    stage: stage
      ? {
          id: stage.id,
          name: stage.name || null,
          from: stage.startDate,
          to: stage.endDate,
          dayInStage: stageDayNumber(stage, date)?.day ?? null,
          places: stage.places.map((p) => p.name),
        }
      : null,
    place: place?.coords ? { name: place.name, lat: place.coords.lat, lon: place.coords.lon } : null,
    vehicle: { model: spec.model, colour: spec.color },
    roadKm: roadKmOnDay(trip, date, offset),
    sun: place?.coords && offset !== null ? { ...sunTimes(date, place.coords.lat, place.coords.lon, offset), zone: offsetMin === null ? 'longitude' : 'given', offsetMin: offset } : null,
    pieces: trip.posts.filter((p) => p.date === date || (p.endDate ? isWithin(p.date, p.endDate, date) : false)).map((p) => ({ id: p.id, kind: p.kind, title: p.title || null, published: Boolean(p.publishedAt) })),
  };
}

/**
 * The kilometres of the road's fixes that fall on `date` in the zone
 * `offsetMin` (the first fix's longitude when none is known), summed along
 * consecutive fixes of that day. Null without a road, 0 for a day the road
 * stood still.
 */
export function roadKmOnDay(trip: Pick<TripDoc, 'road'>, date: IsoDate, offsetMin: number | null): number | null {
  if (!trip.road) return null;
  const fixes = decodeTrack(trip.road.track);
  if (!fixes.length) return null;
  const off = (offsetMin ?? offsetFromLongitude(fixes[0].lon)) * 60_000;
  let km = 0;
  let prev: { lat: number; lon: number } | null = null;
  for (const f of fixes) {
    if (toIsoDate(f.t * 1000 + off) !== date) {
      prev = null;
      continue;
    }
    if (prev) km += distanceKm(prev, f);
    prev = f;
  }
  return Math.round(km * 10) / 10;
}
