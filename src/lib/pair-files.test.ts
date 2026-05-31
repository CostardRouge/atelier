import { describe, expect, it } from 'vitest';
import {
  attachToPair,
  classifyFile,
  detachFromPair,
  fileBaseName,
  pairFiles,
} from './pair-files';

/** Build a zero-byte File with the given name (content is irrelevant here). */
function f(name: string): File {
  return new File([], name);
}

describe('classifyFile', () => {
  it('recognises videos, srt, and other', () => {
    expect(classifyFile('DJI_0001.MP4')).toBe('video');
    expect(classifyFile('DJI_0001.mov')).toBe('video');
    expect(classifyFile('DJI_0001.SRT')).toBe('srt');
    expect(classifyFile('DJI_0001.LRF')).toBe('other');
    expect(classifyFile('notes.txt')).toBe('other');
  });
});

describe('fileBaseName', () => {
  it('strips the extension', () => {
    expect(fileBaseName('DJI_0001.MP4')).toBe('DJI_0001');
    expect(fileBaseName('no-extension')).toBe('no-extension');
  });
});

describe('pairFiles', () => {
  it('pairs a video with its SRT sibling', () => {
    const pairs = pairFiles([f('DJI_0001.MP4'), f('DJI_0001.SRT')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].baseName).toBe('DJI_0001');
    expect(pairs[0].srt).not.toBeNull();
    expect(pairs[0].video?.name).toBe('DJI_0001.MP4');
  });

  it('matches across mixed extension casing', () => {
    const pairs = pairFiles([f('DJI_0002.mp4'), f('DJI_0002.srt')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].srt?.name).toBe('DJI_0002.srt');
  });

  it('includes a video with no SRT (srt: null)', () => {
    const pairs = pairFiles([f('DJI_0003.MP4')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].video).not.toBeNull();
    expect(pairs[0].srt).toBeNull();
  });

  it('keeps a lone SRT as a pair awaiting its video', () => {
    const pairs = pairFiles([f('DJI_0004.SRT')]);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].video).toBeNull();
    expect(pairs[0].srt).not.toBeNull();
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
    expect(pairs[0].video?.name).toBe('DJI_0005.MOV');
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

  it('gives each pair a stable id', () => {
    const pairs = pairFiles([f('DJI_0001.MP4')]);
    expect(pairs[0].id).toBe('dji_0001');
  });
});

describe('attachToPair', () => {
  it('fills the SRT slot on a video-only pair', () => {
    const [pair] = pairFiles([f('DJI_0001.MP4')]);
    const next = attachToPair(pair, f('DJI_0001.SRT'));
    expect(next.srt?.name).toBe('DJI_0001.SRT');
    expect(next.srtNameMismatch).toBe(false);
    // Immutable: original untouched.
    expect(pair.srt).toBeNull();
  });

  it('fills the video slot on an SRT-only pair', () => {
    const [pair] = pairFiles([f('DJI_0007.SRT')]);
    const next = attachToPair(pair, f('DJI_0007.MP4'));
    expect(next.video?.name).toBe('DJI_0007.MP4');
    expect(next.videoNameMismatch).toBe(false);
  });

  it('flags a name mismatch without rejecting the file', () => {
    const [pair] = pairFiles([f('DJI_0001.MP4')]);
    const next = attachToPair(pair, f('DJI_9999.SRT'));
    expect(next.srt?.name).toBe('DJI_9999.SRT');
    expect(next.srtNameMismatch).toBe(true);
  });

  it('ignores unsupported files', () => {
    const [pair] = pairFiles([f('DJI_0001.MP4')]);
    const next = attachToPair(pair, f('DJI_0001.LRF'));
    expect(next).toBe(pair);
  });
});

describe('detachFromPair', () => {
  it('clears a slot and its mismatch flag', () => {
    const [pair] = pairFiles([f('DJI_0001.MP4')]);
    const attached = attachToPair(pair, f('DJI_9999.SRT'));
    const detached = detachFromPair(attached, 'srt');
    expect(detached.srt).toBeNull();
    expect(detached.srtNameMismatch).toBe(false);
    expect(detached.video).not.toBeNull();
  });
});
