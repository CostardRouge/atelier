/**
 * The map of subjects — the Storytelling gallery's reading of a series: every
 * subject the author means to tell, filed by pillar, against every channel it
 * could go to, each crossing a STATE (an idea, in progress, ready, published,
 * or not for that channel), never a mere tick.
 *
 * Its lines come from the script (`topics`), so a subject not made yet is on
 * the map beside the posts that exist; a line that names a `post` is that
 * post. A post of the series no line names still shows, under « Not filed »,
 * so the map never hides one. (pure)
 */
import type { PostSkeleton, ScriptChannel, ScriptTopic, StoryScript, CellState, Cell } from './story-script';

/** The channels a script that names none is mapped against. */
export const DEFAULT_CHANNELS: readonly ScriptChannel[] = [
  { id: 'ig', name: 'Instagram', format: 'Reels, carousels' },
  { id: 'tt', name: 'TikTok', format: 'vertical videos' },
  { id: 'yt', name: 'YouTube', format: 'Shorts' },
  { id: 'li', name: 'LinkedIn', format: 'text, PDF carousel' },
  { id: 'bs', name: 'Bluesky', format: 'short threads' },
];

export const channelsOf = (script: StoryScript | null): readonly ScriptChannel[] =>
  script?.channels?.length ? script.channels : DEFAULT_CHANNELS;

export interface MapRow {
  topic: ScriptTopic;
  depth: number;
  /** The lines filed under it, in order. */
  children: MapRow[];
  /** The post of the series this line is, when it is one. */
  post: PostSkeleton | null;
}

const UNFILED = 'unfiled-posts';

// A line with no order comes after those that have one.
const rank = (t: ScriptTopic) => (Number.isFinite(t.order) ? (t.order as number) : Number.MAX_SAFE_INTEGER);
const byOrder = (a: ScriptTopic, b: ScriptTopic) => rank(a) - rank(b) || a.title.localeCompare(b.title);

/** The map's tree: pillars, their subjects, the subjects' versions. */
export function mapRows(script: StoryScript | null, posts: readonly PostSkeleton[]): MapRow[] {
  const topics = script?.topics ?? [];
  const ids = new Set(topics.map((t) => t.id));
  const postById = new Map(posts.map((p) => [p.id, p]));
  const kids = new Map<string, ScriptTopic[]>();
  for (const t of topics) {
    // A line whose parent is gone is filed at the top rather than lost.
    const parent = t.parent && ids.has(t.parent) && t.parent !== t.id ? t.parent : '';
    kids.set(parent, [...(kids.get(parent) ?? []), t]);
  }
  const seen = new Set<string>();
  const build = (t: ScriptTopic, depth: number): MapRow => {
    seen.add(t.id);
    const children = depth < 6 ? (kids.get(t.id) ?? []).filter((c) => !seen.has(c.id)).sort(byOrder).map((c) => build(c, depth + 1)) : [];
    return { topic: t, depth, children, post: t.post ? postById.get(t.post) ?? null : null };
  };
  const rows = (kids.get('') ?? []).sort(byOrder).map((t) => build(t, 0));
  const named = new Set(topics.flatMap((t) => (t.post ? [t.post] : [])));
  const loose = posts.filter((p) => !named.has(p.id));
  if (loose.length) {
    rows.push({
      topic: { id: UNFILED, title: 'Not filed' },
      depth: 0,
      post: null,
      children: loose.map((p, i) => ({
        topic: { id: `post-${p.id}`, title: script?.posts[p.id]?.title ?? p.number, post: p.id, order: i },
        depth: 1,
        children: [],
        post: p,
      })),
    });
  }
  return rows;
}

/** Every line, depth first. */
export function flatten(rows: readonly MapRow[]): MapRow[] {
  return rows.flatMap((r) => [r, ...flatten(r.children)]);
}

/** The lines that carry states of their own: those with nothing filed under them. */
export const leavesOf = (row: MapRow): MapRow[] => (row.children.length ? row.children.flatMap(leavesOf) : [row]);

export const stateOf = (topic: ScriptTopic, channel: string): CellState | null => topic.cells?.[channel]?.s ?? null;

/** How a set of lines stands on one channel: counted per state. */
export function coverage(rows: readonly MapRow[], channel: string): Record<CellState, number> & { total: number } {
  const out = { idee: 0, encours: 0, pret: 0, publie: 0, non: 0, total: rows.length };
  for (const r of rows) {
    const s = stateOf(r.topic, channel);
    if (s) out[s] += 1;
  }
  return out;
}

/** The next state a click gives: nothing → idea → in progress → ready → published → not here → nothing. */
export function nextState(s: CellState | null): CellState | null {
  const order: (CellState | null)[] = [null, 'idee', 'encours', 'pret', 'publie', 'non'];
  return order[(order.indexOf(s) + 1) % order.length];
}

/** Whether a line still has something to do somewhere (an idea, in progress, ready). */
export const hasWork = (topic: ScriptTopic): boolean =>
  Object.values(topic.cells ?? {}).some((c) => c.s === 'idee' || c.s === 'encours' || c.s === 'pret');

/**
 * The script with one crossing changed. A published state is dated today
 * when it has no date; a line that is not in the script yet (a post under
 * « Not filed ») is added at the top level, named after the post.
 */
export function withCell(script: StoryScript, row: MapRow, channel: string, s: CellState | null, today: string): StoryScript {
  const topics = script.topics ? script.topics.slice() : [];
  let at = topics.findIndex((t) => t.id === row.topic.id);
  if (at < 0) {
    topics.push({ id: row.topic.id, title: row.topic.title, post: row.topic.post, order: topics.length + 1 });
    at = topics.length - 1;
  }
  const t = topics[at];
  const cells: Record<string, Cell> = { ...(t.cells ?? {}) };
  if (!s) delete cells[channel];
  else cells[channel] = { ...cells[channel], s, ...(s === 'publie' && !cells[channel]?.date ? { date: today } : {}) };
  topics[at] = { ...t, cells };
  return { ...script, topics };
}
