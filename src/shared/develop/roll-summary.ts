/**
 * A roll's SUMMARY — what its gallery card draws, sent with every push and
 * listed by the instance in place of the roll (Winnow's migration 0056). A
 * roll of 300 edited pictures weighs tens of MB with its journals; its card
 * needs a name, four counts and the ids of four thumbnails.
 *
 * A summary is a CARD, never a roll: `summaryCard` builds the stand-in a card
 * is drawn from, marked so the gallery fetches the roll before anything is
 * written from it. Pure and DOM-free.
 */

import { createRollDoc, rollProgress, type RollDoc } from './roll-types';

export interface RollSummary {
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Pictures on the roll that are not ignored (`rollProgress().total`), as the card counts them. */
  pictures: number;
  developed: number;
  withLook: number;
  /** The first four pictures' ids: the cover's thumbnails, when this device has them. */
  cover: string[];
}

/** How many picture ids the cover draws. */
const COVER = 4;

export function rollSummary(doc: RollDoc): RollSummary {
  const { total, developed } = rollProgress(doc);
  return {
    name: doc.name,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    pictures: total,
    developed,
    withLook: doc.pictures.filter((p) => p.grade).length,
    cover: doc.pictures.slice(0, COVER).map((p) => p.id),
  };
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0);

/** A stored summary back, or null when it is not one (the gallery then lists nothing for it rather than a wrong card). */
export function readRollSummary(raw: unknown): RollSummary | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || typeof r.updatedAt !== 'number') return null;
  return {
    name: r.name,
    createdAt: typeof r.createdAt === 'number' ? r.createdAt : r.updatedAt,
    updatedAt: r.updatedAt,
    pictures: count(r.pictures),
    developed: count(r.developed),
    withLook: count(r.withLook),
    cover: Array.isArray(r.cover) ? r.cover.filter((id): id is string => typeof id === 'string').slice(0, COVER) : [],
  };
}

/**
 * The roll a summary card is drawn from: its id, name, source and dates, NO
 * pictures. Never written anywhere — the row carrying it is `partial`, and
 * the gallery fetches the real roll before it mirrors, opens or clones.
 */
export function summaryCard(id: string, sourceId: string, summary: RollSummary): RollDoc {
  return { ...createRollDoc(summary.name, sourceId, summary.createdAt, id), updatedAt: summary.updatedAt };
}
