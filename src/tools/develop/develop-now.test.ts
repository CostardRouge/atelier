import { describe, expect, it } from 'vitest';
import { DEFAULT_DEVELOP, isRawDevelop, sameDevelop, type DevelopSettings } from '../../shared/develop/develop';
import { arrived, drafted, flushed, newWriteThrough } from '../../shared/develop/write-through';
import { PROFILE_PENDING } from '../../shared/raw/dng-color';
import { developNowOf, developToWrite } from './develop-now';

/** A picture on its sensor as the menu and the first decode leave it. */
const ON_SENSOR: DevelopSettings = {
  ...DEFAULT_DEVELOP,
  exposure: 0.3,
  base: 'gain',
  rawGain: 2,
  rawProfile: null,
  baseCurve: { kind: 'standard' },
};

/** What the menu's file row does to the draft: the base comes off with it. */
const stepDown = (d: DevelopSettings): DevelopSettings => ({ ...d, base: null, rawGain: null, rawProfile: null });

const input = (draft: DevelopSettings, stored: DevelopSettings | null, followsSensor = false) => ({
  draft,
  stored,
  followsSensor,
  followGain: null,
  followProfile: null,
});

/**
 * The editor and the roll as `useWriteThrough` and `handleDevelop` run them:
 * the draft moves, the rest ends, the roll takes the write unless it is the
 * same develop, and a stored value the editor did not write re-seeds the draft.
 */
function stepDownThroughTheRoll(start: DevelopSettings, followsSensor = false) {
  let stored: DevelopSettings | null = start;
  let draft = start;
  let w = newWriteThrough<DevelopSettings>(stored);
  draft = stepDown(draft);
  w = drafted(w, draft, sameDevelop);
  const { rollBase } = developNowOf(input(draft, stored, followsSensor));
  const flush = flushed(w);
  w = flush.state;
  const written = flush.owed ? developToWrite(flush.value, rollBase) : null;
  if (flush.owed && !sameDevelop(stored, written)) stored = written;
  const back = arrived(w, stored, sameDevelop);
  if (back.reseed && stored) draft = stored;
  return { stored, now: developNowOf(input(draft, stored, followsSensor)).now };
}

describe('developNowOf', () => {
  it('is the draft itself while the draft is on the sensor', () => {
    const out = developNowOf(input(ON_SENSOR, null));
    expect(out.now).toBe(ON_SENSOR);
    expect(out.settling).toBe(false);
    expect(out.rollBase).toBeNull();
  });

  it('draws the STORED base while the document is ahead of the draft, and never writes it', () => {
    const out = developNowOf(input(stepDown(ON_SENSOR), ON_SENSOR));
    expect(out.settling).toBe(true);
    expect(out.now.base).toBe('gain');
    expect(out.now.rawGain).toBe(2);
    // The step down is the author's: nothing puts the base back into the write.
    expect(out.rollBase).toBeNull();
    expect(developToWrite(stepDown(ON_SENSOR), out.rollBase)?.base).toBeNull();
  });

  it('hands the ROLL’s base to a picture that follows its sensor, and to its first write', () => {
    const out = developNowOf({ draft: DEFAULT_DEVELOP, stored: null, followsSensor: true, followGain: 1.5, followProfile: null });
    expect(out.settling).toBe(false);
    expect(out.now.base).toBe('gain');
    expect(out.now.rawGain).toBe(1.5);
    expect(out.now.rawProfile).toBe(PROFILE_PENDING);
    const first = developToWrite({ ...DEFAULT_DEVELOP, exposure: 0.5 }, out.rollBase);
    expect(first?.base).toBe('gain');
    expect(first?.exposure).toBe(0.5);
  });
});

describe('stepping down from the sensor (his A7C II report, 2026-10-08)', () => {
  it('takes the picture off the sensor, numbers and base curve kept', () => {
    const { stored, now } = stepDownThroughTheRoll(ON_SENSOR);
    expect(isRawDevelop(stored)).toBe(false);
    expect(stored?.exposure).toBe(0.3);
    expect(isRawDevelop(now)).toBe(false);
  });

  it('takes it off with no number at all too — the base curve alone does not hold it there', () => {
    const { stored, now } = stepDownThroughTheRoll({ ...DEFAULT_DEVELOP, base: 'gain', rawGain: 2, baseCurve: { kind: 'auto' } });
    expect(isRawDevelop(stored)).toBe(false);
    expect(isRawDevelop(now)).toBe(false);
  });

  it('was stuck when the stored base rode the write: the roll saw no change and the stage kept the base', () => {
    // The old rule, kept here as the failure it was: the base the stage drew
    // while settling was written back with the stepped-down draft.
    const settlingBase = developNowOf(input(stepDown(ON_SENSOR), ON_SENSOR)).now;
    const written = developToWrite(stepDown(ON_SENSOR), {
      base: settlingBase.base,
      rawGain: settlingBase.rawGain,
      rawProfile: settlingBase.rawProfile,
      baseCurve: settlingBase.baseCurve,
    });
    expect(sameDevelop(ON_SENSOR, written)).toBe(true);
  });
});
