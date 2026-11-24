import { describe, expect, it } from 'vitest';
import type { WinnowSession } from '../client';
import {
  OWN_MEDIA,
  chainTo,
  folderTree,
  matchFolders,
  matchRanges,
  nodeAt,
  orderFolders,
  parentLabel,
  pushRecent,
  shortDays,
  sortedShare,
  trailTo,
} from './folder-tree';

let next = 1;
const folder = (source_path: string, day: string, count = 10, extra: Partial<WinnowSession> = {}): WinnowSession => ({
  id: next++,
  name: source_path.split('/').pop() ?? source_path,
  source_path,
  device_hint: 'ILCE-7M4',
  captured_at_min: `${day}T09:00:00Z`,
  captured_at_max: `${day}T17:00:00Z`,
  asset_count: count,
  status: 'to_sort',
  root_kind: 'source',
  ...extra,
});

describe('folderTree', () => {
  it('rebuilds the hierarchy and merges a chain of single parents', () => {
    const a = folder('sony/photos/2026/novembre 2026/20261122 Colmar', '2026-11-22', 400);
    const b = folder('sony/photos/2026/octobre 2026/20261012 Riquewihr', '2026-10-12', 900);
    const c = folder('dji/mini4pro/2026/20261115 Vosges', '2026-11-15', 64);
    const root = folderTree([a, b, c], 'UTC');
    expect(root.children.map((n) => n.name)).toEqual(['sony/photos/2026', 'dji/mini4pro/2026']);
    const sony = root.children[0];
    expect(sony.count).toBe(1300);
    expect(sony.from).toBe('2026-10-12');
    expect(sony.to).toBe('2026-11-22');
    expect(sony.children.map((n) => n.name)).toEqual(['novembre 2026', 'octobre 2026']);
    expect(sony.sessions.map((s) => s.id)).toEqual([a.id, b.id]);
  });

  it('never folds a parent into the one folder it holds', () => {
    const a = folder('iphone/2026/11/camera roll', '2026-11-20');
    const root = folderTree([a], 'UTC');
    expect(root.children[0].name).toBe('iphone/2026/11');
    expect(root.children[0].children[0].name).toBe('camera roll');
    expect(root.children[0].children[0].session?.id).toBe(a.id);
  });

  it('gives a folder that also holds folders its own media as a first leaf', () => {
    const parent = folder('trips/Lisbonne', '2026-09-18', 50);
    const child = folder('trips/Lisbonne/drone', '2026-09-20', 5);
    const root = folderTree([child, parent], 'UTC');
    const lis = nodeAt(root, 'trips/Lisbonne')!;
    expect(lis.session).toBeNull();
    expect(lis.children[0].name).toBe(OWN_MEDIA);
    expect(lis.children[0].session?.id).toBe(parent.id);
    expect(lis.count).toBe(55);
  });

  it('keeps two folders on one path apart', () => {
    const a = folder('inbox/day', '2026-01-01');
    const b = folder('inbox/day', '2026-01-02');
    const root = folderTree([a, b], 'UTC');
    expect(chainTo(root, a.id)).not.toBeNull();
    expect(chainTo(root, b.id)).not.toBeNull();
  });

  it('reads days in the given zone', () => {
    const a = folder('x/y', '2026-11-21', 1, {
      captured_at_min: '2026-11-21T22:30:00Z',
      captured_at_max: '2026-11-21T23:00:00Z',
    });
    const chain = chainTo(folderTree([a], 'Australia/Melbourne'), a.id)!;
    const leaf = chain[chain.length - 1];
    expect(leaf.from).toBe('2026-11-22');
  });

  it('weighs the sorted share by media and leaves it null when Winnow said nothing', () => {
    const a = folder('p/a', '2026-01-01', 100, { unrated_count: 0 });
    const b = folder('p/b', '2026-01-02', 300, { unrated_count: 300 });
    const root = folderTree([a, b], 'UTC');
    expect(root.children[0].sorted).toBeCloseTo(0.25);
    expect(sortedShare(folder('q', '2026-01-01'))).toBeNull();
  });
});

describe('chainTo', () => {
  it('walks down to the folder that opens a session', () => {
    const a = folder('sony/photos/2026/novembre 2026/Colmar', '2026-11-22');
    const b = folder('sony/videos/2026/clips', '2026-11-06');
    const root = folderTree([a, b], 'UTC');
    expect(chainTo(root, a.id)!.map((n) => n.name)).toEqual(['sony', 'photos/2026/novembre 2026', 'Colmar']);
    expect(chainTo(root, 999)).toBeNull();
  });
});

describe('orderFolders', () => {
  it('orders newest first or A–Z, own media always first', () => {
    const own = folder('t', '2026-01-01');
    const z = folder('t/zebra', '2026-03-01');
    const a = folder('t/alpha 10', '2026-02-01');
    const a2 = folder('t/alpha 9', '2026-01-15');
    const t = folderTree([own, z, a, a2], 'UTC').children[0];
    expect(orderFolders(t.children, 'time').map((n) => n.name)).toEqual([OWN_MEDIA, 'zebra', 'alpha 10', 'alpha 9']);
    expect(orderFolders(t.children, 'name').map((n) => n.name)).toEqual([OWN_MEDIA, 'alpha 9', 'alpha 10', 'zebra']);
  });
});

describe('matchFolders', () => {
  const list = [
    folder('sony/photos/2026/novembre 2026/Colmar', '2026-11-22'),
    folder('sony/photos/2026/août 2026/Jura', '2026-08-14'),
    folder('dji/mini4pro/2026/Vosges', '2026-11-15', 5, { device_hint: 'DJI Mini 4 Pro' }),
  ];
  it('needs every word, anywhere, accents and case aside', () => {
    expect(matchFolders(list, 'nov 26').map((s) => s.name)).toEqual(['Colmar']);
    expect(matchFolders(list, 'AOUT').map((s) => s.name)).toEqual(['Jura']);
    expect(matchFolders(list, 'mini vosges').map((s) => s.name)).toEqual(['Vosges']);
    expect(matchFolders(list, '2026-11-15').map((s) => s.name)).toEqual(['Vosges']);
    expect(matchFolders(list, '   ')).toEqual([]);
  });
});

describe('matchRanges', () => {
  it('marks every word, merged and mapped back through accents', () => {
    expect(matchRanges('août 2026', 'aout 26')).toEqual([[0, 4], [7, 9]]);
    expect(matchRanges('Colmar', '')).toEqual([]);
  });
});

describe('pushRecent', () => {
  it('puts the folder first, once, five at most', () => {
    expect(pushRecent([1, 2, 3, 4, 5], 3)).toEqual([3, 1, 2, 4, 5]);
    expect(pushRecent([1, 2, 3, 4, 5], 9)).toEqual([9, 1, 2, 3, 4]);
  });
});

describe('parentLabel', () => {
  it('joins the parents with ›', () => {
    expect(parentLabel('sony/photos/2026/Colmar')).toBe('sony › photos › 2026');
    expect(parentLabel('Colmar')).toBe('');
  });
});

describe('trailTo', () => {
  it('lists the nodes down to a path, empty for the root, null for nothing', () => {
    const a = folder('sony/photos/2026/novembre 2026/Colmar', '2026-11-22');
    const b = folder('sony/videos/clips', '2026-11-06');
    const root = folderTree([a, b], 'UTC');
    expect(trailTo(root, 'sony/photos/2026/novembre 2026')!.map((n) => n.name)).toEqual(['sony', 'photos/2026/novembre 2026']);
    expect(trailTo(root, '')).toEqual([]);
    expect(trailTo(root, 'nope')).toBeNull();
  });
});

describe('shortDays', () => {
  it('says a day, a run in a month, across months and across years', () => {
    expect(shortDays('2026-11-22', '2026-11-22')).toBe('22 Nov 26');
    expect(shortDays('2026-11-15', '2026-11-16')).toBe('15–16 Nov 26');
    expect(shortDays('2026-09-30', '2026-10-02')).toBe('30 Sep → 2 Oct 26');
    expect(shortDays('2025-12-28', '2026-01-02')).toBe('28 Dec 25 → 2 Jan 26');
    expect(shortDays(null, null)).toBe('—');
  });
});
