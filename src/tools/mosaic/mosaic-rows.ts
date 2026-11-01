/**
 * What a Winnow row becomes in a mosaic: a TILE by reference (the asset id,
 * the row's content hash when it carries one, photo or clip — a clip counts
 * as the still of its thumbnail, its poster), and the days a set of rows
 * spans, which the mosaic remembers so the picker reopens there.
 *
 * Pure and DOM-free.
 */

import type { MosaicTile } from '../../shared/mosaic/mosaic-doc';
import type { WinnowAssetRow } from '../../shared/sources/winnow/client';
import { rowDay } from '../../shared/sources/winnow/picker/span';

export function tileOfRow(row: WinnowAssetRow): MosaicTile {
  const hash = typeof row.content_hash === 'string' && row.content_hash ? row.content_hash : undefined;
  return { id: row.id, ...(hash ? { hash } : {}), kind: row.media_type === 'video' ? 'clip' : 'photo' };
}

/** The first and last day among `rows`, by Winnow's camera-local date; undefined when none has one. */
export function spanOfRows(rows: readonly WinnowAssetRow[]): { from: string; to: string } | undefined {
  let from: string | null = null;
  let to: string | null = null;
  for (const row of rows) {
    const day = rowDay(row);
    if (!day) continue;
    if (from === null || day < from) from = day;
    if (to === null || day > to) to = day;
  }
  return from && to ? { from, to } : undefined;
}
