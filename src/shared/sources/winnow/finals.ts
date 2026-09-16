/**
 * Sending a render HOME — the arithmetic behind "send to <host>" after a
 * Studio export (`docs/winnow-timeline.md` §6, bridge phase 2).
 *
 * Winnow already models lineage: `assets.original_asset_id`, `has_edit` /
 * `is_edit`, `/api/assets/:id/exports`, and `/api/reconcile` that links a
 * final in a finals root to the capture it came from. What Atelier adds is
 * honesty about WHICH capture: reconcile matches on basename + capture time
 * and refuses to guess, whereas a file materialised from Winnow is vouched
 * for with `assetId = "<host>/<id>"` — so the numeric id is sent along and
 * the match is exact. That id is only meaningful on the instance that minted
 * it: a final cut from `a.example`'s clip must not be linked on `b.example`.
 *
 * The path is derived from Winnow's nouns (a chapter id, the file's own
 * name), never Road Trip's: a path is a contract with a filesystem, and a
 * trip's slug is an editorial value that changes when a trip is renamed.
 *
 * `limits.maxUploadBytes` is checked HERE, before a byte moves: behind a
 * tunnel a 4K master fails at 90 %, which is the worst place to learn it.
 *
 * Pure and DOM-free.
 */

import { formatBytes } from '../../lib/format';

/** `"winnow.example/42"` → its two halves; null for anything else. */
export function splitAssetId(assetId: string | null | undefined): { host: string; id: number } | null {
  if (!assetId) return null;
  const slash = assetId.lastIndexOf('/');
  if (slash <= 0) return null;
  const host = assetId.slice(0, slash);
  const id = Number(assetId.slice(slash + 1));
  if (!host || !Number.isInteger(id) || id <= 0) return null;
  return { host, id };
}

export interface FinalCandidate {
  name: string;
  size: number;
  /**
   * This file's OWN capture, when a run mixes several (a roll's pictures);
   * absent, the run's `assetId` stands for it. Null says "no id".
   */
  assetId?: string | null;
}

export interface FinalsInput {
  /** The rendered deliverables of one export run. */
  files: readonly FinalCandidate[];
  /** The source media's identity as the instance vouched for it, or null — the run's one capture. */
  assetId: string | null;
  /** The instance the finals go to — the one the clip came from. */
  targetSourceId: string;
  /** The chapter the clip belongs to, when known. Winnow's noun, not ours. */
  chapterId?: string | null;
  /** `capabilities.limits.maxUploadBytes`; null when the instance sets none. */
  maxUploadBytes: number | null;
}

export interface FinalsItem {
  name: string;
  /** Relative path inside the finals root, `POST /api/upload`'s `paths[]`. */
  path: string;
  bytes: number;
  /** THIS file's capture on the target, sent with its own upload; null = let reconcile match. */
  originalAssetId: number | null;
}

export interface FinalsPlan {
  items: FinalsItem[];
  /** The run's one capture on the target when it has one; null = several, or let reconcile match. */
  originalAssetId: number | null;
  chapterId: string | null;
  totalBytes: number;
  /** Why nothing must be sent; empty when the plan is sound. */
  problems: string[];
  /** Worth saying, not blocking. */
  notes: string[];
}

/** Where a final lands: under its chapter when one is known, else at the root. */
export function finalsPath(chapterId: string | null | undefined, name: string): string {
  const safe = name.replace(/[\\/]+/g, '_');
  return chapterId ? `${chapterId}/${safe}` : safe;
}

export function finalsPlan(input: FinalsInput): FinalsPlan {
  const problems: string[] = [];
  const notes: string[] = [];
  const chapterId = input.chapterId?.trim() || null;
  const items: FinalsItem[] = [];
  let unlinked = 0;
  for (const f of input.files) {
    const id = f.assetId !== undefined ? f.assetId : input.assetId;
    const split = splitAssetId(id);
    let originalAssetId: number | null = null;
    if (!split) {
      unlinked += 1;
    } else if (split.host !== input.targetSourceId) {
      problems.push(
        `${f.name} was made from a picture picked on ${split.host}, not ${input.targetSourceId} — it would be linked to the wrong capture.`,
      );
    } else {
      originalAssetId = split.id;
    }
    items.push({ name: f.name, path: finalsPath(chapterId, f.name), bytes: f.size, originalAssetId });
  }
  const totalBytes = items.reduce((n, i) => n + i.bytes, 0);

  if (!items.length) problems.push('There is nothing to send — export first.');
  if (unlinked > 0) {
    notes.push(
      unlinked === items.length
        ? 'This media carries no Winnow id, so the instance will match the final to its capture by name and capture time.'
        : `${unlinked} of these carry no Winnow id; the instance will match those to their captures by name and capture time.`,
    );
  }

  // The run's ONE capture, for the sentence after a send: only when every
  // linked file names the same one.
  const linked = new Set(items.flatMap((i) => (i.originalAssetId === null ? [] : [i.originalAssetId])));
  const originalAssetId = linked.size === 1 ? [...linked][0] : null;

  const limit = input.maxUploadBytes;
  if (limit !== null && limit > 0) {
    for (const item of items) {
      if (item.bytes > limit) {
        problems.push(
          `${item.name} is ${formatBytes(item.bytes)}; ${input.targetSourceId} accepts at most ${formatBytes(limit)} per upload.`,
        );
      }
    }
  }

  return { items, originalAssetId, chapterId, totalBytes, problems, notes };
}
