/**
 * The personal PRESET BOOK — one list of named lights, the same in the Develop
 * tool, the Trips modal and the Studio modal (`docs/develop-tool.md` §4, the
 * maintainer's call). A preset holds a COPY of numbers: applied, never
 * followed, so editing or deleting one changes no picture.
 *
 * One book per person, kept on ONE source like any document: this browser by
 * default, a connected Winnow on request. Its id is minted like any other
 * document's — never a fixed name: the bucket's key is `(app, id)`, so a fixed
 * id would collide between two accounts on one instance. A second device finds
 * the book by LISTING its kind.
 *
 * Unlike a trip, a book is a SET of names, so the two copies of it can always
 * be merged: a conflict is resolved by `mergeBooks` rather than handed to a
 * person. Pure and DOM-free; the store, the driver and the live state are
 * `preset-book-store.ts`, `preset-book-remote.ts` and `use-preset-book.ts`.
 */

import { normaliseDevelopPresets, type DevelopPreset, type DevelopSettings } from './develop';
import { removePresetFrom, savePresetIn } from './develop-presets';
import { DEFAULT_SOURCE_ID } from '../sources/source';
import { readIdentity, type DeliveryIdentity } from '../exif/delivery-meta';
import type { SavedGrade } from '../lut/saved-grade';
import { readRollGrade } from './roll-types';

export const PRESET_BOOK_VERSION = 1;

export interface PresetBook {
  id: string;
  version: number;
  /** Where the book is kept. Never on the wire. */
  sourceId: string;
  updatedAt: number;
  presets: DevelopPreset[];
  /**
   * The trips whose own presets have already been brought in. Kept on the book
   * so a preset deleted from it is not brought back by the next load — the
   * merge runs once per trip, on whichever device meets the trip first.
   */
  mergedTripIds: string[];
  /**
   * Who signs a delivered picture (`exif/delivery-meta.ts`): the name and the
   * copyright line, set once and kept HERE because the book is the one
   * personal document every device already finds — so a phone's export signs
   * the way the desktop's does. Absent until the person writes one.
   */
  identity?: DeliveryIdentity;
}

export function createPresetBook(id: string, now: number = Date.now(), sourceId: string = DEFAULT_SOURCE_ID): PresetBook {
  return { id, version: PRESET_BOOK_VERSION, sourceId, updatedAt: now, presets: [], mergedTripIds: [] };
}

/** A stored or received book read onto the current shape, or null when it is not a book. */
export function readPresetBook(raw: unknown, fallbackSourceId: string = DEFAULT_SOURCE_ID): PresetBook | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const b = raw as Record<string, unknown>;
  if (typeof b.id !== 'string' || !b.id || !Array.isArray(b.presets)) return null;
  const seen = new Set<string>();
  const presets = normaliseDevelopPresets(b.presets, readRollGrade).filter((p) => {
    // One preset per name, the first kept: names are what a person picks by.
    const key = p.name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return {
    id: b.id,
    version: PRESET_BOOK_VERSION,
    sourceId: typeof b.sourceId === 'string' && b.sourceId ? b.sourceId : fallbackSourceId,
    updatedAt: typeof b.updatedAt === 'number' && Number.isFinite(b.updatedAt) ? b.updatedAt : 0,
    presets,
    mergedTripIds: Array.isArray(b.mergedTripIds) ? b.mergedTripIds.filter((x): x is string => typeof x === 'string') : [],
    ...(b.identity !== undefined && b.identity !== null ? { identity: readIdentity(b.identity) } : {}),
  };
}

/** The book signing with `identity`; the same book back when nothing changed. */
export function withIdentity(book: PresetBook, identity: DeliveryIdentity, now: number = Date.now()): PresetBook {
  const next = readIdentity(identity);
  const current = book.identity;
  if (current && current.creator === next.creator && current.copyright === next.copyright) return book;
  return { ...book, identity: next, updatedAt: now };
}

/** Save under a name — the list rules are `savePresetIn`'s; the same book back when nothing changed. */
export function savePresetInBook(
  book: PresetBook,
  name: string,
  settings: DevelopSettings | null,
  id: string,
  now: number = Date.now(),
  look: SavedGrade | null = null,
): PresetBook {
  const presets = savePresetIn(book.presets, name, settings, id, look);
  return presets === book.presets ? book : { ...book, presets: [...presets], updatedAt: now };
}

export function removePresetFromBook(book: PresetBook, id: string, now: number = Date.now()): PresetBook {
  const presets = removePresetFrom(book.presets, id);
  return presets === book.presets ? book : { ...book, presets: [...presets], updatedAt: now };
}

/**
 * Bring the presets trips carried (`TripDoc.developPresets`, before the book
 * existed) into the book, once per trip. A name already in the book keeps the
 * BOOK's numbers — what the person has in hand wins over an old copy. The same
 * book back when there was nothing new to bring.
 */
export function mergeTripPresets(
  book: PresetBook,
  trips: readonly { id: string; developPresets: readonly DevelopPreset[] }[],
  now: number = Date.now(),
): PresetBook {
  const merged = new Set(book.mergedTripIds);
  const fresh = trips.filter((t) => !merged.has(t.id));
  if (fresh.length === 0) return book;
  const presets = [...book.presets];
  const names = new Set(presets.map((p) => p.name.trim().toLowerCase()));
  for (const trip of fresh) {
    for (const p of trip.developPresets) {
      const key = p.name.trim().toLowerCase();
      if (!key || names.has(key)) continue;
      names.add(key);
      presets.push({ id: p.id, name: p.name.trim(), settings: { ...p.settings }, ...(p.look ? { look: structuredClone(p.look) } : {}) });
    }
  }
  return {
    ...book,
    presets,
    mergedTripIds: [...book.mergedTripIds, ...fresh.map((t) => t.id)],
    updatedAt: now,
  };
}

/**
 * Two copies of one book that both moved, merged: the server's presets in its
 * order, each overridden by the local copy of the same name (the local side is
 * the one being edited), then the presets only this device has. A preset
 * deleted on one side and kept on the other comes back — the price of never
 * asking a person to settle a list of names, and the safe direction to be
 * wrong in. The server's id is kept so the result lands on the same row.
 */
export function mergeBooks(local: PresetBook, server: PresetBook, now: number = Date.now()): PresetBook {
  const localByName = new Map(local.presets.map((p) => [p.name.trim().toLowerCase(), p]));
  const presets: DevelopPreset[] = [];
  const names = new Set<string>();
  for (const p of server.presets) {
    const key = p.name.trim().toLowerCase();
    names.add(key);
    presets.push(localByName.get(key) ?? p);
  }
  for (const p of local.presets) {
    const key = p.name.trim().toLowerCase();
    if (!names.has(key)) {
      names.add(key);
      presets.push(p);
    }
  }
  return {
    id: server.id,
    version: PRESET_BOOK_VERSION,
    sourceId: server.sourceId,
    updatedAt: now,
    presets,
    mergedTripIds: [...new Set([...server.mergedTripIds, ...local.mergedTripIds])],
    // One identity, not a list: the copy being edited wins, as a same-named preset does.
    ...((local.identity ?? server.identity) ? { identity: local.identity ?? server.identity } : {}),
  };
}

/** What travels: everything but where it is kept. */
export function bookToWire(book: PresetBook): Omit<PresetBook, 'sourceId'> {
  const { sourceId: _dropped, ...rest } = book;
  void _dropped;
  return rest;
}
