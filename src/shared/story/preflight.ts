/**
 * What would come out WRONG in a post's export, said before it is made
 * (strategy R1, his « termine les phases … pour que je puisse enfin m'en
 * servir »): a fact drawn in braces because nothing counted it, a map whose
 * tiles are not here, a wall whose pictures are not on this device, a face
 * the browser has not loaded, words under a platform's buttons, a hook
 * shrunk to stay in its lines. Each of these used to fail SILENTLY in the
 * MP4. Every issue names the one place that fixes it — a panel of the
 * Studio, or an object at a moment — so the list is a list of clicks, never
 * of reading. Nothing here blocks an export: it is his call. (pure)
 */
import type { SafeZonePreset } from '../overlay/guides';
import type { Episode } from './episode';
import { PLACEHOLDER } from './story-facts';
import { isPlaceholderCaption } from './story-script';
import { DEFAULT_ROLES, FONT_ROLES, isStoryFont, STORY_FONTS, type FontRole, type StoryFontId } from './fonts';
import type { StyleBook } from './objects';

/** Where an issue is fixed: a panel of the Studio, or an object of the post at a moment. */
export type PreflightFix =
  | { kind: 'panel'; id: 'sources' | 'charte' | 'hook' | 'script' | 'sound'; label: string }
  | { kind: 'object'; key: string; slot: string; at: number; label: string };

export interface PreflightIssue {
  /** Stable across runs, so the list does not flicker as it is recomputed. */
  id: string;
  /** `stop`: the file would show it plainly (braces, a fallback face); `warn`: worth a look. */
  level: 'stop' | 'warn';
  title: string;
  detail: string;
  fix?: PreflightFix;
}

/** A text object's ink at a moment, in the frame's pixels (`stage-pick.ts`'s `boxOf`). */
export interface InkBox {
  key: string;
  slot: string;
  label: string;
  at: number;
  box: { x: number; y: number; w: number; h: number };
}

export interface PreflightInput {
  episode: Episode;
  /** Each block's scene — its slot and when its caption shows on the post's clock (`sceneSpans`) — for a caption's object. */
  scenes?: readonly ({ slot: string; at: number } | null)[];
  /** The maps' ground the series asks, and where its tiles stand (`use-map-ground.ts`). */
  ground?: { asked: 'outline' | 'none' | 'tiles'; state: 'off' | 'not-allowed' | 'loading' | 'ready' | 'failed'; message?: string };
  /** The wall's counted pictures and how many are on this device (`use-wall.ts`); null when the post has no wall. */
  wall?: { counted: number; here: number; loading: boolean } | null;
  /** The faces the post is set in that this browser has not loaded. */
  missingFaces?: readonly string[];
  /** The text objects' ink, and the platform whose buttons they must avoid. */
  ink?: readonly InkBox[];
  zone?: SafeZonePreset | null;
  /** The hook's big text and second line: how far each was shrunk to keep its lines (1 = not at all). */
  hookScale?: { big: number; second: number | null } | null;
}


/** Every `{fact}` left in a text, by name. (pure) */
export function factsLeft(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER)].map((m) => m[1]);
}

/** The strings a value holds, deep (block params are plain data). */
function stringsOf(v: unknown, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || v === null || v === undefined) return out;
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) stringsOf(x, out, depth + 1);
  else if (typeof v === 'object' && Object.getPrototypeOf(v) === Object.prototype) for (const x of Object.values(v)) stringsOf(x, out, depth + 1);
  return out;
}

/** The facts no counting filled, where each is drawn: the braces would be in the file. (pure) */
export function uncountedFacts(ep: Episode, scenes: PreflightInput['scenes'] = []): PreflightIssue[] {
  const found = new Map<string, { where: string; fix: PreflightFix }>();
  const sources: PreflightFix = { kind: 'panel', id: 'sources', label: 'Count in Sources' };
  const note = (texts: string[], where: string, fix: PreflightFix) => {
    for (const t of texts) for (const f of factsLeft(t)) if (!found.has(f)) found.set(f, { where, fix });
  };
  note([ep.title, ep.cover?.line ?? ''], 'the title', sources);
  note(ep.hook?.lines ?? [], 'the hook', sources);
  ep.blocks.forEach((b, i) => {
    const scene = scenes[i] ?? null;
    if (b.cap?.text) note([b.cap.text], `the caption of scene ${i + 1}`, scene ? { kind: 'object', key: 'caption', slot: scene.slot, at: scene.at, label: 'Open the caption' } : sources);
    note(stringsOf(b.params), `scene ${i + 1}`, sources);
  });
  return [...found].map(([fact, { where, fix }]) => ({
    id: `fact:${fact}`,
    level: 'stop',
    title: `{${fact}} is not counted`,
    detail: `It would be drawn with its braces in ${where}. Count the sources, or type the number in the script.`,
    fix,
  }));
}

/** The scenes whose caption is still the placeholder: « ⟨ caption 2 ⟩ » would be in the file. (pure) */
export function placeholderCaptions(ep: Episode, scenes: PreflightInput['scenes'] = []): PreflightIssue[] {
  return ep.blocks.flatMap((b, i): PreflightIssue[] => {
    if (!b.cap?.text || !isPlaceholderCaption(b.cap.text)) return [];
    const scene = scenes[i] ?? null;
    return [
      {
        id: `placeholder:${i}`,
        level: 'stop',
        title: `Scene ${i + 1} has no caption yet`,
        detail: `« ${b.cap.text.trim()} » would be drawn in the file. Type its words, or empty the caption's window.`,
        ...(scene ? { fix: { kind: 'object' as const, key: 'caption', slot: scene.slot, at: scene.at, label: 'Type it' } } : {}),
      },
    ];
  });
}

/** The map's tiles the series asks for and this device has not got: the export would draw the land without them. (pure) */
export function groundIssue(g: PreflightInput['ground'], hasMap: boolean): PreflightIssue | null {
  if (!g || !hasMap || g.asked !== 'tiles' || g.state === 'ready') return null;
  const why =
    g.state === 'not-allowed'
      ? 'This device has not said yes to OpenStreetMap’s tiles.'
      : g.state === 'loading'
        ? 'They are still loading; the export waits for them.'
        : g.state === 'failed'
          ? `They could not be fetched${g.message ? `: ${g.message.replace(/\.$/, '')}` : ''}.`
          : 'They are switched off.';
  return {
    id: 'ground',
    level: g.state === 'loading' ? 'warn' : 'stop',
    title: 'The map’s tiles are not here',
    detail: `${why} Without them the maps are drawn on the charte’s ground.`,
    fix: { kind: 'panel', id: 'charte', label: 'Maps' },
  };
}

/** The wall's pictures: never counted (colour tiles), or not all on this device. (pure) */
export function wallIssue(w: PreflightInput['wall']): PreflightIssue | null {
  if (!w) return null;
  if (w.counted === 0)
    return {
      id: 'wall',
      level: 'warn',
      title: 'The wall shows colour tiles',
      detail: 'No counting chose its pictures yet: Count on a Winnow, or pick them by hand.',
      fix: { kind: 'panel', id: 'sources', label: 'Sources' },
    };
  if (w.loading)
    return {
      id: 'wall',
      level: 'warn',
      title: 'The wall’s pictures are still arriving',
      detail: `${w.here} of ${w.counted} are on this device. Wait for them: the file draws what is here when it starts.`,
    };
  if (w.here < w.counted)
    return {
      id: 'wall',
      level: 'warn',
      title: `${w.counted - w.here} of the wall’s pictures are missing`,
      detail: 'Their places would be colour tiles. Connect the Winnow they came from, or count again.',
      fix: { kind: 'panel', id: 'sources', label: 'Sources' },
    };
  return null;
}

/** The faces the browser has not loaded: the file would set those words in a fallback. (pure) */
export function faceIssue(missing: readonly string[] | undefined): PreflightIssue | null {
  if (!missing?.length) return null;
  return {
    id: 'faces',
    level: 'stop',
    title: missing.length > 1 ? `${missing.length} faces are not loaded` : `${missing[0]} is not loaded`,
    detail: `${missing.join(', ')} — the words set in ${missing.length > 1 ? 'them' : 'it'} would fall back to another face. Reload the page once online.`,
    fix: { kind: 'panel', id: 'charte', label: 'Charte' },
  };
}

/** How much of `box` a dead zone of `zone` covers, as a share of the box, and that zone's name. (pure) */
export function deadOverlap(box: InkBox['box'], zone: SafeZonePreset, width = 1080, height = 1920): { share: number; label: string } | null {
  let best: { share: number; label: string } | null = null;
  const area = Math.max(1, box.w * box.h);
  for (const d of zone.deadzones) {
    const x0 = Math.max(box.x, d.x * width);
    const y0 = Math.max(box.y, d.y * height);
    const x1 = Math.min(box.x + box.w, (d.x + d.w) * width);
    const y1 = Math.min(box.y + box.h, (d.y + d.h) * height);
    if (x1 <= x0 || y1 <= y0) continue;
    const share = ((x1 - x0) * (y1 - y0)) / area;
    if (!best || share > best.share) best = { share, label: d.label ?? 'buttons' };
  }
  return best;
}

/** Below this share of its ink under a platform's buttons an object is left alone: a descender, a glow's edge. */
export const DEAD_TOLERANCE = 0.08;

/** The words that run under the platform's buttons — one issue an object, at its worst moment. (pure) */
export function safeZoneIssues(ink: readonly InkBox[] | undefined, zone: SafeZonePreset | null | undefined): PreflightIssue[] {
  if (!ink?.length || !zone) return [];
  const worst = new Map<string, { b: InkBox; share: number; label: string }>();
  for (const b of ink) {
    const o = deadOverlap(b.box, zone);
    if (!o || o.share < DEAD_TOLERANCE) continue;
    const id = `${b.slot}:${b.key}`;
    const was = worst.get(id);
    if (!was || o.share > was.share) worst.set(id, { b, ...o });
  }
  return [...worst.values()].map(({ b, share, label }) => ({
    id: `zone:${b.slot}:${b.key}`,
    level: 'warn',
    title: `${b.label} runs under ${zone.label}’s ${label.toLowerCase()}`,
    detail: `${Math.round(share * 100)} % of it at ${b.at.toFixed(1)} s. Move it or make it smaller.`,
    fix: { kind: 'object', key: b.key, slot: b.slot, at: b.at, label: `Select it at ${b.at.toFixed(1)} s` },
  }));
}

/** Below this the hook was shrunk enough to be read as smaller than the series' size. */
export const HOOK_SHRINK_SAID = 0.9;

/** The hook's lines shrunk to stay within the series' line limit. (pure) */
export function hookIssue(s: PreflightInput['hookScale']): PreflightIssue | null {
  if (!s) return null;
  const k = Math.min(s.big, s.second ?? 1);
  if (k >= HOOK_SHRINK_SAID) return null;
  return {
    id: 'hook',
    level: 'warn',
    title: `The hook is drawn at ${Math.round(k * 100)} % of its size`,
    detail: 'Its words are too many for its lines: shorten them, break them yourself, or allow more lines.',
    fix: { kind: 'panel', id: 'hook', label: 'Hook' },
  };
}

/**
 * The faces a post is set in: the charte's four roles, and every face an
 * object names in the series' settings or this post's — a role (`@title`)
 * read through the charte. (pure)
 */
export function facesUsed(roles: Partial<Record<FontRole, StoryFontId>> | undefined, ...books: (StyleBook | undefined)[]): StoryFontId[] {
  const r = { ...DEFAULT_ROLES, ...(roles ?? {}) };
  const out = new Set<StoryFontId>(FONT_ROLES.map((k) => r[k]));
  for (const book of books)
    for (const st of Object.values(book ?? {})) {
      const f = st?.font;
      if (!f) continue;
      const id = f.startsWith('@') ? r[f.slice(1) as FontRole] : f;
      if (isStoryFont(id)) out.add(id);
    }
  return [...out];
}

/** The CSS font specs a face ships, one per weight — what `document.fonts.check` is asked. (pure) */
export function faceSpecs(id: StoryFontId): string[] {
  const f = STORY_FONTS[id];
  return f.weights.map((w) => `${'italic' in f && f.italic ? 'italic ' : ''}${w} 40px ${f.family.split(',')[0]}`);
}

/** Every issue of the post, the ones the file would show plainly first. (pure) */
export function preflight(input: PreflightInput): PreflightIssue[] {
  const hasMap = input.episode.blocks.some((b) => b.block === 'map-camera' || b.block === 'map-holes' || b.block === 'journey-impossible');
  const all = [
    ...uncountedFacts(input.episode, input.scenes),
    ...placeholderCaptions(input.episode, input.scenes),
    faceIssue(input.missingFaces),
    groundIssue(input.ground, hasMap),
    wallIssue(input.wall),
    hookIssue(input.hookScale),
    ...safeZoneIssues(input.ink, input.zone),
  ].filter((x): x is PreflightIssue => x !== null);
  return [...all.filter((i) => i.level === 'stop'), ...all.filter((i) => i.level === 'warn')];
}
