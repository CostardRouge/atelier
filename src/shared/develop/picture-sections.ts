/**
 * A picture's settings in SECTIONS — the one picker every multi-part verb of
 * the Develop tool goes through (`docs/lightroom-gaps.md` §2, items 4, 5 and
 * 7): copy and paste (⌘⇧C / ⌘⇧V), apply to other pictures, reset.
 *
 * Before it, ⌘C carried the develop numbers alone, and "apply to the others"
 * existed for four of nine groups — a roll shot with one body and one lens
 * could not share its lens correction, its detail or its perspective, which
 * are exactly what a roll has in common. Lightroom's answer is a dialog of
 * checkboxes; this is its model.
 *
 * The sections are the ones `pictureEdits` already names, so "edited" and
 * "what can be copied" are ONE vocabulary. What never travels, whatever is
 * ticked: which FILE the picture is developed from and its RAW base (facts
 * about one capture's bytes), its delivery state, and its title and caption
 * (its own words).
 *
 * Pure and DOM-free.
 */

import { DEFAULT_DEVELOP, isDefaultDevelop, isRawDevelop, withoutBase, type DevelopSettings } from './develop';
import { pictureEdits, type PictureEdit, type RollDoc, type RollPicture } from './roll-types';

export type PictureSection = PictureEdit;

/** The sections in the inspector's own order, with what each carries. */
export const PICTURE_SECTIONS: readonly { id: PictureSection; label: string; hint: string }[] = [
  { id: 'develop', label: 'Develop', hint: 'exposure, tone, colour, curves, levels' },
  { id: 'look', label: 'Look', hint: 'LUTs, output transform, grain' },
  { id: 'crop', label: 'Crop', hint: 'aspect, framing, straighten, flip' },
  { id: 'border', label: 'Border', hint: 'the margin round the delivered picture' },
  { id: 'perspective', label: 'Perspective', hint: 'the keystone' },
  { id: 'lens', label: 'Lens', hint: 'distortion, fringing, vignetting' },
  { id: 'detail', label: 'Detail', hint: 'denoise, defringe, sharpen — and texture, clarity, dehaze' },
  { id: 'repair', label: 'Repair', hint: 'heal and clone spots — for dust on the sensor, the same place on every frame' },
  { id: 'layers', label: 'Layers', hint: 'masks and their adjustments' },
];

/**
 * What a copy ticks until the author says otherwise: the settings a roll
 * SHARES — one light, one look, one lens, one sensor — and not what belongs
 * to one frame's composition or to one frame's objects.
 */
export const DEFAULT_COPY_SECTIONS: readonly PictureSection[] = ['develop', 'look', 'lens', 'detail'];

const IDS: ReadonlySet<string> = new Set(PICTURE_SECTIONS.map((s) => s.id));

/** A stored list of sections, in the inspector's order, unknown ids dropped. */
export function readSections(raw: unknown, fallback: readonly PictureSection[] = DEFAULT_COPY_SECTIONS): PictureSection[] {
  if (!Array.isArray(raw)) return [...fallback];
  const wanted = new Set(raw.filter((x): x is string => typeof x === 'string' && IDS.has(x)));
  return PICTURE_SECTIONS.map((s) => s.id).filter((id) => wanted.has(id));
}

/** The develop a target keeps under `numbers`: its OWN base and gain, never the source's. */
function developOnto(target: RollPicture, numbers: DevelopSettings | null): DevelopSettings | null {
  const own = target.develop && isRawDevelop(target.develop) ? { base: target.develop.base, rawGain: target.develop.rawGain } : null;
  const value = numbers ? withoutBase(numbers) : null;
  const kept = value && !isDefaultDevelop(value) ? value : null;
  return kept || own ? { ...(kept ?? DEFAULT_DEVELOP), ...(own ?? {}) } : null;
}

/**
 * `target` wearing `source`'s settings in `sections`, each a copy of its own.
 * Everything else of the target — its file, its base, its words, its delivery
 * state, the sections not ticked — is left exactly as it was.
 */
export function withSections(target: RollPicture, source: RollPicture, sections: readonly PictureSection[]): RollPicture {
  const on = new Set(sections);
  const next: RollPicture = { ...target };
  if (on.has('develop')) next.develop = developOnto(target, source.develop);
  if (on.has('look')) next.grade = source.grade ? structuredClone(source.grade) : null;
  if (on.has('crop')) {
    next.aspect = source.aspect;
    next.framing = source.framing ? { ...source.framing } : null;
  }
  if (on.has('border')) next.border = source.border ? structuredClone(source.border) : null;
  if (on.has('perspective')) next.keystone = source.keystone ? structuredClone(source.keystone) : null;
  if (on.has('lens')) next.lens = source.lens ? structuredClone(source.lens) : null;
  if (on.has('detail')) next.detail = source.detail ? structuredClone(source.detail) : null;
  if (on.has('repair')) next.repair = structuredClone(source.repair ?? []);
  if (on.has('layers')) next.layers = structuredClone(source.layers ?? []);
  return next;
}

/** `picture` with `sections` back to as shot — its file, base, words and delivery state untouched. */
export function withoutSections(picture: RollPicture, sections: readonly PictureSection[]): RollPicture {
  const on = new Set(sections);
  const next: RollPicture = { ...picture };
  if (on.has('develop')) next.develop = developOnto(picture, null);
  if (on.has('look')) next.grade = null;
  if (on.has('crop')) {
    next.aspect = 'original';
    next.framing = null;
  }
  if (on.has('border')) next.border = null;
  if (on.has('perspective')) next.keystone = null;
  if (on.has('lens')) next.lens = null;
  if (on.has('detail')) next.detail = null;
  if (on.has('repair')) next.repair = [];
  if (on.has('layers')) next.layers = [];
  return next;
}

function sameSections(a: RollPicture, b: RollPicture): boolean {
  return JSON.stringify(pictureSnapshot(a)) === JSON.stringify(pictureSnapshot(b));
}

function pictureSnapshot(p: RollPicture) {
  return [p.develop, p.grade, p.aspect, p.framing, p.border, p.keystone, p.lens, p.detail, p.repair ?? [], p.layers ?? []];
}

/**
 * The roll with `source`'s `sections` written onto every picture of `ids` — the
 * same roll when nothing changed. The source picture itself is skipped when it
 * IS one of the roll's pictures (an apply-to); a copied SNAPSHOT pastes back
 * onto the picture it came from, which is how a copy undoes later edits.
 */
export function applySections(
  roll: RollDoc,
  source: RollPicture,
  ids: readonly string[],
  sections: readonly PictureSection[],
  now: number = Date.now(),
): RollDoc {
  if (sections.length === 0) return roll;
  let changed = false;
  const pictures = roll.pictures.map((p) => {
    if (!ids.includes(p.id) || p === source) return p;
    const next = withSections(p, source, sections);
    if (sameSections(next, p)) return p;
    changed = true;
    return next;
  });
  return changed ? { ...roll, pictures, updatedAt: now } : roll;
}

/** The roll with one picture's `sections` reset — the same roll when there was nothing to reset. */
export function resetSections(roll: RollDoc, id: string, sections: readonly PictureSection[], now: number = Date.now()): RollDoc {
  let changed = false;
  const pictures = roll.pictures.map((p) => {
    if (p.id !== id) return p;
    const next = withoutSections(p, sections);
    if (sameSections(next, p)) return p;
    changed = true;
    return next;
  });
  return changed ? { ...roll, pictures, updatedAt: now } : roll;
}

/** Which of `sections` a picture actually has something in — what a copy would carry, a reset would clear. */
export function sectionsWithEdits(picture: RollPicture): ReadonlySet<PictureSection> {
  return new Set(pictureEdits(picture));
}

// --- the settings clipboard -------------------------------------------------

/** What ⌘⇧C holds: a picture's settings as they were, and which sections of them. */
export interface CopiedSettings {
  /** The picture as it was when copied — a snapshot, so a later edit of it changes nothing. */
  from: RollPicture;
  sections: PictureSection[];
}

let held: CopiedSettings | null = null;
const listeners = new Set<() => void>();

/**
 * Hold `picture`'s `sections` for the session. Module state like the develop
 * clipboard (`develop-clipboard.ts`), and never persisted for its reason: a
 * clipboard that outlived the tab would paste yesterday's settings.
 */
export function copySettings(picture: RollPicture, sections: readonly PictureSection[]): void {
  held = sections.length > 0 ? { from: structuredClone(picture), sections: [...sections] } : null;
  for (const l of listeners) l();
}

export function copiedSettings(): CopiedSettings | null {
  return held;
}

export function subscribeCopiedSettings(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
