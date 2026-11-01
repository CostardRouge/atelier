/**
 * A mosaic's SUMMARY — what its gallery card draws, sent with every push and
 * listed by the instance in place of the mosaic (Winnow's migration 0056, the
 * roll's precedent in `develop/roll-summary.ts`). A mosaic of ten thousand
 * pictures weighs a couple of megabytes of colour grids; its card needs a
 * title, two counts and two dates.
 *
 * A summary is a CARD, never a mosaic: `summaryCard` builds the stand-in a
 * card is drawn from, and the row carrying it is `partial`, so the gallery
 * fetches the mosaic before anything is written from it. Pure and DOM-free.
 */

import { DEFAULT_SETTINGS, MOSAIC_DOC_VERSION, type MosaicDoc } from './mosaic-doc';

export interface MosaicSummary {
  title: string;
  createdAt: number;
  updatedAt: number;
  /** Pictures in its library. */
  pictures: number;
  /** Of those, the ones whose colours are measured. */
  measured: number;
  /** The Winnow its pictures come from, when it has one. */
  instance?: string;
}

export function mosaicSummary(doc: MosaicDoc): MosaicSummary {
  return {
    title: doc.title,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pictures: doc.tiles.length,
    measured: doc.tiles.reduce((n, t) => (t.grid ? n + 1 : n), 0),
    ...(doc.instance ? { instance: doc.instance } : {}),
  };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** A stored summary back, or null when it is not one (the gallery then lists nothing for it rather than a wrong card). */
export function readMosaicSummary(raw: unknown): MosaicSummary | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== 'string' || typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) return null;
  const pictures = count(r.pictures);
  const instance = typeof r.instance === 'string' && r.instance.trim() ? r.instance.trim().slice(0, 300) : undefined;
  return {
    title: r.title,
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : r.updatedAt,
    updatedAt: r.updatedAt,
    pictures,
    measured: Math.min(pictures, count(r.measured)),
    ...(instance ? { instance } : {}),
  };
}

/**
 * The mosaic a summary card is drawn from: its id, title, source and dates, NO
 * pictures. Never written anywhere — the row carrying it is `partial`, and the
 * gallery fetches the real mosaic before it mirrors or opens it.
 */
export function summaryCard(id: string, sourceId: string, summary: MosaicSummary): MosaicDoc {
  return {
    id,
    version: MOSAIC_DOC_VERSION,
    title: summary.title,
    sourceId,
    ...(summary.instance ? { instance: summary.instance } : {}),
    tiles: [],
    settings: DEFAULT_SETTINGS,
    createdAt: summary.createdAt,
    updatedAt: summary.updatedAt,
  };
}
