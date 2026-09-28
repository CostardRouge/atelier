import { describe, expect, it } from 'vitest';
import { describeProfileParts, lensKey, profileInEffect, readLensProfile, type LensProfileApplied } from './lens-profile';
import { cameraFiles, lensFiles, lensfunUrl } from './lensfun-source';

const applied: LensProfileApplied = {
  lens: 'Sony FE 24-70mm f/4 ZA OSS',
  camera: 'Sony ILCE-7CM2',
  focal: 24,
  aperture: 4,
  terms: { distortion: [0.078, -0.28, 0.15, 0], tcaRed: [1.0003, 0, 0.0005], tcaBlue: [1, 0, -0.0002], vignette: [0, 0, 0] },
  has: { distortion: true, tca: true, vignette: false },
  onRender: false,
};

describe('a profile on a picture', () => {
  it('reads back what it wrote, and keeps "never decided" apart from "taken off"', () => {
    expect(readLensProfile(JSON.parse(JSON.stringify(applied)))).toEqual(applied);
    expect(readLensProfile(undefined)).toBeUndefined();
    expect(readLensProfile(null)).toBeNull();
    expect(readLensProfile({ lens: 'x', focal: 24, terms: { distortion: [1, 2] } })).toBeNull();
  });

  it('draws on the sensor by itself, and on a camera render only where the author said so', () => {
    expect(profileInEffect(applied, true)).toBe(applied.terms);
    expect(profileInEffect(applied, false)).toBeNull();
    expect(profileInEffect({ ...applied, onRender: true }, false)).toBe(applied.terms);
    expect(profileInEffect(null, true)).toBeNull();
    expect(profileInEffect(undefined, true)).toBeNull();
  });

  it('says what it corrects, and keys a lookup on the body and the lens as the EXIF names them', () => {
    expect(describeProfileParts(applied.has)).toBe('distortion · fringing');
    expect(lensKey('SONY', 'ILCE-7CM2', 'FE 24-70mm F4 ZA OSS')).toBe(lensKey('Sony', 'ilce-7cm2', 'FE 24-70mm F4 ZA OSS'));
  });
});

describe('which Lensfun files a lookup asks for', () => {
  it('starts with the camera maker’s, and knows nothing for a maker it has no file for', () => {
    expect(cameraFiles('sony')[0]).toBe('mil-sony.xml');
    expect(cameraFiles('dji')).toEqual(['actioncams.xml']);
    expect(cameraFiles('nobody')).toEqual([]);
  });

  it('looks further only among the independent lens makers for that kind of body', () => {
    expect(lensFiles('mil-sony.xml')).toContain('mil-sigma.xml');
    expect(lensFiles('mil-sony.xml').every((f) => f.startsWith('mil-') || f === 'misc.xml')).toBe(true);
    expect(lensFiles('slr-canon.xml')).toContain('slr-tamron.xml');
    // A compact's or an action camera's lens is in its own file.
    expect(lensFiles('compact-sony.xml')).toEqual([]);
    expect(lensfunUrl('mil-sony.xml')).toBe('https://raw.githubusercontent.com/lensfun/lensfun/master/data/db/mil-sony.xml');
  });
});
