import { describe, expect, it } from 'vitest';
import { describePlan, exportPlan } from './export-plan';
import { DEFAULT_CTA } from './cta-slide';
import { DEFAULT_BADGE_WORDS } from './day-badge';
import {
  createPostSlide,
  defaultPostBadge,
  defaultTripCover,
  emptyGrade,
  type PostKind,
  type TripDoc,
  type TripPost,
} from './trip-types';

const post = (over: Partial<TripPost> = {}, kind: PostKind = 'carousel'): TripPost => ({
  id: 'p1',
  kind,
  date: '2025-03-27',
  endDate: null,
  title: 'Kalbarri cliffs',
  media: { name: 'IMG_HOOK.JPG', size: 10, lastModified: 1 },
  badge: defaultPostBadge(kind),
  slides: [],
  includeCta: false,
  projectId: null,
  grade: null,
  publishedAt: null,
  createdAt: 0,
  ...over,
});

const trip = (over: Partial<TripDoc> = {}): TripDoc =>
  ({
    version: 14,
    id: 't1',
    sourceId: 'local',
    name: 'Australia',
    destination: 'Australia',
    startDate: '2025-03-01',
    endDate: '2026-01-04',
    stages: [],
    posts: [],
    badgeWords: DEFAULT_BADGE_WORDS,
    theme: null,
    cta: DEFAULT_CTA,
    grade: emptyGrade(),
    hookDefaults: {},
    cover: defaultTripCover(),
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }) as TripDoc;

const ALL_THERE = { canEncode: true, hasPicture: () => true };

describe('exportPlan', () => {
  it('reads the deck rather than deciding: a plain photo is one PNG', () => {
    const plan = exportPlan(trip(), post(), ALL_THERE);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]).toMatchObject({ medium: 'image', blocker: null });
    expect(plan.items[0].name).toMatch(/\.png$/);
    expect(describePlan(plan)).toBe('1 file · 1 image');
  });

  it('gives a video slide an mp4 name, in the deck’s own numbering', () => {
    const p = post({
      slides: [createPostSlide({ name: 'CLIP.MP4', size: 1, lastModified: 1 })],
    });
    const plan = exportPlan(trip(), p, ALL_THERE);
    expect(plan.items.map((i) => i.name)).toEqual([
      'australia-kalbarri-cliffs-01-hook.png',
      'australia-kalbarri-cliffs-02.mp4',
    ]);
    expect(describePlan(plan)).toBe('2 files · 1 image and 1 clip');
  });

  it('counts an animated hook as the clip it is', () => {
    const p = post();
    p.badge.pieceStyles = {
      headline: { animation: { in: { preset: 'fade', duration: 0.5, easing: 'out' } } },
    };
    const plan = exportPlan(trip(), p, ALL_THERE);
    expect(plan.items[0]).toMatchObject({ medium: 'video', reason: 'animated' });
    expect(plan.videos).toBe(1);
  });

  it('blocks every clip when the browser cannot encode, and says so once', () => {
    const p = post({
      slides: [createPostSlide({ name: 'CLIP.MP4', size: 1, lastModified: 1 })],
    });
    p.badge.medium = 'video';
    const plan = exportPlan(trip(), p, { ...ALL_THERE, canEncode: false });
    expect(plan.videos).toBe(0);
    expect(plan.files).toBe(0);
    expect(plan.blockers).toHaveLength(1);
    expect(plan.blockers[0]).toMatch(/cannot encode video/i);
  });

  it('refuses a container the demuxer cannot read, naming the file', () => {
    const p = post({ media: { name: 'CLIP.WEBM', size: 1, lastModified: 1 } });
    const plan = exportPlan(trip(), p, ALL_THERE);
    expect(plan.items[0].medium).toBe('video');
    expect(plan.items[0].blocker).toMatch(/CLIP\.WEBM/);
    expect(plan.files).toBe(0);
  });

  it('blocks a video slide whose picture the Library has lost', () => {
    const p = post({ media: { name: 'CLIP.MP4', size: 1, lastModified: 1 } });
    const plan = exportPlan(trip(), p, { canEncode: true, hasPicture: () => false });
    expect(plan.items[0].blocker).toMatch(/not in the Library/);
  });

  it('leaves a MISSING still alone — it renders over the flat ground', () => {
    const plan = exportPlan(trip(), post(), { canEncode: true, hasPicture: () => false });
    expect(plan.items[0].blocker).toBeNull();
  });

  it('turns everything into images when the override is on', () => {
    const p = post({ media: { name: 'CLIP.MP4', size: 1, lastModified: 1 } });
    const plan = exportPlan(trip(), p, { ...ALL_THERE, imagesOnly: true });
    expect(plan.items[0]).toMatchObject({ medium: 'image', blocker: null });
    expect(plan.items[0].name).toMatch(/\.png$/);
    // The reason still describes the SLIDE, not the override: the deck's own
    // answer does not change because of how it is being written today.
    expect(plan.items[0].reason).toBe('moving');
  });

  it('delivers the closing card as a still whatever the rest does', () => {
    const p = post({ includeCta: true });
    p.badge.medium = 'video';
    const plan = exportPlan(trip({ cta: { ...DEFAULT_CTA, headline: 'Follow' } }), p, ALL_THERE);
    expect(plan.items.at(-1)).toMatchObject({ kind: 'cta', medium: 'image' });
  });

  it('says plainly when nothing can be written', () => {
    const p = post({ media: { name: 'CLIP.WEBM', size: 1, lastModified: 1 } });
    expect(describePlan(exportPlan(trip(), p, ALL_THERE))).toBe('nothing can be written');
  });
});
