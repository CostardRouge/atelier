import { describe, expect, it } from 'vitest';
import { KEEP_VERSIONS, signature, VERSION_EVERY_MS, versionOf, versionWhen, withVersion, type ScriptVersion } from './script-versions';
import { newScript, type StoryScript } from './story-script';

const s = (series: string): StoryScript => newScript(series);

describe('signature', () => {
  it('tells two texts apart, the same text alike', () => {
    expect(signature('abc')).toBe(signature('abc'));
    expect(signature('abc')).not.toBe(signature('abd'));
  });
});

describe('withVersion', () => {
  it('keeps nothing when the state is the newest one', () => {
    const v = versionOf(s('A'), 1000, 'edits');
    expect(withVersion([v], versionOf(s('A'), 2000, 'edits'))).toBeNull();
  });
  it('lets the newest version follow the edits, then opens a new one', () => {
    let list: ScriptVersion[] = [versionOf(s('A'), 0, 'edits')];
    list = withVersion(list, versionOf(s('AB'), 60_000, 'edits'))!;
    expect(list).toHaveLength(1);
    expect(list[0].series).toBe('AB');
    expect(list[0].opened).toBe(0);
    list = withVersion(list, versionOf(s('ABC'), VERSION_EVERY_MS + 1, 'edits'))!;
    expect(list.map((v) => v.series)).toEqual(['ABC', 'AB']);
  });
  it('always opens one for a load, and never folds an edit into it', () => {
    let list: ScriptVersion[] = [versionOf(s('A'), 0, 'edits')];
    list = withVersion(list, versionOf(s('File'), 10, 'loaded'))!;
    list = withVersion(list, versionOf(s('File+'), 20, 'edits'))!;
    expect(list.map((v) => v.why)).toEqual(['edits', 'loaded', 'edits']);
  });
  it('drops the oldest past the limit', () => {
    let list: ScriptVersion[] = [];
    for (let i = 0; i < KEEP_VERSIONS + 3; i++) list = withVersion(list, versionOf(s(`S${i}`), i, 'loaded'))!;
    expect(list).toHaveLength(KEEP_VERSIONS);
    expect(list[0].series).toBe(`S${KEEP_VERSIONS + 2}`);
  });
});

describe('versionWhen', () => {
  it('says a moment against now', () => {
    const now = Date.UTC(2026, 10, 2, 15, 0);
    expect(versionWhen(now - 10_000, now)).toBe('just now');
    expect(versionWhen(now - 12 * 60_000, now)).toBe('12 min ago');
    expect(versionWhen(now - 3 * 3_600_000, now)).toMatch(/^today \d\d:\d\d$/);
    expect(versionWhen(now - 26 * 3_600_000, now)).toMatch(/^yesterday/);
  });
});
