/**
 * What an agent reads of a post and how it sets an object — the pure half of
 * Storytelling's commands (`agent-commands.md`; registered by `PostEditor`).
 * The registry refuses an unknown or out-of-range PARAM; a style is one
 * object param, so its fields are checked here by the same rule: refused,
 * never clamped. (pure)
 */
import { readStyle, type ObjectStyle } from './objects';
import { objectLabel, type ObjectTrack, type SceneSpan } from './studio';

/** Every field an object's style may set (`ObjectStyle`). */
export const STYLE_KEYS: readonly (keyof ObjectStyle)[] = [
  'hidden',
  'dx',
  'dy',
  'scale',
  'rotate',
  'opacity',
  'font',
  'weight',
  'size',
  'tracking',
  'color',
  'textCase',
  'outline',
  'outlineColor',
  'shadow',
  'shadowY',
  'shadowOpacity',
  'shadowColor',
  'delay',
];

export type StylePatch = Partial<Record<keyof ObjectStyle, unknown>>;

/**
 * A style patch from an agent: each field kept only when `readStyle` keeps it
 * AS GIVEN, `null` (and `hidden: false`) clearing it; anything else is refused
 * with the field named.
 */
export function checkStylePatch(raw: unknown): { ok: true; patch: StylePatch } | { ok: false; reason: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'style must be an object of fields' };
  const entries = Object.entries(raw);
  if (!entries.length) return { ok: false, reason: 'style names no field' };
  const patch: StylePatch = {};
  for (const [k, v] of entries) {
    if (!(STYLE_KEYS as readonly string[]).includes(k)) return { ok: false, reason: `unknown field “${k}” (one of ${STYLE_KEYS.join(', ')})` };
    const key = k as keyof ObjectStyle;
    if (v === null || (key === 'hidden' && v === false)) {
      patch[key] = undefined;
      continue;
    }
    const kept = readStyle({ [key]: v })?.[key];
    if (kept !== v) return { ok: false, reason: `${k}: ${JSON.stringify(v)} is out of range or not a ${k === 'color' || k.endsWith('Color') ? 'palette token (@ink…) or #hex' : k === 'font' ? 'font role (@title…) or face id' : 'valid value'}` };
    patch[key] = v;
  }
  return { ok: true, patch };
}

const r1 = (n: number) => Math.round(n * 10) / 10;

/** The post as an agent reads it: its scenes on the post's clock (a caption's window is on its scene's own, from `start`), and every object with when it is on the stage. */
export function postOutline(scenes: readonly SceneSpan[], tracks: readonly ObjectTrack[]) {
  return {
    scenes: scenes.map((s) => ({
      slot: s.key,
      block: s.block,
      label: objectLabel(s.block),
      from: r1(s.a),
      to: r1(s.b),
      caption: s.cap ? { from: r1(s.start + s.cap.a), to: r1(s.start + s.cap.b) } : null,
    })),
    objects: tracks.map((t) => ({ key: t.key, label: objectLabel(t.key), slot: t.slot, text: t.text, on: t.spans.map(([a, b]) => [r1(a), r1(b)]) })),
  };
}
