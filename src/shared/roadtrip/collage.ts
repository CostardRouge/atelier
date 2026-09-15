/**
 * A slide that holds SEVERAL pictures — the document side of the collage
 * frames. Pure and DOM-free; the geometry is `shared/media/media-layout.ts`,
 * the paint is `shared/media/cell-paint.ts`.
 *
 * The shape that keeps every one-picture reader working: **cell 1 IS the
 * slide.** Its `media`, `framing` and `develop` stay exactly where they are
 * today, so the rail's thumbnail, the Library sync, the date read from the
 * picture and the export plan never learn that a collage exists; the collage
 * carries cells 2…n in `cells`, each with its own picture, framing and
 * develop — never inherited, the rule every crop in this tool follows.
 *
 * A collage keeps MORE cells than its template draws: switching from a
 * six-piece bento to a 2 × 2 keeps pictures five and six in the list, not
 * drawn, and a bigger layout brings them back. Nothing is dropped by a click
 * on a tile.
 *
 * An empty cell draws nothing in the export. The editor draws a slot over it
 * on its own overlay, never in the picture.
 */

import { type Framing, normaliseFraming } from '../media/framing';
import {
  isLayoutId,
  layoutTemplate,
  type LayoutTemplateEntry,
} from '../media/layout-templates';
import {
  DEFAULT_CELL_PLACE,
  cellCount,
  normaliseCellPlace,
  normaliseSpacing,
  resolveLayout,
  type CellPlace,
  type CellRect,
  type LayoutSpacing,
} from '../media/media-layout';
import { developOrNull, type DevelopSettings } from '../develop/develop';
import type { SavedMediaRef } from '../projects/project-types';

/** One cell after the first: a picture, how it sits, how it is corrected. */
export interface CollageCell {
  media: SavedMediaRef | null;
  framing: Framing;
  develop: DevelopSettings | null;
  /** Where the author moved this print, on a free layout; the template's place otherwise. */
  place: CellPlace;
}

export interface SlideCollage {
  /** A `layout-templates.ts` id; an id this build does not know reads as no collage. */
  template: string;
  spacing: LayoutSpacing;
  /** Painted where no picture covers the frame — between cells and in an empty one. */
  background: string;
  /** Cells 2…n. The slide's own picture is cell 1. */
  cells: CollageCell[];
  /** Where the SLIDE's own print was moved, on a free layout. */
  place: CellPlace;
}

/** The suite's frame black — what a stage shows behind a picture that does not cover it. */
export const DEFAULT_COLLAGE_BACKGROUND = '#100f0d';

export function createCollageCell(media: SavedMediaRef | null = null): CollageCell {
  return {
    media,
    framing: normaliseFraming(undefined),
    develop: null,
    place: { ...DEFAULT_CELL_PLACE },
  };
}

/** A new collage on `template`, its cells 2…n empty. Null for an unknown id. */
export function createCollage(template: string): SlideCollage | null {
  const entry = layoutTemplate(template);
  if (!entry) return null;
  const count = cellCount(entry.template);
  return {
    template,
    spacing: normaliseSpacing(undefined),
    background: DEFAULT_COLLAGE_BACKGROUND,
    cells: Array.from({ length: Math.max(0, count - 1) }, () => createCollageCell()),
    place: { ...DEFAULT_CELL_PLACE },
  };
}

function mediaRefOrNull(v: unknown): SavedMediaRef | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Partial<SavedMediaRef>;
  if (typeof r.name !== 'string' || !r.name) return null;
  const ref: SavedMediaRef = {
    name: r.name,
    size: typeof r.size === 'number' && Number.isFinite(r.size) ? r.size : 0,
    lastModified:
      typeof r.lastModified === 'number' && Number.isFinite(r.lastModified) ? r.lastModified : 0,
  };
  if (typeof r.assetId === 'string' && r.assetId) ref.assetId = r.assetId;
  if (typeof r.hash === 'string' && r.hash) ref.hash = r.hash;
  return ref;
}

function colour(v: unknown): string {
  return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v.trim())
    ? v.trim().toLowerCase()
    : DEFAULT_COLLAGE_BACKGROUND;
}

/**
 * Read a collage out of anything — a stored document, an imported file, a
 * hand edit. A template the registry does not know is NO collage: a slide
 * written by a newer Atelier opens here as its lead picture and loses the
 * layout, it never fails to open. Junk in a cell lands clamped or empty.
 */
export function readCollage(v: unknown): SlideCollage | null {
  if (!v || typeof v !== 'object') return null;
  const c = v as Partial<SlideCollage>;
  if (!isLayoutId(c.template)) return null;
  const cells = Array.isArray(c.cells) ? c.cells : [];
  return {
    template: c.template,
    spacing: normaliseSpacing(c.spacing),
    background: colour(c.background),
    cells: cells.map((cell) => {
      const raw = (cell && typeof cell === 'object' ? cell : {}) as Partial<CollageCell>;
      return {
        media: mediaRefOrNull(raw.media),
        framing: normaliseFraming(raw.framing),
        develop: developOrNull(raw.develop),
        place: normaliseCellPlace(raw.place),
      };
    }),
    place: normaliseCellPlace(c.place),
  };
}

/** The registry entry a collage draws with. Null only for an id `readCollage` would already have refused. */
export function collageEntry(collage: SlideCollage): LayoutTemplateEntry | null {
  return layoutTemplate(collage.template);
}

/** How many cells the collage's template DRAWS (its `cells` may hold more). */
export function collageCellCount(collage: SlideCollage): number {
  const entry = collageEntry(collage);
  return entry ? cellCount(entry.template) : 0;
}

/**
 * The lead picture as the collage's first cell — what lets every consumer
 * treat "cell i" uniformly. Cell 0 is the slide; the rest are `cells[i − 1]`.
 */
export interface CollageLead {
  media: SavedMediaRef | null;
  framing: Framing;
  develop: DevelopSettings | null;
}

export function collageCellAt(lead: CollageLead, collage: SlideCollage, i: number): CollageCell {
  if (i === 0) return { media: lead.media, framing: lead.framing, develop: lead.develop, place: collage.place };
  return collage.cells[i - 1] ?? createCollageCell();
}

/** The places of every drawn cell, in cell order, for `resolveLayout`. */
export function collagePlaces(collage: SlideCollage): CellPlace[] {
  const n = collageCellCount(collage);
  return Array.from({ length: n }, (_, i) => (i === 0 ? collage.place : (collage.cells[i - 1]?.place ?? DEFAULT_CELL_PLACE)));
}

/** The collage's cells in a `w`×`h` frame. Empty for an unknown template. */
export function resolveCollage(collage: SlideCollage, w: number, h: number): CellRect[] {
  const entry = collageEntry(collage);
  if (!entry) return [];
  return resolveLayout(entry.template, w, h, collage.spacing, collagePlaces(collage));
}

/**
 * The refs every DRAWN cell names, lead first — what a surface needs to find
 * or fetch before it can paint the slide. A cell without a picture is skipped.
 */
export function collageMediaRefs(lead: CollageLead, collage: SlideCollage): SavedMediaRef[] {
  const n = collageCellCount(collage);
  const refs: SavedMediaRef[] = [];
  for (let i = 0; i < n; i++) {
    const ref = collageCellAt(lead, collage, i).media;
    if (ref) refs.push(ref);
  }
  return refs;
}

/**
 * The pictures a smaller template no longer draws — kept, and listed so the
 * author knows they are there. Indices are 1-based cell numbers.
 */
export function collageKept(collage: SlideCollage): { cell: number; media: SavedMediaRef }[] {
  const n = collageCellCount(collage);
  const kept: { cell: number; media: SavedMediaRef }[] = [];
  collage.cells.forEach((cell, k) => {
    const number = k + 2;
    if (number > n && cell.media) kept.push({ cell: number, media: cell.media });
  });
  return kept;
}

/**
 * Change the template and keep every picture: the list is padded with empty
 * cells up to the new count, never truncated.
 */
export function retemplateCollage(collage: SlideCollage, template: string): SlideCollage | null {
  const entry = layoutTemplate(template);
  if (!entry) return null;
  const need = Math.max(0, cellCount(entry.template) - 1);
  const cells = collage.cells.slice();
  while (cells.length < need) cells.push(createCollageCell());
  return { ...collage, template, cells };
}

/** Swap two cells' pictures, framings and develops — never their places, which belong to the slot. */
export function swapCollageCells(
  lead: CollageLead,
  collage: SlideCollage,
  a: number,
  b: number,
): { lead: CollageLead; collage: SlideCollage } {
  if (a === b || a < 0 || b < 0) return { lead, collage };
  const n = Math.max(collage.cells.length + 1, a + 1, b + 1);
  const all: CollageCell[] = Array.from({ length: n }, (_, i) => collageCellAt(lead, collage, i));
  const [A, B] = [all[a], all[b]];
  const swap = (from: CollageCell, to: CollageCell): CollageCell => ({
    ...to,
    media: from.media,
    framing: from.framing,
    develop: from.develop,
  });
  all[a] = swap(B, A);
  all[b] = swap(A, B);
  return {
    lead: { media: all[0].media, framing: all[0].framing, develop: all[0].develop },
    collage: { ...collage, cells: all.slice(1) },
  };
}

/** Write cell `i` (0 = the lead), returning the new lead and collage. */
export function withCollageCell(
  lead: CollageLead,
  collage: SlideCollage,
  i: number,
  patch: Partial<CollageCell>,
): { lead: CollageLead; collage: SlideCollage } {
  if (i === 0) {
    return {
      lead: {
        media: patch.media !== undefined ? patch.media : lead.media,
        framing: patch.framing ?? lead.framing,
        develop: patch.develop !== undefined ? patch.develop : lead.develop,
      },
      collage: patch.place ? { ...collage, place: patch.place } : collage,
    };
  }
  const cells = collage.cells.slice();
  while (cells.length < i) cells.push(createCollageCell());
  cells[i - 1] = { ...cells[i - 1], ...patch };
  return { lead, collage: { ...collage, cells } };
}
