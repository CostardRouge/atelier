/**
 * What a sound file says about its own time, read on the device (strategy W2
 * and G3): when a VOICE speaks, and where a MUSIC's beats fall — the cues the
 * living wall's smart motion follows, and the snap points of a timeline. No
 * model, no network: an energy envelope, its onsets, and the tempo that best
 * explains them. Good enough to move a wall on the beat and to slow it while
 * he speaks; never a transcription. (pure, on samples)
 */

/** The mean of the channels, mono — what both readings listen to. */
export function monoOf(channels: readonly Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0];
  const n = Math.min(...channels.map((c) => c.length));
  const out = new Float32Array(n);
  for (const c of channels) for (let i = 0; i < n; i++) out[i] += c[i] / channels.length;
  return out;
}

/** The RMS of every `hop` seconds of `samples`, a window of `win` seconds each. */
export function envelope(samples: Float32Array, rate: number, hop = 0.01, win = 0.03): Float32Array {
  const h = Math.max(1, Math.round(hop * rate));
  const w = Math.max(h, Math.round(win * rate));
  const n = Math.max(0, Math.floor((samples.length - w) / h) + 1);
  const out = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    let s = 0;
    const from = k * h;
    for (let i = from; i < from + w; i++) s += samples[i] * samples[i];
    out[k] = Math.sqrt(s / w);
  }
  return out;
}

const median = (v: Float32Array): number => {
  if (!v.length) return 0;
  const sorted = Float32Array.from(v).sort();
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * When the voice speaks, seconds into the file: windows louder than the
 * room's tone (the file's quiet tenth, times `over`), joined across pauses
 * shorter than `bridge` (breaths between words), at least `least` long. (pure)
 */
export function speechSpans(samples: Float32Array, rate: number, opts: { over?: number; bridge?: number; least?: number } = {}): [number, number][] {
  const hop = 0.02;
  const env = envelope(samples, rate, hop, 0.04);
  if (!env.length) return [];
  const sorted = Float32Array.from(env).sort();
  const floor = sorted[Math.floor(sorted.length * 0.1)];
  const peak = sorted[Math.floor(sorted.length * 0.98)];
  const threshold = Math.max(0.01, floor * (opts.over ?? 3), peak * 0.12);
  const bridge = opts.bridge ?? 0.35;
  const least = opts.least ?? 0.25;
  const spans: [number, number][] = [];
  let start = -1;
  for (let k = 0; k <= env.length; k++) {
    const loud = k < env.length && env[k] >= threshold;
    if (loud && start < 0) start = k;
    if (!loud && start >= 0) {
      const a = start * hop;
      const b = k * hop + 0.04;
      const last = spans[spans.length - 1];
      if (last && a - last[1] <= bridge) last[1] = b;
      else spans.push([a, b]);
      start = -1;
    }
  }
  return spans.filter(([a, b]) => b - a >= least).map(([a, b]) => [Math.round(a * 100) / 100, Math.round(b * 100) / 100]);
}

/**
 * Where the beats fall, seconds into the file: the onset strength (the rise
 * of the log energy, every 10 ms), its tempo by autocorrelation between 70
 * and 180 beats a minute, then the phase whose grid lands on the most onset.
 * Empty for a sound with no steady pulse. (pure)
 */
export function beatTimes(samples: Float32Array, rate: number): number[] {
  const hop = 0.01;
  const env = envelope(samples, rate, hop, 0.03);
  if (env.length < 200) return [];
  const onset = new Float32Array(env.length);
  for (let k = 1; k < env.length; k++) onset[k] = Math.max(0, Math.log(1e-4 + env[k]) - Math.log(1e-4 + env[k - 1]));
  // A rise under 5 % of the energy is a ripple of a held note, never a beat.
  const base = Math.max(median(onset), Math.log(1.05));
  for (let k = 0; k < onset.length; k++) onset[k] = Math.max(0, onset[k] - base);
  // A pulse needs a few onsets: one attack and a drone is no tempo.
  let peaks = 0;
  for (let k = 1; k < onset.length - 1; k++) if (onset[k] > 0 && onset[k] >= onset[k - 1] && onset[k] > onset[k + 1]) peaks++;
  if (peaks < 4) return [];
  // The tempo: the lag (in hops) whose autocorrelation is strongest, 70–180 BPM.
  const minLag = Math.round(60 / 180 / hop);
  const maxLag = Math.round(60 / 70 / hop);
  let best = 0;
  let lag = 0;
  let energy = 0;
  for (let k = 0; k < onset.length; k++) energy += onset[k] * onset[k];
  for (let L = minLag; L <= maxLag; L++) {
    let s = 0;
    for (let k = L; k < onset.length; k++) s += onset[k] * onset[k - L];
    // A gentle preference for ~120 BPM, so a half or a double tempo does not win by a hair.
    s *= Math.exp(-0.5 * ((Math.log2((60 / (L * hop)) / 120)) / 1.2) ** 2);
    if (s > best) {
      best = s;
      lag = L;
    }
  }
  if (!lag || best < energy * 0.05) return [];
  // The phase: where a comb of that period gathers the most onset.
  let phase = 0;
  let gathered = -1;
  for (let p = 0; p < lag; p++) {
    let s = 0;
    for (let k = p; k < onset.length; k += lag) s += onset[k];
    if (s > gathered) {
      gathered = s;
      phase = p;
    }
  }
  const out: number[] = [];
  // An onset is seen as its window starts to take the attack in: half a window later is where it is heard.
  for (let k = phase; k < env.length; k += lag) out.push(Math.round((k * hop + 0.015) * 1000) / 1000);
  return out;
}
