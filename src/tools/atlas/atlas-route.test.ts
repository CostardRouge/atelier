import { describe, expect, it } from 'vitest';
import { atlasFromRef, atlasPath, atlasRef, parseAtlasPath } from './atlas-route';

describe('atlas routes', () => {
  it('reads the gallery and one atlas', () => {
    expect(parseAtlasPath('/atlas')).toBeNull();
    expect(parseAtlasPath('/atlas/home')).toBeNull();
    expect(parseAtlasPath('/develop/x')).toBeNull();
    expect(parseAtlasPath('/atlas/perth-1234abcd?x=1')).toBe('perth-1234abcd');
  });

  it('finds an atlas by its reference, renamed or not', () => {
    const a = { id: '1234abcd-0000-4000-8000-000000000000', name: 'Perth' };
    const ref = atlasRef(a);
    expect(atlasPath(ref)).toBe(`/atlas/${ref}`);
    expect(atlasFromRef(ref, [a])).toBe(a);
    expect(atlasFromRef(atlasRef({ ...a, name: 'Elsewhere' }), [a])).toBe(a);
  });
});
