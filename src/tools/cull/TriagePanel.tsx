import { useEffect, useMemo, useState } from 'react';
import { useAssetLibrary } from '../../shared/library/AssetLibraryContext';
import { selectedUsableAssets } from '../../shared/library/capabilities';
import FilterBar from './FilterBar';
import Grid from './Grid';
import Loupe from './Loupe';
import ModeSwitch, { type CullMode } from './ModeSwitch';
import { useCullKeys } from './use-cull-keys';
import { matchesFilter, type CullFilter } from './verdict-filter';

const ALL_FILTERS: CullFilter[] = [
  'all', 'picks', 'rejects', 'unrated', 'rated2', 'rated3', 'rated4', 'rated5',
];

interface TriagePanelProps {
  mode: CullMode;
  onModeChange: (mode: CullMode) => void;
}

/**
 * Triage — the first half of the tool. Rip through the photos and clips selected
 * in the library, rate them 1–5, flag picks/rejects, and filter to the keepers.
 * The verdict lives in the library so the Export half (and later tools) act on
 * the picks.
 */
export default function TriagePanel({ mode, onModeChange }: TriagePanelProps) {
  const lib = useAssetLibrary();
  const [filter, setFilter] = useState<CullFilter>('all');
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [zen, setZen] = useState(false);

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
    onToggleZen: () => setZen((z) => !z),
    onExitZen: () => setZen(false),
  });

  // Leaving fullscreen when the focus clears keeps the empty state coherent.
  useEffect(() => {
    if (!focusedAsset && zen) setZen(false);
  }, [focusedAsset, zen]);

  const loupe = (
    <Loupe
      asset={focusedAsset}
      meta={focusedAsset ? lib.meta.get(focusedAsset.id) : undefined}
      verdict={focusedAsset ? lib.verdicts.get(focusedAsset.id) : undefined}
      onRate={(n) => focusedId && lib.setRating(focusedId, n)}
      onFlag={(f) => focusedId && lib.setFlag(focusedId, f)}
      zen={zen}
      onToggleZen={() => setZen((z) => !z)}
      className="flex-1 min-h-0"
    />
  );

  if (zen) {
    return (
      <section
        className="fixed inset-0 z-50 flex flex-col gap-2 bg-paper p-4"
        aria-label="Cull (fullscreen)"
      >
        <p className="font-mono text-[0.72rem] text-muted tracking-[0.04em] m-0 text-center">
          {focusedAsset?.baseName ?? ''} · {focusIndex + 1}/{filtered.length} ·
          ←/→ 1–5 P X U · Esc to exit
        </p>
        {loupe}
      </section>
    );
  }

  return (
    <section
      className="flex flex-col flex-1 min-h-0 gap-3"
      aria-label="Triage"
    >
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <ModeSwitch mode={mode} onChange={onModeChange} />
          <FilterBar value={filter} counts={counts} onChange={setFilter} />
        </div>
        <p className="font-mono text-[0.72rem] text-muted tracking-[0.04em] m-0">
          {workingSet.length === 0
            ? 'nothing selected'
            : `${filtered.length}/${workingSet.length} shown · ←/→ 1–5 P X U`}
        </p>
      </div>

      {loupe}

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
