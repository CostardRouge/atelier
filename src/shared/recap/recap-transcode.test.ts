import { describe, expect, it } from 'vitest';
import { cellWindow, coverScale, loopWindow, shiftedLoop, transcodeArgs, transcodeKey } from './recap-transcode';

describe('converting an original the browser cannot play', () => {
  it('takes the loop with a margin, and reads the loop back on the converted clip', () => {
    const win = loopWindow({ loopIn: 2, loopOut: 5.5 });
    expect(win).toEqual({ from: 1.5, to: 6 });
    expect(shiftedLoop({ loopIn: 2, loopOut: 5.5, speed: 1 }, win)).toEqual({ loopIn: 0.5, loopOut: 4, speed: 1 });
    expect(loopWindow({ loopIn: 0.2, loopOut: null })).toEqual({ from: 0, to: null });
    expect(shiftedLoop({ loopIn: 0.2, loopOut: null }, { from: 0, to: null })).toEqual({ loopIn: 0.2, loopOut: null });
    expect(cellWindow()).toEqual({ from: 0, to: 30 });
  });

  it('scales to the page it covers, never past the source', () => {
    const s = coverScale(1080, 1920, 1.5);
    expect(s).toContain('min(ih,2880)');
    expect(s).toContain('min(iw,1620)');
    expect(s).toContain('gt(a,1080/1920)');
  });

  it('asks ffmpeg for the window, no sound, high quality', () => {
    const args = transcodeArgs('input.mov', 'output.mp4', { from: 1.5, to: 6 }, 'scale=1');
    expect(args.slice(0, 4)).toEqual(['-ss', '1.5', '-i', 'input.mov']);
    expect(args).toContain('-an');
    expect(args[args.indexOf('-t') + 1]).toBe('4.5');
    expect(args[args.indexOf('-crf') + 1]).toBe('17');
    expect(transcodeArgs('i.mov', 'o.mp4', { from: 0, to: null }, 's')).not.toContain('-ss');
  });

  it('keys a conversion by what it was made for', () => {
    expect(transcodeKey('l:IMG.MOV:1:2', { from: 1.5, to: 6 }, 1080, 1920, 1)).toBe('l:IMG.MOV:1:2#hq:1.5-6@1080x1920z1');
    expect(transcodeKey('k', { from: 0, to: null }, 1080, 1350, 2.345)).toBe('k#hq:0-end@1080x1350z2.35');
  });
});
