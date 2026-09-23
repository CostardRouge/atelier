/**
 * WHAT A RUN WILL DELIVER, picture by picture, before anything is fetched or
 * rendered — the *Delivers* row grown to the whole roll
 * (`docs/capture-renditions.md` §13.2, variant C, decided 2026-09-21).
 *
 * Since the export door lost its three words, which pixels a picture leaves
 * from is the PICTURE's own answer: its RAW when it is developed on the
 * sensor, the file it was set to above the photograph, else where it opens —
 * where `Auto`'s arithmetic still fetches a proxy's original for a frame the
 * proxy cannot fill. The one thing the door still says is *proxies only, for
 * this run*: every picture then leaves from what is in hand, a RAW base set
 * aside and said.
 *
 * This module only COUNTS and SAYS. Pure and DOM-free; the hook gathers the
 * facts, the panel draws the sentence.
 */

import { isRawDevelop } from './develop';
import type { RollPicture } from './roll-types';
import type { SensorSource } from './sensor-source';

export type PlanKind = 'sensor' | 'delivered' | 'proxy' | 'file' | 'missing';

/** What the export knows of ONE picture's files, gathered by the hook. */
export interface PictureFacts {
  /** The file in hand, or null while it is not. */
  file: File | null;
  /** True when that file is a source's editing rendition. */
  proxy: boolean;
  /** Where the sensor's data would come from, when a RAW is reachable (`sensorSourceFor`). */
  sensor: SensorSource | null;
  /** The file the stored rendition names, when the capture still offers it (`deliveredSourceFor`). */
  delivered: SensorSource | null;
  /** A proxy's own original — what `Auto` may fetch where the frame asks; null where there is none. */
  original: { name: string; bytes: number | null; held: boolean } | null;
}

export interface PicturePlan {
  id: string;
  name: string;
  kind: PlanKind;
  /** The file the pixels leave from; null when nothing is in hand. */
  from: string | null;
  /** Bytes the run WILL fetch for this picture — 0 when it is in hand. */
  fetchBytes: number;
  /** Bytes the run MAY fetch on top, where the frame asks for the original. */
  maybeBytes: number;
  /** The picture's own line, for the list behind the summary. */
  line: string;
}

export interface RunPlan {
  total: number;
  pictures: PicturePlan[];
  fetchBytes: number;
  maybeBytes: number;
  /** The one sentence the panel says. */
  summary: string;
}

export function planPicture(picture: RollPicture, facts: PictureFacts, proxiesOnly: boolean): PicturePlan {
  const name = picture.ref.name;
  const base = { id: picture.id, name, maybeBytes: 0 };
  if (!facts.file) {
    return { ...base, kind: 'missing', from: null, fetchBytes: 0, line: `${name} — not in hand, left out` };
  }
  const onSensor = isRawDevelop(picture.develop);
  if (proxiesOnly) {
    const from = facts.file.name;
    const aside = onSensor ? ', its RAW base set aside' : '';
    return facts.proxy
      ? { ...base, kind: 'proxy', from, fetchBytes: 0, line: `${name} ← its proxy${aside}` }
      : { ...base, kind: 'file', from, fetchBytes: 0, line: `${name} ← the file itself${aside}` };
  }
  if (onSensor && facts.sensor) {
    const s = facts.sensor;
    const cost = s.held ? 'in hand' : `${s.bytes ?? 0} B to fetch`;
    return {
      ...base,
      kind: 'sensor',
      from: s.name,
      fetchBytes: s.held ? 0 : (s.bytes ?? 0),
      line: `${name} ← ${s.name}, the sensor’s data (${cost})`,
    };
  }
  if (facts.delivered) {
    const d = facts.delivered;
    const cost = d.held ? 'in hand' : `${d.bytes ?? 0} B to fetch`;
    return { ...base, kind: 'delivered', from: d.name, fetchBytes: d.held ? 0 : (d.bytes ?? 0), line: `${name} ← ${d.name} (${cost})` };
  }
  const aside = onSensor ? ' — its RAW is out of reach here, the base set aside' : '';
  if (facts.proxy) {
    const o = facts.original;
    const maybe = o && !o.held ? (o.bytes ?? 0) : 0;
    const more = o ? `, ${o.name} fetched where the frame asks${o.held ? ' (in hand)' : ''}` : '';
    return { ...base, kind: 'proxy', from: facts.file.name, fetchBytes: 0, maybeBytes: maybe, line: `${name} ← its proxy${more}${aside}` };
  }
  return { ...base, kind: 'file', from: facts.file.name, fetchBytes: 0, line: `${name} ← the file itself${aside}` };
}

const KIND_WORDS: Record<Exclude<PlanKind, 'missing'>, string> = {
  sensor: 'from the sensor',
  delivered: 'from the file chosen',
  proxy: 'from the proxy',
  file: 'from the file itself',
};

/** The whole run: every picture planned, the bytes it costs, and the sentence. */
export function planRun(
  pictures: readonly RollPicture[],
  factsFor: (picture: RollPicture) => PictureFacts,
  proxiesOnly: boolean,
  formatBytes: (n: number) => string,
): RunPlan {
  const planned = pictures.map((p) => planPicture(p, factsFor(p), proxiesOnly));
  // The lines say bytes as numbers; the panel wants them formatted. One pass.
  for (const p of planned) p.line = p.line.replace(/(\d+) B to fetch/, (_, n: string) => `${formatBytes(Number(n))} to fetch`);
  const counts = new Map<PlanKind, number>();
  let fetchBytes = 0;
  let maybeBytes = 0;
  for (const p of planned) {
    counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
    fetchBytes += p.fetchBytes;
    maybeBytes += p.maybeBytes;
  }
  const parts: string[] = [`${planned.length} picture${planned.length === 1 ? '' : 's'}`];
  for (const kind of ['sensor', 'delivered', 'proxy', 'file'] as const) {
    const n = counts.get(kind) ?? 0;
    if (n) parts.push(`${n} ${KIND_WORDS[kind]}`);
  }
  const missing = counts.get('missing') ?? 0;
  if (missing) parts.push(`${missing} not in hand`);
  if (fetchBytes > 0) parts.push(`${formatBytes(fetchBytes)} to fetch`);
  if (maybeBytes > 0) parts.push(`up to ${formatBytes(maybeBytes)} more where a frame asks`);
  if (proxiesOnly) {
    const aside = pictures.filter((p) => isRawDevelop(p.develop)).length;
    parts.push(aside ? `proxies only, ${aside} RAW base${aside === 1 ? '' : 's'} set aside` : 'proxies only');
  }
  return { total: planned.length, pictures: planned, fetchBytes, maybeBytes, summary: parts.join(' · ') };
}
