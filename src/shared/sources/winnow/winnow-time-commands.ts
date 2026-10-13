/**
 * Finds in TIME and the SUM-UP (`shared/commands/`): this day in other
 * years, the first of each kind, the drone's flights, a span counted as
 * numbers or drawn as a card. The arithmetic is `firsts.ts`,
 * `telemetry/flight-summary.ts` and `stats.ts`, pure; the card is
 * `stats-card.ts`.
 */

import { CommandError, type CommandSpec } from '../../commands/registry';
import { readDay } from '../../develop/ingest-commands';
import { nearestCity } from '../../roadtrip/gazetteer';
import { gazetteerOrEmpty } from '../../roadtrip/load-gazetteer';
import { todayIso } from '../../roadtrip/trip-days';
import { flightSummary } from '../../telemetry/flight-summary';
import { parseSrt } from '../../telemetry/srt-parser';
import { gearOf } from './capture-moment';
import { firstsBy, sameDayAcrossYears, type KeyedItem } from './firsts';
import { fetchLog } from './materialize';
import { libraryStats, type LibraryStats } from './stats';
import { statsCardImage } from './stats-card';
import { ASSET_QUERY_PARAMS, askFromParams, keepAsk, winnowHost, type WinnowCommandDeps } from './winnow-commands';

/** How many rows a sum-up may read in one call: a hundred pages of Winnow's 200. */
export const STATS_MAX = 20_000;

const STATS_PARAMS = {
  year: { type: 'string', description: 'A whole year, YYYY. Or give from and to.', optional: true },
  from: { type: 'string', description: 'First day, YYYY-MM-DD.', optional: true },
  to: { type: 'string', description: 'Last day, YYYY-MM-DD.', optional: true },
  media: { type: 'string', description: 'photo or video; both when absent.', enum: ['photo', 'video'], optional: true },
  half: { type: 'string', description: 'incoming or final; both when absent.', enum: ['incoming', 'final'], optional: true },
} as const;

/** The span a sum-up covers, from `year` or `from`/`to`; refused when neither is whole. */
export function readStatsSpan(p: Record<string, unknown>): { from: string; to: string } {
  if (typeof p.year === 'string') {
    if (!/^\d{4}$/.test(p.year)) throw new CommandError('invalid', 'year must be YYYY');
    if (p.from !== undefined || p.to !== undefined) throw new CommandError('invalid', 'year or from/to, not both');
    return { from: `${p.year}-01-01`, to: `${p.year}-12-31` };
  }
  if (p.from === undefined || p.to === undefined) throw new CommandError('invalid', 'give a year (YYYY), or from and to (YYYY-MM-DD)');
  const from = readDay('from', p.from);
  const to = readDay('to', p.to);
  if (to < from) throw new CommandError('invalid', 'to comes before from');
  return { from, to };
}

export function winnowTimeCommands(deps: Pick<WinnowCommandDeps, 'winnow'>): CommandSpec[] {
  const { connected, client, sourceId, rowsFor } = winnowHost(deps);
  const statsFor = async (p: Record<string, unknown>): Promise<{ span: { from: string; to: string }; read: number; capped: boolean; stats: LibraryStats; people: { name: string; media: number }[]; peopleScope: 'library' }> => {
    const c = client();
    const span = readStatsSpan(p);
    const rows = await c.allAssets(
      {
        dateFrom: span.from,
        dateTo: span.to,
        ...(p.media === 'photo' || p.media === 'video' ? { mediaType: p.media } : {}),
        ...(p.half === 'incoming' || p.half === 'final' ? { half: p.half } : {}),
      },
      STATS_MAX,
    );
    const cities = rows.some((r) => r.gps_lat !== null) ? await gazetteerOrEmpty() : [];
    const stats = libraryStats(rows, (r) => (r.gps_lat !== null && r.gps_lon !== null ? (nearestCity(cities, { lat: r.gps_lat, lon: r.gps_lon }, 200)?.country ?? null) : null));
    const people = (await c.people().catch(() => []))
      .filter((x) => !x.hidden && x.name?.trim())
      .sort((a, b) => b.asset_count - a.asset_count)
      .slice(0, 10)
      .map((x) => ({ name: x.name!, media: x.asset_count }));
    return { span, read: rows.length, capped: rows.length >= STATS_MAX, stats, people, peopleScope: 'library' };
  };
  return [
    {
      id: 'winnow.onThisDay',
      title: 'This day in other years',
      description: 'The same calendar day across the years the library spans — which other years hold media on it and how many — for an anniversary piece or a "one year ago" post. Today when no date is given.',
      params: {
        date: { type: 'string', description: 'The day, YYYY-MM-DD; today when absent.', optional: true },
        media: { type: 'string', description: 'photo or video; both when absent.', enum: ['photo', 'video'], optional: true },
      },
      available: connected,
      run: async (p) => {
        const date = p.date === undefined ? todayIso() : readDay('date', p.date);
        const cal = await client().calendar('1970-01-01', `${new Date().getUTCFullYear() + 1}-12-31`, p.media ? { mediaType: p.media as 'photo' | 'video' } : {});
        const years = sameDayAcrossYears(cal.days, date);
        return { date, library: cal.bounds, years: years.map(({ date: d, count }) => ({ date: d, count })), total: years.reduce((n, d) => n + d.count, 0) };
      },
    },
    {
      id: 'winnow.firsts',
      title: 'The first of each kind',
      description:
        'The FIRST frame of each kind of thing in a span: by country (from the GPS, named offline — a frame with none says no country), by gear (drone, phone, action, camera), by camera (the body’s model) or by person (the earliest frame showing each named person). Each first with its id, its instant and how many frames share that key. Over the same listing as winnow.assets; a span is bounded by the listing cap, so ask a year month by month if it is big.',
      params: {
        kind: { type: 'string', description: 'country, gear, camera or person.', enum: ['country', 'gear', 'camera', 'person'] },
        ...ASSET_QUERY_PARAMS,
      },
      available: connected,
      run: async (p) => {
        const c = client();
        if (p.kind === 'person') {
          const people = (await c.people()).filter((x) => !x.hidden && x.name?.trim()).slice(0, 40);
          const firsts = await Promise.all(
            people.map(async (person) => {
              const ask = await askFromParams(c, { ...p, kind: undefined, people: [person.id] });
              const rows = (await keepAsk(c, sourceId(), await c.allAssets(ask.query, 1), ask)).kept;
              const row = rows.find((r) => r.captured_at);
              return row ? { key: person.name!, id: row.id, at: row.captured_at!, count: person.asset_count } : null;
            }),
          );
          return { kind: 'person', firsts: firsts.filter((x) => x !== null).sort((a, b) => (a!.at < b!.at ? -1 : 1)) };
        }
        const rows = await rowsFor({ ...p, kind: undefined });
        const cities = p.kind === 'country' ? await gazetteerOrEmpty() : [];
        const items: KeyedItem[] = rows.map((r) => ({
          id: r.id,
          at: r.captured_at,
          key:
            p.kind === 'country'
              ? r.gps_lat !== null && r.gps_lon !== null
                ? (nearestCity(cities, { lat: r.gps_lat, lon: r.gps_lon }, 200)?.country ?? null)
                : null
              : p.kind === 'gear'
                ? gearOf(r)
                : r.camera_model,
        }));
        const firsts = firstsBy(items);
        const byId = new Map(rows.map((r) => [r.id, r]));
        return {
          kind: p.kind,
          looked: rows.length,
          unkeyed: items.filter((i) => i.key === null).length,
          firsts: firsts.map((f) => ({ ...f, file: byId.get(f.id)?.filename ?? null })),
        };
      },
    },
    {
      id: 'winnow.flights',
      title: 'The drone’s flights',
      description:
        'The flights behind a listing’s clips, read from the DJI .srt logs Winnow keeps beside them: seconds flown, kilometres over the ground, the highest point above take-off, where it took off. Only clips with a log answer; 20 logs a call at most (each is a download).',
      params: ASSET_QUERY_PARAMS,
      available: connected,
      run: async (p) => {
        const c = client();
        const rows = (await rowsFor(p)).filter((r) => r.media_type === 'video' && r.sidecars.some((x) => x.kind === 'srt'));
        const sample = rows.slice(0, 20);
        const flights = await Promise.all(
          sample.map(async (r) => {
            try {
              // Newest row first, a moved clip's dead rows as fallbacks (`srtSidecars`).
              const got = await fetchLog(c, r);
              if (!got) throw new Error('no flight log');
              const summary = flightSummary(parseSrt(await got.file.text()));
              return { id: r.id, file: r.filename, at: r.captured_at, ...summary };
            } catch (err) {
              return { id: r.id, file: r.filename, at: r.captured_at, unreadable: err instanceof Error ? err.message : String(err) };
            }
          }),
        );
        const read = flights.filter((f) => 'seconds' in f);
        return {
          clipsWithLogs: rows.length,
          ...(rows.length > sample.length ? { warning: `only the first ${sample.length} logs were read — narrow the span` } : {}),
          totals: {
            seconds: Math.round(read.reduce((n, f) => n + f.seconds, 0)),
            km: Math.round(read.reduce((n, f) => n + (f.km ?? 0), 0) * 100) / 100,
            maxHeightM: read.reduce<number | null>((m, f) => (f.maxHeightM === null ? m : m === null ? f.maxHeightM : Math.max(m, f.maxHeightM)), null),
          },
          flights,
        };
      },
    },
    {
      id: 'winnow.stats',
      title: 'The sum-up of a span',
      description:
        `A span counted — a year, a trip: photos and clips (and the clips' seconds), distinct days and the five busiest, by gear, body, lens, focal band, LOCAL hour (24 counts), light, weekday, country (the GPS named offline), verdict and stars — plus the ten people most photographed over the WHOLE library (Winnow counts them library-wide). Up to ${STATS_MAX} rows a call: a year of 20 000 frames is a hundred pages, so expect a wait. winnow.statsSheet draws the same numbers as one card.`,
      params: STATS_PARAMS,
      available: connected,
      run: async (p) => statsFor(p),
    },
    {
      id: 'winnow.statsSheet',
      title: 'The sum-up as a card',
      description: 'The numbers of winnow.stats drawn as one shareable card on the suite’s paper — the headline, the hours of the day as bars, then with what, which body, lens, focal, light, weekday, country and who. A PNG to look at or to post.',
      params: { ...STATS_PARAMS, title: { type: 'string', description: 'The card’s title; the span when absent.', optional: true } },
      available: connected,
      run: async (p) => {
        const got = await statsFor(p);
        const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : got.stats.span ? `${got.stats.span.from} → ${got.stats.span.to}` : 'Nothing dated';
        return statsCardImage(got.stats, title, got.people.map((x) => [x.name, x.media] as [string, number]));
      },
    },
  ];
}
