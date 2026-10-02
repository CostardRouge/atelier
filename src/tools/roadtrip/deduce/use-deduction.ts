import { useEffect, useMemo, useState } from 'react';
import { WinnowClient, WinnowError } from '../../../shared/sources/winnow/client';
import type { WinnowConnection } from '../../../shared/sources/winnow/store';
import { loadLand } from '../../../shared/map/load-land';
import type { LandCollection } from '../../../shared/map/land';
import { readDayTrack, type DayPoint, type DayTrack } from '../../../shared/roadtrip/day-track';
import { proposeDraft, type DeduceDraft, type Proposal } from '../../../shared/roadtrip/deduce-draft';
import { findOutliers, withoutOutliers, type Outlier } from '../../../shared/roadtrip/deduce-outliers';
import type { GazetteerCity } from '../../../shared/roadtrip/gazetteer';
import { gazetteerOrEmpty } from '../../../shared/roadtrip/load-gazetteer';
import { segmentTrack, type TrackLeg } from '../../../shared/roadtrip/segment-track';
import { trackChapters, type TrackChapter } from '../../../shared/roadtrip/track-chapters';
import { enumerateDays, type IsoDate } from '../../../shared/roadtrip/trip-days';
import type { TripDoc } from '../../../shared/roadtrip/trip-types';
import type { DeduceSettings } from './settings';

/**
 * The deduction as the three windows read it: ONE request to the instance,
 * then everything derived from it in memory — a slider never asks again.
 *
 * Three things load beside each other and are each allowed to fail on their
 * own: the day positions (without them there is nothing to deduce — said as
 * `problem`), the city index (a leg with no name still has its dates), and
 * the coastline (a map with no land is still a map of the route).
 */

export interface Problem {
  text: string;
  login?: string;
}

/** One day of the trip's span, as the frieze and the data pane read it. */
export interface DayInfo {
  date: IsoDate;
  /** Media that day; 0 when the instance holds nothing for it. */
  count: number;
  placed: boolean;
  /** Placed, and left out as an outlier. */
  ignored: boolean;
  inferred: boolean;
}

export interface Deduction {
  client: WinnowClient;
  sourceId: string;
  track: DayTrack | null;
  cities: GazetteerCity[] | null;
  land: LandCollection | null;
  problem: Problem | null;
  /** When the instance last answered; null until it has. */
  readAt: number | null;
  /** True while the first answer, or a refresh, is on its way. */
  loading: boolean;
  outliers: Outlier[];
  /** The days the deduction ran over — the track less the ignored outliers. */
  points: DayPoint[];
  halts: TrackLeg[];
  chapters: TrackChapter[];
  proposals: Proposal[];
  days: DayInfo[];
  refresh: () => void;
}

function explain(err: unknown, client: WinnowClient): Problem {
  if (err instanceof WinnowError && err.kind === 'unauthenticated') {
    return { text: `Not signed in to ${client.config.baseUrl}.`, login: client.loginUrl() };
  }
  if (err instanceof WinnowError && err.kind === 'notfound') {
    return {
      text: `${client.config.baseUrl} cannot answer for a day's position yet — it is too old for this.`,
    };
  }
  return { text: err instanceof Error ? err.message : String(err) };
}

export function useDeduction(
  connection: WinnowConnection,
  trip: TripDoc,
  settings: DeduceSettings,
  draft: DeduceDraft,
): Deduction {
  const client = useMemo(
    () => new WinnowClient({ baseUrl: connection.baseUrl, auth: connection.auth }),
    [connection.baseUrl, connection.auth],
  );
  const [track, setTrack] = useState<DayTrack | null>(null);
  const [cities, setCities] = useState<GazetteerCity[] | null>(null);
  const [land, setLand] = useState<LandCollection | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [readAt, setReadAt] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [generation, setGeneration] = useState(0);

  // One request, on open and on Refresh. The index and the coast come with
  // it, once; a refresh re-asks the instance alone.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setProblem(null);
    client
      .geoDays({ from: trip.startDate, to: trip.endDate })
      .then((rows) => {
        if (cancelled) return;
        setTrack(readDayTrack(rows));
        setReadAt(Date.now());
      })
      .catch((err: unknown) => {
        if (!cancelled) setProblem(explain(err, client));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client, trip.startDate, trip.endDate, generation]);

  useEffect(() => {
    let cancelled = false;
    gazetteerOrEmpty().then((list) => {
      if (!cancelled) setCities(list);
    });
    loadLand().then(
      (collection) => {
        if (!cancelled) setLand(collection);
      },
      () => {
        // A map with no land is still a map of the route.
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const outliers = useMemo(() => (track ? findOutliers(track.points) : []), [track]);
  const points = useMemo(
    () => (track ? (settings.ignoreOutliers ? withoutOutliers(track.points, outliers) : track.points) : []),
    [track, outliers, settings.ignoreOutliers],
  );

  // ONE pass over the days: the halts, the chapters at the grain, then the
  // proposals against the trip. Deriving them apart is how a count and a
  // list start disagreeing.
  const { halts, chapters } = useMemo(() => {
    if (!track || cities === null) return { halts: [] as TrackLeg[], chapters: [] as TrackChapter[] };
    const { legs } = segmentTrack(points, settings);
    return {
      halts: legs,
      chapters: trackChapters(legs, cities, {
        nameByRegion: settings.nameByRegion,
        grain: settings.grain,
        maxHopKm: settings.hopKm,
        bigDays: settings.bigDays,
      }),
    };
  }, [track, cities, points, settings]);

  const proposals = useMemo(
    () => proposeDraft(trip, chapters, draft, connection.id),
    [trip, chapters, draft, connection.id],
  );

  const days = useMemo<DayInfo[]>(() => {
    const placed = new Map(track?.points.map((p) => [p.date, p]) ?? []);
    const kept = new Set(points.map((p) => p.date));
    const blind = new Set(track?.blind ?? []);
    return enumerateDays(trip.startDate, trip.endDate).map((date) => {
      const point = placed.get(date);
      return {
        date,
        count: point?.count ?? (blind.has(date) ? 1 : 0),
        placed: !!point,
        ignored: !!point && !kept.has(date),
        inferred: point?.inferred ?? false,
      };
    });
  }, [track, points, trip.startDate, trip.endDate]);

  return {
    client,
    sourceId: connection.id,
    track,
    cities,
    land,
    problem,
    readAt,
    loading,
    outliers,
    points,
    halts,
    chapters,
    proposals,
    days,
    refresh: () => setGeneration((g) => g + 1),
  };
}
