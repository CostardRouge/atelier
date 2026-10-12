/**
 * CURATING commands (`shared/commands/`): a story told in N frames, a cover,
 * an order — over the connected Winnow's rows and their thumbnail metrics,
 * with the arithmetic in `curate/story.ts`. Registered by the shell beside
 * `winnow.*`; proposals only, nothing written anywhere.
 */

import { CommandError, type CommandSpec } from '../../commands/registry';
import { STORY_ORDERS, curateStory, orderStory, type StoryItem, type StoryOrder } from '../../curate/story';
import type { ThumbMetrics } from '../../media/thumb-metrics';
import { gearOf, instantOf, lightOf } from './capture-moment';
import type { WinnowAssetRow } from './client';
import { cullingFromRow } from './culling';
import { orientationOf, type Orientation, ORIENTATIONS } from './row-facets';
import { ANALYSE_MAX } from './thumb-analysis';
import { ASSET_QUERY_PARAMS, IDS_PARAM, rowSummary, winnowHost, type WinnowCommandDeps } from './winnow-commands';

/** A row and its metrics as the story reads them. */
export function storyItemOf(row: WinnowAssetRow, m: ThumbMetrics | undefined): StoryItem {
  const c = cullingFromRow(row);
  const at = instantOf(row) ?? (row.captured_at ? Date.parse(row.captured_at) : NaN);
  return {
    id: row.id,
    at: Number.isFinite(at) ? at : null,
    hash: m?.hash ?? null,
    sharpness: m?.sharpness ?? null,
    light: lightOf(row),
    faces: typeof row.face_count === 'number' ? row.face_count : null,
    gear: gearOf(row),
    orientation: orientationOf(row),
    colour: m?.colour.dominant ?? null,
    hue: m?.colour.hue ?? null,
    focal: row.focal_length,
    verdict: c?.verdict ?? 'unrated',
    stars: c?.star ?? 0,
  };
}

const DEFAULT_COUNT = 8;

export function curateCommands(deps: Pick<WinnowCommandDeps, 'winnow'>): CommandSpec[] {
  const { connected, rowsFor, measured } = winnowHost(deps);
  const itemsFor = async (p: Record<string, unknown>) => {
    const { sample, metrics, cut } = await measured(await rowsFor(p));
    return { rows: sample, items: sample.map((r) => storyItemOf(r, metrics.get(r.id))), cut };
  };
  const orientation = (p: Record<string, unknown>) => (typeof p.orientation === 'string' ? (p.orientation as Orientation) : undefined);
  return [
    {
      id: 'curate.story',
      title: 'The frames that tell a span',
      description:
        `N frames that TELL a day, a span or a folder without repeating themselves — Winnow's liking and the thumbnail's sharpness first, then spread over the hours and the looks (hash, light, gear, people, colour, shape) — in shooting order, each with the reason it was kept. A rejected frame is never picked. By ids, or the same listing as winnow.assets (people, light, gear, colour… narrow the pool first); ${ANALYSE_MAX} frames weighed at most. Look at the picks with winnow.sheet {ids}; a carousel is trips.setPictures over them.`,
      params: {
        ids: IDS_PARAM,
        ...ASSET_QUERY_PARAMS,
        count: { type: 'number', description: `How many frames; ${DEFAULT_COUNT} when absent.`, integer: true, min: 1, max: 40, optional: true },
        prefer: { type: 'string', description: 'The frame shape the piece wants — scored, not required.', enum: ORIENTATIONS, optional: true },
      },
      available: connected,
      run: async (p) => {
        const { rows, items, cut } = await itemsFor(p);
        if (!items.length) throw new CommandError('invalid', 'nothing to choose from — the listing is empty');
        const { picks, leftOut } = curateStory(items, { count: typeof p.count === 'number' ? p.count : DEFAULT_COUNT, orientation: typeof p.prefer === 'string' ? (p.prefer as Orientation) : undefined });
        const byId = new Map(rows.map((r) => [r.id, r]));
        return {
          weighed: items.length,
          leftOut,
          ...(cut ? { warning: `only the first ${ANALYSE_MAX} were weighed — narrow the listing` } : {}),
          picks: picks.map((pick) => ({ ...rowSummary(byId.get(pick.id)!), reason: pick.reason, score: pick.score })),
          ids: picks.map((pick) => pick.id),
        };
      },
    },
    {
      id: 'curate.cover',
      title: 'The one frame for a cover',
      description: 'The strongest single frame of a listing — curate.story with count 1: Winnow’s liking, then sharpness, then the asked shape. Same listing params as winnow.assets.',
      params: {
        ids: IDS_PARAM,
        ...ASSET_QUERY_PARAMS,
        prefer: { type: 'string', description: 'The frame shape the cover wants — scored, not required.', enum: ORIENTATIONS, optional: true },
      },
      available: connected,
      run: async (p) => {
        const { rows, items } = await itemsFor(p);
        const { picks } = curateStory(items, { count: 1, orientation: orientation({ orientation: p.prefer }) });
        if (!picks.length) throw new CommandError('invalid', 'nothing to choose from — the listing is empty or every frame is rejected');
        const row = rows.find((r) => r.id === picks[0].id)!;
        return { cover: { ...rowSummary(row), reason: picks[0].reason }, weighed: items.length };
      },
    },
    {
      id: 'curate.order',
      title: 'An order to show frames in',
      description: 'The ids given, in the order a carousel reads best: time (shooting order), colour (a walk from hue to its nearest neighbour, so the deck drifts rather than jumps) or focal (wide to tight). Reads the thumbnails for colour.',
      params: {
        ids: { type: 'numbers', description: 'Winnow asset ids to order.', integer: true, maxItems: ANALYSE_MAX },
        by: { type: 'string', description: 'time, colour or focal.', enum: STORY_ORDERS },
      },
      available: connected,
      run: async (p) => {
        const { items } = await itemsFor({ ids: p.ids });
        const asked = p.ids as number[];
        const missing = asked.filter((id) => !items.some((i) => i.id === id));
        if (missing.length) throw new CommandError('invalid', `no media ${missing.join(', ')} on this Winnow`);
        return { by: p.by, ids: orderStory(items, p.by as StoryOrder) };
      },
    },
  ];
}
