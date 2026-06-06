import { useEffect, useMemo, useRef, useState } from 'react';
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
 *
 * The focused asset *is* the library's active asset (`lib.activeId`), so it's
 * shared both ways: clicking a row in the sidebar focuses it here, and moving
 * the loupe here highlights that row there.
 */
export default function TriagePanel({ mode, onModeChange }: TriagePanelProps) {
  const lib = useAssetLibrary();
  const [filter, setFilter] = useState<CullFilter>('all');
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

  // The focusable universe is the *filtered* set (what the grid and arrows show).
  const focusedAsset = filtered.find((a) => a.id === lib.activeId) ?? null;
  const focusIndex = filtered.findIndex((a) => a.id === lib.activeId);

  // Keep the shared active asset pointing at something visible:
  //  • already shown → leave it;
  //  • the library just focused an asset the filter is hiding (a fresh click in
  //    the sidebar) → relax the filter to 'all' so it actually surfaces here;
  //  • otherwise (focus pushed out of the filter, e.g. you rated it past the
  //    threshold, or a stale id) → re-point to the first visible asset.
  // `changed` distinguishes a new sidebar click from the focus merely dropping
  // out of the filter — only the former reveals.
  const prevActive = useRef<string | null>(lib.activeId);
  useEffect(() => {
    const changed = lib.activeId !== prevActive.current;
    prevActive.current = lib.activeId;

    if (lib.activeId != null && filtered.some((a) => a.id === lib.activeId)) {
      return;
    }
    if (
      changed &&
      lib.activeId != null &&
      workingSet.some((a) => a.id === lib.activeId)
    ) {
      setFilter('all');
      return;
    }
    const first = filtered[0]?.id ?? null;
    if (first !== lib.activeId) lib.setActive(first);
  }, [lib.activeId, workingSet, filtered, lib.setActive]);

  // The focused asset's cover (for the loupe's fallback) is built on demand.
  useEffect(() => {
    if (lib.activeId) lib.ensureMeta(lib.activeId);
  }, [lib.activeId, lib.ensureMeta]);

  useCullKeys({
    enabled: focusedAsset !== null,
    onPrev: () => focusIndex > 0 && lib.setActive(filtered[focusIndex - 1].id),
    onNext: () =>
      focusIndex >= 0 &&
      focusIndex < filtered.length - 1 &&
      lib.setActive(filtered[focusIndex + 1].id),
    onRate: (n) => lib.activeId && lib.setRating(lib.activeId, n),
    onFlag: (f) => lib.activeId && lib.setFlag(lib.activeId, f),
    onClearFlag: () => lib.activeId && lib.setFlag(lib.activeId, null),
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
      onRate={(n) => lib.activeId && lib.setRating(lib.activeId, n)}
      onFlag={(f) => lib.activeId && lib.setFlag(lib.activeId, f)}
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
        focusedId={lib.activeId}
        meta={lib.meta}
        verdicts={lib.verdicts}
        ensureMeta={lib.ensureMeta}
        onFocus={lib.setActive}
        className="flex-none h-44 p-1"
      />
    </section>
  );
}
