/**
 * The open recap's agent commands, registered by the EDITOR while a recap is
 * open (`agent-commands.md`): `recap.get`, `.fill`, `.pin`, `.empty`, `.swap`,
 * `.caption`, `.set`, `.snapshot`, `.export`. The shell registers the rest
 * (`recap.list`, `.create`, `.open`, `.keep`, `.undo`, `.redo`).
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
import { applySettings, recapOutline, SETTABLE } from '../../shared/recap/recap-commands';
import { withCaption, withCleared, withPick, withPicture, withSwap, type RecapDoc } from '../../shared/recap/recap-doc';
import { DEFAULT_FRAME, readFrame } from '../../shared/recap/recap-frame';
import { slugOf } from '../../shared/recap/recap-file';
import type { RecapLayout } from '../../shared/recap/recap-layout';
import type { FilmPlan } from '../../shared/recap/recap-motion';
import { paintRecap, type PaintSources } from '../../shared/recap/recap-paint';
import { resolveRecap, type DeviceAliases, type ResolvedRecap } from '../../shared/recap/recap-slots';
import { exportClipSlide, exportFilm, exportPages } from './recap-export';

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
  const input = () => ({ doc: doc(), resolved: c.current.resolved, layout: c.current.layout, film: c.current.film, stills: c.current.sources.still, aliases: c.current.aliases, clipSlides: c.current.clipSlides });

  const specs: CommandSpec[] = [
    {
      id: 'recap.get',
      title: 'Read the open recap',
      description:
        'The open recap: its template and format, the day or period it is about, its filter, how many pictures in its pool and in scope, its pages and length in seconds, every slot (a day, a step back or a place) with the picture it shows, whether pinned or emptied and how many candidates it has, and every setting (texts, cells, motion, background, sound, look).',
      run: () => recapOutline(doc(), resolveRecap(doc()), c.current.layout.pages.length, c.current.film.total, c.current.aliases),
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
      id: 'recap.frame',
      title: 'Frame a slot’s picture',
      description:
        'How the picture in a slot sits in its cell: x and y (0–1) the point of the picture kept in the middle, zoom (1–4) over the cell just covered. The frame belongs to the PICTURE — it follows it to another cell, page or format. No x, y nor zoom puts it back centred. (The background’s frame is `recap.set` background.frame.)',
      params: {
        slot: { type: 'string', description: 'The slot’s id.' },
        x: { type: 'number', min: 0, max: 1, description: 'The focus across the picture.', optional: true },
        y: { type: 'number', min: 0, max: 1, description: 'The focus down the picture.', optional: true },
        zoom: { type: 'number', min: 1, max: 4, description: 'Over the cell just covered.', optional: true },
      },
      run: (p) => {
        const s = slotOf(p.slot);
        const pic = s.picture;
        if (!pic) throw new CommandError('invalid', `slot ${s.id} shows no picture`);
        // What is given changes; what is not keeps its value — and nothing given at all centres it.
        const given = p.x !== undefined || p.y !== undefined || p.zoom !== undefined;
        const was = given ? (pic.frame ?? DEFAULT_FRAME) : DEFAULT_FRAME;
        const frame = readFrame({ x: p.x ?? was.x, y: p.y ?? was.y, zoom: p.zoom ?? was.zoom });
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
        pages.forEach((b, i) => {
          const name = pages.length > 1 || p.what === 'carousel' ? `${base}-${String(i + 1).padStart(2, '0')}.png` : `${base}.png`;
          downloadBlob(b, name);
          files.push(name);
        });
        if (p.what === 'carousel') {
          for (const [slot, n] of c.current.clipSlides) {
            const key = c.current.resolved.slots.find((s) => s.id === slot)?.picture?.key;
            if (!key) continue;
            const blob = await exportClipSlide(input(), key, () => undefined, signal);
            if (!blob) continue;
            const name = `${base}-${String(n).padStart(2, '0')}.mp4`;
            downloadBlob(blob, name);
            files.push(name);
          }
        }
        return { files };
      },
    },
  ];
  useRegisterCommands('recap-editor', specs);
}
