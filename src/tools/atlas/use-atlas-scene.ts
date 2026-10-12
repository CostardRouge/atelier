import { useEffect, useMemo, useRef, useState } from 'react';
import { loadLand } from '../../shared/map/load-land';
import type { LandCollection } from '../../shared/map/land';
import { gazetteerOrEmpty } from '../../shared/roadtrip/load-gazetteer';
import { nearestCity } from '../../shared/roadtrip/gazetteer';
import { unionBox, type AtlasFlight, type WorldBox } from './atlas-flight';
import { LodCache, sceneStats, type PaintScene } from './atlas-paint';
import { clusterPlaces, placeOfFlight, type AtlasPlace } from './atlas-places';
import { activityCurve, buildSchedule, type Schedule } from './atlas-schedule';
import { aspectRatio, type AtlasSettings } from './atlas-settings';
import { boxOf, buildCameraTrack, cameraAt, driftView, fitView, type AtlasView } from './atlas-view';

/** The scene without what the stage adds per frame (tiles, focus). */
export type SceneCore = Omit<PaintScene, 'tiles' | 'focus'>;

export interface AtlasScene {
  core: SceneCore;
  schedule: Schedule;
  /** Every place of every loaded flight (not only the visible ones), biggest first. */
  places: AtlasPlace[];
  placeNames: (string | null)[];
  /** The view at animation time `t`, normalised to the frame's short side. */
  viewAt: (t: number) => AtlasView;
  /** The view that frames every visible flight (what «Fit» returns to). */
  fitAll: AtlasView;
}

const WORLD: WorldBox = { x0: 0.05, y0: 0.2, x1: 0.95, y1: 0.8 };

/** Width and height of a frame of `aspect` whose short side is 1. */
export function unitFrame(aspect: AtlasSettings['aspect']): { w: number; h: number } {
  const ar = aspectRatio(aspect);
  return ar >= 1 ? { w: ar, h: 1 } : { w: 1, h: 1 / ar };
}

/**
 * Everything a frame of the atlas is drawn from, rebuilt only when what it
 * depends on moves: the choreography when the flights or its dials change,
 * the follow camera when the choreography or the frame does, the names of
 * places once the shipped city index has been read.
 */
export function useAtlasScene(
  all: readonly AtlasFlight[],
  hidden: ReadonlySet<string>,
  settings: AtlasSettings,
  freeView: AtlasView | null,
): AtlasScene {
  const lod = useRef(new LodCache()).current;
  const [land, setLand] = useState<LandCollection | null>(null);
  const [names, setNames] = useState<Map<string, string>>(() => new Map());

  // The shipped coastline, from our own origin, read the first time it is drawn.
  const wantsLand = settings.map.land !== 'off';
  useEffect(() => {
    if (!wantsLand || land) return;
    let cancelled = false;
    loadLand()
      .then((l) => !cancelled && setLand(l))
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [wantsLand, land]);

  // Places over EVERY loaded flight, so hiding one never renames a spot.
  const places = useMemo(() => clusterPlaces(all), [all]);

  // Their names, from the shipped city index (never a lookup going out).
  useEffect(() => {
    if (!places.length) return;
    let cancelled = false;
    void gazetteerOrEmpty().then((cities) => {
      if (cancelled || !cities.length) return;
      const next = new Map<string, string>();
      for (const p of places) {
        const city = nearestCity(cities, { lat: p.lat, lon: p.lon }, 30);
        if (city) next.set(`${p.lat.toFixed(4)},${p.lon.toFixed(4)}`, city.name);
      }
      setNames(next);
    });
    return () => {
      cancelled = true;
    };
  }, [places]);
  const placeNames = useMemo(() => places.map((p) => names.get(`${p.lat.toFixed(4)},${p.lon.toFixed(4)}`) ?? null), [places, names]);

  const flights = useMemo(() => all.filter((f) => !hidden.has(f.id)), [all, hidden]);

  const schedule = useMemo(() => buildSchedule(flights, settings.choreo), [flights, settings.choreo]);

  const placeOf = useMemo(() => {
    const ofAll = placeOfFlight(places, all.length);
    const index = new Map(all.map((f, i) => [f.id, i] as const));
    return flights.map((f) => ofAll[index.get(f.id) ?? 0] ?? 0);
  }, [places, all, flights]);

  const visiblePlaces = useMemo(() => {
    const shown = new Set(placeOf);
    return places.map((p, k) => (shown.has(k) ? p : null));
  }, [places, placeOf]);

  const stats = useMemo(() => sceneStats(flights), [flights]);
  const activity = useMemo(() => activityCurve(schedule.slots, schedule.total, 240), [schedule]);

  const { camera, aspect } = settings;
  const look = useMemo(() => ({ bearing: camera.bearing, tilt: camera.tilt }), [camera.bearing, camera.tilt]);
  const frame = unitFrame(aspect);

  const fitAll = useMemo(
    () => fitView(unionBox(flights.map((f) => f.box)) ?? WORLD, look, frame.w, frame.h, camera.padding),
    [flights, look, frame.w, frame.h, camera.padding],
  );

  const track = useMemo(() => {
    if (camera.frame !== 'follow' || !flights.length) return null;
    const boxes = flights.map((f) => f.box);
    return buildCameraTrack(
      (t) => {
        const flying: number[] = [];
        schedule.slots.forEach((s, i) => {
          if (t >= s.start - 0.3 && t < s.end + 0.3) flying.push(i);
        });
        return flying.length ? boxOf(boxes, flying) : null;
      },
      schedule.total,
      look,
      frame.w,
      frame.h,
      camera.padding,
      camera.tightness,
    );
  }, [camera.frame, camera.padding, camera.tightness, flights, schedule, look, frame.w, frame.h]);

  const viewAt = useMemo(() => {
    const length = schedule.length;
    const drift = camera.drift;
    if (camera.frame === 'free' && freeView) return () => freeView;
    if (camera.frame === 'follow' && track) return (t: number) => driftView(cameraAt(track, t), drift, t / length);
    let base = fitAll;
    if (camera.frame === 'place') {
      const place = places.find((p) => p.id === camera.place) ?? places[0];
      if (place) base = fitView(place.box, look, frame.w, frame.h, camera.padding);
    }
    return (t: number) => driftView(base, drift, t / length);
  }, [schedule.length, camera.drift, camera.frame, camera.place, camera.padding, freeView, track, fitAll, places, look, frame.w, frame.h]);

  const core = useMemo<SceneCore>(
    () => ({
      flights,
      slots: schedule.slots,
      schedule,
      settings,
      places: visiblePlaces.filter((p): p is AtlasPlace => p !== null),
      placeNames: visiblePlaces.flatMap((p, k) => (p ? [placeNames[k]] : [])),
      placeOf,
      land,
      activity,
      stats,
      lod,
    }),
    [flights, schedule, settings, visiblePlaces, placeNames, placeOf, land, activity, stats, lod],
  );

  return { core, schedule, places, placeNames, viewAt, fitAll };
}
