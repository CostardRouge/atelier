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

import { readRecapDoc, withRecap, type RecapDoc } from './recap-doc';
import { deviceLabel, type DeviceAliases, type ResolvedRecap } from './recap-slots';

/** The settings an agent may set, and what each holds. */
export const SETTABLE: Record<string, string> = {
  format: '"story" (9:16), "portrait" (4:5) or "square" (1:1)',
  grid: 'a grid’s shape: "2x2", "3x3", "bento" or "hero"',
  count: 'a dump’s pictures, 1–60',
  rungs: 'on this day’s steps back, e.g. ["1y","1m","1w","0d"]',
  range: 'a grid’s, single’s or dump’s period {from, to} (YYYY-MM-DD)',
  filter: '{devices: [camera models], kinds: "all" | "photo" | "video"}',
  heading: '{text, show} — text may hold {month} {year} {week} {date} {from} {to} {count} {days} {videos}',
  subheading: '{text, show}',
  cta: '{text, show} — the call to action',
  font: '"sans", "serif" or "mono"',
  headingOffset: '{x, y}, fractions of the page, −0.5…0.5',
  cells: '{number, count, exif, device, caption, videoBadge, today, headers: booleans; empty: "number"|"dashed"|"hidden"; weekStart: 0|1; gap: 0–0.04; radius: 0–0.25; shadow: 0–1 (0 = none); shadowBlur: 0–0.5; shadowY: 0–0.25; numberAt: "topLeft"|"topRight"|"centre"|"bottomLeft"; exifParts: the camera settings the line says, a list in this order: "device","lens","focal","aperture","shutter","iso"; arrange: "auto"|"line"|"stack" (words never pass their cell)}',
  sheet: '{arrangement: "rows"|"collage"|"film"|"timeline"; slides: 2–10 or null (counted from the pictures); camera: "stops"|"glide" (the Reel along the sheet)} — the Sheets template only; the cut rule (no face across a cut, one picture per cut) is fixed',
  carousel: '{after: "none"|"highlights"|"weeks" (weeks: a month only; a dump and a sheet are highlights already); highlights: 1–60; rules: {leave: {screen|burst|alike: false to keep them}, prefer: ["pick","stars","edited","faces","sharp"] in order}; picksOnly: true|false|null (null = picks when they fill the places); chosen: picture keys of a FROZEN selection (null = the rule chooses) — removing a key removes the picture, nothing comes in; left: removed keys; burstPick: {burstId: key}; layouts: {"p:0": "full"|"two"|"oneTwo"|"three"|"four"|"six"} a flow slide set by hand; order: slide keys ("first", "p:0", "w:1", "clip:<slot>") or null; titles: "first"|"head"|"same" — the first slide\'s title on the others}',
  delivery: '{quality: "standard"|"high"|"max" (≈8, 16, 28 Mb/s at 1080×1920 30 fps); fps: 30|60; passes: 1|2 (2 = measured two-pass, where the browser\'s encoder has a constant-quality mode, else one VBR pass); media: "proxy"|"original" (painted from the originals: every clip, the background first, and every picture a print would blow up — fetched for the export)}',
  motion: '{title: "none"|"fade"|"rise"|"type"|"mask"; order: "inOrder"|"random"|"wave"|"columns"|"spiral"; entrance: "none"|"fade"|"slide"|"pop"|"drop"|"develop"|"flicker"; stagger: 0–1 s; hold: 0.5–30 s; videos: "turn"|"zoom"|"together"|"poster"; seed}',
  background: '{kind: "paper"|"ink"|"colour"|"blur"|"video"; colour: "#rrggbb"; loopIn, loopOut (s); speed: 0.25–2; veil: 0–0.8; blur: 0–160; frame: {x, y: 0–1 the focus, zoom: 1–4, rotate: −45–45 degrees}}',
  clipSlides: 'true: each clip gets a carousel slide of its own and its cell says which',
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

/** The recap as an agent reads it: what it is about, its settings, and every slot with what it shows. */
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
    motion: doc.motion,
    background: { ...doc.background },
    sound: doc.sound,
    look: doc.look ? doc.look.layers.map((l) => l.name) : null,
    clipSlides: doc.clipSlides,
  };
}
