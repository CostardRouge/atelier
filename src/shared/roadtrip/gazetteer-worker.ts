/**
 * The city index fetched, parsed and ORDERED off the main thread
 * (`load-gazetteer.ts` starts this, once per session, and ends it the moment
 * the answer lands — the 77 MB the JSON text and its rows cost live in this
 * worker's heap alone). What crosses back is the parsed list, cloned, and
 * the towns' order as a typed array, transferred: a second list of a hundred
 * thousand records would be cloned on the main thread, which is what the
 * worker exists to spare it (audit PERF-06).
 */

import { townOrder } from '../map/pick-map';
import { parseGazetteer, type GazetteerCity } from './gazetteer';

export interface GazetteerAnswer {
  ok: true;
  cities: GazetteerCity[];
  order: Uint32Array;
}

export interface GazetteerFailure {
  ok: false;
  error: string;
}

self.onmessage = async (event: MessageEvent<{ url: string }>) => {
  try {
    const res = await fetch(event.data.url);
    if (!res.ok) throw new Error(`the city index answered ${res.status}`);
    const cities = parseGazetteer(await res.json());
    const order = townOrder(cities);
    const answer: GazetteerAnswer = { ok: true, cities, order };
    (self as unknown as Worker).postMessage(answer, [order.buffer]);
  } catch (err) {
    const failure: GazetteerFailure = { ok: false, error: err instanceof Error ? err.message : String(err) };
    (self as unknown as Worker).postMessage(failure);
  }
};
