import { useEffect, useMemo, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import FilterBar from './FilterBar';
import Grid from './Grid';
import Loupe from './Loupe';
import { useCullKeys } from './use-cull-keys';
import { matchesFilter, type CullFilter } from './verdict-filter';

const ALL_FILTERS: CullFilter[] = [
  'all', 'picks', 'rejects', 'unrated', 'rated2', 'rated3', 'rated4', 'rated5',
];

/**
 * Cull / Triage — the first step of the workflow. Rip through the photos and
 * clips selected in the library, rate them 1–5, flag picks/rejects, and filter
 * to the keepers. The verdict lives in the library so later tools (Finalize,
 * Frame) act on the picks.
 */
export default function CullTool() {
  const lib = useAssetLibrary();
  const [filter, setFilter] = useState<CullFilter>('all');
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const workingSet = useMemo(
    () => selectedUsableAssets(['photo', 'video'], lib.assets, lib.selection),
    [lib.assets, lib.selection],
  );

  const filtered = useMemo(
    () => workingSet.filter((a) => matchesFilter(lib.verdicts.get(a.id), filter)),
    [workingSet, lib.verdicts, filter],
  );

  const counts = useMemo(() => {
    const c = Object.fromEntries(ALL_FILTERS.map((f) => [f, 0])) as Record<
      CullFilter,
      number
    >;
    for (const a of workingSet) {
      const v = lib.verdicts.get(a.id);
      for (const f of ALL_FILTERS) if (matchesFilter(v, f)) c[f] += 1;
    }
    return c;
  }, [workingSet, lib.verdicts]);

  // Keep focus on a still-visible asset (mirrors LUT's activeId effect).
  useEffect(() => {
    if (filtered.length === 0) {
      if (focusedId !== null) setFocusedId(null);
    } else if (focusedId === null || !filtered.some((a) => a.id === focusedId)) {
      setFocusedId(filtered[0].id);
    }
  }, [filtered, focusedId]);

  // The focused asset's cover (for the loupe's fallback) is built on demand.
  useEffect(() => {
    if (focusedId) lib.ensureMeta(focusedId);
  }, [focusedId, lib.ensureMeta]);

  const focusedAsset = filtered.find((a) => a.id === focusedId) ?? null;
  const focusIndex = filtered.findIndex((a) => a.id === focusedId);

  useCullKeys({
    enabled: focusedAsset !== null,
    onPrev: () => focusIndex > 0 && setFocusedId(filtered[focusIndex - 1].id),
    onNext: () =>
      focusIndex >= 0 &&
      focusIndex < filtered.length - 1 &&
      setFocusedId(filtered[focusIndex + 1].id),
    onRate: (n) => focusedId && lib.setRating(focusedId, n),
    onFlag: (f) => focusedId && lib.setFlag(focusedId, f),
    onClearFlag: () => focusedId && lib.setFlag(focusedId, null),
  });

  return (
    <section
      className="flex flex-col flex-1 min-h-0 gap-3 mt-4"
      aria-label="Cull"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <FilterBar value={filter} counts={counts} onChange={setFilter} />
        <p className="font-mono text-[0.72rem] text-muted tracking-[0.04em] m-0">
          {workingSet.length === 0
            ? 'nothing selected'
            : `${filtered.length}/${workingSet.length} shown · ←/→ 1–5 P X U`}
        </p>
      </div>

      <Loupe
        asset={focusedAsset}
        meta={focusedAsset ? lib.meta.get(focusedAsset.id) : undefined}
        verdict={focusedAsset ? lib.verdicts.get(focusedAsset.id) : undefined}
        onRate={(n) => focusedId && lib.setRating(focusedId, n)}
        onFlag={(f) => focusedId && lib.setFlag(focusedId, f)}
        className="flex-1 min-h-0"
      />

      <Grid
        assets={filtered}
        focusedId={focusedId}
        meta={lib.meta}
        verdicts={lib.verdicts}
        ensureMeta={lib.ensureMeta}
        onFocus={setFocusedId}
        className="flex-none h-44 p-1"
      />
    </section>
  );
}
