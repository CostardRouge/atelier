import { describe, expect, it } from 'vitest';
import { cameraValues, readStoryCamera, STORY_CAMERA_PRESETS, storyCameraTrack } from './story-camera';
import { withLook } from './sources';
import type { StoryScript } from './story-script';

describe('the story map’s camera', () => {
  it('keeps the camera of before when none is chosen, and reads a preset or its own steps', () => {
    expect(cameraValues(undefined)).toBeNull();
    expect(cameraValues({ preset: 'before' })).toBeNull();
    expect(cameraValues({ preset: 'calm' })).toEqual(STORY_CAMERA_PRESETS.calm.values);
    expect(cameraValues({ preset: 'own', viewKm: 900, orientation: 'heading' })).toMatchObject({ viewKm: 900, orientation: 'heading', smoothing: 1.1 });
    expect(readStoryCamera({ preset: 'navigation', viewKm: 99999, smoothing: 'x' })).toEqual({ preset: 'navigation', viewKm: 8000 });
  });

  it('opens and ends on the whole map, and follows the head between, wider than ×1 never', () => {
    const track = storyCameraTrack(STORY_CAMERA_PRESETS.calm.values, 5, (t) => ({ x: 100 + t * 150, y: 300 + t * 100 }));
    expect(track.at(0).centre).toEqual({ x: 540, y: 900 });
    expect(track.at(0).width).toBeCloseTo(1080, 6);
    expect(track.at(5).width).toBeCloseTo(1080, 0);
    const mid = track.at(2.5);
    expect(mid.width).toBeCloseTo(2600 / 4.7, 0);
    expect(Math.hypot(mid.centre.x - (100 + 2.9 * 150), mid.centre.y - (300 + 2.9 * 100))).toBeLessThan(80);
  });

  it('keeps only what differs from before in the script', () => {
    const base = { kind: 'atelier.story-script', version: 1, posts: {} } as unknown as StoryScript;
    expect(withLook(base, { camera: { preset: 'calm' } }).look?.camera).toEqual({ preset: 'calm' });
    expect(withLook(withLook(base, { camera: { preset: 'calm' } }), { camera: { preset: 'before' } }).look).toBeUndefined();
  });
});
