import { useEffect, useMemo, useRef, useState } from 'react';
import { loadLand } from '../../shared/map/load-land';
import type { LandCollection } from '../../shared/map/land';
import { gazetteerOrEmpty } from '../../shared/roadtrip/load-gazetteer';
import { nearestCity } from '../../shared/roadtrip/gazetteer';
import { latOf, positionAt, unionBox, type AtlasFlight, type WorldBox } from './atlas-flight';
import { formatDateRange } from './atlas-hud';
import { LodCache, sceneStats, type PaintScene } from './atlas-paint';
import type { StickerLogoSource } from './atlas-overlay';
import { clusterPlaces, placeOfFlight, type AtlasPlace } from './atlas-places';
import { activityCurve, buildSchedule, flightState, type Schedule } from './atlas-schedule';
import { mapUnitFrame, type AtlasSettings } from './atlas-settings';
import { episodeAt, spanForKm, spotlightEpisodes } from './atlas-spotlight';
import { totalStats } from './atlas-stats';
import { diveStart, diveView, ease, flightTime, pullView, storyOf, outroLook } from './atlas-story';
import { boxOf, buildCameraTrack, cameraAt, clampScale, driftView, fitView, WORLD_BOX, type AtlasView } from './atlas-view';

/** The scene without what the stage adds per frame (tiles, focus). */
export type SceneCore = Omit<PaintScene, 'tiles' | 'focus'>;

export interface AtlasScene {
  core: SceneCore;
  schedule: Schedule;
  /** Every place of every loaded flight (not only the visible ones), biggest first. */
  places: AtlasPlace[];
  placeNames: (string | null)[];
  /** The view at STORY time `t` (intro, flights, outro), normalised to the MAP's short side. */
  viewAt: (t: number) => AtlasView;
  /** The view that frames every visible flight (what «Fit» returns to). */
  fitAll: AtlasView;
  /** The map's width and height when its frame's short side is 1 — what views fit to. */
  mapFrame: { w: number; h: number };
  /** Each distinct aircraft name a file gave, with how many flights carry it. */
  aircraftFound: { name: string; count: number }[];
  /** Flights no file named. */
  unnamed: number;
}

/**
 * Everything a frame of the atlas is drawn from, rebuilt only when what it
 * depends on moves: the choreography when the flights or its dials change,
 * the camera track when the choreography or the frame does, the names of
 * places once the shipped city index has been read.
 */
export function useAtlasScene(
  all: readonly AtlasFlight[],
  hidden: ReadonlySet<string>,
  settings: AtlasSettings,
  freeView: AtlasView | null,
  aircraftRaw: ReadonlyMap<string, string>,
  logos: ReadonlyMap<string, StickerLogoSource>,
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
  const totals = useMemo(() => totalStats(flights, placeOf), [flights, placeOf]);
  const activity = useMemo(() => activityCurve(schedule.slots, schedule.total, 240), [schedule]);
  const dateRange = useMemo(() => formatDateRange(flights.map((f) => f.startWall)), [flights]);

  // The drones: what the files say, renamed by the author, else the fallback.
  const { names: renames, fallback } = settings.aircraft;
  const aircraft = useMemo(
    () =>
      flights.map((f) => {
        const raw = aircraftRaw.get(f.id);
        if (raw) return renames[raw]?.trim() || raw;
        return fallback.trim() || null;
      }),
    [flights, aircraftRaw, renames, fallback],
  );
  const { aircraftFound, unnamed } = useMemo(() => {
    const counts = new Map<string, number>();
    let none = 0;
    for (const f of all) {
      const raw = aircraftRaw.get(f.id);
      if (raw) counts.set(raw, (counts.get(raw) ?? 0) + 1);
      else none += 1;
    }
    return { aircraftFound: [...counts].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count), unnamed: none };
  }, [all, aircraftRaw]);

  const { camera, format, choreo } = settings;
  const look = useMemo(() => ({ bearing: camera.bearing, tilt: camera.tilt }), [camera.bearing, camera.tilt]);
  const mapFrameNow = mapUnitFrame(format);
  const fw = mapFrameNow.w;
  const fh = mapFrameNow.h;
  const mapFrame = useMemo(() => ({ w: fw, h: fh }), [fw, fh]);

  const fitAll = useMemo(
    () => fitView(unionBox(flights.map((f) => f.box)) ?? WORLD_BOX, look, fw, fh, camera.padding),
    [flights, look, fw, fh, camera.padding],
  );

  // A frame fixed on one place or zone dives only on the flights it shows.
  const spotArea = useMemo<WorldBox | null>(() => {
    if (camera.frame === 'place') return (places.find((p) => p.id === camera.place) ?? places[0])?.box ?? null;
    if (camera.frame === 'zone') return camera.zone;
    return null;
  }, [camera.frame, camera.place, camera.zone, places]);
  const episodes = useMemo(
    () =>
      spotlightEpisodes(flights, schedule.slots, schedule.length, camera.spotlight, camera.picked, (i) => {
        if (!spotArea) return true;
        const b = flights[i].box;
        return b.x1 >= spotArea.x0 && b.x0 <= spotArea.x1 && b.y1 >= spotArea.y0 && b.y0 <= spotArea.y1;
      }),
    [flights, schedule, camera.spotlight, camera.picked, spotArea],
  );

  const flightsViewAt = useMemo(() => {
    const length = schedule.length;
    const drift = camera.drift;
    const boxes = flights.map((f) => f.box);
    const fixed = (box: WorldBox, padding: number) => fitView(box, look, fw, fh, padding);

    // The frame the camera rests on, before any spotlight.
    let base: (t: number) => AtlasView | null;
    switch (camera.frame) {
      case 'world': {
        const v = fixed(WORLD_BOX, 0);
        base = (t) => driftView(v, drift, t / length);
        break;
      }
      case 'place': {
        const place = places.find((p) => p.id === camera.place) ?? places[0];
        const v = place ? fixed(place.box, camera.padding) : fitAll;
        base = (t) => driftView(v, drift, t / length);
        break;
      }
      case 'zone': {
        const v = camera.zone ? fixed(camera.zone, 0) : fitAll;
        base = (t) => driftView(v, drift, t / length);
        break;
      }
      case 'free': {
        const v = freeView ?? fitAll;
        base = () => v;
        break;
      }
      case 'follow':
        base = (t) => {
          const flying: number[] = [];
          schedule.slots.forEach((s, i) => {
            if (t >= s.start - 0.3 && t < s.end + 0.3) flying.push(i);
          });
          const box = flying.length ? boxOf(boxes, flying) : null;
          return box ? driftView(fixed(box, camera.padding), drift, t / length) : null;
        };
        break;
      default: {
        base = (t) => driftView(fitAll, drift, t / length);
      }
    }

    const eased = camera.frame === 'follow' || episodes.length > 0;
    if (!eased || !flights.length) return (t: number) => base(t) ?? fitAll;

    // The drone in the spotlight, centred, the frame spanning `closeness` km.
    const spotView = (t: number): AtlasView | null => {
      const ep = episodeAt(episodes, t);
      if (!ep) return null;
      const f = flights[ep.flight];
      const st = flightState(schedule.slots[ep.flight], f.duration, choreo.tempo, t);
      const p = positionAt(f, st.flightT);
      return { cx: p.x, cy: p.y, scale: clampScale(1 / spanForKm(camera.spotlight.closeness, latOf(p.y))) };
    };
    // Snappier while following a drone, so it stays near the middle.
    const track = buildCameraTrack((t) => spotView(t) ?? base(t), schedule.total, episodes.length ? Math.max(camera.tightness, 0.75) : camera.tightness);
    return (t: number) => cameraAt(track, t);
  }, [schedule, camera.drift, camera.frame, camera.place, camera.zone, camera.padding, camera.tightness, camera.spotlight.closeness, choreo.tempo, freeView, fitAll, places, look, fw, fh, flights, episodes]);

  // The film around the flights: an intro before, an outro after.
  const { intro, outro } = settings;
  const story = useMemo(() => storyOf(intro, outro, schedule.total), [intro, outro, schedule.total]);

  // The camera over the whole film: the flights' own, held still around
  // them — but diving from the world into a world-dive intro, and stepping
  // back over the network in a pull-back outro.
  const viewAt = useMemo(() => {
    const target = flightsViewAt(0);
    const start = intro.style === 'dive' ? diveStart(intro.diveFrom, WORLD_BOX, target, look, fw, fh) : null;
    return (t: number): AtlasView => {
      if (start && t < story.intro) {
        return diveView(start, target, ease(0.22 * story.intro, 0.8 * story.intro, t));
      }
      if (story.outro > 0 && outro.style === 'pull' && t > story.intro + story.flights) {
        return pullView(flightsViewAt(story.flights), outroLook(outro, story, t).pull);
      }
      return flightsViewAt(flightTime(story, t));
    };
  }, [flightsViewAt, story, intro, outro, look, fw, fh]);

  const diveTo = useMemo(() => {
    if (intro.style !== 'dive' || !flights.length) return null;
    const v = flightsViewAt(0);
    return { x: v.cx, y: v.cy };
  }, [intro.style, flights.length, flightsViewAt]);

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
      episodes,
      aircraft,
      totals,
      dateRange,
      logos,
      story,
      diveTo,
    }),
    [flights, schedule, settings, visiblePlaces, placeNames, placeOf, land, activity, stats, lod, episodes, aircraft, totals, dateRange, logos, story, diveTo],
  );

  return { core, schedule, places, placeNames, viewAt, fitAll, mapFrame, aircraftFound, unnamed };
}
