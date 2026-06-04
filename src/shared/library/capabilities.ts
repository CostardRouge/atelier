/**
 * Capability matching — which assets a tool can actually use.
 *
 * A tool declares the {@link AssetKind}s it accepts; the library projects its
 * pool down to that. The one non-trivial rule: an asset that holds a video
 * *plus* telemetry still satisfies a tool that only wants `video` (it just
 * ignores the sidecar), so a LUT tool sees DJI clips too.
 */
import type { Asset, AssetKind } from './assets';

/** True when `asset` can be used by a tool accepting `accepts`. */
export function assetUsableBy(accepts: readonly AssetKind[], asset: Asset): boolean {
  if (accepts.includes(asset.kind)) return true;
  // A video+telemetry asset can stand in for a plain `video` request.
  if (asset.kind === 'video+telemetry' && accepts.includes('video')) return true;
  return false;
}

/** The subset of `assets` usable by a tool accepting `accepts`. */
export function usableAssets(
  accepts: readonly AssetKind[],
  assets: readonly Asset[],
): Asset[] {
  return assets.filter((a) => assetUsableBy(accepts, a));
}

/**
 * The usable assets that are also currently selected — what a tool should act
 * on. Preserves the order of `assets`.
 */
export function selectedUsableAssets(
  accepts: readonly AssetKind[],
  assets: readonly Asset[],
  selection: ReadonlySet<string>,
): Asset[] {
  return assets.filter((a) => selection.has(a.id) && assetUsableBy(accepts, a));
}
