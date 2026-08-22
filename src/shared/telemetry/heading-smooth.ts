/**
 * Smoothing and gap-bridging for the reconstructed heading — pure, DOM-free.
 *
 * **Why the heading is jumpy, and why it disappears.** The `.srt` carries no
 * compass and no yaw: the heading shown is *course over ground*, the azimuth
 * between two GPS fixes about a second apart (`motion.ts`). Two consequences
 * fall out of that, and both are visible on a HUD:
 *
 *  - it **steps**, because the GPS only refreshes a few times a second while
 *    the overlay renders at 30–60 fps;
 *  - it **vanishes** whenever horizontal travel over the window drops below a
 *    metre — hovering, creeping, or (most often) yawing on the spot: the nose
 *    turns, the ground track does not. Below that floor there is no direction
 *    to report, only GPS noise, so `motion.ts` deliberately reports nothing.
 *
 * Lowering that floor would not help: it would trade a gap for a weathervane.
 * What helps is averaging over a window, which is what this module does — and
 * the same window bridges the short gaps for free, because it still holds
 * older cues that *did* have a reading.
 *
 * **Two rules this implementation keeps.**
 *
 * 1. It is a pure function of `(cues, time)`, never an accumulator over
 *    rendered frames. The preview and the export do not render at the same
 *    cadence; an exponential filter fed frame by frame would drift between
 *    them, and the burned-in overlay would not match what was on screen.
 * 2. The average is **circular** — unit vectors, not degrees. Averaging
 *    350° and 10° arithmetically gives 180°, pointing exactly backwards.
 */

import { lastIndexAtOrBefore, type Cue } from './motion';

export interface SmoothedHeading {
  /** The eased bearing in `[0, 360)`, or null when nothing is in reach. */
  heading: number | null;
  /** Seconds since the newest real reading; 0 while data is live. */
  age: number;
  /**
   * 1 while readings are arriving, falling to 0 across the hold window once
   * they stop. Renderers fade with it rather than cutting out.
   */
  confidence: number;
}

export const NO_HEADING: SmoothedHeading = { heading: null, age: 0, confidence: 0 };

const DEG2RAD = Math.PI / 180;

/** Weights below this add nothing visible; stop walking there. */
const NEGLIGIBLE = 0.02;
/** Never walk back more than this, whatever the time constant. */
const MAX_WINDOW_S = 12;

/**
 * The eased heading at `timeSeconds`.
 *
 * @param tauSeconds  Easing time constant. 0 disables smoothing and returns the
 *                    newest reading as-is.
 * @param holdSeconds How long a stale reading keeps being reported after the
 *                    data stops, with `confidence` decaying across it.
 * @param early       Accept the look-ahead readings of the opening window
 *                    (`Cue.lead`, see motion.ts) so the instrument is already
 *                    pointing on the clip's first frame instead of waiting a
 *                    second for its first backward measurement. Default on;
 *                    `false` is the strictly backward-looking behaviour.
 */
export function smoothHeading(
  cues: readonly Cue[],
  timeSeconds: number,
  tauSeconds = 0.6,
  holdSeconds = 2,
  early = true,
): SmoothedHeading {
  if (cues.length === 0) return NO_HEADING;
  const start = lastIndexAtOrBefore(cues as Cue[], timeSeconds);
  if (start < 0) return NO_HEADING;

  const tau = Math.max(0, tauSeconds);
  const hold = Math.max(0, holdSeconds);
  const now = cues[start].start;
  const reach = Math.min(MAX_WINDOW_S, tau > 0 ? tau * 4 : 0);

  let sx = 0;
  let sy = 0;
  let weight = 0;
  let newest: number | null = null;
  let newestAt = 0;

  for (let i = start; i >= 0; i--) {
    const cue = cues[i];
    const dt = now - cue.start;
    if (dt > Math.max(reach, hold)) break;
    // Read the field directly rather than through `motionAt`: this loop runs
    // per rendered frame over up to a 12 s window, and an object per cue is a
    // needless allocation.
    const h = cue.derived?.heading ?? (early ? cue.lead?.heading : undefined);
    if (h == null) continue;

    if (newest === null) {
      newest = h;
      newestAt = cue.start;
    }
    // Only cues inside the easing window feed the average; the ones beyond it
    // exist solely to answer "when did we last know anything".
    if (dt <= reach) {
      const w = tau > 0 ? Math.exp(-dt / tau) : 1;
      if (w < NEGLIGIBLE) continue;
      sx += Math.sin(h * DEG2RAD) * w;
      sy += Math.cos(h * DEG2RAD) * w;
      weight += w;
    }
    if (tau === 0) break; // Unsmoothed: the newest reading is the answer.
  }

  if (newest === null) return NO_HEADING;
  const age = Math.max(0, timeSeconds - newestAt);

  // Nothing inside the easing window: we are in a gap, holding the last known
  // bearing while its confidence runs out.
  if (weight === 0 || tau === 0) {
    return {
      heading: newest,
      age,
      confidence: hold > 0 ? Math.max(0, 1 - age / hold) : age > 0 ? 0 : 1,
    };
  }

  const mean = (Math.atan2(sx, sy) / DEG2RAD + 360) % 360;
  // A gap inside the window still counts against confidence: the average is
  // real, but it is being carried by increasingly old samples.
  const confidence = hold > 0 ? Math.max(0, Math.min(1, 1 - age / hold)) : 1;
  return { heading: mean, age, confidence };
}
