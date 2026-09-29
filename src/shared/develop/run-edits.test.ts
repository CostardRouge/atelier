import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP } from './develop';
import { addPictures, createRollDoc, patchPicture } from './roll-types';
import { describeEditedDuring, editedDuringRun } from './run-edits';

describe('pictures edited during a run', () => {
  const roll = addPictures(createRollDoc('r', 'local', 0, 'r'), [
    { name: 'a.JPG', size: 1, lastModified: 1 },
    { name: 'b.JPG', size: 2, lastModified: 1 },
  ]);

  it('finds the ones whose file would now differ, by the export marks’ fingerprint', () => {
    const [a] = roll.pictures;
    const later = patchPicture(roll, a.id, { develop: { ...DEFAULT_DEVELOP, exposure: 0.7 } });
    expect(editedDuringRun(roll.pictures, later.pictures).map((p) => p.ref.name)).toEqual(['a.JPG']);
    // A delivery state is not an edit of the file.
    const held = { ...later, pictures: later.pictures.map((p) => ({ ...p, deliver: 'no' as const })) };
    expect(editedDuringRun(later.pictures, held.pictures)).toEqual([]);
    // A picture taken off the roll meanwhile is not "edited".
    expect(editedDuringRun(roll.pictures, [])).toEqual([]);
  });

  it('says it in one sentence, or not at all', () => {
    expect(describeEditedDuring([])).toBeNull();
    expect(describeEditedDuring(roll.pictures.slice(0, 1))).toBe(
      'a.JPG was edited during the export and left as it was at the click — Export new or changed sends it again.',
    );
    expect(describeEditedDuring(roll.pictures)).toMatch(/^2 pictures were edited during the export and left as they were/);
  });
});
