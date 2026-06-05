/**
 * Pure export planning for the Finalize tool — the unit-tested surface.
 *
 * Given the working set and its cull verdicts, decide which files to copy into
 * the album folder. Export is flat (every file lands in the chosen directory),
 * so names are de-duplicated case-insensitively.
 */
import type { Asset } from '../../shared/library/assets';
import type { Verdict } from '../../shared/library/AssetLibraryContext';

/** Threshold the user picks in the UI. Rejects are never exported. */
export type ExportCriterion = 'picks' | 'rated3' | 'rated4' | 'rated5';

export interface ExportItem {
  /** Destination filename in the album folder (de-duplicated). */
  name: string;
  file: File;
  /** The asset this file belongs to (for the assets-vs-files summary). */
  assetId: string;
}

/** Does an asset's verdict clear the export threshold? */
export function includesAsset(
  v: Verdict | undefined,
  c: ExportCriterion,
): boolean {
  if (v?.flag === 'reject') return false; // a reject is never a keeper
  if (c === 'picks') return v?.flag === 'pick';
  const min = c === 'rated3' ? 3 : c === 'rated4' ? 4 : 5;
  return (v?.rating ?? 0) >= min;
}

function uniqueName(name: string, used: Set<string>): string {
  if (!used.has(name.toLowerCase())) return name;
  const dot = name.lastIndexOf('.');
  const stem = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let i = 2;
  let candidate = `${stem} (${i})${ext}`;
  while (used.has(candidate.toLowerCase())) {
    i += 1;
    candidate = `${stem} (${i})${ext}`;
  }
  return candidate;
}

/**
 * Flat list of files to write for the assets that clear the threshold. Each
 * kept asset contributes all of its parts (image, or video + sidecar SRT).
 */
export function planExport(
  assets: Asset[],
  verdicts: ReadonlyMap<string, Verdict>,
  criterion: ExportCriterion,
): ExportItem[] {
  const used = new Set<string>();
  const items: ExportItem[] = [];
  for (const a of assets) {
    if (!includesAsset(verdicts.get(a.id), criterion)) continue;
    for (const file of [a.parts.image, a.parts.video, a.parts.srt]) {
      if (!file) continue;
      const name = uniqueName(file.name, used);
      used.add(name.toLowerCase());
      items.push({ name, file, assetId: a.id });
    }
  }
  return items;
}

export interface ExportSummary {
  assets: number;
  files: number;
  bytes: number;
}

export function exportSummary(items: ExportItem[]): ExportSummary {
  const assets = new Set(items.map((i) => i.assetId));
  const bytes = items.reduce((sum, i) => sum + i.file.size, 0);
  return { assets: assets.size, files: items.length, bytes };
}
