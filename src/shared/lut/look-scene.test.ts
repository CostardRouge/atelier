import { describe, expect, it } from 'vitest';
import { SCENE_PIXELS, asPreviewPicture, sceneFrame, sceneNote } from './look-scene';

describe('sceneFrame', () => {
  it('leaves a picture that already fits alone', () => {
    expect(sceneFrame(800, 600)).toEqual({ w: 800, h: 600 });
  });

  it('scales a big still down by AREA, keeping its aspect', () => {
    // The maintainer's 48-megapixel drone JPEG.
    const frame = sceneFrame(8064, 6048);
    expect(frame.w * frame.h).toBeLessThanOrEqual(SCENE_PIXELS);
    expect(frame.w / frame.h).toBeCloseTo(8064 / 6048, 2);
    // Two buffers of this cost single-digit megabytes, which is the point.
    expect(frame.w * frame.h * 4 * 2).toBeLessThan(8 * 1024 * 1024);
  });

  it('keeps a portrait portrait — the canvas IS the picture', () => {
    const frame = sceneFrame(3024, 4032);
    expect(frame.h).toBeGreaterThan(frame.w);
    expect(frame.w / frame.h).toBeCloseTo(3024 / 4032, 2);
  });

  it('answers zero for a source that has no size yet', () => {
    expect(sceneFrame(0, 0)).toEqual({ w: 0, h: 0 });
  });
});

describe('asPreviewPicture', () => {
  it('passes a measured picture straight through', () => {
    const picture = { image: {} as CanvasImageSource, width: 4000, height: 3000 };
    expect(asPreviewPicture(picture)).toBe(picture);
  });

  it('measures a canvas off its own pixels', () => {
    const canvas = { width: 1200, height: 800 } as HTMLCanvasElement;
    expect(asPreviewPicture(canvas)).toEqual({ image: canvas, width: 1200, height: 800 });
  });

  it('reads an <img> off its NATURAL size, not the box it is drawn in', () => {
    const img = { width: 320, height: 240, naturalWidth: 8064, naturalHeight: 6048 } as HTMLImageElement;
    expect(asPreviewPicture(img)).toEqual({ image: img, width: 8064, height: 6048 });
  });

  it('answers null for no picture at all', () => {
    expect(asPreviewPicture(null)).toBeNull();
  });
});

describe('sceneNote', () => {
  it('warns when a conversion is aimed at a display-referred picture', () => {
    expect(sceneNote('log', false)).toMatch(/expects a log source/);
  });

  it('says nothing when the source really is log', () => {
    expect(sceneNote('log', true)).toBeNull();
  });

  it('never cautions a creative look, on either kind of source', () => {
    expect(sceneNote('rec709', false)).toBeNull();
    expect(sceneNote('rec709', true)).toBeNull();
  });

  it('says nothing about a look whose family is unknown', () => {
    expect(sceneNote(null, false)).toBeNull();
  });
});
