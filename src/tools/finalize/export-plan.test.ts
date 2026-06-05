import { describe, expect, it } from 'vitest';
import type { Asset, AssetKind, AssetParts } from '../../shared/library/assets';
import type { Verdict, Flag } from '../../shared/library/AssetLibraryContext';
import {
  exportSummary,
  includesAsset,
  matchesBucket,
  planExport,
  type ExportBucket,
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
const sel = (...buckets: ExportBucket[]): ReadonlySet<ExportBucket> =>
  new Set(buckets);

describe('matchesBucket', () => {
  it('matches an exact star level or the pick flag', () => {
    expect(matchesBucket(v(0, 'pick'), 'pick')).toBe(true);
    expect(matchesBucket(v(3), 3)).toBe(true);
    expect(matchesBucket(v(3), 4)).toBe(false); // exact, not threshold
    expect(matchesBucket(v(5), 'pick')).toBe(false); // rated, not flagged
    expect(matchesBucket(undefined, 1)).toBe(false);
  });

  it('a reject never matches any bucket', () => {
    expect(matchesBucket(v(5, 'reject'), 5)).toBe(false);
    expect(matchesBucket(v(0, 'reject'), 'pick')).toBe(false);
  });
});

describe('includesAsset (union of ticked buckets)', () => {
  it('includes when any selected bucket matches', () => {
    expect(includesAsset(v(1), sel('pick', 1))).toBe(true);
    expect(includesAsset(v(0, 'pick'), sel('pick', 1))).toBe(true);
    expect(includesAsset(v(2), sel('pick', 1))).toBe(false);
  });

  it('an empty selection includes nothing', () => {
    expect(includesAsset(v(5, 'pick'), sel())).toBe(false);
  });
});

describe('planExport', () => {
  const verdicts = new Map<string, Verdict>([
    ['a', v(1, 'pick')], // 1 star AND picked
    ['b', v(4)],
    ['c', v(1)], // 1 star only
    ['d', v(5, 'reject')],
    ['e', v(0, 'pick')], // picked, unrated
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
    asset('e', { image: file('IMG_e.jpg', 10) }),
  ];

  it('the one-star ∪ picks selection grabs both kinds in one export, no dupes', () => {
    const items = planExport(assets, verdicts, sel('pick', 1));
    // a (1★+pick, once), c (1★), e (pick) — b (★4) and rejected d excluded.
    expect(items.map((i) => i.name).sort()).toEqual([
      'IMG_a.jpg',
      'IMG_c.jpg',
      'IMG_e.jpg',
    ]);
  });

  it('exact star buckets do not spill over (★4 excludes ★1 and ★5)', () => {
    const items = planExport(assets, verdicts, sel(4));
    expect(items.map((i) => i.name)).toEqual(['CLIP_b.mp4', 'CLIP_b.srt']);
    expect(exportSummary(items)).toEqual({ assets: 1, files: 2, bytes: 105 });
  });

  it('de-duplicates colliding filenames case-insensitively', () => {
    const dupVerdicts = new Map<string, Verdict>([
      ['x', v(0, 'pick')],
      ['y', v(0, 'pick')],
    ]);
    const dupAssets = [
      asset('x', { image: file('DJI_0001.JPG', 1) }),
      asset('y', { image: file('dji_0001.jpg', 1) }),
    ];
    const names = planExport(dupAssets, dupVerdicts, sel('pick')).map((i) => i.name);
    expect(names).toEqual(['DJI_0001.JPG', 'dji_0001 (2).jpg']);
  });

  it('an empty selection plans nothing', () => {
    expect(planExport(assets, verdicts, sel())).toEqual([]);
  });
});
