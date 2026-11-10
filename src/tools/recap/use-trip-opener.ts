import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { landIfLoaded, loadLandIndex } from '../../shared/map/load-terrain';
import { TILE_WORKERS, loadBasemap, useTilesAllowed } from '../../shared/map/osm-tiles';
import { closeStream, openStream } from '../../shared/map/tile-stream';
import { rankByRules } from '../../shared/recap/recap-carousel';
import { FORMATS, type RecapDoc } from '../../shared/recap/recap-doc';
import { TRIP_OPENERS, isTripOpener, type TripOpenerKind } from '../../shared/recap/recap-opener';
import { shownPictures, type TripOpenerPlan } from '../../shared/recap/recap-opener-plan';
import { planTripOpener, setupTripOpener, tripCovering, tripOpenerUnmet, type TripOpenerSetup } from '../../shared/recap/recap-trip-opener';
import { templateDays, type ResolvedRecap } from '../../shared/recap/recap-slots';
import type { HookPicture } from '../../shared/roadtrip/hooks/hook-variant';
import { loadTowns, townsIfLoaded } from '../../shared/roadtrip/load-gazetteer';
import { listTrips } from '../../shared/roadtrip/trip-store';
import type { TripDoc } from '../../shared/roadtrip/trip-types';

export interface TripOpenerState {
  /** The trips of Trips on this device (never fetched), null until read. */
  trips: TripDoc[] | null;
  /** Read them again — the drawer asks when it opens. */
  reload: () => void;
  /** The recap's days, as the openers and the drawer read them. */
  days: string[];
  /** The trip a recap with none would take a copy of: the one it named before lab 16, else the one covering its days. */
  covering: TripDoc | null;
  /** The chosen trip opener made ready — what its panel is handed. Null on another kind. */
  setup: TripOpenerSetup | null;
  plan: TripOpenerPlan | null;
  /** Why each of Trips' variants cannot open this recap (its tile's reason), by kind; absent = it can. */
  unmet: Partial<Record<TripOpenerKind, string>>;
  /** Bumped when what the plan paints from has landed (fonts, a map ground). */
  version: number;
}

/**
 * Trips' openers for a recap: this device's trips, the chosen variant made
 * ready over the recap's copy of a trip (`recap-trip-opener.ts`), and what
 * its paint waits for — the shipped coastline and towns the context reads,
 * the fonts, and a map ground the author asked for, fetched only where this
 * device allows OpenStreetMap tiles.
 */
export function useTripOpener(doc: RecapDoc, resolved: ResolvedRecap): TripOpenerState {
  const [trips, setTrips] = useState<TripDoc[] | null>(null);
  const [version, setVersion] = useState(0);
  const [asked, setAsked] = useState(0);
  const reload = useCallback(() => setAsked((n) => n + 1), []);
  useEffect(() => {
    let alive = true;
    void listTrips().then((t) => alive && setTrips(t));
    return () => {
      alive = false;
    };
  }, [asked]);

  // The same array while the shown pictures say the same thing: a caption typed must not re-plan a drive.
  const fresh = useMemo(() => shownPictures(resolved), [resolved]);
  const shownKey = fresh.map((p) => `${p.key}@${p.day ?? ''}@${p.lat ?? ''},${p.lon ?? ''}@${p.second ?? p.minute ?? ''}@${p.kind}`).join('|');
  const kept = useRef({ key: shownKey, list: fresh });
  if (kept.current.key !== shownKey) kept.current = { key: shownKey, list: fresh };
  const shown = kept.current.list;
  const ownDays = useMemo(() => templateDays(doc), [doc]);
  const daysKey = (ownDays.length ? ownDays : shown.flatMap((p) => (p.day ? [p.day] : []))).join('|');
  const days = useMemo(() => (daysKey ? [...new Set(daysKey.split('|'))].sort() : []), [daysKey]);
  const wanted = doc.opener.trip;
  const covering = useMemo(() => (trips ? (trips.find((t) => t.id === wanted) ?? tripCovering(trips, days)) : null), [trips, days, wanted]);

  const kind = isTripOpener(doc.opener.kind) ? doc.opener.kind : null;
  // The shipped coastline (a crossing told from a road) and towns (a group of places named): our own origin's, read once a session.
  const [shipped, setShipped] = useState(0);
  useEffect(() => {
    if (!kind || (landIfLoaded() && townsIfLoaded())) return;
    let alive = true;
    void Promise.allSettled([loadLandIndex(), loadTowns()]).then(() => alive && setShipped((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [kind]);

  const { width, height } = FORMATS[doc.format];
  const aspect = width / height;
  const { options, tripCopy } = doc.opener;
  const title = doc.title;
  const prefer = doc.carousel.rules.prefer;
  const best = useMemo(() => rankByRules(prefer)(shown.filter((p) => p.kind === 'photo'))[0]?.key ?? shown[0]?.key ?? null, [shown, prefer]);
  const setups = useMemo(() => {
    void shipped;
    const out: Partial<Record<TripOpenerKind, TripOpenerSetup>> = {};
    for (const k of TRIP_OPENERS) {
      const s = setupTripOpener({ kind: k, opener: { options, tripCopy }, pictures: shown, days, aspect, title, best });
      if (s) out[k] = s;
    }
    return out;
  }, [options, tripCopy, shown, days, aspect, title, best, shipped]);
  const unmet = useMemo(() => {
    const out: Partial<Record<TripOpenerKind, string>> = {};
    for (const k of TRIP_OPENERS) {
      const s = setups[k];
      const why = s ? tripOpenerUnmet(s) : 'Give the recap its days first';
      if (why) out[k] = why;
    }
    return out;
  }, [setups]);
  const setup = kind ? (setups[kind] ?? null) : null;
  const plan = useMemo(() => (setup ? planTripOpener(setup) : null), [setup]);

  useEffect(() => {
    if (!plan?.ready) return;
    let alive = true;
    void plan
      .ready()
      .catch(() => undefined)
      .then(() => alive && setVersion((v) => v + 1));
    return () => {
      alive = false;
    };
  }, [plan]);

  // A map ground the settings ask for: whole rasters decoded here, a following camera's pyramid streamed (its tiles decoded by the painter around the playhead).
  const allowed = useTilesAllowed();
  const held = useRef(new Map<string, HookPicture>());
  useEffect(() => {
    const wants = plan && allowed ? plan.wantsGround() : [];
    const keep = new Set(wants.map((w) => w.key));
    for (const [key, picture] of held.current) {
      if (keep.has(key)) continue;
      held.current.delete(key);
      (picture.image as ImageBitmap).close?.();
    }
    plan?.setGrounds(held.current);
    if (!plan || !wants.length) return;
    let alive = true;
    const streams = wants.filter((w) => w.pyramid).map((w) => ({ key: w.key, stream: openStream(w.key, w.pyramid!) }));
    void (async () => {
      await Promise.allSettled(streams.map((s) => s.stream.fetchAll()));
      for (const want of wants) {
        if (!alive) return;
        if (want.pyramid || held.current.has(want.key)) continue;
        try {
          const image = await loadBasemap(want.box, want.width, want.height, undefined, want.zoom, TILE_WORKERS);
          if (!alive) {
            image.close();
            return;
          }
          held.current.set(want.key, { image, width: image.width, height: image.height });
        } catch {
          // No ground for this one: the variant draws its own paper instead.
        }
      }
      if (!alive) return;
      await plan.ready?.().catch(() => undefined);
      if (alive) setVersion((v) => v + 1);
    })();
    return () => {
      alive = false;
      for (const s of streams) closeStream(s.key);
    };
  }, [plan, allowed]);
  useEffect(() => {
    const grounds = held.current;
    return () => {
      for (const picture of grounds.values()) (picture.image as ImageBitmap).close?.();
      grounds.clear();
    };
  }, []);

  return { trips, reload, days, covering, setup, plan, unmet, version };
}
