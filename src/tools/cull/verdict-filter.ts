/**
 * Pure verdict filtering for the Cull tool — the unit-tested surface.
 *
 * A {@link Verdict} (rating 0–5 + pick/reject flag) lives in the asset library;
 * the Cull grid shows the subset matching the active {@link CullFilter}.
 */
import type { Verdict } from '../../shared/library/AssetLibraryContext';

export type CullFilter =
  | 'all'
  | 'picks'
  | 'rejects'
  | 'unrated'
  | 'rated2'
  | 'rated3'
  | 'rated4'
  | 'rated5';

/** Does an asset's verdict (possibly absent) match the active filter? */
export function matchesFilter(v: Verdict | undefined, f: CullFilter): boolean {
  const rating = v?.rating ?? 0;
  const flag = v?.flag ?? null;
  switch (f) {
    case 'all':
      return true;
    case 'picks':
      return flag === 'pick';
    case 'rejects':
      return flag === 'reject';
    case 'unrated':
      return rating === 0;
    case 'rated2':
      return rating >= 2;
    case 'rated3':
      return rating >= 3;
    case 'rated4':
      return rating >= 4;
    case 'rated5':
      return rating >= 5;
  }
}

/**
 * What downstream consumers (the Export half, a future Frame tool) treat as a
 * keeper: explicitly picked, or rated 4+. Not used by the triage UI itself —
 * exported for the next links in the pipeline.
 */
export function isPick(v: Verdict | undefined): boolean {
  if (v?.flag === 'reject') return false;
  return v?.flag === 'pick' || (v?.rating ?? 0) >= 4;
}
