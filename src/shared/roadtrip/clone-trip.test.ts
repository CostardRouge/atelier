import { describe, expect, it } from 'vitest';
import { cloneTrip } from './clone-trip';
import {
  createTripDoc,
  createTripPlace,
  createTripPost,
  createTripStage,
  type TripDoc,
} from './trip-types';
import { DEFAULT_DEVELOP } from '../develop/develop';
import { defaultCarSpec } from './car-spec';

function sample(): TripDoc {
  const doc = createTripDoc('Maroc', '2026-05-01', '2026-05-21', 'winnow.example');
  const a = createTripPost('reel', '2026-05-03', 'Dunes');
  const b = createTripPost('photo', '2026-05-04', 'Souk');
  return {
    ...doc,
    stages: [
      {
        ...createTripStage('Sud', '', '2026-05-02', '2026-05-06', [createTripPlace('Merzouga')]),
        origin: { sourceId: 'winnow.example', chapterId: '7', importedAt: 3 },
      },
    ],
    posts: [
      {
        ...a,
        projectId: 'studio-project-here',
        media: { name: 'DJI_0001.MP4', size: 10, lastModified: 5, hash: 'abc' },
      },
      b,
    ],
    cover: { layout: 'cover', pinned: [b.id, 'a-post-that-is-gone'] },
    developPresets: [{ id: 'p1', name: 'Noon', settings: { ...DEFAULT_DEVELOP, whites: -20 } }],
    car: { ...defaultCarSpec(), color: '#1f3b2f' },
    placeStyle: { badge: 'full', lists: 'name' },
    stateCodes: { Souss: 'SSM' },
    cameraNames: { 'DJI FC8482': 'Mini 4 Pro' },
    createdAt: 1,
    updatedAt: 2,
  };
}

describe('cloneTrip', () => {
  it('is a new document: fresh id and timestamps, the target source, the chosen name', () => {
    const trip = sample();
    const { doc } = cloneTrip(trip, { name: '  Maroc (2) ', sourceId: 'local', now: 99 });
    expect(doc.id).not.toBe(trip.id);
    expect(doc.name).toBe('Maroc (2)');
    expect(doc.sourceId).toBe('local');
    expect(doc.createdAt).toBe(99);
    expect(doc.updatedAt).toBe(99);
  });

  it('carries every portable field of the original — a field forgotten is a field lost', () => {
    const trip = sample();
    const { doc } = cloneTrip(trip, { name: 'Maroc (2)', sourceId: 'local' });
    const machine = new Set(['id', 'name', 'sourceId', 'createdAt', 'updatedAt', 'posts', 'cover']);
    for (const key of Object.keys(trip) as (keyof TripDoc)[]) {
      if (machine.has(key)) continue;
      expect(doc[key], key).toEqual(trip[key]);
    }
    expect(doc.cover.layout).toBe(trip.cover.layout);
  });

  it('gives every piece a new id and says which thumbnail follows which', () => {
    const trip = sample();
    const { doc, thumbIds } = cloneTrip(trip, { name: 'Maroc (2)', sourceId: 'local' });
    expect(doc.posts).toHaveLength(2);
    trip.posts.forEach((post, i) => {
      expect(doc.posts[i].id).not.toBe(post.id);
      expect(thumbIds.get(post.id)).toBe(doc.posts[i].id);
      expect(doc.posts[i].title).toBe(post.title);
      expect(doc.posts[i].badge).toEqual(post.badge);
    });
    expect(new Set(doc.posts.map((p) => p.id)).size).toBe(2);
  });

  it('keeps the media reference but drops the Studio link of this browser', () => {
    const { doc } = cloneTrip(sample(), { name: 'x', sourceId: 'local' });
    expect(doc.posts[0].media).toEqual({ name: 'DJI_0001.MP4', size: 10, lastModified: 5, hash: 'abc' });
    expect(doc.posts[0].projectId).toBeNull();
  });

  it('moves the cover pins onto the new ids and drops a pin that named no piece', () => {
    const trip = sample();
    const { doc } = cloneTrip(trip, { name: 'x', sourceId: 'local' });
    expect(doc.cover.pinned).toEqual([doc.posts[1].id]);
  });

  it('shares nothing mutable with the original', () => {
    const trip = sample();
    const { doc } = cloneTrip(trip, { name: 'x', sourceId: 'local' });
    doc.stages[0].places.push(createTripPlace('Fès'));
    doc.stateCodes.Draa = 'DT';
    doc.cameraNames!['DJI FC8482'] = 'renamed';
    expect(trip.stages[0].places).toHaveLength(1);
    expect(trip.stateCodes).toEqual({ Souss: 'SSM' });
    expect(trip.cameraNames).toEqual({ 'DJI FC8482': 'Mini 4 Pro' });
  });

  it('omits cameraNames when the original has none, as an older trip does', () => {
    const trip = sample();
    delete trip.cameraNames;
    expect('cameraNames' in cloneTrip(trip, { name: 'x', sourceId: 'local' }).doc).toBe(false);
  });
});
