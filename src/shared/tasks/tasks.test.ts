import { afterEach, describe, expect, it } from 'vitest';
import {
  SHOW_AFTER_MS,
  cancelTask,
  clearTasks,
  listTasks,
  nextReveal,
  overallProgress,
  pillWord,
  startTask,
  subscribeTasks,
  tasksFor,
  tasksSentence,
  tasksVersion,
  visibleTasks,
} from './tasks';

afterEach(() => clearTasks());

describe('the registry', () => {
  it('lists a task from start to done, and tells its subscribers each time', () => {
    let told = 0;
    const off = subscribeTasks(() => (told += 1));
    const v0 = tasksVersion();
    const h = startTask({ label: 'Opening DSC00123.ARW', scope: 'a' }, 1000);
    expect(listTasks().map((t) => t.label)).toEqual(['Opening DSC00123.ARW']);
    expect(listTasks()[0]).toMatchObject({ progress: null, detail: null, scope: 'a', cancel: null, startedAt: 1000 });
    h.update({ progress: 0.5, detail: '26 MB of 52' });
    expect(listTasks()[0]).toMatchObject({ progress: 0.5, detail: '26 MB of 52' });
    h.done();
    expect(listTasks()).toEqual([]);
    expect(told).toBe(3);
    expect(tasksVersion()).toBe(v0 + 3);
    off();
    // A handle that is done ignores what comes after.
    h.update({ progress: 1 });
    expect(listTasks()).toEqual([]);
  });

  it('keeps the same array until something changes, and clamps the bar', () => {
    const h = startTask({ label: 'x', progress: 1.4 });
    const a = listTasks();
    expect(a).toBe(listTasks());
    expect(a[0].progress).toBe(1);
    h.update({ progress: -1 });
    expect(listTasks()[0].progress).toBe(0);
    expect(listTasks()).not.toBe(a);
  });

  it('scopes a media’s own tasks', () => {
    startTask({ label: 'a', scope: 'm1' });
    startTask({ label: 'b', scope: 'm2' });
    startTask({ label: 'c' });
    expect(tasksFor('m1').map((t) => t.label)).toEqual(['a']);
    expect(tasksFor('m2').map((t) => t.label)).toEqual(['b']);
  });

  it('cancels only where the work can stop', () => {
    let stopped = 0;
    const can = startTask({ label: 'fetch', cancel: () => (stopped += 1) });
    const cannot = startTask({ label: 'decode' });
    expect(cancelTask(can.id)).toBe(true);
    expect(stopped).toBe(1);
    expect(cancelTask(cannot.id)).toBe(false);
    expect(cancelTask('nope')).toBe(false);
  });
});

describe('what a surface draws', () => {
  it('draws nothing under 400 ms, and says when the youngest becomes visible', () => {
    startTask({ label: 'old' }, 0);
    startTask({ label: 'young' }, 900);
    const all = listTasks();
    expect(visibleTasks(all, 1000).map((t) => t.label)).toEqual(['old']);
    expect(nextReveal(all, 1000)).toBe(SHOW_AFTER_MS - 100);
    expect(visibleTasks(all, 1300).map((t) => t.label)).toEqual(['old', 'young']);
    expect(nextReveal(all, 1300)).toBeNull();
  });

  it('measures the whole only where every part is measured', () => {
    startTask({ label: 'a', progress: 0.2 });
    startTask({ label: 'b', progress: 0.6 });
    expect(overallProgress(listTasks())).toBeCloseTo(0.4, 9);
    startTask({ label: 'c' });
    expect(overallProgress(listTasks())).toBeNull();
    expect(overallProgress([])).toBeNull();
  });

  it('says one word and one sentence', () => {
    expect(tasksSentence([])).toBe('Nothing running');
    const h = startTask({ label: 'Fetching DJI_0101.DNG', progress: 0.25, detail: '18 MB of 74' });
    expect(pillWord(listTasks())).toBe('Working');
    expect(tasksSentence(listTasks())).toBe('Fetching DJI_0101.DNG · 25 % · 18 MB of 74');
    h.update({ progress: null, detail: null });
    expect(tasksSentence(listTasks())).toBe('Fetching DJI_0101.DNG');
    startTask({ label: 'Exporting the roll' });
    expect(pillWord(listTasks())).toBe('2 running');
    expect(tasksSentence(listTasks())).toBe('2 things running — Fetching DJI_0101.DNG, Exporting the roll');
  });
});
