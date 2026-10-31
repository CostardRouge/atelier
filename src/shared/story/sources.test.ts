import { describe, expect, it } from 'vitest';
import { createTripDoc } from '../roadtrip/trip-types';
import { factsOf, sourcesOf, tripLine, withSeriesFacts, withSeriesSources } from './sources';
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
