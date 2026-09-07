/**
 * Which source an asset in the pool came from — the pool's answer to
 * `groupBySource` for documents.
 *
 * The library holds one flat pool of `File`s and never asks where they came
 * from; the identity registry does (`materialize` registers every fetched
 * file with a `MediaOrigin`). Reading that back per asset is what lets the
 * sidebar keep a folder's files and an instance's files apart — the
 * maintainer's ask: *"pas de mélange"* — without the pool learning a second
 * shape.
 *
 * Pure over the registry: no DOM, no fetch.
 */

import type { Asset } from './assets';
import { knownIdentity, mediaOrigin } from '../projects/media-identity';
import { DEFAULT_SOURCE_ID } from '../sources/source';

/** The file that speaks for an asset: its picture, else its clip, else its log. */
export function assetMainFile(asset: Asset): File | null {
  return asset.parts.image ?? asset.parts.video ?? asset.parts.srt ?? null;
}

/** The source id a source vouched this asset with, or `local` for a file the user opened. */
export function assetSourceId(asset: Asset): string {
  const main = assetMainFile(asset);
  return (main && mediaOrigin(main)?.sourceId) || DEFAULT_SOURCE_ID;
}

/** `"<host>/<id>"` as the source vouched it, or null for a local file. */
export function assetRemoteId(asset: Asset): string | null {
  const main = assetMainFile(asset);
  const identity = main ? knownIdentity(main) : null;
  return identity?.origin ? (identity.assetId ?? null) : null;
}

export interface AssetsBySource {
  /** Files the user opened from disk — no source vouched for them. */
  local: Asset[];
  /** Fetched from a source, keyed by its id; each list in pool order. */
  remote: Map<string, Asset[]>;
}

/** Split the pool by provenance, keeping pool order inside each group. */
export function splitAssetsBySource(assets: readonly Asset[]): AssetsBySource {
  const local: Asset[] = [];
  const remote = new Map<string, Asset[]>();
  for (const asset of assets) {
    const id = assetSourceId(asset);
    if (id === DEFAULT_SOURCE_ID) {
      local.push(asset);
      continue;
    }
    const bucket = remote.get(id);
    if (bucket) bucket.push(asset);
    else remote.set(id, [asset]);
  }
  return { local, remote };
}
