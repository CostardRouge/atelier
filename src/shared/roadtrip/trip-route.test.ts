import { describe, expect, it } from 'vitest';
import {
  parseRoadtripPath,
  roadtripPath,
  tripFromRef,
  tripRef,
  tripSlug,
} from './trip-route';

const trip = { id: '3b525ba1-3167-4efb-a4a5-1dc1e77399a1', name: 'Australia' };
const other = { id: '02f09b86-b62e-4aa0-877f-4720fcd28143', name: 'Australia' };

describe('tripSlug', () => {
  it('is readable', () => {
    expect(tripSlug('Australia')).toBe('australia');
    expect(tripSlug('Australie / Ouest')).toBe('australie-ouest');
  });

  it('strips accents rather than escaping them into noise', () => {
    expect(tripSlug('Été à Sydney')).toBe('ete-a-sydney');
  });

  it('is empty for a nameless trip rather than a row of dashes', () => {
    expect(tripSlug('   ')).toBe('');
    expect(tripSlug('!!!')).toBe('');
  });

  it('does not run away with a very long name', () => {
    expect(tripSlug('a'.repeat(200)).length).toBeLessThanOrEqual(40);
  });
});

describe('tripRef / tripFromRef', () => {
  it('reads as the trip and resolves back to it', () => {
    const ref = tripRef(trip);
    expect(ref.startsWith('australia-')).toBe(true);
    expect(tripFromRef(ref, [trip, other])).toBe(trip);
  });

  it('tells two trips of the same name apart', () => {
    expect(tripFromRef(tripRef(other), [trip, other])).toBe(other);
    expect(tripRef(trip)).not.toBe(tripRef(other));
  });

  it('survives a rename — the id fragment is what resolves', () => {
    const ref = tripRef(trip);
    const renamed = { ...trip, name: 'One lap of the country' };
    expect(tripFromRef(ref, [renamed, other])).toBe(renamed);
  });

  it('still accepts a bare id', () => {
    expect(tripFromRef(trip.id, [trip, other])).toBe(trip);
  });

  it('is null for a trip that is gone', () => {
    expect(tripFromRef('australia-deadbeef', [trip, other])).toBeNull();
    expect(tripFromRef('', [trip])).toBeNull();
  });

  it('works for a nameless trip', () => {
    const nameless = { id: trip.id, name: '' };
    expect(tripFromRef(tripRef(nameless), [nameless])).toBe(nameless);
  });
});

describe('roadtripPath / parseRoadtripPath', () => {
  const ref = tripRef(trip);

  it('round-trips every depth', () => {
    expect(parseRoadtripPath(roadtripPath(ref))).toEqual({
      ref,
      date: null,
      postId: null,
    });
    expect(parseRoadtripPath(roadtripPath(ref, '2025-07-09'))).toEqual({
      ref,
      date: '2025-07-09',
      postId: null,
    });
    expect(parseRoadtripPath(roadtripPath(ref, '2025-07-09', 'p1'))).toEqual({
      ref,
      date: '2025-07-09',
      postId: 'p1',
    });
  });

  it('shows the day in the path, because that is what gets read', () => {
    expect(roadtripPath(ref, '2025-07-09')).toBe(`/roadtrip/${ref}/2025-07-09`);
  });

  it('reads the gallery as nowhere in particular', () => {
    for (const path of ['/roadtrip', '/roadtrip/', '/roadtrip/home']) {
      expect(parseRoadtripPath(path)).toEqual({ ref: null, date: null, postId: null });
    }
  });

  it('ignores another tool’s route entirely', () => {
    expect(parseRoadtripPath('/studio/open/abc')).toEqual({
      ref: null,
      date: null,
      postId: null,
    });
  });

  it('drops a day that is not a real one, and everything after it', () => {
    // Half a route is worse than none: a piece under a nonexistent day would
    // open with the wrong day selected behind it.
    expect(parseRoadtripPath(`/roadtrip/${ref}/2025-02-30/p1`)).toEqual({
      ref,
      date: null,
      postId: null,
    });
    expect(parseRoadtripPath(`/roadtrip/${ref}/nonsense/p1`).date).toBeNull();
  });

  it('survives a piece id that needs escaping', () => {
    const path = roadtripPath(ref, '2025-07-09', 'a/b c');
    expect(parseRoadtripPath(path).postId).toBe('a/b c');
  });
});
