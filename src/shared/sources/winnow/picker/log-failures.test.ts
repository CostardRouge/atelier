import { describe, expect, it } from 'vitest';
import { WinnowError } from '../client';
import { logFailureOf, logFailureText, type FailedLog } from './log-failures';

describe('a log the instance could not hand over', () => {
  it('is unreachable on a 404, failed on anything else', () => {
    expect(logFailureOf(new WinnowError('notfound', 'Not there', 404))).toBe('unreachable');
    expect(logFailureOf(new WinnowError('protocol', 'answered 500', 500))).toBe('failed');
    expect(logFailureOf(new TypeError('Failed to fetch'))).toBe('failed');
  });

  it('says what landed, then the drive, then anything else', () => {
    const gone = (n: number): FailedLog[] =>
      Array.from({ length: n }, (_, i) => ({ filename: `DJI_${i}.SRT`, why: 'unreachable', message: 'Not there' }));
    expect(logFailureText(gone(133), 23, 'winnow.example')).toBe(
      "23 logs added · 133 logs not on winnow.example's disk — it lists those clips but cannot read the .srt (is the drive they were ingested from plugged in?)",
    );
    expect(logFailureText(gone(1), 0, 'w')).toBe(
      "1 log not on w's disk — it lists that clip but cannot read the .srt (is the drive it was ingested from plugged in?)",
    );
    expect(
      logFailureText([{ filename: 'DJI_9.SRT', why: 'failed', message: 'answered 500' }, ...gone(2)], 1, 'w'),
    ).toBe(
      "1 log added · 2 logs not on w's disk — it lists those clips but cannot read the .srt (is the drive they were ingested from plugged in?) · 1 log could not be fetched (DJI_9.SRT: answered 500)",
    );
  });
});
