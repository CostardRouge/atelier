import { describe, expect, it } from 'vitest';
import type { ObjectTrack } from '../../shared/story/studio';
import { inkTracks, sampleTimes } from './use-preflight';

const tr = (key: string, slot = 's', text = true): ObjectTrack => ({ id: `${slot}:${key}`, key, slot, text, spans: [[0, 1]] });

describe('inkTracks', () => {
  it('leaves a container to its named parts, the credit and wordless objects out', () => {
    const kept = inkTracks([tr('hook', ''), tr('hook.big', ''), tr('hook.veil', '', false), tr('wall'), tr('caption'), tr('map.credit'), tr('map-camera', 'm'), tr('map-camera.stops', 'm')]);
    expect(kept.map((t) => t.id)).toEqual([':hook.big', 's:wall', 's:caption', 'm:map-camera.stops']);
  });
});

describe('sampleTimes', () => {
  it('three moments a span, one for a blink', () => {
    expect(sampleTimes([[1, 4]])).toEqual([1.6, 2.5, 3.85]);
    expect(sampleTimes([[2, 2.1]])).toEqual([2.05]);
  });
});
