/**
 * What an agent can READ of the connected Winnow before it acts
 * (`shared/commands/`): which days and folders hold media, a day's rows with
 * Winnow's own culling, EXIF and position, and a contact sheet of thumbnails
 * to choose from by eye. Registered by the shell for the whole session; every
 * command is `unavailable` while no instance is connected.
 *
 * Read only, like the rest of Atelier's Winnow client: culling is Winnow's,
 * and writing a verdict or a star is Winnow's own MCP's job, never this one's.
 *
 * The arithmetic (`readAssetQuery`, `rowSummary`) is pure; the specs take the
 * connection through a getter and the drawing through an injected function.
 */

import { CommandError, type CommandSpec, type ImageResult } from '../../commands/registry';
import { SHEET_MAX } from '../../commands/contact-sheet';
import { VERDICTS, filterRows, readDay, type RowFilter } from '../../develop/ingest-commands';
import { cullingFromRow, type Verdict } from './culling';
import type { AssetQuery, WinnowAssetRow, WinnowClient, WinnowPerson } from './client';
import type { WinnowConnection } from './store';
import { monthSpan } from './month';

/** How many rows a listing may ask for at most — the client's own cap. */
export const MAX_ROWS = 2000;

/** The query and the Atelier-side filter a listing command reads from its params. */
export interface AssetAsk {
  query: AssetQuery;
  filter: RowFilter;
}

/** Params shared by the commands that list a day's media. */
export const ASSET_QUERY_PARAMS = {
  date: { type: 'string', description: 'The day, YYYY-MM-DD (the first of a span with dateTo). Needed unless folder is given.', optional: true },
  dateTo: { type: 'string', description: 'The span’s last day, YYYY-MM-DD; the same day when absent.', optional: true },
  folder: { type: 'number', description: 'A Winnow folder (session) id, from winnow.folders.', integer: true, min: 1, optional: true },
  verdict: { type: 'string', description: 'Only this Winnow verdict.', enum: VERDICTS, optional: true },
  minStars: { type: 'number', description: 'At least this many stars.', min: 0, max: 5, integer: true, optional: true },
  label: { type: 'string', description: 'Only this colour label (red, yellow, green, blue, purple).', optional: true },
  tag: { type: 'string', description: 'Only media carrying this Winnow tag.', optional: true },
  media: { type: 'string', description: 'photo or video; both when absent.', enum: ['photo', 'video'], optional: true },
  half: { type: 'string', description: 'incoming (still to cull) or final (the Gallery); both when absent.', enum: ['incoming', 'final'], optional: true },
  people: { type: 'numbers', description: 'Only media showing these people (ids from winnow.people).', integer: true, min: 1, maxItems: 20, optional: true },
  who: { type: 'strings', description: 'The same by NAME, as Winnow names them (case aside; a unique part of a name is enough).', optional: true },
  together: { type: 'boolean', description: 'With several people: only media where they are ALL in frame (otherwise any of them).', optional: true },
  faces: { type: 'string', description: 'none (no face found — landscapes, details), any, solo (exactly one face) or group (two or more).', enum: ['none', 'any', 'solo', 'group'], optional: true },
} as const;

/** Face counts a "group" covers: a crowd past this is still a group, and the list stays a query string. */
const GROUP_COUNTS = Array.from({ length: 29 }, (_, i) => i + 2);

/** The listing params read and checked; a span or a folder is required. */
export function readAssetQuery(p: Record<string, unknown>): AssetAsk {
  const query: AssetQuery = {};
  if (p.date !== undefined) {
    const from = readDay('date', p.date);
    const to = p.dateTo === undefined ? from : readDay('dateTo', p.dateTo);
    if (to < from) throw new CommandError('invalid', 'dateTo comes before date');
    query.dateFrom = from;
    query.dateTo = to;
  } else if (p.dateTo !== undefined) {
    throw new CommandError('invalid', 'dateTo needs a date');
  }
  if (typeof p.folder === 'number') query.sessionId = p.folder;
  // The culling is asked of the server too (the rows are still filtered
  // here, which an instance that ignores a key cannot fool). The tag is not:
  // Winnow matches tags case and all, where an agent's "sunset" should find
  // "Sunset".
  if (typeof p.verdict === 'string') query.verdict = p.verdict as Verdict;
  if (typeof p.minStars === 'number' && p.minStars > 0) query.minStars = p.minStars;
  if (Array.isArray(p.people)) query.people = p.people as number[];
  if (p.together === true) query.together = true;
  if (p.faces === 'none') query.hasFaces = false;
  else if (p.faces === 'any') query.hasFaces = true;
  else if (p.faces === 'solo') query.faceCount = [1];
  else if (p.faces === 'group') query.faceCount = GROUP_COUNTS;
  // A person is a scope of its own: "every photo of Lucie" needs no day.
  if (!query.dateFrom && query.sessionId === undefined && !query.people?.length && !Array.isArray(p.who)) {
    throw new CommandError('invalid', 'give a date (YYYY-MM-DD), a folder id, or people');
  }
  if (p.half === 'incoming' || p.half === 'final') query.half = p.half;
  if (p.media === 'photo' || p.media === 'video') query.mediaType = p.media;
  const filter: RowFilter = {};
  if (typeof p.verdict === 'string') filter.verdict = p.verdict as Verdict;
  if (typeof p.minStars === 'number') filter.minStars = p.minStars;
  if (typeof p.label === 'string' && p.label.trim()) filter.label = p.label.trim();
  if (typeof p.tag === 'string' && p.tag.trim()) filter.tag = p.tag.trim();
  if (p.media === 'photo' || p.media === 'video') filter.media = p.media;
  return { query, filter };
}

/**
 * People named by an agent, as ids: a name matches case aside, exactly, or by
 * a part of it no other person's name shares. Ambiguous and unknown names are
 * refused naming the candidates — a wrong person's photos are the one answer
 * worse than none.
 */
export function resolveWho(names: readonly string[], people: readonly WinnowPerson[]): number[] {
  const named = people.filter((x) => !x.hidden && x.name?.trim());
  return names.map((raw) => {
    const want = raw.trim().toLowerCase();
    if (!want) throw new CommandError('invalid', 'a name in who is empty');
    const exact = named.filter((x) => x.name!.trim().toLowerCase() === want);
    const hits = exact.length ? exact : named.filter((x) => x.name!.toLowerCase().includes(want));
    if (hits.length === 1) return hits[0].id;
    const list = (xs: readonly WinnowPerson[]) => xs.slice(0, 8).map((x) => `"${x.name}" (#${x.id})`).join(', ');
    if (hits.length > 1) throw new CommandError('invalid', `"${raw}" names ${hits.length} people — ${list(hits)}; give people ids instead`);
    throw new CommandError(
      'invalid',
      named.length ? `nobody is named "${raw}" — the named people are ${list(named)}${named.length > 8 ? '…' : ''} (winnow.people lists them all)` : 'nobody is named on this Winnow yet — name people there, or use their ids from winnow.people',
    );
  });
}

/** The listing params read, with any `who` resolved against the instance's people. */
export async function askFromParams(client: WinnowClient, p: Record<string, unknown>): Promise<AssetAsk> {
  const ask = readAssetQuery(p);
  if (Array.isArray(p.who) && p.who.length) {
    const ids = resolveWho(p.who as string[], await client.people());
    ask.query.people = [...new Set([...(ask.query.people ?? []), ...ids])];
  }
  return ask;
}

/** A person as an agent reads them. */
export function personSummary(x: WinnowPerson) {
  return {
    id: x.id,
    name: x.name ?? null,
    media: x.asset_count,
    ...(x.incoming_asset_count !== undefined ? { incoming: x.incoming_asset_count } : {}),
    ...(x.gallery_asset_count !== undefined ? { gallery: x.gallery_asset_count } : {}),
  };
}

/** A row as an agent reads it: what to choose by, nothing a person never sees. */
export interface RowSummary {
  id: number;
  file: string;
  kind: 'photo' | 'video';
  /** The capture instant, ISO, or null when the file had no date. */
  at: string | null;
  day: string | null;
  camera: string | null;
  lens: string | null;
  /** `1/240 · ƒ2.8 · ISO 100 · 24 mm`, from what Winnow read at ingest; null when it read none. */
  exposure: string | null;
  size: string | null;
  duration: number | null;
  gps: [number, number] | null;
  verdict: Verdict;
  stars: number;
  label: string | null;
  tags: string[];
  /** How many faces Winnow found; absent until the medium is analysed. */
  faces?: number;
  /** How many frames a burst pile folds under this cover; absent for a single shot. */
  burst?: number;
  /** The capture's other file (a RAW behind this JPEG, a live photo's clip). */
  companion?: string;
  folder: number | null;
}

export function rowSummary(row: WinnowAssetRow): RowSummary {
  const c = cullingFromRow(row) ?? { verdict: 'unrated' as Verdict, star: 0, color: null };
  const exposure = [
    row.shutter ? `${row.shutter}${/s$/.test(row.shutter) ? '' : ' s'}` : null,
    row.aperture ? `ƒ${row.aperture}` : null,
    row.iso ? `ISO ${row.iso}` : null,
    row.focal_length ? `${row.focal_length} mm` : null,
  ].filter(Boolean);
  return {
    id: row.id,
    file: row.filename,
    kind: row.media_type,
    at: row.captured_at,
    day: row.capture_date,
    camera: row.camera_model,
    lens: row.lens,
    exposure: exposure.length ? exposure.join(' · ') : null,
    size: row.width && row.height ? `${row.width} × ${row.height}` : null,
    duration: row.media_type === 'video' ? row.duration_s : null,
    gps: row.gps_lat !== null && row.gps_lon !== null ? [row.gps_lat, row.gps_lon] : null,
    verdict: c.verdict,
    stars: c.star,
    label: c.color,
    tags: row.tags ?? [],
    ...(row.burst_count && row.burst_count > 1 ? { burst: row.burst_count } : {}),
    ...(row.companion_ext ? { companion: `${row.group_kind === 'live_photo' ? 'live photo' : 'pair'} · .${row.companion_ext.replace(/^\./, '')}` } : {}),
    folder: row.session_id,
    ...(typeof row.face_count === 'number' ? { faces: row.face_count } : {}),
  };
}

/** The culling words a sheet writes under a thumbnail: `pick ★4 red`, or nothing for unrated. */
export function cullingMark(row: WinnowAssetRow): string | undefined {
  const c = cullingFromRow(row);
  if (!c) return undefined;
  const words = [c.verdict !== 'unrated' ? c.verdict : null, c.star > 0 ? `★${c.star}` : null, c.color].filter(Boolean);
  return words.length ? words.join(' ') : undefined;
}

/** `YYYY-MM`, or refused. */
function readMonth(raw: unknown): string {
  if (typeof raw !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(raw)) throw new CommandError('invalid', 'month must be YYYY-MM');
  return raw;
}

export interface WinnowCommandDeps {
  winnow: () => { client: WinnowClient | null; connection: WinnowConnection | null };
  /** Draw a contact sheet (`contact-sheet-image.ts`). */
  sheet: (items: { image: Blob | null; label: string; mark?: string }[], note: string) => Promise<ImageResult>;
}

export function winnowCommands(deps: WinnowCommandDeps): CommandSpec[] {
  const connected = () => (deps.winnow().client ? true : 'no Winnow is connected — connect one on #/sources');
  const client = (): WinnowClient => {
    const c = deps.winnow().client;
    if (!c) throw new CommandError('unavailable', 'no Winnow is connected');
    return c;
  };
  const list = async (ask: AssetAsk, cap: number) => {
    // `who` was resolved by `askFromParams` before this is called.
    const rows = await client().allAssets(ask.query, MAX_ROWS);
    const kept = filterRows(rows, ask.filter);
    return { rows, kept: kept.slice(0, cap), matched: kept.length, capped: rows.length >= MAX_ROWS };
  };
  return [
    {
      id: 'winnow.status',
      title: 'The connected Winnow',
      description: 'Which Winnow instance this tab reads (its address and the account), or why none answers. Winnow is where the person culls; Atelier reads it and never writes a verdict.',
      available: connected,
      run: async () => {
        const { connection } = deps.winnow();
        const caps = await client().capabilities();
        return { instance: connection?.baseUrl ?? null, user: caps.viewer?.username ?? null, role: caps.viewer?.role ?? null };
      },
    },
    {
      id: 'winnow.calendar',
      title: 'Which days hold media',
      description: 'The days of a month (or a span) that hold media on the connected Winnow, with how many each — a RAW + JPEG pair counted once. Days with nothing are left out.',
      params: {
        month: { type: 'string', description: 'YYYY-MM. Or give from and to.', optional: true },
        from: { type: 'string', description: 'First day, YYYY-MM-DD.', optional: true },
        to: { type: 'string', description: 'Last day, YYYY-MM-DD.', optional: true },
        media: { type: 'string', description: 'photo or video; both when absent.', enum: ['photo', 'video'], optional: true },
        half: { type: 'string', description: 'incoming or final; both when absent.', enum: ['incoming', 'final'], optional: true },
      },
      available: connected,
      run: async (p) => {
        let from: string;
        let to: string;
        if (p.month !== undefined) {
          const span = monthSpan(readMonth(p.month));
          from = span.from;
          to = span.to;
        } else {
          from = readDay('from', p.from);
          to = readDay('to', p.to);
          if (to < from) throw new CommandError('invalid', 'to comes before from');
        }
        const cal = await client().calendar(from, to, {
          ...(p.media ? { mediaType: p.media as 'photo' | 'video' } : {}),
          ...(p.half ? { half: p.half as 'incoming' | 'final' } : {}),
        });
        const days = cal.days.filter((d) => d.count > 0).map((d) => ({ date: d.date, count: d.count }));
        return { from, to, days, total: days.reduce((n, d) => n + d.count, 0), library: cal.bounds };
      },
    },
    {
      id: 'winnow.folders',
      title: 'The folders',
      description: 'Winnow’s folders (shoot sessions) — id, name, the span they were shot over, how many media, whether culling is done — most recent first, those overlapping a span when one is given.',
      params: {
        from: { type: 'string', description: 'Only folders shot on or after this day, YYYY-MM-DD.', optional: true },
        to: { type: 'string', description: 'Only folders shot on or before this day, YYYY-MM-DD.', optional: true },
      },
      available: connected,
      run: async (p) => {
        const from = p.from === undefined ? null : readDay('from', p.from);
        const to = p.to === undefined ? null : readDay('to', p.to);
        const folders = (await client().sessions())
          .filter((s) => (!from || (s.captured_at_max ?? '') >= from) && (!to || (s.captured_at_min ?? '9') <= `${to}T23:59:59`))
          .map((s) => ({
            id: s.id,
            name: s.name,
            from: s.captured_at_min?.slice(0, 10) ?? null,
            to: s.captured_at_max?.slice(0, 10) ?? null,
            count: s.asset_count,
            status: s.status,
          }));
        return { folders };
      },
    },
    {
      id: 'winnow.assets',
      title: 'List a day’s media',
      description:
        'The media of a day, a span, a folder or a PERSON on the connected Winnow, narrowed by its own culling (verdict, stars, colour label, tag), by who is in them (people, who, together) or how many faces (faces), and by kind: id, file, capture time, camera, lens, exposure, size, GPS, verdict, stars, tags, burst and paired file. Bursts count as their cover. Look at them with winnow.sheet; add the ones chosen with develop.addFromWinnow {ids}.',
      params: {
        ...ASSET_QUERY_PARAMS,
        limit: { type: 'number', description: 'At most this many rows; 200 when absent.', integer: true, min: 1, max: MAX_ROWS, optional: true },
      },
      available: connected,
      run: async (p) => {
        const got = await list(await askFromParams(client(), p), typeof p.limit === 'number' ? p.limit : 200);
        return {
          listed: got.rows.length,
          matched: got.matched,
          shown: got.kept.length,
          ...(got.capped ? { warning: `the listing stopped at ${MAX_ROWS} rows — narrow the span` } : {}),
          rows: got.kept.map(rowSummary),
        };
      },
    },
    {
      id: 'winnow.people',
      title: 'The people',
      description:
        'The people Winnow’s face analysis grouped — named first, then those in the most media — with how many media show each. Their ids (or names, through who) narrow winnow.assets, winnow.sheet and develop.addFromWinnow. Look at their faces with winnow.peopleSheet. Naming and merging people is done in Winnow (its own MCP: people.name, people.merge).',
      params: {
        named: { type: 'boolean', description: 'Only people who have a name.', optional: true },
        search: { type: 'string', description: 'Only people whose name contains this.', optional: true },
        limit: { type: 'number', description: 'At most this many; 50 when absent.', integer: true, min: 1, max: 500, optional: true },
      },
      available: connected,
      run: async (p) => {
        const want = typeof p.search === 'string' ? p.search.trim().toLowerCase() : '';
        const people = (await client().people()).filter(
          (x) => !x.hidden && (p.named !== true || Boolean(x.name?.trim())) && (!want || Boolean(x.name?.toLowerCase().includes(want))),
        );
        const limit = typeof p.limit === 'number' ? p.limit : 50;
        return { total: people.length, shown: Math.min(limit, people.length), people: people.slice(0, limit).map(personSummary) };
      },
    },
    {
      id: 'winnow.peopleSheet',
      title: 'Look at the people',
      description: `One image of the people's faces — each person's cover face, labelled "#id name" — to see who is who before filtering by them. Either people ids (at most ${SHEET_MAX}), or a page of everyone (named first).`,
      params: {
        people: { type: 'numbers', description: `Person ids, at most ${SHEET_MAX}.`, integer: true, min: 1, maxItems: SHEET_MAX, optional: true },
        named: { type: 'boolean', description: 'Only people who have a name.', optional: true },
        page: { type: 'number', description: 'Which page, from 1.', integer: true, min: 1, optional: true },
      },
      available: connected,
      run: async (p) => {
        const c = client();
        const everyone = (await c.people()).filter((x) => !x.hidden && (p.named !== true || Boolean(x.name?.trim())));
        let shown: WinnowPerson[];
        let note: string;
        if (Array.isArray(p.people)) {
          const ids = p.people as number[];
          shown = ids.flatMap((id) => everyone.filter((x) => x.id === id));
          const missing = ids.filter((id) => !shown.some((x) => x.id === id));
          note = `${shown.length} people${missing.length ? ` · not found: ${missing.join(', ')}` : ''}`;
        } else {
          const pages = Math.max(1, Math.ceil(everyone.length / SHEET_MAX));
          const page = Math.min(typeof p.page === 'number' ? p.page : 1, pages);
          shown = everyone.slice((page - 1) * SHEET_MAX, page * SHEET_MAX);
          note = `page ${page} of ${pages} · ${everyone.length} people`;
        }
        if (shown.length === 0) throw new CommandError('invalid', 'nobody to show — this Winnow has grouped no faces yet');
        const images = await Promise.all(
          shown.map((x) =>
            x.cover_face_id === null
              ? null
              : c.fetchFile(c.faceThumbUrl(x.cover_face_id), `face-${x.cover_face_id}.webp`, 'image/webp', 0).catch(() => null),
          ),
        );
        return deps.sheet(
          shown.map((x, i) => ({ image: images[i], label: `#${x.id} ${x.name ?? ''}`.trim(), mark: `${x.asset_count}` })),
          `${note} · labels are person ids and names, the number how many media show them`,
        );
      },
    },
    {
      id: 'winnow.faces',
      title: 'Who is in one medium',
      description: 'The faces Winnow found in one medium (best first): the person each belongs to (id and name, null while unnamed or ungrouped), how sure the detector was, and the box as fractions of the picture.',
      params: { id: { type: 'number', description: 'The asset id.', integer: true, min: 1 } },
      available: connected,
      run: async (p) => {
        const faces = await client().assetFaces(p.id as number);
        const r3 = (v: number) => Math.round(v * 1000) / 1000;
        return {
          asset: p.id,
          faces: faces.map((f) => ({
            person: f.person_id,
            name: f.person_name,
            score: r3(f.score),
            box: f.img_width > 0 && f.img_height > 0 ? [r3(f.x1 / f.img_width), r3(f.y1 / f.img_height), r3(f.x2 / f.img_width), r3(f.y2 / f.img_height)] : null,
          })),
        };
      },
    },
    {
      id: 'winnow.sheet',
      title: 'Look at media as a contact sheet',
      description: `One image of thumbnails as Winnow made them (as shot, never graded), each labelled with its id and its culling — to choose by eye before adding. Either ids (at most ${SHEET_MAX}), or the same filters as winnow.assets and a page of ${SHEET_MAX}.`,
      params: {
        ids: { type: 'numbers', description: `Asset ids, at most ${SHEET_MAX}.`, maxItems: SHEET_MAX, optional: true },
        ...ASSET_QUERY_PARAMS,
        page: { type: 'number', description: 'Which page of the listing, from 1.', integer: true, min: 1, optional: true },
      },
      available: connected,
      run: async (p) => {
        const c = client();
        let rows: WinnowAssetRow[];
        let note: string;
        if (Array.isArray(p.ids)) {
          rows = await c.assetsByIds(p.ids as number[]);
          const missing = (p.ids as number[]).filter((id) => !rows.some((r) => r.id === id));
          note = `${rows.length} media${missing.length ? ` · not found: ${missing.join(', ')}` : ''}`;
        } else {
          const got = await list(await askFromParams(c, p), MAX_ROWS);
          const pages = Math.max(1, Math.ceil(got.kept.length / SHEET_MAX));
          const page = Math.min(typeof p.page === 'number' ? p.page : 1, pages);
          rows = got.kept.slice((page - 1) * SHEET_MAX, page * SHEET_MAX);
          note = `page ${page} of ${pages} · ${got.matched} matched`;
        }
        if (rows.length === 0) throw new CommandError('invalid', 'nothing to show — no media matched');
        const images = await Promise.all(
          rows.map((r) => c.fetchFile(c.thumbUrl(r.id), `${r.id}.jpg`, 'image/jpeg', 0).catch(() => null)),
        );
        return deps.sheet(
          rows.map((r, i) => ({ image: images[i], label: `#${r.id}`, mark: cullingMark(r) })),
          `${note} · labels are Winnow asset ids`,
        );
      },
    },
  ];
}
