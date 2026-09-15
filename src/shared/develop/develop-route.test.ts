import { describe, expect, it } from 'vitest';
import { DEVELOP_HOME, developPath, parseDevelopPath, rollFromRef, rollRef } from './develop-route';

const roll = { id: '3b525ba1-0c2d-4e5f-8a9b-0123456789ab', name: 'Kimberley, June' };

describe('develop routes', () => {
  it('reads the gallery from the base, home, and anything that is not ours', () => {
    expect(parseDevelopPath('/develop')).toEqual({ ref: null, pictureId: null });
    expect(parseDevelopPath('/develop/home')).toEqual({ ref: null, pictureId: null });
    expect(parseDevelopPath('/developer/x')).toEqual({ ref: null, pictureId: null });
    expect(parseDevelopPath('/roadtrip/x')).toEqual({ ref: null, pictureId: null });
  });

  it('round-trips a roll and a picture on it', () => {
    const ref = rollRef(roll);
    expect(ref).toBe('kimberley-june-3b525ba1');
    expect(parseDevelopPath(developPath(ref))).toEqual({ ref, pictureId: null });
    expect(parseDevelopPath(developPath(ref, 'p 1'))).toEqual({ ref, pictureId: 'p 1' });
    expect(developPath(null)).toBe(DEVELOP_HOME);
  });

  it('ignores a query, and resolves a renamed roll by its id fragment', () => {
    expect(parseDevelopPath('/develop/abc-3b525ba1?x=1')).toEqual({ ref: 'abc-3b525ba1', pictureId: null });
    expect(rollFromRef('an-old-name-3b525ba1', [roll])).toBe(roll);
    expect(rollFromRef('nothing-ffffffff', [roll])).toBeNull();
  });
});
