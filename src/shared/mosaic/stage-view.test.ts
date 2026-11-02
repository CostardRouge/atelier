import { describe, expect, it } from 'vitest';
import { MIN_CROP_SCALE, cropRect } from './frame';
import { IDENTITY_VIEW, canPanView, clampStageView, cropFromView, isIdentityView, panStageView, pictureArea, stagePointToMosaic, viewBounds, viewOfWindow, viewWindow, zoomStageView } from './stage-view';

const W = 960;
const H = 540;

describe('the stage view', () => {
  it('zooms about the anchor and clamps to the stage', () => {
    const b = viewBounds(1);
    const v = zoomStageView(IDENTITY_VIEW, 2, { x: 480, y: 270 }, W, H, b);
    expect(v.s).toBe(2);
    expect(v.ox).toBe(-480);
    expect(v.oy).toBe(-270);
    // The point under the hand stays put.
    expect(-v.ox / v.s + 480 / v.s).toBeCloseTo(480);
    // At the top-left corner nothing moves off.
    const c = zoomStageView(IDENTITY_VIEW, 2, { x: 0, y: 0 }, W, H, b);
    expect(c.ox).toBe(0);
    expect(c.oy).toBe(0);
    // A pan never shows past the mosaic's edge.
    const p = panStageView(v, 10000, -10000, W, H, b);
    expect(p.ox).toBe(0);
    expect(p.oy).toBe(-H);
    expect(isIdentityView(IDENTITY_VIEW)).toBe(true);
    expect(isIdentityView(v)).toBe(false);
  });

  it('cannot zoom out past the whole frame, nor in past the smallest crop', () => {
    expect(viewBounds(1)).toEqual({ min: 1, max: 1 / MIN_CROP_SCALE });
    expect(viewBounds(0.5)).toEqual({ min: 0.5, max: 5 });
    const out = zoomStageView(IDENTITY_VIEW, 0.5, { x: 480, y: 270 }, W, H, viewBounds(0.5));
    expect(out.s).toBe(0.5);
    // Zoomed out, the mosaic sits centred.
    expect(out.ox).toBe(W / 4);
    expect(out.oy).toBe(H / 4);
    expect(clampStageView({ s: 99, ox: 0, oy: 0 }, W, H, viewBounds(1)).s).toBe(1 / MIN_CROP_SCALE);
  });

  it('names the crop the window in view shows of the target', () => {
    const pic = { W: 4000, H: 3000 };
    const aspect = W / H;
    const whole = cropRect(pic.W, pic.H, aspect);
    // ×2 about the centre: the crop is half the frame, centred.
    const v = zoomStageView(IDENTITY_VIEW, 2, { x: 480, y: 270 }, W, H, viewBounds(1));
    const crop = cropFromView(v, W, H, whole, pic.W, pic.H, aspect);
    expect(crop.scale).toBeCloseTo(0.5);
    expect(crop.cx).toBeCloseTo(0.5);
    expect(crop.cy).toBeCloseTo(0.5);
    // ×2 about the top-left corner: the top-left quarter.
    const tl = cropFromView(zoomStageView(IDENTITY_VIEW, 2, { x: 0, y: 0 }, W, H, viewBounds(1)), W, H, whole, pic.W, pic.H, aspect);
    const r = cropRect(pic.W, pic.H, aspect, tl);
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(whole.y);
    expect(r.w).toBeCloseTo(whole.w / 2);
    // Zooming out from a half frame gives the whole frame back, never past it.
    const half = cropRect(pic.W, pic.H, aspect, crop);
    const back = cropFromView(zoomStageView(IDENTITY_VIEW, 0.5, { x: 480, y: 270 }, W, H, viewBounds(0.5)), W, H, half, pic.W, pic.H, aspect);
    expect(back.scale).toBeCloseTo(1);
    const past = cropFromView({ s: 0.2, ox: 384, oy: 216 }, W, H, half, pic.W, pic.H, aspect);
    expect(past.scale).toBe(1);
    // The identity view names the crop the frame already is.
    const same = cropFromView(IDENTITY_VIEW, W, H, half, pic.W, pic.H, aspect);
    expect(same.scale).toBeCloseTo(0.5);
  });

  it('a window and its view are inverses', () => {
    const v = { s: 2.5, ox: -300, oy: -100 };
    const win = viewWindow(v, W, H);
    const back = viewOfWindow(win, W);
    expect(back.s).toBeCloseTo(v.s);
    expect(back.ox).toBeCloseTo(v.ox);
    expect(back.oy).toBeCloseTo(v.oy);
  });
});

describe('the view under Auto-frame, inside the whole picture (lab 4, L3)', () => {
  // A 16:9 stage built on the middle third of a 3000 × 1500 picture's width, its full height.
  const W = 960;
  const H = 540;
  const frame = { x: 1000, y: 0, w: 1000, h: 562.5 };
  const area = pictureArea(frame, 3000, 1500, W, H);
  const b = viewBounds(0.4);

  it('names the whole picture in stage units, and says when there is somewhere to go', () => {
    expect(area.x).toBeCloseTo(-960);
    expect(area.w).toBeCloseTo(2880);
    expect(area.h).toBeCloseTo(1440);
    expect(canPanView(IDENTITY_VIEW, W, H)).toBe(false);
    expect(canPanView(IDENTITY_VIEW, W, H, area)).toBe(true);
    expect(canPanView({ s: 2, ox: 0, oy: 0 }, W, H)).toBe(true);
  });

  it('lets a drag slide the window past the mosaic built, never past the picture', () => {
    const slid = panStageView(IDENTITY_VIEW, 300, 0, W, H, b, area);
    expect(slid.ox).toBe(300);
    const far = panStageView(IDENTITY_VIEW, 5000, 5000, W, H, b, area);
    expect(far.ox).toBeCloseTo(960);
    expect(far.oy).toBe(0);
    // Without the area, the stage bounds hold as before.
    expect(panStageView(IDENTITY_VIEW, 300, 0, W, H, b).ox).toBe(0);
  });

  it('maps a click through the view to the mosaic point under it', () => {
    expect(stagePointToMosaic({ s: 2, ox: -480, oy: -270 }, { x: 480, y: 270 })).toEqual({ x: 480, y: 270 });
    expect(stagePointToMosaic(IDENTITY_VIEW, { x: 10, y: 20 })).toEqual({ x: 10, y: 20 });
  });
});
