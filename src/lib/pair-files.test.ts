import { describe, expect, it } from 'vitest';
import { pairFiles } from './pair-files';

/** Build a zero-byte File with the given name (content is irrelevant here). */
function f(name: string): File {
  return new File([], name);
}

describe('pairFiles', () => {
  it('pairs a video with its SRT sibling', () => {
    const pairs = pairFiles([f('DJI_0001.MP4'), f('DJI_0001.SRT')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].baseName).toBe('DJI_0001');
    expect(pairs[0].srt).not.toBeNull();
    expect(pairs[0].video.name).toBe('DJI_0001.MP4');
  });

  it('matches across mixed extension casing', () => {
    const pairs = pairFiles([f('DJI_0002.mp4'), f('DJI_0002.srt')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].srt?.name).toBe('DJI_0002.srt');
  });

  it('includes a video with no SRT (srt: null)', () => {
    const pairs = pairFiles([f('DJI_0003.MP4')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].srt).toBeNull();
  });

  it('drops an orphan SRT with no video', () => {
    const pairs = pairFiles([f('DJI_0004.SRT')]);
    expect(pairs).toHaveLength(0);
  });

  it('ignores junk files (.LRF, .THM, hidden, unknown)', () => {
    const pairs = pairFiles([
      f('DJI_0001.LRF'),
      f('DJI_0001.THM'),
      f('.DS_Store'),
      f('notes.txt'),
    ]);
    expect(pairs).toHaveLength(0);
  });

  it('accepts .mov videos', () => {
    const pairs = pairFiles([f('DJI_0005.MOV'), f('DJI_0005.SRT')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].video.name).toBe('DJI_0005.MOV');
  });

  it('returns pairs sorted by ascending base name', () => {
    const pairs = pairFiles([
      f('DJI_0003.MP4'),
      f('DJI_0001.MP4'),
      f('DJI_0002.MP4'),
    ]);
    expect(pairs.map((p) => p.baseName)).toEqual([
      'DJI_0001',
      'DJI_0002',
      'DJI_0003',
    ]);
  });
});
