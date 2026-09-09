import { useEffect, useState } from 'react';
import { pickAvcCodec } from './webcodecs-export';

/**
 * Can this browser actually ENCODE H.264, rather than merely expose a
 * `VideoEncoder`?
 *
 * The two are not the same question, and the difference is measured: a
 * Chromium build can carry the whole WebCodecs surface and refuse every AVC
 * config, which surfaces as the platform's own "Encoder creation error" the
 * moment an export starts. `isEncodeSupported()` answers the first question
 * and is the right guard for "is this API here at all"; this answers the
 * second, so a panel can say a clip is impossible BEFORE the author presses
 * anything.
 *
 * The probe is a real `isConfigSupported` round trip at a common delivery
 * size, run once per page and shared — hardware support does not change under
 * a running tab.
 */
let probe: Promise<boolean> | null = null;

function probeAvc(): Promise<boolean> {
  probe ??= (async () => {
    if (typeof VideoEncoder === 'undefined') return false;
    // 1080p landscape: a size every encoder that supports H.264 at all takes.
    // A per-variant probe would be more precise and would have to run on every
    // keystroke; `encodeFrames` still refuses with the real size if this lies.
    const config = { width: 1920, height: 1080, bitrate: 8_000_000, framerate: 30 };
    try {
      const codec = await pickAvcCodec(config);
      const support = await VideoEncoder.isConfigSupported({ codec, ...config });
      return Boolean(support.supported);
    } catch {
      return false;
    }
  })();
  return probe;
}

/**
 * True when H.264 can be encoded here, false when it cannot, and true while
 * the probe is still out — an optimistic start, because the alternative is a
 * panel that says "no video" for a beat on every open and then contradicts
 * itself.
 */
export function useAvcEncodeSupport(): boolean {
  const [supported, setSupported] = useState(true);
  useEffect(() => {
    let alive = true;
    void probeAvc().then((ok) => {
      if (alive) setSupported(ok);
    });
    return () => {
      alive = false;
    };
  }, []);
  return supported;
}
