/**
 * What THIS display and THIS browser can show of an HDR picture — detected,
 * and said plainly where they cannot, rather than a preview that pretends.
 *
 * Two questions, kept apart because their answers differ today:
 *
 * - the DISPLAY: `(dynamic-range: high)` is a media query every current
 *   browser answers, true on a screen whose peak is well above SDR white;
 * - the CANVAS: a 2D or WebGL canvas draws in SDR unless it was made with an
 *   HDR colour space (`rec2100-hlg` / `rec2100-pq`), which no browser ships
 *   without a flag as of 2026 — so the STAGE stays the SDR base, and the
 *   file is where the headroom goes. When a browser starts honouring the
 *   space, `canvas` here turns true on its own, and that is the day an HDR
 *   stage becomes worth building.
 *
 * The probe is pure over an environment record so the sentence has a spec;
 * `hdrSupport()` reads the real one.
 */

export interface HdrEnvironment {
  /** `matchMedia(query).matches`, or false where there is no matchMedia. */
  matches: (query: string) => boolean;
  /** The colour spaces a 2D canvas really adopts when asked — the echo of `getContextAttributes().colorSpace`. */
  canvasColorSpaces: readonly string[];
}

export interface HdrSupport {
  display: boolean;
  canvas: boolean;
  /** One sentence for the panel. */
  line: string;
}

const HDR_SPACES = ['rec2100-hlg', 'rec2100-pq'];

export function probeHdrSupport(env: HdrEnvironment): HdrSupport {
  const display = env.matches('(dynamic-range: high)');
  const canvas = env.canvasColorSpaces.some((s) => HDR_SPACES.includes(s));
  const line = display
    ? canvas
      ? 'This display shows HDR and this browser can draw it — the stage still shows the SDR base.'
      : 'This display shows HDR, but this browser’s canvas draws SDR only: the stage shows the base, the file glows in a viewer that can.'
    : 'This display shows SDR: the file’s headroom shows on an HDR screen, in a viewer that reads gain maps.';
  return { display, canvas, line };
}

/** What a 2D canvas really adopts for each HDR space, asked once. */
function canvasSpaces(): string[] {
  if (typeof document === 'undefined') return [];
  const out: string[] = [];
  for (const space of HDR_SPACES) {
    try {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { colorSpace: space } as CanvasRenderingContext2DSettings);
      const got = ctx?.getContextAttributes?.()?.colorSpace;
      if (got === space) out.push(space);
    } catch {
      // An unknown colour space throws in some browsers: that is a "no".
    }
  }
  return out;
}

let probed: HdrSupport | null = null;

/** The real answer for this page, kept: a display does not change under a session. */
export function hdrSupport(): HdrSupport {
  if (probed) return probed;
  probed = probeHdrSupport({
    matches: (q) => (typeof matchMedia === 'function' ? matchMedia(q).matches : false),
    canvasColorSpaces: canvasSpaces(),
  });
  return probed;
}
