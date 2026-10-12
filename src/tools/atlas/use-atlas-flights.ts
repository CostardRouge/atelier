import { useEffect, useMemo, useState } from 'react';
import { parseSrt } from '../../shared/telemetry/srt-parser';
import { yieldToMain } from '../../shared/lib/yield-to-main';
import { flightFromCues, type AtlasFlight } from './atlas-flight';
import { readAircraft } from './read-aircraft';

/** One telemetry file the Library holds for a selected asset. */
export interface FlightSource {
  id: string;
  name: string;
  srt: File;
  /** The clip beside the log, when the Library holds it — only its metadata is read, for the drone's name. */
  video: File | null;
}

/**
 * A file read once per tab: the same `File` handle is the same flight, so
 * switching tools and coming back — or ticking a flight off and on — never
 * parses a log twice. A failure is remembered as null (a log with no GPS
 * lock stays one).
 */
const parsed = new WeakMap<File, Promise<AtlasFlight | null>>();

function readFlight(source: FlightSource): Promise<AtlasFlight | null> {
  let pending = parsed.get(source.srt);
  if (!pending) {
    pending = source.srt
      .text()
      .then((text) => flightFromCues(source.id, source.name, parseSrt(text)))
      .catch(() => null);
    parsed.set(source.srt, pending);
  }
  return pending;
}

export interface AtlasFlights {
  /** The flights read so far, in the sources' order; a log with no GPS is left out. */
  flights: AtlasFlight[];
  /** While reading: how far. */
  reading: { done: number; total: number } | null;
  /** Names of the logs that held no usable track. */
  empty: string[];
  /** The aircraft each clip's metadata names, by flight id (absent: no clip, or it names none). */
  aircraft: ReadonlyMap<string, string>;
}

/**
 * Read every source's log into a flight, one at a time with the main thread
 * given back between two, so a folder of two hundred logs fills the map as
 * it goes instead of freezing the tab.
 */
export function useAtlasFlights(sources: readonly FlightSource[]): AtlasFlights {
  const [byId, setById] = useState<Map<string, AtlasFlight | null>>(() => new Map());
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [aircraft, setAircraft] = useState<ReadonlyMap<string, string>>(() => new Map());
  const key = sources.map((s) => `${s.id}:${s.srt.name}:${s.srt.size}`).join('|');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const total = sources.length;
      let done = 0;
      const next = new Map<string, AtlasFlight | null>();
      if (total) setReading({ done: 0, total });
      for (const source of sources) {
        const flight = await readFlight(source);
        if (cancelled) return;
        next.set(source.id, flight);
        done += 1;
        // Publish in batches, so the map grows without a render per file.
        if (done % 8 === 0 || done === total) {
          setById(new Map(next));
          setReading(done === total ? null : { done, total });
        }
        await yieldToMain();
        if (cancelled) return;
      }
      if (!total) {
        setById(new Map());
        setReading(null);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `key` names the sources: a new array of the same files reads nothing.
  }, [key]);

  // The drones' names, from the clips' metadata — after the tracks, never before them.
  const videoKey = sources.map((s) => (s.video ? `${s.id}:${s.video.name}:${s.video.size}` : '')).join('|');
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const next = new Map<string, string>();
      for (const source of sources) {
        if (!source.video) continue;
        const name = await readAircraft(source.video);
        if (cancelled) return;
        if (name) next.set(source.id, name);
      }
      if (!cancelled) setAircraft(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [videoKey]);

  return useMemo(() => {
    const flights: AtlasFlight[] = [];
    const empty: string[] = [];
    for (const s of sources) {
      if (!byId.has(s.id)) continue;
      const f = byId.get(s.id);
      if (f) flights.push(f);
      else empty.push(s.name);
    }
    return { flights, reading, empty, aircraft };
  }, [byId, reading, sources, aircraft]);
}
