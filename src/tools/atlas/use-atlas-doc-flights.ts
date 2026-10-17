import { useEffect, useMemo, useState } from 'react';
import { parseSrt } from '../../shared/telemetry/srt-parser';
import { yieldToMain } from '../../shared/lib/yield-to-main';
import { flightFromCues, type AtlasFlight } from './atlas-flight';
import type { AtlasFlightRef } from './atlas-doc';
import { sessionLogs } from './atlas-ingest';
import { getLogs } from './atlas-store';

/** A log parsed once per tab, under the flight id and name it is drawn with. */
const parsed = new Map<string, AtlasFlight | null>();
const keyOf = (r: AtlasFlightRef) => `${r.log}|${r.name}`;

export interface AtlasDocFlights {
  /** The flights read so far, in the atlas's order; a log with no GPS is left out. */
  flights: AtlasFlight[];
  /** While reading: how far. */
  reading: { done: number; total: number } | null;
  /** Names of the logs that held no usable track. */
  empty: string[];
  /** The aircraft each flight's clip named when it was added, by flight id. */
  aircraft: ReadonlyMap<string, string>;
  /** The flights whose log this device does not keep — said, and offered back. */
  missing: AtlasFlightRef[];
  /** Read the store again (after logs were brought back). */
  reload: () => void;
}

/**
 * An atlas's flights, read from the logs this device keeps (`atlas-store.ts`)
 * — never from the Library, which is how an atlas reopens from the gallery
 * with nothing else at hand. One log at a time with the main thread given
 * back, published in batches so the map fills as it goes.
 */
export function useAtlasDocFlights(refs: readonly AtlasFlightRef[]): AtlasDocFlights {
  const [seq, setSeq] = useState(0);
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  const [missingLogs, setMissingLogs] = useState<ReadonlySet<string>>(() => new Set());
  const [epoch, setEpoch] = useState(0);
  const key = refs.map(keyOf).join(',');

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const todo = refs.filter((r) => !parsed.has(keyOf(r)));
      const missing = new Set<string>();
      if (!todo.length) {
        setMissingLogs(missing);
        setReading(null);
        return;
      }
      setReading({ done: 0, total: todo.length });
      const stored = await getLogs(todo.filter((r) => !sessionLogs.has(r.log)).map((r) => r.log));
      if (cancelled) return;
      for (const [i, r] of todo.entries()) {
        const text = sessionLogs.get(r.log) ?? stored.get(r.log);
        if (text === undefined) missing.add(r.log);
        else {
          try {
            parsed.set(keyOf(r), flightFromCues(r.id, r.name, parseSrt(text)));
          } catch {
            parsed.set(keyOf(r), null);
          }
        }
        if ((i + 1) % 8 === 0 || i === todo.length - 1) {
          setSeq((n) => n + 1);
          setReading(i === todo.length - 1 ? null : { done: i + 1, total: todo.length });
          await yieldToMain();
          if (cancelled) return;
        }
      }
      setMissingLogs(missing);
    })();
    return () => {
      cancelled = true;
    };
    // `key` names the refs; `epoch` asks again after logs came back.
  }, [key, epoch]);

  return useMemo(() => {
    void seq;
    const flights: AtlasFlight[] = [];
    const empty: string[] = [];
    const missing: AtlasFlightRef[] = [];
    const aircraft = new Map<string, string>();
    for (const r of refs) {
      if (r.aircraft) aircraft.set(r.id, r.aircraft);
      const k = keyOf(r);
      if (parsed.has(k)) {
        const f = parsed.get(k);
        if (f) flights.push(f);
        else empty.push(r.name);
      } else if (missingLogs.has(r.log)) missing.push(r);
    }
    return { flights, reading, empty, aircraft, missing, reload: () => setEpoch((n) => n + 1) };
    // `parsed` is read through `seq`, the batch counter the effect bumps.
  }, [refs, reading, missingLogs, seq]);
}
