import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAINTED_FPS,
  encodeFrames,
  paintedFps,
  paintedOutputSize,
} from './render-video';

describe('paintedOutputSize', () => {
  it('keeps an already-even size', () => {
    expect(paintedOutputSize(1080, 1920)).toEqual({ w: 1080, h: 1920 });
  });
  it('rounds an odd dimension, which H.264 cannot encode', () => {
    expect(paintedOutputSize(1081, 1921)).toEqual({ w: 1082, h: 1922 });
  });
  it('never returns zero, whatever it is handed', () => {
    expect(paintedOutputSize(0, 0)).toEqual({ w: 2, h: 2 });
    expect(paintedOutputSize(Number.NaN, -40)).toEqual({ w: 2, h: 2 });
  });
});

describe('paintedFps', () => {
  it('defaults when nothing is asked for', () => {
    expect(paintedFps(undefined)).toBe(DEFAULT_PAINTED_FPS);
  });
  it('clamps to a sane range and rounds', () => {
    expect(paintedFps(24.4)).toBe(24);
    expect(paintedFps(500)).toBe(60);
    expect(paintedFps(0)).toBe(DEFAULT_PAINTED_FPS);
    expect(paintedFps(Number.NaN)).toBe(DEFAULT_PAINTED_FPS);
  });
});

// ---------------------------------------------------------------------------
// The encode loop, against a stubbed WebCodecs.
//
// No CI runner has an H.264 encoder, and this container's Chromium has none
// either — so the loop is proven against fakes and the real mp4-muxer: the
// frame plan reaching the encoder, the timestamps being contiguous, the
// keyframe cadence, every frame being closed, and a real MP4 coming out. What
// is NOT proven here is that a browser's own encoder accepts the config; that
// is the maintainer's machine's job (docs/roadtrip-export.md §7).
// ---------------------------------------------------------------------------

/**
 * mp4-muxer checks `sample instanceof EncodedVideoChunk`, so the fake chunks
 * must be instances of whatever the global names — which is this class, once
 * stubbed. One byte of "bitstream" per frame is enough for it to write a real
 * sample table.
 */
class FakeChunk {
  type: 'key' | 'delta';
  timestamp: number;
  duration: number;
  byteLength = 1;
  constructor(init: { type: 'key' | 'delta'; timestamp: number; duration: number }) {
    this.type = init.type;
    this.timestamp = init.timestamp;
    this.duration = init.duration;
  }
  copyTo(dest: Uint8Array) {
    dest[0] = 0;
  }
}

interface Recorded {
  encoded: { timestamp: number; duration: number; keyFrame: boolean }[];
  closedFrames: number;
  configured: VideoEncoderConfig | null;
}

/** Install fake VideoEncoder / VideoFrame globals; returns what they saw. */
function stubWebCodecs(): Recorded {
  const recorded: Recorded = { encoded: [], closedFrames: 0, configured: null };

  class FakeVideoFrame {
    timestamp: number;
    duration: number;
    constructor(_source: unknown, init: { timestamp: number; duration: number }) {
      this.timestamp = init.timestamp;
      this.duration = init.duration;
    }
    close() {
      recorded.closedFrames += 1;
    }
  }

  class FakeVideoEncoder {
    static async isConfigSupported(config: VideoEncoderConfig) {
      return { supported: config.codec === 'avc1.640034', config };
    }
    state: 'unconfigured' | 'configured' | 'closed' = 'unconfigured';
    encodeQueueSize = 0;
    #output: (chunk: FakeChunk, meta: unknown) => void;
    constructor(init: { output: (chunk: FakeChunk, meta: unknown) => void }) {
      this.#output = init.output;
    }
    configure(config: VideoEncoderConfig) {
      recorded.configured = config;
      this.state = 'configured';
    }
    encode(frame: FakeVideoFrame, options?: { keyFrame?: boolean }) {
      const keyFrame = options?.keyFrame ?? false;
      recorded.encoded.push({
        timestamp: frame.timestamp,
        duration: frame.duration,
        keyFrame,
      });
      this.#output(
        new FakeChunk({
          type: keyFrame ? 'key' : 'delta',
          timestamp: frame.timestamp,
          duration: frame.duration,
        }),
        keyFrame
          ? { decoderConfig: { codec: 'avc1.640034', description: new Uint8Array([1, 2, 3]) } }
          : undefined,
      );
    }
    async flush() {}
    close() {
      this.state = 'closed';
    }
  }

  vi.stubGlobal('VideoEncoder', FakeVideoEncoder);
  vi.stubGlobal('VideoFrame', FakeVideoFrame);
  vi.stubGlobal('EncodedVideoChunk', FakeChunk);
  return recorded;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('encodeFrames', () => {
  it('encodes the whole plan, contiguously, and returns an MP4', async () => {
    const recorded = stubWebCodecs();
    const painted: number[] = [];

    const blob = await encodeFrames({
      width: 108,
      height: 192,
      seconds: 2,
      fps: 10,
      draw: (t) => {
        painted.push(t);
        return {} as unknown as CanvasImageSource;
      },
    });

    expect(recorded.encoded).toHaveLength(20);
    expect(painted[0]).toBe(0);
    expect(painted.at(-1)).toBeCloseTo(1.9, 5);
    // Each frame starts exactly where the previous one ended: a gap here is a
    // stutter in the delivered file that no unit of the plan would show.
    for (let i = 1; i < recorded.encoded.length; i += 1) {
      const prev = recorded.encoded[i - 1];
      expect(recorded.encoded[i].timestamp).toBe(prev.timestamp + prev.duration);
    }
    expect(recorded.encoded[0].timestamp).toBe(0);
    expect(recorded.closedFrames).toBe(20);
    expect(blob.type).toBe('video/mp4');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('keyframes every ~2 seconds and opens on one', async () => {
    const recorded = stubWebCodecs();
    await encodeFrames({
      width: 64,
      height: 64,
      seconds: 3,
      fps: 10,
      draw: () => ({}) as unknown as CanvasImageSource,
    });
    const keys = recorded.encoded.flatMap((e, i) => (e.keyFrame ? [i] : []));
    expect(keys).toEqual([0, 20]);
  });

  it('encodes at even dimensions whatever it is handed', async () => {
    const recorded = stubWebCodecs();
    await encodeFrames({
      width: 405,
      height: 721,
      seconds: 0.2,
      fps: 10,
      draw: () => ({}) as unknown as CanvasImageSource,
    });
    expect(recorded.configured?.width).toBe(406);
    expect(recorded.configured?.height).toBe(722);
  });

  it('awaits an async painter', async () => {
    const recorded = stubWebCodecs();
    await encodeFrames({
      width: 64,
      height: 64,
      seconds: 0.3,
      fps: 10,
      draw: async (t) => {
        await Promise.resolve();
        return { t } as unknown as CanvasImageSource;
      },
    });
    expect(recorded.encoded).toHaveLength(3);
  });

  it('refuses an empty clip rather than delivering an empty file', async () => {
    stubWebCodecs();
    await expect(
      encodeFrames({
        width: 64,
        height: 64,
        seconds: 0,
        draw: () => ({}) as unknown as CanvasImageSource,
      }),
    ).rejects.toThrow(/zero frames/i);
  });

  it('says so when the browser has an encoder but no H.264', async () => {
    // The real shape of this container's Chromium, and of any browser with
    // WebCodecs but no AVC: the object exists, every config is refused, and
    // `configure` would otherwise fail with the platform's own opaque message.
    stubWebCodecs();
    const Encoder = globalThis.VideoEncoder as unknown as {
      isConfigSupported: (c: VideoEncoderConfig) => Promise<{ supported: boolean }>;
    };
    Encoder.isConfigSupported = async () => ({ supported: false });
    await expect(
      encodeFrames({
        width: 64,
        height: 64,
        seconds: 1,
        draw: () => ({}) as unknown as CanvasImageSource,
      }),
    ).rejects.toThrow(/cannot encode H\.264/i);
  });

  it('says what is missing when the browser cannot encode', async () => {
    vi.stubGlobal('VideoEncoder', undefined);
    vi.stubGlobal('VideoFrame', undefined);
    await expect(
      encodeFrames({
        width: 64,
        height: 64,
        seconds: 1,
        draw: () => ({}) as unknown as CanvasImageSource,
      }),
    ).rejects.toThrow(/cannot encode video/i);
  });

  it('stops on an abort and closes the encoder', async () => {
    const recorded = stubWebCodecs();
    const controller = new AbortController();
    await expect(
      encodeFrames({
        width: 64,
        height: 64,
        seconds: 5,
        fps: 10,
        signal: controller.signal,
        draw: (t) => {
          if (t >= 0.2) controller.abort();
          return {} as unknown as CanvasImageSource;
        },
      }),
    ).rejects.toThrow(/cancelled/i);
    // Everything painted before the abort was closed: an aborted run must not
    // leak the frames it had already built.
    expect(recorded.closedFrames).toBe(recorded.encoded.length);
  });

  it('reports progress through to finalizing', async () => {
    stubWebCodecs();
    const phases: string[] = [];
    let last = 0;
    await encodeFrames({
      width: 64,
      height: 64,
      seconds: 0.5,
      fps: 10,
      draw: () => ({}) as unknown as CanvasImageSource,
      onProgress: (p) => {
        phases.push(p.phase);
        if (p.ratio !== null) last = p.ratio;
      },
    });
    expect(phases.at(-1)).toBe('finalizing');
    expect(last).toBe(1);
  });
});
