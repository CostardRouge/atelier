import { describe, expect, it } from 'vitest';
import {
  findCamera,
  findLens,
  hermite,
  interpolateDistortion,
  interpolateTca,
  interpolateVignetting,
  lensNameScore,
  parseLensfunXml,
  profileTerms,
  type LensfunLens,
} from './lensfun';
import { profileChannelRadius, profileSourceRadius, profileVignetteGain } from '../render/lens';

/** Real entries from Lensfun's `mil-sony.xml` (CC BY-SA 3.0), trimmed. */
const XML = `<!DOCTYPE lensdatabase SYSTEM "lensfun-database.dtd">
<lensdatabase version="2">
    <mount><name>Sony E</name></mount>
    <camera>
        <maker>Sony</maker>
        <model>ILCE-7CM2</model>
        <model lang="en">Alpha 7C II</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
    </camera>
    <camera>
        <maker>Sony</maker>
        <model>ILCE-6000</model>
        <mount>Sony E</mount>
        <cropfactor>1.534</cropfactor>
    </camera>
    <lens>
        <maker>Sony</maker>
        <model>FE 24-70mm f/4 ZA OSS</model>
        <mount>Sony E</mount>
        <cropfactor>1.534</cropfactor>
        <calibration>
            <!-- Taken with Sony A6000 -->
            <distortion model="ptlens" focal="24" a="0.01086" b="-0.05129" c="0.0454"/>
        </calibration>
    </lens>
    <lens>
        <maker>Sony</maker>
        <model>FE 24-70mm f/4 ZA OSS</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
        <calibration>
            <!-- Taken with Sony A7II -->
            <!--distortion model="ptlens" focal="24" a="9" b="9" c="9"/-->
            <distortion model="ptlens" focal="24" a="0.02797" b="-0.09138" c="0.04487"/>
            <distortion model="ptlens" focal="33" a="0.01741" b="-0.03649" c="0.02297"/>
            <distortion model="ptlens" focal="50" a="0.01325" b="-0.0102" c="0.0103"/>
            <distortion model="ptlens" focal="70" a="0.01335" b="-0.01629" c="0.02605"/>
            <tca model="poly3" focal="24" br="0.0001620" vr="1.0002925" bb="-0.0000592" vb="1.0000445"/>
            <tca model="poly3" focal="33" br="-0.0000376" vr="1.0003144" bb="0.0000309" vb="1.0000261"/>
            <vignetting model="pa" focal="24" aperture="4" distance="1000" k1="-0.4905" k2="0.1735" k3="-0.1133"/>
            <vignetting model="pa" focal="24" aperture="8" distance="1000" k1="-0.2046" k2="-0.0395" k3="0.0226"/>
        </calibration>
    </lens>
    <lens>
        <maker>Sony</maker>
        <model>FE 24-70mm f/2.8 GM II</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
        <calibration><distortion model="poly3" focal="24" k1="-0.012"/></calibration>
    </lens>
    <lens>
        <maker>Sony</maker>
        <model>FE 12-24mm f/4 G</model>
        <mount>Sony E</mount>
        <cropfactor>1</cropfactor>
        <type>fisheye</type>
    </lens>
</lensdatabase>`;

const db = parseLensfunXml(XML);
const a7c2 = findCamera([db], 'SONY', 'ILCE-7CM2')!;
const fe2470 = db.lenses[1];

/**
 * Lensfun's own correction of ONE pixel, transcribed from modifier.cpp and
 * mod-coord.cpp (ptlens, Reverse = false): pixel → normalised by NormScale →
 * the rescaled polynomial → back to pixels. Independent of `profileTerms`, so
 * the two agreeing is the conversion being right.
 */
function lensfunSource(px: number, py: number, W: number, H: number, crop: number, lens: LensfunLens, focal: number) {
  const width = W - 1;
  const height = H - 1;
  const norm = Math.hypot(36, 24) / crop / Math.hypot(width + 1, height + 1) / focal;
  const cx = (width / 2) * norm;
  const cy = (height / 2) * norm;
  const d = interpolateDistortion(lens, focal)!;
  const [a, b, c] = d.terms;
  const huginMm = Math.hypot(36, 24) / lens.crop / Math.hypot(lens.aspect, 1) / 2;
  const hs = focal / huginMm;
  const dd = 1 - a - b - c;
  const a_ = (a * hs ** 3) / dd ** 4;
  const b_ = (b * hs ** 2) / dd ** 3;
  const c_ = (c * hs) / dd ** 2;
  const x = px * norm - cx;
  const y = py * norm - cy;
  const ru = Math.hypot(x, y);
  const poly = a_ * ru ** 3 + b_ * ru ** 2 + c_ * ru + 1;
  return [(x * poly + cx) / norm, (y * poly + cy) / norm];
}

describe('reading the database', () => {
  it('reads cameras, lenses and their calibrations, and ignores what is commented out', () => {
    expect(db.cameras).toHaveLength(2);
    expect(a7c2).toMatchObject({ maker: 'Sony', mount: 'Sony E', crop: 1, models: ['ILCE-7CM2', 'Alpha 7C II'] });
    expect(fe2470.distortion.map((d) => d.focal)).toEqual([24, 33, 50, 70]);
    expect(fe2470.distortion[0].terms).toEqual([0.02797, -0.09138, 0.04487]);
    expect(fe2470.tca[0].terms).toEqual([1.0002925, 1.0000445, 0, 0, 0.000162, -0.0000592]);
    expect(fe2470.vignetting).toHaveLength(2);
    expect(fe2470.aspect).toBe(1.5);
  });
});

describe('finding the camera and the lens', () => {
  it('finds a body by its EXIF make and model, whatever the maker’s case', () => {
    expect(findCamera([db], 'SONY', 'ILCE-7CM2')?.crop).toBe(1);
    expect(findCamera([db], 'Sony', 'ILCE-6000')?.crop).toBe(1.534);
    expect(findCamera([db], 'Canon', 'ILCE-7CM2')).toBeNull();
  });

  it('matches a lens name as Sony writes it against Lensfun’s, and never a different focal range', () => {
    expect(lensNameScore('FE 24-70mm F2.8 GM II', 'FE 24-70mm f/2.8 GM II')).toBe(1);
    expect(lensNameScore('FE 24-70mm F2.8 GM II', 'FE 24-70mm f/4 ZA OSS')).toBe(0);
    expect(lensNameScore('FE 24-105mm F4 G OSS', 'FE 24-70mm f/4 ZA OSS')).toBe(0);
    expect(findLens([db], a7c2, 'FE 24-70mm F2.8 GM II')?.lens.models[0]).toBe('FE 24-70mm f/2.8 GM II');
  });

  it('takes the calibration made on the sensor closest from above, never a smaller one', () => {
    // On a full-frame body the A6000 calibration (crop 1.534) says nothing about the corners.
    expect(findLens([db], a7c2, 'FE 24-70mm F4 ZA OSS')?.lens.crop).toBe(1);
    const a6000 = findCamera([db], 'SONY', 'ILCE-6000')!;
    expect(findLens([db], a6000, 'FE 24-70mm F4 ZA OSS')?.lens.crop).toBe(1.534);
  });

  it('refuses a fisheye — a change of projection, not a radius', () => {
    expect(findLens([db], a7c2, 'FE 12-24mm F4 G')).toBeNull();
  });
});

describe('interpolating as lens.cpp does', () => {
  it('takes an exact focal as it is, and splines between the others on term × focal', () => {
    expect(interpolateDistortion(fe2470, 33)?.terms).toEqual([0.01741, -0.03649, 0.02297]);
    const at40 = interpolateDistortion(fe2470, 40)!;
    const t = (40 - 33) / (50 - 33);
    const b = hermite(-0.09138 * 24, -0.03649 * 33, -0.0102 * 50, -0.01629 * 70, t) / 40;
    expect(at40.terms[1]).toBeCloseTo(b, 12);
    // Past the last entry it holds the nearest.
    expect(interpolateDistortion(fe2470, 90)?.terms).toEqual([0.01335, -0.01629, 0.02605]);
  });

  it('interpolates TCA’s scale terms as they are and its radius terms × focal', () => {
    const at28 = interpolateTca(fe2470, 28)!;
    expect(at28.terms[0]).toBeGreaterThan(1.0002925);
    expect(at28.terms[0]).toBeLessThan(1.0003144);
  });

  it('weighs vignetting by distance in focal, 4/aperture and 0.1/distance, and takes an exact one as is', () => {
    expect(interpolateVignetting(fe2470, 24, 4)).toEqual([-0.4905, 0.1735, -0.1133]);
    const f56 = interpolateVignetting(fe2470, 24, 5.6)!;
    expect(f56[0]).toBeGreaterThan(-0.4905);
    expect(f56[0]).toBeLessThan(-0.2046);
  });
});

describe('into this suite’s units', () => {
  const W = 6000;
  const H = 4000;
  const halfDiag = Math.hypot(W, H) / 2;

  it('lands every point where Lensfun’s own modifier would, on the full frame', () => {
    for (const focal of [24, 40, 70]) {
      const { terms } = profileTerms(fe2470, { focal, aperture: null, imageCrop: 1 });
      for (const [px, py] of [[5999, 3999], [3000, 10], [100, 2000], [4500, 3000]]) {
        const [lx, ly] = lensfunSource(px, py, W, H, 1, fe2470, focal);
        const cx = (W - 1) / 2;
        const cy = (H - 1) / 2;
        const r = Math.hypot(px - cx, py - cy) / halfDiag;
        const rs = profileSourceRadius(r, terms.distortion) * halfDiag;
        const want = Math.hypot(lx - cx, ly - cy);
        expect(Math.abs(rs - want)).toBeLessThan(0.05);
      }
    }
  });

  it('moves a corner by what a 24 mm wide angle bends, and leaves the centre alone', () => {
    const { terms } = profileTerms(fe2470, { focal: 24, aperture: null, imageCrop: 1 });
    expect(profileSourceRadius(0, terms.distortion)).toBe(0);
    const corner = profileSourceRadius(1, terms.distortion);
    expect(Math.abs(corner - 1)).toBeGreaterThan(0.005);
    expect(Math.abs(corner - 1)).toBeLessThan(0.08);
  });

  it('scales red and blue by the measured amounts, and lifts a corner by the measured vignetting', () => {
    const { terms, has } = profileTerms(fe2470, { focal: 24, aperture: 4, imageCrop: 1 });
    expect(has).toEqual({ distortion: true, tca: true, vignette: true });
    // At the frame's corner: s = hypot(1.5, 1) = 1.803 Hugin units.
    const s = Math.hypot(1.5, 1);
    expect(profileChannelRadius(1, terms.tcaRed)).toBeCloseTo(1.0002925 + 0.000162 * s * s, 9);
    // pa's r = 1 IS the corner on a full-frame body: the gain undoes 1 + k1 + k2 + k3.
    expect(profileVignetteGain(1, terms.vignette)).toBeCloseTo(1 / (1 - 0.4905 + 0.1735 - 0.1133), 9);
  });
});
