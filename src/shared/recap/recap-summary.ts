/**
 * A recap's SUMMARY — what its gallery card draws, sent with every push and
 * listed by an instance in place of the recap (the roll's and the mosaic's
 * precedent). A summary is a CARD, never a recap: `summaryCard` builds the
 * stand-in a card is drawn from, and the row carrying it is `partial`, so the
 * gallery fetches the recap before anything is written from it.
 *
 * Pure and DOM-free.
 */

import { RECAP_DOC_VERSION, TEMPLATES, createRecapDoc, readRecapDoc, type RecapDoc, type RecapTemplate } from './recap-doc';

export interface RecapSummary {
  title: string;
  template: RecapTemplate;
  anchor: string;
  createdAt: number;
  updatedAt: number;
  /** Pictures in its pool. */
  pictures: number;
}

export function recapSummary(doc: RecapDoc): RecapSummary {
  return { title: doc.title, template: doc.template, anchor: doc.anchor, createdAt: doc.createdAt, updatedAt: doc.updatedAt, pictures: doc.pictures.length };
}

export function readRecapSummary(raw: unknown): RecapSummary | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.title !== 'string' || typeof r.updatedAt !== 'number' || !Number.isFinite(r.updatedAt)) return null;
  const template = (TEMPLATES as readonly unknown[]).includes(r.template) ? (r.template as RecapTemplate) : 'month';
  return {
    title: r.title.slice(0, 120),
    template,
    anchor: typeof r.anchor === 'string' ? r.anchor.slice(0, 10) : '',
    createdAt: typeof r.createdAt === 'number' && Number.isFinite(r.createdAt) ? r.createdAt : r.updatedAt,
    updatedAt: r.updatedAt,
    pictures: typeof r.pictures === 'number' && Number.isFinite(r.pictures) && r.pictures >= 0 ? Math.floor(r.pictures) : 0,
  };
}

/** The recap a summary card is drawn from: its id, title, template, source and dates, no picture. Never written. */
export function summaryCard(id: string, sourceId: string, s: RecapSummary): RecapDoc {
  const base = createRecapDoc(s.template, sourceId, { title: s.title, now: s.updatedAt });
  return readRecapDoc({ ...base, id, anchor: s.anchor || base.anchor, version: RECAP_DOC_VERSION, createdAt: s.createdAt, updatedAt: s.updatedAt }, sourceId) ?? base;
}
