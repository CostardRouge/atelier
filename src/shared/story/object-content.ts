/**
 * What an object of the Studio SAYS and where its words come from (Studio
 * lab https://claude.ai/artifact/MpgJfZ6ZWw4MWXgLLx2R6P, his « je peux le
 * déplacer … mais je ne peux pas modifier le texte … je suis obligé de deviner
 * d'où vient le texte »): one answer per object key, read by the inspector's
 * Content section — the words where they can be typed (the hook's lines, a
 * caption, the camera), the source where they are computed (the header from
 * the series' name and the post's number, the place from the map, why now
 * from the trip's first day) with this post's own override, the licence that
 * fixes the map's credit. An object this file does not know shows no Content
 * section. (pure)
 */
import { hookBadgeContent, hookBadgeOf, withPostBadge, type HookSeries } from './hook-badge';
import type { Hook } from './hook';
import { withPostHooks } from './sources';
import type { ScriptBlock, StoryScript } from './story-script';

/** Where the rest of an object's settings are, as the Studio names its panels. */
export type ContentLink = 'hook' | 'script' | 'sources';

export interface ContentField {
  label: string;
  value: string;
  placeholder?: string;
  /** A caption runs over lines; a piece of the badge is one. */
  multiline?: boolean;
  /** The script with the field's new words; an empty field takes this post's own words away. */
  write: (script: StoryScript, value: string) => StoryScript;
}

export interface ObjectContent {
  /** What it shows now; null when the field below says it. */
  says: string | null;
  /** Where its words come from, in a few words. */
  from: string;
  /** How it is made: typed for this post, computed from the series, counted from a source, fixed by a licence, or no words. */
  kind: 'this post' | 'computed' | 'counted' | 'licence' | 'no text';
  field?: ContentField;
  link?: { to: ContentLink; label: string };
}

export interface ContentContext {
  script: StoryScript;
  postId: string;
  /** The post's hook as it plays (its active variant), and which variant that is. */
  hook: Hook | null;
  hookIndex: number;
  /** What the badge's computed pieces are made of (`hookSeriesOf`). */
  series: HookSeries | null;
  /** The scene the object is drawn in, by its index among the post's blocks (null over every scene). */
  sceneIndex: number | null;
  /** This post's number as the series gives it (`EP.04`). */
  number: string;
}

const LETTERS = 'ABCDE';

/** The script with this post's active hook changed. */
function withHook(script: StoryScript, postId: string, index: number, patch: (h: Hook) => Hook): StoryScript {
  const hooks = script.posts[postId]?.hooks ?? [];
  if (!hooks[index]) return script;
  return withPostHooks(script, postId, { hooks: hooks.map((h, i) => (i === index ? patch(h) : h)) });
}

/** The script with one of this post's block captions changed; empty takes it away (the skeleton's shows). (pure) */
export function withBlockCaption(script: StoryScript, postId: string, index: number, caption: string): StoryScript {
  const post = { ...(script.posts[postId] ?? {}) };
  const blocks: ScriptBlock[] = [...(post.blocks ?? [])];
  while (blocks.length <= index) blocks.push({});
  const block = { ...blocks[index] };
  if (caption.trim()) block.caption = caption;
  else delete block.caption;
  blocks[index] = block;
  post.blocks = blocks;
  return { ...script, posts: { ...script.posts, [postId]: post } };
}

/** The script with this post's own number (the HUD's, the header's), or the series' again when empty. (pure) */
export function withPostNumber(script: StoryScript, postId: string, number: string): StoryScript {
  const post = { ...(script.posts[postId] ?? {}) };
  if (number.trim()) post.number = number.trim().slice(0, 24);
  else delete post.number;
  return { ...script, posts: { ...script.posts, [postId]: post } };
}

/** The facts a text cites (`{media.total}`), for the line that says they are counted. */
const citedFacts = (text: string): string[] => [...text.matchAll(/\{([a-z0-9._]+)\}/gi)].map((m) => m[1]);

/** What the object `key` says and where its words come from; null for an object with nothing to say here. (pure) */
export function objectContent(key: string, ctx: ContentContext): ObjectContent | null {
  const { script, postId, hook, hookIndex, series } = ctx;
  const variant = (script.posts[postId]?.hooks?.length ?? 0) > 1 ? `, variant ${LETTERS[hookIndex] ?? hookIndex + 1}` : '';
  const ownNumber = script.posts[postId]?.number;
  const numberField: ContentField = {
    label: "This post's number",
    value: ownNumber ?? '',
    placeholder: ctx.number,
    write: (sc, v) => withPostNumber(sc, postId, v),
  };

  if (key === 'hook.big' || key === 'hook.second') {
    if (!hook) return null;
    const line = key === 'hook.big' ? 0 : 1;
    return {
      says: null,
      from: `The hook's ${line ? 'second' : 'first'} line${variant}${line && (hook.sticker ?? 1) === 1 ? ' — it lands as the sticker' : ''}.`,
      kind: 'this post',
      field: {
        label: line ? 'The second line' : 'The big text',
        value: hook.lines[line] ?? '',
        placeholder: line ? 'A second line, or none' : 'The hook’s first words',
        // Return starts a new line in the badge (`setInColumn` keeps his breaks).
        multiline: true,
        write: (sc, v) =>
          withHook(sc, postId, hookIndex, (h) => {
            const lines = [...h.lines];
            lines[line] = v;
            // The first line is the hook itself; an emptied second line goes.
            return { ...h, lines: line === 1 && !v.trim() ? lines.slice(0, 1) : lines };
          }),
      },
      link: { to: 'hook', label: 'All the hook’s settings' },
    };
  }

  if (key === 'hook.header' || key === 'hook.place' || key === 'hook.why' || key === 'hook.camera') {
    if (!hook) return null;
    const piece = key.slice(5) as 'header' | 'place' | 'why' | 'camera';
    // What the series computes, this post's own words left out.
    const look = hookBadgeOf(withPostBadge(script.look?.hook, hook));
    const computed = series ? hookBadgeContent({ ...hook, pieces: undefined }, { ...look, pieces: { ...look.pieces, [piece]: true } }, series) : null;
    const value = { header: computed?.kicker, place: computed?.caption, why: computed?.timing, camera: null }[piece] ?? '';
    const own = hook.pieces?.[piece] ?? '';
    const from = {
      header: "The series' name (Script) and this post's number.",
      place: "The map's first and last stop.",
      why: "The trip's first day, counted to the day the post is exported.",
      camera: 'Only this post can name it.',
    }[piece];
    return {
      says: piece === 'camera' ? null : value || null,
      from,
      kind: piece === 'camera' ? 'this post' : 'computed',
      field: {
        label: piece === 'camera' ? 'The camera' : "This post's own",
        value: own,
        placeholder: piece === 'camera' ? 'Sony A7C II · DJI Mini 4 Pro' : 'Empty: as computed',
        write: (sc, v) =>
          withHook(sc, postId, hookIndex, (h) => {
            const pieces = { ...(h.pieces ?? {}), [piece]: v.trim() ? v : undefined };
            for (const k of Object.keys(pieces) as (keyof typeof pieces)[]) if (!pieces[k]) delete pieces[k];
            return { ...h, pieces: Object.keys(pieces).length ? pieces : undefined };
          }),
      },
      link: piece === 'header' ? { to: 'script', label: "The series' name" } : piece === 'place' ? { to: 'sources', label: "The map's stops" } : undefined,
    };
  }

  // The hook itself shows its whole panel above its place (the Studio's Hook object): nothing to add here.
  if (key === 'hook.veil' || key === 'hook.band') {
    return {
      says: null,
      from: key === 'hook.veil' ? 'A darkening of the picture behind the words; its strength is the hook’s Veil.' : 'The band behind the badge, from its composition.',
      kind: 'no text',
      link: { to: 'hook', label: 'All the hook’s settings' },
    };
  }

  if (key === 'caption' && ctx.sceneIndex !== null) {
    const index = ctx.sceneIndex;
    const caption = script.posts[postId]?.blocks?.[index]?.caption ?? '';
    const facts = citedFacts(caption);
    return {
      says: null,
      from: facts.length ? `This scene's caption, in the script. Its ${facts.map((f) => `{${f}}`).join(', ')} ${facts.length > 1 ? 'are' : 'is'} counted in Sources.` : "This scene's caption, in the script.",
      kind: 'this post',
      field: { label: 'The caption', value: caption, placeholder: 'What this scene says', multiline: true, write: (sc, v) => withBlockCaption(sc, postId, index, v) },
      ...(facts.length ? { link: { to: 'sources' as const, label: 'Count again in Sources' } } : {}),
    };
  }

  if (key === 'hud' || key === 'hud.number') {
    return {
      says: ownNumber ?? ctx.number,
      from: ownNumber ? "This post's own number." : "This post's number in the series; the hook's header shows it too.",
      kind: ownNumber ? 'this post' : 'computed',
      field: numberField,
    };
  }

  if (key === 'map.credit') {
    return { says: '© OpenStreetMap contributors', from: "The tiles' licence asks for it: it moves and changes face, never its words.", kind: 'licence' };
  }

  return null;
}
