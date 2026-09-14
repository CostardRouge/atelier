import { describe, expect, it, vi } from 'vitest';
import type { FrameGrader } from './frame-grader';
import { holdGrades, type CopyPicture, type RasterSurface } from './held-grader';

/** Stand-ins: the holding logic only compares identities, never reads pixels. */
const picture = (name: string) => ({ name }) as unknown as CanvasImageSource;
const surface = (name: string) => ({ name }) as unknown as RasterSurface;

function fakeGrader(output = picture('gl-canvas')) {
  const render = vi.fn<FrameGrader['render']>(() => output);
  const dispose = vi.fn();
  const grader: FrameGrader = { render, dispose };
  return { grader, render, dispose, output };
}

function fakeCopy(result: RasterSurface | null = surface('raster')) {
  return vi.fn<CopyPicture>(() => result);
}

describe('holdGrades', () => {
  it('grades once while the picture does not change', () => {
    const { grader, render } = fakeGrader();
    const held = holdGrades(grader, fakeCopy());
    const photo = picture('photo');
    for (let i = 0; i < 10; i++) held.render(photo);
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('serves the grade itself on the first paint, the copy from the second', () => {
    const { grader, output } = fakeGrader();
    const copy = fakeCopy();
    const held = holdGrades(grader, copy);
    const photo = picture('photo');
    expect(held.render(photo)).toBe(output);
    expect(copy).not.toHaveBeenCalled();
    const raster = held.render(photo);
    expect(raster).toEqual(surface('raster'));
    expect(held.render(photo)).toBe(raster);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('grades again, and copies nothing, for a picture that changes every paint', () => {
    const { grader, render } = fakeGrader();
    const copy = fakeCopy();
    const held = holdGrades(grader, copy);
    for (let i = 0; i < 5; i++) held.render(picture(`frame ${i}`));
    expect(render).toHaveBeenCalledTimes(5);
    expect(copy).not.toHaveBeenCalled();
  });

  it('grades the same element again after invalidate — a clip whose frame moved', () => {
    const { grader, render, output } = fakeGrader();
    const held = holdGrades(grader, fakeCopy());
    const video = picture('video');
    held.render(video);
    held.render(video);
    held.invalidate();
    // The fresh grade, not the copy of the frame before.
    expect(held.render(video)).toBe(output);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it('hands the copy surface back to be reused on the next copy', () => {
    const { grader } = fakeGrader();
    const first = surface('first');
    const copy = vi.fn<CopyPicture>((_p, into) => into ?? first);
    const held = holdGrades(grader, copy);
    const a = picture('a');
    const b = picture('b');
    held.render(a);
    held.render(a);
    held.render(b);
    held.render(b);
    expect(copy).toHaveBeenCalledTimes(2);
    expect(copy.mock.calls[0][1]).toBeNull();
    expect(copy.mock.calls[1][1]).toBe(first);
  });

  it('never copies a pass-through grade (no WebGL2 hands the source back)', () => {
    const render = vi.fn((s: CanvasImageSource) => s);
    const copy = fakeCopy();
    const held = holdGrades({ render, dispose() {} }, copy);
    const photo = picture('photo');
    expect(held.render(photo)).toBe(photo);
    expect(held.render(photo)).toBe(photo);
    expect(copy).not.toHaveBeenCalled();
  });

  it('keeps serving the grade when a copy cannot be made, and tries once', () => {
    const { grader, output } = fakeGrader();
    const copy = fakeCopy(null);
    const held = holdGrades(grader, copy);
    const photo = picture('photo');
    held.render(photo);
    expect(held.render(photo)).toBe(output);
    expect(held.render(photo)).toBe(output);
    expect(copy).toHaveBeenCalledTimes(1);
  });

  it('disposes the grader it holds', () => {
    const { grader, dispose } = fakeGrader();
    holdGrades(grader, fakeCopy()).dispose();
    expect(dispose).toHaveBeenCalledTimes(1);
  });
});
