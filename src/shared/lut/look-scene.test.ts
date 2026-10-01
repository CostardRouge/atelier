import { describe, expect, it } from 'vitest';
import {
  SCENE_PIXELS,
  STAGE_MIN_WIDTH,
  asPreviewPicture,
  sceneFrame,
  sceneNote,
  stageColumnBox,
  stageColumnWidth,
} from './look-scene';

describe('stageColumnWidth', () => {
  // The maintainer's screen: a 1270 × 1300 window, the dialog's body inside it.
  const his = { bodyWidth: 1190, bodyHeight: 1110, cardHeight: 118 };

  it('gives a portrait picture exactly the width its height buys', () => {
    const w = stageColumnWidth({ ...his, aspect: 9 / 16 });
    expect(w).toBe(Math.round((1110 - 118) * (9 / 16)));
    expect(w).toBeLessThan(his.bodyWidth / 2);
  });

  it('caps a landscape picture at half the body', () => {
    expect(stageColumnWidth({ ...his, aspect: 16 / 9 })).toBe(595);
    expect(stageColumnWidth({ ...his, aspect: 1 })).toBe(595);
  });

  it('never goes under the floor on a wide body', () => {
    // A short, wide window: the height buys a portrait frame 200px.
    expect(stageColumnWidth({ bodyWidth: 1400, bodyHeight: 400, cardHeight: 118, aspect: 9 / 16 })).toBe(
      STAGE_MIN_WIDTH,
    );
  });

  it('lets the half win over the floor on a narrow body', () => {
    // A tablet: half the body is under 20rem, and the grid needs the rest.
    expect(stageColumnWidth({ bodyWidth: 600, bodyHeight: 700, cardHeight: 118, aspect: 9 / 16 })).toBe(300);
  });

  it('falls back to the half while the picture has no size', () => {
    expect(stageColumnWidth({ ...his, aspect: 0 })).toBe(595);
  });

  it('counts the card out of the height the picture can use', () => {
    // A body whose height, not its half, is what bounds a portrait frame.
    const room = { bodyWidth: 1400, bodyHeight: 900, aspect: 9 / 16 };
    const bare = stageColumnWidth({ ...room, cardHeight: 0 });
    const carded = stageColumnWidth({ ...room, cardHeight: 118 });
    expect(bare - carded).toBe(Math.round(118 * (9 / 16)));
  });

  it('gives a portrait picture the whole height, and a landscape one only its own', () => {
    const portrait = stageColumnBox({ ...his, aspect: 9 / 16 });
    expect(portrait.height).toBe(his.bodyHeight - his.cardHeight);
    const landscape = stageColumnBox({ ...his, aspect: 16 / 9 });
    expect(landscape.width).toBe(595);
    expect(landscape.height).toBe(Math.round(595 / (16 / 9)));
    expect(landscape.height).toBeLessThan(his.bodyHeight - his.cardHeight);
  });

  it('never makes the box taller than the room above the card', () => {
    const { height } = stageColumnBox({ bodyWidth: 1400, bodyHeight: 400, cardHeight: 118, aspect: 1 });
    expect(height).toBe(400 - 118);
  });
});

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
