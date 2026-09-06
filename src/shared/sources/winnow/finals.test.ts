import { describe, expect, it } from 'vitest';
import { finalsPath, finalsPlan, splitAssetId } from './finals';

const HOST = 'winnow.example';
const files = [
  { name: 'DJI_0001-9x16-1080p.mp4', size: 40_000_000 },
  { name: 'DJI_0001-clean.mp4', size: 90_000_000 },
];

describe('splitAssetId', () => {
  it('splits the host off the id the source vouched with', () => {
    expect(splitAssetId('winnow.example/42')).toEqual({ host: 'winnow.example', id: 42 });
    expect(splitAssetId('winnow.example:8443/7')).toEqual({ host: 'winnow.example:8443', id: 7 });
  });

  it('is null for anything that is not "<host>/<id>"', () => {
    for (const bad of [null, undefined, '', '42', '/42', 'host/', 'host/abc', 'host/0', 'host/-1']) {
      expect(splitAssetId(bad), String(bad)).toBeNull();
    }
  });
});

describe('finalsPath — Winnow\'s nouns, never a trip\'s', () => {
  it('nests under the chapter when one is known, else at the root', () => {
    expect(finalsPath('12', 'a.mp4')).toBe('12/a.mp4');
    expect(finalsPath(null, 'a.mp4')).toBe('a.mp4');
    expect(finalsPath('', 'a.mp4')).toBe('a.mp4');
  });

  it('never lets a file name carry a directory of its own', () => {
    expect(finalsPath('12', '../x/a.mp4')).toBe('12/.._x_a.mp4');
  });
});

describe('finalsPlan', () => {
  it('sends the numeric id when the clip came from the target', () => {
    const plan = finalsPlan({ files, assetId: `${HOST}/42`, targetSourceId: HOST, maxUploadBytes: null });
    expect(plan.problems).toEqual([]);
    expect(plan.originalAssetId).toBe(42);
    expect(plan.items.map((i) => i.path)).toEqual(files.map((f) => f.name));
    expect(plan.totalBytes).toBe(130_000_000);
    expect(plan.notes).toEqual([]);
  });

  it('refuses to link a clip from another instance', () => {
    const plan = finalsPlan({ files, assetId: 'other.example/42', targetSourceId: HOST, maxUploadBytes: null });
    expect(plan.originalAssetId).toBeNull();
    expect(plan.problems[0]).toContain('other.example');
    expect(plan.problems[0]).toContain(HOST);
  });

  it('lets reconcile match by name when there is no id, and says so', () => {
    const plan = finalsPlan({ files, assetId: null, targetSourceId: HOST, maxUploadBytes: null });
    expect(plan.problems).toEqual([]);
    expect(plan.originalAssetId).toBeNull();
    expect(plan.notes[0]).toMatch(/by name and capture time/);
  });

  it('checks the upload limit before a byte moves, naming the file and the limit', () => {
    const plan = finalsPlan({ files, assetId: `${HOST}/42`, targetSourceId: HOST, maxUploadBytes: 50_000_000 });
    expect(plan.problems).toHaveLength(1);
    expect(plan.problems[0]).toContain('DJI_0001-clean.mp4');
    expect(plan.problems[0]).toMatch(/at most/);
  });

  it('ignores a limit the instance did not set', () => {
    expect(finalsPlan({ files, assetId: null, targetSourceId: HOST, maxUploadBytes: 0 }).problems).toEqual([]);
  });

  it('puts the finals under the chapter when one is known', () => {
    const plan = finalsPlan({ files, assetId: null, targetSourceId: HOST, chapterId: '7', maxUploadBytes: null });
    expect(plan.chapterId).toBe('7');
    expect(plan.items[0].path).toBe('7/DJI_0001-9x16-1080p.mp4');
  });

  it('has nothing to send from an empty run', () => {
    expect(finalsPlan({ files: [], assetId: null, targetSourceId: HOST, maxUploadBytes: null }).problems[0]).toMatch(/export first/);
  });
});
