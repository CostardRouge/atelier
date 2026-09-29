import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from '../develop/develop';
import { describePieceEdits, editedDuringExport } from './run-edits';
import { createPostSlide, createTripDoc, createTripPost } from './trip-types';

const ref = (name: string) => ({ name, size: 1, lastModified: 0 });

function piece() {
  const trip = createTripDoc('Outback', '2025-03-10', '2025-03-20');
  const post = createTripPost('carousel', '2025-03-12', 'Uluru');
  post.media = ref('A.JPG');
  post.slides = [createPostSlide(ref('B.JPG')), createPostSlide(ref('C.JPG'))];
  trip.posts = [post];
  return { trip, post };
}

describe('editedDuringExport', () => {
  it('finds nothing when the piece is as it was', () => {
    const sent = piece();
    const edits = editedDuringExport(sent, { trip: structuredClone(sent.trip), post: structuredClone(sent.post) });
    expect(edits).toEqual({ slides: [], everything: false });
    expect(describePieceEdits(edits)).toBeNull();
  });

  it('names a slide retouched under the run, by its place in the deck', () => {
    const sent = piece();
    const post = structuredClone(sent.post);
    post.slides[1] = { ...post.slides[1], develop: { ...DEFAULT_DEVELOP, exposure: 0.5 } };
    const edits = editedDuringExport(sent, { trip: sent.trip, post });
    expect(edits.slides).toEqual(['slide 3']);
    expect(describePieceEdits(edits)).toBe(
      'Slide 3 was edited during the export and left as it was at the click — export again to send it.',
    );
  });

  it('counts the badge as the hook, and leaves out slides the run did not carry', () => {
    const sent = piece();
    const post = structuredClone(sent.post);
    post.badge = { ...post.badge, hookSeconds: post.badge.hookSeconds + 1 };
    post.slides[0] = { ...post.slides[0], caption: 'new' };
    expect(editedDuringExport(sent, { trip: sent.trip, post }).slides).toEqual(['the hook', 'slide 2']);
    expect(editedDuringExport(sent, { trip: sent.trip, post }, [2]).slides).toEqual(['slide 2']);
    expect(describePieceEdits(editedDuringExport(sent, { trip: sent.trip, post }))).toMatch(/^The hook and slide 2 were edited/);
  });

  it('says every file when what dresses them all changed', () => {
    const sent = piece();
    const post = structuredClone(sent.post);
    post.grade = { layers: [] } as unknown as typeof post.grade;
    const edits = editedDuringExport(sent, { trip: sent.trip, post });
    expect(edits.everything).toBe(true);
    expect(describePieceEdits(edits)).toMatch(/^The look changed during the export/);
  });

  it('never reads another piece opened since as an edit of this one', () => {
    const sent = piece();
    const other = createTripPost('reel', '2025-03-13', 'Kata Tjuta');
    expect(editedDuringExport(sent, { trip: sent.trip, post: other })).toEqual({ slides: [], everything: false });
  });
});
