/**
 * A sound as a row of bars: the loudest sample of each of `bars` equal slices,
 * scaled so the loudest bar is 1 — what a small waveform draws. Pure.
 */
export function wavePeaks(samples: Float32Array, bars: number): number[] {
  const n = Math.max(1, Math.floor(bars));
  if (!samples.length) return Array.from({ length: n }, () => 0);
  const size = samples.length / n;
  // A stride keeps a three-minute track to a few thousand reads a bar.
  const stride = Math.max(1, Math.floor(size / 2000));
  const out: number[] = [];
  let top = 0;
  for (let b = 0; b < n; b++) {
    let peak = 0;
    const end = Math.min(samples.length, Math.floor((b + 1) * size));
    for (let i = Math.floor(b * size); i < end; i += stride) {
      const v = Math.abs(samples[i]);
      if (v > peak) peak = v;
    }
    out.push(peak);
    if (peak > top) top = peak;
  }
  return top > 0 ? out.map((v) => Math.round((v / top) * 1000) / 1000) : out;
}
