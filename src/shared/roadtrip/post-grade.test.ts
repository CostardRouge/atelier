import { describe, expect, it } from 'vitest';
import { gradeKey } from '../lut/saved-grade';
import type { SavedLutLayer } from '../lut/use-lut-stack';
import {
  HOOK_PICTURE,
  countOwnGrades,
  gradeScopeOf,
  gradeShownBy,
  moveGradeScope,
  ownGrade,
  pictureKeyOf,
  sameGradeRung,
  unboundGrades,
  writeGrade,
} from './post-grade';
import {
  createPostSlide,
  createTripDoc,
  createTripPost,
  type TripDoc,
  type TripGrade,
  type TripPost,
} from './trip-types';

const layer = (id: string): SavedLutLayer => ({
  id,
  source: `builtin:${id}`,
  name: id,
  customText: null,
  intensity: 1,
  enabled: true,
});

const grade = (id: string): TripGrade => ({ layers: [layer(id)], output: 'none' });

const ref = (name: string) => ({ name, size: 1, lastModified: 1 });

function trip(): TripDoc {
  const doc = createTripDoc('Australie', 'Perth → Broome', '2025-07-01', '2025-07-31');
  doc.grade = grade('trip');
  return doc;
}

function piece(): TripPost {
  const post = createTripPost('carousel', '2025-07-03', 'Cliffs');
  post.media = ref('hook.jpg');
  post.slides = [createPostSlide(ref('a.jpg')), createPostSlide(ref('b.jpg'))];
  return post;
}

describe('the chain', () => {
  it('reads the picture’s own, else the piece’s, else the trip’s', () => {
    const t = trip();
    const p = piece();
    expect(gradeShownBy(t, p, HOOK_PICTURE)).toEqual(grade('trip'));
    expect(gradeScopeOf(p, HOOK_PICTURE)).toBe('trip');

    p.grade = grade('piece');
    expect(gradeShownBy(t, p, HOOK_PICTURE)).toEqual(grade('piece'));
    expect(gradeShownBy(t, p, p.slides[0].id)).toEqual(grade('piece'));
    expect(gradeScopeOf(p, p.slides[0].id)).toBe('post');

    p.slides[0].grade = grade('slide');
    expect(gradeShownBy(t, p, p.slides[0].id)).toEqual(grade('slide'));
    expect(gradeScopeOf(p, p.slides[0].id)).toBe('slide');
    // The rest of the deck is untouched by one picture departing.
    expect(gradeShownBy(t, p, p.slides[1].id)).toEqual(grade('piece'));
    expect(gradeShownBy(t, p, HOOK_PICTURE)).toEqual(grade('piece'));
  });

  it('answers for a trip with no grade at all', () => {
    const t = createTripDoc('a', 'b', '2025-07-01', '2025-07-31');
    expect(gradeShownBy(t, piece(), HOOK_PICTURE)).toEqual({ layers: [], output: 'none', film: null });
  });

  it('names the hook and each slide, and the closing card as no picture', () => {
    expect(pictureKeyOf({ kind: 'hook', slideId: null })).toBe(HOOK_PICTURE);
    expect(pictureKeyOf({ kind: 'content', slideId: 's7' })).toBe('s7');
    expect(pictureKeyOf({ kind: 'cta', slideId: null })).toBeNull();
    // The closing card can never depart: there is nothing to own a grade.
    const p = piece();
    p.grade = grade('piece');
    expect(ownGrade(p, null)).toBeNull();
    expect(gradeScopeOf(p, null)).toBe('post');
  });
});

describe('countOwnGrades', () => {
  it('counts the pictures that departed, never the piece or the trip', () => {
    const p = piece();
    expect(countOwnGrades(p)).toBe(0);
    p.grade = grade('piece');
    expect(countOwnGrades(p)).toBe(0);
    p.badge.grade = grade('hook');
    p.slides[1].grade = grade('b');
    expect(countOwnGrades(p)).toBe(2);
  });
});

describe('sameGradeRung', () => {
  it('is true for two pictures that both follow, and for one with itself', () => {
    const p = piece();
    expect(sameGradeRung(p, HOOK_PICTURE, p.slides[0].id)).toBe(true);
    p.grade = grade('piece');
    expect(sameGradeRung(p, HOOK_PICTURE, p.slides[0].id)).toBe(true);
    expect(sameGradeRung(p, HOOK_PICTURE, HOOK_PICTURE)).toBe(true);
  });

  it('is false for a picture that departed, even holding an identical copy', () => {
    const p = piece();
    p.grade = grade('piece');
    // Exactly the state `moveGradeScope('slide')` leaves: a byte-identical
    // copy. Comparing by value would have this slide follow the next slider
    // step it is supposed to be deaf to.
    p.slides[0].grade = grade('piece');
    expect(gradeKey(p.slides[0].grade)).toBe(gradeKey(p.grade));
    expect(sameGradeRung(p, p.slides[0].id, HOOK_PICTURE)).toBe(false);
    expect(sameGradeRung(p, p.slides[0].id, p.slides[0].id)).toBe(true);
    // The picture that departed is not the one being edited, so the others
    // still share their own rung.
    expect(sameGradeRung(p, HOOK_PICTURE, p.slides[1].id)).toBe(true);
  });
});

describe('moveGradeScope', () => {
  it('seeds from what the picture shows when it goes DOWN a rung', () => {
    const t = trip();
    const onPiece = moveGradeScope(t, piece(), HOOK_PICTURE, 'post');
    expect(onPiece.grade).toEqual(grade('trip'));
    expect(onPiece.grade).not.toBe(t.grade);
    expect(gradeShownBy(t, onPiece, HOOK_PICTURE)).toEqual(grade('trip'));

    const onPicture = moveGradeScope(t, onPiece, HOOK_PICTURE, 'slide');
    expect(onPicture.badge.grade).toEqual(grade('trip'));
    expect(onPicture.slides[0].grade).toBeNull();
    // Departing changes nothing until the author changes something.
    expect(gradeShownBy(t, onPicture, HOOK_PICTURE)).toEqual(grade('trip'));
  });

  it('drops what is below it when it goes UP', () => {
    const t = trip();
    const p = piece();
    p.grade = grade('piece');
    p.badge.grade = grade('hook');

    const toPiece = moveGradeScope(t, p, HOOK_PICTURE, 'post');
    expect(toPiece.badge.grade).toBeNull();
    expect(toPiece.grade).toEqual(grade('piece'));

    const toTrip = moveGradeScope(t, p, HOOK_PICTURE, 'trip');
    expect(toTrip.badge.grade).toBeNull();
    expect(toTrip.grade).toBeNull();
    expect(gradeShownBy(t, toTrip, HOOK_PICTURE)).toEqual(grade('trip'));
  });

  it('gives the PIECE a grade when it had none, so the chip does something', () => {
    const t = trip();
    const p = piece();
    p.badge.grade = grade('hook');
    const toPiece = moveGradeScope(t, p, HOOK_PICTURE, 'post');
    expect(gradeScopeOf(toPiece, HOOK_PICTURE)).toBe('post');
    expect(toPiece.grade).toEqual(grade('hook'));
  });

  it('touches one picture only', () => {
    const t = trip();
    const p = piece();
    const moved = moveGradeScope(t, p, p.slides[1].id, 'slide');
    expect(moved.slides[1].grade).toEqual(grade('trip'));
    expect(moved.slides[0].grade).toBeNull();
    expect(moved.badge.grade).toBeNull();
  });
});

describe('writeGrade', () => {
  it('writes to exactly ONE rung — never both in a tick', () => {
    const t = trip();
    const p = piece();
    const next = grade('next');

    const onTrip = writeGrade(t, p, HOOK_PICTURE, 'trip', next);
    expect(onTrip.post).toBeNull();
    expect(onTrip.trip?.grade).toEqual(next);

    const onPost = writeGrade(t, p, HOOK_PICTURE, 'post', next);
    expect(onPost.trip).toBeNull();
    expect(onPost.post?.grade).toEqual(next);

    const onHook = writeGrade(t, p, HOOK_PICTURE, 'slide', next);
    expect(onHook.post?.badge.grade).toEqual(next);
    expect(onHook.post?.grade).toBeNull();

    const onSlide = writeGrade(t, p, p.slides[1].id, 'slide', next);
    expect(onSlide.post?.slides.map((s) => s.grade)).toEqual([null, next]);
  });
});

describe('unboundGrades', () => {
  it('is empty while every picture follows the rung being edited', () => {
    const t = trip();
    const p = piece();
    expect(unboundGrades(t, p, HOOK_PICTURE, gradeKey)).toEqual([]);
    p.grade = grade('piece');
    expect(unboundGrades(t, p, p.slides[0].id, gradeKey)).toEqual([]);
  });

  it('names the looks the deck wears that the stack is not editing', () => {
    const t = trip();
    const p = piece();
    p.badge.grade = grade('hook');
    p.slides[0].grade = grade('a');
    // Editing the HOOK's own look leaves everything else unbound — including
    // the slide that merely follows, whose look is the trip's.
    expect(unboundGrades(t, p, HOOK_PICTURE, gradeKey)).toEqual([grade('a'), grade('trip')]);
    // From a following picture, the two that departed are both unbound.
    expect(unboundGrades(t, p, p.slides[1].id, gradeKey)).toEqual([grade('hook'), grade('a')]);
  });

  it('asks for one bake when several pictures wear the same look', () => {
    const t = trip();
    const p = piece();
    p.badge.grade = grade('dlog');
    p.slides[0].grade = grade('dlog');
    p.slides[1].grade = grade('dlog');
    expect(unboundGrades(t, p, null, gradeKey)).toEqual([grade('dlog')]);
  });
});
