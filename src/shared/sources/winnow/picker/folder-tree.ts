import type { WinnowSession } from '../client';
import { folderDays } from '../folder-days';

/**
 * The instance's folders as a TREE, rebuilt from their paths.
 *
 * Winnow lists its folders (its "sessions") flat, newest capture first; the
 * hierarchy a person filed them in (`sony/photos/2026/novembre 2026/…`) lives
 * only inside each `source_path`. The Folder navigator (lab 2026-11-24, his
 * picks 1A–7a) browses that hierarchy, so it is rebuilt here, pure.
 *
 * - A real Winnow folder is a node with a `session`. Only those can be
 *   OPENED in the grid; a parent such as `novembre 2026` is something you go
 *   into (his pick 4a).
 * - A folder that is both a Winnow folder AND holds others gets its own media
 *   as a first child, `OWN_MEDIA`, so every openable thing is a leaf.
 * - A chain of parents with one child each is merged into one step
 *   (`sony/photos`), his pick 3a — but a parent is never merged INTO a leaf,
 *   so the folder you open keeps its own name.
 * - Days are LOCAL days, read by `folderDays` (the device's zone).
 */
export interface FolderNode {
  /** What a row shows: one path segment, or several merged (`sony/photos`). */
  name: string;
  /** The full path down to this node, `/`-joined; `''` for the root. */
  path: string;
  /** The Winnow folder this node opens, or null for a parent. */
  session: WinnowSession | null;
  children: FolderNode[];
  /** Every Winnow folder at or under this node, newest capture first. */
  sessions: WinnowSession[];
  /** Media at or under this node. */
  count: number;
  /** First and last local day shot under this node, `YYYY-MM-DD`. */
  from: string | null;
  to: string | null;
  /** Share of the media under this node already sorted in Winnow (0–1), or null when Winnow did not say. */
  sorted: number | null;
}

/** The name of the leaf that holds a folder's own media when it also holds folders. */
export const OWN_MEDIA = 'Its own media';

export type FolderOrder = 'time' | 'name';

/** The share of a folder already given a verdict in Winnow, or null when the list carried no tally. */
export function sortedShare(s: WinnowSession): number | null {
  if (typeof s.unrated_count !== 'number' || s.asset_count <= 0) return null;
  return Math.min(1, Math.max(0, 1 - s.unrated_count / s.asset_count));
}

function segments(path: string): string[] {
  return path.split(/[\\/]+/).filter(Boolean);
}

interface Draft {
  name: string;
  path: string;
  session: WinnowSession | null;
  kids: Map<string, Draft>;
}

/** Build the tree. `zone` is for tests; the browser's own zone otherwise. */
export function folderTree(list: readonly WinnowSession[], zone?: string): FolderNode {
  const root: Draft = { name: '', path: '', session: null, kids: new Map() };
  for (const s of list) {
    const parts = segments(s.source_path || s.name);
    if (parts.length === 0) parts.push(s.name || String(s.id));
    let node = root;
    for (const part of parts) {
      let next = node.kids.get(part);
      if (!next) {
        next = { name: part, path: node.path ? `${node.path}/${part}` : part, session: null, kids: new Map() };
        node.kids.set(part, next);
      }
      node = next;
    }
    // Two Winnow folders on one path (two roots): the second becomes a sibling.
    if (node.session) {
      const twin: Draft = { name: `${node.name} (${s.id})`, path: `${node.path}#${s.id}`, session: s, kids: new Map() };
      const parent = parts.length > 1 ? findDraft(root, parts.slice(0, -1)) : root;
      parent?.kids.set(twin.name, twin);
    } else {
      node.session = s;
    }
  }
  return finish(root, true, zone);
}

function findDraft(root: Draft, parts: string[]): Draft | null {
  let node: Draft | undefined = root;
  for (const p of parts) node = node?.kids.get(p);
  return node ?? null;
}

function finish(d: Draft, isRoot: boolean, zone: string | undefined): FolderNode {
  // Merge a single-child chain of parents into one step.
  let name = d.name;
  let path = d.path;
  let session = d.session;
  let kids = d.kids;
  while (!isRoot && !session && kids.size === 1) {
    const only = kids.values().next().value as Draft;
    if (only.kids.size === 0) break; // never fold a parent into the leaf it holds
    name = `${name}/${only.name}`;
    path = only.path;
    session = only.session;
    kids = only.kids;
  }
  const children = [...kids.values()].map((k) => finish(k, false, zone));
  if (session && children.length > 0) {
    children.unshift(leaf(OWN_MEDIA, `${path}#own`, session, zone));
    session = null;
  }
  if (children.length === 0 && session) return leaf(name, path, session, zone);
  return gather(name, path, children);
}

function leaf(name: string, path: string, s: WinnowSession, zone: string | undefined): FolderNode {
  const days = folderDays(s, zone);
  return {
    name,
    path,
    session: s,
    children: [],
    sessions: [s],
    count: s.asset_count,
    from: days.from,
    to: days.to,
    sorted: sortedShare(s),
  };
}

function gather(name: string, path: string, children: FolderNode[]): FolderNode {
  const sessions = children.flatMap((c) => c.sessions);
  sessions.sort((a, b) => (b.captured_at_max ?? '').localeCompare(a.captured_at_max ?? ''));
  let count = 0;
  let from: string | null = null;
  let to: string | null = null;
  let known = 0;
  let done = 0;
  for (const c of children) {
    count += c.count;
    if (c.from && (!from || c.from < from)) from = c.from;
    if (c.to && (!to || c.to > to)) to = c.to;
    if (c.sorted !== null) {
      known += c.count;
      done += c.sorted * c.count;
    }
  }
  return {
    name,
    path,
    session: null,
    children: orderFolders(children, 'time'),
    sessions,
    count,
    from,
    to,
    sorted: known > 0 ? done / known : null,
  };
}

/**
 * A level's folders in order: the newest shot first (as Winnow sends them),
 * or A–Z (his pick 6a). The own-media leaf always stays first.
 */
export function orderFolders(nodes: readonly FolderNode[], order: FolderOrder): FolderNode[] {
  const own = nodes.filter((n) => n.name === OWN_MEDIA && n.session);
  const rest = nodes.filter((n) => !own.includes(n));
  rest.sort(
    order === 'name'
      ? (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
      : (a, b) => (b.to ?? '').localeCompare(a.to ?? '') || a.name.localeCompare(b.name, undefined, { numeric: true }),
  );
  return [...own, ...rest];
}

/** The nodes from the root's child down to the one that opens `sessionId`, or null when it is not in the tree. */
export function chainTo(root: FolderNode, sessionId: number): FolderNode[] | null {
  for (const c of root.children) {
    if (c.session?.id === sessionId) return [c];
    const below = chainTo(c, sessionId);
    if (below) return [c, ...below];
  }
  return null;
}

/** The node at `path`, or null. */
export function nodeAt(root: FolderNode, path: string): FolderNode | null {
  if (root.path === path) return root;
  for (const c of root.children) {
    if (c.path === path || path.startsWith(`${c.path}/`) || path.startsWith(`${c.path}#`)) {
      const hit = nodeAt(c, path);
      if (hit) return hit;
    }
  }
  return null;
}

/** Lower case, accents gone: `Août` and `aout` are the same word (Postel). */
export function foldText(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function words(query: string): string[] {
  return foldText(query).split(/\s+/).filter(Boolean);
}

/**
 * The folders a query finds: EVERY word must appear somewhere in the folder's
 * path, its device or its local days — so `nov 26` finds `novembre 2026` and
 * `a7` the body. Newest first, as listed.
 */
export function matchFolders(list: readonly WinnowSession[], query: string, zone?: string): WinnowSession[] {
  const ws = words(query);
  if (ws.length === 0) return [];
  return list.filter((s) => {
    const d = folderDays(s, zone);
    const hay = foldText(`${s.source_path} ${s.name} ${s.device_hint ?? ''} ${d.from ?? ''} ${d.to ?? ''}`);
    return ws.every((w) => hay.includes(w));
  });
}

/**
 * Where a query's words fall in `text`, as `[start, end)` ranges merged and
 * in order — what a row underlines. Folding keeps one character per character
 * for the Latin accents a path carries, so indexes map back to `text`.
 */
export function matchRanges(text: string, query: string): [number, number][] {
  const ws = words(query);
  if (ws.length === 0) return [];
  const folded = foldText(text);
  if (folded.length !== text.length) return [];
  const marks = new Array<boolean>(text.length).fill(false);
  for (const w of ws) {
    for (let i = folded.indexOf(w); i >= 0; i = folded.indexOf(w, i + 1)) {
      for (let j = i; j < i + w.length; j++) marks[j] = true;
    }
  }
  const out: [number, number][] = [];
  for (let i = 0; i < marks.length; i++) {
    if (!marks[i]) continue;
    const start = i;
    while (i < marks.length && marks[i]) i++;
    out.push([start, i]);
  }
  return out;
}

/** The recent folders with `id` first, without repeats, at most `max` (his pick 5a: five). */
export function pushRecent(recent: readonly number[], id: number, max = 5): number[] {
  return [id, ...recent.filter((r) => r !== id)].slice(0, max);
}

/** A parent of `path` for a row's second line: its segments joined by `›`, or `''` at the top. */
export function parentLabel(path: string): string {
  return segments(path.split('#')[0]).slice(0, -1).join(' › ');
}

/** The nodes from the root's child down to the node at `path` (empty for the root), or null when no node is there. */
export function trailTo(root: FolderNode, path: string): FolderNode[] | null {
  if (path === root.path) return [];
  for (const c of root.children) {
    if (c.path === path) return [c];
    if (path.startsWith(`${c.path}/`)) {
      const below = trailTo(c, path);
      if (below) return [c, ...below];
    }
  }
  return null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** A row's days, short: `22 Nov 26`, `15–16 Nov 26`, `30 Sep → 2 Oct 26`, `28 Dec 25 → 2 Jan 26`, or `—`. */
export function shortDays(from: string | null, to: string | null): string {
  const a = from ?? to;
  const b = to ?? from;
  if (!a || !b) return '—';
  const d = (s: string) => String(Number(s.slice(8, 10)));
  const m = (s: string) => MONTHS[Number(s.slice(5, 7)) - 1] ?? s.slice(5, 7);
  const y = (s: string) => s.slice(2, 4);
  if (a === b) return `${d(a)} ${m(a)} ${y(a)}`;
  if (a.slice(0, 7) === b.slice(0, 7)) return `${d(a)}–${d(b)} ${m(b)} ${y(b)}`;
  if (a.slice(0, 4) === b.slice(0, 4)) return `${d(a)} ${m(a)} → ${d(b)} ${m(b)} ${y(b)}`;
  return `${d(a)} ${m(a)} ${y(a)} → ${d(b)} ${m(b)} ${y(b)}`;
}
