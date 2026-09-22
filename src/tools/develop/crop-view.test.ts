import { describe, expect, it } from 'vitest';
import {
  CROP_PAD,
  CROP_VIEW_FIT,
  CROP_VIEW_MAX,
  clampCropView,
  cropContent,
  cropFitScale,
  cropStageTransform,
  quarterTurned,
  zoomCropViewAbout,
} from './crop-view';

const box = { w: 1000, h: 700 };
const src = { width: 4000, height: 3000 };

/** The source fraction under a stage point, through the painter's own transform. */
function under(view: { zoom: number; x: number; y: number }, p: { x: number; y: number }, rotation = 0) {
  const { k, ox, oy } = cropStageTransform(box, src, rotation, view);
  const q = quarterTurned(src, rotation);
  return { x: (p.x - ox) / k / q.width + 0.5, y: (p.y - oy) / k / q.height + 0.5 };
}

describe('the fit', () => {
  it('keeps the handles’ room on the limiting axis and turns with a quarter turn', () => {
    expect(cropFitScale(box, src, 0)).toBeCloseTo((700 - 2 * CROP_PAD) / 3000);
    expect(quarterTurned(src, 90)).toEqual({ width: 3000, height: 4000 });
    expect(cropFitScale(box, src, 90)).toBeCloseTo((700 - 2 * CROP_PAD) / 4000);
    // A fine angle is not a quarter turn.
    expect(quarterTurned(src, 12)).toEqual({ width: 4000, height: 3000 });
  });
});

describe('clampCropView', () => {
  it('holds the zoom between the fit and the ceiling, and pins the fit at the centre', () => {
    expect(clampCropView({ zoom: 0.3, x: 40, y: 10 }, box, src, 0)).toEqual(CROP_VIEW_FIT);
    expect(clampCropView({ zoom: 99, x: 0, y: 0 }, box, src, 0).zoom).toBe(CROP_VIEW_MAX);
  });

  it('holds the pan to half of what the scaled picture has over the stage', () => {
    const content = cropContent(box, src, 0);
    const zoom = 3;
    const limitX = (content.width * zoom - box.w) / 2;
    const held = clampCropView({ zoom, x: 5000, y: -5000 }, box, src, 0);
    expect(held.x).toBeCloseTo(limitX);
    expect(held.y).toBeCloseTo(-(content.height * zoom - box.h) / 2);
  });

  it('gives no pan at all while the picture is smaller than the stage', () => {
    // Fitted, the picture is CROP_PAD short of the stage on the limiting axis: nothing to pan.
    expect(clampCropView({ zoom: 1.05, x: 30, y: 30 }, box, src, 0)).toEqual({ zoom: 1.05, x: 0, y: 0 });
  });

  it('only bounds the zoom before the stage is measured', () => {
    expect(clampCropView({ zoom: 20, x: 7, y: 7 }, null, src, 0)).toEqual({ zoom: CROP_VIEW_MAX, x: 7, y: 7 });
  });
});

describe('zoomCropViewAbout', () => {
  it('keeps the source point under the anchor still, notch after notch', () => {
    let view = { ...CROP_VIEW_FIT };
    // Deep enough in that both axes have slack to hold the point.
    view = zoomCropViewAbout(view, 2.5, { x: 500, y: 350 }, box, src, 0);
    const anchor = { x: 300, y: 500 };
    const before = under(view, anchor);
    for (const zoom of [3, 3.6, 4.4, 5.5]) {
      view = zoomCropViewAbout(view, zoom, anchor, box, src, 0);
      const after = under(view, anchor);
      expect(after.x).toBeCloseTo(before.x, 6);
      expect(after.y).toBeCloseTo(before.y, 6);
    }
  });

  it('is exact under a quarter turn too', () => {
    let view = zoomCropViewAbout(CROP_VIEW_FIT, 3, { x: 500, y: 350 }, box, src, 90);
    const anchor = { x: 620, y: 200 };
    const before = under(view, anchor, 90);
    view = zoomCropViewAbout(view, 4.2, anchor, box, src, 90);
    const after = under(view, anchor, 90);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('comes back to the exact fit, offsets and all', () => {
    const zoomed = zoomCropViewAbout(CROP_VIEW_FIT, 4, { x: 900, y: 100 }, box, src, 0);
    expect(zoomed.zoom).toBe(4);
    expect(zoomCropViewAbout(zoomed, 0.5, { x: 900, y: 100 }, box, src, 0)).toEqual(CROP_VIEW_FIT);
  });

  it('never goes past the ceiling, and what it stores is what it draws', () => {
    const view = zoomCropViewAbout({ zoom: 7, x: 0, y: 0 }, 40, { x: 0, y: 0 }, box, src, 0);
    expect(view.zoom).toBe(CROP_VIEW_MAX);
    expect(clampCropView(view, box, src, 0)).toEqual(view);
  });
});
