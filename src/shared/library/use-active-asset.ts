import { useEffect, useMemo } from 'react';
import { useAssetLibrary } from './AssetLibraryContext';
import { selectedUsableAssets } from './capabilities';
import type { Asset, AssetKind } from './assets';

/**
 * The active-asset protocol every editor-style tool repeats: project the
 * library selection down to the kinds the tool accepts, resolve the active
 * asset (the library's focused one when usable, else the first), echo it back
 * so the sidebar highlights it, request its cover metadata, and expose ‹/›
 * stepping.
 *
 * Pass `kinds` as a module-level constant — a fresh array per render would
 * re-run the projection every time.
 */
export interface ActiveAssetState {
  /** The usable selected assets, in library order. */
  assets: Asset[];
  activeId: string | null;
  active: Asset | null;
  activeIndex: number;
  goPrev: () => void;
  goNext: () => void;
}

export function useActiveAsset(kinds: readonly AssetKind[]): ActiveAssetState {
  const lib = useAssetLibrary();

  const assets = useMemo(
    () => selectedUsableAssets(kinds, lib.assets, lib.selection),
    [kinds, lib.assets, lib.selection],
  );

  const activeId =
    lib.activeId && assets.some((a) => a.id === lib.activeId)
      ? lib.activeId
      : (assets[0]?.id ?? null);
  const active = assets.find((a) => a.id === activeId) ?? null;
  const activeIndex = assets.findIndex((a) => a.id === activeId);

  // Reflect the effective active asset back to the library, so the sidebar
  // highlights it and a removed asset repoints to the first.
  useEffect(() => {
    if (activeId !== lib.activeId) lib.setActive(activeId);
  }, [activeId, lib.activeId, lib.setActive]);

  useEffect(() => {
    if (activeId) lib.ensureMeta(activeId);
  }, [activeId, lib.ensureMeta]);

  const goPrev = () => {
    if (activeIndex > 0) lib.setActive(assets[activeIndex - 1].id);
  };
  const goNext = () => {
    if (activeIndex >= 0 && activeIndex < assets.length - 1) {
      lib.setActive(assets[activeIndex + 1].id);
    }
  };

  return { assets, activeId, active, activeIndex, goPrev, goNext };
}
