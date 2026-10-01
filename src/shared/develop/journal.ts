/**
 * A picture's JOURNAL — the steps of its edit, kept on the picture for the
 * making-of video (`docs/develop-timelapse.md` §3.1).
 *
 * Nothing else in the suite remembers HOW a picture was edited: the undo
 * stack is in memory, fifty whole documents deep, with no time on its past.
 * So the one updater of the Develop tool (`RollEditor.update`) hands every
 * write through `journalRoll`, which finds the pictures the write changed —
 * by identity, since every write replaces the picture it touches — names the
 * SECTIONS that moved (`sectionsChanged`) and appends one step to that
 * picture, INSIDE the same document. That is the whole trick: the step and
 * the edit are one undo step, so ⌘Z takes the step with it and ⇧⌘Z brings
 * both back, with no second funnel to keep in sync.
 *
 * A step is bounded the way the undo stack is: a write inside `COALESCE_MS`
 * of the last step, touching the same sections the same way, REPLACES it (a
 * slider drag is one step), and the journal itself is capped in steps and in
 * bytes — past either, the two oldest adjacent steps that share a section are
 * merged, so the story keeps its shape and loses its finest grain.
 *
 * A picture edited before the journal existed has settings and no story.
 * `pictureJournal` fills the gap honestly: whatever the recorded steps do not
 * explain is one synthetic step per section in a STANDARD order, marked
 * `via: 'earlier'`, so the video can say "in a standard order (not recorded)"
 * instead of inventing a chronology.
 *
 * Pure and DOM-free.
 */

import { COALESCE_MS } from '../history/history';
import { isDefaultFraming } from '../media/framing';
import { sameDevelop } from './develop';
import { withoutSections } from './picture-sections';
import {
  PICTURE_EDITS,
  type JournalStep,
  type JournalVia,
  type PictureEdit,
  type RollDoc,
  type RollPicture,
  type SectionValues,
} from './roll-types';

/** How many steps one picture keeps, and how many bytes they may weigh serialised. */
export const JOURNAL_MAX_STEPS = 300;
export const JOURNAL_MAX_BYTES = 96 * 1024;

/**
 * The order the steps of a picture WITHOUT a record are told in: the frame
 * first, then the light, then what is done to parts of it, the look last —
 * a convention, said as one wherever such a step is shown.
 */
export const STANDARD_ORDER: readonly PictureEdit[] = [
  'crop',
  'perspective',
  'lens',
  'develop',
  'detail',
  'repair',
  'layers',
  'look',
  'border',
  'vignette',
];

// --- reading and writing a picture by SECTION --------------------------------

/** `sections`' values as the picture holds them, absent spelled the reader's way. */
export function sectionValues(p: RollPicture, sections: readonly PictureEdit[]): SectionValues {
  const out: SectionValues = {};
  for (const s of sections) {
    switch (s) {
      case 'develop':
        out.develop = p.develop ?? null;
        break;
      case 'look':
        out.look = p.grade ?? null;
        break;
      case 'crop':
        out.crop = { aspect: p.aspect, framing: p.framing && !isDefaultFraming(p.framing) ? p.framing : null };
        break;
      case 'border':
        out.border = p.border ?? null;
        break;
      case 'perspective':
        out.perspective = p.keystone ?? null;
        break;
      case 'lens':
        out.lens = p.lens ?? null;
        break;
      case 'detail':
        out.detail = p.detail ?? null;
        break;
      case 'vignette':
        out.vignette = p.vignette ?? null;
        break;
      case 'repair':
        out.repair = p.repair ?? [];
        break;
      case 'layers':
        out.layers = p.layers ?? [];
        break;
    }
  }
  return out;
}

/** The picture wearing `values` — the sections named, every other field as it was. */
export function withSectionValues(p: RollPicture, values: SectionValues): RollPicture {
  const next: RollPicture = { ...p };
  if ('develop' in values) next.develop = values.develop ?? null;
  if ('look' in values) next.grade = values.look ?? null;
  if ('crop' in values && values.crop) {
    next.aspect = values.crop.aspect;
    next.framing = values.crop.framing ?? null;
  }
  if ('border' in values) next.border = values.border ?? null;
  if ('perspective' in values) next.keystone = values.perspective ?? null;
  if ('lens' in values) next.lens = values.lens ?? null;
  if ('detail' in values) next.detail = values.detail ?? null;
  if ('vignette' in values) next.vignette = values.vignette ?? null;
  if ('repair' in values) next.repair = values.repair ?? [];
  if ('layers' in values) next.layers = values.layers ?? [];
  return next;
}

function sameSection(a: RollPicture, b: RollPicture, section: PictureEdit): boolean {
  if (section === 'develop') return sameDevelop(a.develop, b.develop);
  return JSON.stringify(sectionValues(a, [section])) === JSON.stringify(sectionValues(b, [section]));
}

/** The sections whose value differs between two states of one picture, in the inspector's order. */
export function sectionsChanged(a: RollPicture, b: RollPicture): PictureEdit[] {
  return PICTURE_EDITS.filter((s) => !sameSection(a, b, s));
}

/** The picture as SHOT: every section back to nothing, its file, base, words and delivery kept. */
export function asShot(p: RollPicture): RollPicture {
  return withoutSections(p, PICTURE_EDITS);
}

// --- appending ---------------------------------------------------------------

function sameSections(a: readonly PictureEdit[], b: readonly PictureEdit[]): boolean {
  return a.length === b.length && a.every((s, i) => s === b[i]);
}

function journalBytes(journal: readonly JournalStep[]): number {
  return JSON.stringify(journal).length;
}

/** Two adjacent steps as one: the later one's values over the earlier one's, both sets of sections. */
function mergeSteps(a: JournalStep, b: JournalStep): JournalStep {
  const wanted = new Set([...a.sections, ...b.sections]);
  return {
    at: b.at,
    sections: PICTURE_EDITS.filter((s) => wanted.has(s)),
    after: { ...a.after, ...b.after },
    ...(b.via ? { via: b.via } : {}),
  };
}

/**
 * The journal held under its ceilings. Past either, the two OLDEST adjacent
 * steps that share a section are merged — else the two oldest — until it
 * fits: the story keeps its shape, the finest grain goes first.
 */
export function boundJournal(
  journal: readonly JournalStep[],
  limits: { steps?: number; bytes?: number } = {},
): JournalStep[] {
  const maxSteps = limits.steps ?? JOURNAL_MAX_STEPS;
  const maxBytes = limits.bytes ?? JOURNAL_MAX_BYTES;
  let out = [...journal];
  const over = () => out.length > maxSteps || (out.length > 1 && journalBytes(out) > maxBytes);
  while (out.length > 1 && over()) {
    let at = out.findIndex((s, i) => i < out.length - 1 && s.sections.some((x) => out[i + 1].sections.includes(x)));
    if (at < 0) at = 0;
    out = [...out.slice(0, at), mergeSteps(out[at], out[at + 1]), ...out.slice(at + 2)];
  }
  return out;
}

/**
 * `journal` with `step` appended — or, when the step continues the last one
 * (the same sections, the same `via`, inside the coalescing window), the last
 * step REPLACED by it: a drag of the exposure slider is one step, and the next
 * different thing is another. Then bounded.
 */
export function appendStep(
  journal: readonly JournalStep[],
  step: JournalStep,
  options: { coalesceMs?: number; steps?: number; bytes?: number } = {},
): JournalStep[] {
  const coalesceMs = options.coalesceMs ?? COALESCE_MS;
  const last = journal[journal.length - 1];
  const continues =
    last !== undefined &&
    sameSections(last.sections, step.sections) &&
    (last.via ?? null) === (step.via ?? null) &&
    step.at >= last.at &&
    step.at - last.at <= coalesceMs;
  const grown = continues ? [...journal.slice(0, -1), step] : [...journal, step];
  return boundJournal(grown, options);
}

/**
 * `next` with a step appended to every picture the write from `prev` changed
 * — the ONE call the updater makes. A picture the write did not touch is the
 * same object in both and costs nothing; one it replaced is diffed by
 * section, and a write that moved no section (a slider put back exactly, a
 * batch that wrote what was there) leaves no step. Returns `next` itself when
 * nothing was journaled.
 */
export function journalRoll(prev: RollDoc, next: RollDoc, now: number, via?: JournalVia): RollDoc {
  if (prev === next) return next;
  const before = new Map(prev.pictures.map((p) => [p.id, p] as const));
  let changed = false;
  const pictures = next.pictures.map((p) => {
    const was = before.get(p.id);
    if (!was || was === p) return p;
    const sections = sectionsChanged(was, p);
    if (sections.length === 0) return p;
    changed = true;
    const step: JournalStep = { at: now, sections, after: sectionValues(p, sections), ...(via ? { via } : {}) };
    return { ...p, journal: appendStep(p.journal ?? [], step) };
  });
  return changed ? { ...next, pictures } : next;
}

// --- reading the story back ---------------------------------------------------

/** `base` with every step applied in order. */
export function foldJournal(base: RollPicture, steps: readonly JournalStep[]): RollPicture {
  return steps.reduce((p, s) => withSectionValues(p, s.after), base);
}

export interface PictureJournal {
  /** The steps, oldest first, the synthetic ones (`via: 'earlier'`) ahead of the recorded ones. */
  steps: JournalStep[];
  /** Whether the picture carries any recorded step at all. */
  recorded: boolean;
  /** The sections told in the standard order because nothing recorded explains them. */
  reconstructed: PictureEdit[];
}

/**
 * The picture's story, complete: its recorded steps, preceded by one
 * synthetic step per section the record does not explain — a picture edited
 * before v7, or one section of it edited then and never since — in
 * `STANDARD_ORDER`, marked `via: 'earlier'`. Folding the steps over the
 * picture as shot gives the picture exactly, by construction.
 */
export function pictureJournal(p: RollPicture): PictureJournal {
  const recorded = p.journal ?? [];
  const folded = foldJournal(asShot(p), recorded);
  const missing = new Set(sectionsChanged(folded, p));
  const reconstructed = STANDARD_ORDER.filter((s) => missing.has(s));
  const first = recorded[0]?.at ?? 0;
  const earlier = reconstructed.map<JournalStep>((s, i) => ({
    at: first - (reconstructed.length - i),
    sections: [s],
    after: sectionValues(p, [s]),
    via: 'earlier',
  }));
  return { steps: [...earlier, ...recorded], recorded: recorded.length > 0, reconstructed };
}
