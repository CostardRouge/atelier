import { describe, expect, it } from 'vitest';
import type { Asset, AssetKind, AssetParts } from '../../shared/library/assets';
import type { Verdict, Flag } from '../../shared/library/AssetLibraryContext';
import {
  exportSummary,
  includesAsset,
  planExport,
  type ExportCriterion,
} from './export-plan';

function file(name: string, bytes: number): File {
  return new File([new Uint8Array(bytes)], name);
}

function asset(id: string, parts: AssetParts, kind: AssetKind = 'photo'): Asset {
  const size = [parts.video, parts.srt, parts.image].reduce(
    (s, p) => s + (p?.size ?? 0),
    0,
  );
  return { id, baseName: id, parts, kind, size };
}

const v = (rating: number, flag: Flag = null): Verdict => ({ rating, flag });

describe('includesAsset', () => {
  it('matches the chosen threshold, never a reject', () => {
    expect(includesAsset(v(0, 'pick'), 'picks')).toBe(true);
    expect(includesAsset(v(5), 'picks')).toBe(false); // rated but not flagged
    expect(includesAsset(v(4), 'rated4')).toBe(true);
    expect(includesAsset(v(3), 'rated4')).toBe(false);
    expect(includesAsset(undefined, 'rated3')).toBe(false);
  });

  it('rejects are excluded even when highly rated or picked', () => {
    expect(includesAsset(v(5, 'reject'), 'rated4')).toBe(false);
    expect(includesAsset(v(0, 'reject'), 'picks')).toBe(false);
  });
});

describe('planExport', () => {
  const verdicts = new Map<string, Verdict>([
    ['a', v(5, 'pick')],
    ['b', v(4)],
    ['c', v(2)],
    ['d', v(5, 'reject')],
  ]);
  const assets = [
    asset('a', { image: file('IMG_a.jpg', 10) }),
    asset(
      'b',
      { video: file('CLIP_b.mp4', 100), srt: file('CLIP_b.srt', 5) },
      'video+telemetry',
    ),
    asset('c', { image: file('IMG_c.jpg', 10) }),
    asset('d', { image: file('IMG_d.jpg', 10) }),
  ];

  it("'picks' exports only flagged assets, with all their parts", () => {
    const items = planExport(assets, verdicts, 'picks');
    expect(items.map((i) => i.name)).toEqual(['IMG_a.jpg']);
  });

  it("'rated4' includes b's video + sidecar, excludes the c (★2) and rejected d", () => {
    const items = planExport(assets, verdicts, 'rated4');
    expect(items.map((i) => i.name).sort()).toEqual([
      'CLIP_b.mp4',
      'CLIP_b.srt',
      'IMG_a.jpg',
    ]);
    const s = exportSummary(items);
    expect(s).toEqual({ assets: 2, files: 3, bytes: 115 });
  });

  it('de-duplicates colliding filenames case-insensitively', () => {
    const dupVerdicts = new Map<string, Verdict>([
      ['x', v(5, 'pick')],
      ['y', v(5, 'pick')],
    ]);
    const dupAssets = [
      asset('x', { image: file('DJI_0001.JPG', 1) }),
      asset('y', { image: file('dji_0001.jpg', 1) }),
    ];
    const names = planExport(dupAssets, dupVerdicts, 'picks').map((i) => i.name);
    expect(names).toEqual(['DJI_0001.JPG', 'dji_0001 (2).jpg']);
  });

  it('keeps asset order and is empty when nothing clears the bar', () => {
    const empty = planExport(assets, verdicts, 'rated5');
    expect(empty.map((i) => i.name)).toEqual(['IMG_a.jpg']); // only a is ★5 (not reject)
    const none = planExport(
      assets,
      new Map<string, Verdict>(),
      'picks' as ExportCriterion,
    );
    expect(none).toEqual([]);
  });
});
