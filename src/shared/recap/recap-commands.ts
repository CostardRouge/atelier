/**
 * What an agent reads of a recap and how it writes one — the checks only a
 * recap can make, apart from the screens that register the commands
 * (`tools/recap/use-recap-commands.ts`, `RecapTool.tsx`).
 *
 * A setting is written through `applySettings`: the patch is merged, read
 * back through `readRecapDoc` (the same clamps a stored file meets), and any
 * leaf the reading changed is REFUSED by name — out of range is refused,
 * never clamped (`agent-commands.md`).
 *
 * Pure and DOM-free.
 */

import { readRecapDoc, withRecap, type RecapDoc, type RecapPicture } from './recap-doc';
import type { RecapOpener } from './recap-opener';
import { isGivenTrip, openerTripFrom, openerTripFromText, orderTrips, tripFacts, tripStale } from './recap-opener-trip';
import type { TripDoc } from '../roadtrip/trip-types';
import { deviceLabel, type DeviceAliases, type ResolvedRecap } from './recap-slots';
import { placeName, placeWords } from './recap-places';
import { inFamily, wordsOn } from './recap-scope';
import { WORD_KEYS } from './recap-cellwords';
import { DEFAULT_CAPTION, captionText, captionWords } from './recap-publish';
import { nextFreeSlot, zonedInstant, type Rhythm } from '../sources/postiz/rhythm';
import { networkOf } from '../sources/postiz/networks';

/** The settings an agent may set, and what each holds. */
export const SETTABLE: Record<string, string> = {
  format: '"story" (9:16), "portrait" (4:5) or "square" (1:1)',
  grid: 'a grid’s shape: "2x2", "3x3", "bento" or "hero"',
  count: 'a dump’s pictures, 1–60',
  rungs: 'on this day’s steps back, e.g. ["1y","1m","1w","0d"]',
  range: 'a grid’s, single’s or dump’s period {from, to} (YYYY-MM-DD)',
  filter: '{devices: [camera models], kinds: "all" | "photo" | "video"}',
  heading: '{text, show} — text may hold {month} {year} {week} {date} {from} {to} {count} {days} {videos} {place} (the place most visited, after the pin unless places.titlePin is false) {places} (the route: Esperance → Albany → Perth)',
  subheading: '{text, show}',
  cta: '{text, show} — the call to action',
  font: '"sans", "serif" or "mono"',
  headingOffset: '{x, y}, fractions of the page, −0.5…0.5',
  cells: 'the FIRST slide\'s cells (a month\'s calendar, a dump\'s cover) — the slides after it set their own in carousel.cells, one slide in carousel.slideCells: {number, count, exif, device, caption, videoBadge, today, headers: booleans; empty: "number"|"dashed"|"hidden"; weekStart: 0|1; gap: 0–0.04; radius: 0–0.25; shadow: 0–1 (0 = none); shadowBlur: 0–0.5; shadowY: 0–0.25; numberAt: "topLeft"|"topRight"|"centre"|"bottomLeft"|"foot" (foot: a band low over the picture, room for a long date — never on a calendar cell); date: "auto"|"d"|"wd"|"dMon"|"wdMon"|"full"|"rank" (how the date reads when number is on: auto = what the cell always printed, the day on a calendar, the rank elsewhere; 10 · Mon 10 · 10 Nov · Mon 10 Nov · Monday 10 November 2025 · its rank); exifParts: the camera settings the line says, a list in this order: "device","lens","focal","aperture","shutter","iso"; arrange: "auto"|"line"|"stack" (words never pass their cell)}',
  sheet: '{arrangement: "rows"|"collage"|"film"|"timeline"; slides: 2–10 or null (counted from the pictures); camera: "stops"|"glide" (the Reel along the sheet); rows: {rows: 1–4|null, big, loose: booleans, margin: 0.02–0.2}; collage: {density: 0–1, tilt: 0–12°, spread: 0–1, border: "white"|"thin"|"none"}; film: {strips: 1|2, shape: "3:2"|"1:1"|"4:5", where: "high"|"centre"|"low", edge: boolean}; timeline: {spacing: "time"|"even", sides: "both"|"one", stars, days: booleans}; own: {"<slide index ≥ 1>": {layout: "hero"|"pair"|"breather", text?: a breather\'s line}}} — the Sheets template only; the cut rule (no face across a cut, one picture per cut) is fixed',
  carousel: '{after: "none"|"highlights"|"weeks" (weeks: a month only; a dump and a sheet are highlights already); highlights: 1–60; rules: {leave: {screen|burst|alike: false to keep them}, prefer: ["pick","stars","edited","faces","sharp"] in order}; picksOnly: true|false|null (null = picks when they fill the places); chosen: picture keys of a FROZEN selection (null = the rule chooses) — removing a key removes the picture, nothing comes in; left: removed keys; burstPick: {burstId: key}; layouts: {"p:0": "full"|"two"|"oneTwo"|"three"|"four"|"six"} a flow slide set by hand; order: slide keys ("first", "p:0", "w:1", "clip:<slot>") or null; titles: "first"|"head"|"same" — the first slide\'s title on the others; headDates: boolean (the running head also says the slide\'s days, «3 – 8 Nov»); cells: what the slides after the first SAY — any of cells\' number, date, numberAt, count, exif, device, caption, exifParts, arrange, the rest inherited from cells; slideCells: {"p:2": the same words} one slide\'s own over its family\'s (page keys as layouts)}',
  delivery: '{quality: "standard"|"high"|"max" (≈8, 16, 28 Mb/s at 1080×1920 30 fps); fps: 30|60; passes: 1|2 (2 = measured two-pass, where the browser\'s encoder has a constant-quality mode, else one VBR pass); media: "proxy"|"original" (painted from the originals: every clip, the background first, and every picture a print would blow up — fetched for the export)}',
  motion: '{title: "none"|"fade"|"rise"|"type"|"mask"; order: "inOrder"|"random"|"wave"|"columns"|"spiral"; entrance: "none"|"fade"|"slide"|"pop"|"drop"|"develop"|"flicker"; stagger: 0–1 s; hold: 0.5–30 s; videos: "turn"|"zoom"|"together"|"poster"; seed; onBeat: true = the cuts and entrances land on the sound\'s beats and the film ends on a bar (the sound\'s beat is found when it is added); bands (a week): "none"|"accordion"|"spotlight"|"wave"|"slide"|"focus" — each day takes the stage in turn once everything is on; bandHold: 0.4–3 s a day; bandPan: true = each picture drifts in its band}',
  background: '{kind: "paper"|"ink"|"colour"|"blur"|"video"; colour: "#rrggbb"; loopIn, loopOut (s); speed: 0.25–2; veil: 0–0.8; blur: 0–160; picture: the pool key the blurred ground softens (absent = the best photograph of the period); frame: {x, y: 0–1 the focus, zoom: 1–4, rotate: −45–45 degrees}}',
  clipSlides: 'true: each clip gets a carousel slide of its own and its cell says which',
  opener: '{kind: "none"|"defile"|"badge"|"drive"|"map"|"showcase"|"card" (the last four are Trips\' Virée, Itinerary, Vitrine and Trip card: they drive the trip the recap keeps a copy of — recap.openerTrips, recap.openerTrip, recap.openerTripFile; recap.get says it as opener.tripKept — or its located pictures alone); seconds: 0.6–8; easing: "ease-out"|"ease-out-hard"|"linear"|"ease-in"|"ease-in-out" (Défilé); tape, ticks: booleans (Défilé); picture: a pool key or null (Badge: the best); lines: {date, place, camera: booleans}; title: the Badge\'s big line or null (its place, else the title); slide: true = also the carousel\'s first slide (Badge, one of Trips\' openers); options: {drive|map|showcase|card: that variant\'s own settings, as Trips\' panel writes them (stopsOn, secondsPerPicture, ground, camera…)}} — the first seconds of the Reel, before the first page; the length counts them',
  places: '{cells: "off"|"changes"|"every"|"first" (the town in a pill with the pin: off, where the place changes from the cell before, on every cell, on the first picture of each place); corner: "bottomLeft"|"topLeft"|"topRight"|"bottomRight"; runs: boolean (a month\'s or a week\'s runs of days in one place under the calendar, off by default); titlePin: boolean ({place} in a text leads with the pin); writing: "name"|"code"|"full"|"paren" (Albany · Albany, WA · Albany, Western Australia · Albany (WA), as Trips writes a place); country: "never"|"changes"|"always" (the country after the place on the pills: never, on the first and after a border, always)} — the place is Winnow\'s geocoding, read at fill, or one given by hand (recap.place)',
  length: 'the film’s length in seconds, 3–90, or null for the recap’s own (entrances, clips, hold); set, it wins over the sound’s whole loops',
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Every leaf the patch names, as a path and the value asked. */
function leaves(value: unknown, path: string, out: [string, unknown][]): void {
  if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) leaves(v, path ? `${path}.${k}` : k, out);
  } else out.push([path, value]);
}

function at(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const k of path.split('.')) {
    if (!isPlainObject(cur)) return undefined;
    cur = cur[k];
  }
  return cur;
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export type SettingsResult = { ok: true; doc: RecapDoc; changed: string[] } | { ok: false; error: string };

/** `patch` written onto `doc`, or the reason it is refused — an unknown key, or a value its field cannot hold. */
export function applySettings(doc: RecapDoc, patch: unknown, now: number = Date.now()): SettingsResult {
  if (!isPlainObject(patch)) return { ok: false, error: 'the settings are an object of fields' };
  const unknown = Object.keys(patch).filter((k) => !(k in SETTABLE));
  if (unknown.length) return { ok: false, error: `unknown setting${unknown.length > 1 ? 's' : ''} ${unknown.map((k) => `"${k}"`).join(', ')} — known: ${Object.keys(SETTABLE).join(', ')}` };
  const merged: Record<string, unknown> = { ...doc };
  for (const [k, v] of Object.entries(patch)) {
    const cur = (doc as unknown as Record<string, unknown>)[k];
    merged[k] = isPlainObject(v) && isPlainObject(cur) ? { ...cur, ...v } : v;
  }
  const read = readRecapDoc(merged, doc.sourceId, now);
  if (!read) return { ok: false, error: 'these settings do not make a recap' };
  const asked: [string, unknown][] = [];
  leaves(patch, '', asked);
  for (const [path, value] of asked) {
    const got = at(read, path);
    // A text's control characters and an anchor moved to its month or week are the reading's to make.
    if (path === 'anchor') continue;
    if (!same(got, value)) {
      const known = path.split('.')[0];
      return { ok: false, error: `${path}: ${JSON.stringify(value)} is not a value it can hold — ${SETTABLE[known]}` };
    }
  }
  const next = withRecap(doc, Object.fromEntries(Object.keys(patch).map((k) => [k, (read as unknown as Record<string, unknown>)[k]])) as Partial<RecapDoc>, now);
  return { ok: true, doc: next, changed: asked.map(([p]) => p) };
}

/**
 * The opener as an agent reads it: every setting, and the trip it keeps a
 * copy of said in a line (`tripKept`) — never the copy itself, which is a
 * whole road.
 */
export function openerOutline(o: RecapOpener) {
  const { tripCopy, ...rest } = o;
  return { ...rest, tripKept: isGivenTrip(tripCopy) ? { from: tripCopy.from.kind, ...tripFacts(tripCopy.file) } : null };
}

/** The trips of this device an opener can drive, as an agent lists them: the ones covering `days` first, the one kept marked. */
export function openerTrips(doc: Pick<RecapDoc, 'opener'>, trips: readonly TripDoc[], days: readonly string[]) {
  const copy = doc.opener.tripCopy;
  const keptId = copy?.from.kind === 'trips' ? copy.from.id : null;
  return orderTrips(trips, days).map(({ trip, covers }) => ({
    id: trip.id,
    ...tripFacts(trip),
    covers,
    kept: trip.id === keptId,
    ...(trip.id === keptId && tripStale(copy, trips) ? { changedSince: true } : {}),
  }));
}

type OpenerTripResult = { ok: true; doc: RecapDoc; kept: ReturnType<typeof openerOutline>['tripKept'] } | { ok: false; error: string };

const kept = (doc: RecapDoc, tripCopy: RecapOpener['tripCopy']): OpenerTripResult => {
  const next = withRecap(doc, { opener: { ...doc.opener, tripCopy, tripAuto: false } });
  return { ok: true, doc: next, kept: openerOutline(next.opener).tripKept };
};

/** The recap keeping a copy of the trip `id` of this device — or none, for `"none"`: its located pictures alone are then the road. */
export function withOpenerTripOf(doc: RecapDoc, trips: readonly TripDoc[], id: string, now: number = Date.now()): OpenerTripResult {
  if (id === 'none') return kept(doc, null);
  const trip = trips.find((t) => t.id === id);
  if (!trip) return { ok: false, error: `no trip "${id}" on this device — recap.openerTrips lists them${trips.length ? ` (${trips.slice(0, 3).map((t) => t.id).join(', ')}…)` : ' (there is none: give a trip file with recap.openerTripFile)'}` };
  return kept(doc, openerTripFrom(trip, now));
}

/** The recap keeping a copy of the trip a `.roadtrip.json`'s text holds; the file reader's own words when it is not one. */
export function withOpenerTripFile(doc: RecapDoc, text: string, name: string, now: number = Date.now()): OpenerTripResult {
  const read = openerTripFromText(text, name, now);
  return read.ok ? kept(doc, read.trip) : { ok: false, error: read.error };
}

/** The recap as an agent reads it: what it is about, its settings, and every slot with what it shows. */
/** What a page's cells say once the scopes are merged — the words only, not the look. */
const saidOn = (doc: RecapDoc, key: string) => {
  const w = wordsOn(doc, key);
  return Object.fromEntries(WORD_KEYS.map((k) => [k, w[k]]));
};

export function recapOutline(doc: RecapDoc, resolved: ResolvedRecap, pages: number, seconds: number, aliases: DeviceAliases = {}, slides?: string[]) {
  return {
    id: doc.id,
    title: doc.title,
    keptOn: doc.sourceId,
    template: doc.template,
    format: doc.format,
    anchor: doc.anchor,
    ...(doc.rungs.length && doc.template === 'onThisDay' ? { rungs: doc.rungs } : {}),
    ...(doc.range ? { range: doc.range } : {}),
    filter: doc.filter,
    pool: doc.pictures.filter((p) => !p.loose).length,
    inScope: resolved.inScope.length,
    days: resolved.days,
    pages,
    ...(slides ? { slides } : {}),
    seconds: Math.round(seconds * 100) / 100,
    filled: resolved.slots.filter((s) => s.picture).length,
    slots: resolved.slots.map((s) => ({
      slot: s.id,
      label: s.label,
      ...(s.day ? { day: s.day } : {}),
      picture: s.picture
        ? {
            key: s.picture.key,
            name: s.picture.name,
            kind: s.picture.kind,
            ...(s.picture.device ? { device: deviceLabel(s.picture.device, aliases) } : {}),
            ...(s.picture.develop ? { developed: true } : {}),
            ...(s.picture.frame ? { frame: s.picture.frame } : {}),
          }
        : null,
      ...(s.pinned ? { pinned: true } : {}),
      ...(s.cleared ? { emptied: true } : {}),
      candidates: s.candidates.length,
      ...(doc.captions[s.id] ? { caption: doc.captions[s.id] } : {}),
    })),
    heading: doc.heading,
    subheading: doc.subheading,
    cta: doc.cta,
    font: doc.font,
    cells: doc.cells,
    // What each slide's cells actually say once the scopes are merged (lab 17): the first slide's, the family's, a slide's own.
    ...(slides ? { slideWords: Object.fromEntries(slides.filter((k) => k === 'first' || inFamily(k)).map((k) => [k, saidOn(doc, k)])) } : {}),
    motion: doc.motion,
    opener: openerOutline(doc.opener),
    background: { ...doc.background },
    sound: doc.sound,
    look: doc.look ? doc.look.layers.map((l) => l.name) : null,
    clipSlides: doc.clipSlides,
    places: doc.places,
    post: {
      caption: doc.publish.caption ?? DEFAULT_CAPTION,
      text: captionText(doc, resolved),
      approved: doc.publish.approved,
      publications: doc.publish.publications,
    },
  };
}

/**
 * What an agent needs to WRITE a recap's caption (his ask, 2026-11-08: «générer
 * les textes automatiquement, les valider, les publier»): what it is about,
 * the places in order and how long each was stayed in, the cameras, the
 * pictures it shows with their day and place (the best first), the words a
 * caption template can hold, filled, and the caption as it stands.
 */
export function recapFacts(doc: RecapDoc, resolved: ResolvedRecap, aliases: DeviceAliases = {}) {
  const shown = resolved.slots.flatMap((s) => (s.picture ? [s.picture] : []));
  const pool = resolved.inScope.length ? resolved.inScope : shown;
  const words = placeWords(pool);
  const stays = new Map<string, Set<string>>();
  for (const p of pool) {
    const name = placeName(p);
    if (name && p.day) stays.set(name, (stays.get(name) ?? new Set()).add(p.day));
  }
  const devices = new Map<string, number>();
  for (const p of pool) if (p.device) devices.set(deviceLabel(p.device, aliases), (devices.get(deviceLabel(p.device, aliases)) ?? 0) + 1);
  const days = [...new Set(pool.map((p) => p.day).filter(Boolean))].sort() as string[];
  const rank = (p: RecapPicture) => (p.fav ? 4 : 0) + (p.picked ? 2 : 0) + (p.stars ?? 0) / 5;
  return {
    title: doc.title,
    template: doc.template,
    period: days.length ? { from: days[0], to: days[days.length - 1] } : null,
    days: resolved.days,
    pictures: pool.filter((p) => p.kind === 'photo').length,
    videos: pool.filter((p) => p.kind === 'video').length,
    places: {
      mostVisited: words.place,
      route: words.route,
      stays: [...stays.entries()].map(([place, d]) => {
        const sorted = [...d].sort();
        return { place, days: d.size, from: sorted[0], to: sorted[sorted.length - 1] };
      }).sort((a, b) => a.from.localeCompare(b.from)),
    },
    devices: [...devices.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    shown: [...shown]
      .sort((a, b) => rank(b) - rank(a))
      .slice(0, 16)
      .map((p) => ({ key: p.key, day: p.day ?? null, place: placeName(p), kind: p.kind, ...(p.fav ? { fav: true } : {}), ...(p.picked ? { picked: true } : {}), ...(p.stars ? { stars: p.stars } : {}) })),
    words: captionWords(doc, resolved),
    caption: { template: doc.publish.caption ?? DEFAULT_CAPTION, text: captionText(doc, resolved), approved: doc.publish.approved, custom: doc.publish.caption !== null },
  };
}

/**
 * When an agent's post goes out: `next` (or nothing) — the rhythm's next free
 * slot; `now`; `draft`; or a time — with a zone (`…Z`, `+01:00`), or a wall
 * clock `YYYY-MM-DDTHH:MM` read in the rhythm's zone. Never in the past.
 */
export function scheduleTarget(raw: unknown, rhythm: Rhythm, planned: readonly Date[], now: Date = new Date()): { at: Date | 'now' | 'draft' } | { error: string } {
  if (raw === undefined || raw === null || raw === 'next') {
    const free = nextFreeSlot(rhythm, planned, now);
    return free ? { at: free } : { error: 'no free slot of the rhythm in the next weeks — give a time, "now" or "draft"' };
  }
  if (raw === 'now' || raw === 'draft') return { at: raw };
  if (typeof raw !== 'string') return { error: 'at is "next", "now", "draft" or a time (YYYY-MM-DDTHH:MM, in the rhythm’s zone, or ISO with its zone)' };
  const wall = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})$/.exec(raw);
  const at = wall ? zonedInstant(Number(wall[1]), Number(wall[2]), Number(wall[3]), Number(wall[4]), Number(wall[5]), rhythm.timeZone) : new Date(raw);
  if (Number.isNaN(at.getTime())) return { error: `"${raw}" is not a time — YYYY-MM-DDTHH:MM in ${rhythm.timeZone}, or ISO with its zone` };
  if (at.getTime() < now.getTime() + 60_000) return { error: `${raw} is past — "now" publishes at once` };
  return { at };
}

export interface PoolQuery {
  /** One day, or a span `from`–`to` (YYYY-MM-DD). */
  day?: string;
  from?: string;
  to?: string;
  /** A part of the place's name (town, region or country), case aside. */
  place?: string;
  fav?: boolean;
  picked?: boolean;
  minStars?: number;
  kind?: 'photo' | 'video';
  /** A part of the camera's name, as recap.get says it. */
  device?: string;
  /** Only what the recap shows, or only what it does not. */
  shown?: boolean;
  limit?: number;
  offset?: number;
}

/** The Winnow asset id a picture's key carries (`w:<instance>:<id>`), or null for a local file. */
export const winnowIdOf = (key: string): number | null => {
  const m = /^w:[^:]+:(\d+)$/.exec(key);
  return m ? Number(m[1]) : null;
};

/**
 * The recap's POOL as an agent browses it (his ask, 2026-11-09): every
 * picture it holds, not only those shown — filtered by day, place, ♥, pick,
 * stars, kind, camera, shown or not — each with its key (what `recap.pin` and
 * `recap.choose` take), its Winnow id, and where it shows. In time order.
 */
export function poolList(doc: RecapDoc, resolved: ResolvedRecap, q: PoolQuery, aliases: DeviceAliases = {}) {
  const where = new Map<string, string[]>();
  for (const s of resolved.slots) if (s.picture) where.set(s.picture.key, [...(where.get(s.picture.key) ?? []), s.id]);
  const from = q.day ?? q.from;
  const to = q.day ?? q.to;
  const place = q.place?.trim().toLowerCase();
  const device = q.device?.trim().toLowerCase();
  const all = doc.pictures
    .filter((p) => !p.loose)
    .filter((p) => (!from || (p.day ?? '') >= from) && (!to || (p.day ?? '') <= to))
    .filter((p) => !place || [p.place, p.region, p.country].some((v) => v?.toLowerCase().includes(place)))
    .filter((p) => q.fav === undefined || Boolean(p.fav) === q.fav)
    .filter((p) => q.picked === undefined || Boolean(p.picked) === q.picked)
    .filter((p) => q.minStars === undefined || (p.stars ?? 0) >= q.minStars)
    .filter((p) => !q.kind || p.kind === q.kind)
    .filter((p) => !device || (p.device ? deviceLabel(p.device, aliases).toLowerCase().includes(device) || p.device.toLowerCase().includes(device) : false))
    .filter((p) => q.shown === undefined || where.has(p.key) === q.shown)
    .sort((a, b) => `${a.day ?? ''}${String(a.second ?? (a.minute ?? 0) * 60).padStart(5, '0')}`.localeCompare(`${b.day ?? ''}${String(b.second ?? (b.minute ?? 0) * 60).padStart(5, '0')}`));
  const offset = q.offset ?? 0;
  const limit = q.limit ?? 100;
  return {
    total: doc.pictures.filter((p) => !p.loose).length,
    matching: all.length,
    offset,
    pictures: all.slice(offset, offset + limit).map((p) => ({
      key: p.key,
      ...(winnowIdOf(p.key) !== null ? { winnowId: winnowIdOf(p.key) } : {}),
      name: p.name,
      kind: p.kind,
      day: p.day ?? null,
      ...(p.minute !== undefined ? { time: `${Math.floor(p.minute / 60)}:${String(p.minute % 60).padStart(2, '0')}` } : {}),
      ...(placeName(p) ? { place: placeName(p) } : {}),
      ...(p.device ? { device: deviceLabel(p.device, aliases) } : {}),
      ...(p.fav ? { fav: true } : {}),
      ...(p.picked ? { picked: true } : {}),
      ...(p.stars ? { stars: p.stars } : {}),
      ...(where.has(p.key) ? { shownOn: where.get(p.key) } : {}),
    })),
  };
}

/**
 * The carousel set to exactly these pictures, in this order (`recap.choose`):
 * a FROZEN selection, like a hand-made one — nothing comes in or moves by
 * itself after. Refused, with the reason, when the recap has no carousel of
 * pictures, a key is not in its pool, or a key is twice.
 */
export function chooseCarousel(doc: RecapDoc, keys: readonly string[]): { ok: true; doc: RecapDoc } | { ok: false; error: string } {
  if (!(doc.template === 'dump' || doc.template === 'sheets' || (doc.carousel.after === 'highlights' && doc.template !== 'wrapped'))) {
    return { ok: false, error: `this ${doc.template} recap has no carousel of pictures — a month's is its highlights (recap.set carousel.after: "highlights"), a dump's and a sheet's are their pictures` };
  }
  if (!keys.length) return { ok: false, error: 'give one key at least — recap.pool lists them' };
  const pool = new Set(doc.pictures.filter((p) => !p.loose).map((p) => p.key));
  const missing = keys.filter((k) => !pool.has(k));
  if (missing.length) return { ok: false, error: `not in this recap's pool: ${missing.slice(0, 5).join(', ')}${missing.length > 5 ? '…' : ''} — recap.add brings a Winnow picture in` };
  const twice = keys.filter((k, i) => keys.indexOf(k) !== i);
  if (twice.length) return { ok: false, error: `twice: ${[...new Set(twice)].join(', ')}` };
  return { ok: true, doc: withRecap(doc, { carousel: { ...doc.carousel, chosen: [...keys], left: doc.carousel.left.filter((k) => !keys.includes(k)) } }) };
}

/**
 * The accounts an agent's post goes out on (lab 18): `["all"]`, or each a
 * network (`"tiktok"` — every account of it), an account's id, or its name
 * (case aside; a part of it when only one account holds it). Nothing given:
 * `fallback`, the accounts the person's last send of this template went to.
 */
export function pickChannels<C extends { id: string; name: string; identifier: string }>(raw: unknown, channels: readonly C[], fallback: readonly string[]): { channels: C[] } | { error: string } {
  const listed = () => channels.map((c) => `"${c.name}" (${networkOf(c.identifier)?.label ?? c.identifier})`).join(', ') || 'none';
  if (raw === undefined || raw === null) {
    const kept = channels.filter((c) => fallback.includes(c.id));
    return kept.length ? { channels: kept } : { error: `no account to post to — say which with on: ${listed()}` };
  }
  if (!Array.isArray(raw) || !raw.length || raw.some((x) => typeof x !== 'string')) return { error: 'on is a list: ["all"], networks ("instagram", "tiktok"…) or accounts by name' };
  const out: C[] = [];
  for (const want of raw as string[]) {
    const w = want.trim().toLowerCase();
    const hits =
      w === 'all'
        ? [...channels]
        : (() => {
            const exact = channels.filter((c) => c.id === want || c.name.toLowerCase() === w || networkOf(c.identifier)?.id === w || networkOf(c.identifier)?.label.toLowerCase() === w || c.identifier.toLowerCase() === w);
            if (exact.length) return exact;
            const part = channels.filter((c) => c.name.toLowerCase().includes(w));
            return part.length === 1 ? part : [];
          })();
    if (!hits.length) return { error: `no account "${want}" — there are: ${listed()}` };
    for (const c of hits) if (!out.includes(c)) out.push(c);
  }
  return { channels: out };
}
