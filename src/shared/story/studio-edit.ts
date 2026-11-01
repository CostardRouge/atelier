/**
 * The Studio's writes into the private script (pure): an object's settings
 * for the whole series or this post alone, the charte, a scene's length and
 * its caption's window. A field set to `undefined` is removed, and a book or
 * a charte left empty leaves no trace, so a script keeps only what was set.
 */
import type { Charte, ObjectStyle, StyleBook } from './objects';
import type { ScriptBlock, StoryScript } from './story-script';

/** Where an object's settings are kept: for every post of the series, or this post alone. */
export type StyleScope = 'series' | 'post';

/** An object's settings as kept at one level. */
export function styleIn(script: StoryScript | null, postId: string, key: string, scope: StyleScope): ObjectStyle {
  const book = scope === 'series' ? script?.look?.objects : script?.posts[postId]?.objects;
  return book?.[key] ?? {};
}

const tidy = <T extends object>(o: T): T => {
  const out = { ...o };
  for (const k of Object.keys(out) as (keyof T)[]) if (out[k] === undefined) delete out[k];
  return out;
};

function withBook(book: StyleBook | undefined, key: string, style: ObjectStyle | null): StyleBook | undefined {
  const next: StyleBook = { ...(book ?? {}) };
  if (style && Object.keys(style).length) next[key] = style;
  else delete next[key];
  return Object.keys(next).length ? next : undefined;
}

function withSeriesBook(script: StoryScript, book: StyleBook | undefined): StoryScript {
  const look = { ...(script.look ?? {}) };
  if (book) look.objects = book;
  else delete look.objects;
  const next: StoryScript = { ...script, look };
  if (!Object.keys(look).length) delete next.look;
  return next;
}

function withPostBook(script: StoryScript, postId: string, book: StyleBook | undefined): StoryScript {
  const post = { ...(script.posts[postId] ?? {}) };
  if (book) post.objects = book;
  else delete post.objects;
  return { ...script, posts: { ...script.posts, [postId]: post } };
}

/** The script with an object's settings changed at one level — `undefined` removes a field. */
export function withStyle(script: StoryScript, postId: string, key: string, patch: Partial<Record<keyof ObjectStyle, unknown>>, scope: StyleScope): StoryScript {
  const style = tidy({ ...styleIn(script, postId, key, scope), ...patch } as ObjectStyle);
  return scope === 'series'
    ? withSeriesBook(script, withBook(script.look?.objects, key, style))
    : withPostBook(script, postId, withBook(script.posts[postId]?.objects, key, style));
}

/** The script with an object's settings at one level forgotten. */
export function withoutStyle(script: StoryScript, postId: string, key: string, scope: StyleScope): StoryScript {
  return scope === 'series'
    ? withSeriesBook(script, withBook(script.look?.objects, key, null))
    : withPostBook(script, postId, withBook(script.posts[postId]?.objects, key, null));
}

/** The script with the charte changed — a palette token or a font role set to `undefined` goes back to the default; null forgets it all. */
export function withCharte(script: StoryScript, patch: Partial<Charte> | null): StoryScript {
  const was = script.look?.charte ?? {};
  let charte: Charte = {};
  if (patch) {
    charte = tidy({
      ...was,
      ...patch,
      palette: patch.palette ? tidy({ ...(was.palette ?? {}), ...patch.palette }) : was.palette,
      fonts: patch.fonts ? tidy({ ...(was.fonts ?? {}), ...patch.fonts }) : was.fonts,
    });
    if (charte.palette && !Object.keys(charte.palette).length) delete charte.palette;
    if (charte.fonts && !Object.keys(charte.fonts).length) delete charte.fonts;
  }
  const look = { ...(script.look ?? {}) };
  if (Object.keys(charte).length) look.charte = charte;
  else delete look.charte;
  const next: StoryScript = { ...script, look };
  if (!Object.keys(look).length) delete next.look;
  return next;
}

/** The script with one of a post's scenes timed anew: its length and its caption's window — null goes back to the skeleton's. */
export function withSceneTiming(
  script: StoryScript,
  postId: string,
  index: number,
  timing: { len?: number | null; cap?: { a: number; b: number } | null },
): StoryScript {
  const post = { ...(script.posts[postId] ?? {}) };
  const blocks: ScriptBlock[] = [...(post.blocks ?? [])];
  while (blocks.length <= index) blocks.push({});
  const block: ScriptBlock = { ...blocks[index] };
  if (timing.len !== undefined) {
    if (timing.len === null) delete block.len;
    else block.len = Math.round(Math.min(60, Math.max(0.5, timing.len)) * 100) / 100;
  }
  if (timing.cap !== undefined) {
    if (timing.cap === null) delete block.cap;
    else {
      const a = Math.round(Math.max(0, timing.cap.a) * 100) / 100;
      block.cap = { a, b: Math.round(Math.max(a + 0.2, timing.cap.b) * 100) / 100 };
    }
  }
  blocks[index] = block;
  post.blocks = blocks;
  return { ...script, posts: { ...script.posts, [postId]: post } };
}
