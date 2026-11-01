import { describe, expect, it } from 'vitest';
import { createTripDoc } from '../roadtrip/trip-types';
import { countedSpan, factsOf, mapChoiceOf, sourcesOf, tripLine, withPostHooks, withSeriesFacts, withSeriesSources, withChosenWall, withLook, withWall } from './sources';
import { parseScript, SCRIPT_KIND, type StoryScript } from './story-script';

const base: StoryScript = { kind: SCRIPT_KIND, version: 1, posts: { a: {}, b: {} } };

describe('reading sources and facts from a script file', () => {
  it('keeps well-formed sources and facts, for the series and a post', () => {
    const parsed = parseScript({
      ...base,
      sources: { trip: { id: 't1', name: 'Australie' }, winnow: { source: 'winnow.example' } },
      facts: { at: '2026-10-31T10:00:00Z', from: 'Australie', values: { 'media.total': 98412, days: 178 } },
      posts: { a: { sources: { winnow: { source: 'localhost:3000' } }, facts: { at: '2026-10-31T11:00:00Z', values: { 'media.photo': 10 } } } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.script.sources).toEqual({ trip: { id: 't1', name: 'Australie' }, winnow: { source: 'winnow.example' } });
    expect(parsed.script.facts?.values).toEqual({ 'media.total': 98412, days: 178 });
    expect(parsed.script.posts.a.sources).toEqual({ winnow: { source: 'localhost:3000' } });
    expect(parsed.script.posts.a.facts?.values).toEqual({ 'media.photo': 10 });
  });

  it('drops what is not well formed rather than refusing the file', () => {
    const parsed = parseScript({
      ...base,
      sources: { trip: { name: 'no id' }, winnow: { source: '' } },
      facts: { at: '2026-10-31', values: { 'Media Total': 3, 'media.total': '98', ok: Number.NaN, days: 4 } },
    });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.script.sources).toBeUndefined();
    expect(parsed.script.facts?.values).toEqual({ days: 4 });
  });

  it('keeps the wall’s picture ids, dropping what is not an id', () => {
    const parsed = parseScript({ ...base, facts: { at: 'x', values: {}, tiles: [12, -1, 3.5, '7', 40] } });
    expect(parsed.ok && parsed.script.facts?.tiles).toEqual([12, 40]);
  });
});

describe('sourcesOf / factsOf', () => {
  const script: StoryScript = {
    ...base,
    sources: { trip: { id: 't1', name: 'Australie' }, winnow: { source: 'winnow.example' } },
    facts: { at: 'x', values: { days: 178 } },
    posts: { a: { sources: { winnow: { source: 'localhost:3000' } }, facts: { at: 'y', values: { days: 2 } } }, b: {} },
  };

  it('reads a post’s own source over the series’, field by field', () => {
    expect(sourcesOf(script, 'a')).toEqual({ trip: { id: 't1', name: 'Australie' }, winnow: { source: 'localhost:3000' } });
    expect(sourcesOf(script, 'b')).toEqual(script.sources);
    expect(sourcesOf(null, 'a')).toEqual({});
  });

  it('reads a post’s own facts, else the series’', () => {
    expect(factsOf(script, 'a')?.values.days).toBe(2);
    expect(factsOf(script, 'b')?.values.days).toBe(178);
    expect(factsOf(null, 'b')).toBeNull();
  });
});

describe('withSeriesSources', () => {
  const counted: StoryScript = { ...base, sources: { trip: { id: 't1', name: 'Australie' } }, facts: { at: 'x', values: { days: 178 } } };

  it('sets and removes a source', () => {
    const next = withSeriesSources(counted, { winnow: { source: 'winnow.example' } });
    expect(next.sources).toEqual({ trip: { id: 't1', name: 'Australie' }, winnow: { source: 'winnow.example' } });
    expect(withSeriesSources(next, { trip: null, winnow: null }).sources).toBeUndefined();
  });

  it('drops the facts once a source changes, keeps them when nothing did', () => {
    expect(withSeriesSources(counted, { trip: { id: 't2', name: 'Islande' } }).facts).toBeUndefined();
    expect(withSeriesSources(counted, { trip: { id: 't1', name: 'Australie' } }).facts).toEqual(counted.facts);
  });

  it('leaves the rest of the script as it was', () => {
    const next = withSeriesSources({ ...counted, series: 'Le tri' }, { trip: null });
    expect(next.series).toBe('Le tri');
    expect(next.posts).toBe(counted.posts);
  });
});

describe('tripLine', () => {
  it('says the days, stages, places and whether a road was imported', () => {
    const trip = createTripDoc('Australie', '2025-09-03', '2026-02-28');
    expect(tripLine(trip)).toBe('2025-09-03 → 2026-02-28 · 0 stages · 0 places · no road yet');
  });
});

describe('withSeriesFacts', () => {
  it('replaces the series’ numbers and keeps its sources', () => {
    const script: StoryScript = { ...base, sources: { trip: { id: 't1', name: 'Australie' } }, facts: { at: 'x', values: { days: 1 } } };
    const next = withSeriesFacts(script, { at: 'y', from: 'Australie · w', values: { days: 2 } });
    expect(next.facts).toEqual({ at: 'y', from: 'Australie · w', values: { days: 2 } });
    expect(next.sources).toEqual(script.sources);
  });
});

describe('the stages and the map a series keeps', () => {
  it('reads kept stages and the map’s names from a script file', () => {
    const parsed = parseScript({ ...base, sources: { trip: { id: 't', name: 'A', stages: ['s1', 3, ''] }, map: { points: 'places', label: 'shout' } } });
    expect(parsed.ok && parsed.script.sources).toEqual({ trip: { id: 't', name: 'A', stages: ['s1'] }, map: { points: 'places' } });
  });

  it('keeps the numbers when only the map’s names change, drops them when the stages do', () => {
    const counted: StoryScript = { ...base, sources: { trip: { id: 't1', name: 'A' } }, facts: { at: 'x', values: { days: 1 } } };
    expect(withSeriesSources(counted, { map: { label: 'stage' } }).facts).toEqual(counted.facts);
    expect(withSeriesSources(counted, { trip: { id: 't1', name: 'A', stages: ['s1'] } }).facts).toBeUndefined();
  });

  it('counts the kept stages’ days', () => {
    const t = createTripDoc('Bali puis Australie', '2025-08-20', '2026-02-28');
    t.stages = [
      { id: 'bali', name: 'Bali', region: '', startDate: '2025-08-20', endDate: '2025-09-02', places: [] },
      { id: 'au', name: 'Australie', region: '', startDate: '2025-09-03', endDate: '2026-02-28', places: [] },
    ];
    expect(countedSpan(t, { trip: { id: t.id, name: 'x', stages: ['au'] } })).toEqual({ from: '2025-09-03', to: '2026-02-28' });
    expect(countedSpan(t, { trip: { id: t.id, name: 'x' } })).toEqual({ from: '2025-08-20', to: '2026-02-28' });
    expect(mapChoiceOf({ trip: { id: t.id, name: 'x', stages: ['au'] }, map: { label: 'none' } })).toEqual({ stages: ['au'], label: 'none' });
  });
});

describe('the days a series counts', () => {
  const t = createTripDoc('Australie', '2025-09-03', '2025-09-30');

  it('takes its own first and last day, and leaves the skipped days inside them out', () => {
    expect(countedSpan(t, { trip: { id: t.id, name: 'x' }, days: { from: '2025-09-10', skip: ['2025-09-12', '2025-09-01'] } })).toEqual({
      from: '2025-09-10',
      to: '2025-09-30',
      skip: ['2025-09-12'],
    });
  });

  it('reads the days from a script file, and drops the numbers when they change', () => {
    const parsed = parseScript({ ...base, sources: { days: { from: '2025-09-10', to: 'soon', skip: ['2025-09-12', 4] } } });
    expect(parsed.ok && parsed.script.sources).toEqual({ days: { from: '2025-09-10', skip: ['2025-09-12'] } });
    const counted: StoryScript = { ...base, sources: { trip: { id: 't1', name: 'A' } }, facts: { at: 'x', values: { days: 1 } } };
    expect(withSeriesSources(counted, { days: { skip: ['2025-09-12'] } }).facts).toBeUndefined();
  });
});

describe('withWall', () => {
  const counted: StoryScript = { ...base, sources: { trip: { id: 't1', name: 'A' } }, facts: { at: 'x', values: { days: 3 }, tiles: [1, 2, 3] } };

  it('keeps the choice, freezes its pictures, and leaves the numbers as they were', () => {
    const next = withWall(counted, { skip: [3], pick: { '2025-09-04': 42 } }, [{ id: 1, day: '2025-09-03' }, { id: 42, day: '2025-09-04' }]);
    expect(next.sources?.wall).toEqual({ skip: [3], pick: { '2025-09-04': 42 } });
    expect(next.facts).toEqual({ at: 'x', values: { days: 3 }, tiles: [1, 42], tileDays: ['2025-09-03', '2025-09-04'] });
    expect(next.sources?.trip).toEqual(counted.sources?.trip);
  });

  it('forgets an empty choice', () => {
    expect(withWall(counted, null, [{ id: 1, day: '2025-09-03' }]).sources?.wall).toBeUndefined();
  });

  it('reads the choice from a script file, dropping what is not an id or a day', () => {
    const parsed = parseScript({ ...base, sources: { wall: { skip: [3, -1, 'x'], pick: { '2025-09-04': 42, soon: 7, '2025-09-05': 0 } } } });
    expect(parsed.ok && parsed.script.sources).toEqual({ wall: { skip: [3], pick: { '2025-09-04': 42 } } });
  });
});

describe('withPostHooks', () => {
  const s: StoryScript = { ...base, posts: { a: { title: 'Un' } } };
  const hook = { lines: ['100 000 photos.', 'Aucune triée.'] };

  it('sets a post’s hooks, which one plays, and its promise', () => {
    const next = withPostHooks(s, 'a', { hooks: [hook, { lines: ['100 000 → ?'] }], hookActive: 1, promise: 'La méthode.' });
    expect(next.posts.a).toEqual({ title: 'Un', hooks: [hook, { lines: ['100 000 → ?'] }], hookActive: 1, promise: 'La méthode.' });
    expect(withPostHooks(next, 'a', { hookActive: 9 }).posts.a.hookActive).toBe(1);
  });

  it('takes the hook away with an empty list, and the promise with an empty line', () => {
    const next = withPostHooks(withPostHooks(s, 'a', { hooks: [hook], promise: 'x' }), 'a', { hooks: [], promise: ' ' });
    expect(next.posts.a).toEqual({ title: 'Un' });
  });
});

describe('withLook', () => {
  it('keeps only what departs from the defaults', () => {
    const one = withLook(base, { wall: { cols: 6, gap: 6 } });
    expect(one.look).toEqual({ wall: { cols: 6 } });
    const two = withLook(one, { vignette: 0.4, grain: 0.055 });
    expect(two.look).toEqual({ wall: { cols: 6 }, vignette: 0.4 });
    expect(withLook(two, { wall: { cols: 10 }, vignette: null }).look).toBeUndefined();
  });

  it('goes back to the charte’s look', () => {
    expect(withLook(withLook(base, { grain: 0.1 }), null)).toEqual(base);
  });
});

describe('the wall chosen in the picker', () => {
  const counted: StoryScript = { ...base, facts: { at: 'x', values: { days: 3 }, tiles: [1] } };

  it('keeps the pool in day order and freezes the wall when given its pictures', () => {
    const next = withChosenWall(counted, [[9, '2025-09-02'], [7, '2025-09-01']], [{ id: 7, day: '2025-09-01' }]);
    expect(next.sources?.wall?.chosen).toEqual([[7, '2025-09-01'], [9, '2025-09-02']]);
    expect(next.facts?.tiles).toEqual([7]);
    expect(withChosenWall(counted, [[9, '2025-09-02']], null).facts?.tiles).toEqual([1]);
  });

  it('thins a pool too big for a script evenly over its days', () => {
    const many = Array.from({ length: 5000 }, (_, i): [number, string] => [i + 1, `2025-09-${String(1 + (i % 28)).padStart(2, '0')}`]);
    expect(withChosenWall(base, many, null).sources?.wall?.chosen).toHaveLength(2000);
  });

  it('goes back to one a day, and a hidden picture or a day’s pick keeps the pool', () => {
    const chosen = withChosenWall(counted, [[7, '2025-09-01']], null);
    expect(withChosenWall(chosen, null, null).sources?.wall).toBeUndefined();
    expect(withWall(chosen, { skip: [3] }, [{ id: 7, day: '2025-09-01' }]).sources?.wall).toEqual({ skip: [3], chosen: [[7, '2025-09-01']] });
  });

  it('reads a pool from a script file, keeping only ids with a day', () => {
    const parsed = parseScript({ ...base, sources: { wall: { chosen: [[7, '2025-09-01'], [0, '2025-09-02'], [8, 'soon'], 'x'] } } });
    expect(parsed.ok && parsed.script.sources?.wall).toEqual({ chosen: [[7, '2025-09-01']] });
  });
});
