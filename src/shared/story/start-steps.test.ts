import { describe, expect, it } from 'vitest';
import { startSteps } from './start-steps';
import { newScript, type StoryScript } from './story-script';

const done = (steps: ReturnType<typeof startSteps>) => steps.filter((s) => s.done).map((s) => s.id);

describe('getting started', () => {
  it('asks for everything in a fresh browser, saying each is kept per browser', () => {
    const steps = startSteps({ script: null, connections: [], trips: [] });
    expect(done(steps)).toEqual([]);
    expect(steps[1].detail).toMatch(/each browser and each address keeps its own/);
    expect(steps[2].detail).toMatch(/open yours from your Winnow in Trips/);
  });

  it('starts a series with no file, then ticks the Winnow and the trip only when they are HERE', () => {
    const script = newScript('Le tri', 'fr');
    expect(script).toMatchObject({ kind: 'atelier.story-script', version: 1, series: 'Le tri', lang: 'fr', posts: {} });
    const chosen = { ...script, sources: { winnow: { source: 'winnow.steeve.website' }, trip: { id: 't1', name: 'Australie' } } } as StoryScript;
    // Chosen in the script, but this browser holds neither: the published site after a local session.
    const away = startSteps({ script: chosen, connections: [], trips: [] });
    expect(done(away)).toEqual(['script']);
    expect(away[1].detail).toMatch(/not connected in this browser/);
    expect(away[2].detail).toMatch(/not in this browser/);
    const here = startSteps({ script: chosen, connections: [{ id: 'winnow.steeve.website' }], trips: [{ id: 't1', name: 'Australie' }] });
    expect(done(here)).toEqual(['script', 'winnow', 'trip']);
  });

  it('is done once counted', () => {
    const counted = { ...newScript('x'), sources: { winnow: { source: 'w' }, trip: { id: 't', name: 'T' } }, facts: { at: '2026-11-02T10:00:00Z', values: { 'media.total': 5 } } } as unknown as StoryScript;
    expect(done(startSteps({ script: counted, connections: [{ id: 'w' }], trips: [{ id: 't', name: 'T' }] }))).toEqual(['script', 'winnow', 'trip', 'count']);
    expect(newScript('  ').series).toBe('My series');
  });
});
