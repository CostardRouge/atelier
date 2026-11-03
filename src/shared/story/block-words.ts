/**
 * The WORDS each block draws, declared once (strategy R3, « click a word,
 * edit that word »): which of a block's params are words, which object of
 * the block shows each, and how it is typed — a line, lines, a number (or a
 * counted `{fact}`), or rows of a few fields (a device's name, note and
 * kind; a wrong name, its right one and the distance). The inspector's
 * Content section reads this for the object clicked (`object-content.ts`),
 * so the blocks' words are reachable without opening the script. A row is
 * typed as one line, its fields separated by « · ». (pure)
 */
import type { ScriptBlock, StoryScript } from './story-script';

export type WordKind = 'text' | 'lines' | 'number' | 'rows';

export interface WordField {
  /** The block's param. */
  param: string;
  label: string;
  kind: WordKind;
  /** The block's parts that show it (the object key's suffix); absent = every part. */
  on?: readonly string[];
  /** For rows: the fields of one row, in order. */
  cols?: readonly string[];
  /** For rows: how one row is written, as help. */
  example?: string;
}

const t = (param: string, label: string, on?: string[]): WordField => ({ param, label, kind: 'text', ...(on ? { on } : {}) });
const n = (param: string, label: string, on?: string[]): WordField => ({ param, label, kind: 'number', ...(on ? { on } : {}) });

export const BLOCK_WORDS: Record<string, readonly WordField[]> = {
  counter: [n('to', 'The number', ['number']), n('from', 'Counting from', ['number']), t('unit', 'Its unit', ['number']), t('label', 'The label', ['label']), t('sub', 'The line under', ['sub'])],
  wall: [n('count', 'The number', ['number']), t('label', 'The word under', ['label'])],
  'before-after': [
    { param: 'before', label: 'Before, a line each', kind: 'lines', on: ['before'] },
    { param: 'after', label: 'After, a line each', kind: 'lines', on: ['after'] },
    t('label', 'The label', ['label']),
    n('edit', 'Which developed picture (1 = the first)', ['before', 'after']),
  ],
  bursts: [n('n', 'Frames in the burst', ['count', 'frames'])],
  'card-recovery': [t('file', 'The file', ['file', 'card'])],
  clocks: [
    t('zoneA', 'Where the camera is', ['camera-clock', 'camera-time']),
    t('zoneB', 'Where its clock is set', ['home-clock', 'home-time']),
    n('offsetHours', 'Hours between them', ['camera-time', 'home-time', 'day-line']),
    n('pctWrong', 'Share on the wrong day, %', ['share', 'photos']),
  ],
  gear: [{ param: 'devices', label: 'The devices, one a line', kind: 'rows', cols: ['name', 'note', 'kind'], example: 'Sony A7C II · the main camera · camera' }],
  'journey-impossible': [t('from', 'From', ['from']), t('to', 'To', ['to']), n('km', 'The distance, km', ['distance', 'line'])],
  names: [{ param: 'pairs', label: 'The names, one pair a line', kind: 'rows', cols: ['wrong', 'right', 'km'], example: 'Byron · Byron Bay · 12 km' }],
  'season-recap': [{ param: 'episodes', label: 'The posts, one a line', kind: 'rows', cols: ['number', 'title', 'line'], example: 'EP.01 · The arrival · what it taught' }],
  transfer: [t('card', 'The card', ['card']), n('total', 'Files copied', ['total', 'count', 'copied']), t('prefix', 'Files’ names start', ['files']), t('ext', 'Their extension', ['files'])],
  app: [t('title', 'The window’s title', ['window']), t('flag', 'The flag', ['flag'])],
  folders: [
    { param: 'path', label: 'The path, a folder a line', kind: 'lines', on: ['path'] },
    { param: 'columns', label: 'The columns, one a line', kind: 'rows', cols: ['items'], on: ['columns', 'window'], example: '2024, 2025, *2026 (the * marks the open one)' },
    t('footnote', 'The note under', ['footnote']),
  ],
};

/** The block an object key belongs to, and its part: `counter.label` → counter, label; `counter` → counter, null. (pure) */
export function partOf(key: string): { block: string; part: string | null } {
  const dot = key.indexOf('.');
  return dot < 0 ? { block: key, part: null } : { block: key.slice(0, dot), part: key.slice(dot + 1) };
}

/** The word fields an object shows: its part's, or every field of the block for the scene itself. (pure) */
export function wordsOf(key: string): readonly WordField[] {
  const { block, part } = partOf(key);
  const all = BLOCK_WORDS[block] ?? [];
  return part === null ? all : all.filter((f) => !f.on || f.on.includes(part));
}

const SEP = ' · ';
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));

/** A param's value as the field types it. (pure) */
export function wordText(f: WordField, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (f.kind === 'lines') return Array.isArray(value) ? value.map(str).join('\n') : str(value);
  if (f.kind === 'rows') {
    if (!Array.isArray(value)) return '';
    if (f.cols?.length === 1 && f.cols[0] === 'items')
      return value
        .map((col) => {
          const c = (col ?? {}) as { items?: unknown[]; sel?: number };
          return (c.items ?? []).map((it, i) => (i === c.sel ? `*${str(it)}` : str(it))).join(', ');
        })
        .join('\n');
    return value.map((row) => (f.cols ?? []).map((k) => str((row as Record<string, unknown>)?.[k])).join(SEP).replace(/( · )+$/, '')).join('\n');
  }
  return str(value);
}

/** What a field's text becomes as a param; undefined = take this post's own away (the post's skeleton speaks). (pure) */
export function wordValue(f: WordField, text: string): unknown {
  if (!text.trim()) return undefined;
  if (f.kind === 'number') {
    const v = text.trim();
    const num = Number(v.replace(/[\s\u202f\u00a0]/g, '').replace(',', '.'));
    return v.startsWith('{') || !Number.isFinite(num) ? v : num;
  }
  if (f.kind === 'lines') return text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (f.kind === 'rows') {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (f.cols?.length === 1 && f.cols[0] === 'items')
      return lines.map((l) => {
        const items = l.split(',').map((s) => s.trim()).filter(Boolean);
        const sel = items.findIndex((s) => s.startsWith('*'));
        return { items: items.map((s) => s.replace(/^\*/, '')), ...(sel >= 0 ? { sel } : {}) };
      });
    return lines.map((l) => {
      const parts = l.split(/\s*·\s*/);
      const row: Record<string, string> = {};
      (f.cols ?? []).forEach((k, i) => {
        if (parts[i]) row[k] = parts[i];
      });
      return row;
    });
  }
  return text;
}

/** The script with one of a post's block params set, or taken away when `value` is undefined. (pure) */
export function withBlockParam(script: StoryScript, postId: string, index: number, param: string, value: unknown): StoryScript {
  const post = { ...(script.posts[postId] ?? {}) };
  const blocks: ScriptBlock[] = [...(post.blocks ?? [])];
  while (blocks.length <= index) blocks.push({});
  const params: Record<string, unknown> = { ...(blocks[index].params ?? {}) };
  if (value === undefined) delete params[param];
  else params[param] = value;
  const block: ScriptBlock = { ...blocks[index] };
  if (Object.keys(params).length) block.params = params;
  else delete block.params;
  blocks[index] = block;
  post.blocks = blocks;
  return { ...script, posts: { ...script.posts, [postId]: post } };
}
