/**
 * The open recap's agent commands, registered by the EDITOR while a recap is
 * open (`agent-commands.md`): `recap.get`, `.fill`, `.pin`, `.empty`, `.swap`,
 * `.caption`, `.frame`, `.set`, `.snapshot`, `.export` — and its POST (lab 12):
 * `.facts`, `.postCaption`, `.approve`, `.schedule`, `.unschedule`. The shell
 * registers the rest (`recap.list`, `.create`, `.open`, `.keep`, `.undo`,
 * `.redo`, `.suggestions`, `.makeSuggestion`, `.calendar`).
 *
 * An agent WRITES a caption; only the person APPROVES it (his flow: generate,
 * validate, publish) — `recap.schedule` refuses an unapproved one.
 *
 * Every write goes through the editor's own funnel — the one a gesture uses —
 * so it is saved, synced and one undo step; the checks only a recap can make
 * are in `shared/recap/recap-commands.ts` (pure, tested).
 */

import { useRef } from 'react';
import { CommandError, type CommandSpec } from '../../shared/commands/registry';
import { imageResult } from '../../shared/commands/image-result';
import { useRegisterCommands } from '../../shared/commands/use-commands';
import { downloadBlob } from '../../shared/media/save';
import { applySettings, openerOutline, openerTrips, recapOutline, SETTABLE, withOpenerTripFile, withOpenerTripOf } from '../../shared/recap/recap-commands';
import { withCaption, withCleared, withPick, withPicture, withPictures, withRecap, withSwap, type RecapDoc } from '../../shared/recap/recap-doc';
import { DEFAULT_FRAME, readFrame } from '../../shared/recap/recap-frame';
import { slugOf } from '../../shared/recap/recap-file';
import { carouselSlides, type RecapLayout } from '../../shared/recap/recap-layout';
import type { FilmPlan } from '../../shared/recap/recap-motion';
import { paintRecap, type PaintSources } from '../../shared/recap/recap-paint';
import { resolveRecap, templateDays, type DeviceAliases, type ResolvedRecap } from '../../shared/recap/recap-slots';
import { exportClipSlide, exportFilm, exportOpenerSlide, exportPages, renderPostFiles } from './recap-export';
import { hasOpenerSlide, shownPictures } from '../../shared/recap/recap-opener-plan';
import { listTrips } from '../../shared/roadtrip/trip-store';
import { chooseCarousel, pickChannels, poolList, recapFacts, scheduleTarget } from '../../shared/recap/recap-commands';
import type { WinnowClient } from '../../shared/sources/winnow/client';
import { withJoined } from '../../shared/recap/recap-selection';
import { withPlaceByHand } from '../../shared/recap/recap-places';
import { pictureOfRow } from './recap-media';
import { CAPTION_MAX, PUBLISH_KINDS, captionText, defaultKind, musicFor, networkCaption, networkTitle, withCaption as withPostCaption, withNetworkCaption, withMusic, withNetworkTitle, withPublications, type PublishKind } from '../../shared/recap/recap-publish';
import { PostizClient } from '../../shared/sources/postiz/client';
import { rhythmWarnings, slotLabel } from '../../shared/sources/postiz/rhythm';
import { defaultDestinations, getPostiz, publishChannels } from '../../shared/sources/postiz/store';
import { musicLibrary, networkOf, postMoments, type MusicTrack } from '../../shared/sources/postiz/networks';
import { readWhere, writeWhere } from './publish-where';
import { sendPosts } from './recap-post';

export interface RecapCommandsContext {
  /** The recap as it is NOW — written the moment an edit is applied, before React renders. */
  latest: () => RecapDoc;
  change: (fn: (doc: RecapDoc) => RecapDoc) => void;
  resolved: ResolvedRecap;
  layout: RecapLayout;
  film: FilmPlan;
  sources: PaintSources;
  aliases: DeviceAliases;
  clipSlides: ReadonlyMap<string, number>;
  /** Fill from the connected Winnow; the reason when none is. */
  fill: () => Promise<string>;
  canFill: () => true | string;
  /** The connected Winnow, for a picture brought in by id (`recap.add`); null when none is. */
  winnow: () => { client: WinnowClient; instance: string } | null;
}

export function useRecapCommands(ctx: RecapCommandsContext): void {
  const c = useRef(ctx);
  c.current = ctx;
  const doc = () => c.current.latest();
  const slotOf = (id: unknown) => {
    const r = resolveRecap(doc());
    const s = r.slots.find((x) => x.id === id);
    if (!s) throw new CommandError('invalid', `no slot "${String(id)}" — recap.get lists them (${r.slots.slice(0, 3).map((x) => x.id).join(', ')}…)`);
    return s;
  };
  /** The recap's days as the openers read them: its own, else its shown pictures'. */
  const openerDays = () => {
    const own = templateDays(doc());
    return own.length ? own : shownPictures(c.current.resolved).flatMap((x) => (x.day ? [x.day] : []));
  };
  const input = () => ({ doc: doc(), resolved: c.current.resolved, layout: c.current.layout, film: c.current.film, stills: c.current.sources.still, aliases: c.current.aliases, clipSlides: c.current.clipSlides });

  /** The tracks the agent's searches listed, by network and id — what recap.postMusic picks from. */
  const heard = useRef(new Map<string, MusicTrack>());
  const specs: CommandSpec[] = [
    {
      id: 'recap.get',
      title: 'Read the open recap',
      description:
        'The open recap: its template and format, the day or period it is about, its filter, how many pictures in its pool and in scope, its pages and length in seconds, every slot (a day, a step back or a place) with the picture it shows, whether pinned or emptied and how many candidates it has, and every setting (texts, cells, motion, background, sound, look).',
      run: () => recapOutline(doc(), resolveRecap(doc()), c.current.layout.pages.length, c.current.film.total, c.current.aliases, carouselSlides(doc(), resolveRecap(doc()), c.current.layout, hasOpenerSlide(doc(), c.current.film.opener)).map((s) => s.key)),
    },
    {
      id: 'recap.fill',
      title: 'Fill from the Winnow',
      description: 'Bring every picture of the recap’s days (or period) from the connected Winnow into its pool — references only, rejects left out — and let the rule fill the slots. Answers what was read.',
      available: () => c.current.canFill(),
      run: async () => ({ done: await c.current.fill() }),
    },
    {
      id: 'recap.pin',
      title: 'Pin a picture on a slot',
      description: 'Show a picture of the pool on a slot, by its key (recap.get lists the slots; a slot’s candidates are the pool’s pictures of that day). Without `picture`, the slot goes back to the rule.',
      params: {
        slot: { type: 'string', description: 'The slot’s id (a day YYYY-MM-DD, ago:1y, n:3).' },
        picture: { type: 'string', description: 'The picture’s key, from recap.get or the pool.', optional: true },
      },
      run: (p) => {
        const s = slotOf(p.slot);
        if (p.picture !== undefined && !doc().pictures.some((x) => x.key === p.picture)) throw new CommandError('invalid', `no picture "${String(p.picture)}" in this recap’s pool`);
        c.current.change((d) => withPick(d, s.id, (p.picture as string | undefined) ?? null));
        return { slot: s.id, picture: p.picture ?? 'the rule’s' };
      },
    },
    {
      id: 'recap.empty',
      title: 'Empty a slot',
      description: 'Leave a slot empty by hand (recap.pin without a picture gives it back to the rule).',
      params: { slot: { type: 'string', description: 'The slot’s id.' } },
      run: (p) => {
        const s = slotOf(p.slot);
        c.current.change((d) => withCleared(d, s.id));
        return { slot: s.id, emptied: true };
      },
    },
    {
      id: 'recap.swap',
      title: 'Swap two slots',
      description: 'The pictures of two slots trade places; both are pinned after.',
      params: { a: { type: 'string', description: 'A slot’s id.' }, b: { type: 'string', description: 'Another slot’s id.' } },
      run: (p) => {
        const a = slotOf(p.a);
        const b = slotOf(p.b);
        c.current.change((d) => withSwap(d, a.id, a.picture?.key ?? null, b.id, b.picture?.key ?? null));
        return { swapped: [a.id, b.id] };
      },
    },
    {
      id: 'recap.caption',
      title: 'Caption a slot',
      description: 'A word or a line for a slot, drawn when cells.caption is on. An empty text removes it.',
      params: { slot: { type: 'string', description: 'The slot’s id.' }, text: { type: 'string', description: 'At most 80 characters.' } },
      run: (p) => {
        const s = slotOf(p.slot);
        if ((p.text as string).length > 80) throw new CommandError('invalid', 'a caption is 80 characters at most');
        c.current.change((d) => withCaption(d, s.id, p.text as string));
        return { slot: s.id, caption: p.text };
      },
    },
    {
      id: 'recap.place',
      title: 'Give pictures a place by hand',
      description:
        'The place pictures say, by hand (lab 17): a town (or a sight), its region and its country — what their pin, {place}, the runs of days and the caption\'s tags then say. Winnow\'s own is kept: with none of place, region or country given, the pictures say Winnow\'s again. Keys from recap.pool. How a place is WRITTEN is recap.set places.writing / places.country.',
      params: {
        keys: { type: 'strings', description: 'Picture keys, from recap.pool.' },
        place: { type: 'string', description: 'The town or the sight, e.g. "Albany".', optional: true },
        region: { type: 'string', description: 'Its state or region, e.g. "Western Australia".', optional: true },
        country: { type: 'string', description: 'Its country, e.g. "Australia".', optional: true },
      },
      run: (p) => {
        const keys = p.keys as string[];
        const pool = new Set(doc().pictures.map((x) => x.key));
        const missing = keys.filter((k) => !pool.has(k));
        if (missing.length) throw new CommandError('invalid', `not in this recap's pool: ${missing.slice(0, 5).join(', ')}`);
        const facts = { place: p.place as string | undefined, region: p.region as string | undefined, country: p.country as string | undefined };
        const back = !facts.place?.trim() && !facts.region?.trim() && !facts.country?.trim();
        c.current.change((d) => withPlaceByHand(d, keys, back ? null : facts));
        return { keys, place: back ? 'Winnow’s' : facts };
      },
    },
    {
      id: 'recap.frame',
      title: 'Frame a slot’s picture',
      description:
        'How the picture in a slot sits in its cell: x and y (0–1) the point of the picture kept in the middle, zoom (1–4) over the cell just covered, rotate (−45–45°) to straighten it. The frame belongs to the PICTURE — it follows it to another cell, page or format. No x, y nor zoom puts it back centred. (The background’s frame is `recap.set` background.frame.)',
      params: {
        slot: { type: 'string', description: 'The slot’s id.' },
        x: { type: 'number', min: 0, max: 1, description: 'The focus across the picture.', optional: true },
        y: { type: 'number', min: 0, max: 1, description: 'The focus down the picture.', optional: true },
        zoom: { type: 'number', min: 1, max: 4, description: 'Over the cell just covered.', optional: true },
        rotate: { type: 'number', min: -45, max: 45, description: 'Degrees clockwise — a horizon straightened; the picture grows so no corner goes empty.', optional: true },
      },
      run: (p) => {
        const s = slotOf(p.slot);
        const pic = s.picture;
        if (!pic) throw new CommandError('invalid', `slot ${s.id} shows no picture`);
        // What is given changes; what is not keeps its value — and nothing given at all centres it.
        const given = p.x !== undefined || p.y !== undefined || p.zoom !== undefined || p.rotate !== undefined;
        const was = given ? (pic.frame ?? DEFAULT_FRAME) : DEFAULT_FRAME;
        const frame = readFrame({ x: p.x ?? was.x, y: p.y ?? was.y, zoom: p.zoom ?? was.zoom, rotate: p.rotate ?? was.rotate });
        c.current.change((d) => withPicture(d, pic.key, { frame }));
        return { slot: s.id, picture: pic.key, frame: frame ?? DEFAULT_FRAME };
      },
    },
    {
      id: 'recap.set',
      title: 'Set the recap’s settings',
      description: `Write some of the recap’s settings, deep-merged: ${Object.entries(SETTABLE)
        .map(([k, v]) => `${k}: ${v}`)
        .join('; ')}. An unknown key or a value out of its range is refused, never clamped. Answers the fields written.`,
      params: { settings: { type: 'object', description: 'The fields to write, e.g. {"motion": {"order": "spiral"}, "cells": {"count": true}}.' } },
      run: (p) => {
        const r = applySettings(doc(), p.settings);
        if (!r.ok) throw new CommandError('invalid', r.error);
        c.current.change(() => r.doc);
        return { changed: r.changed };
      },
    },
    {
      id: 'recap.openerTrips',
      title: 'List the trips an opener can drive',
      description:
        'The trips of Trips on this device that Trips’ openers at the head of the recap (opener.kind drive, map, showcase, card) can drive: id, name, span, located places, whether it has a road — the ones covering the recap’s days first (covers), the one the recap keeps a copy of marked (kept; changedSince when it was changed in Trips after the copy). Read from this device, nothing is fetched.',
      run: async () => ({ trips: openerTrips(doc(), await listTrips(), openerDays()), tripKept: openerOutline(doc().opener).tripKept }),
    },
    {
      id: 'recap.openerTrip',
      title: 'Give the opener its trip',
      description:
        'Copy a trip of this device INTO the recap for its opener — its legs, places, road and vehicles, never its pieces; the trip in Trips is not touched and later changes to it are not followed (call again to take them). "none" drops the copy: the recap’s located pictures alone are then the road. Does not choose the opener: recap.set {opener: {kind: "drive"}}. One undo step.',
      params: { trip: { type: 'string', description: 'A trip id from recap.openerTrips, or "none".' } },
      run: async (p) => {
        const r = withOpenerTripOf(doc(), await listTrips(), String(p.trip));
        if (!r.ok) throw new CommandError('invalid', r.error);
        c.current.change(() => r.doc);
        return { tripKept: r.kept };
      },
    },
    {
      id: 'recap.openerTripFile',
      title: 'Give the opener a trip file',
      description:
        'Copy the trip a .roadtrip.json holds (Trips’ export) into the recap for its opener, from the file’s text. It is NOT added to Trips. Refused, with the reason, when the text is not a trip file or was written by a newer Atelier.',
      params: {
        text: { type: 'string', description: 'The whole text of the .roadtrip.json.' },
        name: { type: 'string', description: 'The file’s name, to remember where the copy came from.', optional: true },
      },
      run: (p) => {
        const r = withOpenerTripFile(doc(), String(p.text), typeof p.name === 'string' && p.name ? p.name : 'trip.roadtrip.json');
        if (!r.ok) throw new CommandError('invalid', r.error);
        c.current.change(() => r.doc);
        return { tripKept: r.kept };
      },
    },
    {
      id: 'recap.snapshot',
      title: 'Look at the recap',
      description: 'A picture of one page of the open recap as it rests (everything entered), 540 px wide — to check a change by looking.',
      params: { page: { type: 'number', integer: true, min: 1, max: 20, description: 'The page, from 1 (default 1).', optional: true } },
      run: async (p) => {
        const page = Math.min(c.current.layout.pages.length, (p.page as number | undefined) ?? 1) - 1;
        const pg = c.current.layout.pages[page];
        const w = 540;
        const h = Math.round((pg.height / pg.width) * w);
        const canvas = new OffscreenCanvas(w, h);
        const g = canvas.getContext('2d');
        if (!g) throw new CommandError('failed', 'this browser draws no canvas');
        paintRecap(g, w, doc(), c.current.resolved, c.current.layout, c.current.film, { still: c.current.sources.still }, { t: (c.current.film.pages[page]?.allOn ?? 0) + 0.01, page, aliases: c.current.aliases, clipSlides: c.current.clipSlides });
        return imageResult(await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 }), w, h, `page ${page + 1} of ${c.current.layout.pages.length}`);
      },
    },
    {
      id: 'recap.export',
      title: 'Export the recap',
      description: 'Write the recap’s files to the browser’s downloads: "video" (the MP4 with its sound), "stills" (each page as a PNG) or "carousel" (the pages, then one MP4 per clip, numbered as the cells’ badges). Answers the files written.',
      params: { what: { type: 'string', enum: ['video', 'stills', 'carousel'], description: 'Which delivery.' } },
      run: async (p) => {
        const base = slugOf(doc().title) || 'recap';
        const files: string[] = [];
        const signal = new AbortController().signal;
        if (p.what === 'video') {
          const r = await exportFilm(input(), () => undefined, signal);
          downloadBlob(r.blob, `${base}.mp4`);
          return { files: [`${base}.mp4`], seconds: c.current.film.total, sound: r.silent ? `none: ${r.silent}` : Boolean(doc().sound), missingClips: r.missingClips };
        }
        const pages = await exportPages(input());
        if (p.what !== 'carousel') {
          pages.forEach((b, i) => {
            const name = pages.length > 1 ? `${base}-${String(i + 1).padStart(2, '0')}.png` : `${base}.png`;
            downloadBlob(b, name);
            files.push(name);
          });
          return { files };
        }
        // The carousel slide by slide in its order, as the Export tab writes it: the opener's still, the pages, the clips.
        const order = carouselSlides(doc(), c.current.resolved, c.current.layout, hasOpenerSlide(doc(), c.current.film.opener));
        for (const [i, s] of order.entries()) {
          const n = String(i + 1).padStart(2, '0');
          let blob: Blob | null = null;
          let ext = 'png';
          if (s.kind === 'page') blob = pages[s.page] ?? null;
          else if (s.kind === 'opener') blob = await exportOpenerSlide(input(), signal);
          else {
            const key = c.current.resolved.slots.find((x) => x.id === s.slot)?.picture?.key;
            if (key) blob = await exportClipSlide(input(), key, () => undefined, signal);
            ext = 'mp4';
          }
          if (!blob) continue;
          downloadBlob(blob, `${base}-${n}.${ext}`);
          files.push(`${base}-${n}.${ext}`);
        }
        return { files };
      },
    },
    {
      id: 'recap.pool',
      title: 'Browse the recap’s pictures',
      description:
        'Every picture the recap holds — not only those it shows — in time order, filtered: a day or a span (from, to), a place (part of the town, region or country), ♥ (fav), Winnow’s pick, at least minStars, photo or video, a camera (part of its name), shown or not. Each with its key (what recap.pin and recap.choose take), its Winnow id (what winnow.sheet shows), its day and time, place, camera, ♥/pick/stars, and the slots it shows on. 100 at a time (limit up to 500, offset to page).',
      params: {
        day: { type: 'string', description: 'One day, YYYY-MM-DD.', optional: true },
        from: { type: 'string', description: 'A span’s first day.', optional: true },
        to: { type: 'string', description: 'A span’s last day.', optional: true },
        place: { type: 'string', description: 'Part of a place’s name.', optional: true },
        fav: { type: 'boolean', description: 'Only the ♥ (true) or only the others (false).', optional: true },
        picked: { type: 'boolean', description: 'Only Winnow’s picks, or only the others.', optional: true },
        minStars: { type: 'number', integer: true, min: 1, max: 5, description: 'At least this many stars.', optional: true },
        kind: { type: 'string', enum: ['photo', 'video'], description: 'Photos or videos only.', optional: true },
        device: { type: 'string', description: 'Part of a camera’s name.', optional: true },
        shown: { type: 'boolean', description: 'Only what the recap shows (true), or only what it does not (false).', optional: true },
        limit: { type: 'number', integer: true, min: 1, max: 500, description: 'How many (default 100).', optional: true },
        offset: { type: 'number', integer: true, min: 0, description: 'Skip this many.', optional: true },
      },
      run: (p) => {
        const day = (k: string) => {
          const v = p[k];
          if (v !== undefined && (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v))) throw new CommandError('invalid', `${k} is a day, YYYY-MM-DD`);
          return v as string | undefined;
        };
        return poolList(
          doc(),
          resolveRecap(doc()),
          { day: day('day'), from: day('from'), to: day('to'), place: p.place as string | undefined, fav: p.fav as boolean | undefined, picked: p.picked as boolean | undefined, minStars: p.minStars as number | undefined, kind: p.kind as 'photo' | 'video' | undefined, device: p.device as string | undefined, shown: p.shown as boolean | undefined, limit: p.limit as number | undefined, offset: p.offset as number | undefined },
          c.current.aliases,
        );
      },
    },
    {
      id: 'recap.add',
      title: 'Bring Winnow pictures into the recap',
      description:
        'Bring pictures of the connected Winnow into the recap, by their Winnow ids (from winnow.search — "a beach at sunset" —, winnow.assets, winnow.near…), whatever day they were taken: they join its pool, and the carousel at their moment (join: false leaves them in the pool only, for recap.choose or recap.pin). With slot, the first lands on that slot instead (a day may then show another day’s picture). Answers their keys.',
      params: {
        ids: { type: 'numbers', integer: true, min: 1, maxItems: 200, description: 'Winnow asset ids.' },
        join: { type: 'boolean', description: 'Join the carousel (default true).', optional: true },
        slot: { type: 'string', description: 'Put the first on this slot instead.', optional: true },
      },
      available: () => (c.current.winnow() ? true : 'no Winnow is connected — connect one on #/sources'),
      run: async (p) => {
        const w = c.current.winnow()!;
        const ids = p.ids as number[];
        const target = p.slot === undefined ? null : slotOf(p.slot);
        const rows = (await w.client.assetsByIds(ids)).filter((r) => r.media_type === 'photo' || r.media_type === 'video');
        const found = new Set(rows.map((r) => r.id));
        const missing = ids.filter((id) => !found.has(id));
        if (!rows.length) throw new CommandError('invalid', `no photo or video of this Winnow has the ids ${ids.slice(0, 5).join(', ')}${ids.length > 5 ? '…' : ''}`);
        const byId = new Map(rows.map((r) => [r.id, r]));
        const pics = ids.flatMap((id) => (byId.has(id) ? [pictureOfRow(byId.get(id)!, w.instance)] : []));
        const had = new Set(doc().pictures.map((x) => x.key));
        c.current.change((d) => {
          let next = withPictures(d, pics);
          if (target) next = withPick(next, target.id, pics[0].key);
          else if (p.join !== false) next = withJoined(next, pics.map((x) => x.key));
          return next;
        });
        // What actually shows now: a picture outside the recap's days stays in the pool (recap.choose forces it in).
        const shown = new Set(resolveRecap(doc()).slots.flatMap((s) => (s.picture ? [s.picture.key] : [])));
        const outside = target || p.join === false ? [] : pics.filter((x) => !shown.has(x.key)).map((x) => x.key);
        return {
          added: pics.filter((x) => !had.has(x.key)).map((x) => x.key),
          already: pics.filter((x) => had.has(x.key)).map((x) => x.key),
          ...(target ? { onSlot: target.id } : p.join === false ? { inPoolOnly: true } : { joined: pics.filter((x) => shown.has(x.key)).map((x) => x.key) }),
          ...(outside.length ? { notJoined: outside, why: 'outside the recap’s days, or past the carousel’s count — recap.choose puts them in by key' } : {}),
          ...(missing.length ? { notFound: missing } : {}),
        };
      },
    },
    {
      id: 'recap.choose',
      title: 'Set the carousel’s pictures',
      description:
        'Make the carousel exactly these pictures, in this order — keys from recap.pool (recap.add brings others in). The selection is then frozen, as one made by hand: nothing comes in or moves by itself; recap.set carousel.chosen: null gives it back to the rule. For a dump or a sheet, the pictures; for a month, its highlights after the calendar. Instagram’s API posts 10 slides at most.',
      params: { keys: { type: 'strings', description: 'Picture keys, in the order they show (240 at most).' } },
      run: (p) => {
        const r = chooseCarousel(doc(), p.keys as string[]);
        if (!r.ok) throw new CommandError('invalid', r.error);
        c.current.change(() => r.doc);
        const shown = resolveRecap(r.doc).slots.flatMap((s) => (s.flow && s.picture ? [s.picture.key] : []));
        return { carousel: shown, frozen: true };
      },
    },
    {
      id: 'recap.facts',
      title: 'Gather what the recap is about',
      description:
        'What a caption is written from: the period, days, pictures and videos, the places (the one most visited, the route in time order, each stay with its days), the cameras, the pictures shown with their day and place (♥ and picks first), the words a caption template can hold (filled: heading, at, route, tags, place, places, month, year, count, days…), and the caption as it stands — its template, its text as it would go out, whether the person approved it.',
      run: () => recapFacts(doc(), resolveRecap(doc()), c.current.aliases),
    },
    {
      id: 'recap.postCaption',
      title: 'Write the post’s words',
      description: `The words the recap goes out with — a TEMPLATE of Recap's words filled when it is sent: {heading}, {at} (" — Albany"), {route} (Esperance → Albany), {tags} (hashtags from the places), {place}, {places}, {month}, {year}, {count}, {days}, {videos}; plain text and emoji around them. ${CAPTION_MAX} characters at most once filled. Without on: the caption every network starts from — each network gets it cut to its own length (Bluesky 300, X 280, Threads 500) at a sentence, two hashtags kept. With on (one account or network): THAT network's own words, and title its title (YouTube needs one, TikTok takes one; the heading otherwise). Writing takes the person's approval back: they read them (Export › Publish › Words) and approve, or tell you to (recap.approve). reset: true gives back Recap's own (with on: the shared words there). Answers the text as it would go out, and each account's.`,
      params: {
        text: { type: 'string', description: 'The words (a template).', optional: true },
        on: { type: 'string', description: 'One account or network these words are for; nothing: every network.', optional: true },
        title: { type: 'string', description: 'With on: that network’s title (YouTube, TikTok).', optional: true },
        reset: { type: 'boolean', description: 'Back to Recap’s own caption; with on, to the shared words there.', optional: true },
      },
      run: (p) => {
        if (p.reset !== true && typeof p.text !== 'string' && typeof p.title !== 'string') throw new CommandError('invalid', 'give text (or title with on), or reset: true');
        const next = p.reset === true ? null : ((p.text as string | undefined) ?? undefined);
        if (typeof next === 'string' && !next.trim()) throw new CommandError('invalid', 'empty words — reset: true gives back Recap’s own');
        const accounts = publishChannels(getPostiz());
        let apply: (pub: RecapDoc['publish']) => RecapDoc['publish'];
        if (p.on !== undefined) {
          const picked = pickChannels([p.on], accounts, []);
          if ('error' in picked) throw new CommandError('invalid', picked.error);
          apply = (pub) =>
            picked.channels.reduce((acc, ch) => {
              if (p.reset === true) return withNetworkTitle(withNetworkCaption(acc, ch.id, null), ch.id, null);
              const worded = typeof next === 'string' ? withNetworkCaption(acc, ch.id, next) : acc;
              return typeof p.title === 'string' ? withNetworkTitle(worded, ch.id, p.title) : worded;
            }, pub);
        } else {
          if (next === undefined) throw new CommandError('invalid', 'a title is one network’s: say which with on');
          apply = (pub) => withPostCaption(pub, next);
        }
        c.current.change((d) => withRecap(d, { publish: apply(d.publish) }));
        const after = { ...doc(), publish: apply(doc().publish) };
        const r = resolveRecap(after);
        const text = captionText(after, r);
        return {
          text,
          length: text.length,
          approved: after.publish.approved,
          ...(text.length >= CAPTION_MAX ? { cut: `longer than ${CAPTION_MAX} once filled — cut` } : {}),
          accounts: accounts.map((ch) => {
            const net = networkOf(ch.identifier)!;
            const mine = networkCaption(after, r, ch.id, net);
            const title = networkTitle(after, r, ch.id, net);
            return { on: ch.name, network: net.label, max: net.captionMax, ...(mine.own ? { own: true } : {}), ...(mine.fitted ? { shortened: true } : {}), ...(mine.own || mine.fitted ? { text: mine.text } : {}), ...(title ? { title } : {}) };
          }),
        };
      },
    },
    {
      id: 'recap.music',
      title: 'Search a network’s music',
      description:
        'The music library of one of the person’s networks, searched through their Postiz — where an account has one: Instagram (with the Facebook Business connector) or TikTok Business. q: what to look for; nothing: what is trending. on: "instagram" (default) or "tiktok". Answers the tracks: id, title, artist, seconds. Give an id to recap.postMusic. The person hears a track in Export › Publish › Sound; you cannot.',
      params: {
        q: { type: 'string', description: 'What to search; nothing: trending.', optional: true },
        on: { type: 'string', description: 'The network: "instagram" (default) or "tiktok".', optional: true },
      },
      available: () => (publishChannels(getPostiz()).some((ch) => musicLibrary(ch.identifier)) ? true : 'none of the person’s accounts has a music library through Postiz (Instagram with the Facebook Business connector, TikTok Business)'),
      run: async (p) => {
        const conn = getPostiz()!;
        const want = typeof p.on === 'string' ? p.on.toLowerCase() : 'instagram';
        const channel = publishChannels(conn).find((ch) => musicLibrary(ch.identifier) && networkOf(ch.identifier)?.id === want);
        if (!channel) throw new CommandError('invalid', `no account with a music library on "${want}"`);
        const tracks = await new PostizClient(conn.apiBase, conn.apiKey).searchMusic(channel, typeof p.q === 'string' ? p.q : '');
        for (const t of tracks) heard.current.set(`${want}:${t.id}`, t);
        return { on: networkOf(channel.identifier)!.label, tracks: tracks.map((t) => ({ id: t.id, title: t.title, artist: t.artist, seconds: t.seconds })) };
      },
    },
    {
      id: 'recap.postMusic',
      title: 'Set what the post sounds like',
      description:
        'What the recap sounds like once published. source: "own" — every network hears the recap’s own sound — or "network" (default): a track of the network’s own library laid over the Reel where an account has one, the other networks keeping the recap’s sound. track: a track’s id from recap.music, with on: its network ("instagram" default, "tiktok"); track: "" removes it. musicVolume and filmVolume: 0–100, the track and the recap’s own sound under it. The network picks which excerpt of the track plays; a carousel or a story carries no library track. Answers what each account will hear.',
      params: {
        source: { type: 'string', enum: ['own', 'network'], description: 'The recap’s own sound everywhere, or the networks’ music where there is one.', optional: true },
        track: { type: 'string', description: 'A track id from recap.music; "" removes it.', optional: true },
        on: { type: 'string', description: 'The track’s network: "instagram" (default) or "tiktok".', optional: true },
        musicVolume: { type: 'number', min: 0, max: 100, description: 'The track’s volume.', optional: true },
        filmVolume: { type: 'number', min: 0, max: 100, description: 'The recap’s own sound under it.', optional: true },
      },
      run: (p) => {
        const want = typeof p.on === 'string' ? p.on.toLowerCase() : 'instagram';
        let track: MusicTrack | null | undefined;
        if (typeof p.track === 'string') {
          track = p.track ? (heard.current.get(`${want}:${p.track}`) ?? null) : null;
          if (p.track && !track) throw new CommandError('invalid', `no track "${p.track}" in the last searches on ${want} — search it first (recap.music)`);
        }
        const apply = (pub: RecapDoc['publish']) => {
          const tracks = track === undefined ? pub.music.tracks : track === null ? Object.fromEntries(Object.entries(pub.music.tracks).filter(([k]) => k !== want)) : { ...pub.music.tracks, [want]: track };
          return withMusic(pub, {
            ...(typeof p.source === 'string' ? { source: p.source as 'own' | 'network' } : track ? { source: 'network' as const } : {}),
            tracks,
            ...(typeof p.musicVolume === 'number' ? { musicVolume: p.musicVolume } : {}),
            ...(typeof p.filmVolume === 'number' ? { filmVolume: p.filmVolume } : {}),
          });
        };
        c.current.change((d) => withRecap(d, { publish: apply(d.publish) }));
        const after = apply(doc().publish);
        return {
          source: after.music.source,
          musicVolume: after.music.musicVolume,
          filmVolume: after.music.filmVolume,
          hears: publishChannels(getPostiz()).map((ch) => {
            const m = musicFor(after, ch.identifier, 'reel');
            return { on: ch.name, network: networkOf(ch.identifier)!.label, sound: m ? `${m.track.title} — ${m.track.artist} (the network’s library)` : doc().sound ? 'the recap’s own sound' : 'none' };
          }),
        };
      },
    },
    {
      id: 'recap.approve',
      title: 'Approve the caption',
      description: 'Mark the caption approved — ONLY when the person has read it and said so in this conversation. recap.schedule needs it. Any change to the caption takes it back.',
      run: () => {
        c.current.change((d) => withRecap(d, { publish: { ...d.publish, approved: true } }));
        return { approved: true, text: captionText(doc(), resolveRecap(doc())) };
      },
    },
    {
      id: 'recap.schedule',
      title: 'Schedule the recap on the person’s networks',
      description:
        'Render the open recap ONCE, send it to the person’s Postiz and schedule it on their accounts — the caption must be approved first (recap.approve). on: the accounts — ["all"], networks ("instagram", "tiktok", "youtube", "bluesky", "threads", "x") or accounts by name (recap.calendar lists them); nothing: where this template went the last time. kind: "reel" (the film), "carousel" (the slides — each network takes what it holds: 10 on Instagram, the first 4 pictures on Bluesky and X, none on YouTube) or "story" (Instagram only) — default: a carousel for a dump, sheets or Wrapped, else the Reel. at: "next" (default — the next free slot of their rhythm), "now", "draft" (left in Postiz unsent), or a time: YYYY-MM-DDTHH:MM in the rhythm’s time zone, or ISO with its zone. stagger: true sends the other networks two hours after Instagram. trial: a Trial Reel on Instagram, shown to non-followers first; graduate: "auto" (shared with the followers when it performs, default) or "manual". collaborator: false leaves out the Instagram collaborator set on Sources. A broken rhythm is answered as warnings, not refused; a network that cannot take it, or refuses it, is answered in failed while the others go. Answers when it goes out and each post’s id.',
      params: {
        on: { type: 'strings', description: 'The accounts: ["all"], networks, or names.', optional: true },
        kind: { type: 'string', enum: [...PUBLISH_KINDS], description: 'What it goes out as.', optional: true },
        at: { type: 'string', description: '"next", "now", "draft" or a time.', optional: true },
        stagger: { type: 'boolean', description: 'Instagram first, the other networks two hours later.', optional: true },
        trial: { type: 'boolean', description: 'A Trial Reel on Instagram.', optional: true },
        graduate: { type: 'string', enum: ['auto', 'manual'], description: 'A trial shared with followers when it performs, or by hand.', optional: true },
        collaborator: { type: 'boolean', description: 'Invite the collaborator set on Sources, on Instagram (default true).', optional: true },
      },
      available: () => {
        const conn = getPostiz();
        if (!conn) return 'no Postiz is connected — the person connects theirs on #/sources';
        return publishChannels(conn).length ? true : 'their Postiz has no account Recap can post to — they add one there, then refresh it on #/sources';
      },
      run: async (p) => {
        const d0 = doc();
        if (!d0.publish.approved) throw new CommandError('unavailable', 'the caption is not approved — show it to the person (recap.facts) and approve it once they say so (recap.approve)');
        const conn = getPostiz()!;
        const picked = pickChannels(p.on, publishChannels(conn), defaultDestinations(conn, readWhere(d0.template)));
        if ('error' in picked) throw new CommandError('invalid', picked.error);
        const client = new PostizClient(conn.apiBase, conn.apiKey);
        const order = carouselSlides(d0, c.current.resolved, c.current.layout, hasOpenerSlide(d0, c.current.film.opener));
        const kind = (p.kind as PublishKind | undefined) ?? defaultKind(d0, order.length);
        if (kind === 'carousel' && order.length < 2) throw new CommandError('invalid', 'this recap has one slide — a carousel needs two');
        const now = new Date();
        const planned = postMoments(
          (await client.posts(new Date(now.getTime() - 86400000), new Date(now.getTime() + 63 * 86400000))).filter((x) => x.state !== 'error' && x.state !== 'draft').map((x) => ({ at: new Date(x.publishDate), channelId: x.channel?.id ?? null })),
        );
        const target = scheduleTarget(p.at, conn.rhythm, planned, now);
        if ('error' in target) throw new CommandError('invalid', target.error);
        const signal = new AbortController().signal;
        const files = await renderPostFiles(input(), kind, order, slugOf(d0.title) || 'recap', () => undefined, signal);
        const resolved = resolveRecap(d0);
        const isInstagram = (identifier: string) => networkOf(identifier)?.id === 'instagram';
        const later = p.stagger === true && picked.channels.some((ch) => isInstagram(ch.identifier)) && target.at !== 'draft' ? new Date((target.at === 'now' ? now.getTime() : target.at.getTime()) + 2 * 3600_000) : null;
        const result = await sendPosts({
          client,
          kind,
          files,
          seconds: kind === 'carousel' ? null : c.current.film.total,
          destinations: picked.channels.map((channel) => {
            const net = networkOf(channel.identifier)!;
            return { channel, caption: networkCaption(d0, resolved, channel.id, net).text, title: networkTitle(d0, resolved, channel.id, net) || null, music: musicFor(d0.publish, channel.identifier, kind), at: later && !isInstagram(channel.identifier) ? later : target.at };
          }),
          trial: p.trial === true,
          graduate: (p.graduate as 'auto' | 'manual' | undefined) ?? 'auto',
          collaborators: p.collaborator !== false && conn.collaborator ? [conn.collaborator] : [],
          signal,
        });
        if (result.sent.length) {
          c.current.change((d) => withRecap(d, { publish: withPublications(d.publish, result.sent) }));
          writeWhere(d0.template, result.sent.map((x) => x.channelId));
        }
        return {
          kind,
          goesOut: target.at instanceof Date ? `${slotLabel(target.at, conn.rhythm.timeZone)} (${conn.rhythm.timeZone})` : target.at,
          posts: result.sent.map((x) => ({ postId: x.postId, on: x.channel, network: networkOf(x.network)?.label ?? x.network, ...(x.trial ? { trial: true } : {}), ...(later && !isInstagram(x.network) ? { goesOut: slotLabel(later, conn.rhythm.timeZone) } : {}) })),
          ...(result.failed.length ? { failed: result.failed } : {}),
          ...(result.notes.length ? { notes: result.notes } : {}),
          files: files.length,
          warnings: target.at instanceof Date ? rhythmWarnings(conn.rhythm, planned, target.at) : [],
          ...(result.sent.some((x) => isInstagram(x.network)) ? { remember: 'Instagram’s API sets no location: tell the person to add it in Instagram once the post is out.' } : {}),
        };
      },
    },
    {
      id: 'recap.unschedule',
      title: 'Take a scheduled post back',
      description: 'Delete a post this recap sent from the person’s Postiz, by its id (recap.get › post.publications — one send to several networks is several posts, each with its id), before it goes out — and forget it here. A post already out stays on its network.',
      params: { postId: { type: 'string', description: 'The post’s id.' } },
      available: () => (getPostiz() ? true : 'no Postiz is connected'),
      run: async (p) => {
        const pub = doc().publish.publications.find((x) => x.postId === p.postId);
        if (!pub) throw new CommandError('invalid', `this recap sent no post "${String(p.postId)}"`);
        const conn = getPostiz()!;
        await new PostizClient(conn.apiBase, conn.apiKey).deletePost(pub.postId);
        c.current.change((d) => withRecap(d, { publish: { ...d.publish, publications: d.publish.publications.filter((x) => x.postId !== pub.postId) } }));
        return { removed: pub.postId };
      },
    },
  ];
  useRegisterCommands('recap-editor', specs);
}
