/**
 * Breaking a text the overlay draws into lines that fit a width — the
 * intro's title and lines, the outro's — so a long place name goes on to a
 * second line instead of running off the frame. Pure: the measure is handed
 * in, so the painter measures with its canvas and the spec with a stub.
 */

/**
 * `text` broken into lines no wider than `max` by `measure`, the author's
 * own line breaks kept. A single word wider than `max` stays whole on its
 * line (it is shrunk, never cut, by whoever asked for a fit).
 */
export function breakLines(text: string, max: number, measure: (t: string) => number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    const words = para.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
      // An empty line the author typed keeps its room; trailing ones do not.
      out.push('');
      continue;
    }
    let cur = '';
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (!cur || measure(next) <= max) cur = next;
      else {
        out.push(cur);
        cur = w;
      }
    }
    out.push(cur);
  }
  while (out.length > 1 && out[out.length - 1] === '') out.pop();
  while (out.length > 1 && out[0] === '') out.shift();
  return out;
}

/** The size that brings the widest of `lines` within `max`, never larger than `size`. */
export function fitSize(lines: readonly string[], size: number, max: number, measure: (t: string, size: number) => number): number {
  const widest = Math.max(0, ...lines.map((l) => measure(l, size)));
  return widest > max ? size * (max / widest) : size;
}
